import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root directory is one level above src/
export const ROOT_DIR = path.resolve(__dirname, '..');

// Load .env automatically from project root if supported in Node.js >= 20.6
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(ROOT_DIR, '.env'));
  } catch { }
}

export const PATHS = {
  root: ROOT_DIR,
  src: __dirname,
  databaseDir: process.env.DATA_DIR || path.join(ROOT_DIR, 'database'),
  databaseFile: process.env.DB_FILE || path.join(process.env.DATA_DIR || path.join(ROOT_DIR, 'database'), 'altcha.db'),
  logDatabaseFile: process.env.LOG_DB_FILE || path.join(process.env.DATA_DIR || path.join(ROOT_DIR, 'database'), 'log.altcha.db'),
  webDir: process.env.WEB_DIR || path.join(ROOT_DIR, 'web'),
  envFile: path.join(ROOT_DIR, '.env')
};

function resolveRedisUrl() {
  const envVal = (process.env.REDIS_URL || '').trim();
  if (envVal === 'none' || envVal === 'disabled' || envVal === 'false') {
    return '';
  }
  if (envVal) {
    return envVal;
  }
  // If running inside Docker container (/.dockerenv exists), auto-connect to bundled redis container
  if (fs.existsSync('/.dockerenv')) {
    return 'redis://redis:6379';
  }
  return '';
}

export const CONFIG = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  hmacKey: process.env.ALTCHA_HMAC_KEY,
  hmacKeySecret: process.env.ALTCHA_HMAC_KEY_SECRET,
  algorithm: process.env.ALTCHA_ALGORITHM || 'PBKDF2/SHA-256',
  cost: parseInt(process.env.ALTCHA_COST, 10) || 5000,
  expiresIn: parseInt(process.env.EXPIRES_IN, 10) || 300,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  trustProxy: process.env.TRUST_PROXY || '1',
  redisUrl: resolveRedisUrl(),
  redisRetryAttempts: Math.max(1, parseInt(process.env.REDIS_RETRY_ATTEMPTS, 10) || 5),
  redisRetryDelayMs: parseInt(process.env.REDIS_RETRY_DELAY_MS, 10) || 500,
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 15,
  timezone: process.env.TIMEZONE || 'Asia/Makassar',
};
