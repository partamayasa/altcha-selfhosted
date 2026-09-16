if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch { }
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
const LOG_DIR = path.join(__dirname, 'log');

if (!fs.existsSync(LOG_DIR)) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create log directory:', err.message);
  }
}

function getLogFilePath() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `altcha-log.${yyyy}-${mm}-${dd}.log`);
}

function writeAccessLog(entry) {
  console.log(entry);
  fs.appendFile(getLogFilePath(), entry + '\n', 'utf8', (err) => {
    if (err) {
      console.error('Failed to write access log:', err.message);
    }
  });
}

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
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 15;

if (!HMAC_KEY) {
  console.warn('WARNING: ALTCHA_HMAC_KEY is not detected in environment variables! Make sure to set it in the .env file.');
}

const hmacSignatureSecret = HMAC_KEY || 'default-secret-change-me';
const hmacKeySignatureSecret = process.env.ALTCHA_HMAC_KEY_SECRET || (await deriveHmacKeySecret(hmacSignatureSecret));

const app = express();

const parsedProxy = TRUST_PROXY === 'true' ? true : (TRUST_PROXY === 'false' ? false : (isNaN(Number(TRUST_PROXY)) ? TRUST_PROXY : Number(TRUST_PROXY)));
app.set('trust proxy', parsedProxy);

app.use((req, res, next) => {
  const start = Date.now();
  const ip = req.ip || req.socket.remoteAddress || '-';
  const origin = req.headers['x-origin'] || req.headers.origin || '-';

  const originalJson = res.json;
  res.json = function (data) {
    if (data && typeof data === 'object') {
      if (data.error) {
        res.locals.logError = data.error;
      } else if (data.verification && data.verification.verified === false) {
        res.locals.logError = 'Verification failed';
      }
    }
    return originalJson.call(this, data);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const timestamp = new Date().toISOString();

    const isSuccess = status >= 200 && status < 400 && !res.locals.logError;
    const resultText = isSuccess ? 'SUCCESS' : `ERROR: ${res.locals.logError || `HTTP ${status}`}`;

    writeAccessLog(`${timestamp} | ${ip} | ${req.method} ${req.originalUrl} | ${status} | ${duration}ms | Origin: ${origin} | ${resultText}`);
  });

  next();
});

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

let redisClient = null;

async function connectRedis() {
  if (!REDIS_URL) {
    console.warn('REDIS_URL is not set. Running without Redis anti-replay cache.');
    return;
  }

  let retries = REDIS_RETRY_ATTEMPTS;
  while (retries > 0) {
    try {
      const client = createClient({
        url: REDIS_URL,
        socket: {
          reconnectStrategy: false
        }
      });
      client.on('error', (err) => {
        if (client.isOpen) {
          console.error('Redis Client Error:', err.message);
        }
      });
      await client.connect();
      redisClient = client;
      console.log('Connected to Redis successfully.');
      return;
    } catch (err) {
      retries -= 1;
      console.error(`Failed to connect to Redis (${err.message}). Remaining retries: ${retries}`);
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
  if (redisClient?.isOpen) {
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
    if (!redisClient?.isOpen) return null;
    try {
      return await redisClient.get(key);
    } catch (err) {
      console.error('Redis get error:', err.message);
      return null;
    }
  },
  set: async (key, value) => {
    if (!redisClient?.isOpen) return;
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

  const origin = req.headers['x-origin'] || req.headers.origin;
  const referer = req.headers['x-referer'] || req.headers.referer;

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
    } catch { }
  }

  if (isOriginAllowed || isRefererAllowed) {
    return next();
  }

  return res.status(403).json({
    error: 'Forbidden: Origin or Referer is not in the allowed domain whitelist.'
  });
};

const WEB_DIR = path.join(__dirname, 'web');

function parseLogLine(line) {
  if (!line || !line.trim()) return null;
  const parts = line.split(' | ').map((p) => p.trim());
  if (parts.length < 7) return null;

  const timestamp = parts[0];
  const ip = parts[1];
  const methodUrl = parts[2];
  const status = parseInt(parts[3], 10) || 0;
  const duration = parts[4];
  const durationMs = parseInt(duration, 10) || 0;
  const originPart = parts[5];
  const origin = originPart.startsWith('Origin: ') ? originPart.substring(8) : originPart;
  const result = parts.slice(6).join(' | ');

  const [method, ...urlParts] = methodUrl.split(' ');
  const url = urlParts.join(' ');

  return {
    timestamp,
    ip,
    method,
    url,
    status,
    duration,
    durationMs,
    origin,
    result,
    isSuccess: result === 'SUCCESS' || (status >= 200 && status < 400 && !result.startsWith('ERROR'))
  };
}

function getAvailableLogDates() {
  if (!fs.existsSync(LOG_DIR)) return [];
  try {
    const files = fs.readdirSync(LOG_DIR);
    const dates = [];
    for (const f of files) {
      const match = f.match(/^altcha-log\.(\d{4}-\d{2}-\d{2})\.log$/);
      if (match) {
        dates.push(match[1]);
      }
    }
    return dates.sort().reverse();
  } catch (err) {
    console.error('Failed to list log dates:', err.message);
    return [];
  }
}

function readLogLinesForDate(dateStr) {
  const dates = getAvailableLogDates();
  const targetDate = dateStr && dates.includes(dateStr) ? dateStr : (dates[0] || null);
  if (!targetDate) return [];

  const filePath = path.join(LOG_DIR, `altcha-log.${targetDate}.log`);
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const parsed = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const p = parseLogLine(lines[i]);
      if (p) parsed.push(p);
    }
    return parsed;
  } catch (err) {
    console.error('Failed to read log file:', err.message);
    return [];
  }
}

// Sentinel Management APIs
app.get('/api/sentinel/stats', (req, res) => {
  const requestedDate = req.query.date;
  const logs = readLogLinesForDate(requestedDate);

  let totalLatency = 0;
  let challengesCount = 0;
  let verificationsCount = 0;
  let verifiedSuccess = 0;
  let blockedCount = 0;
  let rateLimitedCount = 0;
  const statusCounts = {};
  const originCounts = {};
  const ipCounts = {};

  const hourlyMap = {};
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    hourlyMap[hh] = { hour: hh, count: 0, success: 0, errors: 0 };
  }

  logs.forEach((item) => {
    totalLatency += item.durationMs;
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;

    if (item.url.includes('/challenge')) challengesCount++;
    if (item.url.includes('/verify')) {
      verificationsCount++;
      if (item.isSuccess) verifiedSuccess++;
    }
    if (item.status === 403) blockedCount++;
    if (item.status === 429) rateLimitedCount++;

    const originKey = item.origin || '-';
    originCounts[originKey] = (originCounts[originKey] || 0) + 1;
    ipCounts[item.ip] = (ipCounts[item.ip] || 0) + 1;

    if (item.timestamp) {
      try {
        const hh = item.timestamp.split('T')[1].substring(0, 2);
        if (hourlyMap[hh]) {
          hourlyMap[hh].count++;
          if (item.isSuccess) hourlyMap[hh].success++;
          else hourlyMap[hh].errors++;
        }
      } catch { }
    }
  });

  const total = logs.length;
  const avgLatencyMs = total > 0 ? Math.round(totalLatency / total) : 0;

  const topOrigins = Object.entries(originCounts)
    .map(([origin, count]) => ({ origin, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topIps = Object.entries(ipCounts)
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const mem = process.memoryUsage();

  res.json({
    date: requestedDate || getAvailableLogDates()[0] || new Date().toISOString().split('T')[0],
    totalRequests: total,
    avgLatencyMs,
    challengesCount,
    verificationsCount,
    verifiedSuccess,
    blockedCount,
    rateLimitedCount,
    statusCounts,
    topOrigins,
    topIps,
    hourlyActivity: Object.values(hourlyMap),
    system: {
      uptime: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
      },
      redis: {
        connected: !!redisClient?.isOpen,
        url: REDIS_URL ? 'configured' : 'none'
      },
      rateLimiter: {
        enabled: RATE_LIMIT_ENABLED,
        max: RATE_LIMIT_MAX,
        windowMs: RATE_LIMIT_WINDOW_MS,
        store: redisClient?.isOpen ? 'RedisStore' : 'MemoryStore'
      }
    }
  });
});

app.get('/api/sentinel/logs', (req, res) => {
  const { date, status, search, page = 1, limit = 50 } = req.query;
  let logs = readLogLinesForDate(date);

  if (status) {
    const statusNum = parseInt(status, 10);
    logs = logs.filter((l) => l.status === statusNum);
  }

  if (search) {
    const q = String(search).toLowerCase();
    logs = logs.filter((l) =>
      l.ip.toLowerCase().includes(q) ||
      l.url.toLowerCase().includes(q) ||
      l.origin.toLowerCase().includes(q) ||
      l.result.toLowerCase().includes(q)
    );
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 10), 200);
  const total = logs.length;
  const totalPages = Math.ceil(total / limitNum) || 1;
  const startIndex = (pageNum - 1) * limitNum;
  const pagedLogs = logs.slice(startIndex, startIndex + limitNum);

  res.json({
    total,
    page: pageNum,
    limit: limitNum,
    totalPages,
    logs: pagedLogs
  });
});

app.get('/api/sentinel/logs/dates', (req, res) => {
  res.json(getAvailableLogDates());
});

app.get('/api/sentinel/whitelist', (req, res) => {
  res.json(getWhitelistConfig());
});

app.post('/api/sentinel/whitelist', (req, res) => {
  const { enabled, allowDirectAccess, domains } = req.body;
  if (typeof enabled !== 'boolean' || typeof allowDirectAccess !== 'boolean' || !Array.isArray(domains)) {
    return res.status(400).json({ error: 'Invalid whitelist structure provided.' });
  }

  const sanitizedDomains = domains
    .filter((d) => typeof d === 'string' && d.trim().length > 0)
    .map((d) => d.trim());

  const newConfig = {
    enabled,
    allowDirectAccess,
    domains: sanitizedDomains
  };

  try {
    fs.writeFileSync(WHITELIST_FILE, JSON.stringify(newConfig, null, 2), 'utf8');
    res.json({
      success: true,
      message: 'Whitelist configuration updated successfully.',
      config: newConfig
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write whitelist file: ' + err.message });
  }
});

app.post('/api/sentinel/whitelist/test', (req, res) => {
  const { origin } = req.body;
  if (!origin) {
    return res.status(400).json({ error: 'Origin parameter is required.' });
  }

  const config = getWhitelistConfig();
  if (!config.enabled) {
    return res.json({ allowed: true, matchedRule: 'Whitelist is currently disabled (All allowed)' });
  }

  const matched = config.domains.find((rule) => matchDomainRule(origin, rule));
  if (matched) {
    return res.json({ allowed: true, matchedRule: matched });
  }

  return res.json({ allowed: false, matchedRule: null });
});

app.get('/api/sentinel/config', (req, res) => {
  res.json({
    algorithm: ALGORITHM,
    cost: COST,
    expiresIn: EXPIRES_IN,
    rateLimitMax: RATE_LIMIT_MAX,
    rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
    redisConnected: !!redisClient?.isOpen,
    trustProxy: parsedProxy,
    port: PORT,
    host: HOST
  });
});

app.post('/api/sentinel/redis/flush', async (req, res) => {
  if (!redisClient?.isOpen) {
    return res.status(400).json({ error: 'Redis is not connected.' });
  }
  try {
    // Flush keys with prefix altcha
    const keys = await redisClient.keys('altcha*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    res.json({ success: true, message: `Successfully flushed ${keys.length} ALTCHA cache keys from Redis.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to flush Redis: ' + err.message });
  }
});

// Serve Manager Web Application Assets
app.use('/manager', express.static(WEB_DIR));
app.use('/sentinel', express.static(WEB_DIR));
app.use(express.static(WEB_DIR));
app.use('/altcha.min.js', express.static(path.join(__dirname, 'altcha.min.js')));

app.get('/health', applyRateLimit, (req, res) => {
  res.json({
    status: 'ok',
    limit: RATE_LIMIT_MAX
  });
});

app.get('/challenge', applyRateLimit, whitelistGuard, altcha.challengeHandler);
app.get('/altcha/challenge', applyRateLimit, whitelistGuard, altcha.challengeHandler);

app.post('/verify', applyRateLimit, whitelistGuard, altcha.verifyHandler);
app.post('/altcha/verify', applyRateLimit, whitelistGuard, altcha.verifyHandler);

app.listen(PORT, HOST, () => {
  console.log(`ALTCHA server (v2) is ready to run on http://${HOST}:${PORT}`);
  console.log(`ALTCHA Manager (ALTCHA Man) UI is available at http://${HOST}:${PORT}/manager`);
});