"use strict";

window.TRADE_CHART = (() => {
  let chart = null;
  let candleSeries = null;
  let overlay = null;
  let canvas = null;
  let context = null;
  let currentCandles = [];
  let currentAnalysis = null;

  function initialize(containerId = "chart") {
    const container = document.getElementById(containerId);

    if (!container || !window.LightweightCharts) {
      console.error("Chart container or chart library missing.");
      return false;
    }

    container.innerHTML = "";
    container.style.position = "relative";
    container.style.background = "#ffffff";

    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,

      layout: {
        background: { color: "#ffffff" },
        textColor: "#191919",
        fontFamily: "Arial",
        fontSize: 12
      },

      grid: {
        vertLines: { color: "#f0f3fa" },
        horzLines: { color: "#f0f3fa" }
      },

      rightPriceScale: {
        borderColor: "#d1d4dc"
      },

      timeScale: {
        borderColor: "#d1d4dc",
        timeVisible: true,
        secondsVisible: false
      },

      crosshair: {
        mode: 1
      },

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
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "5";

    container.appendChild(canvas);
    context = canvas.getContext("2d");

    chart.timeScale().subscribeVisibleTimeRangeChange(draw);
    chart.subscribeCrosshairMove(draw);

    new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight
      });

      resizeCanvas();
      draw();
    }).observe(container);

    resizeCanvas();

    return true;
  }

  function resizeCanvas() {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function setCandles(candles) {
    if (!candleSeries || !Array.isArray(candles)) return;

    currentCandles = candles;

    candleSeries.setData(
      candles.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }))
    );

    chart.timeScale().fitContent();
    draw();
  }

  function drawLine(price, label, color, style = 2) {
    if (!Number.isFinite(Number(price))) return;

    const y = candleSeries.priceToCoordinate(Number(price));

    if (y === null) return;

    context.beginPath();
    context.setLineDash(style === 2 ? [] : [6, 4]);
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.moveTo(0, y);
    context.lineTo(canvas.clientWidth, y);
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = color;
    context.font = "12px Arial";
    context.fillText(label + " " + Number(price).toFixed(2), 8, y - 5);
  }

  function drawZone(zone, color, label) {
    if (!zone) return;

    const low = Number(zone.low);
    const high = Number(zone.high);

    if (!Number.isFinite(low) || !Number.isFinite(high)) return;

    const y1 = candleSeries.priceToCoordinate(high);
    const y2 = candleSeries.priceToCoordinate(low);

    if (y1 === null || y2 === null) return;

    const top = Math.min(y1, y2);
    const height = Math.max(2, Math.abs(y2 - y1));

    context.fillStyle = color;
    context.fillRect(0, top, canvas.clientWidth, height);

    context.strokeStyle = color.replace("0.12", "0.65");
    context.strokeRect(0, top, canvas.clientWidth, height);

    context.fillStyle = "#333333";
    context.font = "11px Arial";
    context.fillText(label, 8, top + 13);
  }

  function draw() {
    if (!context || !canvas || !candleSeries) return;

    context.clearRect(
      0, 0,
      canvas.clientWidth,
      canvas.clientHeight
    );

    if (!currentAnalysis) return;

    const a = currentAnalysis;

    drawLine(a.support, "SUPPORT", "#2196f3", 1);
    drawLine(a.resistance, "RESISTANCE", "#ff9800", 1);

    if (a.entry > 0) {
      drawLine(a.entry, "ENTRY", "#2962ff", 2);
    }

    if (a.stopLoss > 0) {
      drawLine(a.stopLoss, "STOP LOSS", "#f23645", 2);
    }

    if (Array.isArray(a.targets)) {
      a.targets.forEach((target, index) => {
        drawLine(
          Number(target),
          "TP" + (index + 1),
          "#089981",
          2
        );
      });
    }

    const smart = a.smartMoney || {};

    (smart.fvg || []).slice(-8).forEach(zone => {
      drawZone(
        zone,
        zone.type === "BULLISH"
          ? "rgba(38,166,154,0.12)"
          : "rgba(239,83,80,0.12)",
        "FVG " + (zone.type || "")
      );
    });

    (smart.orderBlocks || []).slice(-6).forEach(zone => {
      drawZone(
        zone,
        zone.type === "BULLISH"
          ? "rgba(33,150,243,0.12)"
          : "rgba(255,152,0,0.12)",
        "ORDER BLOCK " + (zone.type || "")
      );
    });
  }

  function showAnalysis(result) {
    currentAnalysis = result;
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
