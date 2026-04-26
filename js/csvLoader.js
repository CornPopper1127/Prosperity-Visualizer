/**
 * CSV Data Loader — alternative data source that reads prices & trades CSVs
 * and produces a strategy object compatible with the existing store/panels.
 *
 * This does NOT replace the .log pipeline — it lives alongside it as an
 * additional data source option.
 */

import { DAY_STRIDE } from "./parser.js";
import { buildLimits } from "./positionLimits.js";
import { uid } from "./uid.js";
import { pickColor } from "./colors.js";

const ROUND = 3;

function tickKeyOf(day, ts) {
  return (Number.isFinite(day) ? day : 0) * DAY_STRIDE + ts;
}

function totalVol(levels) {
  let s = 0;
  for (const l of levels) s += l.volume;
  return s;
}

function microPriceOf(bids, asks) {
  const bb = bids[0];
  const ba = asks[0];
  if (!bb || !ba) return NaN;
  const denom = bb.volume + ba.volume;
  if (denom <= 0) return (bb.price + ba.price) / 2;
  return (bb.price * ba.volume + ba.price * bb.volume) / denom;
}

function wallMidOf(bids, asks) {
  if (!bids.length || !asks.length) return NaN;
  let bWall = bids[0];
  for (const l of bids) if (l.volume > bWall.volume) bWall = l;
  let aWall = asks[0];
  for (const l of asks) if (l.volume > aWall.volume) aWall = l;
  return (bWall.price + aWall.price) / 2;
}

function rollingZScore(arr, windowSize = 100) {
  const n = arr.length;
  const out = new Float32Array(n).fill(NaN);
  let sum = 0, sumSq = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const val = arr[i];
    if (Number.isFinite(val)) {
      sum += val;
      sumSq += val * val;
      count++;
    }
    if (i >= windowSize) {
      const oldVal = arr[i - windowSize];
      if (Number.isFinite(oldVal)) {
        sum -= oldVal;
        sumSq -= oldVal * oldVal;
        count--;
      }
    }
    if (count >= 2) {
      const mean = sum / count;
      const variance = sumSq / count - mean * mean;
      const stdDev = Math.sqrt(Math.max(0, variance));
      if (stdDev > 0 && Number.isFinite(val)) out[i] = (val - mean) / stdDev;
      else if (stdDev === 0 && Number.isFinite(val)) out[i] = 0;
    }
  }
  return out;
}

/**
 * Parse the prices CSV text (semicolon-delimited).
 * Columns: day;timestamp;product;bid_price_1;bid_volume_1;bid_price_2;bid_volume_2;
 *          bid_price_3;bid_volume_3;ask_price_1;ask_volume_1;ask_price_2;ask_volume_2;
 *          ask_price_3;ask_volume_3;mid_price;profit_and_loss
 */
function parsePricesCsv(text) {
  const rows = [];
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const p = line.split(";");
    const num = (s) => (s === "" || s === undefined ? NaN : Number(s));
    const day = num(p[0]);
    const ts = num(p[1]);
    const product = p[2];
    const bids = [];
    const asks = [];
    for (let lvl = 0; lvl < 3; lvl++) {
      const bp = num(p[3 + lvl * 2]);
      const bv = num(p[4 + lvl * 2]);
      if (Number.isFinite(bp) && Number.isFinite(bv))
        bids.push({ price: bp, volume: bv });
    }
    for (let lvl = 0; lvl < 3; lvl++) {
      const ap = num(p[9 + lvl * 2]);
      const av = num(p[10 + lvl * 2]);
      if (Number.isFinite(ap) && Number.isFinite(av))
        asks.push({ price: ap, volume: av });
    }
    rows.push({
      day, timestamp: ts, product,
      bids, asks,
      midPrice: num(p[15]),
      pnl: num(p[16]),
    });
  }
  return rows;
}

/**
 * Parse the trades CSV text (semicolon-delimited).
 * Columns: timestamp;buyer;seller;symbol;currency;price;quantity
 */
function parseTradesCsv(text) {
  const trades = [];
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const p = line.split(";");
    const num = (s) => (s === "" || s === undefined ? NaN : Number(s));
    trades.push({
      timestamp: num(p[0]),
      buyer: p[1] || "",
      seller: p[2] || "",
      symbol: p[3] || "",
      currency: p[4] || "",
      price: num(p[5]),
      quantity: num(p[6]),
    });
  }
  return trades;
}

/**
 * Build a strategy object from parsed CSV data, compatible with the
 * existing store and all dashboard panels.
 */
function buildCsvStrategy(priceRows, rawTrades, dayNum) {
  // Sort by tick key then product
  priceRows.sort(
    (a, b) =>
      tickKeyOf(a.day, a.timestamp) - tickKeyOf(b.day, b.timestamp) ||
      (a.product || "").localeCompare(b.product || "")
  );

  // Build unique tick index
  const tIndex = new Map();
  const timestamps = [];
  const rawTimestamps = [];
  const days = [];
  const productSet = new Set();

  for (const r of priceRows) {
    if (r.product) productSet.add(r.product);
    if (!Number.isFinite(r.timestamp)) continue;
    const key = tickKeyOf(r.day, r.timestamp);
    if (!tIndex.has(key)) {
      tIndex.set(key, timestamps.length);
      timestamps.push(key);
      rawTimestamps.push(r.timestamp);
      days.push(Number.isFinite(r.day) ? r.day : 0);
    }
  }
  const products = Array.from(productSet).sort();

  // Initialize series per product
  const series = {};
  for (const p of products) {
    series[p] = {
      product: p,
      timestamps,
      midPrice: new Array(timestamps.length).fill(NaN),
      microPrice: new Array(timestamps.length).fill(NaN),
      wallMid: new Array(timestamps.length).fill(NaN),
      spread: new Array(timestamps.length).fill(NaN),
      bidPrices: [
        new Array(timestamps.length).fill(NaN),
        new Array(timestamps.length).fill(NaN),
        new Array(timestamps.length).fill(NaN),
      ],
      askPrices: [
        new Array(timestamps.length).fill(NaN),
        new Array(timestamps.length).fill(NaN),
        new Array(timestamps.length).fill(NaN),
      ],
      bestBid: new Array(timestamps.length).fill(NaN),
      bestAsk: new Array(timestamps.length).fill(NaN),
      bidVol: new Array(timestamps.length).fill(NaN),
      askVol: new Array(timestamps.length).fill(NaN),
      imbalance: new Array(timestamps.length).fill(NaN),
      pnl: new Array(timestamps.length).fill(NaN),
      position: new Array(timestamps.length).fill(0),
      cumOwnVolume: new Array(timestamps.length).fill(0),
      books: timestamps.map(() => ({ bids: [], asks: [] })),
      ownFillIndices: timestamps.map(() => []),
    };
  }

  // Fill series data
  for (const r of priceRows) {
    const s = series[r.product];
    if (!s) continue;
    const i = tIndex.get(tickKeyOf(r.day, r.timestamp));
    if (i === undefined) continue;
    s.bestBid[i] = r.bids[0]?.price ?? NaN;
    s.bestAsk[i] = r.asks[0]?.price ?? NaN;
    for (let lvl = 0; lvl < 3; lvl++) {
      s.bidPrices[lvl][i] = r.bids[lvl]?.price ?? NaN;
      s.askPrices[lvl][i] = r.asks[lvl]?.price ?? NaN;
    }
    s.bidVol[i] = totalVol(r.bids);
    s.askVol[i] = totalVol(r.asks);
    const totalBA = (s.bidVol[i] || 0) + (s.askVol[i] || 0);
    s.imbalance[i] = totalBA > 0 ? (s.bidVol[i] || 0) / totalBA : NaN;
    s.midPrice[i] =
      r.bids.length > 0 && r.asks.length > 0 && Number.isFinite(r.midPrice) && r.midPrice !== 0
        ? r.midPrice
        : NaN;
    s.microPrice[i] = microPriceOf(r.bids, r.asks);
    s.wallMid[i] = wallMidOf(r.bids, r.asks);
    s.spread[i] =
      Number.isFinite(s.bestBid[i]) && Number.isFinite(s.bestAsk[i])
        ? s.bestAsk[i] - s.bestBid[i]
        : NaN;
    s.pnl[i] = r.pnl;
    s.books[i] = { bids: r.bids, asks: r.asks };
  }

  // Precompute Z-scores for performance
  for (const p of products) {
    const s = series[p];
    s.zAsk = rollingZScore(s.bestAsk);
    s.zBid = rollingZScore(s.bestBid);
    s.zMid = rollingZScore(s.midPrice);
    s.zMicro = rollingZScore(s.microPrice);
    s.zWallMid = rollingZScore(s.wallMid);
  }

  // Process trades — align to nearest tick
  const tradesSorted = rawTrades
    .filter((t) => Number.isFinite(t.timestamp) && Number.isFinite(t.price))
    .map((t) => {
      const key = tickKeyOf(dayNum, t.timestamp);
      // Find nearest tick
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let j = 0; j < timestamps.length; j++) {
        const d = Math.abs(timestamps[j] - key);
        if (d < bestDist) { bestDist = d; bestIdx = j; }
        if (d > bestDist) break; // sorted, distance will only grow
      }
      return {
        ...t,
        day: dayNum,
        tickKey: timestamps[bestIdx] ?? key,
      };
    })
    .sort((a, b) => a.tickKey - b.tickKey || a.timestamp - b.timestamp);

  // Total PnL (from CSV's profit_and_loss column)
  const totalPnl = new Array(timestamps.length).fill(0);
  for (const p of products) {
    const arr = series[p].pnl;
    let last = 0;
    for (let i = 0; i < arr.length; i++) {
      if (Number.isFinite(arr[i])) last = arr[i];
      totalPnl[i] += last;
    }
  }

  const summary = {
    totalPnl: totalPnl.length ? totalPnl[totalPnl.length - 1] : 0,
    perProductPnl: {},
    maxDrawdown: 0,
    maxAbsPosition: 0,
    tradeCount: 0,
    winRate: 0,
    sharpe: 0,
    finalPositions: {},
  };
  for (const p of products) {
    summary.perProductPnl[p] = 0;
    summary.finalPositions[p] = 0;
  }

  return {
    id: uid("csv"),
    submissionId: null,
    name: `CSV · Round ${ROUND} Day ${dayNum}`,
    color: pickColor([]),
    filename: `prices_round_${ROUND}_day_${dayNum}.csv`,
    timestamps,
    rawTimestamps,
    days,
    products,
    series,
    totalPnl,
    rawLogs: [],
    ownFills: [],
    trades: tradesSorted,
    logIndexByTick: {},
    positionLimits: buildLimits(products),
    summary,
    loadedAt: new Date().toISOString(),
  };
}

/**
 * Load a single day's CSV data files and return a strategy object.
 */
export async function loadCsvData(day = 0) {
  const [pricesResp, tradesResp] = await Promise.all([
    fetch(`./eda/prices_round_${ROUND}_day_${day}.csv`),
    fetch(`./eda/trades_round_${ROUND}_day_${day}.csv`),
  ]);
  if (!pricesResp.ok) throw new Error(`Prices CSV day ${day}: HTTP ${pricesResp.status}`);
  if (!tradesResp.ok) throw new Error(`Trades CSV day ${day}: HTTP ${tradesResp.status}`);

  const [pricesText, tradesText] = await Promise.all([
    pricesResp.text(),
    tradesResp.text(),
  ]);

  const priceRows = parsePricesCsv(pricesText);
  const tradeRows = parseTradesCsv(tradesText);
  return buildCsvStrategy(priceRows, tradeRows, day);
}

/**
 * Load multiple days in parallel.  Returns an array of strategy objects in
 * the order requested, silently dropping any day that fails to fetch (so a
 * missing file doesn't break the whole dashboard).
 */
export async function loadAllCsvDays(days = [0, 1, 2]) {
  const results = await Promise.allSettled(days.map((d) => loadCsvData(d)));
  return results
    .map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      console.warn(`Day ${days[i]} CSV failed:`, r.reason);
      return null;
    })
    .filter(Boolean);
}
