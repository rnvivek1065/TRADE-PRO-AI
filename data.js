window.TRADE_DATA = (() => {

  const BINANCE_API = "https://api.binance.com/api/v3/klines";

  const TIMEFRAMES = [
    "1m", "5m", "15m", "30m",
    "1h", "4h", "1d", "1w"
  ];

  function normalizeSymbol(symbol) {
    if (!symbol) {
      throw new Error("Crypto symbol missing.");
    }

    return String(symbol)
      .replace(/^BINANCE:/i, "")
      .replace("/", "")
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase();
  }

  async function getCandles(symbol, timeframe = "15m", limit = 500) {
    const pair = normalizeSymbol(symbol);

    if (!TIMEFRAMES.includes(timeframe)) {
      throw new Error("Unsupported timeframe: " + timeframe);
    }

    const safeLimit = Math.min(
      1000,
      Math.max(1, Math.floor(Number(limit) || 500))
    );

    const url = new URL(BINANCE_API);

    url.searchParams.set("symbol", pair);
    url.searchParams.set("interval", timeframe);
    url.searchParams.set("limit", safeLimit);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error("Binance API error: " + response.status);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Invalid candle data received.");
    }

    return data.map(k => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Number(k[6]),
      isClosed: Date.now() > Number(k[6])
    }));
  }

  async function getLatestPrice(symbol) {
    const pair = normalizeSymbol(symbol);

    const url = new URL(
      "https://api.binance.com/api/v3/ticker/price"
    );

    url.searchParams.set("symbol", pair);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error("Price API error: " + response.status);
    }

    const data = await response.json();

    return {
      symbol: data.symbol,
      price: Number(data.price)
    };
  }

  return {
    getCandles,
    getLatestPrice,
    normalizeSymbol,
    TIMEFRAMES
  };

})();
