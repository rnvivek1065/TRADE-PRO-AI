/**
 * GET /api/candles?market=forex&symbol=EURUSD&timeframe=1d
 *
 * Real historical data from Live-Rates.
 *
 * The provider publishes DAILY CLOSING PRICES only. There is no intraday
 * OHLC/candlestick endpoint and no volume field, so:
 *
 *   * `1d` returns provider-native daily closes.
 *   * `1w` returns real daily closes aggregated into weekly buckets and is
 *     labelled `derived: true` — aggregation, not new data.
 *   * Intraday timeframes are refused with 400 and an explicit reason rather
 *     than being synthesised.
 *
 * Candles carry `t` and `close` only. No open/high/low/volume is emitted
 * because the provider does not supply them for history; inventing them would
 * be fabricated market data.
 */

import { getDailyCloses, ProviderError, isConfigured } from "../_utils/provider.js";
import { findInstrument, getTimeframe } from "../_utils/markets.js";
import { aggregateWeekly } from "../_utils/analysis.js";
import { MIN_BARS } from "../_utils/signal.js";
import { HttpError, okResponse, requireMethod, withErrors } from "../_utils/http.js";
import { requireUser } from "../_utils/guards.js";
import { LIMITS, enforce } from "../_utils/ratelimit.js";

/** Weekly series need enough daily history to form a usable number of bars. */
const WEEKLY_MIN_BARS = 30;

export const onRequestGet = withErrors(async ({ request, env }) => {
  const wrongMethod = requireMethod(request, "GET", "GET");
  if (wrongMethod) return wrongMethod;

  const user = await requireUser(request, env);

  const limited = await enforce(env, {
    bucket: `candles:${user.googleSub}`,
    limit: LIMITS.readPerMinute,
    windowSeconds: 60
  });

  if (limited) return limited;

  const url = new URL(request.url);
  const market = String(url.searchParams.get("market") ?? "").toLowerCase();
  const symbol = String(url.searchParams.get("symbol") ?? "");
  const timeframeId = String(url.searchParams.get("timeframe") ?? "1d").toLowerCase();

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
      "The provider publishes no historical series for this instrument.",
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

  const daily = await getDailyCloses(env, instrument.symbol, timeframe.id === "1w" ? 365 : 150);

  let candles = daily.candles;

  if (timeframe.id === "1w") {
    candles = aggregateWeekly(candles);
  }

  const minBars = timeframe.id === "1w" ? WEEKLY_MIN_BARS : MIN_BARS;

  return okResponse({
    market: instrument.market,
    instrument: instrument.id,
    instrumentLabel: instrument.label,
    symbol: instrument.symbol,
    timeframe: timeframe.id,
    timeframeLabel: timeframe.label,
    derived: Boolean(timeframe.derived),
    source: daily.source,
    from: daily.from,
    to: daily.to,
    bars: candles.length,
    minBars,
    sufficient: candles.length >= minBars,
    fields: ["t", "close"],
    candles,
    note:
      "Daily closing prices from the approved provider. No open/high/low/volume is " +
      "published for history, so none is returned."
  });
});
