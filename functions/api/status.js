/**
 * GET /api/status
 *
 * Data availability and provider health for signed-in users.
 *
 * Reports what the product can and cannot serve, based on verified provider
 * capabilities. It never returns the API key, only whether it is configured.
 */

import { health, isConfigured } from "../_utils/provider.js";
import { listMarkets, listTimeframes, MARKET_IDS } from "../_utils/markets.js";
import { unsupportedFeatures, SUPPORTED_FEATURES } from "../_utils/analysis.js";
import { okResponse, requireMethod, withErrors } from "../_utils/http.js";
import { requireUser } from "../_utils/guards.js";

export const onRequestGet = withErrors(async ({ request, env }) => {
  const wrongMethod = requireMethod(request, "GET", "GET");
  if (wrongMethod) return wrongMethod;

  await requireUser(request, env);

  const provider = await health(env);
  const timeframes = listTimeframes();

  return okResponse({
    provider: {
      name: "live-rates",
      configured: isConfigured(env),
      ...provider
    },
    markets: listMarkets(),
    marketIds: [...MARKET_IDS],
    timeframes: {
      available: timeframes.filter(tf => tf.available).map(tf => tf.id),
      unavailable: timeframes.filter(tf => !tf.available).map(tf => ({
        id: tf.id,
        reason: tf.reason
      }))
    },
    analysis: {
      supported: SUPPORTED_FEATURES,
      unsupported: unsupportedFeatures()
    }
  });
});
