export async function onRequestGet({ request, env }) {
  const apiKey = env.LIVE_RATES_API_KEY;

  if (!apiKey) {
    return Response.json(
      { success: false, error: "Live-Rates API key is not configured." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();

  if (!symbol || symbol.length > 20) {
    return Response.json(
      { success: false, error: "A valid market symbol is required." },
      { status: 400 }
    );
  }

  try {
    const providerURL = new URL(
      "https://www.live-rates.com/api/price"
    );

    providerURL.searchParams.set("key", apiKey);
    providerURL.searchParams.set("rate", symbol);

    const response = await fetch(providerURL.toString(), {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return Response.json(
        { success: false, error: "Live market provider unavailable." },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (data.error) {
      return Response.json(
        { success: false, error: "Live market data request failed." },
        { status: 502 }
      );
    }

    const item = Array.isArray(data) ? data[0] : data;

    if (!item || !Number.isFinite(Number(item.bid ?? item.rate))) {
      return Response.json(
        { success: false, error: "No valid market price received." },
        { status: 404 }
      );
    }

    return Response.json(
      {
        success: true,
        symbol: item.currency || symbol,
        bid: Number(item.bid ?? item.rate),
        ask: Number(item.ask),
        high: Number(item.high),
        low: Number(item.low),
        open: Number(item.open),
        close: Number(item.close),
        timestamp: Number(item.timestamp)
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    return Response.json(
      { success: false, error: "Unable to retrieve market data." },
      { status: 502 }
    );
  }
}
