# Database migrations

These migrations are **additive only**. There is no `DROP`, `TRUNCATE`,
`DELETE` or `UPDATE` in any file here, so nothing in this directory can delete
your tables or user data.

## Why you must inspect first

You already created `users`, `sessions` and `app_settings` by hand. A
hand-created table will not match the baseline exactly, and `CREATE TABLE IF
NOT EXISTS` silently skips a table that already exists. So the baseline alone
cannot repair column drift — that is what `0002_additive_columns.sql` is for.

## Step 0 — back up (recommended, always safe)

```bash
npx wrangler d1 export <database-name> --remote --output backup-before-p1.sql
```

## Step 1 — inspect the real schemas

```bash
npx wrangler d1 execute <database-name> --remote --command "PRAGMA table_info(users);"
npx wrangler d1 execute <database-name> --remote --command "PRAGMA table_info(sessions);"
npx wrangler d1 execute <database-name> --remote --command "PRAGMA table_info(app_settings);"
```

Also confirm the table list and any existing indexes:

```bash
npx wrangler d1 execute <database-name> --remote --command "SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY name;"
```

## Step 2 — apply the baseline

```bash
npx wrangler d1 execute <database-name> --remote --file migrations/0001_baseline_auth_tables.sql
```

Expected on an existing database: **no changes**. Every statement is
`IF NOT EXISTS`, so it is a no-op for tables that already exist. It creates
anything genuinely missing (for example the indexes).

## Step 3 — reconcile columns

Open `0002_additive_columns.sql`, compare the commented statements against the
`PRAGMA table_info` output from step 1, and run **only** the statements for
columns that are missing:

```bash
npx wrangler d1 execute <database-name> --remote --command "ALTER TABLE users ADD COLUMN pro_expires_at INTEGER;"
```

Do not re-run a statement whose column already exists — SQLite returns
`duplicate column name`. That is an error, not data loss; nothing is dropped.

## Step 4 — verify

```bash
# The three columns the auth code needs beyond the basics:
npx wrangler d1 execute <database-name> --remote --command "PRAGMA table_info(users);"
npx wrangler d1 execute <database-name> --remote --command "PRAGMA table_info(sessions);"

# Row counts must be unchanged from before you started:
npx wrangler d1 execute <database-name> --remote --command "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM sessions) AS sessions;"
```

## Step 3b — signals, usage and diagnostics (`0003`)

```bash
npx wrangler d1 execute <database-name> --remote --file migrations/0003_signals_and_limits.sql
```

This file is entirely `CREATE ... IF NOT EXISTS`, so it is safe and idempotent
on an existing database. It does not touch `users`, `sessions` or
`app_settings`, so it cannot alter a plan, role or account status. It adds:

| Object | Purpose |
| --- | --- |
| `signals` | one row per generated signal, plus `counted` for rolling quota |
| `usage_events` | quota reservations before provider spend |
| `api_errors` | server-side error log surfaced to the owner dashboard |
| `rate_limits` | D1-backed fixed-window counters |

## What the code requires at minimum

| Table | Required columns |
| --- | --- |
| `users` | `google_sub` (unique/PK), `email` |
| `sessions` | `token_hash` (unique/PK), `google_sub`, `expires_at` |

Everything else (`name`, `picture`, `role`, `plan`, `status`,
`pro_expires_at`, `created_at`, `last_login_at`, `updated_at`) is normalised in
JavaScript with defaults in `functions/_utils/auth.js` → `buildUser()`, so a
missing optional column degrades to a sensible default instead of throwing.

## Why there is no foreign key on `sessions.google_sub`

`ON DELETE CASCADE` from `sessions` to `users` would be correct in a fresh
database, but adding it to a table that already exists requires a full table
rebuild. Existing rows may also contain orphaned sessions. The auth code
already joins on `google_sub` and returns `null` when there is no matching
user, so integrity is enforced in code rather than by a destructive rebuild.
