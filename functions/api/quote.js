import { getLiveRatesKey } from "../_utils/liveRates.js";

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const symbol = (url.searchParams.get("symbol") || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  if (!symbol || symbol.length > 20) {
    return Response.json(
      { success: false, error: "A valid market symbol is required." },
      { status: 400 }
    );
  }

  try {
    const apiKey = await getLiveRatesKey(env);

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
    const item = Array.isArray(data) ? data[0] : data;

    if (!item || item.error) {
      return Response.json(
        { success: false, error: "Market data not found." },
        { status: 404 }
      );
    }

    const bid = safeNumber(item.bid ?? item.rate);

    if (bid === null) {
      return Response.json(
        { success: false, error: "Invalid market price received." },
        { status: 502 }
      );
    }

    return Response.json(
      {
        success: true,
        symbol: item.currency || symbol,
        bid,
        ask: safeNumber(item.ask),
        high: safeNumber(item.high),
        low: safeNumber(item.low),
        open: safeNumber(item.open),
        close: safeNumber(item.close),
        timestamp: safeNumber(item.timestamp)
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    return Response.json(
      {
        success: false,
        error: "Unable to retrieve market data."
      },
      { status: 502 }
    );
  }
}
