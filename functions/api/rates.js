/**
 * GET /api/rates
 *
 * Legacy alias kept for compatibility, now served from the approved server-side
 * instrument catalogue instead of calling the provider on every request.
 *
 * The catalogue is the same source /api/quotes validates against, so this
 * endpoint can never advertise an instrument the rest of the app would reject.
 * Provider reachability is reported separately by /api/status and /api/health.
 */

import { listMarkets, listInstruments, allSymbols, MARKET_IDS } from "../_utils/markets.js";
import { okResponse, requireMethod, withErrors, clientIp } from "../_utils/http.js";
import { requireUser } from "../_utils/guards.js";
import { LIMITS, enforce } from "../_utils/ratelimit.js";
import { isConfigured } from "../_utils/provider.js";

export const onRequestGet = withErrors(async ({ request, env }) => {
  const wrongMethod = requireMethod(request, "GET", "GET");
  if (wrongMethod) return wrongMethod;

  const user = await requireUser(request, env);

  const limited = await enforce(env, {
    bucket: `rates:${user.googleSub || clientIp(request)}`,
    limit: LIMITS.readPerMinute,
    windowSeconds: 60
  });

  if (limited) return limited;

  const url = new URL(request.url);
  const marketId = String(url.searchParams.get("market") ?? "").trim();

  const markets = listMarkets();
  const selected = MARKET_IDS.includes(marketId) ? marketId : null;

  const instruments = selected === null
    ? markets.flatMap(market => listInstruments(market.id))
    : listInstruments(selected);

  return okResponse({
    source: "live-rates",
    providerConfigured: isConfigured(env),
    market: selected,
    total: instruments.length,
    instruments: instruments.map(instrument => ({
      symbol: instrument.symbol,
      market: instrument.market,
      label: instrument.label ?? instrument.symbol,
      history: instrument.history ?? "unknown",
      verified: Boolean(instrument.verified)
    })),
    supportedSymbols: allSymbols()
  });
});
