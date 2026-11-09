window.TRADE_PROFILES = (() => {

  function volumeProfile(candles, bins = 100, valueAreaPercent = 70) {
    if (!candles || !candles.length) return null;

    const low = Math.min(...candles.map(c => c.low));
    const high = Math.max(...candles.map(c => c.high));

    if (high <= low) return null;

    const step = (high - low) / bins;
    const levels = Array.from({ length: bins }, (_, i) => ({
      price: low + (i + 0.5) * step,
      volume: 0
    }));

    candles.forEach(c => {
      const volume = Number(c.volume) || 0;
      const candleLow = Math.max(0, Math.floor((c.low - low) / step));
      const candleHigh = Math.min(
        bins - 1,
        Math.floor((c.high - low) / step)
      );

      const count = candleHigh - candleLow + 1;
      if (count <= 0) return;

      const eachVolume = volume / count;

      for (let i = candleLow; i <= candleHigh; i++) {
        levels[i].volume += eachVolume;
      }
    });

    const totalVolume = levels.reduce((s, x) => s + x.volume, 0);

    if (!totalVolume) return null;

    const pocIndex = levels.reduce(
      (best, x, i) =>
        x.volume > levels[best].volume ? i : best,
      0
    );

    const targetVolume = totalVolume * valueAreaPercent / 100;

    let left = pocIndex;
    let right = pocIndex;
    let accumulated = levels[pocIndex].volume;

    while (accumulated < targetVolume &&
      (left > 0 || right < bins - 1)) {

      const leftVolume = left > 0
        ? levels[left - 1].volume : -1;

      const rightVolume = right < bins - 1
        ? levels[right + 1].volume : -1;

      if (rightVolume > leftVolume) {
        right++;
        accumulated += levels[right].volume;
      } else {
        left--;
        accumulated += levels[left].volume;
      }
    }

    return {
      levels,
      poc: levels[pocIndex].price,
      vah: levels[right].price,
      val: levels[left].price,
      totalVolume
    };
  }

  function tpoProfile(candles, bins = 100, intervalMinutes = 30) {
    if (!candles || !candles.length) return null;

    const low = Math.min(...candles.map(c => c.low));
    const high = Math.max(...candles.map(c => c.high));

    if (high <= low) return null;

    const step = (high - low) / bins;

    const levels = Array.from({ length: bins }, (_, i) => ({
      price: low + (i + 0.5) * step,
      tpo: 0,
      periods: []
    }));

    const periods = new Map();

    candles.forEach(c => {
      const time = Number(c.time);
      if (!Number.isFinite(time)) return;

      const timeMs = time < 1e12 ? time * 1000 : time;
      const period = Math.floor(
        timeMs / (intervalMinutes * 60 * 1000)
      );

      if (!periods.has(period)) periods.set(period, []);
      periods.get(period).push(c);
    });

    periods.forEach((periodCandles, period) => {
      const periodLow = Math.min(...periodCandles.map(c => c.low));
      const periodHigh = Math.max(...periodCandles.map(c => c.high));

      const start = Math.max(0, Math.floor((periodLow - low) / step));
      const end = Math.min(
        bins - 1,
        Math.floor((periodHigh - low) / step)
      );

      for (let i = start; i <= end; i++) {
        levels[i].tpo++;
        levels[i].periods.push(period);
      }
    });

    const totalTPO = levels.reduce((s, x) => s + x.tpo, 0);

    if (!totalTPO) return null;

    const pocIndex = levels.reduce(
      (best, x, i) =>
        x.tpo > levels[best].tpo ? i : best,
      0
    );

    const target = totalTPO * 0.70;
    let left = pocIndex;
    let right = pocIndex;
    let count = levels[pocIndex].tpo;

    while (count < target &&
      (left > 0 || right < bins - 1)) {

      const lv = left > 0 ? levels[left - 1].tpo : -1;
      const rv = right < bins - 1 ? levels[right + 1].tpo : -1;

      if (rv > lv) {
        right++;
        count += levels[right].tpo;
      } else {
        left--;
        count += levels[left].tpo;
      }
    }

    return {
      levels,
      poc: levels[pocIndex].price,
      vah: levels[right].price,
      val: levels[left].price,
      totalTPO
    };
  }

  function fixedRange(candles, startIndex, endIndex, bins = 100) {
    return volumeProfile(
      candles.slice(startIndex, endIndex + 1),
      bins
    );
  }

  function visibleRange(candles, startIndex, endIndex, bins = 100) {
    return fixedRange(candles, startIndex, endIndex, bins);
  }

  function sessionProfile(candles, bins = 100) {
    if (!candles.length) return null;

    const first = Number(candles[0].time);
    const session = candles.filter(c => {
      const time = Number(c.time);
      return Math.floor(time / 86400) === Math.floor(first / 86400);
    });

    return volumeProfile(session, bins);
  }

  function periodicProfile(candles, periodCandles, bins = 100) {
    if (!periodCandles || periodCandles < 1) return [];

    const results = [];

    for (let i = 0; i < candles.length; i += periodCandles) {
      const part = candles.slice(i, i + periodCandles);
      const profile = volumeProfile(part, bins);

      if (profile) results.push(profile);
    }

    return results;
  }

  function autoAnchored(candles, bins = 100) {
    if (!candles.length) return null;

    let anchor = 0;

    for (let i = 1; i < candles.length; i++) {
      if (
        candles[i].high > candles[anchor].high ||
        candles[i].low < candles[anchor].low
      ) {
        anchor = i;
      }
    }

    return {
      anchorIndex: anchor,
      profile: volumeProfile(candles.slice(anchor), bins)
    };
  }

  return {
    volumeProfile,
    tpoProfile,
    fixedRange,
    visibleRange,
    sessionProfile,
    periodicProfile,
    autoAnchored
  };

})();
