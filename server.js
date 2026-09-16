if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {}
}

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { create, deriveHmacKeySecret, randomInt } from 'altcha-lib/frameworks/express';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { createClient } from 'redis';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WHITELIST_FILE = path.join(__dirname, 'whitelist.json');

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
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 60;

if (!HMAC_KEY) {
  console.warn('WARNING: ALTCHA_HMAC_KEY is not detected in environment variables! Make sure to set it in the .env file.');
}

const hmacSignatureSecret = HMAC_KEY || 'default-secret-change-me';
const hmacKeySignatureSecret = process.env.ALTCHA_HMAC_KEY_SECRET || (await deriveHmacKeySecret(hmacSignatureSecret));

const app = express();

const parsedProxy = TRUST_PROXY === 'true' ? true : (TRUST_PROXY === 'false' ? false : (isNaN(Number(TRUST_PROXY)) ? TRUST_PROXY : Number(TRUST_PROXY)));
app.set('trust proxy', parsedProxy);

function getWhitelistConfig() {
  if (fs.existsSync(WHITELIST_FILE)) {
    try {
      const data = fs.readFileSync(WHITELIST_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        return {
          enabled: parsed.enabled !== false,
          allowDirectAccess: parsed.allowDirectAccess === true,
          domains: Array.isArray(parsed.domains) ? parsed.domains : []
        };
      }
    } catch (err) {
      console.error('Error reading whitelist.json:', err.message);
    }
  }

  if (CORS_ORIGIN && CORS_ORIGIN !== '*') {
    return {
      enabled: true,
      allowDirectAccess: false,
      domains: CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    };
  }

  return {
    enabled: false,
    allowDirectAccess: true,
    domains: []
  };
}

function matchDomainRule(origin, rule) {
  if (!origin || !rule) return false;
  if (rule === '*') return true;
  if (origin === rule) return true;

  if (rule.includes('*')) {
    try {
      const ruleUrl = new URL(rule.replace('*.', 'wildcard-temp.'));
      const originUrl = new URL(origin);

      if (ruleUrl.protocol !== originUrl.protocol) return false;
      if (ruleUrl.port !== originUrl.port) return false;

      const ruleHostSuffix = ruleUrl.hostname.replace('wildcard-temp.', '');
      return (
        originUrl.hostname === ruleHostSuffix ||
        originUrl.hostname.endsWith('.' + ruleHostSuffix)
      );
    } catch {
      return false;
    }
  }

  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    const config = getWhitelistConfig();
    if (!config.enabled) {
      return callback(null, true);
    }
    if (!origin) {
      return callback(null, true);
    }
    const isAllowed = config.domains.some((rule) => matchDomainRule(origin, rule));
    if (isAllowed) {
      return callback(null, true);
    }
    return callback(null, false);
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

let rateLimiter = null;

if (RATE_LIMIT_ENABLED) {
  let rateLimitStore;
  if (redisClient.isOpen) {
    try {
      rateLimitStore = new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
        prefix: 'altcha-rl:',
      });
      console.log('Rate limiter: Redis store enabled.');
    } catch (err) {
      console.warn('Rate limiter: Failed to initialize RedisStore, falling back to memory store:', err.message);
    }
  } else {
    console.log('Rate limiter: In-memory store enabled.');
  }

  rateLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: rateLimitStore,
    validate: {
      trustProxy: false,
    },
    handler: (req, res) => {
      res.status(429).json({
        error: 'Too many requests from this IP, please try again later.',
        success: false
      });
    }
  });
}

const applyRateLimit = (req, res, next) => {
  if (rateLimiter) {
    return rateLimiter(req, res, next);
  }
  next();
};

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

app.use((req, res, next) => {
  if (req.body && !req.body.altcha && req.body.payload) {
    req.body.altcha = req.body.payload;
  }
  next();
});

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

const whitelistGuard = (req, res, next) => {
  const config = getWhitelistConfig();
  if (!config.enabled) return next();

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (!origin && !referer) {
    if (config.allowDirectAccess || req.path === '/verify' || req.path === '/altcha/verify') {
      return next();
    }
    return res.status(403).json({
      error: 'Forbidden: Direct access without Origin or Referer header is not allowed.'
    });
  }

  const isOriginAllowed = origin && config.domains.some((rule) => matchDomainRule(origin, rule));
  let isRefererAllowed = false;
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      isRefererAllowed = config.domains.some((rule) => matchDomainRule(refererOrigin, rule));
    } catch {}
  }

  if (isOriginAllowed || isRefererAllowed) {
    return next();
  }

  return res.status(403).json({
    error: 'Forbidden: Origin or Referer is not in the allowed domain whitelist.'
  });
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/challenge', applyRateLimit, whitelistGuard, altcha.challengeHandler);
app.get('/altcha/challenge', applyRateLimit, whitelistGuard, altcha.challengeHandler);

app.post('/verify', applyRateLimit, whitelistGuard, altcha.verifyHandler);
app.post('/altcha/verify', applyRateLimit, whitelistGuard, altcha.verifyHandler);

app.listen(PORT, HOST, () => {
  console.log(`ALTCHA server (v2) is ready to run on http://${HOST}:${PORT}`);
});