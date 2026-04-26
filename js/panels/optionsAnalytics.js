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

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function bsCallPrice(S, K, T, r, sigma) {
  if (T <= 0) return Math.max(0, S - K);
  if (sigma <= 0) return Math.max(0, S - K);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

function bsVega(S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return S * Math.sqrt(T) * (Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI));
}

function impliedVol(marketPrice, S, K, T, r) {
  if (T <= 0 || marketPrice <= 0) return NaN;
  const intrinsic = Math.max(0, S - K);
  if (marketPrice <= intrinsic) return 0;
  
  let low = 1e-4;
  let high = 10.0;
  
  // If the max allowed volatility still can't reach the market price, it's out of bounds
  if (bsCallPrice(S, K, T, r, high) < marketPrice) return NaN;
  
  // 100 iterations of Bisection guarantees extreme precision without Newton-Raphson's instability
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    const price = bsCallPrice(S, K, T, r, mid);
    if (price < marketPrice) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
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
    const roundNum = ref?.round ?? 3;

    titleEl.textContent = "Moneyness · VEV Options";
    paramsEl.innerHTML = `<span class="param-pill">Type: ${bsParams.optionType}</span>
      <span class="param-pill">R${roundNum} Day ${dayNum}</span>
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
    const roundNum = ref?.round ?? 3;
    const ts = ref?.rawTimestamps?.[state.tickIdx] ?? 0;
    const tte = TTE_BASE_DAYS - dayNum - (ts / 1000000);
    const T = tte / 365; // Annualized perspective (365 days)

    titleEl.textContent = "Implied Volatility Smile · VEV Options";
    paramsEl.innerHTML = `<span class="param-pill">r: ${(bsParams.riskFreeRate * 100).toFixed(1)}%</span>
      <span class="param-pill">q: ${(bsParams.dividendYield * 100).toFixed(1)}%</span>
      <span class="param-pill">Type: ${bsParams.optionType}</span>
      <span class="param-pill">R${roundNum} Day ${dayNum}</span>
      <span class="param-pill">TTE: ${tte.toFixed(3)}d (${T.toFixed(4)}y)</span>`;

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
function buildMoneynessTimeSeries(ref, strike, subtractPremium, clamp = false) {
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
    ys[i] = clamp ? Math.max(m, 0) : m;
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
    const ts = ref.rawTimestamps[i] ?? 0;
    const tte = TTE_BASE_DAYS - day - (ts / 1000000);
    const T = tte / 365; // Annualized perspective (365 days)
    if (!Number.isFinite(spot) || !Number.isFinite(prem) || prem <= 0 || T <= 0) {
      ys[i] = NaN; continue;
    }
    ys[i] = impliedVol(prem, spot, strike, T, bsParams.riskFreeRate);
  }
  return { xs, ys };
}

function polyFit2(xs, ys) {
  let s_x=0, s_x2=0, s_x3=0, s_x4=0, s_y=0, s_xy=0, s_x2y=0;
  const n = xs.length;
  if (n < 3) return null;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    const x2 = x*x;
    s_x += x; s_x2 += x2; s_x3 += x2*x; s_x4 += x2*x2;
    s_y += y; s_xy += x*y; s_x2y += x2*y;
  }
  const m = [
    [n, s_x, s_x2],
    [s_x, s_x2, s_x3],
    [s_x2, s_x3, s_x4]
  ];
  const v = [s_y, s_xy, s_x2y];
  
  const det = m[0][0]*(m[1][1]*m[2][2] - m[1][2]*m[2][1])
            - m[0][1]*(m[1][0]*m[2][2] - m[1][2]*m[2][0])
            + m[0][2]*(m[1][0]*m[2][1] - m[1][1]*m[2][0]);
  if (Math.abs(det) < 1e-12) return null;

  const c = ((m[1][1]*m[2][2] - m[1][2]*m[2][1])*v[0] + (m[0][2]*m[2][1] - m[0][1]*m[2][2])*v[1] + (m[0][1]*m[1][2] - m[0][2]*m[1][1])*v[2])/det;
  const b = ((m[1][2]*m[2][0] - m[1][0]*m[2][2])*v[0] + (m[0][0]*m[2][2] - m[0][2]*m[2][0])*v[1] + (m[0][2]*m[1][0] - m[0][0]*m[1][2])*v[2])/det;
  const a = ((m[1][0]*m[2][1] - m[1][1]*m[2][0])*v[0] + (m[0][1]*m[2][0] - m[0][0]*m[2][1])*v[1] + (m[0][0]*m[1][1] - m[0][1]*m[1][0])*v[2])/det;
  
  return { a, b, c }; // y = a*x^2 + b*x + c
}

/* ─── Moneyness vs Time Panel ─── */

export function mountMoneynessTimeChart({
  canvasEl, emptyEl, titleEl, legendEl,
  premiumToggle, clampToggle, resetZoomBtn, modeLineBtn, modeDotBtn,
}) {
  let chart = null;
  let lastKey = null;
  let subtractPremium = false;
  let clamp = false;
  let showLine = true;
  let showDot = false;

  premiumToggle.addEventListener("change", () => {
    subtractPremium = premiumToggle.checked;
    lastKey = null;
    render();
  });
  if (clampToggle) {
    clampToggle.addEventListener("change", () => {
      clamp = clampToggle.checked;
      lastKey = null;
      render();
    });
  }
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

    const key = `${ref.id}|${product}|${subtractPremium}|${clamp}|${showLine}|${showDot}`;
    if (key !== lastKey) {
      const { xs, ys } = buildMoneynessTimeSeries(ref, strike, subtractPremium, clamp);
      const seriesName = clamp
        ? (subtractPremium ? "max(Moneyness − Premium, 0)" : "max(Spot − Strike, 0)")
        : (subtractPremium ? "Moneyness − Premium" : "Moneyness (Spot − Strike)");
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

/* ─── IV vs Moneyness Scatter Panel ─── */

export function mountIVMoneynessScatterChart({
  canvasEl, emptyEl, titleEl, legendEl,
  premiumToggle, fitToggle, resetZoomBtn,
}) {
  let chart = null;
  let lastKey = null;
  let subtractPremium = false;
  let showFit = true;

  premiumToggle.addEventListener("change", () => {
    subtractPremium = premiumToggle.checked;
    lastKey = null;
    render();
  });
  if (fitToggle) {
    showFit = fitToggle.checked;
    fitToggle.addEventListener("change", () => {
      showFit = fitToggle.checked;
      lastKey = null;
      render();
    });
  }
  resetZoomBtn.addEventListener("click", () => chart?.resetXView());

  function ensureChart() {
    if (chart) return;
    chart = createChart(canvasEl, {
      onHover: (values) => {
        if (!values) { legendEl.innerHTML = ""; return; }
        const items = values.map((v) => {
          if (v == null) return "";
          return `<span class="legend-row"><span class="legend-swatch" style="background:#10b981"></span><span class="legend-name">IV</span><span class="legend-value">${(v * 100).toFixed(2)}%</span></span>`;
        }).filter(Boolean);
        legendEl.innerHTML = items.join("");
      },
    });
  }

  function render() {
    const state = getState();
    const ref = getReference(state);

    if (!ref) {
      emptyEl.textContent = "Load data first.";
      emptyEl.classList.remove("hidden");
      canvasEl.classList.add("hidden");
      return;
    }

    titleEl.textContent = `IV vs Moneyness (All Options)`;
    emptyEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
    ensureChart();

    const key = `${ref.id}|${subtractPremium}|${showFit}`;
    if (key !== lastKey) {
      const markers = [];
      const spotSeries = ref.series[SPOT_PRODUCT];
      const colors = ['#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#6366f1', '#d946ef'];
      
      const allFitXs = [];
      const allFitYs = [];

      for (let sIdx = 0; sIdx < VEV_STRIKES.length; sIdx++) {
        const strike = VEV_STRIKES[sIdx];
        const optSeries = ref.series[`VEV_${strike}`];
        if (!optSeries) continue;

        const xs = [];
        const ys = [];

        for (let i = 0; i < ref.timestamps.length; i++) {
          const spot = spotSeries?.midPrice[i];
          const prem = optSeries?.midPrice[i];
          const day = ref.days[i] ?? 0;
          const ts = ref.rawTimestamps[i] ?? 0;
          const tte = TTE_BASE_DAYS - day - (ts / 1000000);
          const T = tte / 365;

          if (!Number.isFinite(spot) || !Number.isFinite(prem) || prem <= 0 || T <= 0) {
            continue;
          }

          let moneyness = (spot - strike) / spot;
          if (subtractPremium) moneyness -= (prem / spot);

          const iv = impliedVol(prem, spot, strike, T, bsParams.riskFreeRate);
          if (Number.isFinite(iv)) {
            xs.push(moneyness);
            ys.push(iv);
            if (iv >= 0.05) { // ignore noise near 0% for high ITM options
              allFitXs.push(moneyness);
              allFitYs.push(iv);
            }
          }
        }

        markers.push({
          name: `VEV_${strike}`,
          color: colors[sIdx % colors.length],
          shape: "dot",
          size: 3,
          xs, ys,
        });
      }

      const series = [];
      if (showFit && allFitXs.length >= 3) {
        const coeffs = polyFit2(allFitXs, allFitYs);
        if (coeffs) {
          const minX = Math.min(...allFitXs);
          const maxX = Math.max(...allFitXs);
          const fitXs = [];
          const fitYs = [];
          for (let i = 0; i <= 100; i++) {
            const x = minX + (maxX - minX) * (i / 100);
            const y = coeffs.a * x * x + coeffs.b * x + coeffs.c;
            fitXs.push(x);
            fitYs.push(y);
          }
          series.push({
            name: "Best Fit (Quad)",
            color: "#ffffff",
            width: 3,
            xs: fitXs,
            ys: fitYs
          });
        }
      }

      chart.setData({
        xFormat: (v) => (v * 100).toFixed(2) + "%",
        yFormat: (v) => (v * 100).toFixed(1) + "%",
        targetPoints: Infinity,
        series: series,
        markers: markers,
        limitLines: [
          { value: 0, color: "#71717a", dash: [4, 4] },
        ],
      });
      lastKey = key;
    }
  }

  subscribe(render);
  render();
}

/* ─── IV vs Moneyness (Log-Normal) Panel ─── */

export function mountIVMoneynessLogChart({
  canvasEl, emptyEl, titleEl, legendEl,
  premiumToggle, fitToggle, resetZoomBtn,
}) {
  let chart = null;
  let lastKey = null;
  let subtractPremium = false;
  let showFit = true;

  premiumToggle.addEventListener("change", () => {
    subtractPremium = premiumToggle.checked;
    lastKey = null;
    render();
  });
  if (fitToggle) {
    showFit = fitToggle.checked;
    fitToggle.addEventListener("change", () => {
      showFit = fitToggle.checked;
      lastKey = null;
      render();
    });
  }
  resetZoomBtn.addEventListener("click", () => chart?.resetXView());

  function ensureChart() {
    if (chart) return;
    chart = createChart(canvasEl, {
      onHover: (values) => {
        if (!values) { legendEl.innerHTML = ""; return; }
        const items = values.map((v) => {
          if (v == null) return "";
          return `<span class="legend-row"><span class="legend-swatch" style="background:#10b981"></span><span class="legend-name">IV</span><span class="legend-value">${(v * 100).toFixed(2)}%</span></span>`;
        }).filter(Boolean);
        legendEl.innerHTML = items.join("");
      },
    });
  }

  function render() {
    const state = getState();
    const ref = getReference(state);

    if (!ref) {
      emptyEl.textContent = "Load data first.";
      emptyEl.classList.remove("hidden");
      canvasEl.classList.add("hidden");
      return;
    }

    titleEl.textContent = `IV vs Moneyness (Log-Normal)`;
    emptyEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
    ensureChart();

    const key = `${ref.id}|${subtractPremium}|${showFit}`;
    if (key !== lastKey) {
      const markers = [];
      const spotSeries = ref.series[SPOT_PRODUCT];
      const colors = ['#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#6366f1', '#d946ef'];
      
      const allFitXs = [];
      const allFitYs = [];

      for (let sIdx = 0; sIdx < VEV_STRIKES.length; sIdx++) {
        const strike = VEV_STRIKES[sIdx];
        const optSeries = ref.series[`VEV_${strike}`];
        if (!optSeries) continue;

        const xs = [];
        const ys = [];

        for (let i = 0; i < ref.timestamps.length; i++) {
          const spot = spotSeries?.midPrice[i];
          const prem = optSeries?.midPrice[i];
          const day = ref.days[i] ?? 0;
          const ts = ref.rawTimestamps[i] ?? 0;
          const tte = TTE_BASE_DAYS - day - (ts / 1000000);
          const T = tte / 365;

          if (!Number.isFinite(spot) || !Number.isFinite(prem) || prem <= 0 || T <= 0) {
            continue;
          }

          // Formula from image: m_t = log(K / S_t) / sqrt(TTE)
          let moneyness = Math.log(strike / spot) / Math.sqrt(T);
          
          // If subtracting premium, we adjust the effective spot or strike? 
          // Usually we adjust the moneyness directly. 
          // Previous logic was (spot - strike) / spot. 
          // If we want to keep it consistent, we stick to the provided formula.
          // Note: subtractPremium logic for this specific log-normal formula is less standard, 
          // but we'll apply a similar linear adjustment if requested.
          if (subtractPremium) {
             // Linear adjustment: m_adj = m - (prem / spot) / sqrt(T)
             // or similar? Let's just apply the same logic: subtract from the final value.
             moneyness -= (prem / spot) / Math.sqrt(T);
          }

          const iv = impliedVol(prem, spot, strike, T, bsParams.riskFreeRate);
          if (Number.isFinite(iv)) {
            xs.push(moneyness);
            ys.push(iv);
            if (iv >= 0.05) { 
              allFitXs.push(moneyness);
              allFitYs.push(iv);
            }
          }
        }

        markers.push({
          name: `VEV_${strike}`,
          color: colors[sIdx % colors.length],
          shape: "dot",
          size: 3,
          xs, ys,
        });
      }

      const series = [];
      if (showFit && allFitXs.length >= 3) {
        const coeffs = polyFit2(allFitXs, allFitYs);
        if (coeffs) {
          const minX = Math.min(...allFitXs);
          const maxX = Math.max(...allFitXs);
          const fitXs = [];
          const fitYs = [];
          for (let i = 0; i <= 100; i++) {
            const x = minX + (maxX - minX) * (i / 100);
            const y = coeffs.a * x * x + coeffs.b * x + coeffs.c;
            fitXs.push(x);
            fitYs.push(y);
          }
          series.push({
            name: "Best Fit (Quad)",
            color: "#ffffff",
            width: 3,
            xs: fitXs,
            ys: fitYs
          });
        }
      }

      chart.setData({
        xFormat: (v) => v.toFixed(3),
        yFormat: (v) => (v * 100).toFixed(1) + "%",
        targetPoints: Infinity,
        series: series,
        markers: markers,
        limitLines: [
          { value: 0, color: "#71717a", dash: [4, 4] },
        ],
      });
      lastKey = key;
    }
  }

  subscribe(render);
  render();
}


