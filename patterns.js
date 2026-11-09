window.TRADE_PATTERNS = (() => {

  function candleInfo(c) {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;

    return {
      bullish: c.close > c.open,
      bearish: c.close < c.open,
      body,
      range,
      upperWick: c.high - Math.max(c.open, c.close),
      lowerWick: Math.min(c.open, c.close) - c.low
    };
  }

  function detectCandlesticks(candles) {
    const results = [];
    if (!candles || candles.length < 3) return results;

    const i = candles.length - 1;
    const c = candles[i];
    const p = candles[i - 1];
    const pp = candles[i - 2];

    const x = candleInfo(c);
    const y = candleInfo(p);
    const z = candleInfo(pp);

    const body = Math.max(x.body, Number.EPSILON);
    const smallBody = x.range > 0 && x.body <= x.range * 0.1;
    const longLower = x.lowerWick >= body * 2;
    const longUpper = x.upperWick >= body * 2;

    function add(name, direction, description) {
      results.push({ name, direction, description });
    }

    if (smallBody) {
      add("Doji", "NEUTRAL", "Open aur Close lagbhag barabar hain.");
    }

    if (longLower && x.upperWick <= body * 0.5) {
      if (x.bullish) {
        add("Hammer", "BULLISH", "Neeche lambi wick aur chhota body.");
      } else {
        add("Hanging Man", "BEARISH", "Possible bearish reversal shape.");
      }
    }

    if (longUpper && x.lowerWick <= body * 0.5) {
      if (x.bearish) {
        add("Shooting Star", "BEARISH", "Upar lambi wick aur chhota body.");
      } else {
        add("Inverted Hammer", "BULLISH", "Possible bullish reversal shape.");
      }
    }

    if (y.bearish && x.bullish &&
        c.open <= p.close && c.close >= p.open) {
      add("Bullish Engulfing", "BULLISH", "Current candle ne previous body ko cover kiya.");
    }

    if (y.bullish && x.bearish &&
        c.open >= p.close && c.close <= p.open) {
      add("Bearish Engulfing", "BEARISH", "Current candle ne previous body ko cover kiya.");
    }

    if (x.range > 0 && x.body / x.range >= 0.9) {
      add(
        x.bullish ? "Bullish Marubozu" : "Bearish Marubozu",
        x.bullish ? "BULLISH" : "BEARISH",
        "Candle body bahut bada aur wicks chhoti hain."
      );
    }

    if (z.bearish && y.body < z.body * 0.5 &&
        x.bullish && c.close > (pp.open + pp.close) / 2) {
      add("Morning Star", "BULLISH", "Three-candle possible bullish reversal.");
    }

    if (z.bullish && y.body < z.body * 0.5 &&
        x.bearish && c.close < (pp.open + pp.close) / 2) {
      add("Evening Star", "BEARISH", "Three-candle possible bearish reversal.");
    }

    if (y.bearish && x.bullish &&
        c.open < p.low && c.close > (p.open + p.close) / 2 &&
        c.close < p.open) {
      add("Piercing Pattern", "BULLISH", "Bullish candle previous body ke midpoint se upar close hui.");
    }

    if (y.bullish && x.bearish &&
        c.open > p.high && c.close < (p.open + p.close) / 2 &&
        c.close > p.open) {
      add("Dark Cloud Cover", "BEARISH", "Bearish candle previous body ke midpoint se neeche close hui.");
    }

    if (y.bearish && x.bullish &&
        c.open > p.close && c.close < p.open) {
      add("Bullish Harami", "BULLISH", "Small bullish body previous bearish body ke andar hai.");
    }

    if (y.bullish && x.bearish &&
        c.open < p.close && c.close > p.open) {
      add("Bearish Harami", "BEARISH", "Small bearish body previous bullish body ke andar hai.");
    }

    if (candles.length >= 3) {
      const a = candleInfo(candles[i - 2]);
      const b = candleInfo(candles[i - 1]);
      const d = candleInfo(candles[i]);

      if (a.bullish && b.bullish && d.bullish &&
          candles[i - 1].close > candles[i - 2].close &&
          c.close > p.close &&
          a.body > a.range * 0.5 &&
          b.body > b.range * 0.5 &&
          d.body > d.range * 0.5) {
        add("Three White Soldiers", "BULLISH", "Three consecutive strong bullish candles.");
      }

      if (a.bearish && b.bearish && d.bearish &&
          candles[i - 1].close < candles[i - 2].close &&
          c.close < p.close &&
          a.body > a.range * 0.5 &&
          b.body > b.range * 0.5 &&
          d.body > d.range * 0.5) {
        add("Three Black Crows", "BEARISH", "Three consecutive strong bearish candles.");
      }
    }

    return results;
  }

  function findSwings(candles, strength = 3) {
    const highs = [];
    const lows = [];

    for (let i = strength; i < candles.length - strength; i++) {
      const h = candles[i].high;
      const l = candles[i].low;

      const isHigh = candles.slice(i - strength, i + strength + 1)
        .every((c, j) => j === strength || h >= c.high);

      const isLow = candles.slice(i - strength, i + strength + 1)
        .every((c, j) => j === strength || l <= c.low);

      if (isHigh) highs.push({ index: i, price: h });
      if (isLow) lows.push({ index: i, price: l });
    }

    return { highs, lows };
  }

  function detectChartPatterns(candles) {
    const results = [];
    if (!candles || candles.length < 30) return results;

    const swings = findSwings(candles);
    const highs = swings.highs.slice(-5);
    const lows = swings.lows.slice(-5);

    function near(a, b, tolerance = 0.015) {
      return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-10) <= tolerance;
    }

    if (highs.length >= 2) {
      const a = highs[highs.length - 2];
      const b = highs[highs.length - 1];

      if (near(a.price, b.price) && b.index > a.index + 3) {
        results.push({
          name: "Double Top",
          direction: "BEARISH",
          description: "Do milte-julte swing highs mile hain; neckline confirmation zaroori hai."
        });
      }
    }

    if (lows.length >= 2) {
      const a = lows[lows.length - 2];
      const b = lows[lows.length - 1];

      if (near(a.price, b.price) && b.index > a.index + 3) {
        results.push({
          name: "Double Bottom",
          direction: "BULLISH",
          description: "Do milte-julte swing lows mile hain; neckline confirmation zaroori hai."
        });
      }
    }

    if (highs.length >= 3) {
      const a = highs[highs.length - 3];
      const b = highs[highs.length - 2];
      const c = highs[highs.length - 1];

      if (b.price > a.price && b.price > c.price &&
          near(a.price, c.price, 0.03) &&
          b.index > a.index && c.index > b.index) {
        results.push({
          name: "Possible Head and Shoulders",
          direction: "BEARISH",
          description: "Teen swing highs mein beech wala sabse uncha hai."
        });
      }
    }

    if (lows.length >= 3) {
      const a = lows[lows.length - 3];
      const b = lows[lows.length - 2];
      const c = lows[lows.length - 1];

      if (b.price < a.price && b.price < c.price &&
          near(a.price, c.price, 0.03) &&
          b.index > a.index && c.index > b.index) {
        results.push({
          name: "Possible Inverse Head and Shoulders",
          direction: "BULLISH",
          description: "Teen swing lows mein beech wala sabse neecha hai."
        });
      }
    }

    if (highs.length >= 3 && lows.length >= 3) {
      const h = highs.slice(-3);
      const l = lows.slice(-3);

      const fallingHighs =
        h[0].price > h[1].price && h[1].price > h[2].price;

      const risingLows =
        l[0].price < l[1].price && l[1].price < l[2].price;

      if (fallingHighs && risingLows) {
        results.push({
          name: "Symmetrical Triangle",
          direction: "NEUTRAL",
          description: "Swing highs neeche aur swing lows upar aa rahe hain."
        });
      }

      const flatHighs = near(h[0].price, h[2].price, 0.01);
      const rising = l[0].price < l[1].price && l[1].price < l[2].price;

      if (flatHighs && rising) {
        results.push({
          name: "Ascending Triangle",
          direction: "BULLISH",
          description: "Resistance lagbhag flat aur swing lows upar hain."
        });
      }

      const flatLows = near(l[0].price, l[2].price, 0.01);
      const falling = h[0].price > h[1].price && h[1].price > h[2].price;

      if (flatLows && falling) {
        results.push({
          name: "Descending Triangle",
          direction: "BEARISH",
          description: "Support lagbhag flat aur swing highs neeche hain."
        });
      }
    }

    return results;
  }

  return {
    detectCandlesticks,
    detectChartPatterns,
    findSwings
  };

})();
