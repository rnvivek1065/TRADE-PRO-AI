/**
 * TRADE PRO AI — D1-backed fixed-window rate limiting.
 *
 * Pages Functions run in ephemeral isolates, so an in-memory counter is not a
 * reliable limit. The counter therefore lives in D1 and is incremented with a
 * single atomic UPSERT, which also makes concurrent requests safe.
 *
 * Fail-open policy: if the limiter itself errors (for example during a D1
 * outage) the request is allowed through and the failure is logged. A broken
 * limiter must not take the product down, and the quota engine in quota.js is
 * the authoritative control for signal generation.
 */

import { logError } from "./http.js";

export const LIMITS = Object.freeze({
  /** Cheap read endpoints, per IP. */
  readPerMinute: 60,
  /** Signal generation, per authenticated user. */
  signalPerMinute: 10,
  /** Authentication start/callback, per IP. */
  authPerMinute: 20,
  /** Owner endpoints, per user. */
  ownerPerMinute: 120
});

function bucketStart(now, windowSeconds) {
  const windowMs = windowSeconds * 1000;
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Increments a counter and reports whether the caller is over the limit.
 *
 * @param {object} env
 * @param {{bucket: string, limit: number, windowSeconds?: number, now?: number}} options
 * @returns {Promise<{allowed: boolean, count: number, limit: number, retryAfterSeconds: number}>}
 */
export async function consume(env, options) {
  const { bucket, limit, windowSeconds = 60, now = Date.now() } = options;

  const start = bucketStart(now, windowSeconds);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((start + windowSeconds * 1000 - now) / 1000)
  );

  if (!env?.DB) {
    return { allowed: true, count: 0, limit, retryAfterSeconds, degraded: true };
  }

  try {
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
       RETURNING count`
    )
      .bind(String(bucket).slice(0, 200), start)
      .first();

    const count = Number(row?.count ?? 0);

    return {
      allowed: count <= limit,
      count,
      limit,
      retryAfterSeconds
    };
  } catch (error) {
    await logError(env, {
      level: "warn",
      code: "rate_limiter_failed",
      message: error?.message ?? "Rate limiter failed",
      path: "ratelimit"
    });

    return { allowed: true, count: 0, limit, retryAfterSeconds, degraded: true };
  }
}

/**
 * Convenience wrapper returning a ready-to-send 429, or null when allowed.
 */
export async function enforce(env, options) {
  const result = await consume(env, options);

  if (result.allowed) return null;

  const { json } = await import("./auth.js");

  return json(
    {
      ok: false,
      error: {
        code: "rate_limited",
        message: "Too many requests. Please slow down and try again shortly."
      },
      retryAfterSeconds: result.retryAfterSeconds
    },
    429,
    { "Retry-After": String(result.retryAfterSeconds) }
  );
}
