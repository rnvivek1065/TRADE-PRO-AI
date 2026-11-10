/**
 * GET /api/quotes?symbols=EURUSD,BTCUSD
 *
 * Latest real quotes from Live-Rates.
 *
 * Requires an active session: quotes cost provider quota, so anonymous callers
 * must not be able to drive them. Symbols are validated against the approved
 * catalogue before any provider request is made, which prevents arbitrary
 * symbol probing.
 */

import { getQuotes, ProviderError, isConfigured } from "../_utils/provider.js";
import { allSymbols, normalizeSymbol, isExcluded } from "../_utils/markets.js";
import { HttpError, okResponse, requireMethod, withErrors } from "../_utils/http.js";
import { requireUser } from "../_utils/guards.js";
import { LIMITS, enforce } from "../_utils/ratelimit.js";
import { clientIp } from "../_utils/http.js";

const MAX_SYMBOLS = 20;

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
  const raw = String(url.searchParams.get("symbols") ?? "");

  const requested = raw
    .split(",")
    .map(item => normalizeSymbol(item))
    .filter(Boolean);

  if (requested.length === 0) {
    throw new HttpError("missing_symbols", "Provide at least one symbol.", 400);
  }

  if (requested.length > MAX_SYMBOLS) {
    throw new HttpError(
      "too_many_symbols",
      `Request at most ${MAX_SYMBOLS} symbols per call.`,
      400
    );
  }

  const approved = new Set(allSymbols());
  const rejected = requested.filter(symbol => !approved.has(symbol) || isExcluded(symbol));

  if (rejected.length > 0) {
    throw new HttpError("unsupported_symbol", "One or more symbols are not supported.", 400, {
      rejected
    });
  }

  if (!isConfigured(env)) {
    throw new ProviderError(
      "provider_not_configured",
      "Market data is not configured on the server.",
      503
    );
  }

  const result = await getQuotes(env, requested);

  return okResponse({
    quotes: result.quotes,
    missing: result.missing,
    source: result.source,
    fetchedAt: new Date().toISOString()
  });
});
