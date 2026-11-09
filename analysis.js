window.TRADE_ANALYSIS = (() => {

  function analyze(candles, options = {}) {
    const WAIT = {
      signal: "WAIT",
      strength: 0,
      reasons: ["पर्याप्त पुष्टि नहीं मिली।"],
      indicators: {},
      support: null,
      resistance: null
    };

    if (!Array.isArray(candles) || candles.length < 60) {
      WAIT.reasons = ["विश्लेषण के लिए कम से कम 60 कैंडल जरूरी हैं।"];
      return WAIT;
    }

    const valid = candles.every(c =>
      Number.isFinite(Number(c.open)) &&
      Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) &&
      Number.isFinite(Number(c.close)) &&
      Number(c.high) >= Number(c.low)
    );

    if (!valid) {
      WAIT.reasons = ["कैंडल डेटा सही प्रारूप में उपलब्ध नहीं है।"];
      return WAIT;
    }

    const closes = candles.map(c => Number(c.close));
    const volumes = candles.map(c => Number(c.volume) || 0);

    const indicators = window.TRADE_INDICATORS;
    const advanced = window.TRADE_ADVANCED_INDICATORS;
    const patterns = window.TRADE_PATTERNS;

    if (!indicators || !advanced || !patterns) {
      WAIT.reasons = ["Indicator या Pattern modules अभी लोड नहीं हुए हैं।"];
      return WAIT;
    }

    const ema20 = indicators.ema(closes, 20);
    const ema50 = indicators.ema(closes, 50);
    const rsi = indicators.rsi(closes, 14);
    const macd = indicators.macd(closes);
    const supertrend = advanced.supertrend(candles);

    const last = candles.length - 1;
    const price = closes[last];

    const values = {
      price,
      ema20: ema20[last],
      ema50: ema50[last],
      rsi: rsi[last],
      macd: macd.line[last],
      macdSignal: macd.signal[last],
      supertrend: supertrend[last]
    };

    if (
      values.ema20 === null ||
      values.ema50 === null ||
      values.rsi === null ||
      values.macd === null ||
      values.macdSignal === null ||
      values.supertrend === null
    ) {
      WAIT.reasons = ["Indicator गणना के लिए पर्याप्त डेटा नहीं है।"];
      WAIT.indicators = values;
      return WAIT;
    }

    let score = 0;
    const reasons = [];

    if (price > values.ema20 && values.ema20 > values.ema50) {
      score += 2;
      reasons.push("EMA Trend bullish है।");
    } else if (price < values.ema20 && values.ema20 < values.ema50) {
      score -= 2;
      reasons.push("EMA Trend bearish है।");
    }

    if (values.rsi >= 50 && values.rsi <= 70) {
      score += 1;
      reasons.push("RSI bullish momentum दिखा रहा है।");
    } else if (values.rsi < 50 && values.rsi >= 30) {
      score -= 1;
      reasons.push("RSI bearish momentum दिखा रहा है।");
    } else if (values.rsi > 70 || values.rsi < 30) {
      reasons.push("RSI extreme zone में है।");
    }

    if (values.macd > values.macdSignal) {
      score += 1;
      reasons.push("MACD bullish confirmation दे रहा है।");
    } else if (values.macd < values.macdSignal) {
      score -= 1;
      reasons.push("MACD bearish confirmation दे रहा है।");
    }

    if (values.supertrend.trend === "UP") {
      score += 2;
      reasons.push("Supertrend bullish है।");
    } else {
      score -= 2;
      reasons.push("Supertrend bearish है।");
    }

    const candlePatterns = patterns.detectCandlesticks(candles);

    candlePatterns.forEach(pattern => {
      if (pattern.direction === "BULLISH") score += 1;
      if (pattern.direction === "BEARISH") score -= 1;
      reasons.push(pattern.name + " pattern मिला।");
    });

    const chartPatterns = patterns.detectChartPatterns(candles);

    chartPatterns.forEach(pattern => {
      reasons.push("संभावित " + pattern.name + " मिला।");
    });

    const recent = candles.slice(-20);
    const support = Math.min(...recent.map(c => Number(c.low)));
    const resistance = Math.max(...recent.map(c => Number(c.high)));

    const averageVolume =
      volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

    const volumeAvailable = averageVolume > 0;
    const volumeConfirmed = volumeAvailable &&
      volumes[last] > averageVolume;

    if (volumeConfirmed) {
      reasons.push("Volume औसत से अधिक है।");
    } else if (!volumeAvailable) {
      reasons.push("Volume डेटा उपलब्ध नहीं है।");
    } else {
      reasons.push("Volume Confirmation नहीं मिला।");
    }

    const minimumScore = options.minimumScore ?? 4;

    let signal = "WAIT";

    if (score >= minimumScore) {
      signal = "BUY";
    } else if (score <= -minimumScore) {
      signal = "SELL";
    }

    // अत्यधिक विरोधाभासी संकेतों में WAIT
    if (
      (signal === "BUY" && values.supertrend.trend !== "UP") ||
      (signal === "SELL" && values.supertrend.trend !== "DOWN")
    ) {
      signal = "WAIT";
      reasons.push("मुख्य Indicators में विरोध है।");
    }

    // Volume उपलब्ध हो लेकिन अंतिम कैंडल में volume शून्य हो
    if (volumeAvailable && volumes[last] === 0) {
      signal = "WAIT";
      reasons.push("अंतिम कैंडल का Volume अमान्य है।");
    }

    const strength = Math.min(100, Math.round(
      Math.abs(score) / 6 * 100
    ));

    return {
      signal,
      strength,
      score,
      reasons,
      indicators: values,
      candlePatterns,
      chartPatterns,
      support,
      resistance,
      volumeConfirmed
    };
  }

  return { analyze };

})();
