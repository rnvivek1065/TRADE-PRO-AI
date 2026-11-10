import { test } from "node:test";
import assert from "node:assert/strict";

import {
  signState,
  verifyState,
  timingSafeEqualString,
  parseTime,
  buildUser,
  ownerEmail,
  getCurrentUser,
  sessionCookie,
  clearStateCookie,
  appendCookies,
  jsonWithCookies,
  json
} from "../functions/_utils/auth.js";

import { onRequestGet as callbackHandler } from "../functions/api/auth/callback.js";

const SECRET = "test-session-secret-0123456789abcdef";
const OWNER = "rnvivek1065@gmail.com";

/* ------------------------------------------------------------------ helpers */

function setCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const raw = headers.get("set-cookie") || "";
  return raw === "" ? [] : raw.split(/,(?=\s*[^;=]+=)/);
}

function requestWithToken(token) {
  return new Request("https://example.com/api/auth/me", {
    headers: token ? { Cookie: `tradepro_session=${token}` } : {}
  });
}

function mockDb(handler) {
  return {
    prepare(sql) {
      const api = {
        bind(...args) {
          return api;
        },
        async first() {
          return handler(sql);
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true };
        }
      };

      return api;
    }
  };
}

/**
 * Runs the real callback handler with Google's two endpoints stubbed.
 * Nothing about the handler itself is mocked: cookies, state verification,
 * identity checks and the response are all produced by production code.
 */
async function runCallback(options = {}) {
  const {
    identity = {},
    dbStatus = "active",
    tokenOk = true
  } = options;

  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const calls = [];
  const logged = [];

  console.error = (...args) => logged.push(args);

  const db = {
    prepare(sql) {
      const api = {
        bind(...args) {
          calls.push({ sql, args });
          return api;
        },
        async first() {
          if (/SELECT status FROM users/i.test(sql)) {
            return dbStatus === null ? null : { status: dbStatus };
          }

          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true };
        }
      };

      return api;
    }
  };

  globalThis.fetch = async url => {
    const target = String(url);

    // Order matters: the tokeninfo host path also contains ".../token".
    if (target.includes("/tokeninfo")) {
      return new Response(JSON.stringify(identity), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (target.includes("/token")) {
      return tokenOk
        ? new Response(JSON.stringify({ id_token: "fake-id-token" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        : new Response("invalid_grant", { status: 401 });
    }

    return new Response("{}", { status: 200 });
  };

  try {
    const state = "state-abc123";
    const signed = await signState(
      { state, verifier: "test-verifier", expires: Date.now() + 60000 },
      SECRET
    );

    const request = new Request(
      `https://example.com/api/auth/callback?code=test-code&state=${state}`,
      { headers: { Cookie: `tradepro_oauth_state=${signed}` } }
    );

    const response = await callbackHandler({
      request,
      env: {
        DB: db,
        SESSION_SECRET: SECRET,
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
        GOOGLE_REDIRECT_URI: "https://example.com/api/auth/callback"
      }
    });

    return { response, calls, logged };
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
}

function baseIdentity(overrides = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: "test-client-id",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    sub: "google-sub-1",
    email: "user@example.com",
    email_verified: true,
    ...overrides
  };
}

/* ------------------------------------------------------------- state tokens */

test("signed state round-trips", async () => {
  const signed = await signState(
    { state: "abc", verifier: "verifier", expires: Date.now() + 60000 },
    SECRET
  );

  const parsed = await verifyState(signed, SECRET);

  assert.equal(parsed.state, "abc");
  assert.equal(parsed.verifier, "verifier");
});

test("tampered or foreign-signed state is rejected", async () => {
  const signed = await signState(
    { state: "abc", expires: Date.now() + 60000 },
    SECRET
  );

  const [payload, signature] = signed.split(".");
  const tampered = `${payload}.${signature.slice(0, -2)}xx`;

  assert.equal(await verifyState(tampered, SECRET), null);
  assert.equal(await verifyState(signed, "a-different-secret"), null);
  assert.equal(await verifyState(signed, ""), null);
  assert.equal(await verifyState("", SECRET), null);
  assert.equal(await verifyState("not-a-token", SECRET), null);
});

test("expired state is rejected", async () => {
  const signed = await signState(
    { state: "abc", expires: Date.now() - 1000 },
    SECRET
  );

  assert.equal(await verifyState(signed, SECRET), null);
});

/* ------------------------------------------------------- constant-time equal */

test("timingSafeEqualString matches and rejects correctly", () => {
  assert.equal(timingSafeEqualString("abc", "abc"), true);
  assert.equal(timingSafeEqualString("", ""), true);
  assert.equal(timingSafeEqualString("abc", "abd"), false);
  assert.equal(timingSafeEqualString("abc", "abcd"), false);
  assert.equal(timingSafeEqualString("abcd", "abc"), false);
  assert.equal(timingSafeEqualString(null, ""), true);
});

/* ------------------------------------------------------------ time handling */

test("parseTime accepts seconds, milliseconds and ISO strings", () => {
  const expected = Date.UTC(2026, 0, 1);

  assert.equal(parseTime("2026-01-01T00:00:00.000Z"), expected);
  assert.equal(parseTime("1767225600000"), expected);
  assert.equal(parseTime(1767225600000), expected);
  assert.equal(parseTime(1767225600), expected);
  assert.equal(parseTime(null), null);
  assert.equal(parseTime(undefined), null);
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("not-a-date"), null);
});

/* -------------------------------------------------------------- buildUser */

test("Pro plan is downgraded when the subscription has expired", () => {
  const now = Date.now();
  const future = now + 86400000;
  const past = now - 86400000;

  const active = buildUser({ plan: "pro", pro_expires_at: future }, {});
  assert.equal(active.plan, "pro");
  assert.equal(active.proActive, true);
  assert.equal(active.proExpired, false);

  const expired = buildUser({ plan: "pro", pro_expires_at: past }, {});
  assert.equal(expired.plan, "basic");
  assert.equal(expired.proActive, false);
  assert.equal(expired.proExpired, true);
  assert.equal(expired.storedPlan, "pro");

  // Same instant stored as an ISO string must behave identically.
  const isoExpired = buildUser(
    { plan: "pro", pro_expires_at: new Date(past).toISOString() },
    {}
  );
  assert.equal(isoExpired.plan, "basic");

  // Pro without an expiry date stays Pro until the owner changes it.
  assert.equal(buildUser({ plan: "pro" }, {}).plan, "pro");
});

test("unknown or missing plan values fall back to basic", () => {
  assert.equal(buildUser({}, {}).plan, "basic");
  assert.equal(buildUser({ plan: null }, {}).plan, "basic");
  assert.equal(buildUser({ plan: "PRO" }, {}).plan, "pro");
  assert.equal(buildUser({ plan: "premium" }, {}).plan, "basic");
});

test("owner is identified by email and keeps its stored plan", () => {
  assert.equal(buildUser({ email: OWNER }, {}).isOwner, true);
  assert.equal(buildUser({ email: OWNER.toUpperCase() }, {}).isOwner, true);
  assert.equal(buildUser({ email: "someone@example.com" }, {}).isOwner, false);

  const configured = buildUser({ email: "boss@example.com" }, {
    OWNER_EMAIL: "  BOSS@example.com "
  });
  assert.equal(configured.isOwner, true);

  // Ownership must not silently rewrite the stored plan.
  const ownerOnBasic = buildUser({ email: OWNER, plan: "basic" }, {});
  assert.equal(ownerOnBasic.isOwner, true);
  assert.equal(ownerOnBasic.plan, "basic");
});

test("ownerEmail defaults to the documented owner address", () => {
  assert.equal(ownerEmail({}), OWNER);
  assert.equal(ownerEmail(undefined), OWNER);
  assert.equal(ownerEmail({ OWNER_EMAIL: "  " }), OWNER);
});

/* ----------------------------------------------------------------- cookies */

test("session cookie keeps its protective attributes", () => {
  const cookie = sessionCookie("token-value");

  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=604800/);
});

test("multiple cookies become separate Set-Cookie headers", () => {
  const headers = appendCookies(
    { "Cache-Control": "no-store" },
    [sessionCookie("abc"), clearStateCookie()]
  );

  const list = setCookies(headers);

  assert.equal(list.length, 2);
  assert.match(list[0], /tradepro_session=abc/);
  assert.match(list[1], /tradepro_oauth_state=;/);

  // The regression this fixes: a comma-joined single header.
  for (const value of list) {
    assert.doesNotMatch(value, /tradepro_oauth_state=[^;]*,\s*tradepro_/);
  }

  assert.equal(headers.get("cache-control"), "no-store");
});

test("jsonWithCookies emits JSON plus its own Set-Cookie headers", async () => {
  const response = jsonWithCookies({ ok: true }, 200, [sessionCookie("xyz")]);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(setCookies(response.headers).length, 1);
  assert.deepEqual(await response.json(), { ok: true });
});

test("json responses are never cached", () => {
  assert.equal(json({ a: 1 }).headers.get("cache-control"), "no-store");
});

/* ---------------------------------------------------------- getCurrentUser */

test("getCurrentUser returns null without a session cookie", async () => {
  const user = await getCurrentUser(requestWithToken(null), {
    DB: mockDb(() => {
      throw new Error("should not query");
    })
  });

  assert.equal(user, null);
});

test("getCurrentUser returns null when the session is unknown", async () => {
  const user = await getCurrentUser(
    requestWithToken("unknown-token"),
    { DB: mockDb(() => null) }
  );

  assert.equal(user, null);
});

test("getCurrentUser rejects an expired session stored as ISO", async () => {
  const user = await getCurrentUser(requestWithToken("tok"), {
    DB: mockDb(() => ({
      google_sub: "sub",
      email: "user@example.com",
      plan: "pro",
      status: "active",
      session_expires_at: new Date(Date.now() - 1000).toISOString()
    }))
  });

  assert.equal(user, null);
});

test("getCurrentUser rejects an expired session stored as epoch seconds", async () => {
  const user = await getCurrentUser(requestWithToken("tok"), {
    DB: mockDb(() => ({
      google_sub: "sub",
      email: "user@example.com",
      status: "active",
      session_expires_at: Math.floor(Date.now() / 1000) - 60
    }))
  });

  assert.equal(user, null);
});

test("getCurrentUser rejects a deactivated account", async () => {
  const user = await getCurrentUser(requestWithToken("tok"), {
    DB: mockDb(() => ({
      google_sub: "sub",
      email: "user@example.com",
      plan: "pro",
      status: "inactive",
      session_expires_at: Date.now() + 60000
    }))
  });

  assert.equal(user, null);
});

test("getCurrentUser applies Pro expiry for a live session", async () => {
  const baseRow = {
    google_sub: "sub",
    email: "user@example.com",
    name: "User",
    plan: "pro",
    status: "active",
    session_expires_at: Date.now() + 60000
  };

  const active = await getCurrentUser(requestWithToken("tok"), {
    DB: mockDb(() => ({ ...baseRow, pro_expires_at: Date.now() + 86400000 }))
  });

  assert.equal(active.plan, "pro");
  assert.equal(active.proActive, true);

  const expired = await getCurrentUser(requestWithToken("tok"), {
    DB: mockDb(() => ({ ...baseRow, pro_expires_at: Date.now() - 86400000 }))
  });

  assert.equal(expired.plan, "basic");
  assert.equal(expired.proExpired, true);
});

test("getCurrentUser works with a table lacking optional columns", async () => {
  const user = await getCurrentUser(requestWithToken("tok"), {
    DB: mockDb(() => ({
      google_sub: "sub",
      email: "user@example.com",
      session_expires_at: Date.now() + 60000
      // no plan, role, status, name or picture columns
    }))
  });

  assert.equal(user.plan, "basic");
  assert.equal(user.role, "user");
  assert.equal(user.status, "active");
  assert.equal(user.isOwner, false);
});

test("getCurrentUser surfaces a missing database binding", async () => {
  await assert.rejects(
    () => getCurrentUser(requestWithToken("tok"), {}),
    /Database is not configured/
  );
});

/* ------------------------------------------------------- OAuth callback */

test("callback sets two separate Set-Cookie headers (boolean email_verified)", async () => {
  const { response } = await runCallback({ identity: baseIdentity() });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/");

  const cookies = setCookies(response.headers);

  assert.equal(cookies.length, 2);
  assert.ok(cookies.some(value => /^tradepro_session=/.test(value)));
  assert.ok(cookies.some(value => /^tradepro_oauth_state=;/.test(value)));
});

test("callback accepts email_verified as the string \"true\"", async () => {
  const { response } = await runCallback({
    identity: baseIdentity({ email_verified: "true" })
  });

  assert.equal(response.status, 302);
});

test("callback accepts email_verified as 1", async () => {
  const { response } = await runCallback({
    identity: baseIdentity({ email_verified: 1 })
  });

  assert.equal(response.status, 302);
});

test("callback rejects an unverified email", async () => {
  for (const value of [false, "false", 0, undefined]) {
    const { response } = await runCallback({
      identity: baseIdentity({ email_verified: value })
    });

    assert.equal(response.status, 400, `email_verified=${String(value)}`);
  }
});

test("callback blocks a deactivated account at login", async () => {
  const { response } = await runCallback({
    identity: baseIdentity(),
    dbStatus: "inactive"
  });

  assert.equal(response.status, 403);
  assert.match(await response.text(), /deactivated/i);
});

test("callback logs provider failures without leaking credentials", async () => {
  const { response, logged } = await runCallback({ tokenOk: false });

  assert.equal(response.status, 400);
  assert.ok(logged.length > 0, "expected a console.error entry");

  const text = JSON.stringify(logged);
  assert.doesNotMatch(text, /test-client-secret/);
  assert.doesNotMatch(text, /test-code/);
});

test("callback upsert never overwrites plan or status", async () => {
  const { calls } = await runCallback({ identity: baseIdentity() });

  const upsert = calls.find(call => /INSERT INTO users/i.test(call.sql));

  assert.ok(upsert, "expected a users upsert");
  assert.match(upsert.sql, /ON CONFLICT\s*\(\s*google_sub\s*\)/i);
  assert.match(upsert.sql, /DO UPDATE SET/i);

  // Manual plan/status control must survive re-login.
  assert.doesNotMatch(upsert.sql, /plan\s*=\s*excluded\.plan/i);
  assert.doesNotMatch(upsert.sql, /status\s*=\s*excluded\.status/i);

  // A normal user is created as basic + user.
  assert.equal(upsert.args.includes("basic"), true);
  assert.equal(upsert.args.includes("user"), true);
});

test("callback grants the owner role and pro plan on first login", async () => {
  const { calls } = await runCallback({
    identity: baseIdentity({ email: OWNER })
  });

  const upsert = calls.find(call => /INSERT INTO users/i.test(call.sql));

  assert.equal(upsert.args.includes("owner"), true);
  assert.equal(upsert.args.includes("pro"), true);
});

test("callback rejects a mismatched state before contacting Google", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;

  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };

  try {
    const request = new Request(
      "https://example.com/api/auth/callback?code=c&state=attacker-state",
      { headers: { Cookie: "tradepro_oauth_state=forged.token" } }
    );

    const response = await callbackHandler({
      request,
      env: {
        DB: mockDb(() => null),
        SESSION_SECRET: SECRET,
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
        GOOGLE_REDIRECT_URI: "https://example.com/api/auth/callback"
      }
    });

    assert.equal(response.status, 400);
    assert.equal(called, false, "must not call Google with an invalid state");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
