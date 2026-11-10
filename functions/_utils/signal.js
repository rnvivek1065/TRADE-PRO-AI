/**
 * TRADE PRO AI — deterministic signal engine.
 *
 * Pure function of its inputs: no clock, no randomness, no network. The caller
 * supplies `now` and the real closes. Identical input always yields identical
 * output, which is what makes the engine testable and auditable.
 *
 * HONESTY RULES ENFORCED HERE
 * ---------------------------
 *  1. Nothing is invented. Every indicator is computed from the supplied real
 *     closes. If there are not enough bars, the result is WAIT with
 *     dataAvailable:false — never a fabricated BUY/SELL.
 *  2. WAIT is a first-class outcome. When evidence is mixed, WAIT is returned
 *     instead of forcing a directional call.
 *  3. Unsupported analysis (ATR, stochastic, VWAP, volume, candlestick
 *     patterns, order blocks, fair value gaps, liquidity sweeps) is reported
 *     in `unsupported` with the reason, because the approved provider supplies
 *     daily closes only — no OHLC and no volume.
 *  4. No accuracy, win-rate or backtest claim is made anywhere.
 */

import {
  toNumbers,
  last,
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  marketStructure,
  fibonacci,
  unsupportedFeatures
} from "./analysis.js";

/** Enough history for MACD(26,9) plus signal smoothing to be meaningful. */
export const MIN_BARS = 60;

/** |score| at or above this produces a directional call. */
export const DECISION_THRESHOLD = 0.35;

/** Reward:risk used for the take-profit projection. */
export const REWARD_MULTIPLE = 2;

export const DISCLAIMER =
  "Technical analysis only. No outcome is guaranteed. This is not financial advice.";

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;

  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

/**
 * Builds the weighted evidence list.
 * Each vote is -1 (bearish), 0 (neutral) or +1 (bullish).
 */
function collectVotes(closes, indicators) {
  const votes = [];
  const { structure, rsiValue, macdValue, bands, sma20, sma50, ema20, ema50, close } =
    indicators;

  // --- Trend from confirmed swing structure -------------------------------
  if (structure) {
    votes.push({
      id: "structure_trend",
      label: "Market structure",
      vote: structure.trend === "up" ? 1 : structure.trend === "down" ? -1 : 0,
      weight: 2,
      detail: `Swing structure is ${structure.trend}.`
    });
  }

  // --- Break of structure / change of character --------------------------
  if (structure?.event) {
    const bullish = structure.event.startsWith("bullish");

    votes.push({
      id: "structure_event",
      label: structure.event.startsWith("bullish") ? "Bullish structure break" : "Bearish structure break",
      vote: bullish ? 1 : -1,
      weight: 2,
      detail: `Price confirmed ${structure.event.replace(/_/g, " ")} on closing basis.`
    });
  }

  // --- SMA alignment -----------------------------------------------------
  if (sma20 !== null && sma50 !== null) {
    let vote = 0;

    if (close > sma20 && sma20 > sma50) vote = 1;
    else if (close < sma20 && sma20 < sma50) vote = -1;

    votes.push({
      id: "sma_alignment",
      label: "SMA alignment",
      vote,
      weight: 1.5,
      detail:
        vote === 0
          ? "Price and moving averages are not aligned."
          : `Close ${vote > 0 ? "above" : "below"} SMA20 with SMA20 ${vote > 0 ? "above" : "below"} SMA50.`
    });
  }

  // --- EMA cross ---------------------------------------------------------
  if (ema20 !== null && ema50 !== null) {
    votes.push({
      id: "ema_cross",
      label: "EMA20 / EMA50",
      vote: ema20 > ema50 ? 1 : ema20 < ema50 ? -1 : 0,
      weight: 1,
      detail: `EMA20 is ${ema20 > ema50 ? "above" : "below"} EMA50.`
    });
  }

  // --- RSI ---------------------------------------------------------------
  if (rsiValue !== null) {
    let vote = 0;
    let detail = `RSI(14) is ${round(rsiValue, 2)}.`;

    if (rsiValue <= 30) {
      vote = 1;
      detail += " Oversold condition.";
    } else if (rsiValue >= 70) {
      vote = -1;
      detail += " Overbought condition.";
    } else if (rsiValue > 55) {
      vote = 0.5;
    } else if (rsiValue < 45) {
      vote = -0.5;
    }

    votes.push({ id: "rsi", label: "RSI(14)", vote, weight: 1.5, detail });
  }

  // --- MACD --------------------------------------------------------------
  if (macdValue) {
    let vote = macdValue.histogram >= 0 ? 1 : -1;

    const crossedUp =
      macdValue.previousHistogram !== null && macdValue.previousHistogram < 0 && macdValue.histogram >= 0;
    const crossedDown =
      macdValue.previousHistogram !== null && macdValue.previousHistogram > 0 && macdValue.histogram < 0;

    if (crossedUp) vote = 1;
    if (crossedDown) vote = -1;

    votes.push({
      id: "macd",
      label: "MACD(12,26,9)",
      vote,
      weight: 1.5,
      detail: `Histogram is ${macdValue.histogram >= 0 ? "positive" : "negative"}${
        crossedUp ? " after a bullish crossover" : crossedDown ? " after a bearish crossover" : ""
      }.`
    });
  }

  // --- Bollinger position ------------------------------------------------
  if (bands && bands.percentB !== null) {
    let vote = 0;
    let detail = `Price is at ${round(bands.percentB, 1)}% of the Bollinger range.`;

    if (bands.percentB < 0) {
      vote = 1;
      detail += " Below the lower band.";
    } else if (bands.percentB > 100) {
      vote = -1;
      detail += " Above the upper band.";
    }

    votes.push({ id: "bollinger", label: "Bollinger Bands", vote, weight: 1, detail });
  }

  return votes;
}

/**
 * Derives entry, stop and targets from real structure.
 * Returns nulls when a level cannot be justified — never a guessed number.
 */
function deriveLevels(action, entry, structure) {
  if (action === "WAIT" || !Number.isFinite(entry) || entry <= 0) {
    return { entry: null, stopLoss: null, takeProfit: null, takeProfitLevels: [], riskReward: null };
  }

  const support = structure?.support ?? null;
  const resistance = structure?.resistance ?? null;

  if (action === "BUY") {
    // Stop sits just beyond real support; if support is above entry the level
    // is unusable, so fall back to a defined 2% risk distance.
    let stop = Number.isFinite(support) && support < entry ? support * 0.998 : entry * 0.98;

    let risk = entry - stop;

    if (!(risk > 0)) {
      stop = entry * 0.98;
      risk = entry - stop;
    }

    const target = entry + REWARD_MULTIPLE * risk;

    return {
      entry: round(entry),
      stopLoss: round(stop),
      takeProfit: round(target),
      takeProfitLevels: [
        { label: "TP1 (1R)", price: round(entry + risk) },
        { label: "TP2 (2R)", price: round(target) }
      ],
      riskReward: round(REWARD_MULTIPLE, 2),
      resistance: Number.isFinite(resistance) ? round(resistance) : null
    };
  }

  // SELL
  let stop = Number.isFinite(resistance) && resistance > entry ? resistance * 1.002 : entry * 1.02;

  let risk = stop - entry;

  if (!(risk > 0)) {
    stop = entry * 1.02;
    risk = stop - entry;
  }

  const target = entry - REWARD_MULTIPLE * risk;

  return {
    entry: round(entry),
    stopLoss: round(stop),
    takeProfit: round(target),
    takeProfitLevels: [
      { label: "TP1 (1R)", price: round(entry - risk) },
      { label: "TP2 (2R)", price: round(target) }
    ],
    riskReward: round(REWARD_MULTIPLE, 2),
    support: Number.isFinite(support) ? round(support) : null
  };
}

/**
 * Produces a signal from real daily closes.
 *
 * @param {object} input
 * @param {number[]} input.closes       real closing prices, oldest first
 * @param {object|null} input.quote     live quote, if one was retrieved
 * @param {object} input.instrument     resolved catalogue instrument
 * @param {object} input.timeframe      resolved timeframe definition
 * @param {number} input.now            epoch ms
 * @param {object} [input.dataStatus]   provenance from the provider adapter
 * @returns {object} the signal result
 */
export function analyze({
  closes,
  quote = null,
  instrument,
  timeframe,
  now,
  dataStatus = {},
  minBars = MIN_BARS
}) {
  const values = toNumbers(closes ?? []);
  const unsupported = unsupportedFeatures();

  const base = {
    market: instrument?.market ?? null,
    instrument: instrument?.id ?? null,
    instrumentLabel: instrument?.label ?? null,
    symbol: instrument?.symbol ?? null,
    timeframe: timeframe?.id ?? null,
    timeframeLabel: timeframe?.label ?? null,
    derived: Boolean(timeframe?.derived),
    generatedAt: new Date(now).toISOString(),
    disclaimer: DISCLAIMER,
    unsupported
  };

  /* -------- data availability ------------------------------------------- */
  if (values.length < minBars) {
    return {
      ...base,
      action: "WAIT",
      dataAvailable: false,
      reason: "insufficient_history",
      message:
        `This instrument has ${values.length} usable closes, but ${minBars} are required ` +
        "for a reliable reading. No signal is generated rather than a guessed one.",
      requiredBars: minBars,
      availableBars: values.length,
      confidence: 0,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      takeProfitLevels: [],
      riskReward: null,
      votes: [],
      explanation: [
        `Only ${values.length} of ${minBars} required closes are available.`,
        "No signal was generated to avoid presenting unsupported analysis."
      ],
      dataStatus
    };
  }

  /* -------- indicators -------------------------------------------------- */
  const close = last(values);

  const indicators = {
    close,
    sma20: sma(values, 20),
    sma50: sma(values, 50),
    ema20: ema(values, 20),
    ema50: ema(values, 50),
    rsiValue: rsi(values, 14),
    macdValue: macd(values),
    bands: bollinger(values, 20, 2),
    structure: marketStructure(values, 2)
  };

  const votes = collectVotes(values, indicators);

  const totalWeight = votes.reduce((sum, item) => sum + item.weight, 0);

  const score =
    totalWeight === 0
      ? 0
      : votes.reduce((sum, item) => sum + item.vote * item.weight, 0) / totalWeight;

  /* -------- decision ---------------------------------------------------- */
  let action = "WAIT";

  if (score >= DECISION_THRESHOLD) action = "BUY";
  else if (score <= -DECISION_THRESHOLD) action = "SELL";

  // A directional call requires at least one real bullish/bearish indicator.
  const directionalSupport = votes.some(item => Math.sign(item.vote) === Math.sign(score) && item.vote !== 0);

  if (action !== "WAIT" && !directionalSupport) action = "WAIT";

  /* -------- price levels ------------------------------------------------ */
  // The live quote is used only when it exists; otherwise the last real close.
  const entryPrice = Number.isFinite(quote?.price) ? quote.price : close;

  const levels = deriveLevels(action, entryPrice, indicators.structure);

  /* -------- fibonacci --------------------------------------------------- */
  const structure = indicators.structure;

  const fib =
    structure && structure.lastSwingLow < structure.lastSwingHigh
      ? fibonacci(structure.lastSwingLow, structure.lastSwingHigh, structure.trend)
      : null;

  /* -------- explanation ------------------------------------------------- */
  const explanation = [];

  if (action === "WAIT") {
    explanation.push(
      `Evidence is mixed (weighted score ${round(score, 3)} against a ${DECISION_THRESHOLD} threshold), so the signal is WAIT.`
    );
  } else {
    explanation.push(
      `Weighted evidence score ${round(score, 3)} ${action === "BUY" ? "favours upside" : "favours downside"} for ${instrument?.label ?? instrument?.id}.`
    );
  }

  for (const item of votes) {
    if (item.vote !== 0) explanation.push(item.detail);
  }

  if (structure) {
    explanation.push(
      `Nearest structure support is ${round(structure.support)} and resistance is ${round(structure.resistance)}.`
    );
  }

  if (timeframe?.derived) {
    explanation.push("Weekly values are aggregated from real daily closes, not provider-native candles.");
  }

  return {
    ...base,
    action,
    dataAvailable: true,
    reason: action === "WAIT" ? "mixed_evidence" : "directional",
    score: round(score, 4),
    confidence: Math.round(Math.abs(score) * 100),
    entry: levels.entry,
    stopLoss: levels.stopLoss,
    takeProfit: levels.takeProfit,
    takeProfitLevels: levels.takeProfitLevels,
    riskReward: levels.riskReward,
    votes,
    indicators: {
      close: round(close),
      sma20: round(indicators.sma20),
      sma50: round(indicators.sma50),
      ema20: round(indicators.ema20),
      ema50: round(indicators.ema50),
      rsi14: round(indicators.rsiValue, 2),
      macd: indicators.macdValue
        ? {
            macd: round(indicators.macdValue.macd),
            signal: round(indicators.macdValue.signal),
            histogram: round(indicators.macdValue.histogram)
          }
        : null,
      bollinger: indicators.bands
        ? {
            upper: round(indicators.bands.upper),
            middle: round(indicators.bands.middle),
            lower: round(indicators.bands.lower),
            percentB: round(indicators.bands.percentB, 2)
          }
        : null
    },
    structure: structure
      ? {
          trend: structure.trend,
          event: structure.event,
          support: round(structure.support),
          resistance: round(structure.resistance)
        }
      : null,
    fibonacci: fib
      ? {
          swingLow: round(fib.swingLow),
          swingHigh: round(fib.swingHigh),
          levels: fib.levels.map(level => ({ ratio: level.ratio, price: round(level.price) }))
        }
      : null,
    explanation,
    dataStatus: {
      ...dataStatus,
      bars: values.length,
      lastClose: round(close),
      quoteUsed: Number.isFinite(quote?.price) ? "live" : "last_close"
    }
  };
}
