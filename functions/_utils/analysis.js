/**
 * TRADE PRO AI — deterministic analysis primitives.
 *
 * Every function here is pure: same input always produces the same output, no
 * clock, no randomness, no I/O. That makes the signal engine testable and
 * reproducible.
 *
 * DATA REALITY — read before adding an indicator
 * ----------------------------------------------
 * The approved provider (Live-Rates) supplies, historically, DAILY CLOSING
 * PRICES only. It publishes no intraday OHLC and no volume field.
 *
 * Therefore this module deliberately implements ONLY indicators that are
 * mathematically defined on a close series:
 *
 *   available   SMA, EMA, RSI, MACD, Bollinger Bands, close-based structure,
 *               support/resistance, Fibonacci, trend
 *
 *   unavailable ATR, True Range, Stochastic (%K/%D need high/low), ADX, VWAP
 *               (needs volume), OBV/volume analysis (needs volume), and all
 *               candlestick patterns / order blocks / fair value gaps /
 *               liquidity sweeps (need real OHLC or tick data).
 *
 * Nothing is approximated to make an unavailable indicator "work". The engine
 * reports them as unsupported instead (see UNSUPPORTED_FEATURES).
 */

/* -------------------------------------------------------------------------- */
/* Basic series helpers                                                       */
/* -------------------------------------------------------------------------- */

export function toNumbers(values) {
  if (!Array.isArray(values)) return [];

  return values
    .map(value => (typeof value === "number" ? value : Number(value)))
    .filter(value => Number.isFinite(value));
}

export function last(values) {
  return Array.isArray(values) && values.length > 0 ? values[values.length - 1] : null;
}

export function mean(values) {
  const nums = toNumbers(values);
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

/** Population standard deviation. */
export function stdev(values) {
  const nums = toNumbers(values);
  if (nums.length === 0) return null;

  const avg = mean(nums);
  const variance =
    nums.reduce((sum, value) => sum + (value - avg) ** 2, 0) / nums.length;

  return Math.sqrt(variance);
}

export function highest(values, period) {
  const nums = toNumbers(values);
  if (nums.length < period || period <= 0) return null;
  return Math.max(...nums.slice(-period));
}

export function lowest(values, period) {
  const nums = toNumbers(values);
  if (nums.length < period || period <= 0) return null;
  return Math.min(...nums.slice(-period));
}

/* -------------------------------------------------------------------------- */
/* Moving averages                                                            */
/* -------------------------------------------------------------------------- */

/** Simple moving average of the final `period` values. */
export function sma(values, period) {
  const nums = toNumbers(values);
  if (period <= 0 || nums.length < period) return null;
  return mean(nums.slice(-period));
}

/** SMA series aligned to the input; leading entries are null. */
export function smaSeries(values, period) {
  const nums = toNumbers(values);
  const out = new Array(nums.length).fill(null);

  if (period <= 0) return out;

  let running = 0;

  for (let i = 0; i < nums.length; i += 1) {
    running += nums[i];

    if (i >= period) {
      running -= nums[i - period];
    }

    if (i >= period - 1) {
      out[i] = running / period;
    }
  }

  return out;
}

/**
 * Exponential moving average, seeded with the SMA of the first `period`
 * values (the standard convention, so results are reproducible).
 */
export function emaSeries(values, period) {
  const nums = toNumbers(values);
  const out = new Array(nums.length).fill(null);

  if (period <= 0 || nums.length < period) return out;

  const multiplier = 2 / (period + 1);
  const seed = mean(nums.slice(0, period));

  out[period - 1] = seed;

  for (let i = period; i < nums.length; i += 1) {
    out[i] = (nums[i] - out[i - 1]) * multiplier + out[i - 1];
  }

  return out;
}

export function ema(values, period) {
  return last(emaSeries(values, period));
}

/* -------------------------------------------------------------------------- */
/* RSI (Wilder)                                                               */
/* -------------------------------------------------------------------------- */

export function rsi(values, period = 14) {
  const nums = toNumbers(values);

  if (period <= 0 || nums.length < period + 1) return null;

  let gainTotal = 0;
  let lossTotal = 0;

  for (let i = 1; i <= period; i += 1) {
    const delta = nums[i] - nums[i - 1];

    if (delta > 0) gainTotal += delta;
    else lossTotal -= delta;
  }

  let avgGain = gainTotal / period;
  let avgLoss = lossTotal / period;

  for (let i = period + 1; i < nums.length; i += 1) {
    const delta = nums[i] - nums[i - 1];

    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

/* -------------------------------------------------------------------------- */
/* MACD                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @returns {null | {macd, signal, histogram, previousHistogram, trend}}
 */
export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const nums = toNumbers(values);

  if (nums.length < slow + signalPeriod) return null;

  const fastSeries = emaSeries(nums, fast);
  const slowSeries = emaSeries(nums, slow);

  const macdLine = nums
    .map((_, index) => {
      const f = fastSeries[index];
      const s = slowSeries[index];
      return f === null || s === null ? null : f - s;
    })
    .filter(value => value !== null);

  if (macdLine.length < signalPeriod + 1) return null;

  const signalSeries = emaSeries(macdLine, signalPeriod);
  const signalValue = last(signalSeries);

  if (signalValue === null) return null;

  const macdValue = last(macdLine);
  const histogram = macdValue - signalValue;

  const previousSignal = signalSeries[signalSeries.length - 2];
  const previousMacd = macdLine[macdLine.length - 2];
  const previousHistogram =
    previousSignal === null || previousSignal === undefined || previousMacd === null
      ? null
      : previousMacd - previousSignal;

  return {
    macd: macdValue,
    signal: signalValue,
    histogram,
    previousHistogram,
    trend: histogram >= 0 ? "bullish" : "bearish"
  };
}

/* -------------------------------------------------------------------------- */
/* Bollinger Bands                                                            */
/* -------------------------------------------------------------------------- */

export function bollinger(values, period = 20, multiplier = 2) {
  const nums = toNumbers(values);

  if (nums.length < period) return null;

  const window = nums.slice(-period);
  const middle = mean(window);
  const deviation = stdev(window);

  if (middle === null || deviation === null) return null;

  const upper = middle + multiplier * deviation;
  const lower = middle - multiplier * deviation;
  const close = last(nums);

  return {
    upper,
    middle,
    lower,
    deviation,
    bandwidth: middle === 0 ? null : ((upper - lower) / middle) * 100,
    percentB: upper === lower ? null : ((close - lower) / (upper - lower)) * 100
  };
}

/* -------------------------------------------------------------------------- */
/* Market structure (close-based)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Fractal swing detection on closes. Requires `window` bars on each side, so
 * the most recent `window` bars cannot yet form a confirmed swing — that is a
 * property of the method, not a bug.
 */
export function swings(values, window = 2) {
  const nums = toNumbers(values);
  const highs = [];
  const lows = [];

  for (let i = window; i < nums.length - window; i += 1) {
    let isHigh = true;
    let isLow = true;

    for (let j = i - window; j <= i + window; j += 1) {
      if (j === i) continue;
      if (nums[j] >= nums[i]) isHigh = false;
      if (nums[j] <= nums[i]) isLow = false;
    }

    if (isHigh) highs.push({ index: i, price: nums[i] });
    if (isLow) lows.push({ index: i, price: nums[i] });
  }

  return { highs, lows };
}

/**
 * Trend, Break of Structure and Change of Character, derived from confirmed
 * swing points on closes.
 */
export function marketStructure(values, window = 2) {
  const nums = toNumbers(values);

  if (nums.length < window * 2 + 3) return null;

  const { highs, lows } = swings(nums, window);

  if (highs.length < 2 || lows.length < 2) return null;

  const [prevHigh, lastHigh] = highs.slice(-2);
  const [prevLow, lastLow] = lows.slice(-2);
  const close = last(nums);

  const higherHighs = lastHigh.price > prevHigh.price;
  const higherLows = lastLow.price > prevLow.price;
  const lowerHighs = lastHigh.price < prevHigh.price;
  const lowerLows = lastLow.price < prevLow.price;

  let trend = "range";

  if (higherHighs && higherLows) trend = "up";
  else if (lowerHighs && lowerLows) trend = "down";

  let event = null;

  if (close > lastHigh.price) {
    event = trend === "up" ? "bullish_bos" : "bullish_choch";
  } else if (close < lastLow.price) {
    event = trend === "down" ? "bearish_bos" : "bearish_choch";
  }

  return {
    trend,
    event,
    lastSwingHigh: lastHigh.price,
    lastSwingLow: lastLow.price,
    previousSwingHigh: prevHigh.price,
    previousSwingLow: prevLow.price,
    support: lastLow.price,
    resistance: lastHigh.price,
    swingCount: { highs: highs.length, lows: lows.length }
  };
}

/* -------------------------------------------------------------------------- */
/* Fibonacci                                                                  */
/* -------------------------------------------------------------------------- */

const FIB_RATIOS = Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);

/**
 * Retracement levels between a confirmed swing low and swing high.
 * @param {number} swingLow
 * @param {number} swingHigh
 * @param {"up"|"down"|"range"} trend
 */
export function fibonacci(swingLow, swingHigh, trend = "up") {
  if (!Number.isFinite(swingLow) || !Number.isFinite(swingHigh)) return null;
  if (!(swingHigh > swingLow)) return null;

  const range = swingHigh - swingLow;

  return {
    swingLow,
    swingHigh,
    direction: trend,
    levels: FIB_RATIOS.map(ratio => ({
      ratio,
      price: trend === "down" ? swingLow + range * ratio : swingHigh - range * ratio
    }))
  };
}

/* -------------------------------------------------------------------------- */
/* Candle aggregation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Aggregates real daily closes into weekly buckets.
 *
 * This is truthful aggregation of provider data, not invented data: each weekly
 * value is the last real daily close of that ISO week. It is labelled `derived`
 * everywhere it surfaces.
 *
 * @param {Array<{t:number, close:number}>} daily
 * @returns {Array<{t:number, close:number, samples:number}>}
 */
export function aggregateWeekly(daily) {
  if (!Array.isArray(daily) || daily.length === 0) return [];

  const buckets = new Map();

  for (const candle of daily) {
    if (!Number.isFinite(candle?.t) || !Number.isFinite(candle?.close)) continue;

    const date = new Date(candle.t);
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    // ISO week: Thursday-anchored so weeks don't split across year boundaries.
    const dayOfWeek = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
    const weekStart = day - dayOfWeek * 86400000;

    const existing = buckets.get(weekStart);

    if (existing) {
      existing.close = candle.close;
      existing.t = Math.max(existing.t, candle.t);
      existing.samples += 1;
    } else {
      buckets.set(weekStart, { t: candle.t, close: candle.close, samples: 1 });
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => value);
}

/* -------------------------------------------------------------------------- */
/* Capability reporting                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Analysis features that CANNOT be computed from the provider's available data.
 * Surfaced in every signal response so the product never implies more than it
 * can prove.
 */
export const UNSUPPORTED_FEATURES = Object.freeze([
  {
    id: "atr",
    label: "ATR / True Range",
    reason: "Requires intraday or daily high/low values; the provider supplies closing prices only."
  },
  {
    id: "stochastic",
    label: "Stochastic Oscillator",
    reason: "Requires high/low per period; only closing prices are available."
  },
  {
    id: "vwap",
    label: "VWAP",
    reason: "Requires traded volume; the provider publishes no volume field."
  },
  {
    id: "volume_analysis",
    label: "Volume Analysis",
    reason: "Requires traded volume; the provider publishes no volume field."
  },
  {
    id: "candlestick_patterns",
    label: "Candlestick Patterns",
    reason: "Requires real open/high/low/close bars; the provider supplies closing prices only."
  },
  {
    id: "order_blocks",
    label: "Order Blocks",
    reason: "Requires real OHLC bars to identify imbalance zones."
  },
  {
    id: "fair_value_gaps",
    label: "Fair Value Gaps",
    reason: "Requires consecutive real high/low bars; closing prices cannot form a gap."
  },
  {
    id: "liquidity_sweeps",
    label: "Liquidity Sweeps",
    reason: "Requires intrabar highs/lows to detect a sweep."
  },
  {
    id: "intraday_timeframes",
    label: "Intraday Timeframes",
    reason: "The provider has no intraday candlestick endpoint."
  }
]);

export function unsupportedFeatures() {
  return UNSUPPORTED_FEATURES.map(feature => ({ ...feature }));
}

/** Features that ARE computable from a close series. */
export const SUPPORTED_FEATURES = Object.freeze([
  "sma",
  "ema",
  "rsi",
  "macd",
  "bollinger_bands",
  "trend",
  "market_structure",
  "support_resistance",
  "fibonacci"
]);
