/**
 * TRADE PRO AI — market scope, instrument catalogue and timeframe capability.
 *
 * This module is pure configuration plus pure lookups. It performs no I/O and
 * is safe to import from any Function or test.
 *
 * SCOPE RULES (product requirements, enforced here server-side):
 *   - Supported: cryptocurrency, forex, international stocks, gold, silver,
 *     commodities.
 *   - Excluded:  Indian stocks, NSE, BSE, NIFTY, SENSEX and Indian indices.
 *
 * DATA PROVIDER RULE: Live-Rates is the only approved provider. No other
 * market data source is referenced anywhere in this codebase.
 *
 * IMPORTANT — instrument verification
 * -----------------------------------
 * `providerSymbol` values below are configuration, not claims about the
 * provider. Live-Rates publishes its authoritative instrument list at
 * `/api/rates`, so the adapter validates every requested symbol against that
 * list at runtime (see `functions/_utils/provider.js`). An instrument that the
 * provider does not recognise fails closed with an `unknown_instrument` error
 * instead of producing a price. Nothing here is ever turned into market data.
 */

export const MARKET_IDS = Object.freeze([
  "crypto",
  "forex",
  "stocks",
  "gold",
  "silver",
  "commodities"
]);

const MARKET_LABELS = Object.freeze({
  crypto: "Cryptocurrency",
  forex: "Forex",
  stocks: "International Stocks",
  gold: "Gold",
  silver: "Silver",
  commodities: "Commodities"
});

/**
 * Hard exclusions. Applied to every user-supplied symbol, every catalogue
 * entry and every provider response so Indian instruments can never leak into
 * the product through any path.
 */
const EXCLUSION_RULES = Object.freeze([
  { test: /(^|[:_\s])(NSE|BSE)([:_\s]|$)/i, reason: "Indian exchanges (NSE/BSE) are not supported." },
  { test: /NIFTY|SENSEX|BANKNIFTY|NIFTY50/i, reason: "Indian indices are not supported." },
  { test: /\.(NS|BO)$/i, reason: "Indian listings are not supported." },
  { test: /(^|[:_\s])(INR)([:_\s]|$)/i, reason: "Indian rupee instruments are not supported." }
]);

/**
 * Returns a reason string when the symbol is excluded, otherwise null.
 * Used as a guard on the request path so exclusion is enforced, not merely
 * documented.
 */
export function exclusionReason(symbol) {
  const raw = String(symbol ?? "").trim();

  if (raw === "") {
    return "Instrument is required.";
  }

  for (const rule of EXCLUSION_RULES) {
    if (rule.test.test(raw)) {
      return rule.reason;
    }
  }

  return null;
}

export function isExcluded(symbol) {
  return exclusionReason(symbol) !== null;
}

/**
 * Normalises a user/provider symbol into a bare uppercase pair code, e.g.
 * "eur/usd" -> "EURUSD", "OANDA:XAUUSD" -> "XAUUSD".
 */
export function normalizeSymbol(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Instrument catalogue.
 *
 * `history` describes what the provider can actually supply for this
 * instrument, as verified against the Live-Rates documentation:
 *   "daily" -> daily closing prices are available
 *   "none"  -> no historical data from this provider
 *
 * `verified` is false where the symbol has not yet been confirmed against the
 * provider's live instrument index. Unverified entries still resolve through
 * the runtime validation path, which fails closed.
 */
const CATALOGUE = Object.freeze({
  crypto: [
    { id: "BTCUSD", label: "Bitcoin / USD", symbol: "BTCUSD", history: "daily", verified: true },
    { id: "ETHUSD", label: "Ethereum / USD", symbol: "ETHUSD", history: "daily", verified: true },
    { id: "LTCUSD", label: "Litecoin / USD", symbol: "LTCUSD", history: "daily", verified: false },
    { id: "XRPUSD", label: "XRP / USD", symbol: "XRPUSD", history: "daily", verified: false },
    { id: "BCHUSD", label: "Bitcoin Cash / USD", symbol: "BCHUSD", history: "daily", verified: false },
    { id: "ADAUSD", label: "Cardano / USD", symbol: "ADAUSD", history: "daily", verified: false },
    { id: "SOLUSD", label: "Solana / USD", symbol: "SOLUSD", history: "daily", verified: false },
    { id: "DOTUSD", label: "Polkadot / USD", symbol: "DOTUSD", history: "daily", verified: false }
  ],

  forex: [
    { id: "EURUSD", label: "EUR / USD", symbol: "EURUSD", history: "daily", verified: true },
    { id: "GBPUSD", label: "GBP / USD", symbol: "GBPUSD", history: "daily", verified: true },
    { id: "USDJPY", label: "USD / JPY", symbol: "USDJPY", history: "daily", verified: true },
    { id: "USDCHF", label: "USD / CHF", symbol: "USDCHF", history: "daily", verified: true },
    { id: "AUDUSD", label: "AUD / USD", symbol: "AUDUSD", history: "daily", verified: true },
    { id: "USDCAD", label: "USD / CAD", symbol: "USDCAD", history: "daily", verified: true },
    { id: "NZDUSD", label: "NZD / USD", symbol: "NZDUSD", history: "daily", verified: true },
    { id: "EURGBP", label: "EUR / GBP", symbol: "EURGBP", history: "daily", verified: false },
    { id: "EURJPY", label: "EUR / JPY", symbol: "EURJPY", history: "daily", verified: false },
    { id: "GBPJPY", label: "GBP / JPY", symbol: "GBPJPY", history: "daily", verified: false },
    { id: "EURCHF", label: "EUR / CHF", symbol: "EURCHF", history: "daily", verified: false },
    { id: "AUDJPY", label: "AUD / JPY", symbol: "AUDJPY", history: "daily", verified: false },
    { id: "CADJPY", label: "CAD / JPY", symbol: "CADJPY", history: "daily", verified: false },
    { id: "CHFJPY", label: "CHF / JPY", symbol: "CHFJPY", history: "daily", verified: false },
    { id: "EURAUD", label: "EUR / AUD", symbol: "EURAUD", history: "daily", verified: false },
    { id: "EURCAD", label: "EUR / CAD", symbol: "EURCAD", history: "daily", verified: false },
    { id: "GBPAUD", label: "GBP / AUD", symbol: "GBPAUD", history: "daily", verified: false },
    { id: "GBPCAD", label: "GBP / CAD", symbol: "GBPCAD", history: "daily", verified: false },
    { id: "GBPCHF", label: "GBP / CHF", symbol: "GBPCHF", history: "daily", verified: false },
    { id: "AUDCAD", label: "AUD / CAD", symbol: "AUDCAD", history: "daily", verified: false },
    { id: "AUDCHF", label: "AUD / CHF", symbol: "AUDCHF", history: "daily", verified: false },
    { id: "AUDNZD", label: "AUD / NZD", symbol: "AUDNZD", history: "daily", verified: false },
    { id: "NZDJPY", label: "NZD / JPY", symbol: "NZDJPY", history: "daily", verified: false },
    { id: "NZDCAD", label: "NZD / CAD", symbol: "NZDCAD", history: "daily", verified: false },
    { id: "EURNZD", label: "EUR / NZD", symbol: "EURNZD", history: "daily", verified: false },
    { id: "GBPNZD", label: "GBP / NZD", symbol: "GBPNZD", history: "daily", verified: false },
    { id: "USDSGD", label: "USD / SGD", symbol: "USDSGD", history: "daily", verified: false },
    { id: "USDMXN", label: "USD / MXN", symbol: "USDMXN", history: "daily", verified: false },
    { id: "USDZAR", label: "USD / ZAR", symbol: "USDZAR", history: "daily", verified: false },
    { id: "USDSEK", label: "USD / SEK", symbol: "USDSEK", history: "daily", verified: false },
    { id: "USDNOK", label: "USD / NOK", symbol: "USDNOK", history: "daily", verified: false }
  ],

  /**
   * International equities.
   *
   * Live-Rates does not publish individual equity instruments: its documented
   * coverage is forex, metals, crypto, commodities and indices. The catalogue
   * is therefore intentionally EMPTY rather than filled with symbols that the
   * provider cannot serve. The market is still exposed so the product can
   * report the limitation honestly instead of pretending the asset class
   * works. `dataAvailable` is false for this market everywhere.
   */
  stocks: [],

  gold: [
    { id: "XAUUSD", label: "Gold / USD", symbol: "XAUUSD", history: "daily", verified: true },
    { id: "XAUEUR", label: "Gold / EUR", symbol: "XAUEUR", history: "daily", verified: false },
    { id: "XAUGBP", label: "Gold / GBP", symbol: "XAUGBP", history: "daily", verified: false },
    { id: "XAUJPY", label: "Gold / JPY", symbol: "XAUJPY", history: "daily", verified: false }
  ],

  silver: [
    { id: "XAGUSD", label: "Silver / USD", symbol: "XAGUSD", history: "daily", verified: true },
    { id: "XAGEUR", label: "Silver / EUR", symbol: "XAGEUR", history: "daily", verified: false },
    { id: "XAGGBP", label: "Silver / GBP", symbol: "XAGGBP", history: "daily", verified: false }
  ],

  commodities: [
    { id: "XTIUSD", label: "Crude Oil (WTI) / USD", symbol: "XTIUSD", history: "daily", verified: false },
    { id: "XBRUSD", label: "Brent Oil / USD", symbol: "XBRUSD", history: "daily", verified: false },
    { id: "XNGUSD", label: "Natural Gas / USD", symbol: "XNGUSD", history: "daily", verified: false },
    { id: "XCUUSD", label: "Copper / USD", symbol: "XCUUSD", history: "daily", verified: false },
    { id: "XPTUSD", label: "Platinum / USD", symbol: "XPTUSD", history: "daily", verified: false },
    { id: "XPDUSD", label: "Palladium / USD", symbol: "XPDUSD", history: "daily", verified: false }
  ]
});

/**
 * Markets for which the provider has no instruments at all. Kept explicit so
 * the reason surfaces in the API instead of appearing as an empty list.
 */
const MARKET_UNAVAILABLE_REASON = Object.freeze({
  stocks:
    "The approved market data provider does not publish individual international equities. " +
    "No stock data is available and none is simulated."
});

export function isMarketId(id) {
  return MARKET_IDS.includes(String(id ?? "").toLowerCase());
}

export function marketLabel(id) {
  return MARKET_LABELS[String(id ?? "").toLowerCase()] ?? null;
}

/**
 * Lists markets with their real data availability.
 * @returns {Array<{id,label,dataAvailable,reason,instruments}>}
 */
export function listMarkets() {
  return MARKET_IDS.map(id => {
    const items = (CATALOGUE[id] ?? []).filter(item => !isExcluded(item.symbol));
    const reason = MARKET_UNAVAILABLE_REASON[id] ?? null;

    return {
      id,
      label: MARKET_LABELS[id],
      instruments: items.length,
      dataAvailable: items.length > 0,
      reason: items.length > 0 ? null : reason ?? "No instruments available for this market."
    };
  });
}

/**
 * Instruments for a market, with exclusion applied defensively.
 */
export function listInstruments(marketId) {
  const id = String(marketId ?? "").toLowerCase();

  if (!isMarketId(id)) {
    return null;
  }

  return (CATALOGUE[id] ?? [])
    .filter(item => !isExcluded(item.symbol))
    .map(item => ({
      id: item.id,
      label: item.label,
      market: id,
      symbol: item.symbol,
      history: item.history,
      verified: item.verified
    }));
}

/**
 * Resolves an instrument by market + symbol.
 * Accepts either the catalogue id or the provider symbol.
 * @returns {null | {id,label,market,symbol,history,verified}}
 */
export function findInstrument(marketId, symbol) {
  const id = String(marketId ?? "").toLowerCase();
  const wanted = normalizeSymbol(symbol);

  if (!isMarketId(id) || wanted === "") {
    return null;
  }

  const items = CATALOGUE[id] ?? [];
  const match = items.find(item => item.id === wanted || normalizeSymbol(item.symbol) === wanted);

  if (!match) {
    return null;
  }

  if (isExcluded(match.symbol)) {
    return null;
  }

  return {
    id: match.id,
    label: match.label,
    market: id,
    symbol: match.symbol,
    history: match.history,
    verified: match.verified
  };
}

/**
 * Every symbol the catalogue can resolve, across all markets. Used by the
 * provider adapter to validate requests without trusting user input.
 */
export function allSymbols() {
  const out = new Set();

  for (const id of MARKET_IDS) {
    for (const item of CATALOGUE[id] ?? []) {
      if (!isExcluded(item.symbol)) {
        out.add(normalizeSymbol(item.symbol));
      }
    }
  }

  return [...out];
}

/* -------------------------------------------------------------------------- */
/* Timeframes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Timeframe capability, derived from what Live-Rates actually provides.
 *
 * VERIFIED PROVIDER FACTS (official documentation):
 *   - Quotes (`/api/price`, `/api/rates`) are real-time snapshots only.
 *   - History (`/historical`, `/historical/series`) is DAILY CLOSING PRICES.
 *   - There is no intraday OHLC/candlestick endpoint.
 *   - There is no volume field anywhere in the quote schema.
 *
 * Consequently intraday timeframes are reported as unavailable rather than
 * being built from fabricated or interpolated data. "1w" is marked `derived`
 * because it is a truthful aggregation of real daily closes, not new data.
 */
const TIMEFRAME_DEFINITIONS = Object.freeze({
  "1d": {
    id: "1d",
    label: "1 Day",
    available: true,
    derived: false,
    seconds: 86400,
    source: "provider_daily_closes",
    note: "Daily closing prices from the provider's historical endpoints."
  },
  "1w": {
    id: "1w",
    label: "1 Week",
    available: true,
    derived: true,
    derivedFrom: "1d",
    seconds: 604800,
    source: "aggregated_daily_closes",
    note: "Aggregated from real daily closing prices. Not a provider-native candle."
  },
  "1m": { id: "1m", label: "1 Minute", available: false, seconds: 60 },
  "5m": { id: "5m", label: "5 Minutes", available: false, seconds: 300 },
  "15m": { id: "15m", label: "15 Minutes", available: false, seconds: 900 },
  "30m": { id: "30m", label: "30 Minutes", available: false, seconds: 1800 },
  "1h": { id: "1h", label: "1 Hour", available: false, seconds: 3600 },
  "4h": { id: "4h", label: "4 Hours", available: false, seconds: 14400 }
});

const INTRADAY_UNAVAILABLE_REASON =
  "The approved market data provider publishes daily closing prices only. " +
  "It has no intraday OHLC/candlestick endpoint, so this timeframe cannot be " +
  "served with real data.";

export const TIMEFRAME_IDS = Object.freeze(Object.keys(TIMEFRAME_DEFINITIONS));

/**
 * @returns {null | {id,label,available,derived,seconds,source,reason}}
 */
export function getTimeframe(id) {
  const key = String(id ?? "").toLowerCase();

  if (!Object.prototype.hasOwnProperty.call(TIMEFRAME_DEFINITIONS, key)) {
    return null;
  }

  const def = TIMEFRAME_DEFINITIONS[key];

  if (!def.available) {
    return {
      id: def.id,
      label: def.label,
      available: false,
      derived: false,
      seconds: def.seconds,
      reason: INTRADAY_UNAVAILABLE_REASON
    };
  }

  return {
    id: def.id,
    label: def.label,
    available: true,
    derived: Boolean(def.derived),
    derivedFrom: def.derivedFrom ?? null,
    seconds: def.seconds,
    source: def.source,
    note: def.note ?? null,
    reason: null
  };
}

export function listTimeframes() {
  return TIMEFRAME_IDS.map(id => getTimeframe(id));
}

export function availableTimeframes() {
  return TIMEFRAME_IDS.map(id => getTimeframe(id)).filter(tf => tf.available);
}
