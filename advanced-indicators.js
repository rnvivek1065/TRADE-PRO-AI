window.TRADE_ADVANCED_INDICATORS = (() => {

  function sma(values, period) {
    return values.map((_, i) => {
      if (i < period - 1) return null;
      const part = values.slice(i - period + 1, i + 1);
      return part.reduce((a, b) => a + b, 0) / period;
    });
  }

  function ema(values, period) {
    const result = Array(values.length).fill(null);
    if (values.length < period) return result;

    let previous = values.slice(0, period)
      .reduce((a, b) => a + b, 0) / period;

    result[period - 1] = previous;
    const multiplier = 2 / (period + 1);

    for (let i = period; i < values.length; i++) {
      previous = (values[i] - previous) * multiplier + previous;
      result[i] = previous;
    }

    return result;
  }

  function adx(candles, period = 14) {
    const tr = [];
    const plusDM = [];
    const minusDM = [];

    candles.forEach((c, i) => {
      if (i === 0) {
        tr.push(c.high - c.low);
        plusDM.push(0);
        minusDM.push(0);
        return;
      }

      const prev = candles[i - 1];
      const up = c.high - prev.high;
      const down = prev.low - c.low;

      plusDM.push(up > down && up > 0 ? up : 0);
      minusDM.push(down > up && down > 0 ? down : 0);

      tr.push(Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      ));
    });

    const atrValues = [];
    const plusDI = [];
    const minusDI = [];
    const dx = [];

    for (let i = 0; i < candles.length; i++) {
      if (i < period - 1) {
        atrValues.push(null);
        plusDI.push(null);
        minusDI.push(null);
        dx.push(null);
        continue;
      }

      const start = i - period + 1;
      const atrValue = tr.slice(start, i + 1)
        .reduce((a, b) => a + b, 0) / period;

      const p = plusDM.slice(start, i + 1)
        .reduce((a, b) => a + b, 0);

      const m = minusDM.slice(start, i + 1)
        .reduce((a, b) => a + b, 0);

      const pdi = atrValue ? (p / period / atrValue) * 100 : 0;
      const mdi = atrValue ? (m / period / atrValue) * 100 : 0;
      const total = pdi + mdi;

      atrValues.push(atrValue);
      plusDI.push(pdi);
      minusDI.push(mdi);
      dx.push(total ? Math.abs(pdi - mdi) / total * 100 : 0);
    }

    return {
      plusDI,
      minusDI,
      adx: sma(dx.map(v => v ?? 0), period)
    };
  }

  function vwap(candles) {
    let totalPV = 0;
    let totalVolume = 0;

    return candles.map(c => {
      const volume = Number(c.volume) || 0;
      const typical = (c.high + c.low + c.close) / 3;

      totalPV += typical * volume;
      totalVolume += volume;

      return totalVolume ? totalPV / totalVolume : null;
    });
  }

  function supertrend(candles, period = 10, multiplier = 3) {
    const result = Array(candles.length).fill(null);
    if (candles.length < period) return result;

    const trs = candles.map((c, i) => {
      if (!i) return c.high - c.low;
      const prev = candles[i - 1];

      return Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      );
    });

    let atrValue = null;
    let upper = null;
    let lower = null;
    let trend = 1;

    for (let i = 0; i < candles.length; i++) {
      if (i === period - 1) {
        atrValue = trs.slice(0, period)
          .reduce((a, b) => a + b, 0) / period;
      } else if (i >= period) {
        atrValue = (atrValue * (period - 1) + trs[i]) / period;
      } else {
        continue;
      }

      const c = candles[i];
      const mid = (c.high + c.low) / 2;
      const basicUpper = mid + multiplier * atrValue;
      const basicLower = mid - multiplier * atrValue;

      upper = upper === null || basicUpper < upper ||
        candles[i - 1].close > upper
        ? basicUpper : upper;

      lower = lower === null || basicLower > lower ||
        candles[i - 1].close < lower
        ? basicLower : lower;

      if (c.close > upper) trend = 1;
      else if (c.close < lower) trend = -1;

      result[i] = {
        value: trend === 1 ? lower : upper,
        trend: trend === 1 ? "UP" : "DOWN"
      };
    }

    return result;
  }

  function ichimoku(candles) {
    function midpoint(index, period) {
      if (index < period - 1) return null;

      const part = candles.slice(index - period + 1, index + 1);
      const high = Math.max(...part.map(c => c.high));
      const low = Math.min(...part.map(c => c.low));

      return (high + low) / 2;
    }

    return candles.map((_, i) => {
      const tenkan = midpoint(i, 9);
      const kijun = midpoint(i, 26);
      const spanB = midpoint(i, 52);

      return {
        tenkan,
        kijun,
        spanA: tenkan !== null && kijun !== null
          ? (tenkan + kijun) / 2 : null,
        spanB,
        chikou: i >= 26 ? candles[i].close : null
      };
    });
  }

  function parabolicSAR(candles, step = 0.02, maxStep = 0.2) {
    const result = Array(candles.length).fill(null);
    if (candles.length < 2) return result;

    let bullish = candles[1].close >= candles[0].close;
    let sar = bullish
      ? candles[0].low
      : candles[0].high;

    let extreme = bullish
      ? candles[1].high
      : candles[1].low;

    let acceleration = step;

    result[0] = sar;

    for (let i = 1; i < candles.length; i++) {
      sar = sar + acceleration * (extreme - sar);

      if (bullish) {
        sar = Math.min(sar, candles[i - 1].low);
        if (i > 1) sar = Math.min(sar, candles[i - 2].low);

        if (candles[i].low < sar) {
          bullish = false;
          sar = extreme;
          extreme = candles[i].low;
          acceleration = step;
        } else if (candles[i].high > extreme) {
          extreme = candles[i].high;
          acceleration = Math.min(maxStep, acceleration + step);
        }
      } else {
        sar = Math.max(sar, candles[i - 1].high);
        if (i > 1) sar = Math.max(sar, candles[i - 2].high);

        if (candles[i].high > sar) {
          bullish = true;
          sar = extreme;
          extreme = candles[i].high;
          acceleration = step;
        } else if (candles[i].low < extreme) {
          extreme = candles[i].low;
          acceleration = Math.min(maxStep, acceleration + step);
        }
      }

      result[i] = sar;
    }

    return result;
  }

  function cci(candles, period = 20) {
    const typical = candles.map(c =>
      (c.high + c.low + c.close) / 3
    );

    const average = sma(typical, period);

    return typical.map((value, i) => {
      if (average[i] === null) return null;

      const part = typical.slice(i - period + 1, i + 1);
      const deviation = part.reduce(
        (sum, v) => sum + Math.abs(v - average[i]), 0
      ) / period;

      return deviation
        ? (value - average[i]) / (0.015 * deviation)
        : 0;
    });
  }

  function mfi(candles, period = 14) {
    const result = Array(candles.length).fill(null);
    const flow = candles.map(c =>
      ((c.high + c.low + c.close) / 3) * (Number(c.volume) || 0)
    );

    for (let i = period; i < candles.length; i++) {
      let positive = 0;
      let negative = 0;

      for (let j = i - period + 1; j <= i; j++) {
        const current = (candles[j].high + candles[j].low + candles[j].close) / 3;
        const previous = (candles[j - 1].high + candles[j - 1].low + candles[j - 1].close) / 3;

        if (current > previous) positive += flow[j];
        else if (current < previous) negative += flow[j];
      }

      result[i] = negative === 0
        ? 100
        : 100 - (100 / (1 + positive / negative));
    }

    return result;
  }

  function obv(candles) {
    let value = 0;

    return candles.map((c, i) => {
      if (i > 0) {
        const volume = Number(c.volume) || 0;

        if (c.close > candles[i - 1].close) value += volume;
        else if (c.close < candles[i - 1].close) value -= volume;
      }

      return value;
    });
  }

  function williamsR(candles, period = 14) {
    return candles.map((c, i) => {
      if (i < period - 1) return null;

      const part = candles.slice(i - period + 1, i + 1);
      const high = Math.max(...part.map(x => x.high));
      const low = Math.min(...part.map(x => x.low));

      return high === low
        ? 0
        : ((high - c.close) / (high - low)) * -100;
    });
  }

  function stochasticRSI(values, period = 14) {
    const rsiValues = (() => {
      const result = Array(values.length).fill(null);
      if (values.length <= period) return result;

      let gain = 0;
      let loss = 0;

      for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];
        gain += Math.max(change, 0);
        loss += Math.max(-change, 0);
      }

      let avgGain = gain / period;
      let avgLoss = loss / period;

      result[period] = avgLoss === 0
        ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

      for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;

        result[i] = avgLoss === 0
          ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }

      return result;
    })();

    return rsiValues.map((value, i) => {
      if (i < period * 2 - 1 || value === null) return null;

      const part = rsiValues.slice(i - period + 1, i + 1)
        .filter(v => v !== null);

      if (part.length < period) return null;

      const high = Math.max(...part);
      const low = Math.min(...part);

      return high === low ? 0 : ((value - low) / (high - low)) * 100;
    });
  }

  function pivotPoints(high, low, close) {
    const pivot = (high + low + close) / 3;

    return {
      pivot,
      r1: 2 * pivot - low,
      s1: 2 * pivot - high,
      r2: pivot + (high - low),
      s2: pivot - (high - low),
      r3: high + 2 * (pivot - low),
      s3: low - 2 * (high - pivot)
    };
  }

  function fibonacci(high, low) {
    const difference = high - low;

    return {
      level0: high,
      level236: high - difference * 0.236,
      level382: high - difference * 0.382,
      level500: high - difference * 0.5,
      level618: high - difference * 0.618,
      level786: high - difference * 0.786,
      level100: low
    };
  }

  return {
    adx,
    vwap,
    supertrend,
    ichimoku,
    parabolicSAR,
    cci,
    mfi,
    obv,
    williamsR,
    stochasticRSI,
    pivotPoints,
    fibonacci
  };

})();
