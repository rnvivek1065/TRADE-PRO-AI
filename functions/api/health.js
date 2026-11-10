/**
 * GET /api/health
 *
 * Liveness probe. Deliberately unauthenticated so a monitoring check can reach
 * it, and deliberately free of any secret: every value below is a boolean or a
 * public status string. It never returns the provider key, its length or a
 * prefix, and never returns a stack trace.
 */

import { health, isConfigured } from "../_utils/provider.js";
import { okResponse, requireMethod, withErrors } from "../_utils/http.js";

export const onRequestGet = withErrors(async ({ request, env }) => {
  const wrongMethod = requireMethod(request, "GET", "GET");
  if (wrongMethod) return wrongMethod;

  const databaseConfigured = Boolean(env?.DB);
  let databaseReachable = false;

  // Ping D1 for real instead of assuming a configured binding works.
  if (databaseConfigured) {
    try {
      const row = await env.DB.prepare("SELECT 1 AS ok").first();
      databaseReachable = Boolean(row);
    } catch {
      databaseReachable = false;
    }
  }

  const provider = await health(env);

  return okResponse({
    application: "TRADE PRO AI",
    backend: "online",
    databaseConfigured,
    databaseConnected: databaseReachable,
    providerConfigured: isConfigured(env),
    provider,
    message: isConfigured(env)
      ? "Backend is ready."
      : "Market data provider is not configured on the server."
  });
});
