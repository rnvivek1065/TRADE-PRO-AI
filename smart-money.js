/* TRADE PRO AI - Smart Money Analysis */
"use strict";

window.TRADE_SMART_MONEY = (() => {

  function analyze(candles) {
    if (!Array.isArray(candles) || candles.length < 30) {
      return { fvg: [], orderBlocks: [], liquidity: [], swings: [] };
    }

    const fvg = [];
    const orderBlocks = [];
    const liquidity = [];
    const swings = [];

    // Fair Value Gaps
    for (let i = 2; i < candles.length; i++) {
      const a = candles[i - 2];
      const c = candles[i];

      if (Number(c.low) > Number(a.high)) {
        fvg.push({
          type: "BULLISH FVG",
          low: Number(a.high),
          high: Number(c.low),
          index: i
        });
      }

      if (Number(c.high) < Number(a.low)) {
        fvg.push({
          type: "BEARISH FVG",
          low: Number(c.high),
          high: Number(a.low),
          index: i
        });
      }
    }

    // Swing High / Swing Low
    for (let i = 2; i < candles.length - 2; i++) {
      const c = candles[i];

      const left = candles.slice(i - 2, i);
      const right = candles.slice(i + 1, i + 3);

      if (
        left.every(x => c.high > x.high) &&
        right.every(x => c.high > x.high)
      ) {
        swings.push({
          type: "SWING HIGH",
          price: Number(c.high),
          index: i
        });
      }

      if (
        left.every(x => c.low < x.low) &&
        right.every(x => c.low < x.low)
      ) {
        swings.push({
          type: "SWING LOW",
          price: Number(c.low),
          index: i
        });
      }
    }

    // Basic Order Block candidates
    for (let i = 1; i < candles.length - 1; i++) {
      const previous = candles[i - 1];
      const current = candles[i];

      const bullish = previous.close < previous.open &&
        current.close > previous.high;

      const bearish = previous.close > previous.open &&
        current.close < previous.low;

      if (bullish) {
        orderBlocks.push({
          type: "BULLISH ORDER BLOCK",
          low: Number(previous.low),
          high: Number(previous.high),
          index: i - 1
        });
      }

      if (bearish) {
        orderBlocks.push({
          type: "BEARISH ORDER BLOCK",
          low: Number(previous.low),
          high: Number(previous.high),
          index: i - 1
        });
      }
    }

    // Liquidity Sweeps
    const recent = candles.slice(-21, -1);

    const previousHigh = Math.max(...recent.map(c => Number(c.high)));
    const previousLow = Math.min(...recent.map(c => Number(c.low)));

    const last = candles[candles.length - 1];

    if (last.high > previousHigh && last.close < previousHigh) {
      liquidity.push({
        type: "BUY-SIDE LIQUIDITY SWEEP",
        price: previousHigh
      });
    }

    if (last.low < previousLow && last.close > previousLow) {
      liquidity.push({
        type: "SELL-SIDE LIQUIDITY SWEEP",
        price: previousLow
      });
    }

    return {
      fvg,
      orderBlocks,
      liquidity,
      swings
    };
  }

  return { analyze };
})();
