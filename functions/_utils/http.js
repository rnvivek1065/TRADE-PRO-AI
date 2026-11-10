/**
 * TRADE PRO AI — HTTP helpers, safe error responses and error logging.
 *
 * No endpoint should build its own error payload or leak an internal message.
 * Everything funnels through here so responses are consistent and never expose
 * stack traces, SQL, provider credentials or environment values.
 */

import { json } from "./auth.js";

export class HttpError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Standard failure envelope. */
export function errorResponse(code, message, status = 400, details = null) {
  const body = { ok: false, error: { code, message } };

  if (details) {
    body.error.details = details;
  }

  return json(body, status);
}

export function okResponse(data, status = 200, extra = {}) {
  return json({ ok: true, ...data }, status, extra);
}

/* -------------------------------------------------------------------------- */
/* Request validation                                                         */
/* -------------------------------------------------------------------------- */

/** Returns a 405 Response when the method is wrong, otherwise null. */
export function requireMethod(request, method, allow = null) {
  if (request.method === method) return null;

  const headers = { Allow: allow ?? method };

  return json(
    {
      ok: false,
      error: {
        code: "method_not_allowed",
        message: `This endpoint accepts ${allow ?? method} requests only.`
      }
    },
    405,
    headers
  );
}

export function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * CSRF defence for state-changing requests.
 *
 * Two independent conditions, both required:
 *   1. `Origin` (or `Referer`) must match this deployment's origin. A
 *      cross-site form post carries the attacker's origin and is rejected.
 *   2. The body must be JSON. A cross-origin `application/json` request
 *      triggers a CORS preflight, which this deployment never grants.
 *
 * The session cookie is additionally SameSite=Lax, so it is not sent on
 * cross-site POSTs in the first place.
 *
 * @returns {Response|null} a rejection, or null when the request may proceed
 */
export function requireCsrf(request) {
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  const expected = new URL(request.url).origin;
  const source = origin || referer;

  if (!source) {
    return errorResponse(
      "csrf_missing_origin",
      "This request is missing an origin and cannot be verified.",
      403
    );
  }

  let actual = null;

  try {
    actual = new URL(source).origin;
  } catch {
    return errorResponse("csrf_invalid_origin", "The request origin is not valid.", 403);
  }

  if (actual !== expected) {
    return errorResponse("csrf_origin_mismatch", "Cross-site requests are not permitted.", 403);
  }

  const contentType = String(request.headers.get("Content-Type") ?? "").toLowerCase();

  if (!contentType.includes("application/json")) {
    return errorResponse(
      "unsupported_media_type",
      "This endpoint requires a JSON request body.",
      415
    );
  }

  return null;
}

const MAX_BODY_BYTES = 4096;

/**
 * Reads and parses a bounded JSON body.
 * @throws {HttpError} when the body is oversized or malformed
 */
export async function readJson(request) {
  let text;

  try {
    text = await request.text();
  } catch {
    throw new HttpError("invalid_body", "The request body could not be read.", 400);
  }

  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError("body_too_large", "The request body is too large.", 413);
  }

  if (text.trim() === "") {
    return {};
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError("invalid_json", "The request body is not valid JSON.", 400);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError("invalid_json", "The request body must be a JSON object.", 400);
  }

  return parsed;
}

/* -------------------------------------------------------------------------- */
/* Error logging                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Persists a server-side error for the owner dashboard.
 *
 * Logging must never break the response path, so every failure here is
 * swallowed. The message is truncated and no credentials are ever written.
 */
export async function logError(env, entry = {}) {
  try {
    if (!env?.DB) return;

    await env.DB.prepare(
      `INSERT INTO app_errors (level, code, message, path, google_sub, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        String(entry.level ?? "error").slice(0, 16),
        String(entry.code ?? "error").slice(0, 64),
        String(entry.message ?? "").slice(0, 500),
        String(entry.path ?? "").slice(0, 200),
        String(entry.googleSub ?? "").slice(0, 128),
        entry.detail ? JSON.stringify(entry.detail).slice(0, 2000) : "",
        Date.now()
      )
      .run();
  } catch {
    // Never surface logging failures to the caller.
  }
}

/**
 * Converts any thrown value into a safe client response.
 *
 * Known `HttpError` and `ProviderError` values keep their intended status and
 * message. Anything else becomes a generic 500 so internal details (SQL text,
 * stack traces, env names) cannot leak.
 */
export async function handleError(error, env, request, path = null) {
  const resolvedPath = path ?? (request ? new URL(request.url).pathname : "");

  if (error instanceof HttpError) {
    return errorResponse(error.code, error.message, error.status, error.details);
  }

  // ProviderError is duck-typed to avoid a circular import.
  if (error && typeof error.code === "string" && typeof error.status === "number") {
    await logError(env, {
      level: error.status >= 500 ? "error" : "warn",
      code: error.code,
      message: error.message,
      path: resolvedPath,
      detail: error.details
    });

    return errorResponse(error.code, error.message, error.status, error.details);
  }

  await logError(env, {
    level: "error",
    code: "internal_error",
    message: error?.message ?? String(error),
    path: resolvedPath
  });

  return errorResponse("internal_error", "Something went wrong. Please try again.", 500);
}

/**
 * Wraps a handler so every failure becomes a safe JSON response.
 */
export function withErrors(handler) {
  return async context => {
    try {
      return await handler(context);
    } catch (error) {
      return handleError(error, context?.env, context?.request);
    }
  };
}
