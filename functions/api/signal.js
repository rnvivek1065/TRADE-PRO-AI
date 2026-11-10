/**
 * POST /api/signal
 *
 * Body: { market, symbol, timeframe }
 *
 * The authoritative signal pipeline. Order of operations:
 *
 *   1. Authenticate the session.
 *   2. Reject inactive accounts.
 *   3. Rate limit the caller.
 *   4. Validate CSRF (origin + JSON content type).
 *   5. Validate market, instrument and timeframe against the catalogue.
 *   6. Reserve a quota slot ATOMICALLY (before any provider spend).
 *   7. Fetch real data from Live-Rates.
 *   8. Run the deterministic engine server-side.
 *   9. Persist the result.
 *  10. Return the signal plus accurate quota information.
 *
 * If step 7 or 8 cannot produce a real result the reservation is REFUNDED, so a
 * user is never charged for missing market data or a provider outage.
 *
 * Nothing here trusts a client-supplied plan, role or usage figure.
 */

import { analyze, MIN_BARS } from "../_utils/signal.js";
import { findInstrument, getTimeframe } from "../_utils/markets.js";
import { getDailyCloses, getQuotes, isConfigured, ProviderError } from "../_utils/provider.js";
import { aggregateWeekly } from "../_utils/analysis.js";
import {
  HttpError,
  okResponse,
  readJson,
  requireCsrf,
  requireMethod,
  withErrors
} from "../_utils/http.js";
import { requireUser } from "../_utils/guards.js";
import { LIMITS, enforce } from "../_utils/ratelimit.js";
import {
  finalizeSignal,
  getUsage,
  refundSignal,
  reserveSignal
} from "../_utils/quota.js";

const WEEKLY_MIN_BARS = 30;

export const onRequestPost = withErrors(async ({ request, env }) => {
  const wrongMethod = requireMethod(request, "POST", "POST");
  if (wrongMethod) return wrongMethod;

  const user = await requireUser(request, env);

  const limited = await enforce(env, {
    bucket: `signal:${user.googleSub}`,
    limit: LIMITS.signalPerMinute,
    windowSeconds: 60
  });

  if (limited) return limited;

  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const body = await readJson(request);

  const market = String(body.market ?? "").toLowerCase();
  const symbol = String(body.symbol ?? "");
  const timeframeId = String(body.timeframe ?? "1d").toLowerCase();

  /* -------- 5. validate inputs ----------------------------------------- */
  const instrument = findInstrument(market, symbol);

  if (!instrument) {
    throw new HttpError("invalid_instrument", "That instrument is not supported.", 400);
  }

  const timeframe = getTimeframe(timeframeId);

  if (!timeframe) {
    throw new HttpError("invalid_timeframe", "That timeframe is not recognised.", 400);
  }

  if (!timeframe.available) {
    throw new HttpError("timeframe_unavailable", timeframe.reason, 400, {
      timeframe: timeframe.id
    });
  }

  if (instrument.history === false) {
    throw new HttpError(
      "history_unavailable",
      "The provider publishes no historical series for this instrument, so no signal can be calculated.",
      422,
      { instrument: instrument.id }
    );
  }

  if (!isConfigured(env)) {
    throw new ProviderError(
      "provider_not_configured",
      "Market data is not configured on the server.",
      503
    );
  }

  /* -------- 6. reserve quota ------------------------------------------- */
  const reservation = await reserveSignal(env, user, {
    market: instrument.market,
    instrument: instrument.id,
    timeframe: timeframe.id,
    action: "pending",
    dataSource: "live-rates"
  });

  if (!reservation.allowed) {
    // Proper 429 with the exact moment a slot frees up.
    return Response.json(
      {
        ok: false,
        error: {
          code: "quota_exceeded",
          message:
            `Your ${reservation.usage.plan} plan allows ${reservation.usage.limit} signals per rolling 24 hours. ` +
            "You can generate another signal once the oldest one leaves the window.",
          details: { usage: reservation.usage }
        },
        usage: reservation.usage
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(reservation.usage.resetsInSeconds ?? 3600)
        }
      }
    );
  }

  /* -------- 7-9. fetch, analyse, persist ------------------------------- */
  try {
    const days = timeframe.id === "1w" ? 365 : 150;

    const daily = await getDailyCloses(env, instrument.symbol, days);

    let series = daily.candles;

    if (timeframe.id === "1w") {
      series = aggregateWeekly(series);
    }

    const minBars = timeframe.id === "1w" ? WEEKLY_MIN_BARS : MIN_BARS;

    // A live quote is a bonus, not a requirement: if it fails we still have
    // real closes and the signal is computed from those.
    let quote = null;

    try {
      const live = await getQuotes(env, [instrument.symbol]);
      quote = live.quotes[0] ?? null;
    } catch {
      quote = null;
    }

    const result = analyze({
      closes: series.map(candle => candle.close),
      quote,
      instrument,
      timeframe,
      now: Date.now(),
      minBars,
      dataStatus: {
        source: daily.source,
        from: daily.from,
        to: daily.to,
        providerRequests: daily.requests,
        quoteAt: quote?.timestamp ?? null
      }
    });

    // Missing history is not a signal: refund and report clearly.
    if (!result.dataAvailable) {
      await refundSignal(env, reservation.id);

      const usage = await getUsage(env, user);

      return okResponse(
        {
          signal: result,
          usage,
          charged: false,
          message: "No signal was generated, so no quota was used."
        },
        200
      );
    }

    await finalizeSignal(env, reservation.id, result);

    const usage = await getUsage(env, user);

    return okResponse({
      signal: result,
      signalId: reservation.id,
      usage,
      charged: true
    });
  } catch (error) {
    // Never charge for our own failure.
    await refundSignal(env, reservation.id);
    throw error;
  }
});
