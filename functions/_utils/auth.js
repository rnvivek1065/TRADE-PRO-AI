const COOKIE_NAME = "tradepro_session";
const STATE_COOKIE = "tradepro_oauth_state";
const DEFAULT_OWNER_EMAIL = "rnvivek1065@gmail.com";

export const SESSION_MAX_AGE = 604800; // 7 days, seconds
export const STATE_MAX_AGE = 600; // 10 minutes, seconds

function toBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const binary = atob(
    base64 + "=".repeat((4 - base64.length % 4) % 4)
  );

  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export function randomToken(length = 32) {
  const bytes = crypto.getRandomValues(
    new Uint8Array(length)
  );

  return toBase64Url(bytes);
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return toBase64Url(new Uint8Array(digest));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return toBase64Url(new Uint8Array(signature));
}

/**
 * Compares two strings without an early exit, so the time taken does not
 * reveal how many leading characters matched.
 *
 * The previous `signature !== expected` comparison short-circuits on the first
 * differing byte. Length is normalised by always iterating over the longer
 * input, and a length difference is folded into the accumulator instead of
 * being returned immediately.
 */
export function timingSafeEqualString(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  const length = Math.max(left.length, right.length);

  let mismatch = left.length === right.length ? 0 : 1;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

export async function signState(payload, secret) {
  const encoded = toBase64Url(
    new TextEncoder().encode(JSON.stringify(payload))
  );

  const signature = await hmac(encoded, secret);

  return `${encoded}.${signature}`;
}

export async function verifyState(value, secret) {
  if (!value || !secret) return null;

  const parts = value.split(".");

  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;
  const expected = await hmac(encoded, secret);

  if (!timingSafeEqualString(signature, expected)) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(
        fromBase64Url(encoded)
      )
    );

    if (!payload.expires || payload.expires < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";

  const item = cookies
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(`${name}=`));

  return item ? item.substring(name.length + 1) : null;
}

export function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function stateCookie(value, maxAge = STATE_MAX_AGE) {
  return `${STATE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearStateCookie() {
  return `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Appends each cookie as its own Set-Cookie header.
 *
 * A Headers object holds a list for Set-Cookie; assigning a single joined
 * string produces one malformed header (RFC 6265 forbids comma-combining),
 * which is why the OAuth callback could lose the session cookie.
 */
export function appendCookies(headers, cookies = []) {
  const result = new Headers(headers || {});

  for (const cookie of cookies) {
    if (cookie) {
      result.append("Set-Cookie", cookie);
    }
  }

  return result;
}

export function responseWithCookies(body, init = {}, cookies = []) {
  return new Response(body, {
    ...init,
    headers: appendCookies(init.headers, cookies)
  });
}

export function jsonWithCookies(data, status = 200, cookies = []) {
  return responseWithCookies(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    },
    cookies
  );
}

export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

/**
 * Normalises a timestamp that may arrive as epoch seconds, epoch milliseconds
 * or an ISO string. Existing databases created by hand may store any of these,
 * so the auth code must not assume one representation.
 */
export function parseTime(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Values below 1e12 are seconds (1e12 ms is year 33658).
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }

  const text = String(value).trim();

  if (text === "") return null;

  const numeric = Number(text);

  if (Number.isFinite(numeric)) {
    return numeric < 1e12 ? Math.round(numeric * 1000) : Math.round(numeric);
  }

  const parsed = Date.parse(text);

  return Number.isNaN(parsed) ? null : parsed;
}

export function ownerEmail(env) {
  const configured = env?.OWNER_EMAIL;

  if (typeof configured === "string" && configured.trim() !== "") {
    return configured.trim().toLowerCase();
  }

  return DEFAULT_OWNER_EMAIL;
}

/**
 * Turns a database row into the user object used by the API.
 *
 * Plan enforcement lives here: a 'pro' row whose pro_expires_at is in the past
 * is reported as 'basic'. `storedPlan` keeps the raw database value so the
 * owner dashboard can still show what was assigned.
 *
 * Missing optional columns fall back to defaults instead of throwing, so an
 * older hand-created table keeps working.
 */
export function buildUser(row, env, now = Date.now()) {
  const storedPlan = String(row?.plan ?? "basic").trim().toLowerCase();
  const proExpiresAt = parseTime(row?.pro_expires_at);
  const proExpired =
    storedPlan === "pro" && proExpiresAt !== null && proExpiresAt <= now;
  const plan = storedPlan === "pro" && !proExpired ? "pro" : "basic";

  const email = String(row?.email ?? "").toLowerCase();
  const role = String(row?.role ?? "user").trim().toLowerCase();
  const isOwner = role === "owner" || (email !== "" && email === ownerEmail(env));

  return {
    googleSub: row?.google_sub ?? null,
    email,
    name: row?.name ?? "",
    picture: row?.picture ?? "",
    role: isOwner ? "owner" : role,
    isOwner,
    plan,
    storedPlan,
    proActive: plan === "pro",
    proExpiresAt,
    proExpired,
    status: String(row?.status ?? "active").trim().toLowerCase(),
    sessionExpiresAt: parseTime(row?.session_expires_at),
    createdAt: row?.created_at ?? null
  };
}

export async function getCurrentUser(request, env) {
  if (!env?.DB) {
    throw new Error("Database is not configured.");
  }

  const token = getCookie(request, COOKIE_NAME);

  if (!token) return null;

  const tokenHash = await sha256(token);

  // `u.*` keeps this query working against an existing users table that has
  // extra columns or is missing optional ones. Session expiry and status are
  // evaluated below instead of inside SQL so both ISO strings and epoch
  // numbers stored by an older schema are handled correctly.
  const row = await env.DB.prepare(`
    SELECT
      u.*,
      s.expires_at AS session_expires_at
    FROM sessions s
    JOIN users u ON u.google_sub = s.google_sub
    WHERE s.token_hash = ?
  `)
    .bind(tokenHash)
    .first();

  if (!row) return null;

  const now = Date.now();
  const sessionExpiresAt = parseTime(row.session_expires_at);

  if (sessionExpiresAt !== null && sessionExpiresAt <= now) {
    return null;
  }

  const user = buildUser(row, env, now);

  if (user.status !== "active") {
    return null;
  }

  return user;
}
