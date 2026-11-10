-- TRADE PRO AI — 0001 baseline auth tables
--
-- NON-DESTRUCTIVE BY DESIGN.
--   * Every statement is CREATE ... IF NOT EXISTS.
--   * There is no DROP, TRUNCATE, DELETE or UPDATE anywhere in this file.
--   * Running it against a database that already contains `users`,
--     `sessions` and `app_settings` is a no-op: existing tables and rows are
--     left untouched.
--
-- Because IF NOT EXISTS skips creation for an existing table, this file does
-- NOT add missing columns to a table you already created. Column drift is
-- handled separately by 0002_additive_columns.sql.
--
-- Apply with:
--   npx wrangler d1 execute <database-name> --remote --file migrations/0001_baseline_auth_tables.sql

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- `role` distinguishes the owner from normal customers.
-- `plan` is the plan the owner assigned ('basic' | 'pro'); the effective plan
--   is computed server-side from `plan` + `pro_expires_at` (see buildUser()).
-- `status` is 'active' | 'inactive'. 'inactive' blocks login and every
--   authenticated request.
-- `pro_expires_at` is epoch milliseconds (UTC). NULL means "no expiry set",
--   which is how the owner grants lifetime access. A past value downgrades the
--   user to 'basic' automatically without any cron job.
CREATE TABLE IF NOT EXISTS users (
  google_sub     TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT DEFAULT '',
  picture        TEXT DEFAULT '',
  role           TEXT NOT NULL DEFAULT 'user',
  plan           TEXT NOT NULL DEFAULT 'basic',
  status         TEXT NOT NULL DEFAULT 'active',
  pro_expires_at INTEGER,
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  last_login_at  TEXT
);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
-- Only the SHA-256 hash of the session token is stored, never the token.
-- `expires_at` is compared server-side on every authenticated request.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------
-- Used by functions/_utils/liveRates.js for an AES-GCM encrypted API key.
-- Nothing writes to this table yet (the owner dashboard in P5 will).
CREATE TABLE IF NOT EXISTS app_settings (
  setting_name    TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  updated_at      INTEGER
);

-- ---------------------------------------------------------------------------
-- Indexes (safe to re-run)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sessions_google_sub ON sessions (google_sub);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_users_plan ON users (plan);

-- Required for the `ON CONFLICT(google_sub)` upsert used by the OAuth
-- callback. It is skipped if the column is already a PRIMARY KEY (SQLite
-- allows the redundant index) or if this index already exists.
-- NOTE: if duplicate google_sub values already exist this statement fails
-- loudly instead of deleting data. Resolve duplicates manually, then re-run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);
