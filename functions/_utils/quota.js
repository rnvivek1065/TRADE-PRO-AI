/**
 * TRADE PRO AI — server-side plan and quota enforcement.
 *
 * THIS IS THE AUTHORITY. Frontend gating is cosmetic; every signal request
 * passes through here, and no endpoint may bypass it.
 *
 * Plans
 * -----
 *   basic  5 successful signals per ROLLING 24 hours (86,400 s).
 *          The window is measured from the oldest counted signal, never from
 *          an arbitrary calendar midnight.
 *   pro    unlimited while the subscription is active and unexpired. An expired
 *          pro is treated as basic by buildUser() in auth.js.
 *   owner  unlimited and never charged, regardless of the stored plan.
 *
 * Concurrency
 * -----------
 * A plain "read the count, then insert" is racy: two simultaneous requests can
 * both observe 4/5 and both succeed. The slot is therefore reserved with ONE
 * atomic statement whose INSERT is guarded by a correlated COUNT. SQLite
 * serialises writes, so the fifth insert succeeds and the sixth observes a full
 * window and inserts nothing — `meta.changes === 0` signals the rejection.
 *
 * A reservation is taken BEFORE the expensive analysis so the limit cannot be
 * exceeded by parallel work, and refunded if the analysis could not produce a
 * result (missing market data), so a user is never charged for our failure.
 */

export const BASIC_DAILY_LIMIT = 5;
export const ROLLING_WINDOW_MS = 86400000; // 86,400 seconds
export const ROLLING_WINDOW_SECONDS = 86400;

/** Owner and active Pro are unlimited. */
export function isUnlimited(user) {
  return Boolean(user?.isOwner) || user?.plan === "pro";
}

function effectivePlanName(user) {
  if (user?.isOwner) return "owner";
  return user?.plan === "pro" ? "pro" : "basic";
}

/**
 * Atomically reserves a quota slot and inserts the pending signal row.
 * The INSERT only happens when the rolling window still has room.
 */
const GUARDED_INSERT = `
  INSERT INTO signals (
    id, google_sub, email, market, instrument, timeframe, action,
    counted, plan_at_request, data_source, created_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
  WHERE (
    SELECT COUNT(*) FROM signals
    WHERE google_sub = ? AND counted = 1 AND created_at > ?
  ) < ?
`;

const PLAIN_INSERT = `
  INSERT INTO signals (
    id, google_sub, email, market, instrument, timeframe, action,
    counted, plan_at_request, data_source, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
`;

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Rolling 24-hour usage for a user.
 *
 * @returns {Promise<{
 *   plan: string, unlimited: boolean, limit: number|null, used: number,
 *   remaining: number|null, windowSeconds: number, resetAt: string|null,
 *   resetAtMs: number|null, resetsInSeconds: number|null, windowStart: string
 * }>}
 */
export async function getUsage(env, user, now = Date.now()) {
  const unlimited = isUnlimited(user);
  const cutoff = now - ROLLING_WINDOW_MS;
  const windowStart = new Date(cutoff).toISOString();

  let used = 0;
  let oldest = null;

  if (env?.DB) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS used, MIN(created_at) AS oldest
       FROM signals
       WHERE google_sub = ? AND counted = 1 AND created_at > ?`
    )
      .bind(user.googleSub, cutoff)
      .first();

    used = Number(row?.used ?? 0);
    oldest = row?.oldest === null || row?.oldest === undefined ? null : Number(row.oldest);
  }

  const limit = unlimited ? null : BASIC_DAILY_LIMIT;
  const remaining = unlimited ? null : Math.max(0, BASIC_DAILY_LIMIT - used);

  // The next slot frees when the oldest counted signal leaves the window.
  const resetAtMs =
    !unlimited && used >= BASIC_DAILY_LIMIT && Number.isFinite(oldest)
      ? oldest + ROLLING_WINDOW_MS
      : null;

  return {
    plan: effectivePlanName(user),
    unlimited,
    limit,
    used,
    remaining,
    windowSeconds: ROLLING_WINDOW_SECONDS,
    windowStart,
    resetAt: resetAtMs === null ? null : new Date(resetAtMs).toISOString(),
    resetAtMs,
    resetsInSeconds:
      resetAtMs === null ? null : Math.max(0, Math.ceil((resetAtMs - now) / 1000))
  };
}

/**
 * Reserves a slot for a signal request.
 *
 * @returns {Promise<{allowed: true, id: string} |
 *                  {allowed: false, code: string, usage: object}>}
 */
export async function reserveSignal(env, user, draft, now = Date.now()) {
  if (!env?.DB) {
    throw new Error("Database is not configured.");
  }

  const id = newId();
  const plan = effectivePlanName(user);
  const base = [
    id,
    user.googleSub,
    String(user.email ?? ""),
    String(draft.market ?? ""),
    String(draft.instrument ?? ""),
    String(draft.timeframe ?? ""),
    String(draft.action ?? "pending"),
    plan,
    String(draft.dataSource ?? "live-rates"),
    now
  ];

  if (isUnlimited(user)) {
    await env.DB.prepare(PLAIN_INSERT).bind(...base).run();
    return { allowed: true, id };
  }

  const cutoff = now - ROLLING_WINDOW_MS;

  const result = await env.DB.prepare(GUARDED_INSERT)
    .bind(...base, user.googleSub, cutoff, BASIC_DAILY_LIMIT)
    .run();

  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);

  if (changes === 0) {
    return {
      allowed: false,
      code: "quota_exceeded",
      usage: await getUsage(env, user, now)
    };
  }

  return { allowed: true, id };
}

/**
 * Stores the analysis result on a reserved row.
 */
export async function finalizeSignal(env, id, result) {
  if (!env?.DB) return;

  await env.DB.prepare(
    `UPDATE signals
     SET action = ?, entry = ?, stop_loss = ?, take_profit = ?,
         risk_reward = ?, confidence = ?, explanation = ?, payload = ?
     WHERE id = ?`
  )
    .bind(
      String(result.action ?? "WAIT"),
      result.entry ?? null,
      result.stopLoss ?? null,
      result.takeProfit ?? null,
      result.riskReward ?? null,
      result.confidence ?? null,
      Array.isArray(result.explanation) ? result.explanation.join(" ") : String(result.reason ?? ""),
      JSON.stringify(result).slice(0, 8000),
      id
    )
    .run();
}

/**
 * Refunds a reservation when no signal could be produced.
 * The row is kept for the audit trail but excluded from usage counts.
 */
export async function refundSignal(env, id) {
  if (!env?.DB) return;

  await env.DB.prepare(`UPDATE signals SET counted = 0 WHERE id = ?`).bind(id).run();
}

/** Recent signal history for the owner dashboard or a user's own usage view. */
export async function recentSignals(env, googleSub, limit = 20) {
  if (!env?.DB) return [];

  const rows = await env.DB.prepare(
    `SELECT id, market, instrument, timeframe, action, entry, stop_loss,
            take_profit, risk_reward, confidence, counted, plan_at_request, created_at
     FROM signals
     WHERE google_sub = ?
     ORDER BY created_at DESC
     LIMIT ?`
  )
    .bind(googleSub, Math.max(1, Math.min(200, limit)))
    .all();

  return rows?.results ?? [];
}
