/**
 * GET /api/instruments?market=forex
 *
 * Public instrument catalogue for a market. Static configuration only — no
 * provider call, so it is safe before sign-in and cannot be used to exhaust the
 * provider quota.
 */

import { listInstruments, listMarkets, isMarketId } from "../_utils/markets.js";
import { HttpError, okResponse, requireMethod, withErrors } from "../_utils/http.js";

export const onRequestGet = withErrors(async ({ request }) => {
  const wrongMethod = requireMethod(request, "GET", "GET");
  if (wrongMethod) return wrongMethod;

  const url = new URL(request.url);
  const market = String(url.searchParams.get("market") ?? "").toLowerCase();

  if (market === "") {
    return okResponse({
      markets: listMarkets()
    });
  }

  if (!isMarketId(market)) {
    throw new HttpError("invalid_market", "That market is not supported.", 400, {
      supported: listMarkets().map(item => item.id)
    });
  }

  return okResponse({
    market,
    instruments: listInstruments(market)
  });
});
