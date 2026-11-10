const COOKIE_NAME = "tradepro_session";
const STATE_COOKIE = "tradepro_oauth_state";

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

  if (signature !== expected) return null;

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

export function sessionCookie(token, maxAge = 604800) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function stateCookie(value, maxAge = 600) {
  return `${STATE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearStateCookie() {
  return `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function getCurrentUser(request, env) {
  if (!env.DB) {
    throw new Error("Database is not configured.");
  }

  const token = getCookie(request, COOKIE_NAME);

  if (!token) return null;

  const tokenHash = await sha256(token);

  const result = await env.DB.prepare(`
    SELECT
      u.google_sub,
      u.email,
      u.name,
      u.picture,
      u.role,
      u.plan,
      u.status,
      u.pro_expires_at,
      u.created_at,
      s.expires_at
    FROM sessions s
    JOIN users u ON u.google_sub = s.google_sub
    WHERE s.token_hash = ?
      AND s.expires_at > ?
  `)
    .bind(tokenHash, new Date().toISOString())
    .first();

  if (!result || result.status !== "active") {
    return null;
  }

  return result;
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
