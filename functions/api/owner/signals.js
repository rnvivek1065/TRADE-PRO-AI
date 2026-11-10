/**
 * GET /api/owner/signals?googleSub=&limit=&offset=
 *
 * Owner-only signal history across all users, optionally filtered to one user.
 * Read-only: this endpoint never mutates or deletes a signal record.
 */

import { okResponse, requireMethod, withErrors } from "../../_utils/http.js";
import { requireOwner } from "../../_utils/guards.js";
import { LIMITS, enforce } from "../../_utils/ratelimit.js";

const MAX_LIMIT = 200;

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
  const googleSub = String(url.searchParams.get("googleSub") ?? "").trim();
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(url.searchParams.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

  const clause = googleSub === "" ? "" : "WHERE google_sub = ?";
  const params = googleSub === "" ? [] : [googleSub];

  const rows = await env.DB.prepare(
    `SELECT id, google_sub, email, market, instrument, timeframe, action,
            entry, stop_loss, take_profit, risk_reward, confidence,
            counted, plan_at_request, data_source, created_at
     FROM signals ${clause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  return okResponse({
    limit,
    offset,
    signals: (rows?.results ?? []).map(row => ({
      id: row.id,
      googleSub: row.google_sub,
      email: row.email,
      market: row.market,
      instrument: row.instrument,
      timeframe: row.timeframe,
      action: row.action,
      entry: row.entry,
      stopLoss: row.stop_loss,
      takeProfit: row.take_profit,
      riskReward: row.risk_reward,
      confidence: row.confidence,
      counted: Boolean(row.counted),
      planAtRequest: row.plan_at_request,
      dataSource: row.data_source,
      at: new Date(Number(row.created_at)).toISOString()
    }))
  });
});
