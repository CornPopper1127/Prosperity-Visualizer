/**
 * Options Analytics panels: Moneyness & Implied Volatility.
 *
 * Reads data directly from the store (no separate CSV fetch).
 * Displays regardless of which product is selected.
 */

import { subscribe, getState, getReference } from "../store.js";
import { createChart } from "../chart.js";

/* ─── Config ─── */
const VEV_STRIKES = [4000, 4500, 5000, 5100, 5200, 5300, 5400, 5500, 6000, 6500];
const SPOT_PRODUCT = "VELVETFRUIT_EXTRACT";
const TTE_BASE_DAYS = 5; // Round 3: 7 - (3-1) = 5

/* BS parameters — exposed for future UI controls */
const bsParams = {
  riskFreeRate: 0,
  dividendYield: 0,
  optionType: "call",
};

/* ─── Black-Scholes helpers ─── */

function normCdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + sign * y);
}

function bsCallPrice(S, K, T, r, sigma) {
  if (T <= 0) return Math.max(0, S - K);
  if (sigma <= 0) return Math.max(0, S - K);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

function impliedVol(marketPrice, S, K, T, r) {
  if (T <= 0 || marketPrice <= 0) return NaN;
  const intrinsic = Math.max(0, S - K);
  if (marketPrice < intrinsic - 0.01) return NaN;
  let sigma = 0.5;
  for (let i = 0; i < 100; i++) {
    const price = bsCallPrice(S, K, T, r, sigma);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const vega = S * Math.sqrt(T) * Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI);
    if (vega < 1e-12) break;
    const diff = price - marketPrice;
    sigma -= diff / vega;
    if (sigma <= 0) sigma = 0.001;
    if (Math.abs(diff) < 1e-8) return sigma;
  }
  return sigma > 0 && sigma < 10 ? sigma : NaN;
}

/**
 * Read spot price and option premiums from the store at the current tick.
 */
function getOptionsData(ref, tickIdx) {
  if (!ref || !ref.series) return null;
  const spotSeries = ref.series[SPOT_PRODUCT];
  if (!spotSeries) return null;
  const spot = spotSeries.midPrice[tickIdx];
  if (!Number.isFinite(spot)) return null;

  const options = [];
  for (const K of VEV_STRIKES) {
    const optSeries = ref.series[`VEV_${K}`];
    const premium = optSeries ? optSeries.midPrice[tickIdx] : NaN;
    options.push({ strike: K, premium: Number.isFinite(premium) ? premium : NaN });
  }
  return { spot, options };
}

/* ─── Moneyness Panel ─── */

export function mountMoneynessChart({
  canvasEl, emptyEl, titleEl, legendEl,
  premiumToggle, resetZoomBtn, paramsEl,
  modeLineBtn, modeDotBtn,
}) {
  let chart = null;
  let lastKey = null;
  let subtractPremium = false;
  let showLine = true;
  let showDot = true;

  premiumToggle.addEventListener("change", () => {
    subtractPremium = premiumToggle.checked;
    lastKey = null;
    render();
  });
  resetZoomBtn.addEventListener("click", () => chart?.resetXView());

  modeLineBtn.classList.toggle("active", showLine);
  modeDotBtn.classList.toggle("active", showDot);
  modeLineBtn.addEventListener("click", () => {
    showLine = !showLine;
    modeLineBtn.classList.toggle("active", showLine);
    lastKey = null;
    render();
  });
  modeDotBtn.addEventListener("click", () => {
    showDot = !showDot;
    modeDotBtn.classList.toggle("active", showDot);
    lastKey = null;
    render();
  });

  function ensureChart() {
    if (chart) return;
    chart = createChart(canvasEl, {
      onHover: (values) => {
        if (!values) { legendEl.innerHTML = ""; return; }
        const items = values.map((v) => {
          if (v == null) return "";
          return `<span class="legend-row"><span class="legend-swatch" style="background:#a78bfa"></span><span class="legend-name">Moneyness</span><span class="legend-value">${v.toFixed(1)}</span></span>`;
        }).filter(Boolean);
        legendEl.innerHTML = items.join("");
      },
    });
  }

  function render() {
    const state = getState();
    const ref = getReference(state);
    const dayNum = ref?.days?.[state.tickIdx] ?? 0;

    titleEl.textContent = "Moneyness · VEV Options";
    paramsEl.innerHTML = `<span class="param-pill">Type: ${bsParams.optionType}</span>
      <span class="param-pill">Day: ${dayNum}</span>
      <span class="param-pill">TTE: ${TTE_BASE_DAYS - dayNum}d</span>`;

    if (!ref) {
      emptyEl.textContent = "Load data to see moneyness.";
      emptyEl.classList.remove("hidden");
      canvasEl.classList.add("hidden");
      return;
    }

    const data = getOptionsData(ref, state.tickIdx);
    if (!data) {
      emptyEl.textContent = "No VELVETFRUIT_EXTRACT data at this tick.";
      emptyEl.classList.remove("hidden");
      canvasEl.classList.add("hidden");
      return;
    }

    emptyEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
    ensureChart();

    const key = [state.tickIdx, subtractPremium, showLine, showDot].join("|");
    if (key !== lastKey) {
      const xs = [];
      const ys = [];
      for (const opt of data.options) {
        xs.push(opt.strike);
        let moneyness = data.spot - opt.strike;
        if (subtractPremium && Number.isFinite(opt.premium)) {
          moneyness -= opt.premium;
        }
        ys.push(moneyness);
      }

      const seriesName = subtractPremium ? "Moneyness − Premium" : "Moneyness (Spot − Strike)";
      chart.setData({
        xFormat: (v) => v.toFixed(0),
        yFormat: (v) => v.toFixed(1),
        targetPoints: Infinity,
        series: showLine
          ? [{ name: seriesName, color: "#a78bfa", xs, ys, width: 2 }]
          : [{ name: "", color: "transparent", xs, ys, width: 0 }],
        markers: showDot ? [{
          name: "Strikes",
          color: "#a78bfa",
          shape: "dot",
          size: 8,
          xs, ys,
        }] : [],
        limitLines: [{ value: 0, color: "#71717a", dash: [4, 4] }],
      });
      lastKey = key;
    }
  }

  subscribe(render);
  render();
}

/* ─── IV Smile Panel ─── */

export function mountVolSmileChart({
  canvasEl, emptyEl, titleEl, legendEl,
  resetZoomBtn, paramsEl,
  modeLineBtn, modeDotBtn,
}) {
  let chart = null;
  let lastKey = null;
  let showLine = true;
  let showDot = true;

  resetZoomBtn.addEventListener("click", () => chart?.resetXView());

  modeLineBtn.classList.toggle("active", showLine);
  modeDotBtn.classList.toggle("active", showDot);
  modeLineBtn.addEventListener("click", () => {
    showLine = !showLine;
    modeLineBtn.classList.toggle("active", showLine);
    lastKey = null;
    render();
  });
  modeDotBtn.addEventListener("click", () => {
    showDot = !showDot;
    modeDotBtn.classList.toggle("active", showDot);
    lastKey = null;
    render();
  });

  function ensureChart() {
    if (chart) return;
    chart = createChart(canvasEl, {
      onHover: (values) => {
        if (!values) { legendEl.innerHTML = ""; return; }
        const items = values.map((v) => {
          if (v == null) return "";
          return `<span class="legend-row"><span class="legend-swatch" style="background:#f59e0b"></span><span class="legend-name">IV</span><span class="legend-value">${(v * 100).toFixed(2)}%</span></span>`;
        }).filter(Boolean);
        legendEl.innerHTML = items.join("");
      },
    });
  }

  function render() {
    const state = getState();
    const ref = getReference(state);
    const dayNum = ref?.days?.[state.tickIdx] ?? 0;
    const tte = TTE_BASE_DAYS - dayNum;
    const T = tte / 365;

    titleEl.textContent = "Implied Volatility Smile · VEV Options";
    paramsEl.innerHTML = `<span class="param-pill">r: ${(bsParams.riskFreeRate * 100).toFixed(1)}%</span>
      <span class="param-pill">q: ${(bsParams.dividendYield * 100).toFixed(1)}%</span>
      <span class="param-pill">Type: ${bsParams.optionType}</span>
      <span class="param-pill">Day: ${dayNum}</span>
      <span class="param-pill">TTE: ${tte}d (${T.toFixed(4)}y)</span>`;

    if (!ref) {
      emptyEl.textContent = "Load data to see IV smile.";
      emptyEl.classList.remove("hidden");
      canvasEl.classList.add("hidden");
      return;
    }

    const data = getOptionsData(ref, state.tickIdx);
    if (!data) {
      emptyEl.textContent = "No VELVETFRUIT_EXTRACT data at this tick.";
      emptyEl.classList.remove("hidden");
      canvasEl.classList.add("hidden");
      return;
    }

    emptyEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
    ensureChart();

    const key = [state.tickIdx, showLine, showDot].join("|");
    if (key !== lastKey) {
      const xs = [];
      const ys = [];
      for (const opt of data.options) {
        if (!Number.isFinite(opt.premium) || opt.premium <= 0) continue;
        const iv = impliedVol(opt.premium, data.spot, opt.strike, T, bsParams.riskFreeRate);
        if (Number.isFinite(iv)) {
          xs.push(opt.strike);
          ys.push(iv);
        }
      }

      chart.setData({
        xFormat: (v) => v.toFixed(0),
        yFormat: (v) => (v * 100).toFixed(1) + "%",
        targetPoints: Infinity,
        series: showLine
          ? [{ name: "Implied Volatility", color: "#f59e0b", xs, ys, width: 2 }]
          : [{ name: "", color: "transparent", xs, ys, width: 0 }],
        markers: showDot ? [{
          name: "IV",
          color: "#f59e0b",
          shape: "dot",
          size: 8,
          xs, ys,
        }] : [],
        // Anchor Y-axis to 0–100% so shape is comparable across timestamps.
        // Right-click the chart to reset zoom.
        limitLines: [
          { value: 0,   color: "transparent" },
          { value: 1.0, color: "transparent" },
        ],
      });
      lastKey = key;
    }
  }

  subscribe(render);
  render();
}

/* ─── Helpers for time-series panels ─── */

/** Parse strike from product name e.g. "VEV_5000" → 5000 */
function strikeFromProduct(product) {
  const m = product?.match(/^VEV_(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Pre-compute full time-series of moneyness for a given product & toggle. */
function buildMoneynessTimeSeries(ref, strike, subtractPremium) {
  const spotSeries = ref.series[SPOT_PRODUCT];
  const optSeries = ref.series[`VEV_${strike}`];
  const xs = ref.timestamps;
  const ys = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const spot = spotSeries?.midPrice[i];
    if (!Number.isFinite(spot)) { ys[i] = NaN; continue; }
    let m = spot - strike;
    if (subtractPremium) {
      const prem = optSeries?.midPrice[i];
      if (Number.isFinite(prem)) m -= prem;
    }
    ys[i] = m;
  }
  return { xs, ys };
}

/** Pre-compute full time-series of implied vol for a given product. */
function buildIVTimeSeries(ref, strike) {
  const spotSeries = ref.series[SPOT_PRODUCT];
  const optSeries = ref.series[`VEV_${strike}`];
  const xs = ref.timestamps;
  const ys = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const spot = spotSeries?.midPrice[i];
    const prem = optSeries?.midPrice[i];
    const day = ref.days[i] ?? 0;
    const tte = TTE_BASE_DAYS - day;
    const T = tte / 365;
    if (!Number.isFinite(spot) || !Number.isFinite(prem) || prem <= 0 || T <= 0) {
      ys[i] = NaN; continue;
    }
    ys[i] = impliedVol(prem, spot, strike, T, bsParams.riskFreeRate);
  }
  return { xs, ys };
}

/* ─── Moneyness vs Time Panel ─── */

export function mountMoneynessTimeChart({
  canvasEl, emptyEl, titleEl, legendEl,
  premiumToggle, resetZoomBtn, modeLineBtn, modeDotBtn,
}) {
  let chart = null;
  let lastKey = null;
  let subtractPremium = false;
  let showLine = true;
  let showDot = false;

  premiumToggle.addEventListener("change", () => {
    subtractPremium = premiumToggle.checked;
    lastKey = null;
    render();
  });
  resetZoomBtn.addEventListener("click", () => chart?.resetXView());

  modeLineBtn.classList.toggle("active", showLine);
  modeDotBtn.classList.toggle("active", showDot);
  modeLineBtn.addEventListener("click", () => {
    showLine = !showLine;
    modeLineBtn.classList.toggle("active", showLine);
    lastKey = null;
    render();
  });
  modeDotBtn.addEventListener("click", () => {
    showDot = !showDot;
    modeDotBtn.classList.toggle("active", showDot);
    lastKey = null;
    render();
  });

  function ensureChart() {
    if (chart) return;
    chart = createChart(canvasEl, {
      onHover: (values) => {
        if (!values) { legendEl.innerHTML = ""; return; }
        const items = values.map((v) => {
          if (v == null) return "";
          return `<span class="legend-row"><span class="legend-swatch" style="background:#a78bfa"></span><span class="legend-name">Moneyness</span><span class="legend-value">${v.toFixed(1)}</span></span>`;
        }).filter(Boolean);
        legendEl.innerHTML = items.join("");
      },
    });
  }

  function render() {
    const state = getState();
    const ref = getReference(state);
    const product = state.selectedProduct;
    const strike = strikeFromProduct(product);

    if (!ref || strike === null) {
      emptyEl.textContent = strike === null
        ? "Select a VEV option from the product dropdown."
        : "Load data first.";
      emptyEl.classList.remove("hidden");
      canvasEl.classList.add("hidden");
      return;
    }

    titleEl.textContent = `Moneyness vs Time · ${product}`;
    emptyEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
    ensureChart();

    const key = `${ref.id}|${product}|${subtractPremium}|${showLine}|${showDot}`;
    if (key !== lastKey) {
      const { xs, ys } = buildMoneynessTimeSeries(ref, strike, subtractPremium);
      const seriesName = subtractPremium ? "Moneyness − Premium" : "Moneyness (Spot − Strike)";
      chart.setData({
        xFormat: (v) => Math.round(v).toLocaleString(),
        yFormat: (v) => v.toFixed(1),
        targetPoints: 2000,
        series: showLine
          ? [{ name: seriesName, color: "#a78bfa", xs, ys, width: 1.5 }]
          : [{ name: "", color: "transparent", xs, ys, width: 0 }],  // anchor X range
        markers: showDot ? [{
          name: seriesName,
          color: "#a78bfa",
          shape: "dot",
          size: 4,
          xs, ys,
        }] : [],
        limitLines: [{ value: 0, color: "#71717a", dash: [4, 4] }],
      });
      lastKey = key;
    }
    chart.setCursorX(ref.timestamps[state.tickIdx] ?? 0);
  }

  subscribe(render);
  render();
}

/* ─── IV vs Time Panel ─── */

export function mountIVTimeChart({
  canvasEl, emptyEl, titleEl, legendEl,
  resetZoomBtn, modeLineBtn, modeDotBtn,
}) {
  let chart = null;
  let lastKey = null;
  let showLine = true;
  let showDot = false;

  resetZoomBtn.addEventListener("click", () => chart?.resetXView());

  modeLineBtn.classList.toggle("active", showLine);
  modeDotBtn.classList.toggle("active", showDot);
  modeLineBtn.addEventListener("click", () => {
    showLine = !showLine;
    modeLineBtn.classList.toggle("active", showLine);
    lastKey = null;
    render();
  });
  modeDotBtn.addEventListener("click", () => {
    showDot = !showDot;
    modeDotBtn.classList.toggle("active", showDot);
    lastKey = null;
    render();
  });

  function ensureChart() {
    if (chart) return;
    chart = createChart(canvasEl, {
      onHover: (values) => {
        if (!values) { legendEl.innerHTML = ""; return; }
        const items = values.map((v) => {
          if (v == null) return "";
          return `<span class="legend-row"><span class="legend-swatch" style="background:#f59e0b"></span><span class="legend-name">IV</span><span class="legend-value">${(v * 100).toFixed(2)}%</span></span>`;
        }).filter(Boolean);
        legendEl.innerHTML = items.join("");
      },
    });
  }

  function render() {
    const state = getState();
    const ref = getReference(state);
    const product = state.selectedProduct;
    const strike = strikeFromProduct(product);

    if (!ref || strike === null) {
      emptyEl.textContent = strike === null
        ? "Select a VEV option from the product dropdown."
        : "Load data first.";
      emptyEl.classList.remove("hidden");
      canvasEl.classList.add("hidden");
      return;
    }

    titleEl.textContent = `Implied Volatility vs Time · ${product}`;
    emptyEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
    ensureChart();

    const key = `${ref.id}|${product}|${showLine}|${showDot}`;
    if (key !== lastKey) {
      const { xs, ys } = buildIVTimeSeries(ref, strike);
      chart.setData({
        xFormat: (v) => Math.round(v).toLocaleString(),
        yFormat: (v) => (v * 100).toFixed(1) + "%",
        targetPoints: 2000,
        series: showLine
          ? [{ name: "Implied Volatility", color: "#f59e0b", xs, ys, width: 1.5 }]
          : [{ name: "", color: "transparent", xs, ys, width: 0 }],  // anchor X range
        markers: showDot ? [{
          name: "Implied Volatility",
          color: "#f59e0b",
          shape: "dot",
          size: 4,
          xs, ys,
        }] : [],
        limitLines: [
          { value: 0,   color: "transparent" },
          { value: 1.0, color: "transparent" },
        ],
      });
      lastKey = key;
    }
    chart.setCursorX(ref.timestamps[state.tickIdx] ?? 0);
  }

  subscribe(render);
  render();
}
