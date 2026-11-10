/**
 * GET /api/quote?symbol=EURUSD
 *
 * Legacy single-symbol alias of /api/quotes.
 *
 * It used to call the provider directly through _utils/liveRates.js with no
 * session check, which meant anonymous traffic could consume provider quota.
 * It now goes through the same authenticated, validated path as /api/quotes so
 * there is exactly ONE provider code path in the application.
 */

import { getQuotes, ProviderError, isConfigured } from "../_utils/provider.js";
import { allSymbols, normalizeSymbol, isExcluded, exclusionReason } from "../_utils/markets.js";
import { HttpError, okResponse, requireMethod, withErrors, clientIp } from "../_utils/http.js";
import { requireUser } from "../_utils/guards.js";
import { LIMITS, enforce } from "../_utils/ratelimit.js";

export const onRequestGet = withErrors(async ({ request, env }) => {
  const wrongMethod = requireMethod(request, "GET", "GET");
  if (wrongMethod) return wrongMethod;

  const user = await requireUser(request, env);

  const limited = await enforce(env, {
    bucket: `quotes:${user.googleSub || clientIp(request)}`,
    limit: LIMITS.readPerMinute,
    windowSeconds: 60
  });

  if (limited) return limited;

  const url = new URL(request.url);
  const raw = String(url.searchParams.get("symbol") ?? "").trim();

  if (raw === "") {
    throw new HttpError("missing_symbol", "A symbol is required.", 400);
  }

  const excluded = exclusionReason(raw);
  if (excluded) {
    throw new HttpError("unsupported_symbol", excluded, 400);
  }

  const symbol = normalizeSymbol(raw);

  if (!new Set(allSymbols()).has(symbol) || isExcluded(symbol)) {
    throw new HttpError("unsupported_symbol", "That symbol is not supported.", 400, {
      symbol
    });
  }

  if (!isConfigured(env)) {
    throw new ProviderError(
      "provider_not_configured",
      "Market data is not configured on the server.",
      503
    );
  }

  const result = await getQuotes(env, [symbol]);
  const quote = result.quotes.find(item => item.symbol === symbol) ?? null;

  if (!quote) {
    throw new HttpError("no_quote", "The provider returned no price for that symbol.", 502, {
      symbol
    });
  }

  return okResponse({
    quote,
    source: result.source,
    fetchedAt: new Date().toISOString()
  });
});
