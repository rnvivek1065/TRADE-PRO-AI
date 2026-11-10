"use strict";

window.TRADE_CHART = (() => {
  let chart = null;
  let candleSeries = null;
  let canvas = null;
  let context = null;
  let currentCandles = [];
  let currentAnalysis = null;
  let resizeObserver = null;

  function initialize(containerId = "chart") {
    const container = document.getElementById(containerId);

    if (!container || !window.LightweightCharts) {
      console.error("Chart container or library missing.");
      return false;
    }

    if (chart) {
      if (resizeObserver) resizeObserver.disconnect();
      chart.remove();
      chart = null;
    }

    container.innerHTML = "";
    container.style.position = "relative";

    chart = LightweightCharts.createChart(container, {
      width: Math.max(320, container.clientWidth),
      height: Math.max(300, container.clientHeight),
      layout: {
        background: { color: "#ffffff" },
        textColor: "#191919"
      },
      grid: {
        vertLines: { color: "#f0f3fa" },
        horzLines: { color: "#f0f3fa" }
      },
      rightPriceScale: { borderColor: "#d1d4dc" },
      timeScale: {
        borderColor: "#d1d4dc",
        timeVisible: true
      },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true
    });

    candleSeries = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350"
    });

    canvas = document.createElement("canvas");

    Object.assign(canvas.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "5"
    });

    container.appendChild(canvas);
    context = canvas.getContext("2d");

    chart.timeScale().subscribeVisibleTimeRangeChange(draw);

    resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: Math.max(320, container.clientWidth),
        height: Math.max(300, container.clientHeight)
      });

      resizeCanvas();
      draw();
    });

    resizeObserver.observe(container);
    resizeCanvas();

    return true;
  }

  function resizeCanvas() {
    if (!canvas || !context) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function setCandles(candles) {
    if (!candleSeries || !Array.isArray(candles)) return;

    const valid = candles.filter(c =>
      Number.isFinite(Number(c.time)) &&
      Number.isFinite(Number(c.open)) &&
      Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) &&
      Number.isFinite(Number(c.close))
    );

    if (!valid.length) return;

    currentCandles = valid;

    candleSeries.setData(valid.map(c => ({
      time: c.time,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close)
    })));

    chart.timeScale().fitContent();
    draw();
  }

  function drawLine(price, label, color, dashed = false) {
    const value = Number(price);

    if (!Number.isFinite(value)) return;

    const y = candleSeries.priceToCoordinate(value);

    if (y === null) return;

    context.beginPath();
    context.setLineDash(dashed ? [6, 4] : []);
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.moveTo(0, y);
    context.lineTo(canvas.clientWidth, y);
    context.stroke();
    context.setLineDash([]);

    context.font = "12px Arial";

    const text = label + " " + value.toLocaleString("en-US", {
      maximumFractionDigits: 8
    });

    context.fillStyle = "rgba(255,255,255,0.9)";
    context.fillRect(7, y - 17, context.measureText(text).width + 12, 18);

    context.fillStyle = color;
    context.fillText(text, 12, y - 4);
  }

  function drawZone(zone, bullish) {
    if (!zone) return;

    const low = Number(zone.low);
    const high = Number(zone.high);

    if (!Number.isFinite(low) ||
        !Number.isFinite(high) ||
        high <= low) return;

    const y1 = candleSeries.priceToCoordinate(high);
    const y2 = candleSeries.priceToCoordinate(low);

    if (y1 === null || y2 === null) return;

    const top = Math.min(y1, y2);
    const height = Math.max(2, Math.abs(y2 - y1));

    context.fillStyle = bullish
      ? "rgba(38,166,154,0.14)"
      : "rgba(239,83,80,0.14)";

    context.fillRect(0, top, canvas.clientWidth, height);

    context.strokeStyle = bullish ? "#26a69a" : "#ef5350";
    context.strokeRect(0, top, canvas.clientWidth, height);

    context.font = "11px Arial";
    context.fillStyle = bullish ? "#087f70" : "#c62828";

    context.fillText(
      bullish ? "BULLISH FVG" : "BEARISH FVG",
      8,
      top + 13
    );
  }

  function drawTrendline(swings) {
    if (!Array.isArray(swings)) return;

    const highs = swings
      .filter(x => x.type === "SWING HIGH")
      .slice(-2);

    const lows = swings
      .filter(x => x.type === "SWING LOW")
      .slice(-2);

    const points = highs.length === 2
      ? highs
      : lows.length === 2 ? lows : [];

    if (points.length !== 2) return;

    const first = currentCandles[points[0].index];
    const second = currentCandles[points[1].index];

    if (!first || !second) return;

    const x1 = chart.timeScale().timeToCoordinate(first.time);
    const x2 = chart.timeScale().timeToCoordinate(second.time);

    const y1 = candleSeries.priceToCoordinate(Number(points[0].price));
    const y2 = candleSeries.priceToCoordinate(Number(points[1].price));

    if ([x1, x2, y1, y2].some(v => v === null)) return;

    context.beginPath();
    context.strokeStyle = highs.length === 2 ? "#8e44ad" : "#00897b";
    context.lineWidth = 2;
    context.setLineDash([7, 4]);
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
    context.setLineDash([]);
  }

  function drawMarketStructure(swings) {
    if (!Array.isArray(swings)) return;

    swings.slice(-6).forEach(item => {
      const y = candleSeries.priceToCoordinate(Number(item.price));

      if (y === null) return;

      context.fillStyle =
        item.type === "SWING HIGH" ? "#ad5a00" : "#087f70";

      context.font = "10px Arial";
      context.fillText(item.type, 8, y - 3);
    });
  }

  function draw() {
    if (!context || !canvas || !candleSeries) return;

    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    if (!currentAnalysis || !currentCandles.length) return;

    const a = currentAnalysis;

    drawLine(a.support, "SUPPORT", "#2196f3", true);
    drawLine(a.resistance, "RESISTANCE", "#ff9800", true);

    const smart = a.smartMoney || {};

    (smart.fvg || []).slice(-5).forEach(zone => {
      const type = String(zone.type || "").toUpperCase();
      drawZone(zone, type.includes("BULLISH"));
    });

    drawTrendline(smart.swings);
    drawMarketStructure(smart.swings);

    if (a.signal === "BUY" || a.signal === "SELL") {
      drawLine(a.entry, "ENTRY", "#2962ff");
      drawLine(a.stopLoss, "STOP LOSS", "#f23645");

      (Array.isArray(a.targets) ? a.targets : [])
        .slice(0, 3)
        .forEach((target, index) => {
          drawLine(target, "TARGET " + (index + 1), "#089981");
        });
    }
  }

  function showAnalysis(result) {
    currentAnalysis = result || null;
    draw();
  }

  function clearAnalysis() {
    currentAnalysis = null;
    draw();
  }

  return {
    initialize,
    setCandles,
    showAnalysis,
    clearAnalysis
  };
})();
