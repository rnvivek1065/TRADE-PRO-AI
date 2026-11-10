export async function onRequestGet({ env }) {
  const configured = Boolean(env.LIVE_RATES_API_KEY);

  return new Response(
    JSON.stringify({
      success: true,
      application: "TRADE PRO AI",
      backend: "online",
      liveRatesConfigured: configured,
      message: configured
        ? "Live-Rates API key is configured."
        : "Live-Rates API key is not configured yet."
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}
