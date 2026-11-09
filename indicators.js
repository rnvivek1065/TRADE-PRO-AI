window.TRADE_INDICATORS = (() => {

  function sma(values, period) {
    return values.map((_, i) => {
      if (i < period - 1) return null;
      const slice = values.slice(i - period + 1, i + 1);
      return slice.reduce((a, b) => a + b, 0) / period;
    });
  }

  function ema(values, period) {
    const result = [];
    const multiplier = 2 / (period + 1);
    let previous = null;

    values.forEach((value, i) => {
      if (i === period - 1) {
        previous = values.slice(0, period)
          .reduce((a, b) => a + b, 0) / period;
        result.push(previous);
      } else if (i >= period) {
        previous = (value - previous) * multiplier + previous;
        result.push(previous);
      } else {
        result.push(null);
      }
    });

    return result;
  }

  function rsi(values, period = 14) {
    const result = Array(values.length).fill(null);
    if (values.length <= period) return result;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = values[i] - values[i - 1];
      gains += Math.max(change, 0);
      losses += Math.max(-change, 0);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    result[period] = avgLoss === 0
      ? 100
      : 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < values.length; i++) {
      const change = values[i] - values[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;

      result[i] = avgLoss === 0
        ? 100
        : 100 - (100 / (1 + avgGain / avgLoss));
    }

    return result;
  }

  function macd(values, fast = 12, slow = 26, signal = 9) {
    const fastEMA = ema(values, fast);
    const slowEMA = ema(values, slow);

    const line = values.map((_, i) =>
      fastEMA[i] !== null && slowEMA[i] !== null
        ? fastEMA[i] - slowEMA[i]
        : null
    );

    const validValues = line.filter(v => v !== null);
    const signalValues = ema(validValues, signal);
    const signalLine = Array(values.length).fill(null);

    let index = 0;
    line.forEach((value, i) => {
      if (value !== null) {
        signalLine[i] = signalValues[index++];
      }
    });

    const histogram = line.map((value, i) =>
      value !== null && signalLine[i] !== null
        ? value - signalLine[i]
        : null
    );

    return { line, signal: signalLine, histogram };
  }

  function bollinger(values, period = 20, multiplier = 2) {
    const middle = sma(values, period);

    const upper = [];
    const lower = [];

    values.forEach((_, i) => {
      if (i < period - 1) {
        upper.push(null);
        lower.push(null);
        return;
      }

      const slice = values.slice(i - period + 1, i + 1);
      const average = middle[i];

      const variance = slice.reduce(
        (sum, value) => sum + Math.pow(value - average, 2), 0
      ) / period;

      const deviation = Math.sqrt(variance);

      upper.push(average + multiplier * deviation);
      lower.push(average - multiplier * deviation);
    });

    return { upper, middle, lower };
  }

  function atr(candles, period = 14) {
    const ranges = candles.map((candle, i) => {
      if (i === 0) return candle.high - candle.low;

      const previousClose = candles[i - 1].close;

      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose)
      );
    });

    return sma(ranges, period);
  }

  function stochastic(candles, period = 14) {
    const result = Array(candles.length).fill(null);

    candles.forEach((candle, i) => {
      if (i < period - 1) return;

      const slice = candles.slice(i - period + 1, i + 1);
      const highest = Math.max(...slice.map(c => c.high));
      const lowest = Math.min(...slice.map(c => c.low));

      result[i] = highest === lowest
        ? 50
        : ((candle.close - lowest) / (highest - lowest)) * 100;
    });

    return result;
  }

  return {
    sma,
    ema,
    rsi,
    macd,
    bollinger,
    atr,
    stochastic
  };

})();
