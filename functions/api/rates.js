export async function onRequestGet({ env }) {
  const apiKey = env.LIVE_RATES_API_KEY;

  if (!apiKey) {
    return Response.json(
      {
        success: false,
        error: "Live-Rates API key is not configured."
      },
      { status: 503 }
    );
  }

  try {
    const providerURL = new URL(
      "https://www.live-rates.com/rates"
    );

    providerURL.searchParams.set("key", apiKey);

    const response = await fetch(providerURL.toString(), {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return Response.json(
        {
          success: false,
          error: "Live-Rates provider is unavailable."
        },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return Response.json(
        {
          success: false,
          error: "Invalid market data received."
        },
        { status: 502 }
      );
    }

    const rates = data
      .filter(item =>
        item &&
        Number.isFinite(Number(item.bid ?? item.rate))
      )
      .map(item => ({
        symbol: item.currency,
        bid: Number(item.bid ?? item.rate),
        ask: Number(item.ask),
        high: Number(item.high),
        low: Number(item.low),
        open: Number(item.open),
        close: Number(item.close),
        timestamp: Number(item.timestamp)
      }));

    return Response.json(
      {
        success: true,
        count: rates.length,
        rates
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    return Response.json(
      {
        success: false,
        error: "Unable to retrieve market rates."
      },
      { status: 502 }
    );
  }
}
