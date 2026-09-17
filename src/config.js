import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env automatically if supported in Node.js >= 20.6
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch { }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root directory is one level above src/
export const ROOT_DIR = path.resolve(__dirname, '..');

export const PATHS = {
  root: ROOT_DIR,
  src: __dirname,
  databaseDir: process.env.DATA_DIR || path.join(ROOT_DIR, 'database'),
  databaseFile: process.env.DB_FILE || path.join(process.env.DATA_DIR || path.join(ROOT_DIR, 'database'), 'altcha.db'),
  logDir: process.env.LOG_DIR || path.join(ROOT_DIR, 'log'),
  webDir: process.env.WEB_DIR || path.join(ROOT_DIR, 'web'),
  whitelistFile: process.env.WHITELIST_FILE || (fs.existsSync(path.join(ROOT_DIR, 'config', 'whitelist.json')) ? path.join(ROOT_DIR, 'config', 'whitelist.json') : path.join(ROOT_DIR, 'whitelist.json')),
  toolsDir: path.join(ROOT_DIR, 'tools'),
};

export const CONFIG = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  hmacKey: process.env.ALTCHA_HMAC_KEY,
  hmacKeySecret: process.env.ALTCHA_HMAC_KEY_SECRET,
  algorithm: process.env.ALTCHA_ALGORITHM || 'PBKDF2/SHA-256',
  cost: parseInt(process.env.ALTCHA_COST || process.env.MAX_NUMBER, 10) || 5000,
  expiresIn: parseInt(process.env.EXPIRES_IN, 10) || 300,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  trustProxy: process.env.TRUST_PROXY || '1',
  redisUrl: process.env.REDIS_URL || '',
  redisRetryAttempts: parseInt(process.env.REDIS_RETRY_ATTEMPTS, 10) || 5,
  redisRetryDelayMs: parseInt(process.env.REDIS_RETRY_DELAY_MS, 10) || 2000,
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 15,
  timezone: process.env.TIMEZONE || 'Asia/Makassar',
};
