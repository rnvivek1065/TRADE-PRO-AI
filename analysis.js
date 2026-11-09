"use strict";

window.TRADE_ANALYSIS = (() => {

  function analyze(candles, options = {}) {

    const WAIT = {
      signal: "WAIT",
      strength: 0,
      score: 0,
      reasons: ["पर्याप्त पुष्टि नहीं मिली।"],
      indicators: {},
      candlePatterns: [],
      chartPatterns: [],
      strategies: [],
      smartMoney: {},
      support: null,
      resistance: null,
      entry: null,
      stopLoss: null,
      targets: []
    };

    if (!Array.isArray(candles) || candles.length < 60) {
      WAIT.reasons = ["कम से कम 60 कैंडल जरूरी हैं।"];
      return WAIT;
    }

    const valid = candles.every(c =>
      Number.isFinite(Number(c.open)) &&
      Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) &&
      Number.isFinite(Number(c.close)) &&
      Number(c.high) >= Number(c.low) &&
      Number(c.low) <= Number(c.open) &&
      Number(c.high) >= Number(c.open) &&
      Number(c.low) <= Number(c.close) &&
      Number(c.high) >= Number(c.close)
    );

    if (!valid) {
      WAIT.reasons = ["कैंडल डेटा सही प्रारूप में नहीं है।"];
      return WAIT;
    }

    const indicators = window.TRADE_INDICATORS;
    const advanced = window.TRADE_ADVANCED_INDICATORS;
    const patterns = window.TRADE_PATTERNS;
    const strategyEngine = window.TRADE_STRATEGIES;
    const smartMoneyEngine = window.TRADE_SMART_MONEY;

    if (!indicators || !advanced || !patterns) {
      WAIT.reasons = ["मुख्य Indicator या Pattern module लोड नहीं हुआ।"];
      return WAIT;
    }

    if (!strategyEngine || !smartMoneyEngine) {
      WAIT.reasons = ["Strategies या Smart Money module लोड नहीं हुआ।"];
      return WAIT;
    }

    try {

      const closes = candles.map(c => Number(c.close));
      const volumes = candles.map(c => Number(c.volume) || 0);

      const last = candles.length - 1;
      const price = closes[last];

      // ==================================
      // BASIC INDICATORS
      // ==================================

      const ema20 = indicators.ema(closes, 20);
      const ema50 = indicators.ema(closes, 50);
      const rsi = indicators.rsi(closes, 14);
      const macd = indicators.macd(closes);
      const supertrend = advanced.supertrend(candles);

      const st = supertrend[last];

      if (!st || !macd || !macd.line || !macd.signal) {
        WAIT.reasons = ["Indicator गणना पूरी नहीं हो सकी।"];
        return WAIT;
      }

      const values = {
        price,
        ema20: ema20[last],
        ema50: ema50[last],
        rsi: rsi[last],
        macd: macd.line[last],
        macdSignal: macd.signal[last],
        supertrend: st
      };

      if (
        !Number.isFinite(values.ema20) ||
        !Number.isFinite(values.ema50) ||
        !Number.isFinite(values.rsi) ||
        !Number.isFinite(values.macd) ||
        !Number.isFinite(values.macdSignal) ||
        !st.trend
      ) {
        WAIT.reasons = ["Indicator डेटा अधूरा है।"];
        WAIT.indicators = values;
        return WAIT;
      }

      let score = 0;
      const reasons = [];

      // ==================================
      // EMA TREND
      // ==================================

      if (price > values.ema20 && values.ema20 > values.ema50) {
        score += 2;
        reasons.push("EMA Trend bullish है।");
      } else if (price < values.ema20 && values.ema20 < values.ema50) {
        score -= 2;
        reasons.push("EMA Trend bearish है।");
      }

      // ==================================
      // RSI
      // ==================================

      if (values.rsi >= 50 && values.rsi <= 70) {
        score += 1;
        reasons.push("RSI bullish momentum दिखा रहा है।");
      } else if (values.rsi < 50 && values.rsi >= 30) {
        score -= 1;
        reasons.push("RSI bearish momentum दिखा रहा है।");
      } else {
        reasons.push("RSI extreme zone या neutral स्थिति में है।");
      }

      // ==================================
      // MACD
      // ==================================

      if (values.macd > values.macdSignal) {
        score += 1;
        reasons.push("MACD bullish confirmation।");
      } else if (values.macd < values.macdSignal) {
        score -= 1;
        reasons.push("MACD bearish confirmation।");
      }

      // ==================================
      // SUPERTREND
      // ==================================

      if (st.trend === "UP") {
        score += 2;
        reasons.push("Supertrend bullish है।");
      } else if (st.trend === "DOWN") {
        score -= 2;
        reasons.push("Supertrend bearish है।");
      }

      // ==================================
      // CANDLE PATTERNS
      // ==================================

      const candlePatterns =
        patterns.detectCandlesticks(candles) || [];

      candlePatterns.forEach(pattern => {
        if (pattern.direction === "BULLISH") {
          score += 1;
        }

        if (pattern.direction === "BEARISH") {
          score -= 1;
        }

        reasons.push(pattern.name + " Candlestick Pattern मिला।");
      });

      // ==================================
      // CHART PATTERNS
      // ==================================

      const chartPatterns =
        patterns.detectChartPatterns(candles) || [];

      chartPatterns.forEach(pattern => {
        reasons.push("संभावित " + pattern.name + " Pattern मिला।");
      });

      // ==================================
      // SUPPORT AND RESISTANCE
      // ==================================

      const recent = candles.slice(-20);

      const support = Math.min(
        ...recent.map(c => Number(c.low))
      );

      const resistance = Math.max(
        ...recent.map(c => Number(c.high))
      );

      // ==================================
      // VOLUME CONFIRMATION
      // ==================================

      const averageVolume =
        volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

      const volumeAvailable = averageVolume > 0;

      const volumeConfirmed =
        volumeAvailable && volumes[last] > averageVolume;

      if (volumeConfirmed) {
        reasons.push("Volume औसत से अधिक है।");
      } else {
        reasons.push("मजबूत Volume Confirmation नहीं मिला।");
      }

      // ==================================
      // STRATEGY ENGINE
      // ==================================

      const strategyResult =
        strategyEngine.analyze(candles);

      const strategyList =
        strategyResult.strategies || [];

      const buyVotes = strategyList.filter(
        x => x.direction === "BUY"
      ).length;

      const sellVotes = strategyList.filter(
        x => x.direction === "SELL"
      ).length;

      if (buyVotes >= 3 && buyVotes > sellVotes) {
        score += 2;
        reasons.push("Multiple Strategies BUY की पुष्टि कर रही हैं।");
      } else if (sellVotes >= 3 && sellVotes > buyVotes) {
        score -= 2;
        reasons.push("Multiple Strategies SELL की पुष्टि कर रही हैं।");
      } else {
        reasons.push("Strategies में पर्याप्त एकमत पुष्टि नहीं है।");
      }

      // ==================================
      // SMART MONEY ENGINE
      // ==================================

      const smartMoney =
        smartMoneyEngine.analyze(candles);

      const bullishSweep = smartMoney.liquidity.some(
        x => x.type === "SELL-SIDE LIQUIDITY SWEEP"
      );

      const bearishSweep = smartMoney.liquidity.some(
        x => x.type === "BUY-SIDE LIQUIDITY SWEEP"
      );

      if (bullishSweep) {
        score += 1;
        reasons.push("Sell-side Liquidity Sweep मिला।");
      }

      if (bearishSweep) {
        score -= 1;
        reasons.push("Buy-side Liquidity Sweep मिला।");
      }

      if (smartMoney.fvg.length) {
        reasons.push(
          smartMoney.fvg.length + " संभावित Fair Value Gap मिले।"
        );
      }

      if (smartMoney.orderBlocks.length) {
        reasons.push(
          smartMoney.orderBlocks.length + " संभावित Order Blocks मिले।"
        );
      }

      // ==================================
      // FINAL SIGNAL
      // ==================================

      const minimumScore = options.minimumScore ?? 5;

      let signal = "WAIT";

      if (score >= minimumScore) {
        signal = "BUY";
      } else if (score <= -minimumScore) {
        signal = "SELL";
      }

      if (
        (signal === "BUY" && st.trend !== "UP") ||
        (signal === "SELL" && st.trend !== "DOWN")
      ) {
        signal = "WAIT";
        reasons.push("मुख्य Indicators में विरोध है।");
      }

      if (volumeAvailable && volumes[last] === 0) {
        signal = "WAIT";
        reasons.push("अंतिम Candle का Volume शून्य है।");
      }

      // ==================================
      // ENTRY, STOP LOSS AND TARGETS
      // ==================================

      const trueRanges = [];

      for (let i = Math.max(1, candles.length - 14);
           i < candles.length; i++) {

        const c = candles[i];
        const previousClose = Number(candles[i - 1].close);

        trueRanges.push(
          Math.max(
            Number(c.high) - Number(c.low),
            Math.abs(Number(c.high) - previousClose),
            Math.abs(Number(c.low) - previousClose)
          )
        );
      }

      const atr = trueRanges.length
        ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length
        : 0;

      let entry = null;
      let stopLoss = null;
      let targets = [];

      if (signal !== "WAIT" && atr > 0) {

        const risk = atr * 1.5;

        entry = price;

        if (signal === "BUY") {
          stopLoss = price - risk;

          targets = [
            price + risk,
            price + risk * 2,
            price + risk * 3
          ];

        } else {
          stopLoss = price + risk;

          targets = [
            price - risk,
            price - risk * 2,
            price - risk * 3
          ];
        }

        reasons.push("Entry, Stop Loss और Targets ATR आधारित गणना से निकाले गए हैं।");
      }

      const strength = Math.min(
        100,
        Math.round(Math.abs(score) / 10 * 100)
      );

      return {
        signal,
        strength,
        score,
        reasons,
        indicators: values,
        candlePatterns,
        chartPatterns,
        strategies: strategyList,
        strategyResult,
        smartMoney,
        support,
        resistance,
        volumeConfirmed,
        entry,
        stopLoss,
        targets,
        atr
      };

    } catch (error) {

      console.error("TRADE PRO AI Analysis Error:", error);

      WAIT.reasons = [
        "विश्लेषण के दौरान तकनीकी त्रुटि हुई।",
        error.message || "Unknown error"
      ];

      return WAIT;
    }
  }

  return { analyze };

})();
