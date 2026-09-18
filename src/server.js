import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { create, deriveHmacKeySecret, randomInt } from 'altcha-lib/frameworks/express';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { verify } from 'altcha-lib/frameworks/shared';
import { verifySolution } from 'altcha-lib';
import { createClient } from 'redis';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import bcrypt from 'bcryptjs';
import { CONFIG, PATHS } from './config.js';
import { SentinelDB } from './database.js';



function getNowInTimezone(tz = CONFIG.timezone) {
  const now = new Date();
  try {
    const dtf = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      fractionalSecondDigits: 3
    });
    const parts = Object.fromEntries(dtf.formatToParts(now).map(p => [p.type, p.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond || '000'}`;

    let offset = '+08:00';
    try {
      const tzDtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
      const tzParts = tzDtf.formatToParts(now);
      const tzPart = tzParts.find(p => p.type === 'timeZoneName');
      if (tzPart && tzPart.value.startsWith('GMT')) {
        offset = tzPart.value.replace('GMT', '');
      }
    } catch { }

    return {
      date,
      time,
      timestamp: `${date}T${time}${offset}`
    };
  } catch {
    const iso = now.toISOString();
    return {
      date: iso.split('T')[0],
      time: iso.split('T')[1].replace('Z', ''),
      timestamp: iso
    };
  }
}

function writeAccessLog(entry, structuredData = null) {
  console.log(entry);

  if (structuredData) {
    SentinelDB.insertLog(structuredData);
  }
}

if (!CONFIG.hmacKey) {
  console.warn('WARNING: ALTCHA_HMAC_KEY is not detected in environment variables! Make sure to set it in the .env file.');
}

const hmacSignatureSecret = CONFIG.hmacKey || 'default-secret-change-me';
const hmacKeySignatureSecret = CONFIG.hmacKeySecret || (await deriveHmacKeySecret(hmacSignatureSecret));

const app = express();

const parsedProxy = CONFIG.trustProxy === 'true' ? true : (CONFIG.trustProxy === 'false' ? false : (isNaN(Number(CONFIG.trustProxy)) ? CONFIG.trustProxy : Number(CONFIG.trustProxy)));
app.set('trust proxy', parsedProxy);

function isAltchaEndpoint(reqPath) {
  const p = (reqPath || '').toLowerCase().replace(/\/+$/, '');
  return (
    p === '/challenge' ||
    p === '/altcha/challenge' ||
    p === '/verify' ||
    p === '/altcha/verify'
  );
}

app.use((req, res, next) => {
  // Only monitor and log ALTCHA-related endpoints
  if (!isAltchaEndpoint(req.path)) {
    return next();
  }

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
    const { date, timestamp } = getNowInTimezone();

    const isSuccess = status >= 200 && status < 400 && !res.locals.logError;
    const resultText = isSuccess ? 'Success' : (res.locals.logError ? `Fail: ${res.locals.logError}` : `Fail (HTTP ${status})`);
    const username = req.apiKeyUser?.username || req.authUser?.username || '-';

    writeAccessLog(
      `${timestamp} | ${ip} | ${req.method} ${req.originalUrl} | ${status} | ${duration}ms | Origin: ${origin} | User: ${username} | ${resultText}`,
      {
        timestamp,
        date,
        ip,
        method: req.method,
        url: req.originalUrl,
        status,
        durationMs: duration,
        origin,
        result: resultText,
        isSuccess,
        username
      }
    );
  });

  next();
});

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser (lightweight, no extra dep needed)
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(rest.join('=').trim());
  });
  return cookies;
}

// Session TTL (hours)
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS, 10) || 8;

// Auth helper: get session user from request
function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['sentinel_session'];
  if (!token) return null;
  return SentinelDB.getSession(token);
}

// requireAuth middleware
const requireAuth = (req, res, next) => {
  const user = getSessionUser(req);
  if (!user) {
    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      return res.redirect('/login.html');
    }
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  req.authUser = user;
  next();
};

// requireAdmin middleware
const requireAdmin = (req, res, next) => {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  if (req.authUser.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden. Administrator privileges required.' });
  }
  next();
};

// Helper: parse allowed_origins JSON string from user record
function parseAllowedOrigins(user) {
  if (!user || !user.allowed_origins) return null;
  try {
    const parsed = JSON.parse(user.allowed_origins);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

// Helper: Match incoming request origin against a whitelist rule
function matchAllowedOriginRule(requestOrigin, rule) {
  if (!requestOrigin || !rule) return false;
  const r = rule.trim();
  if (r === '*') return true;

  // Clean request origin
  const reqNorm = requestOrigin.trim().toLowerCase().replace(/\/+$/, '');
  const ruleNorm = r.toLowerCase().replace(/\/+$/, '');

  // 1. Exact match
  if (reqNorm === ruleNorm) return true;

  // 2. Normalize localhost <-> 127.0.0.1 for local environments
  const reqL = reqNorm.replace('://127.0.0.1', '://localhost');
  const ruleL = ruleNorm.replace('://127.0.0.1', '://localhost');
  if (reqL === ruleL) return true;

  // 3. Parse URLs for hostname/port matching
  try {
    const reqUrl = new URL(reqNorm.includes('://') ? reqNorm : `http://${reqNorm}`);
    const reqHostname = reqUrl.hostname;
    const reqHost = reqUrl.host; // includes port if non-standard

    // Wildcard match: *.domain.com
    if (ruleNorm.includes('*.')) {
      const cleanRuleHost = ruleNorm.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const baseDomain = cleanRuleHost.replace('*.', '');
      if (reqHostname === baseDomain || reqHostname.endsWith('.' + baseDomain)) {
        return true;
      }
    }

    // Rule specified without protocol: e.g. "example.com" or "example.com:3000"
    if (!ruleNorm.includes('://')) {
      const cleanRule = ruleNorm.replace(/\/.*$/, '');
      if (cleanRule === reqHost || cleanRule === reqHostname) {
        return true;
      }
    }
  } catch {}

  return false;
}

// requireApiKey middleware for ALTCHA endpoints
const requireApiKey = (req, res, next) => {
  let apiKey = null;

  // 1. Authorization: Bearer <key>
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
      apiKey = parts[1].trim();
    } else if (parts.length === 1 && !parts[0].toLowerCase().startsWith('basic')) {
      apiKey = parts[0].trim();
    }
  }

  // 2. X-Altcha-Key: <key>
  if (!apiKey && req.headers['x-altcha-key']) {
    apiKey = String(req.headers['x-altcha-key']).trim();
  }

  // 3. Query string: ?apiKey=<key> or ?key=<key> or ?altcha_key=<key>
  if (!apiKey && req.query) {
    if (req.query.apiKey) apiKey = String(req.query.apiKey).trim();
    else if (req.query.key) apiKey = String(req.query.key).trim();
    else if (req.query.altcha_key) apiKey = String(req.query.altcha_key).trim();
  }

  // 4. Request Body: req.body?.apiKey or req.body?.key
  if (!apiKey && req.body && typeof req.body === 'object') {
    if (req.body.apiKey) apiKey = String(req.body.apiKey).trim();
    else if (req.body.key) apiKey = String(req.body.key).trim();
  }

  // 5. Fallback: If caller is authenticated via Sentinel manager session, allow their account key
  if (!apiKey) {
    const sessionUser = getSessionUser(req);
    if (sessionUser && sessionUser.apiKey) {
      apiKey = sessionUser.apiKey;
    }
  }

  if (!apiKey) {
    res.locals.logError = 'Missing API key';
    return res.status(401).json({
      error: "Unauthorized: Missing API key. Please provide a valid API key via 'X-Altcha-Key' header, 'Authorization: Bearer <key>' header, or '?apiKey=' query parameter.",
      success: false
    });
  }

  const user = SentinelDB.getUserByApiKey(apiKey);
  if (!user) {
    res.locals.logError = 'Invalid API key';
    return res.status(401).json({
      error: 'Unauthorized: Invalid API key.',
      success: false
    });
  }

  // Strict Domain Whitelist (Origin Binding)
  // Manager UI sessions are exempt from origin binding checks
  const sessionUser = getSessionUser(req);
  const isManagerRequest = !!sessionUser;

  if (!isManagerRequest) {
    const allowedOrigins = parseAllowedOrigins(user);
    const isChallengeReq = req.path === '/challenge' || req.path === '/altcha/challenge';

    // Strict Whitelist: If no domains are whitelisted for this key, block all external requests
    if (!allowedOrigins || allowedOrigins.length === 0) {
      res.locals.logError = 'No allowed domains configured for this API key';
      return res.status(403).json({
        error: 'Forbidden: No domains have been registered in the whitelist for this API key. Please add your allowed domain in Key & Domain Manager.',
        success: false
      });
    }

    // Determine incoming Origin or Referer
    const origin = req.headers['x-origin'] || req.headers['origin'] || null;
    const referer = req.headers['x-referer'] || req.headers['referer'] || null;

    let requestOrigin = origin;
    if (!requestOrigin && referer) {
      try { requestOrigin = new URL(referer).origin; } catch { requestOrigin = null; }
    }

    // Direct access without Origin/Referer header
    if (!requestOrigin) {
      // For /challenge (browser widget requests), Origin or Referer is strictly required
      if (isChallengeReq) {
        // If wildcard '*' is in the whitelist, direct access is permitted
        if (!allowedOrigins.includes('*')) {
          res.locals.logError = 'Direct request without Origin/Referer blocked';
          return res.status(403).json({
            error: 'Forbidden: Direct request without Origin or Referer header is blocked. Only registered whitelist domains are permitted.',
            success: false
          });
        }
      }
    }

    if (requestOrigin) {
      const isAllowed = allowedOrigins.some(allowed => matchAllowedOriginRule(requestOrigin, allowed));
      if (!isAllowed) {
        res.locals.logError = `Origin "${requestOrigin}" not in whitelist for API key`;
        return res.status(403).json({
          error: `Forbidden: Origin "${requestOrigin}" is not in the allowed domain whitelist for this API key. All other domains are blocked.`,
          success: false
        });
      }
    }
  }

  req.apiKeyUser = user;
  next();
};

// Clean expired sessions every hour
setInterval(() => SentinelDB.cleanExpiredSessions(), 60 * 60 * 1000);

let redisClient = null;

async function connectRedis() {
  if (!CONFIG.redisUrl) {
    console.warn('REDIS_URL is not set. Running without Redis anti-replay cache.');
    return;
  }

  const maxAttempts = Math.max(1, CONFIG.redisRetryAttempts || 5);
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const client = createClient({
        url: CONFIG.redisUrl,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
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
      console.error(`Failed to connect to Redis (${err.message}). Attempt ${attempt}/${maxAttempts}`);
      if (attempt >= maxAttempts) {
        console.error('Unable to connect to Redis. Application will continue running without anti-replay cache.');
      } else {
        await new Promise((res) => setTimeout(res, CONFIG.redisRetryDelayMs));
      }
    }
  }
}

await connectRedis();

let rateLimiter = null;

if (CONFIG.rateLimitEnabled) {
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
    windowMs: CONFIG.rateLimitWindowMs,
    limit: CONFIG.rateLimitMax,
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
      await redisClient.setEx(key, CONFIG.expiresIn, '1');
    } catch (err) {
      console.error('Redis set error:', err.message);
    }
  }
};

const altcha = create({
  hmacSignatureSecret,
  hmacKeySignatureSecret,
  createChallengeParameters: () => ({
    algorithm: CONFIG.algorithm,
    cost: CONFIG.cost,
    counter: randomInt(Math.max(20, Math.floor(CONFIG.cost * 0.2)), CONFIG.cost),
    expiresAt: new Date(Date.now() + CONFIG.expiresIn * 1000),
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

// Ensure database is populated and ready on first access
let isDbInitialized = false;
app.use((req, res, next) => {
  if (!isDbInitialized) {
    SentinelDB.ensureInitialized();
    isDbInitialized = true;
  }
  next();
});

// Auth Routes

/**
 * GET /api/auth/challenge
 * Generates an ALTCHA challenge for the manager login page.
 */
app.get('/api/auth/challenge', applyRateLimit, altcha.challengeHandler);

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Sets HttpOnly cookie on success.
 */
app.post('/api/auth/login', async (req, res) => {
  const { username, password, altcha } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  // Verify ALTCHA CAPTCHA payload
  if (!altcha) {
    return res.status(400).json({ error: 'CAPTCHA verification is required. Please complete the CAPTCHA.' });
  }

  try {
    const verifyResult = await verify(altcha, deriveKey, hmacSignatureSecret, hmacKeySignatureSecret, store);
    if (!verifyResult || !verifyResult.verification || !verifyResult.verification.verified) {
      const errMsg = verifyResult?.error || 'CAPTCHA verification failed. Please try again.';
      return res.status(400).json({ error: errMsg });
    }
  } catch (err) {
    console.error('[Login] CAPTCHA verification error:', err.message);
    return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
  }

  const user = SentinelDB.getUserByUsername(String(username).trim());
  if (!user) {
    // Use constant-time comparison to avoid timing attacks
    await bcrypt.compare('dummy', '$2a$12$invalidhashpadding000000000000000000000000000000000000');
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const valid = await bcrypt.compare(String(password), user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = SentinelDB.createSession(user.id, SESSION_TTL_HOURS);
  if (!token) {
    return res.status(500).json({ error: 'Failed to create session. Please try again.' });
  }

  const maxAge = SESSION_TTL_HOURS * 60 * 60;
  const isProduction = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    `sentinel_session=${token}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/${
      isProduction ? '; Secure' : ''
    }`
  );

  return res.json({ success: true, username: user.username, full_name: user.full_name || '', role: user.role });
});

/**
 * POST /api/auth/logout
 * Clears the session cookie and deletes session from DB.
 */
app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['sentinel_session'];
  if (token) {
    SentinelDB.deleteSession(token);
  }
  res.setHeader(
    'Set-Cookie',
    'sentinel_session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/'
  );
  return res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Returns current user info if session is valid.
 */
app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  return res.json({
    id: user.id,
    username: user.username,
    full_name: user.fullName || user.full_name || '',
    role: user.role,
    apiKey: user.apiKey,
    allowedOrigins: user.allowedOrigins || null
  });
});

/**
 * POST /api/auth/change-password
 * Body: { current_password, new_password }
 * Changes the authenticated user's password.
 */
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (String(new_password).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    const user = SentinelDB.getUserByUsername(req.authUser.username);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const valid = await bcrypt.compare(String(current_password), user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const newHash = bcrypt.hashSync(String(new_password), 12);
    const updated = SentinelDB.updatePassword(user.username, newHash);
    if (!updated) {
      return res.status(500).json({ error: 'Failed to update password.' });
    }

    return res.json({ success: true, message: 'Password has been changed successfully.' });
  } catch (err) {
    console.error('[ChangePassword] Error:', err.message);
    return res.status(500).json({ error: 'Failed to change password: ' + err.message });
  }
});



// Sentinel Management APIs
app.get('/api/sentinel/stats', requireAuth, (req, res) => {
  const requestedDate = req.query.date;
  const stats = SentinelDB.getStats(requestedDate);
  const mem = process.memoryUsage();

  res.json({
    date: stats?.date || requestedDate || new Date().toISOString().split('T')[0],
    totalRequests: stats?.totalRequests || 0,
    avgLatencyMs: stats?.avgLatencyMs || 0,
    challengesCount: stats?.challengesCount || 0,
    verificationsCount: stats?.verificationsCount || 0,
    verifiedSuccess: stats?.verifiedSuccess || 0,
    blockedCount: stats?.blockedCount || 0,
    rateLimitedCount: stats?.rateLimitedCount || 0,
    statusCounts: stats?.statusCounts || {},
    topOrigins: stats?.topOrigins || [],
    topIps: stats?.topIps || [],
    hourlyActivity: stats?.hourlyActivity || [],
    system: {
      uptime: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
      },
      redis: {
        connected: !!redisClient?.isOpen,
        url: CONFIG.redisUrl ? 'configured' : 'none'
      },
      rateLimiter: {
        enabled: CONFIG.rateLimitEnabled,
        max: CONFIG.rateLimitMax,
        windowMs: CONFIG.rateLimitWindowMs,
        store: redisClient?.isOpen ? 'RedisStore' : 'MemoryStore'
      }
    }
  });
});

app.get('/api/sentinel/logs', requireAuth, (req, res) => {
  const { date, status, search, page = 1, limit = 50 } = req.query;
  const result = SentinelDB.getLogs({ date, status, search, page, limit });
  res.json(result);
});

app.get('/api/sentinel/logs/dates', requireAuth, (req, res) => {
  res.json(SentinelDB.getAvailableDates());
});

app.delete('/api/sentinel/logs', requireAuth, requireAdmin, (req, res) => {
  try {
    const { range = 'all', date, beforeDate } = req.body || {};
    const result = SentinelDB.deleteLogs({ range, date, beforeDate });
    res.json({
      success: true,
      message: `Berhasil menghapus ${result.deletedCount} data log.`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Gagal menghapus data log.' });
  }
});

app.get('/api/sentinel/config', requireAuth, (req, res) => {
  res.json({
    algorithm: CONFIG.algorithm,
    cost: CONFIG.cost,
    expiresIn: CONFIG.expiresIn,
    rateLimitMax: CONFIG.rateLimitMax,
    rateLimitWindowMs: CONFIG.rateLimitWindowMs,
    redisConnected: !!redisClient?.isOpen,
    trustProxy: parsedProxy,
    port: CONFIG.port,
    host: CONFIG.host
  });
});

app.post('/api/sentinel/redis/flush', requireAuth, async (req, res) => {
  if (!redisClient?.isOpen) {
    return res.status(400).json({ error: 'Redis is not connected.' });
  }
  try {
    const keys = await redisClient.keys('altcha*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    res.json({ success: true, message: `Successfully flushed ${keys.length} ALTCHA cache keys from Redis.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to flush Redis: ' + err.message });
  }
});

// App Settings API — GET is public (needed before login for dynamic title)
app.get('/api/sentinel/app-settings', (req, res) => {
  try {
    const settings = SentinelDB.getSettings();
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const pkgStr = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgStr);
      settings.app_version = pkg.version || '1.0.0';
      settings.altcha_lib_version = (pkg.dependencies && pkg.dependencies['altcha-lib']) ? pkg.dependencies['altcha-lib'].replace(/^[^\d]+/, '') : '2.5.0';
    } catch (e) {
      settings.app_version = '1.0.0';
      settings.altcha_lib_version = '2.5.0';
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch app settings: ' + err.message });
  }
});

app.post('/api/sentinel/app-settings', requireAuth, requireAdmin, (req, res) => {
  const ALLOWED_KEYS = ['app_name', 'app_tagline', 'app_url', 'app_port', 'app_footer'];
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Invalid payload. Expected a JSON object.' });
  }

  const filtered = {};
  for (const key of ALLOWED_KEYS) {
    if (key in payload && typeof payload[key] === 'string') {
      let val = payload[key].trim();
      if (key === 'app_url') {
        val = val.replace(/\/+$/, ''); // Strip trailing slash
      }
      filtered[key] = val;
    }
  }

  if (Object.keys(filtered).length === 0) {
    return res.status(400).json({ error: 'No valid setting keys provided.' });
  }

  const ok = SentinelDB.setSettings(filtered);
  if (!ok) {
    return res.status(500).json({ error: 'Failed to save settings.' });
  }

  // If app_port was updated, update .env file as well
  if (filtered.app_port && fs.existsSync(PATHS.envFile)) {
    try {
      let envContent = fs.readFileSync(PATHS.envFile, 'utf8');
      if (/^PORT=.*/m.test(envContent)) {
        envContent = envContent.replace(/^PORT=.*/m, `PORT=${filtered.app_port}`);
      } else {
        envContent += `\nPORT=${filtered.app_port}`;
      }
      fs.writeFileSync(PATHS.envFile, envContent, 'utf8');
    } catch (err) {
      console.warn('Could not update PORT in .env:', err.message);
    }
  }

  res.json({ success: true, settings: SentinelDB.getSettings() });
});

// Update PoW Engine Config (.env)
app.post('/api/sentinel/pow-config', requireAuth, requireAdmin, (req, res) => {
  const { altcha_cost, expires_in, rate_limit_max, rate_limit_window_ms } = req.body;

  if (altcha_cost === undefined && expires_in === undefined && rate_limit_max === undefined && rate_limit_window_ms === undefined) {
    return res.status(400).json({ error: 'No configuration provided.' });
  }

  let envContent = '';
  if (fs.existsSync(PATHS.envFile)) {
    try {
      envContent = fs.readFileSync(PATHS.envFile, 'utf8');
    } catch (e) {
      return res.status(500).json({ error: 'Could not read .env file: ' + e.message });
    }
  }

  const updateEnv = (key, val) => {
    if (val !== undefined && val !== '') {
      const regex = new RegExp(`^${key}=.*`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${val}`);
      } else {
        envContent += `\n${key}=${val}`;
      }
    }
  };

  updateEnv('ALTCHA_COST', altcha_cost);
  updateEnv('EXPIRES_IN', expires_in);
  updateEnv('RATE_LIMIT_MAX', rate_limit_max);
  updateEnv('RATE_LIMIT_WINDOW_MS', rate_limit_window_ms);

  try {
    fs.writeFileSync(PATHS.envFile, envContent.trim() + '\n', 'utf8');
    console.log('[pow-config] .env updated successfully');
  } catch (err) {
    console.error('[pow-config] Failed to write .env:', err.message);
    return res.status(500).json({ error: 'Could not save .env file: ' + err.message });
  }

  res.json({ success: true, message: 'Engine configuration updated successfully.' });
});

// User Management APIs (Administrator only)

// GET /api/sentinel/users — List all users
app.get('/api/sentinel/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = SentinelDB.getAllUsers();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users: ' + err.message });
  }
});

// POST /api/sentinel/users — Create new user
app.post('/api/sentinel/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const { username, password, role, api_key, full_name, fullName, allowed_origins } = req.body || {};
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const existing = SentinelDB.getUserByUsername(username.trim());
    if (existing) {
      return res.status(400).json({ error: `Username "${username.trim()}" is already taken.` });
    }

    // Parse allowed_origins: accept array or newline-separated string
    let originsArray = null;
    if (allowed_origins) {
      originsArray = Array.isArray(allowed_origins)
        ? allowed_origins.filter(Boolean)
        : String(allowed_origins).split('\n').map(s => s.trim()).filter(Boolean);
    }

    const newUser = SentinelDB.createUser({
      username: username.trim(),
      fullName: (full_name !== undefined ? full_name : fullName) || '',
      password,
      role: role === 'administrator' ? 'administrator' : 'user',
      apiKey: api_key ? String(api_key).trim() : null,
      allowedOrigins: originsArray
    });

    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user: ' + err.message });
  }
});

// PUT /api/sentinel/users/:id — Update user
app.put('/api/sentinel/users/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const existing = SentinelDB.getUserById(userId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { username, password, role, api_key, full_name, fullName, allowed_origins } = req.body || {};

    // Prevent removing administrator role from own account
    if (req.authUser.id === userId && role && role !== 'administrator') {
      return res.status(400).json({ error: 'You cannot remove administrator privileges from your own account.' });
    }

    if (username && username.trim() !== existing.username) {
      const conflict = SentinelDB.getUserByUsername(username.trim());
      if (conflict) {
        return res.status(400).json({ error: `Username "${username.trim()}" is already in use.` });
      }
    }

    if (password && password.trim().length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Parse allowed_origins: accept array or newline-separated string
    let originsArray = undefined; // undefined = don't update
    if (allowed_origins !== undefined) {
      if (allowed_origins === null || allowed_origins === '') {
        originsArray = null; // clear bindings
      } else {
        originsArray = Array.isArray(allowed_origins)
          ? allowed_origins.filter(Boolean)
          : String(allowed_origins).split('\n').map(s => s.trim()).filter(Boolean);
        if (originsArray.length === 0) originsArray = null;
      }
    }

    const updated = SentinelDB.updateUser(userId, {
      username: username?.trim(),
      fullName: full_name !== undefined ? full_name : fullName,
      password: password ? password.trim() : null,
      role,
      apiKey: api_key !== undefined ? String(api_key).trim() : undefined,
      allowedOrigins: originsArray
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user: ' + err.message });
  }
});

// PUT /api/sentinel/users/:id/allowed-origins — Update per-key domain binding
app.put('/api/sentinel/users/:id/allowed-origins', requireAuth, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    // Allow user to update their own domains, or administrator to update any user's domains
    if (req.authUser.role !== 'administrator' && req.authUser.id !== userId) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to manage this user\'s domains.' });
    }

    const existing = SentinelDB.getUserById(userId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { allowed_origins } = req.body || {};

    let originsArray = null;
    if (allowed_origins) {
      originsArray = Array.isArray(allowed_origins)
        ? allowed_origins.map(s => s.trim()).filter(Boolean)
        : String(allowed_origins).split('\n').map(s => s.trim()).filter(Boolean);
      if (originsArray.length === 0) originsArray = null;
    }

    const updated = SentinelDB.updateUser(userId, { allowedOrigins: originsArray });
    res.json({ success: true, user: updated, allowedOrigins: updated.allowed_origins });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update allowed origins: ' + err.message });
  }
});

// PUT /api/sentinel/keys/my-allowed-origins — Update own allowed domains
app.put('/api/sentinel/keys/my-allowed-origins', requireAuth, (req, res) => {
  try {
    const userId = req.authUser.id;
    const { allowed_origins } = req.body || {};

    let originsArray = null;
    if (allowed_origins) {
      originsArray = Array.isArray(allowed_origins)
        ? allowed_origins.map(s => s.trim()).filter(Boolean)
        : String(allowed_origins).split('\n').map(s => s.trim()).filter(Boolean);
      if (originsArray.length === 0) originsArray = null;
    }

    const updated = SentinelDB.updateUser(userId, { allowedOrigins: originsArray });
    res.json({ success: true, user: updated, allowedOrigins: updated.allowed_origins });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update allowed origins: ' + err.message });
  }
});

// POST /api/sentinel/users/:id/regenerate-key — Regenerate user's API Key
app.post('/api/sentinel/users/:id/regenerate-key', requireAuth, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const existing = SentinelDB.getUserById(userId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const updated = SentinelDB.regenerateUserApiKey(userId);
    res.json({ success: true, user: updated, apiKey: updated.api_key });
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate API key: ' + err.message });
  }
});

// DELETE /api/sentinel/users/:id — Delete user
app.delete('/api/sentinel/users/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    // Safety: prevent self-deletion
    if (req.authUser.id === userId) {
      return res.status(400).json({ error: 'You cannot delete your own account while logged in.' });
    }

    const existing = SentinelDB.getUserById(userId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const deleted = SentinelDB.deleteUser(userId);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete user.' });
    }

    res.json({ success: true, message: `User "${existing.username}" has been deleted.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user: ' + err.message });
  }
});

// POST /api/sentinel/keys/regenerate-my-key — Regenerate own API key
app.post('/api/sentinel/keys/regenerate-my-key', requireAuth, (req, res) => {
  try {
    const updated = SentinelDB.regenerateUserApiKey(req.authUser.id);
    res.json({ success: true, user: updated, apiKey: updated.api_key });
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate API key: ' + err.message });
  }
});

// Redirect root to login, keys, or dashboard based on session
app.get('/', (req, res) => {
  const user = getSessionUser(req);
  if (user) {
    if (user.role === 'user') {
      return res.redirect('/keys');
    }
    return res.redirect('/index');
  }
  return res.redirect('/login');
});

// Auth guard for protected HTML pages
const PROTECTED_PAGES = new Set([
  '/',
  '/index',
  '/index.html',
  '/logs',
  '/logs.html',
  '/pow-policy',
  '/pow-policy.html',
  '/integration',
  '/integration.html',
  '/users',
  '/users.html',
  '/keys',
  '/keys.html',
  '/settings',
  '/settings.html'
]);

// Redirect legacy /playground path to /integration
app.get(['/playground', '/playground.html', '/manager/playground', '/manager/playground.html'], (req, res) => {
  res.redirect(301, '/integration');
});

app.use((req, res, next) => {
  let cleanPath = req.path;
  if (cleanPath.startsWith('/manager')) cleanPath = cleanPath.slice('/manager'.length) || '/';
  if (cleanPath.startsWith('/sentinel')) cleanPath = cleanPath.slice('/sentinel'.length) || '/';

  if (PROTECTED_PAGES.has(cleanPath)) {
    const user = getSessionUser(req);
    if (!user) {
      return res.redirect('/login');
    }
    // Users with role 'user' can access /keys and /integration
    const userAllowedPaths = new Set(['/keys', '/keys.html', '/integration', '/integration.html']);
    if (user.role === 'user' && !userAllowedPaths.has(cleanPath)) {
      return res.redirect('/keys');
    }
  }
  next();
});

// Serve Manager Web Application Assets (supports clean URLs like /index as well as /index.html)
const staticServeOptions = {
  extensions: ['html', 'htm'],
  index: ['index.html']
};

app.use('/manager', express.static(PATHS.webDir, staticServeOptions));
app.use('/sentinel', express.static(PATHS.webDir, staticServeOptions));
app.use(express.static(PATHS.webDir, staticServeOptions));

// Serve altcha.min.js from root or web dir
const altchaJsPath = fs.existsSync(path.join(PATHS.webDir, 'altcha.min.js'))
  ? path.join(PATHS.webDir, 'altcha.min.js')
  : path.join(PATHS.root, 'altcha.min.js');
app.use('/altcha.min.js', express.static(altchaJsPath));


app.get('/health', applyRateLimit, (req, res) => {
  res.json({
    status: 'ok',
    limit: CONFIG.rateLimitMax
  });
});

app.get('/challenge', applyRateLimit, requireApiKey, altcha.challengeHandler);
app.get('/altcha/challenge', applyRateLimit, requireApiKey, altcha.challengeHandler);

app.post('/verify', applyRateLimit, requireApiKey, altcha.verifyHandler);
app.post('/altcha/verify', applyRateLimit, requireApiKey, altcha.verifyHandler);

app.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`ALTCHA server (v2) is ready to run on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`ALTCHA Manager UI is available at http://${CONFIG.host}:${CONFIG.port}/manager`);
});
