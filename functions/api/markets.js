/**
 * GET /api/markets
 *
 * Public catalogue: the supported markets and the timeframes that can actually
 * be served. Contains no provider data and costs no provider request, so it is
 * intentionally available before sign-in.
 *
 * Excluded markets (Indian stocks, NSE/BSE, NIFTY/SENSEX and Indian indices)
 * are never listed because they are absent from the catalogue and rejected by
 * the resolver.
 */

import { listMarkets, listTimeframes, MARKET_IDS } from "../_utils/markets.js";
import { okResponse, requireMethod, withErrors } from "../_utils/http.js";

export const onRequestGet = withErrors(async ({ request }) => {
  const wrongMethod = requireMethod(request, "GET", "GET");
  if (wrongMethod) return wrongMethod;

  const markets = listMarkets();
  const timeframes = listTimeframes();

  return okResponse({
    markets,
    marketIds: [...MARKET_IDS],
    timeframes,
    availableTimeframes: timeframes.filter(tf => tf.available).map(tf => tf.id),
    provider: "live-rates"
  });
});
