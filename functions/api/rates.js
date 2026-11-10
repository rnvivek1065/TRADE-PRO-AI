import { getLiveRatesKey } from "../_utils/liveRates.js";

function toNumber(value) {
  if (value === null || value === undefined || value === "" || value === "n/a") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function onRequestGet({ env }) {
  try {
    const apiKey = await getLiveRatesKey(env);

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
          error: "Live market provider unavailable."
        },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.some(item => item?.error)) {
      return Response.json(
        {
          success: false,
          error: "Invalid or unavailable market data."
        },
        { status: 502 }
      );
    }

    const rates = data
      .filter(item => item && item.currency)
      .map(item => ({
        symbol: String(item.currency)
          .replace(/[^a-zA-Z0-9]/g, "")
          .toUpperCase(),
        currency: item.currency,
        bid: toNumber(item.bid ?? item.rate),
        ask: toNumber(item.ask),
        open: toNumber(item.open),
        high: toNumber(item.high),
        low: toNumber(item.low),
        close: toNumber(item.close),
        timestamp: toNumber(item.timestamp)
      }))
      .filter(item => item.symbol && item.bid !== null);

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
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
