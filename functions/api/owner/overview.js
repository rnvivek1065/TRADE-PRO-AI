/**
 * GET /api/owner/overview
 *
 * Owner-only system overview: account totals, signal activity, recent server
 * errors, provider health and configuration status.
 *
 * Configuration is reported as BOOLEANS ONLY. No secret value, prefix or length
 * is ever returned, so the dashboard cannot be used to exfiltrate credentials.
 *
 * Cloudflare secrets cannot be written from application code. This endpoint
 * therefore reports status only; changing a secret requires `wrangler secret
 * put` or the dashboard (see docs/CONFIGURATION.md).
 */

import { okResponse, requireMethod, withErrors } from "../../_utils/http.js";
import { requireOwner } from "../../_utils/guards.js";
import { LIMITS, enforce } from "../../_utils/ratelimit.js";
import { BASIC_DAILY_LIMIT, ROLLING_WINDOW_MS } from "../../_utils/quota.js";
import { health, isConfigured } from "../../_utils/provider.js";
import { ownerEmail } from "../../_utils/auth.js";

function present(value) {
  return typeof value === "string" && value.trim() !== "";
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

  const now = Date.now();
  const cutoff = now - ROLLING_WINDOW_MS;

  const users = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN LOWER(COALESCE(status,'active')) = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN LOWER(COALESCE(status,'active')) <> 'active' THEN 1 ELSE 0 END) AS inactive,
       SUM(CASE WHEN LOWER(COALESCE(plan,'basic')) = 'pro' THEN 1 ELSE 0 END) AS pro,
       SUM(CASE WHEN LOWER(COALESCE(plan,'basic')) <> 'pro' THEN 1 ELSE 0 END) AS basic
     FROM users`
  ).first();

  const signals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS last24h,
       SUM(CASE WHEN counted = 0 THEN 1 ELSE 0 END) AS refunded,
       COUNT(DISTINCT google_sub) AS users
     FROM signals`
  )
    .bind(cutoff)
    .first();

  const byAction = await env.DB.prepare(
    `SELECT action, COUNT(*) AS count FROM signals GROUP BY action ORDER BY count DESC`
  ).all();

  const recentErrors = await env.DB.prepare(
    `SELECT id, level, code, message, path, created_at
     FROM app_errors ORDER BY created_at DESC LIMIT 20`
  ).all();

  const provider = await health(env);

  return okResponse({
    generatedAt: new Date(now).toISOString(),
    owner: { email: owner.email, ownerEmail: ownerEmail(env) },
    accounts: {
      total: Number(users?.total ?? 0),
      active: Number(users?.active ?? 0),
      inactive: Number(users?.inactive ?? 0),
      pro: Number(users?.pro ?? 0),
      basic: Number(users?.basic ?? 0)
    },
    signals: {
      total: Number(signals?.total ?? 0),
      last24h: Number(signals?.last24h ?? 0),
      refunded: Number(signals?.refunded ?? 0),
      distinctUsers: Number(signals?.users ?? 0),
      byAction: byAction?.results ?? []
    },
    limits: { basicDailyLimit: BASIC_DAILY_LIMIT, windowSeconds: 86400 },
    provider: {
      name: "live-rates",
      configured: isConfigured(env),
      ...provider
    },
    errors: {
      count: (recentErrors?.results ?? []).length,
      recent: (recentErrors?.results ?? []).map(row => ({
        id: row.id,
        level: row.level,
        code: row.code,
        message: row.message,
        path: row.path,
        at: new Date(Number(row.created_at)).toISOString()
      }))
    },
    // Booleans only — never the values themselves.
    configuration: {
      databaseBinding: Boolean(env?.DB),
      googleClientId: present(env?.GOOGLE_CLIENT_ID),
      googleClientSecret: present(env?.GOOGLE_CLIENT_SECRET),
      googleRedirectUri: present(env?.GOOGLE_REDIRECT_URI),
      sessionSecret: present(env?.SESSION_SECRET),
      liveRatesApiKey: present(env?.LIVE_RATES_API_KEY),
      ownerEmailOverride: present(env?.OWNER_EMAIL),
      secretsEditableInApp: false,
      secretManagement: "Cloudflare dashboard or `wrangler secret put`"
    }
  });
});
