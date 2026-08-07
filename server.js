// Load environment variables from .env file if running in Node directly (Node 20.6+)
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {
    // Ignore error if .env file is not found (e.g. passed through Docker env)
  }
}

import express from 'express';
import cors from 'cors';
import { create, deriveHmacKeySecret, randomInt } from 'altcha-lib/frameworks/express';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { createClient } from 'redis';

// Environment Configurations
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const HMAC_KEY = process.env.ALTCHA_HMAC_KEY;
const COST = parseInt(process.env.ALTCHA_COST || process.env.MAX_NUMBER, 10) || 5000;
const EXPIRES_IN = parseInt(process.env.EXPIRES_IN, 10) || 300;
const ALGORITHM = process.env.ALTCHA_ALGORITHM || 'PBKDF2/SHA-256';
const REDIS_URL = process.env.REDIS_URL;
const REDIS_RETRY_ATTEMPTS = parseInt(process.env.REDIS_RETRY_ATTEMPTS, 10) || 5;
const REDIS_RETRY_DELAY_MS = parseInt(process.env.REDIS_RETRY_DELAY_MS, 10) || 2000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const TRUST_PROXY = process.env.TRUST_PROXY || '1';

if (!HMAC_KEY) {
  console.warn('WARNING: ALTCHA_HMAC_KEY is not detected in environment variables! Make sure to set it in the .env file.');
}

const hmacSignatureSecret = HMAC_KEY || 'default-secret-change-me';
const hmacKeySignatureSecret = process.env.ALTCHA_HMAC_KEY_SECRET || (await deriveHmacKeySecret(hmacSignatureSecret));

const app = express();

// Trust proxy settings (useful behind reverse proxies like Nginx/Traefik/Cloudflare)
const parsedProxy = TRUST_PROXY === 'true' ? true : (TRUST_PROXY === 'false' ? false : (isNaN(Number(TRUST_PROXY)) ? TRUST_PROXY : Number(TRUST_PROXY)));
app.set('trust proxy', parsedProxy);

// CORS configuration
app.use(cors({
  origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map((o) => o.trim())
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Redis Client Setup
const redisClient = createClient({
  url: REDIS_URL
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));

async function connectRedis() {
  if (!REDIS_URL) {
    console.warn('REDIS_URL is not set. Running without Redis anti-replay cache.');
    return;
  }

  let retries = REDIS_RETRY_ATTEMPTS;
  while (retries) {
    try {
      await redisClient.connect();
      console.log('Connected to Redis successfully.');
      break;
    } catch (err) {
      console.error(`Failed to connect to Redis. Remaining retries: ${retries - 1}`, err.message);
      retries -= 1;
      if (retries === 0) {
        console.error('Unable to connect to Redis. Application will continue running without anti-replay cache.');
      } else {
        await new Promise((res) => setTimeout(res, REDIS_RETRY_DELAY_MS));
      }
    }
  }
}

await connectRedis();

// Custom Store adapter for Redis
const store = {
  get: async (key) => {
    if (!redisClient.isOpen) return null;
    try {
      return await redisClient.get(key);
    } catch (err) {
      console.error('Redis get error:', err.message);
      return null;
    }
  },
  set: async (key, value) => {
    if (!redisClient.isOpen) return;
    try {
      await redisClient.setEx(key, EXPIRES_IN, '1');
    } catch (err) {
      console.error('Redis set error:', err.message);
    }
  }
};

// Initialize ALTCHA v2 instance
const altcha = create({
  hmacSignatureSecret,
  hmacKeySignatureSecret,
  createChallengeParameters: () => ({
    algorithm: ALGORITHM,
    cost: COST,
    counter: randomInt(COST, COST * 2),
    expiresAt: new Date(Date.now() + EXPIRES_IN * 1000),
  }),
  deriveKey,
  store,
});

// Middleware: normalize request body to support both 'altcha' and 'payload' field names
app.use((req, res, next) => {
  if (req.body && !req.body.altcha && req.body.payload) {
    req.body.altcha = req.body.payload;
  }
  next();
});

// Middleware: enhance JSON response to ensure backward compatibility with { success: true/false }
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (data) {
    if (data && typeof data === 'object') {
      if (data.verification?.verified === true && data.success === undefined) {
        data.success = true;
      } else if (data.verification && !data.verification.verified && data.success === undefined) {
        data.success = false;
      } else if (data.error && data.success === undefined) {
        data.success = false;
      }
    }
    return originalJson.call(this, data);
  };
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.5.0',
    protocol: 'v2',
    algorithm: ALGORITHM,
    cost: COST,
    expiresIn: EXPIRES_IN,
    redisConnected: redisClient.isOpen
  });
});

// Challenge endpoints
app.get('/challenge', altcha.challengeHandler);
app.get('/altcha/challenge', altcha.challengeHandler);

// Verification endpoints
app.post('/verify', altcha.verifyHandler);
app.post('/altcha/verify', altcha.verifyHandler);

app.listen(PORT, HOST, () => {
  console.log(`ALTCHA server (v2) is ready to run on http://${HOST}:${PORT}`);
});