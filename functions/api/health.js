import { getLiveRatesKey } from "../_utils/liveRates.js";

export async function onRequestGet({ env }) {
  let liveRatesConfigured = false;
  let keyStorage = "not_configured";
  let databaseConfigured = Boolean(env.DB);
  let databaseReachable = false;

  // Ping D1 for real instead of assuming that a configured binding works.
  // A missing table or a bad database_id used to be reported as "D1".
  if (databaseConfigured) {
    try {
      const row = await env.DB.prepare("SELECT 1 AS ok").first();
      databaseReachable = Boolean(row);
    } catch (error) {
      console.error("health: D1 ping failed", {
        message: error?.message
      });

      databaseReachable = false;
    }
  }

  try {
    await getLiveRatesKey(env);
    liveRatesConfigured = true;
    keyStorage = databaseReachable ? "database" : "environment";
  } catch {
    liveRatesConfigured = false;
  }

  return Response.json(
    {
      success: true,
      application: "TRADE PRO AI",
      backend: "online",
      databaseConfigured,
      databaseConnected: databaseReachable,
      liveRatesConfigured,
      keyStorage,
      message: liveRatesConfigured
        ? "Backend is ready."
        : "Live-Rates API key is not configured."
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
