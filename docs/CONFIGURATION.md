# TRADE PRO AI — configuration

Everything here is configuration, not code. No secret values belong in this
repository; `.dev.vars` and `.dev.vars.example` hold names only and
`.dev.vars` is git-ignored.

## 1. Cloudflare Pages project

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | *(empty — there is no bundler)* |
| Build output directory | `/` (repository root) |
| Root directory | repository root |
| Production branch | `appjet` |

`wrangler.toml` already declares `pages_build_output_dir = "."`,
`compatibility_date = "2025-09-01"`, and the D1 binding.

`_routes.json` limits Pages Functions to `/api/*`; every other path is served
as a static asset.

`.assetsignore` keeps `migrations/`, `tests/`, `scripts/`, `docs/`,
`package.json` and `wrangler.toml` out of the uploaded assets so they are not
publicly downloadable.

## 2. D1 binding

`wrangler.toml` contains a placeholder:

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

Replace it with the id of your existing database (`npx wrangler d1 list`).
Keep `binding = "DB"` unchanged — `functions/_utils/auth.js`,
`functions/_utils/quota.js` and every `functions/api/**` endpoint read
`env.DB`.

Then apply migrations following `migrations/README.md`. Inspect first; the
baseline is a no-op on tables that already exist.

## 3. Environment variables

Set these in **Cloudflare dashboard → Workers & Pages → your project →
Settings → Variables and Secrets** as *encrypted* secrets. For local
development copy `.dev.vars.example` to `.dev.vars`.

| Name | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | yes | OAuth client id |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | yes | Must match Google Cloud exactly |
| `SESSION_SECRET` | yes | HMAC key for the OAuth state cookie; ≥32 random bytes |
| `LIVE_RATES_API_KEY` | yes | Live-Rates market data; read only server-side in `functions/_utils/provider.js` |
| `OWNER_EMAIL` | optional | Overrides the built-in owner address |
| `MASTER_ENCRYPTION_KEY` | optional | Only for the `app_settings` encrypted-key path |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Never commit it. Rotating `SESSION_SECRET` invalidates in-flight OAuth states
only — existing sessions use random tokens stored hashed in D1, so users stay
logged in.

## 4. Google Cloud OAuth client

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID →
   **Web application**.
2. Authorized redirect URIs — must match `GOOGLE_REDIRECT_URI` byte for byte:
   - `https://<your-domain>/api/auth/callback`
   - `http://localhost:8788/api/auth/callback` (only if using `wrangler pages dev`)
3. No JavaScript origins are needed: the flow is a full-page redirect, not a
   popup, and no Google SDK is loaded in the browser.

`functions/api/auth/google.js` uses PKCE (`S256`) with the verifier stored in
the signed, `HttpOnly` state cookie.

## 5. Local development

```bash
npm install          # no runtime dependencies; installs nothing for the site
npx wrangler d1 execute trade-pro-ai --local --file migrations/0001_baseline_auth_tables.sql
npm run dev          # wrangler pages dev . --d1 DB
```

## 6. Checks

```bash
npm run verify       # syntax check + node:test suites
```

`npm run check` parses every `.js`/`.mjs` file in the repository.
`npm test` runs the auth, OAuth-callback, migration and backend suites.
`tests/backend.test.mjs` executes the real Pages Functions handlers against a
SQLite database built from `migrations/` through `tests/helpers/d1.mjs`.

What the suite does **not** cover: the live Live-Rates service, real Cloudflare
D1, and Google's OAuth endpoints. Provider HTTP calls are stubbed because no
`LIVE_RATES_API_KEY` exists in the test environment.

## 7. Owner account

`OWNER_EMAIL` overrides the fallback owner address in
`functions/_utils/auth.js` (`ownerEmail()`). The OAuth callback marks that
account `role = 'owner'` and `plan = 'pro'` on first login.

Deactivating a user (`status = 'inactive'`) takes effect immediately: every
authenticated request re-reads `status`, and the callback now refuses to issue
a session for a deactivated account.
