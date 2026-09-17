/**
 * Database Reset Utility for ALTCHA Self-Hosted
 * Resets users, sessions, settings, and logs back to default initial state.
 */

import { SentinelDB } from './database.js';

console.log('[Reset] Starting database reset...');

try {
  const db = SentinelDB.db;
  const logDb = SentinelDB.logDb;

  // 1. Clear sessions
  db.exec('DELETE FROM sessions;');

  // 2. Clear users & reset auto-increment sequence
  db.exec('DELETE FROM users;');
  try {
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users', 'sessions');");
  } catch {}

  // 3. Clear app settings
  db.exec('DELETE FROM app_settings;');

  // 4. Clear access logs & sequence
  logDb.exec('DELETE FROM access_logs;');
  try {
    logDb.exec("DELETE FROM sqlite_sequence WHERE name = 'access_logs';");
  } catch {}

  // 5. Re-run initial seeding (default admin & settings)
  SentinelDB.ensureInitialized();

  // 6. Vacuum both databases to reclaim disk space
  db.exec('VACUUM;');
  logDb.exec('VACUUM;');

  console.log('[Reset] Database reset successfully completed!');
  console.log('[Reset] Administrator account re-initialized.');
} catch (err) {
  console.error('[Reset Error] Failed to reset database:', err);
  process.exit(1);
}
