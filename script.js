// TRADE PRO AI - Main Application Script
"use strict";

(() => {
const markets = window.TRADE_MARKETS || {};

let currentMarket = "Forex";
let currentPairs = markets.Forex || [];
let allCryptoPairs = [];
let selectedPair = currentPairs[0] || null;
let favorites = [];
let chartInitialized = false;
let chartRequestId = 0;

const $ = id => document.getElementById(id);

const TIMEFRAME_MAP = {
"1": "1m",
"5": "5m",
"15": "15m",
"30": "30m",
"60": "1h",
"240": "4h",
"D": "1d",
"W": "1w"
};

try {
const saved = JSON.parse(
localStorage.getItem("tradeFavorites") || "[]"
);
favorites = Array.isArray(saved) ? saved : [];
} catch {
favorites = [];
}

function setStatus(message) {
if ($("status")) $("status").textContent = message;
}

function updateMarketButtons() {
[
"Crypto", "Forex", "Stocks",
"Gold", "Silver", "Commodities"
].forEach(market => {
const button = $("btn" + market);
if (button) {
button.classList.toggle(
"active",
currentMarket === market
);
}
});
}

function saveFavorites() {
localStorage.setItem(
"tradeFavorites",
JSON.stringify(favorites)
);
renderWatchlist();
}

async function loadCryptoPairs() {
setStatus("Loading Binance Crypto pairs...");

try {
  const response = await fetch(
    "https://api.binance.com/api/v3/exchangeInfo"
  );

  if (!response.ok) {
    throw new Error("Binance API unavailable");
  }

  const data = await response.json();

  allCryptoPairs = data.symbols
    .filter(s =>
      s.quoteAsset === "USDT" &&
      s.status === "TRADING" &&
      s.isSpotTradingAllowed
    )
    .map(s => [
      s.baseAsset + "/USDT",
      "BINANCE:" + s.symbol
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));

  currentPairs = allCryptoPairs;

  setStatus(
    allCryptoPairs.length +
    " Binance USDT Spot pairs loaded"
  );

  if (allCryptoPairs.length) {
    selectPair(allCryptoPairs[0]);
  }

} catch (error) {
  allCryptoPairs = [
    ["BTC/USDT", "BINANCE:BTCUSDT"],
    ["ETH/USDT", "BINANCE:ETHUSDT"],
    ["BNB/USDT", "BINANCE:BNBUSDT"],
    ["SOL/USDT", "BINANCE:SOLUSDT"],
    ["XRP/USDT", "BINANCE:XRPUSDT"],
    ["DOGE/USDT", "BINANCE:DOGEUSDT"]
  ];

  currentPairs = allCryptoPairs;

  setStatus(
    "Binance pair list unavailable. Backup list shown."
  );

  selectPair(allCryptoPairs[0]);
}

}

function changeMarket(market) {
if (market !== "Crypto" && !markets[market]) return;

currentMarket = market;
updateMarketButtons();

if ($("pairSearch")) $("pairSearch").value = "";
if ($("dropdown")) $("dropdown").classList.remove("show");

if (market === "Crypto") {
  if (allCryptoPairs.length) {
    currentPairs = allCryptoPairs;
    setStatus(
      allCryptoPairs.length + " Crypto pairs loaded"
    );
    selectPair(currentPairs[0]);
  } else {
    loadCryptoPairs();
  }
  return;
}

currentPairs = markets[market] || [];

setStatus(
  currentPairs.length + " listed instruments"
);

if (currentPairs.length) {
  selectPair(currentPairs[0]);
}

}

function toggleDropdown() {
const dropdown = $("dropdown");
if (!dropdown) return;

dropdown.classList.toggle("show");

if (dropdown.classList.contains("show")) {
  $("pairSearch")?.focus();
  renderPairs();
}

}

function renderPairs() {
const search = $("pairSearch");
const box = $("pairList");

if (!search || !box) return;

const query = search.value.toUpperCase();

box.innerHTML = "";

const filtered = currentPairs.filter(pair =>
  pair[0].toUpperCase().includes(query) ||
  pair[1].toUpperCase().includes(query)
);

filtered.forEach(pair => {
  const button = document.createElement("button");

  button.className = "pair-item";
  button.textContent = pair[0];

  button.onclick = () => {
    selectPair(pair);
    $("dropdown")?.classList.remove("show");
  };

  box.appendChild(button);
});

if (!filtered.length) {
  box.textContent = "No matching instruments found.";
}

}

function selectPair(pair) {
if (!pair) return;

selectedPair = pair;

if ($("selectedPair")) {
  $("selectedPair").textContent = pair[0];
}

if ($("signal")) $("signal").textContent = "WAIT";

if ($("message")) {
  $("message").textContent =
    "Generate Analysis दबाकर नया विश्लेषण करें।";
}

if (window.TRADE_CHART) {
  window.TRADE_CHART.clearAnalysis();
}

loadChart();

}

function addFavorite() {
if (!selectedPair) return;

const exists = favorites.some(
  item => item.symbol === selectedPair[1]
);

if (exists) {
  alert("Already saved in Watchlist.");
  return;
}

favorites.push({
  name: selectedPair[0],
  symbol: selectedPair[1],
  market: currentMarket
});

saveFavorites();
alert("Added to Watchlist!");

}

function renderWatchlist() {
const box = $("watchlist");
if (!box) return;

box.innerHTML = "";

if (!favorites.length) {
  box.textContent = "No favorite pairs saved.";
  return;
}

favorites.forEach((item, index) => {
  const row = document.createElement("div");
  row.className = "watch-item";

  const open = document.createElement("button");
  open.textContent = "⭐ " + item.name;

  open.onclick = async () => {
    if (item.market === "Crypto" &&
        !allCryptoPairs.length) {
      await loadCryptoPairs();
    }

    currentMarket = item.market;
    updateMarketButtons();

    currentPairs = item.market === "Crypto"
      ? allCryptoPairs
      : (markets[item.market] || []);

    selectPair([item.name, item.symbol]);
  };

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.textContent = "✕";

  remove.onclick = () => {
    favorites.splice(index, 1);
    saveFavorites();
  };

  row.appendChild(open);
  row.appendChild(remove);
  box.appendChild(row);
});

}

function loadTradingViewChart() {
const chart = $("chart");
if (!chart || !selectedPair) return;

chart.innerHTML = "";

const container = document.createElement("div");
container.className = "tradingview-widget-container";
container.style.height = "100%";
container.style.width = "100%";

const widget = document.createElement("div");
widget.className =
  "tradingview-widget-container__widget";
widget.style.height = "100%";
widget.style.width = "100%";

const script = document.createElement("script");

script.type = "text/javascript";
script.async = true;
script.src =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

script.textContent = JSON.stringify({
  autosize: true,
  symbol: selectedPair[1],
  interval: $("timeframe")?.value || "15",
  timezone: "Asia/Kolkata",
  theme: "light",
  style: "1",
  locale: "en",
  allow_symbol_change: true,
  calendar: false,
  support_host: "https://www.tradingview.com"
});

container.appendChild(widget);
container.appendChild(script);
chart.appendChild(container);

}

async function loadChart() {
if (!selectedPair || !$("chart")) return;

const requestId = ++chartRequestId;

if (currentMarket !== "Crypto") {
  chartInitialized = false;
  loadTradingViewChart();

  setStatus(
    "TradingView chart loaded. Custom analysis overlays are Crypto-only."
  );
  return;
}

try {
  if (!window.TRADE_CHART ||
      !window.TRADE_DATA) {
    throw new Error("Chart engine or data module missing.");
  }

  const chartContainer = $("chart");

  if (!chartInitialized) {
    const initialized =
      window.TRADE_CHART.initialize("chart");

    if (!initialized) {
      throw new Error("Chart initialization failed.");
    }

    chartInitialized = true;
  }

  setStatus("Loading live Binance candles...");

  const selectedInterval =
    $("timeframe")?.value || "15";

  const timeframe = TIMEFRAME_MAP[selectedInterval];

  if (!timeframe) {
    throw new Error("Unsupported timeframe.");
  }

  const candles =
    await window.TRADE_DATA.getCandles(
      selectedPair[1],
      timeframe,
      500
    );

  if (requestId !== chartRequestId) return;

  if (!candles.length) {
    throw new Error("No candle data received.");
  }

  window.TRADE_CHART.setCandles(candles);

  setStatus(
    selectedPair[0] +
    " | " + timeframe +
    " | Binance live data"
  );

} catch (error) {
  if (requestId !== chartRequestId) return;

  setStatus("Chart error: " + error.message);
  console.error("Chart loading error:", error);
}

}

function formatPrice(value) {
if (
value === null ||
value === undefined ||
value === "" ||
!Number.isFinite(Number(value))
) {
return "N/A";
}

return Number(value).toLocaleString("en-IN", {
  maximumFractionDigits: 8
});

}

function formatList(title, items, formatter) {
if (!Array.isArray(items) || !items.length) {
return title + ": कोई पुष्टि नहीं मिली।\n";
}

return title + ":\n" +
  items.map(formatter).join("\n") + "\n";

}

function displayAnalysis(result, timeframe) {
const signalBox = $("signal");
const messageBox = $("message");

signalBox.textContent = result.signal || "WAIT";

let output = "";

output += "TRADE PRO AI ANALYSIS\n";
output += "------------------------------\n";

output += "Pair: " + selectedPair[0] + "\n";
output += "Timeframe: " + timeframe + "\n";
output += "Signal: " + result.signal + "\n";
output += "Strength: " + result.strength + "%\n";
output += "Score: " + result.score + "\n\n";

output += "PRICE LEVELS\n";
output += "Price: " +
  formatPrice(result.indicators?.price) + "\n";

output += "Support: " +
  formatPrice(result.support) + "\n";

output += "Resistance: " +
  formatPrice(result.resistance) + "\n\n";

output += "TRADE PLAN\n";
output += "Entry: " + formatPrice(result.entry) + "\n";
output += "Stop Loss: " + formatPrice(result.stopLoss) + "\n";

if (Array.isArray(result.targets) &&
    result.targets.length) {
  result.targets.forEach((target, index) => {
    output += "TP" + (index + 1) + ": " +
      formatPrice(target) + "\n";
  });
} else {
  output += "Targets: WAIT signal होने के कारण उपलब्ध नहीं।\n";
}

output += "\nINDICATORS\n";

const ind = result.indicators || {};

output += "EMA 20: " + formatPrice(ind.ema20) + "\n";
output += "EMA 50: " + formatPrice(ind.ema50) + "\n";
output += "RSI: " + formatPrice(ind.rsi) + "\n";
output += "MACD: " + formatPrice(ind.macd) + "\n";
output += "MACD Signal: " +
  formatPrice(ind.macdSignal) + "\n";

output += "Supertrend: " +
  (ind.supertrend?.trend || "N/A") + "\n\n";

output += formatList(
  "STRATEGY CONFIRMATION",
  result.strategies,
  item =>
    item.name + " — " + item.direction +
    " (" + item.reason + ")"
);

const smart = result.smartMoney || {};

output += formatList(
  "FAIR VALUE GAPS",
  smart.fvg,
  item =>
    item.type + " | Low: " +
    formatPrice(item.low) +
    " | High: " + formatPrice(item.high)
);

output += formatList(
  "ORDER BLOCKS",
  smart.orderBlocks,
  item =>
    item.type + " | Low: " +
    formatPrice(item.low) +
    " | High: " + formatPrice(item.high)
);

output += formatList(
  "LIQUIDITY SWEEPS",
  smart.liquidity,
  item =>
    item.type + " | Price: " +
    formatPrice(item.price)
);

output += formatList(
  "SWING LEVELS",
  smart.swings,
  item =>
    item.type + " | Price: " +
    formatPrice(item.price)
);

output += formatList(
  "CANDLESTICK PATTERNS",
  result.candlePatterns,
  item => item.name + " — " + item.direction
);

output += formatList(
  "CHART PATTERNS",
  result.chartPatterns,
  item => item.name
);

output += "\nANALYSIS REASONS\n";

if (Array.isArray(result.reasons)) {
  output += result.reasons
    .map((reason, index) =>
      (index + 1) + ". " + reason
    )
    .join("\n");
}

output += "\n\nVolume Confirmed: " +
  (result.volumeConfirmed ? "YES" : "NO");

output += "\n\nRisk Warning: यह तकनीकी विश्लेषण है, वित्तीय सलाह नहीं।";

messageBox.textContent = output;

if (window.TRADE_CHART) {
  window.TRADE_CHART.showAnalysis(result);
}

}

async function generateAnalysis() {
const signalBox = $("signal");
const messageBox = $("message");

if (!signalBox || !messageBox) return;

signalBox.textContent = "WAIT";
messageBox.textContent = "Analyzing market data...";

if (currentMarket !== "Crypto") {
  messageBox.textContent =
    "इस Market का अपना live candle data provider अभी जुड़ा नहीं है। इसलिए कोई BUY/SELL signal नहीं दिया जाएगा।";
  return;
}

try {
  if (!window.TRADE_DATA ||
      !window.TRADE_ANALYSIS ||
      !window.TRADE_CHART) {
    throw new Error(
      "Analysis या Chart modules load नहीं हुए।"
    );
  }

  if (!selectedPair) {
    throw new Error("कृपया पहले कोई Pair चुनें।");
  }

  const selectedInterval =
    $("timeframe")?.value || "15";

  const timeframe =
    TIMEFRAME_MAP[selectedInterval];

  if (!timeframe) {
    throw new Error("Unsupported timeframe.");
  }

  setStatus("Generating technical analysis...");

  const candles =
    await window.TRADE_DATA.getCandles(
      selectedPair[1],
      timeframe,
      500
    );

  window.TRADE_CHART.setCandles(candles);

  const result =
    window.TRADE_ANALYSIS.analyze(candles);

  displayAnalysis(result, timeframe);

  setStatus("Analysis completed.");

} catch (error) {
  signalBox.textContent = "WAIT";

  messageBox.textContent =
    "Analysis नहीं हो पाया: " + error.message;

  setStatus("Analysis failed.");

  console.error(
    "TRADE PRO AI Error:",
    error
  );
}

}

// HTML BUTTON CONNECTIONS

window.changeMarket = changeMarket;
window.toggleDropdown = toggleDropdown;
window.renderPairs = renderPairs;
window.selectPair = selectPair;
window.addFavorite = addFavorite;
window.renderWatchlist = renderWatchlist;
window.loadChart = loadChart;
window.generateAnalysis = generateAnalysis;

function initializeTradePro() {
renderWatchlist();
changeMarket("Forex");
}

if (document.readyState === "loading") {
document.addEventListener(
"DOMContentLoaded",
initializeTradePro
);
} else {
initializeTradePro();
}

})();
