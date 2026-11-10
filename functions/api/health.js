import { getLiveRatesKey } from "../_utils/liveRates.js";

export async function onRequestGet({ env }) {
  let liveRatesConfigured = false;
  let storage = "not_configured";

  try {
    await getLiveRatesKey(env);
    liveRatesConfigured = true;
    storage = env.DB ? "D1" : "Cloudflare Secret";
  } catch (error) {
    liveRatesConfigured = false;
  }

  return Response.json(
    {
      success: true,
      application: "TRADE PRO AI",
      backend: "online",
      databaseConnected: Boolean(env.DB),
      liveRatesConfigured,
      keyStorage: storage,
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
