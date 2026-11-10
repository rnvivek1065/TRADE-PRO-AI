import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * These tests run the real migration files against a real SQLite engine
 * (the `sqlite3` CLI), using a database that already contains hand-created
 * `users`, `sessions` and `app_settings` tables with live rows.
 *
 * The point is to prove the migrations cannot delete tables or user data.
 */

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "migrations");

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), "trade-pro-ai-"));
  const database = join(directory, "test.sqlite");

  try {
    return run(database);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function query(database, statement) {
  return execFileSync("sqlite3", [database, statement], {
    encoding: "utf8"
  }).trim();
}

function applySql(database, sql) {
  execFileSync("sqlite3", [database], { input: sql });
}

function migration(name) {
  return readFileSync(join(MIGRATIONS, name), "utf8");
}

/* A plausible hand-created schema: no pro_expires_at, no updated_at, no role
   default beyond 'user', timestamps stored as ISO text. */
const EXISTING_SCHEMA = `
  CREATE TABLE users (
    google_sub TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    picture TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    plan TEXT NOT NULL DEFAULT 'basic',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE app_settings (
    setting_name TEXT PRIMARY KEY,
    encrypted_value TEXT NOT NULL
  );

  INSERT INTO users (google_sub, email, name, plan, status, created_at)
  VALUES ('sub-existing', 'existing@example.com', 'Existing', 'pro', 'active',
          '2026-01-01T00:00:00.000Z');

  INSERT INTO sessions (token_hash, google_sub, expires_at, created_at)
  VALUES ('hash-existing', 'sub-existing', '2027-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z');

  INSERT INTO app_settings (setting_name, encrypted_value)
  VALUES ('live_rates_key', 'encrypted-blob');
`;

test("baseline migration is a no-op on existing tables and preserves rows", () => {
  withDatabase(database => {
    applySql(database, EXISTING_SCHEMA);

    assert.equal(query(database, "SELECT COUNT(*) FROM users;"), "1");
    assert.equal(query(database, "SELECT COUNT(*) FROM sessions;"), "1");

    const baseline = migration("0001_baseline_auth_tables.sql");
    applySql(database, baseline);

    // Tables and data still there.
    assert.equal(query(database, "SELECT COUNT(*) FROM users;"), "1");
    assert.equal(query(database, "SELECT COUNT(*) FROM sessions;"), "1");
    assert.equal(query(database, "SELECT COUNT(*) FROM app_settings;"), "1");

    assert.equal(
      query(database, "SELECT email || '|' || plan || '|' || status FROM users;"),
      "existing@example.com|pro|active"
    );

    assert.equal(
      query(database, "SELECT token_hash FROM sessions;"),
      "hash-existing"
    );

    // Re-running must not fail.
    applySql(database, baseline);

    assert.equal(query(database, "SELECT COUNT(*) FROM users;"), "1");
  });
});

test("baseline migration creates the schema from scratch on an empty database", () => {
  withDatabase(database => {
    applySql(database, migration("0001_baseline_auth_tables.sql"));

    const tables = query(
      database,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
    ).split("\n");

    assert.ok(tables.includes("users"));
    assert.ok(tables.includes("sessions"));
    assert.ok(tables.includes("app_settings"));

    const indexes = query(
      database,
      "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name;"
    );

    assert.match(indexes, /idx_sessions_google_sub/);
    assert.match(indexes, /idx_sessions_expires_at/);
    assert.match(indexes, /idx_users_plan/);
    assert.match(indexes, /idx_users_google_sub/);
  });
});

test("additive ALTER statements add columns without touching data", () => {
  withDatabase(database => {
    // Simulates a hand-created schema missing every column that 0002 adds.
    applySql(
      database,
      `
      CREATE TABLE users (
        google_sub TEXT PRIMARY KEY,
        email TEXT NOT NULL
      );
      INSERT INTO users (google_sub, email)
      VALUES ('s1', 'a@example.com');

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at TEXT
      );
      INSERT INTO sessions (token_hash, expires_at)
      VALUES ('h1', '2027-01-01T00:00:00.000Z');

      CREATE TABLE app_settings (
        setting_name TEXT PRIMARY KEY,
        encrypted_value TEXT NOT NULL
      );
      INSERT INTO app_settings (setting_name, encrypted_value)
      VALUES ('live_rates_key', 'blob');
      `
    );

    const statements = migration("0002_additive_columns.sql")
      .split("\n")
      .map(line => line.trim())
      .filter(line => /^--\s+(ALTER TABLE|CREATE )/i.test(line))
      .map(line => line.replace(/^--\s+/, ""));

    assert.ok(statements.length >= 10, "expected the ALTER statements to exist");

    for (const statement of statements) {
      applySql(database, statement);
    }

    const columns = query(database, "PRAGMA table_info(users);");

    assert.match(columns, /pro_expires_at/);
    assert.match(columns, /status/);
    assert.match(columns, /created_at/);
    assert.match(columns, /updated_at/);
    assert.match(columns, /last_login_at/);

    // Existing rows untouched, new columns defaulted.
    assert.equal(query(database, "SELECT COUNT(*) FROM users;"), "1");
    assert.equal(query(database, "SELECT COUNT(*) FROM sessions;"), "1");
    assert.equal(query(database, "SELECT COUNT(*) FROM app_settings;"), "1");
    assert.equal(query(database, "SELECT email FROM users;"), "a@example.com");
    assert.equal(query(database, "SELECT plan FROM users;"), "basic");
    assert.equal(query(database, "SELECT status FROM users;"), "active");
    assert.equal(query(database, "SELECT role FROM users;"), "user");
    assert.equal(
      query(database, "SELECT pro_expires_at IS NULL FROM users;"),
      "1"
    );
  });
});

test("the callback upsert preserves an existing plan and status", () => {
  withDatabase(database => {
    applySql(database, migration("0001_baseline_auth_tables.sql"));

    applySql(
      database,
      `
      INSERT INTO users (google_sub, email, name, role, plan, status, created_at)
      VALUES ('sub-1', 'user@example.com', 'Old Name', 'user', 'pro', 'active',
              '2026-01-01T00:00:00.000Z');
      `
    );

    // The same statement the callback runs on every login.
    const upsert = `
      INSERT INTO users (
        google_sub, email, name, picture, role, plan, status,
        created_at, last_login_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(google_sub) DO UPDATE SET
        email = excluded.email,
        name = excluded.name,
        picture = excluded.picture,
        last_login_at = excluded.last_login_at;
    `;

    const now = new Date().toISOString();

    // The sqlite3 CLI does not bind `?` placeholders supplied as argv, so the
    // values are inlined here. They are fixed test constants, not user input.
    const values = [
      "sub-1",
      "user@example.com",
      "New Name",
      "https://example.com/a.png",
      "user",
      "basic",
      "inactive",
      now,
      now
    ].map(value => `'${String(value).replace(/'/g, "''")}'`);

    applySql(database, upsert.replace(/\?/g, () => values.shift()));

    // Profile refreshes; the owner's manual plan and status do not.
    assert.equal(query(database, "SELECT name FROM users;"), "New Name");
    assert.equal(query(database, "SELECT plan FROM users;"), "pro");
    assert.equal(query(database, "SELECT status FROM users;"), "active");
    assert.equal(query(database, "SELECT COUNT(*) FROM users;"), "1");
  });
});

test("migrations contain no destructive statements", () => {
  for (const name of [
    "0001_baseline_auth_tables.sql",
    "0002_additive_columns.sql"
  ]) {
    const executable = migration(name)
      .split("\n")
      .filter(line => !line.trim().startsWith("--"))
      .join("\n");

    assert.doesNotMatch(executable, /\bDROP\b/i, `${name} contains DROP`);
    assert.doesNotMatch(executable, /\bTRUNCATE\b/i, `${name} contains TRUNCATE`);
    assert.doesNotMatch(executable, /\bDELETE\b/i, `${name} contains DELETE`);
    assert.doesNotMatch(executable, /\bUPDATE\b/i, `${name} contains UPDATE`);
  }
});
