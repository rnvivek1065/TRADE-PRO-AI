/**
 * TRADE PRO AI — 0003 signals, usage and diagnostics
 *
 * SAFE FOR EXISTING INSTALLATIONS.
 *   * Every statement is CREATE ... IF NOT EXISTS.
 *   * There is no DROP, TRUNCATE or DELETE anywhere in this file.
 *   * No existing table (users, sessions, app_settings) is touched, so no user,
 *     plan, role or account status can be altered by running it.
 *
 * This file only ADDS new tables and indexes. It is idempotent: running it
 * twice changes nothing.
 *
 * Apply with:
 *   npx wrangler d1 execute <database-name> --remote --file migrations/0003_signals_and_limits.sql
 */

-- ---------------------------------------------------------------------------
-- signals
-- ---------------------------------------------------------------------------
-- One row per signal request.
--
--   counted = 1  the row consumes a Basic quota slot
--   counted = 0  the reservation was refunded (analysis produced no signal,
--                e.g. market data unavailable) and does not count toward usage
--
-- `created_at` is epoch MILLISECONDS so the rolling 86,400-second window is a
-- plain integer comparison with no timezone or calendar-midnight dependence.
--
-- `plan_at_request` records the effective plan at the time of the request, so
-- history stays accurate after an upgrade or an expiry.
CREATE TABLE IF NOT EXISTS signals (
  id              TEXT PRIMARY KEY,
  google_sub      TEXT NOT NULL,
  email           TEXT DEFAULT '',
  market          TEXT NOT NULL,
  instrument      TEXT NOT NULL,
  timeframe       TEXT NOT NULL,
  action          TEXT NOT NULL DEFAULT 'pending',
  entry           REAL,
  stop_loss       REAL,
  take_profit     REAL,
  risk_reward     REAL,
  confidence      REAL,
  counted         INTEGER NOT NULL DEFAULT 1,
  plan_at_request TEXT NOT NULL DEFAULT 'basic',
  data_source     TEXT DEFAULT 'live-rates',
  explanation     TEXT,
  payload         TEXT,
  created_at      INTEGER NOT NULL
);

-- Serves the rolling-window count and per-user history queries.
CREATE INDEX IF NOT EXISTS idx_signals_user_created ON signals (google_sub, created_at);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals (created_at);

-- ---------------------------------------------------------------------------
-- rate_limits
-- ---------------------------------------------------------------------------
-- Fixed-window counters for request throttling. The composite primary key is
-- what makes the incrementing UPSERT atomic and concurrency-safe.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- ---------------------------------------------------------------------------
-- app_errors
-- ---------------------------------------------------------------------------
-- Server-side error log surfaced on the owner dashboard. Messages are
-- truncated before insert and never contain credentials.
CREATE TABLE IF NOT EXISTS app_errors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT NOT NULL DEFAULT 'error',
  code       TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  path       TEXT DEFAULT '',
  google_sub TEXT DEFAULT '',
  detail     TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at);
