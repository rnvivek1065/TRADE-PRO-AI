/**
 * TRADE PRO AI — backend integration tests.
 *
 * These run the REAL Pages Functions handlers against a REAL SQLite database
 * built from the repository's own migrations, through a small D1 shim
 * (tests/helpers/d1.mjs). Provider HTTP calls are stubbed because no
 * LIVE_RATES_API_KEY exists in this environment.
 *
 * Verified here: routing, session auth, deactivation, CSRF, input validation,
 * rolling quota, refunds, persistence, error mapping, response shapes and
 * migration safety.
 *
 * NOT verified here: the live Live-Rates service, Cloudflare D1 itself, and
 * Google OAuth against Google's servers. Those need real credentials and are
 * reported as untested rather than assumed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

import { D1Shim } from "./helpers/d1.mjs";
import { clearCache } from "../functions/_utils/provider.js";
import { MARKET_IDS, listInstruments } from "../functions/_utils/markets.js";
import { getUsage, reserveSignal, finalizeSignal } from "../functions/_utils/quota.js";

import { onRequestGet as healthGet } from "../functions/api/health.js";
import { onRequestGet as usageGet } from "../functions/api/usage.js";
import { onRequestGet as candlesGet } from "../functions/api/candles.js";
import { onRequestPost as signalPost } from "../functions/api/signal.js";
import {
  onRequestGet as ownerUsersGet,
  onRequestPost as ownerUsersPost
} from "../functions/api/owner/users.js";
import { onRequestGet as ownerOverviewGet } from "../functions/api/owner/overview.js";
import { onRequestGet as ownerSignalsGet } from "../functions/api/owner/signals.js";

/* ------------------------------------------------------------------ setup */

const OWNER_EMAIL = "rnvivek1065@gmail.com";
const API_KEY = "test-live-rates-key-never-logged";
const SESSION_SECRET = "test-session-secret-0123456789abcdef";
const GOOGLE_SECRET = "test-google-client-secret";
const ORIGIN = "https://example.com";

const MIGRATIONS = [
  "0001_baseline_auth_tables.sql",
  "0002_additive_columns.sql",
  "0003_signals_and_limits.sql"
];

function migrationSql(name) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "tradepro-test-"));
  const db = new D1Shim(join(dir, "test.db"));
  db.enableWal();
  for (const name of MIGRATIONS) db.exec(migrationSql(name));
  return db;
}

function makeEnv(db) {
  return {
    DB: db,
    LIVE_RATES_API_KEY: API_KEY,
    SESSION_SECRET,
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
    GOOGLE_REDIRECT_URI: `${ORIGIN}/api/auth/callback`,
    OWNER_EMAIL
  };
}

let subCounter = 0;

function seedUser(db, options = {}) {
  subCounter += 1;

  const user = {
    sub: options.sub ?? `google-sub-${subCounter}`,
    email: options.email ?? `user${subCounter}@example.com`,
    plan: options.plan ?? "basic",
    role: options.role ?? "user",
    status: options.status ?? "active",
    proExpiresAt: options.proExpiresAt ?? null
  };

  db.query(
    `INSERT INTO users (google_sub, email, name, picture, role, plan, status, pro_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.sub,
      user.email,
      options.name ?? "Test User",
      "",
      user.role,
      user.plan,
      user.status,
      user.proExpiresAt,
      new Date().toISOString()
    ]
  );

  return user;
}

function seedSession(db, googleSub) {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");

  db.query(
    `INSERT INTO sessions (token_hash, google_sub, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
    [hash, googleSub, new Date(Date.now() + 7 * 86400000).toISOString(), new Date().toISOString()]
  );

  return token;
}

function request(path, options = {}) {
  const {
    method = "GET",
    token = null,
    body = undefined,
    origin = ORIGIN,
    contentType = "application/json"
  } = options;

  const headers = new Headers({ Host: "example.com" });

  if (token) headers.set("Cookie", `tradepro_session=${token}`);
  if (origin !== null) headers.set("Origin", origin);
  if (body !== undefined) headers.set("Content-Type", contentType);

  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function call(handler, path, options = {}) {
  const env = options.env;
  const res = await handler({ request: request(path, options), env });

  const text = await res.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { res, status: res.status, json, text, body: payload(json) };
}

/** Tolerates both `{...data}` and `{ok:true, data:{...}}` response envelopes. */
function payload(json) {
  if (json && typeof json === "object" && json.data && typeof json.data === "object") {
    return json.data;
  }
  return json;
}

function errCode(json) {
  return json?.error?.code ?? json?.code ?? null;
}

/* --------------------------------------------------------- provider stubs */

function providerResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Stubs Live-Rates using the documented payload shapes:
 * quotes are STRING fields with an epoch-millisecond timestamp string, and
 * history is a list of {date, <quoteCurrency>: "<price>"} rows.
 *
 * The generated prices are deterministic test fixtures — they exist only to
 * drive the real parser and engine. They are never presented as market data.
 */
function stubProvider(options = {}) {
  const { mode = "trend", outage = false } = options;

  globalThis.fetch = async input => {
    if (outage) throw new TypeError("provider unreachable");

    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/rates")) {
      return providerResponse([
        { currency: "EURUSD" },
        { currency: "BTCUSD" },
        { currency: "XAUUSD" }
      ]);
    }

    if (url.pathname.endsWith("/api/price")) {
      const symbols = String(url.searchParams.get("rate") ?? "EURUSD").split(",");
      return providerResponse(
        symbols.map(symbol => ({
          currency: symbol,
          rate: "1.1000",
          bid: "1.0999",
          ask: "1.1001",
          open: "1.0950",
          high: "1.1050",
          low: "1.0900",
          close: "1.1000",
          timestamp: String(Date.now())
        }))
      );
    }

    if (url.pathname.includes("/historical/series")) {
      if (mode === "empty") return providerResponse([]);

      const start = Date.parse(`${url.searchParams.get("start")}T00:00:00Z`);
      const end = Date.parse(`${url.searchParams.get("end")}T00:00:00Z`);
      const quotes = String(url.searchParams.get("symbols") ?? "USD").split(",");

      const rows = [];
      let time = start;
      let step = 0;

      while (time <= end) {
        const price = mode === "flat" ? "1.1000" : (1 + step * 0.002).toFixed(4);
        const row = { date: new Date(time).toISOString().slice(0, 10) };
        for (const quote of quotes) row[quote] = price;
        rows.push(row);
        time += 86400000;
        step += 1;
      }

      return providerResponse(rows);
    }

    return providerResponse([]);
  };
}

function restoreFetch() {
  delete globalThis.fetch;
}

/** First catalogue instrument that has provider history and a base/quote code. */
function pickInstrument() {
  for (const marketId of MARKET_IDS) {
    for (const instrument of listInstruments(marketId)) {
      const symbol = String(instrument.symbol ?? "");
      if (instrument.history !== false && /^[A-Z]{6}$/.test(symbol)) {
        return { market: marketId, symbol, instrument };
      }
    }
  }

  throw new Error("No instrument with historical data found in the catalogue.");
}

const PICK = pickInstrument();

function signalBody(overrides = {}) {
  return { market: PICK.market, symbol: PICK.symbol, timeframe: "1d", ...overrides };
}

/* ------------------------------------------------------------------ tests */

test("health endpoint reports status without exposing secrets", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const { status, text, body } = await call(healthGet, "/api/health", { env });

  assert.equal(status, 200);
  assert.equal(body.databaseConfigured, true);
  assert.equal(body.databaseConnected, true);
  assert.equal(body.providerConfigured, true);
  assert.equal(body.provider.reachable, true);

  assert.ok(!text.includes(API_KEY), "health response leaked the provider key");
  assert.ok(!text.includes(SESSION_SECRET), "health response leaked the session secret");

  restoreFetch();
});

test("unauthenticated requests are rejected", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const usage = await call(usageGet, "/api/usage", { env });
  assert.equal(usage.status, 401);

  const owner = await call(ownerUsersGet, "/api/owner/users", { env });
  assert.equal(owner.status, 401);

  restoreFetch();
});

test("deactivated accounts lose access immediately", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db, { status: "inactive" });
  const token = seedSession(db, user.sub);

  const { status } = await call(usageGet, "/api/usage", { env, token });
  assert.equal(status, 401);

  restoreFetch();
});

test("basic plan allows exactly 5 signals in a rolling 24h, then returns 429", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db, { plan: "basic" });
  const token = seedSession(db, user.sub);

  let charged = 0;

  for (let i = 0; i < 5; i += 1) {
    clearCache();
    const result = await call(signalPost, "/api/signal", {
      env,
      token,
      method: "POST",
      body: signalBody()
    });

    assert.equal(result.status, 200, `signal ${i + 1} failed: ${result.text}`);
    assert.equal(result.body.charged, true);
    charged += 1;
  }

  assert.equal(charged, 5);

  clearCache();
  const blocked = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    body: signalBody()
  });

  assert.equal(blocked.status, 429);
  assert.equal(errCode(blocked.json), "quota_exceeded");
  assert.equal(blocked.body.usage.used, 5);
  assert.equal(blocked.body.usage.remaining, 0);
  assert.ok(blocked.body.usage.resetAt, "429 must include the next reset time");
  assert.ok(blocked.res.headers.get("Retry-After"), "429 must include Retry-After");

  restoreFetch();
});

test("concurrent signal requests cannot exceed the basic limit", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db, { plan: "basic" });
  const token = seedSession(db, user.sub);

  // The quota slot is claimed by a single conditional INSERT, so no two
  // requests can both observe the last free slot.
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      call(signalPost, "/api/signal", { env, token, method: "POST", body: signalBody() })
    )
  );

  const charged = attempts.filter(attempt => attempt.body?.charged === true).length;
  const rejected = attempts.filter(attempt => attempt.status === 429).length;

  assert.equal(charged, 5, "exactly 5 signals may be charged");
  assert.equal(rejected, 3, "the remaining requests must be rejected with 429");

  const usage = await call(usageGet, "/api/usage", { env, token });
  assert.equal(usage.body.usage.used, 5);

  restoreFetch();
});

test("pro plan is unlimited while active", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db, {
    plan: "pro",
    proExpiresAt: Date.now() + 30 * 86400000
  });
  const token = seedSession(db, user.sub);

  for (let i = 0; i < 8; i += 1) {
    clearCache();
    const result = await call(signalPost, "/api/signal", {
      env,
      token,
      method: "POST",
      body: signalBody()
    });

    assert.equal(result.status, 200, `pro signal ${i + 1} failed: ${result.text}`);
    assert.equal(result.body.charged, true);
  }

  const usage = await call(usageGet, "/api/usage", { env, token });
  assert.equal(usage.body.usage.unlimited, true);
  assert.equal(usage.body.usage.plan, "pro");
  assert.equal(usage.body.usage.used, 8);

  restoreFetch();
});

test("expired pro is automatically treated as basic", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db, {
    plan: "pro",
    proExpiresAt: Date.now() - 86400000
  });
  const token = seedSession(db, user.sub);

  const usage = await call(usageGet, "/api/usage", { env, token });
  assert.equal(usage.body.usage.plan, "basic");
  assert.equal(usage.body.usage.unlimited, false);
  assert.equal(usage.body.user.proExpired, true);

  restoreFetch();
});

test("null pro expiry means lifetime pro", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db, { plan: "pro", proExpiresAt: null });
  const token = seedSession(db, user.sub);

  const usage = await call(usageGet, "/api/usage", { env, token });
  assert.equal(usage.body.usage.plan, "pro");
  assert.equal(usage.body.usage.unlimited, true);

  restoreFetch();
});

test("owner is never restricted by customer quotas", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const owner = seedUser(db, { email: OWNER_EMAIL, plan: "basic" });
  const token = seedSession(db, owner.sub);

  for (let i = 0; i < 7; i += 1) {
    clearCache();
    const result = await call(signalPost, "/api/signal", {
      env,
      token,
      method: "POST",
      body: signalBody()
    });

    assert.equal(result.status, 200, `owner signal ${i + 1} blocked: ${result.text}`);
  }

  const usage = await call(usageGet, "/api/usage", { env, token });
  assert.equal(usage.body.usage.unlimited, true);
  assert.equal(usage.body.user.isOwner, true);

  restoreFetch();
});

test("CSRF: cross-origin and non-JSON state changes are rejected", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db);
  const token = seedSession(db, user.sub);

  const crossSite = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    origin: "https://attacker.example",
    body: signalBody()
  });
  assert.equal(crossSite.status, 403);
  assert.equal(errCode(crossSite.json), "csrf_origin_mismatch");

  const noOrigin = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    origin: null,
    body: signalBody()
  });
  assert.equal(noOrigin.status, 403);

  const formPost = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: "market=forex"
  });
  assert.equal(formPost.status, 415);

  // No quota may be consumed by a rejected request.
  const usage = await call(usageGet, "/api/usage", { env, token });
  assert.equal(usage.body.usage.used, 0);

  restoreFetch();
});

test("invalid and excluded instruments are rejected", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db);
  const token = seedSession(db, user.sub);

  const unknown = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    body: signalBody({ symbol: "NIFTY50" })
  });
  assert.equal(unknown.status, 400);
  assert.equal(errCode(unknown.json), "invalid_instrument");

  const wrongMarket = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    body: signalBody({ market: "crypto" })
  });
  assert.equal(wrongMarket.status, 400);
  assert.equal(errCode(wrongMarket.json), "invalid_instrument");

  const usage = await call(usageGet, "/api/usage", { env, token });
  assert.equal(usage.body.usage.used, 0);

  restoreFetch();
});

test("unsupported intraday timeframes are refused with a reason, not simulated", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db);
  const token = seedSession(db, user.sub);

  const result = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    body: signalBody({ timeframe: "5m" })
  });

  assert.equal(result.status, 400);
  assert.equal(errCode(result.json), "timeframe_unavailable");

  const candles = await call(
    candlesGet,
    `/api/candles?market=${PICK.market}&symbol=${PICK.symbol}&timeframe=5m`,
    { env, token }
  );
  assert.equal(candles.status, 400);
  assert.equal(errCode(candles.json), "timeframe_unavailable");

  restoreFetch();
});

test("missing provider history refunds the quota and charges nothing", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider({ mode: "empty" });

  const user = seedUser(db);
  const token = seedSession(db, user.sub);

  const result = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    body: signalBody()
  });

  assert.ok(result.status >= 400, "empty provider data must not yield a signal");
  assert.notEqual(result.body?.charged, true);

  const usage = await call(usageGet, "/api/usage", { env, token });
  assert.equal(usage.body.usage.used, 0, "a failed signal must not consume quota");

  restoreFetch();
});

test("provider outage refunds the quota and returns a safe error", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider({ outage: true });

  const user = seedUser(db);
  const token = seedSession(db, user.sub);

  const result = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    body: signalBody()
  });

  assert.ok([502, 503, 504].includes(result.status), `unexpected status ${result.status}`);
  assert.ok(!result.text.includes(API_KEY), "error response leaked the provider key");
  assert.ok(!/at\s+\w+\s+\(/.test(result.text), "error response leaked a stack trace");

  const usage = await call(usageGet, "/api/usage", { env, token });
  assert.equal(usage.body.usage.used, 0);

  restoreFetch();
});

test("signal output is complete and deterministic", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db, { plan: "pro" });
  const token = seedSession(db, user.sub);

  const first = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    body: signalBody()
  });

  assert.equal(first.status, 200, first.text);

  const signal = first.body.signal;

  assert.ok(["BUY", "SELL", "WAIT"].includes(signal.action));
  assert.equal(signal.dataAvailable, true);
  assert.equal(signal.timeframe, "1d");
  assert.ok(signal.instrument);
  assert.ok(signal.explanation);

  if (signal.action !== "WAIT") {
    assert.ok(Number.isFinite(signal.entry), "a directional signal needs an entry");
    assert.ok(Number.isFinite(signal.stopLoss), "a directional signal needs a stop-loss");
    assert.ok(Number.isFinite(signal.takeProfit), "a directional signal needs a take-profit");
  }

  const second = await call(signalPost, "/api/signal", {
    env,
    token,
    method: "POST",
    body: signalBody()
  });

  assert.equal(second.status, 200, second.text);
  assert.deepEqual(
    {
      action: second.body.signal.action,
      entry: second.body.signal.entry,
      stopLoss: second.body.signal.stopLoss,
      takeProfit: second.body.signal.takeProfit
    },
    {
      action: signal.action,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit
    },
    "the engine must be deterministic for identical input"
  );

  restoreFetch();
});

test("candles expose only provider fields — no fabricated OHLC or volume", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db);
  const token = seedSession(db, user.sub);

  const result = await call(
    candlesGet,
    `/api/candles?market=${PICK.market}&symbol=${PICK.symbol}&timeframe=1d`,
    { env, token }
  );

  assert.equal(result.status, 200, result.text);
  assert.deepEqual(result.body.fields, ["t", "close"]);
  assert.ok(result.body.candles.length > 0);

  for (const candle of result.body.candles) {
    assert.deepEqual(Object.keys(candle).sort(), ["close", "t"]);
    assert.ok(Number.isFinite(candle.close));
    assert.ok(Number.isFinite(candle.t));
  }

  restoreFetch();
});

test("rolling 24h window is measured from each signal, not calendar midnight", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const seeded = seedUser(db, { plan: "basic" });

  const user = {
    googleSub: seeded.sub,
    email: seeded.email,
    plan: "basic",
    storedPlan: "basic",
    isOwner: false,
    status: "active",
    proExpiresAt: null,
    proExpired: false,
    role: "user"
  };

  const draft = {
    market: PICK.market,
    instrument: PICK.instrument.id,
    timeframe: "1d",
    action: "BUY",
    dataSource: "live-rates"
  };

  const result = {
    action: "BUY",
    entry: 1,
    stopLoss: 0.99,
    takeProfit: 1.02,
    riskReward: 2,
    confidence: 0.5
  };

  // One signal 25 hours ago: outside the window, must not count.
  const old = await reserveSignal(env, user, draft, Date.now() - 25 * 3600 * 1000);
  assert.equal(old.allowed, true);
  await finalizeSignal(env, old.id, result);

  // One signal 23 hours ago: inside the window, must count.
  const recent = await reserveSignal(env, user, draft, Date.now() - 23 * 3600 * 1000);
  assert.equal(recent.allowed, true);
  await finalizeSignal(env, recent.id, result);

  const usage = await getUsage(env, user);

  assert.equal(usage.used, 1, "only the signal inside 24h may count");
  assert.equal(usage.remaining, 4);
  assert.ok(usage.resetAt);
  assert.ok(Date.parse(usage.resetAt) > Date.now());

  restoreFetch();
});

test("owner endpoints reject normal users", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db);
  const token = seedSession(db, user.sub);

  const list = await call(ownerUsersGet, "/api/owner/users", { env, token });
  assert.equal(list.status, 403);

  const overview = await call(ownerOverviewGet, "/api/owner/overview", { env, token });
  assert.equal(overview.status, 403);

  const signals = await call(ownerSignalsGet, "/api/owner/signals", { env, token });
  assert.equal(signals.status, 403);

  const mutate = await call(ownerUsersPost, "/api/owner/users", {
    env,
    token,
    method: "POST",
    body: { action: "grant_lifetime_pro", googleSub: user.sub }
  });
  assert.equal(mutate.status, 403);

  restoreFetch();
});

test("owner can deactivate, reactivate and manage plans and expiry", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const owner = seedUser(db, { email: OWNER_EMAIL });
  const ownerToken = seedSession(db, owner.sub);

  const target = seedUser(db, { plan: "basic" });
  const targetToken = seedSession(db, target.sub);

  const list = await call(ownerUsersGet, "/api/owner/users", { env, token: ownerToken });
  assert.equal(list.status, 200, list.text);
  assert.ok(list.body.total >= 2);
  assert.ok(list.body.users.some(row => row.googleSub === target.sub));

  const search = await call(
    ownerUsersGet,
    `/api/owner/users?q=${encodeURIComponent(target.email)}`,
    { env, token: ownerToken }
  );
  assert.equal(search.status, 200);
  assert.equal(search.body.users.length, 1);

  const deactivate = await call(ownerUsersPost, "/api/owner/users", {
    env,
    token: ownerToken,
    method: "POST",
    body: { action: "deactivate", googleSub: target.sub }
  });
  assert.equal(deactivate.status, 200, deactivate.text);
  assert.equal(deactivate.body.user.status, "inactive");

  // Deactivation kills the live session immediately.
  const blocked = await call(usageGet, "/api/usage", { env, token: targetToken });
  assert.equal(blocked.status, 401);

  const reactivate = await call(ownerUsersPost, "/api/owner/users", {
    env,
    token: ownerToken,
    method: "POST",
    body: { action: "activate", googleSub: target.sub }
  });
  assert.equal(reactivate.status, 200, reactivate.text);
  assert.equal(reactivate.body.user.status, "active");

  const newToken = seedSession(db, target.sub);
  const allowed = await call(usageGet, "/api/usage", { env, token: newToken });
  assert.equal(allowed.status, 200);

  // Assign Pro with a future expiry.
  const future = new Date(Date.now() + 7 * 86400000).toISOString();

  const pro = await call(ownerUsersPost, "/api/owner/users", {
    env,
    token: ownerToken,
    method: "POST",
    body: { action: "set_plan", googleSub: target.sub, plan: "pro" }
  });
  assert.equal(pro.status, 200, pro.text);
  assert.equal(pro.body.user.effectivePlan, "pro");

  const expiry = await call(ownerUsersPost, "/api/owner/users", {
    env,
    token: ownerToken,
    method: "POST",
    body: { action: "set_expiry", googleSub: target.sub, proExpiresAt: future }
  });
  assert.equal(expiry.status, 200, expiry.text);
  assert.equal(expiry.body.user.effectivePlan, "pro");
  assert.equal(expiry.body.user.proExpired, false);

  // Expire it: the user must be downgraded automatically.
  const past = await call(ownerUsersPost, "/api/owner/users", {
    env,
    token: ownerToken,
    method: "POST",
    body: { action: "set_expiry", googleSub: target.sub, proExpiresAt: "2020-01-01T00:00:00Z" }
  });
  assert.equal(past.status, 200, past.text);
  assert.equal(past.body.user.effectivePlan, "basic");
  assert.equal(past.body.user.proExpired, true);

  // Lifetime Pro clears the expiry.
  const lifetime = await call(ownerUsersPost, "/api/owner/users", {
    env,
    token: ownerToken,
    method: "POST",
    body: { action: "grant_lifetime_pro", googleSub: target.sub }
  });
  assert.equal(lifetime.status, 200, lifetime.text);
  assert.equal(lifetime.body.user.effectivePlan, "pro");
  assert.equal(lifetime.body.user.lifetimePro, true);
  assert.equal(lifetime.body.user.proExpiresAt, null);

  restoreFetch();
});

test("owner cannot deactivate or demote their own account", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const owner = seedUser(db, { email: OWNER_EMAIL });
  const token = seedSession(db, owner.sub);

  const selfDeactivate = await call(ownerUsersPost, "/api/owner/users", {
    env,
    token,
    method: "POST",
    body: { action: "deactivate", googleSub: owner.sub }
  });
  assert.equal(selfDeactivate.status, 409);

  const selfDemote = await call(ownerUsersPost, "/api/owner/users", {
    env,
    token,
    method: "POST",
    body: { action: "set_plan", googleSub: owner.sub, plan: "basic" }
  });
  assert.equal(selfDemote.status, 409);

  const stillOwner = await call(usageGet, "/api/usage", { env, token });
  assert.equal(stillOwner.status, 200);
  assert.equal(stillOwner.body.user.isOwner, true);

  restoreFetch();
});

test("owner overview and signal history are available and secret-free", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const owner = seedUser(db, { email: OWNER_EMAIL });
  const token = seedSession(db, owner.sub);

  const customer = seedUser(db, { plan: "pro" });
  const customerToken = seedSession(db, customer.sub);

  const signal = await call(signalPost, "/api/signal", {
    env,
    token: customerToken,
    method: "POST",
    body: signalBody()
  });
  assert.equal(signal.status, 200, signal.text);

  const overview = await call(ownerOverviewGet, "/api/owner/overview", { env, token });
  assert.equal(overview.status, 200, overview.text);
  assert.ok(overview.body.accounts.total >= 2);
  assert.equal(overview.body.signals.total, 1);
  assert.equal(overview.body.configuration.liveRatesApiKey, true);
  assert.equal(overview.body.configuration.secretsEditableInApp, false);

  assert.ok(!overview.text.includes(API_KEY), "overview leaked the provider key");
  assert.ok(!overview.text.includes(GOOGLE_SECRET), "overview leaked the Google secret");
  assert.ok(!overview.text.includes(SESSION_SECRET), "overview leaked the session secret");

  const history = await call(ownerSignalsGet, "/api/owner/signals", { env, token });
  assert.equal(history.status, 200, history.text);
  assert.equal(history.body.signals.length, 1);
  assert.equal(history.body.signals[0].googleSub, customer.sub);

  restoreFetch();
});

test("migrations are additive, idempotent and preserve existing users", async () => {
  const db = freshDb();

  const existing = seedUser(db, { plan: "pro", email: "existing@example.com" });

  // Re-running the migration must be a no-op and must not touch user rows.
  db.exec(migrationSql("0003_signals_and_limits.sql"));
  db.exec(migrationSql("0003_signals_and_limits.sql"));

  const rows = db.query("SELECT google_sub, email, plan, status FROM users");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].google_sub, existing.sub);
  assert.equal(rows[0].plan, "pro");
  assert.equal(rows[0].status, "active");

  for (const name of MIGRATIONS) {
    const sql = migrationSql(name);

    assert.ok(!/\bDROP\s+TABLE\b/i.test(sql), `${name} must not drop tables`);
    assert.ok(!/\bTRUNCATE\b/i.test(sql), `${name} must not truncate`);
    assert.ok(!/DELETE\s+FROM\s+(users|sessions)\b/i.test(sql), `${name} must not delete users`);
  }
});

test("error responses never leak secrets or internal details", async () => {
  const db = freshDb();
  const env = makeEnv(db);
  stubProvider();

  const user = seedUser(db);
  const token = seedSession(db, user.sub);

  const responses = await Promise.all([
    call(signalPost, "/api/signal", {
      env,
      token,
      method: "POST",
      body: signalBody({ symbol: "NOTREAL" })
    }),
    call(candlesGet, "/api/candles?market=forex&symbol=EURUSD&timeframe=1m", { env, token }),
    call(ownerUsersGet, "/api/owner/users", { env, token }),
    call(signalPost, "/api/signal", { env, token, method: "POST", body: "{bad json" })
  ]);

  for (const response of responses) {
    assert.ok(response.status >= 400);
    assert.ok(!response.text.includes(API_KEY), "leaked provider key");
    assert.ok(!response.text.includes(SESSION_SECRET), "leaked session secret");
    assert.ok(!response.text.includes(GOOGLE_SECRET), "leaked Google secret");
    assert.ok(!/SELECT\s+.+\s+FROM/i.test(response.text), "leaked SQL");
  }

  restoreFetch();
});
