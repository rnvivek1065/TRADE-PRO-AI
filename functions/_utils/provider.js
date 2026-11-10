/**
 * TRADE PRO AI — Live-Rates provider adapter.
 *
 * Live-Rates is the ONLY approved market data source. This module is the only
 * place in the codebase that talks to it, so provider-specific details cannot
 * leak into endpoints or the signal engine.
 *
 * VERIFIED PROVIDER CAPABILITIES
 * ------------------------------
 * Confirmed against the official Live-Rates documentation:
 *
 *   GET /api/rates?key=          instrument index (pair + last update)
 *   GET /api/price?key=&rate=    full quotes for specific pairs (CSV)
 *   GET /historical/list?key=    instruments with historical coverage
 *   GET /historical?base=&date=&symbols=        closing price for one UTC day
 *   GET /historical/series?base=&start=&end=&symbols=   daily close series
 *
 *   - Quote fields: currency, rate, bid, ask, high, low, open, close,
 *     timestamp. ALL values are STRINGS; `close` may be "n/a".
 *   - `timestamp` is epoch MILLISECONDS as a string.
 *   - Authentication is a `key` query parameter.
 *   - Throttling: more than ~1 request/second averaged over 10 minutes
 *     triggers a temporary lockout with HTTP 503.
 *   - A bad key returns HTTP 200 with an `{"error": ...}` body, so the body
 *     must be inspected rather than trusting the status code.
 *
 * CRITICAL LIMITATION
 * -------------------
 * Historical data is DAILY CLOSING PRICES ONLY. There is no intraday OHLC
 * endpoint and no volume field. Consequently:
 *   - intraday timeframes cannot be served at all;
 *   - high/low/volume based indicators cannot be computed.
 *
 * The adapter never invents a candle, a price or a fill. When the provider
 * cannot supply something, the result is an explicit failure code.
 *
 * RUNTIME VERIFICATION STATUS
 * ---------------------------
 * The exact JSON shape of `/historical/series` could not be confirmed without a
 * live API key, so `parseSeries()` accepts the documented shapes defensively
 * and reports `historical_format_unverified` if none match. It never guesses a
 * value into existence.
 */

const BASE_URL = "https://www.live-rates.com";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_SERIES_DAYS_PER_REQUEST = 30; // documented provider limit
const INDEX_TTL_MS = 60 * 60 * 1000; // 1 hour
const QUOTE_TTL_MS = 15 * 1000; // 15 seconds
const SERIES_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class ProviderError extends Error {
  constructor(code, message, status = 502, details = null) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/* -------------------------------------------------------------------------- */
/* In-isolate TTL cache                                                       */
/* -------------------------------------------------------------------------- */

const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);

  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  // Bound the cache so a long-lived isolate cannot grow without limit.
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearCache() {
  cache.clear();
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/** Reads the API key from the server environment. Never exposed to clients. */
export function apiKey(env) {
  const raw = env?.LIVE_RATES_API_KEY;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

export function isConfigured(env) {
  return apiKey(env) !== null;
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

async function requestJson(env, path, params, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const key = apiKey(env);

  if (!key) {
    throw new ProviderError(
      "provider_not_configured",
      "The market data provider API key is not configured on the server.",
      503
    );
  }

  const url = new URL(path, BASE_URL);

  for (const [name, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value));
    }
  }

  url.searchParams.set("key", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;

  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } catch (error) {
    const aborted = error?.name === "AbortError";

    throw new ProviderError(
      aborted ? "provider_timeout" : "provider_unreachable",
      aborted
        ? "The market data provider did not respond in time."
        : "The market data provider could not be reached.",
      504
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 503) {
    throw new ProviderError(
      "provider_throttled",
      "The market data provider is rate limiting requests. Try again shortly.",
      503
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderError(
      "provider_unauthorized",
      "The market data provider rejected the server credentials.",
      502
    );
  }

  if (!response.ok) {
    throw new ProviderError(
      "provider_error",
      `The market data provider returned HTTP ${response.status}.`,
      502
    );
  }

  let payload;

  try {
    payload = await response.json();
  } catch {
    throw new ProviderError(
      "provider_invalid_response",
      "The market data provider returned a response that is not valid JSON.",
      502
    );
  }

  // A bad key yields HTTP 200 with an error body, so this check is required.
  if (payload && !Array.isArray(payload) && typeof payload === "object" && payload.error) {
    const message = String(payload.error);

    const code = /key|auth|subscription|plan/i.test(message)
      ? "provider_unauthorized"
      : "provider_error";

    throw new ProviderError(code, `The market data provider reported an error: ${message}`, 502);
  }

  return payload;
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                              */
/* -------------------------------------------------------------------------- */

/** Converts a provider numeric string to a number, or null. Never coerces to 0. */
function num(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();

  if (text === "" || /^n\/?a$/i.test(text) || text === "-") return null;

  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
}

/** Provider timestamps are epoch milliseconds encoded as strings. */
function stamp(value) {
  const parsed = num(value);

  if (parsed === null) return null;

  // Tolerate seconds in case the provider changes representation.
  return parsed < 1e12 ? Math.round(parsed * 1000) : Math.round(parsed);
}

/**
 * Normalises one provider quote object.
 * Returns null when the record has no usable price, so an empty or malformed
 * entry can never be presented as market data.
 */
export function normalizeQuote(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;

  const symbol = String(raw.currency ?? raw.pair ?? raw.rate ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (symbol === "") return null;

  const price = num(raw.rate) ?? num(raw.close) ?? num(raw.bid) ?? num(raw.ask);

  if (price === null) return null;

  const timestamp = stamp(raw.timestamp) ?? stamp(raw.ts) ?? null;

  return {
    symbol,
    price,
    bid: num(raw.bid),
    ask: num(raw.ask),
    open: num(raw.open),
    high: num(raw.high),
    low: num(raw.low),
    close: num(raw.close),
    timestamp,
    ageSeconds: timestamp === null ? null : Math.max(0, Math.round((now - timestamp) / 1000)),
    source: "live-rates"
  };
}

/* -------------------------------------------------------------------------- */
/* Quotes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Latest real quotes for the requested symbols.
 *
 * @param {object} env
 * @param {string[]} symbols normalised pair codes, e.g. ["EURUSD","BTCUSD"]
 * @returns {Promise<{quotes: object[], missing: string[], source: string}>}
 */
export async function getQuotes(env, symbols) {
  const wanted = [...new Set((symbols ?? []).map(s => String(s).toUpperCase()))].filter(Boolean);

  if (wanted.length === 0) {
    return { quotes: [], missing: [], source: "live-rates" };
  }

  const cacheKey = `quotes:${wanted.slice().sort().join(",")}`;
  const cached = cacheGet(cacheKey);

  if (cached) {
    return cached;
  }

  const payload = await requestJson(env, "/api/price", { rate: wanted.join(",") });

  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rates)
      ? payload.rates
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  const quotes = records.map(record => normalizeQuote(record)).filter(Boolean);

  const found = new Set(quotes.map(quote => quote.symbol));
  const missing = wanted.filter(symbol => !found.has(symbol));

  const result = { quotes, missing, source: "live-rates" };

  if (quotes.length > 0) {
    cacheSet(cacheKey, result, QUOTE_TTL_MS);
  }

  return result;
}

/**
 * Authoritative instrument index published by the provider.
 * Used to validate that a requested symbol genuinely exists before any price
 * is trusted.
 *
 * @returns {Promise<Set<string>>}
 */
export async function getInstrumentIndex(env) {
  const cached = cacheGet("index");

  if (cached) return cached;

  const payload = await requestJson(env, "/api/rates", {});
  const records = Array.isArray(payload) ? payload : Array.isArray(payload?.rates) ? payload.rates : [];

  const index = new Set();

  for (const record of records) {
    const code = String(record?.currency ?? record?.pair ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (code !== "") index.add(code);
  }

  if (index.size > 0) {
    cacheSet("index", index, INDEX_TTL_MS);
  }

  return index;
}

/**
 * Verifies requested symbols against the provider index.
 * Fails OPEN only when the index is unavailable, so a transient index failure
 * does not break quote fetching; a symbol the provider explicitly does not
 * list fails CLOSED.
 *
 * @returns {Promise<{unknown: string[], checked: boolean}>}
 */
export async function validateSymbols(env, symbols) {
  try {
    const index = await getInstrumentIndex(env);

    if (index.size === 0) {
      return { unknown: [], checked: false };
    }

    return {
      unknown: (symbols ?? []).filter(symbol => !index.has(String(symbol).toUpperCase())),
      checked: true
    };
  } catch {
    return { unknown: [], checked: false };
  }
}

/* -------------------------------------------------------------------------- */
/* Historical daily closes                                                    */
/* -------------------------------------------------------------------------- */

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Splits "EURUSD" into { base: "EUR", quote: "USD" }. */
export function splitSymbol(symbol) {
  const code = String(symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (code.length < 6) return null;

  return { base: code.slice(0, 3), quote: code.slice(3, 6) };
}

/**
 * Parses a provider series payload into daily closes.
 *
 * The documented shape is a `base` plus per-date values for the requested
 * quote currency. Because the exact envelope could not be confirmed without a
 * live key, several plausible shapes are accepted and anything unrecognised
 * returns null instead of a guessed value.
 *
 * @returns {Array<{t:number, close:number}>|null}
 */
export function parseSeries(payload, quoteCurrency) {
  if (!payload) return null;

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.series)
      ? payload.series
      : Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.rates)
          ? payload.rates
          : null;

  if (!rows) return null;

  const out = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const rawDate = row.date ?? row.timestamp ?? row.time ?? row.t ?? row.day;

    let time = null;

    if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
      time = Date.parse(`${rawDate.slice(0, 10)}T00:00:00Z`);
    } else {
      const numeric = num(rawDate);
      time = numeric === null ? null : numeric < 1e12 ? Math.round(numeric * 1000) : Math.round(numeric);
    }

    if (time === null || Number.isNaN(time)) continue;

    const candidates = [
      row[quoteCurrency],
      row.rates?.[quoteCurrency],
      row.values?.[quoteCurrency],
      row.symbols?.[quoteCurrency],
      row.close,
      row.value,
      row.rate
    ];

    let close = null;

    for (const candidate of candidates) {
      close = num(candidate);
      if (close !== null) break;
    }

    if (close === null) continue;

    out.push({ t: time, close });
  }

  if (out.length === 0) return null;

  out.sort((a, b) => a.t - b.t);

  // De-duplicate by day, keeping the last observation.
  const byDay = new Map();

  for (const candle of out) {
    byDay.set(isoDate(candle.t), candle);
  }

  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

/**
 * Fetches real daily closing prices for an instrument.
 *
 * Requests are chunked to the provider's documented 30-day window limit. If any
 * chunk fails, the whole call fails: a partial series is never silently
 * presented as complete.
 *
 * @param {object} env
 * @param {string} symbol e.g. "EURUSD"
 * @param {number} days how many calendar days of history
 * @returns {Promise<{candles: Array<{t:number,close:number}>, source: string,
 *                    from: string, to: string, requests: number}>}
 */
export async function getDailyCloses(env, symbol, days = 120) {
  const parts = splitSymbol(symbol);

  if (!parts) {
    throw new ProviderError(
      "invalid_instrument",
      "The instrument code cannot be interpreted as a base/quote pair.",
      400
    );
  }

  const total = Math.max(1, Math.min(365, Math.floor(days)));
  const cacheKey = `series:${parts.base}${parts.quote}:${total}`;
  const cached = cacheGet(cacheKey);

  if (cached) return cached;

  const end = Date.now();
  const windows = [];

  for (let offset = total; offset > 0; offset -= MAX_SERIES_DAYS_PER_REQUEST) {
    const span = Math.min(MAX_SERIES_DAYS_PER_REQUEST, offset);
    const windowEnd = end - (offset - span) * 86400000;
    const windowStart = windowEnd - span * 86400000;

    windows.push({ start: isoDate(windowStart), end: isoDate(windowEnd) });
  }

  const collected = new Map();
  let requests = 0;

  for (const window of windows) {
    requests += 1;

    const payload = await requestJson(env, "/historical/series", {
      base: parts.base,
      start: window.start,
      end: window.end,
      symbols: parts.quote
    });

    const parsed = parseSeries(payload, parts.quote);

    if (parsed === null) {
      throw new ProviderError(
        "historical_format_unverified",
        "The provider's historical response could not be interpreted, so no candles were produced.",
        502,
        { window: { start: window.start, end: window.end } }
      );
    }

    for (const candle of parsed) {
      collected.set(isoDate(candle.t), candle);
    }
  }

  const candles = [...collected.values()].sort((a, b) => a.t - b.t);

  if (candles.length === 0) {
    throw new ProviderError(
      "no_historical_data",
      "The provider returned no historical data for this instrument.",
      404
    );
  }

  const result = {
    candles,
    source: "live-rates",
    from: isoDate(candles[0].t),
    to: isoDate(candles[candles.length - 1].t),
    requests
  };

  cacheSet(cacheKey, result, SERIES_TTL_MS);

  return result;
}

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Provider health without consuming a paid endpoint: configuration presence
 * plus a real instrument-index probe.
 */
export async function health(env) {
  if (!isConfigured(env)) {
    return {
      provider: "live-rates",
      configured: false,
      reachable: false,
      status: "not_configured",
      message: "LIVE_RATES_API_KEY is not set on the server."
    };
  }

  try {
    const index = await getInstrumentIndex(env);

    return {
      provider: "live-rates",
      configured: true,
      reachable: true,
      status: index.size > 0 ? "ok" : "degraded",
      instruments: index.size,
      message:
        index.size > 0
          ? "Provider reachable."
          : "Provider reachable but returned an empty instrument index."
    };
  } catch (error) {
    return {
      provider: "live-rates",
      configured: true,
      reachable: false,
      status: "error",
      code: error?.code ?? "provider_error",
      message: error?.message ?? "Provider check failed."
    };
  }
}

export const LIMITS = Object.freeze({
  maxSeriesDaysPerRequest: MAX_SERIES_DAYS_PER_REQUEST,
  quoteCacheSeconds: QUOTE_TTL_MS / 1000,
  seriesCacheSeconds: SERIES_TTL_MS / 1000
});
