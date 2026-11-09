// TRADE PRO AI - Main JavaScript

const markets = window.TRADE_MARKETS || {};

let currentMarket = "Forex";
let currentPairs = markets.Forex || [];
let allCryptoPairs = [];
let selectedPair = currentPairs[0] || null;

let favorites = [];

try {
  favorites = JSON.parse(
    localStorage.getItem("tradeFavorites") || "[]"
  );

  if (!Array.isArray(favorites)) favorites = [];
} catch (error) {
  favorites = [];
}


// SAVE WATCHLIST

function saveFavorites() {
  localStorage.setItem(
    "tradeFavorites",
    JSON.stringify(favorites)
  );

  renderWatchlist();
}


// UPDATE MARKET BUTTONS

function updateMarketButtons() {
  [
    "Crypto",
    "Forex",
    "Stocks",
    "Gold",
    "Silver",
    "Commodities"
  ].forEach(market => {
    const button = document.getElementById("btn" + market);

    if (button) {
      button.classList.toggle(
        "active",
        currentMarket === market
      );
    }
  });
}


// CHANGE MARKET

function changeMarket(market) {
  if (market !== "Crypto" && !markets[market]) return;

  currentMarket = market;
  updateMarketButtons();

  document.getElementById("pairSearch").value = "";
  document.getElementById("dropdown").classList.remove("show");

  if (market === "Crypto") {
    if (allCryptoPairs.length) {
      currentPairs = allCryptoPairs;
      selectPair(currentPairs[0]);

      document.getElementById("status").innerText =
        allCryptoPairs.length + " Binance USDT Spot pairs loaded";
    } else {
      loadCryptoPairs();
    }
  } else {
    currentPairs = markets[market];
    document.getElementById("status").innerText =
      currentPairs.length + " listed instruments";

    selectPair(currentPairs[0]);
  }
}


// LOAD BINANCE CRYPTO PAIRS

async function loadCryptoPairs() {
  document.getElementById("status").innerText =
    "Loading Binance USDT Spot pairs...";

  try {
    const response = await fetch(
      "https://api.binance.com/api/v3/exchangeInfo"
    );

    if (!response.ok) throw new Error("API error");

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

    document.getElementById("status").innerText =
      allCryptoPairs.length + " Binance USDT Spot pairs loaded";

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
      ["DOGE/USDT", "BINANCE:DOGEUSDT"],
      ["ADA/USDT", "BINANCE:ADAUSDT"]
    ];

    currentPairs = allCryptoPairs;

    document.getElementById("status").innerText =
      "Binance unavailable. Backup pairs shown.";

    selectPair(allCryptoPairs[0]);
  }
}


// OPEN / CLOSE DROPDOWN

function toggleDropdown() {
  const dropdown = document.getElementById("dropdown");

  dropdown.classList.toggle("show");

  if (dropdown.classList.contains("show")) {
    document.getElementById("pairSearch").focus();
    renderPairs();
  }
}


// SEARCH PAIRS

function renderPairs() {
  const query = document.getElementById("pairSearch")
    .value.toUpperCase();

  const box = document.getElementById("pairList");

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
      document.getElementById("dropdown").classList.remove("show");
    };

    box.appendChild(button);
  });

  if (filtered.length === 0) {
    box.innerText = "No matching instruments found.";
  }
}


// SELECT INSTRUMENT

function selectPair(pair) {
  if (!pair) return;

  selectedPair = pair;

  document.getElementById("selectedPair").textContent =
    pair[0];

  loadChart();
}


// ADD FAVORITE

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


// SHOW WATCHLIST

function renderWatchlist() {
  const box = document.getElementById("watchlist");

  if (!box) return;

  box.innerHTML = "";

  if (favorites.length === 0) {
    box.textContent = "No favorite pairs saved.";
    return;
  }

  favorites.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "watch-item";

    const open = document.createElement("button");
    open.textContent = "⭐ " + item.name;

    open.onclick = () => {
      currentMarket = item.market;
      updateMarketButtons();

      if (item.market === "Crypto") {
        currentPairs = allCryptoPairs.length
          ? allCryptoPairs
          : [
              ["BTC/USDT", "BINANCE:BTCUSDT"],
              ["ETH/USDT", "BINANCE:ETHUSDT"]
            ];
      } else {
        currentPairs = markets[item.market] || [];
      }

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


// LOAD TRADINGVIEW CHART

function loadChart() {
  if (!selectedPair) return;

  const chart = document.getElementById("chart");
  const interval = document.getElementById("timeframe").value;

  chart.innerHTML = "";

  const container = document.createElement("div");
  container.className = "tradingview-widget-container";
  container.style.height = "100%";
  container.style.width = "100%";

  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
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
    interval: interval,
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


// TEMPORARY ANALYSIS PLACEHOLDER

function generateAnalysis() {
  document.getElementById("signal").innerText = "WAIT";

  document.getElementById("message").innerText =
    "Technical analysis engine is not connected yet. No live signal generated.";
}


// INITIALIZE WEBSITE

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
