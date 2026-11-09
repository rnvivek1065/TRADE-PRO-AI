/* TRADE PRO AI - Strategy Engine */
"use strict";

window.TRADE_STRATEGIES = (() => {

  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;

  function ema(values, period) {
    const out = Array(values.length).fill(null);
    if (values.length < period) return out;

    let prev = avg(values.slice(0, period));
    out[period - 1] = prev;
    const k = 2 / (period + 1);

    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function rsi(values, period = 14) {
    const out = Array(values.length).fill(null);
    if (values.length <= period) return out;

    let gain = 0, loss = 0;

    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      gain += Math.max(d, 0);
      loss += Math.max(-d, 0);
    }

    let ag = gain / period;
    let al = loss / period;

    out[period] = al === 0 ? 100 :
      100 - 100 / (1 + ag / al);

    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      ag = (ag * (period - 1) + Math.max(d, 0)) / period;
      al = (al * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = al === 0 ? 100 :
        100 - 100 / (1 + ag / al);
    }
    return out;
  }

  function analyze(candles) {
    if (!Array.isArray(candles) || candles.length < 60) {
      return {
        signal: "WAIT",
        reason: "कम से कम 60 कैंडल जरूरी हैं।",
        strategies: []
      };
    }

    const close = candles.map(c => Number(c.close));
    const last = candles.length - 1;

    const e9 = ema(close, 9);
    const e21 = ema(close, 21);
    const e50 = ema(close, 50);
    const r = rsi(close);

    const price = close[last];
    const previous = close[last - 1];

    const results = [];

    function add(name, direction, reason) {
      results.push({ name, direction, reason });
    }

    // Moving Average Crossover
    if (e9[last] !== null && e21[last] !== null) {
      if (e9[last] > e21[last] && e9[last - 1] <= e21[last - 1]) {
        add("EMA Crossover", "BUY", "EMA 9 ने EMA 21 को ऊपर पार किया।");
      } else if (
        e9[last] < e21[last] &&
        e9[last - 1] >= e21[last - 1]
      ) {
        add("EMA Crossover", "SELL", "EMA 9 ने EMA 21 को नीचे पार किया।");
      }
    }

    // Trend Following
    if (e21[last] !== null && e50[last] !== null) {
      if (price > e21[last] && e21[last] > e50[last]) {
        add("Trend Following", "BUY", "कीमत EMA 21 और EMA 50 से ऊपर है।");
      } else if (price < e21[last] && e21[last] < e50[last]) {
        add("Trend Following", "SELL", "कीमत EMA 21 और EMA 50 से नीचे है।");
      }
    }

    // RSI Strategy
    if (r[last] !== null) {
      if (r[last] < 30 && r[last] > r[last - 1]) {
        add("RSI Reversal", "BUY", "RSI Oversold क्षेत्र से ऊपर लौट रहा है।");
      } else if (r[last] > 70 && r[last] < r[last - 1]) {
        add("RSI Reversal", "SELL", "RSI Overbought क्षेत्र से नीचे लौट रहा है।");
      }
    }

    // Momentum
    if (price > previous && price > e21[last]) {
      add("Momentum", "BUY", "कीमत में तेजी और EMA 21 के ऊपर स्थिति।");
    } else if (price < previous && price < e21[last]) {
      add("Momentum", "SELL", "कीमत में कमजोरी और EMA 21 के नीचे स्थिति।");
    }

    // Breakout
    const recent = candles.slice(-21, -1);
    const high = Math.max(...recent.map(c => Number(c.high)));
    const low = Math.min(...recent.map(c => Number(c.low)));

    if (price > high) {
      add("Range Breakout", "BUY", "पिछले 20 कैंडल का High टूटा।");
    } else if (price < low) {
      add("Range Breakout", "SELL", "पिछले 20 कैंडल का Low टूटा।");
    }

    const buys = results.filter(x => x.direction === "BUY").length;
    const sells = results.filter(x => x.direction === "SELL").length;

    let signal = "WAIT";

    if (buys >= 3 && buys > sells) signal = "BUY";
    if (sells >= 3 && sells > buys) signal = "SELL";

    return {
      signal,
      buyVotes: buys,
      sellVotes: sells,
      price,
      rsi: r[last],
      ema9: e9[last],
      ema21: e21[last],
      ema50: e50[last],
      strategies: results
    };
  }

  return { analyze };
})();
