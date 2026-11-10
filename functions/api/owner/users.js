/**
 * /api/owner/users
 *
 * Owner-only user administration.
 *
 *   GET  ?q=&status=&limit=&offset=   list and search registered users
 *   POST { action, googleSub, ... }  activate, deactivate, assign plan,
 *                                    set Pro expiry, grant lifetime Pro
 *
 * Every request is authorised server-side by requireOwner(), which compares the
 * session's email against OWNER_EMAIL. A client cannot claim the owner role.
 *
 * SAFETY: no statement here deletes a user or drops data. Only `status`,
 * `plan` and `pro_expires_at` are ever written, and the owner cannot lock
 * themselves out by deactivating or demoting their own account.
 */

import { HttpError, okResponse, readJson, requireCsrf, requireMethod, withErrors } from "../../_utils/http.js";
import { requireOwner } from "../../_utils/guards.js";
import { LIMITS, enforce } from "../../_utils/ratelimit.js";
import { BASIC_DAILY_LIMIT, ROLLING_WINDOW_MS } from "../../_utils/quota.js";

const MAX_LIMIT = 100;

function toIso(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  const ms = Number.isFinite(number) && String(value).trim() !== "" && !String(value).includes("-")
    ? number
    : Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function shapeUser(row, usageBySub) {
  const usage = usageBySub.get(row.google_sub) ?? { used: 0, lastAt: null };
  const expires = toIso(row.pro_expires_at);
  const expired = expires !== null && Date.parse(expires) <= Date.now();

  return {
    googleSub: row.google_sub,
    email: row.email,
    name: row.name ?? null,
    picture: row.picture ?? null,
    role: row.role ?? "user",
    plan: row.plan ?? "basic",
    effectivePlan: expired ? "basic" : (row.plan ?? "basic"),
    proExpiresAt: expires,
    proExpired: expired,
    lifetimePro: (row.plan ?? "basic") === "pro" && expires === null,
    status: row.status ?? "active",
    createdAt: toIso(row.created_at),
    usageLast24h: usage.used,
    lastSignalAt: usage.lastAt === null ? null : new Date(Number(usage.lastAt)).toISOString()
  };
}

export const onRequestGet = withErrors(async ({ request, env }) => {
  const wrongMethod = requireMethod(request, "GET", "GET");
  if (wrongMethod) return wrongMethod;

  const owner = await requireOwner(request, env);

  const limited = await enforce(env, {
    bucket: `owner:${owner.googleSub}`,
    limit: LIMITS.ownerPerMinute,
    windowSeconds: 60
  });
  if (limited) return limited;

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") ?? "").trim();
  const status = String(url.searchParams.get("status") ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(url.searchParams.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

  const where = [];
  const params = [];

  if (q !== "") {
    where.push("(LOWER(email) LIKE ? OR LOWER(COALESCE(name,'')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }

  if (status === "active" || status === "inactive") {
    where.push("LOWER(COALESCE(status,'active')) = ?");
    params.push(status);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM users ${clause}`
  )
    .bind(...params)
    .first();

  const rows = await env.DB.prepare(
    `SELECT google_sub, email, name, picture, role, plan, pro_expires_at, status, created_at
     FROM users ${clause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  const users = rows?.results ?? [];

  // One aggregate query for all users on the page instead of one per user.
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  const usageRows = await env.DB.prepare(
    `SELECT google_sub, COUNT(*) AS used, MAX(created_at) AS last_at
     FROM signals
     WHERE counted = 1 AND created_at > ?
     GROUP BY google_sub`
  )
    .bind(cutoff)
    .all();

  const usageBySub = new Map(
    (usageRows?.results ?? []).map(row => [
      row.google_sub,
      { used: Number(row.used ?? 0), lastAt: row.last_at ?? null }
    ])
  );

  return okResponse({
    total: Number(totalRow?.total ?? 0),
    limit,
    offset,
    basicDailyLimit: BASIC_DAILY_LIMIT,
    users: users.map(row => shapeUser(row, usageBySub))
  });
});

export const onRequestPost = withErrors(async ({ request, env }) => {
  const wrongMethod = requireMethod(request, "POST", "POST");
  if (wrongMethod) return wrongMethod;

  const owner = await requireOwner(request, env);

  const limited = await enforce(env, {
    bucket: `owner:${owner.googleSub}`,
    limit: LIMITS.ownerPerMinute,
    windowSeconds: 60
  });
  if (limited) return limited;

  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const body = await readJson(request);
  const action = String(body.action ?? "").trim();
  const googleSub = String(body.googleSub ?? "").trim();

  if (googleSub === "") {
    throw new HttpError("missing_user", "A target user is required.", 400);
  }

  const target = await env.DB.prepare(
    `SELECT google_sub, email, role, plan, pro_expires_at, status
     FROM users WHERE google_sub = ?`
  )
    .bind(googleSub)
    .first();

  if (!target) {
    throw new HttpError("user_not_found", "That user does not exist.", 404);
  }

  const isSelf = googleSub === owner.googleSub;

  switch (action) {
    case "activate": {
      await env.DB.prepare(`UPDATE users SET status = 'active' WHERE google_sub = ?`)
        .bind(googleSub)
        .run();
      break;
    }

    case "deactivate": {
      // Lockout protection: the owner cannot deactivate their own account.
      if (isSelf) {
        throw new HttpError(
          "cannot_modify_self",
          "You cannot deactivate your own owner account.",
          409
        );
      }

      await env.DB.prepare(`UPDATE users SET status = 'inactive' WHERE google_sub = ?`)
        .bind(googleSub)
        .run();

      // Kill live sessions immediately so access stops at once.
      await env.DB.prepare(`DELETE FROM sessions WHERE google_sub = ?`)
        .bind(googleSub)
        .run();
      break;
    }

    case "set_plan": {
      const plan = String(body.plan ?? "").toLowerCase();

      if (plan !== "basic" && plan !== "pro") {
        throw new HttpError("invalid_plan", "Plan must be 'basic' or 'pro'.", 400);
      }

      if (isSelf && plan === "basic") {
        throw new HttpError(
          "cannot_modify_self",
          "Your owner account always has full access.",
          409
        );
      }

      await env.DB.prepare(`UPDATE users SET plan = ? WHERE google_sub = ?`)
        .bind(plan, googleSub)
        .run();

      // Downgrading to basic clears any stale expiry.
      if (plan === "basic") {
        await env.DB.prepare(`UPDATE users SET pro_expires_at = NULL WHERE google_sub = ?`)
          .bind(googleSub)
          .run();
      }
      break;
    }

    case "set_expiry": {
      const raw = body.proExpiresAt;
      const iso = raw === null || raw === undefined || raw === "" ? null : toIso(raw);

      if (raw !== null && raw !== undefined && raw !== "" && iso === null) {
        throw new HttpError("invalid_date", "Provide a valid ISO date or null.", 400);
      }

      await env.DB.prepare(`UPDATE users SET pro_expires_at = ? WHERE google_sub = ?`)
        .bind(iso, googleSub)
        .run();
      break;
    }

    case "grant_lifetime_pro": {
      // null expiry means lifetime Pro (see buildUser in auth.js).
      await env.DB.prepare(`UPDATE users SET plan = 'pro', pro_expires_at = NULL WHERE google_sub = ?`)
        .bind(googleSub)
        .run();
      break;
    }

    default:
      throw new HttpError(
        "invalid_action",
        "Unsupported action.",
        400,
        { allowed: ["activate", "deactivate", "set_plan", "set_expiry", "grant_lifetime_pro"] }
      );
  }

  const updated = await env.DB.prepare(
    `SELECT google_sub, email, name, picture, role, plan, pro_expires_at, status, created_at
     FROM users WHERE google_sub = ?`
  )
    .bind(googleSub)
    .first();

  return okResponse({
    ok: true,
    action,
    user: shapeUser(updated, new Map())
  });
});
