/**
 * ALTCHA Sentinel - SQLite Database Module
 * Uses Node.js native SQLite (node:sqlite)
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PATHS } from './config.js';

const DB_DIR = PATHS.databaseDir;
const DB_FILE = PATHS.databaseFile;
const LOG_DB_FILE = PATHS.logDatabaseFile;
const isNewMainDb = !fs.existsSync(DB_FILE);
const isNewLogDb = !fs.existsSync(LOG_DB_FILE);

if (!fs.existsSync(DB_DIR)) {
  try {
    fs.mkdirSync(DB_DIR, { recursive: true });
    console.log(`[Database] Created database directory at: ${DB_DIR}`);
  } catch (err) {
    console.error('[Database] Failed to create database directory:', err.message);
  }
}

if (isNewMainDb || isNewLogDb) {
  console.log('[Database] Missing database detected. Populating database structure & administrator account...');
}

// Main transactional database (users, sessions, settings)
const db = new DatabaseSync(DB_FILE);

// Dedicated request logging database (access_logs)
const logDb = new DatabaseSync(LOG_DB_FILE);

function initMainSchema() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      api_key TEXT UNIQUE,
      allowed_origins TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY NOT NULL,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  // Migration: Ensure 'role', 'api_key', 'full_name', 'allowed_origins' columns exist in users table
  try {
    const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
    if (!userColumns.includes('role')) {
      db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
    }
    if (!userColumns.includes('api_key')) {
      db.exec(`ALTER TABLE users ADD COLUMN api_key TEXT`);
    }
    if (!userColumns.includes('full_name')) {
      db.exec(`ALTER TABLE users ADD COLUMN full_name TEXT DEFAULT ''`);
    }
    if (!userColumns.includes('allowed_origins')) {
      db.exec(`ALTER TABLE users ADD COLUMN allowed_origins TEXT DEFAULT NULL`);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key) WHERE api_key IS NOT NULL`);
  } catch (err) {
    console.warn('[Database] User columns migration notice:', err.message);
  }
}

function initLogSchema() {
  logDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      date TEXT NOT NULL,
      ip TEXT NOT NULL,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      status INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      origin TEXT DEFAULT '-',
      result TEXT NOT NULL,
      is_success INTEGER NOT NULL,
      username TEXT DEFAULT '-'
    );

    CREATE INDEX IF NOT EXISTS idx_logs_date ON access_logs(date);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON access_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_status ON access_logs(status);
    CREATE INDEX IF NOT EXISTS idx_logs_ip ON access_logs(ip);
    CREATE INDEX IF NOT EXISTS idx_logs_origin ON access_logs(origin);
  `);

  // Migration: Ensure 'username' column exists in access_logs table in logDb
  try {
    const logColumns = logDb.prepare(`PRAGMA table_info(access_logs)`).all().map(c => c.name);
    if (!logColumns.includes('username')) {
      logDb.exec(`ALTER TABLE access_logs ADD COLUMN username TEXT DEFAULT '-'`);
    }
  } catch (err) {
    console.warn('[Database] Access logs columns migration notice:', err.message);
  }
}

function seedDefaultSettings() {
  const seedSettings = [
    ['app_name', 'ALTCHA Manager'],
    ['app_tagline', 'Self-Hosted CAPTCHA Service'],
    ['app_url', 'http://localhost:8000'],
    ['app_port', '8000'],
    ['app_footer', 'Copyright \u00a9 2026 ALTCHA Manager. All rights reserved.']
  ];
  const seedStmt = db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`
  );
  const now = new Date().toISOString();
  for (const [key, value] of seedSettings) {
    seedStmt.run(key, value, now);
  }
}

function seedDefaultAdmin() {
  const adminUsername = (process.env.ADMIN_USERNAME || process.env.ADMIN_USER || 'admin').trim();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin12345';
  const adminFullName = (process.env.ADMIN_FULL_NAME || 'Administrator').trim();
  const now = new Date().toISOString();

  const existingAdmin = db.prepare(
    'SELECT id, username, role, api_key, allowed_origins FROM users WHERE username = ? OR role = ? LIMIT 1'
  ).get(adminUsername, 'administrator');

  if (!existingAdmin) {
    const defaultHash = bcrypt.hashSync(adminPassword, 12);
    const defaultKey = process.env.ADMIN_API_KEY || ('altcha_key_' + crypto.randomBytes(16).toString('hex'));
    const defaultOrigins = JSON.stringify(['*']); // Allow wildcard so admin key works immediately
    db.prepare(
      `INSERT INTO users (username, full_name, password_hash, role, api_key, allowed_origins, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(adminUsername, adminFullName, defaultHash, 'administrator', defaultKey, defaultOrigins, now, now);

    console.log('======================================================================');
    console.log('[ALTCHA Database] Database populated & Administrator account created!');
    console.log('----------------------------------------------------------------------');
    console.log(`  Username : ${adminUsername}`);
    console.log(`  Password : ${adminPassword}`);
    console.log(`  Role     : administrator`);
    console.log(`  API Key  : ${defaultKey}`);
    console.log(`  Origins  : Wildcard (*)`);
    console.log('  NOTE: Please change this default password after logging in.');
    console.log('======================================================================');
  } else {
    // Ensure administrator has administrator role, an api_key, and full_name
    const updates = [];
    const params = [];
    if (existingAdmin.role !== 'administrator') {
      updates.push('role = ?');
      params.push('administrator');
    }
    if (!existingAdmin.api_key) {
      updates.push('api_key = ?');
      params.push(process.env.ADMIN_API_KEY || ('altcha_key_' + crypto.randomBytes(16).toString('hex')));
    }
    if (updates.length > 0) {
      params.push(existingAdmin.id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
  }
}

// Run initializations immediately on module load
initMainSchema();
initLogSchema();
seedDefaultSettings();
seedDefaultAdmin();

// Prepared Statements
const insertLogStmt = logDb.prepare(`
  INSERT INTO access_logs (
    timestamp, date, ip, method, url, status, duration_ms, origin, result, is_success, username
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export const SentinelDB = {
  db,
  logDb,

  /**
   * Insert a new access log record
   */
  insertLog({ timestamp, date: customDate, ip, method, url, status, durationMs, origin, result, isSuccess, username }) {
    try {
      const date = customDate || (timestamp ? timestamp.split('T')[0] : new Date().toLocaleDateString('sv-SE'));
      insertLogStmt.run(
        timestamp,
        date,
        ip || '-',
        method || 'GET',
        url || '/',
        status || 200,
        Math.round(durationMs || 0),
        origin || '-',
        result || 'SUCCESS',
        isSuccess ? 1 : 0,
        username || '-'
      );
    } catch (err) {
      console.error('[Database] Error inserting access log:', err.message);
    }
  },

  /**
   * Get available dates that have log records
   */
  getAvailableDates() {
    try {
      const stmt = logDb.prepare(`SELECT DISTINCT date FROM access_logs ORDER BY date DESC`);
      const rows = stmt.all();
      return rows.map((r) => r.date);
    } catch (err) {
      console.error('[Database] Error fetching dates:', err.message);
      return [];
    }
  },

  /**
   * Get analytics & stats for a given date
   */
  getStats(targetDate = '') {
    try {
      const dates = this.getAvailableDates();
      const date = targetDate && dates.includes(targetDate)
        ? targetDate
        : (dates[0] || new Date().toLocaleDateString('sv-SE'));

      // 1. Total Requests & Average Latency
      const totalStmt = logDb.prepare(`
        SELECT COUNT(*) as total, COALESCE(AVG(duration_ms), 0) as avg_duration
        FROM access_logs
        WHERE date = ?
      `);
      const totalRow = totalStmt.get(date) || { total: 0, avg_duration: 0 };
      const totalRequests = totalRow.total;
      const avgLatencyMs = Math.round(totalRow.avg_duration);

      // 2. Challenges & Verifications
      const challengesStmt = logDb.prepare(`
        SELECT COUNT(*) as count FROM access_logs
        WHERE date = ? AND url LIKE '%/challenge%'
      `);
      const challengesCount = (challengesStmt.get(date) || { count: 0 }).count;

      const verifyStmt = logDb.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(is_success), 0) as verified_success
        FROM access_logs
        WHERE date = ? AND url LIKE '%/verify%'
      `);
      const verifyRow = verifyStmt.get(date) || { count: 0, verified_success: 0 };
      const verificationsCount = verifyRow.count;
      const verifiedSuccess = verifyRow.verified_success;

      // 3. Blocked & Rate Limited
      const blockedStmt = logDb.prepare(`
        SELECT COUNT(*) as count FROM access_logs WHERE date = ? AND status = 403
      `);
      const blockedCount = (blockedStmt.get(date) || { count: 0 }).count;

      const rateLimitedStmt = logDb.prepare(`
        SELECT COUNT(*) as count FROM access_logs WHERE date = ? AND status = 429
      `);
      const rateLimitedCount = (rateLimitedStmt.get(date) || { count: 0 }).count;

      // 4. Status Counts
      const statusStmt = logDb.prepare(`
        SELECT status, COUNT(*) as count FROM access_logs WHERE date = ? GROUP BY status
      `);
      const statusRows = statusStmt.all(date) || [];
      const statusCounts = {};
      statusRows.forEach((r) => {
        statusCounts[String(r.status)] = r.count;
      });

      // 5. Top Origins
      const originsStmt = logDb.prepare(`
        SELECT origin, COUNT(*) as count
        FROM access_logs
        WHERE date = ?
        GROUP BY origin
        ORDER BY count DESC
        LIMIT 10
      `);
      const topOrigins = (originsStmt.all(date) || []).map((r) => ({
        origin: r.origin,
        count: r.count
      }));

      // 6. Top Client IPs
      const ipsStmt = logDb.prepare(`
        SELECT ip, COUNT(*) as count
        FROM access_logs
        WHERE date = ?
        GROUP BY ip
        ORDER BY count DESC
        LIMIT 10
      `);
      const topIps = (ipsStmt.all(date) || []).map((r) => ({
        ip: r.ip,
        count: r.count
      }));

      // 7. Hourly Activity (24 Hours)
      const hourlyMap = {};
      for (let h = 0; h < 24; h++) {
        const hh = String(h).padStart(2, '0');
        hourlyMap[hh] = { hour: hh, count: 0, success: 0, errors: 0 };
      }

      const hourlyStmt = logDb.prepare(`
        SELECT CASE
                 WHEN timestamp LIKE '%Z' THEN strftime('%H', timestamp, '+8 hours')
                 ELSE substr(timestamp, 12, 2)
               END as hh,
               COUNT(*) as count,
               COALESCE(SUM(is_success), 0) as success,
               COALESCE(SUM(CASE WHEN is_success = 0 THEN 1 ELSE 0 END), 0) as errors
        FROM access_logs
        WHERE date = ?
        GROUP BY hh
      `);
      const hourlyRows = hourlyStmt.all(date) || [];
      hourlyRows.forEach((r) => {
        if (r.hh && hourlyMap[r.hh]) {
          hourlyMap[r.hh].count = r.count;
          hourlyMap[r.hh].success = r.success;
          hourlyMap[r.hh].errors = r.errors;
        }
      });

      return {
        date,
        totalRequests,
        avgLatencyMs,
        challengesCount,
        verificationsCount,
        verifiedSuccess,
        blockedCount,
        rateLimitedCount,
        statusCounts,
        topOrigins,
        topIps,
        hourlyActivity: Object.values(hourlyMap).sort((a, b) => parseInt(a.hour, 10) - parseInt(b.hour, 10))
      };
    } catch (err) {
      console.error('[Database] Error computing stats:', err.message);
      return null;
    }
  },

  /**
   * Get paginated logs with search & status filters
   */
  getLogs({ date = '', status = null, search = '', page = 1, limit = 50 }) {
    try {
      const dates = this.getAvailableDates();
      const targetDate = date && dates.includes(date) ? date : (dates[0] || null);

      const conditions = [];
      const params = [];

      if (targetDate) {
        conditions.push(`date = ?`);
        params.push(targetDate);
      }

      if (status !== null && status !== undefined && status !== '') {
        conditions.push(`status = ?`);
        params.push(parseInt(status, 10));
      }

      if (search && search.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        conditions.push(`(LOWER(ip) LIKE ? OR LOWER(url) LIKE ? OR LOWER(origin) LIKE ? OR LOWER(result) LIKE ? OR LOWER(COALESCE(username, '')) LIKE ?)`);
        params.push(q, q, q, q, q);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countStmt = logDb.prepare(`SELECT COUNT(*) as total FROM access_logs ${whereClause}`);
      const countRow = countStmt.get(...params);
      const total = countRow ? countRow.total : 0;

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 10), 200);
      const totalPages = Math.ceil(total / limitNum) || 1;
      const offset = (pageNum - 1) * limitNum;

      // Fetch logs
      const queryStmt = logDb.prepare(`
        SELECT id, timestamp, ip, method, url, status, duration_ms as durationMs,
               (duration_ms || 'ms') as duration, origin, result, is_success as isSuccess,
               COALESCE(username, '-') as username
        FROM access_logs
        ${whereClause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `);

      const logs = queryStmt.all(...params, limitNum, offset);

      return {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        logs
      };
    } catch (err) {
      console.error('[Database] Error fetching logs:', err.message);
      return { total: 0, page: 1, limit: 50, totalPages: 1, logs: [] };
    }
  },

  /**
   * Get all app settings as a plain { key: value } object
   */
  getSettings() {
    try {
      const rows = db.prepare(`SELECT key, value FROM app_settings`).all();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    } catch (err) {
      console.error('[Database] Error fetching app settings:', err.message);
      return {};
    }
  },

  /**
   * Get a single setting value by key
   */
  getSetting(key, defaultValue = null) {
    try {
      const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key);
      return row ? row.value : defaultValue;
    } catch (err) {
      console.error('[Database] Error fetching setting:', err.message);
      return defaultValue;
    }
  },

  /**
   * Upsert a single setting
   */
  setSetting(key, value) {
    try {
      db.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(key, String(value), new Date().toISOString());
      return true;
    } catch (err) {
      console.error('[Database] Error saving setting:', err.message);
      return false;
    }
  },

  /**
   * Upsert multiple settings from a { key: value } object
   */
  setSettings(obj) {
    try {
      const stmt = db.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      );
      const ts = new Date().toISOString();
      for (const [key, value] of Object.entries(obj)) {
        stmt.run(key, String(value), ts);
      }
      return true;
    } catch (err) {
      console.error('[Database] Error saving settings batch:', err.message);
      return false;
    }
  },

  // ──────────────────────────────────────────
  // Auth & User Management
  // ──────────────────────────────────────────

  generateApiKey() {
    return 'altcha_key_' + crypto.randomBytes(16).toString('hex');
  },

  /**
   * Get all users (without password hash)
   */
  getAllUsers() {
    try {
      return db.prepare(`
        SELECT id, username, full_name, role, api_key, allowed_origins, created_at, updated_at
        FROM users
        ORDER BY id ASC
      `).all() || [];
    } catch (err) {
      console.error('[Database] Error fetching all users:', err.message);
      return [];
    }
  },

  /**
   * Get user by ID (without password hash)
   */
  getUserById(id) {
    try {
      return db.prepare(`
        SELECT id, username, full_name, role, api_key, allowed_origins, created_at, updated_at
        FROM users WHERE id = ?
      `).get(id) || null;
    } catch (err) {
      console.error('[Database] Error fetching user by id:', err.message);
      return null;
    }
  },

  /**
   * Get a user record by username (includes password_hash for authentication)
   */
  getUserByUsername(username) {
    try {
      return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) || null;
    } catch (err) {
      console.error('[Database] Error fetching user:', err.message);
      return null;
    }
  },

  /**
   * Get user by API Key
   */
  getUserByApiKey(apiKey) {
    try {
      if (!apiKey) return null;
      return db.prepare(`
        SELECT id, username, full_name, role, api_key, allowed_origins, created_at, updated_at
        FROM users WHERE api_key = ?
      `).get(apiKey) || null;
    } catch (err) {
      console.error('[Database] Error fetching user by apiKey:', err.message);
      return null;
    }
  },

  /**
   * Create a new user
   */
  createUser({ username, password, role = 'user', apiKey = null, fullName = '', allowedOrigins = null }) {
    try {
      const now = new Date().toISOString();
      const passwordHash = bcrypt.hashSync(password, 12);
      const key = apiKey || this.generateApiKey();
      const userRole = role === 'administrator' ? 'administrator' : 'user';
      const cleanFullName = (fullName || '').trim();
      const originsJson = Array.isArray(allowedOrigins) && allowedOrigins.length > 0
        ? JSON.stringify(allowedOrigins.map(o => o.trim()).filter(Boolean))
        : null;

      const stmt = db.prepare(`
        INSERT INTO users (username, full_name, password_hash, role, api_key, allowed_origins, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const res = stmt.run(username.trim(), cleanFullName, passwordHash, userRole, key, originsJson, now, now);
      return {
        id: Number(res.lastInsertRowid),
        username: username.trim(),
        full_name: cleanFullName,
        role: userRole,
        api_key: key,
        allowed_origins: originsJson,
        created_at: now,
        updated_at: now
      };
    } catch (err) {
      console.error('[Database] Error creating user:', err.message);
      throw err;
    }
  },

  /**
   * Update a user's details
   */
  updateUser(id, { username, password, role, apiKey, fullName, allowedOrigins }) {
    try {
      const existing = this.getUserById(id);
      if (!existing) return null;

      const now = new Date().toISOString();
      const fields = [];
      const values = [];

      if (username && username.trim()) {
        fields.push('username = ?');
        values.push(username.trim());
      }
      if (fullName !== undefined) {
        fields.push('full_name = ?');
        values.push((fullName || '').trim());
      }
      if (password && password.trim()) {
        fields.push('password_hash = ?');
        values.push(bcrypt.hashSync(password.trim(), 12));
      }
      if (role) {
        fields.push('role = ?');
        values.push(role === 'administrator' ? 'administrator' : 'user');
      }
      if (apiKey !== undefined) {
        fields.push('api_key = ?');
        values.push(apiKey);
      }
      if (allowedOrigins !== undefined) {
        fields.push('allowed_origins = ?');
        const originsJson = Array.isArray(allowedOrigins) && allowedOrigins.length > 0
          ? JSON.stringify(allowedOrigins.map(o => o.trim()).filter(Boolean))
          : null;
        values.push(originsJson);
      }

      fields.push('updated_at = ?');
      values.push(now);

      values.push(id);

      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return this.getUserById(id);
    } catch (err) {
      console.error('[Database] Error updating user:', err.message);
      throw err;
    }
  },

  /**
   * Regenerate API key for a user
   */
  regenerateUserApiKey(id) {
    try {
      const newKey = this.generateApiKey();
      return this.updateUser(id, { apiKey: newKey });
    } catch (err) {
      console.error('[Database] Error regenerating apiKey:', err.message);
      throw err;
    }
  },

  /**
   * Delete a user by ID
   */
  deleteUser(id) {
    try {
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
      const res = db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
      return (res.changes || 0) > 0;
    } catch (err) {
      console.error('[Database] Error deleting user:', err.message);
      return false;
    }
  },

  /**
   * Update password hash for a user
   */
  updatePassword(username, passwordHash) {
    try {
      db.prepare(
        `UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?`
      ).run(passwordHash, new Date().toISOString(), username);
      return true;
    } catch (err) {
      console.error('[Database] Error updating password:', err.message);
      return false;
    }
  },

  // ──────────────────────────────────────────
  // Auth — Sessions
  // ──────────────────────────────────────────

  /**
   * Create a new session token for a user
   * @param {number} userId
   * @param {number} ttlHours - session lifetime in hours
   * @returns {string} session token
   */
  createSession(userId, ttlHours = 8) {
    try {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
      ).run(token, userId, expiresAt, createdAt);
      return token;
    } catch (err) {
      console.error('[Database] Error creating session:', err.message);
      return null;
    }
  },

  /**
   * Validate a session token; returns { id, username, role, apiKey } or null if invalid/expired
   */
  getSession(token) {
    try {
      if (!token) return null;
      const row = db.prepare(`
        SELECT s.token, s.expires_at, u.id, u.username, u.full_name, u.role, u.api_key, u.allowed_origins
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
      `).get(token);
      if (!row) return null;
      if (new Date(row.expires_at) < new Date()) {
        // Expired — delete it
        this.deleteSession(token);
        return null;
      }

      let allowedOrigins = null;
      if (row.allowed_origins) {
        try { allowedOrigins = JSON.parse(row.allowed_origins); } catch { allowedOrigins = null; }
      }

      return {
        id: row.id,
        username: row.username,
        fullName: row.full_name || '',
        role: row.role || 'user',
        apiKey: row.api_key,
        allowedOrigins
      };
    } catch (err) {
      console.error('[Database] Error fetching session:', err.message);
      return null;
    }
  },

  /**
   * Delete a session (logout)
   */
  deleteSession(token) {
    try {
      db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
      return true;
    } catch (err) {
      console.error('[Database] Error deleting session:', err.message);
      return false;
    }
  },

  /**
   * Delete all expired sessions (call periodically for housekeeping)
   */
  cleanExpiredSessions() {
    try {
      const result = db.prepare(
        `DELETE FROM sessions WHERE expires_at < ?`
      ).run(new Date().toISOString());
      return result.changes || 0;
    } catch (err) {
      console.error('[Database] Error cleaning sessions:', err.message);
      return 0;
    }
  },

  /**
   * Ensure database schemas, default settings, and admin account are populated
   */
  ensureInitialized() {
    try {
      initMainSchema();
      initLogSchema();
      seedDefaultSettings();
      seedDefaultAdmin();
      return true;
    } catch (err) {
      console.error('[Database] Failed to ensure database initialization:', err.message);
      return false;
    }
  },
};

export default SentinelDB;
