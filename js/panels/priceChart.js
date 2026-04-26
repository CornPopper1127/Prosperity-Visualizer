import {
  subscribe,
  getState,
  getReference,
  setTickIdx,
  setPrefs,
} from "../store.js";
import { createChart } from "../chart.js";

// Default toggle state lives in prefs so the user's choice persists.
// Keys: priceLevels (L2/L3), priceBuys, priceSells, priceBots, priceOverlayDays.
//
// Products whose fair value drifts by a known amount per day. In overlay
// mode we subtract `day * offset` from prices so the days line up on a
// common y-axis instead of stepping up the chart.
const DAY_OFFSET_PER_DAY = {
  INTARIAN_PEPPER_ROOT: 1000,
};

export function mountPriceChart({
  canvasEl,
  emptyEl,
  titleEl,
  legendEl,
  levelsCheck,
  midCheck,
  microCheck,
  wallMidCheck,
  buysCheck,
  sellsCheck,
  botsCheck,
  moCheck,
  bidAskCheck,
  sigma1Check,
  sigma2Check,
  sigma3Check,
  overlayCheck,
  joinGapsCheck,
  resetZoomBtn,
  modeLineBtn,
  modeDotBtn,
}) {
  let chart = null;
  let zScoreChart = null;
  let lastKey = null;
  let currentLegend = [];
  let showLine = true;
  let showDot = false;

  levelsCheck.addEventListener("change", () =>
    setPrefs({ priceLevels: levelsCheck.checked })
  );
  midCheck.addEventListener("change", () =>
    setPrefs({ priceMid: midCheck.checked })
  );
  microCheck.addEventListener("change", () =>
    setPrefs({ priceMicro: microCheck.checked })
  );
  wallMidCheck.addEventListener("change", () =>
    setPrefs({ priceWallMid: wallMidCheck.checked })
  );
  buysCheck.addEventListener("change", () =>
    setPrefs({ priceBuys: buysCheck.checked })
  );
  sellsCheck.addEventListener("change", () =>
    setPrefs({ priceSells: sellsCheck.checked })
  );
  botsCheck.addEventListener("change", () =>
    setPrefs({ priceBots: botsCheck.checked })
  );
  moCheck.addEventListener("change", () =>
    setPrefs({ priceMo: moCheck.checked })
  );
  bidAskCheck.addEventListener("change", () =>
    setPrefs({ priceBidAsk: bidAskCheck.checked })
  );
  sigma1Check.addEventListener("change", () =>
    setPrefs({ zScoreSigma1: sigma1Check.checked })
  );
  sigma2Check.addEventListener("change", () =>
    setPrefs({ zScoreSigma2: sigma2Check.checked })
  );
  sigma3Check.addEventListener("change", () =>
    setPrefs({ zScoreSigma3: sigma3Check.checked })
  );
  overlayCheck.addEventListener("change", () =>
    setPrefs({ priceOverlayDays: overlayCheck.checked })
  );
  joinGapsCheck.addEventListener("change", () =>
    setPrefs({ priceJoinGaps: joinGapsCheck.checked })
  );
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

  let isSyncing = false;

  function ensureChart() {
    if (chart) return;
    
    const onSeek = (xValue) => {
      const state = getState();
      const ref = getReference(state);
      if (!ref) return;
      const ts = ref.timestamps;
      if (ts.length < 2) return;
      let lo = 0; let hi = ts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (ts[mid] < xValue) lo = mid + 1;
        else hi = mid;
      }
      setTickIdx(lo);
    };

    const onHover = (values, xValue, markerValues) => {
      if (isSyncing) return;
      isSyncing = true;
      zScoreChart?.setCursorX(xValue);
      renderLegend(values, markerValues);
      isSyncing = false;
    };

    const onRangeChange = (range) => {
      if (isSyncing) return;
      isSyncing = true;
      if (range) zScoreChart?.setXView(range[0], range[1]);
      else zScoreChart?.resetXView();
      isSyncing = false;
    };

    chart = createChart(canvasEl, { onSeek, onHover, onRangeChange });
    
    // Z-Score Chart
    const zCanvas = canvasEl.closest('.panel-body').querySelector('#chart-zscore');
    if (zCanvas) {
      zScoreChart = createChart(zCanvas, {
        noGrid: true,
        onSeek,
        onHover: (_, xValue) => {
          if (isSyncing) return;
          isSyncing = true;
          chart?.setCursorX(xValue);
          isSyncing = false;
        },
        onRangeChange: (range) => {
          if (isSyncing) return;
          isSyncing = true;
          if (range) chart?.setXView(range[0], range[1]);
          else chart?.resetXView();
          isSyncing = false;
        }
      });
    }
  }

  function renderLegend(values, markerValues) {
    if (!currentLegend.length) {
      legendEl.innerHTML = "";
      return;
    }
    
    const rows = currentLegend.map((s) => {
      let v = null;
      if (values && s.seriesIdx) {
        for (const idx of s.seriesIdx) {
          const candidate = values[idx];
          if (candidate != null && Number.isFinite(candidate)) {
            v = candidate;
            break;
          }
        }
      }
      const swatch = s.marker
        ? `<span class="legend-swatch marker-${s.marker}" style="background:${s.color};color:${s.color}"></span>`
        : s.dash
          ? `<span class="legend-swatch dash" style="color:${s.color}"></span>`
          : `<span class="legend-swatch" style="background:${s.color}"></span>`;
      const val =
        v == null
          ? s.marker
            ? ""
            : `<span class="legend-value muted">—</span>`
          : `<span class="legend-value">${v.toFixed(1)}</span>`;
      return `<span class="legend-row">${swatch}<span class="legend-name">${escapeHtml(s.name)}</span>${val}</span>`;
    });

    if (markerValues) {
      for (const m of markerValues) {
        const swatch = `<span class="legend-swatch marker-diamond" style="background:${m.color};color:${m.color}"></span>`;
        const val = `<span class="legend-value">${m.value.toFixed(1)}</span>`;
        rows.push(`<span class="legend-row">${swatch}<span class="legend-name">${escapeHtml(m.name)}</span>${val}</span>`);
      }
    }

    legendEl.innerHTML = rows.join("");
  }

  function computeModel(state, ref, product) {
    const ps = ref.series[product];
    const overlay = !!state.prefs.priceOverlayDays;
    const dayOffset = DAY_OFFSET_PER_DAY[product] ?? 0;
    // `priceJoinGaps` defaults to true (existing behavior — connect across
    // missing samples). When false, NaNs lift the pen and leave visible gaps.
    const breakOnNaN = state.prefs.priceJoinGaps === false;

    // In overlay mode, each metric becomes N sub-series (one per day)
    // plotted against raw ts; otherwise a single series against tickKey.
    // Roots-style products get a per-day y-offset removed so the daily
    // price patterns sit on the same y range.
    const segments = buildSegments(ref, overlay);
    const makeSeries = (ys, baseProps) => {
      if (!overlay) {
        return [{ ...baseProps, breakOnNaN, xs: segments[0].xs, ys }];
      }
      const out = [];
      for (const seg of segments) {
        const raw = ys.slice(seg.start, seg.end);
        const segYs = dayOffset
          ? raw.map((v) => (Number.isFinite(v) ? v - seg.day * dayOffset : v))
          : raw;
        out.push({ ...baseProps, breakOnNaN, xs: seg.xs, ys: segYs });
      }
      return out;
    };

    // Helper for Z-score plotting that uses precomputed fields
    const makeZSeries = (ysField, threshold, baseProps) => {
      const zs = ps[ysField];
      if (!zs) return [];
      
      const ys = threshold > 0 
        ? zs.map(v => (Math.abs(v) >= threshold ? v : NaN))
        : zs;

      if (!overlay) {
        return [{ ...baseProps, breakOnNaN, xs: segments[0].xs, ys }];
      }
      const out = [];
      for (const seg of segments) {
        out.push({ ...baseProps, breakOnNaN, xs: seg.xs, ys: ys.slice(seg.start, seg.end) });
      }
      return out;
    };

    const series = [];
    if (state.prefs.priceBidAsk !== false) {
      series.push(...makeSeries(ps.bestAsk, { name: "Best ask (L1)", color: "#f87171", width: 1.2 }));
      series.push(...makeSeries(ps.bestBid, { name: "Best bid (L1)", color: "#34d399", width: 1.2 }));
    }

    if (state.prefs.priceLevels !== false) {
      series.push(...makeSeries(ps.askPrices?.[1] ?? [], { name: "Ask L2", color: "#f8717199", width: 1 }));
      series.push(...makeSeries(ps.askPrices?.[2] ?? [], { name: "Ask L3", color: "#f8717166", width: 1 }));
      series.push(...makeSeries(ps.bidPrices?.[1] ?? [], { name: "Bid L2", color: "#34d39999", width: 1 }));
      series.push(...makeSeries(ps.bidPrices?.[2] ?? [], { name: "Bid L3", color: "#34d39966", width: 1 }));
    }
    if (state.prefs.priceMid !== false) {
      series.push(...makeSeries(ps.midPrice, { name: "Mid", color: "#a78bfa", width: 1.6 }));
    }
    if (state.prefs.priceMicro !== false) {
      series.push(...makeSeries(ps.microPrice, { name: "Microprice", color: "#2dd4bf", width: 1.2, dash: [4, 3] }));
    }
    if (state.prefs.priceWallMid !== false) {
      series.push(...makeSeries(ps.wallMid ?? [], { name: "Wall mid", color: "#3b82f6", width: 1.2, dash: [2, 4] }));
    }

    // Markers: SUBMISSION buys (^), SUBMISSION sells (v), bot trades (·).
    const markers = [];
    const ownBuysXs = [];
    const ownBuysYs = [];
    const ownSellsXs = [];
    const ownSellsYs = [];
    
    // Group bot trades by ID if filter is enabled
    const botTradesById = new Map();
    const botFilterEnabled = !!state.prefs.botFilterEnabled;
    const selectedBotIds = state.prefs.selectedBotIds || [];

    for (const t of ref.trades) {
      if (t.symbol !== product) continue;
      const x = overlay ? t.timestamp : (t.tickKey ?? t.timestamp);
      const y = overlay && dayOffset ? t.price - (t.day ?? 0) * dayOffset : t.price;
      
      if (t.buyer === "SUBMISSION") {
        ownBuysXs.push(x);
        ownBuysYs.push(y);
      } else if (t.seller === "SUBMISSION") {
        ownSellsXs.push(x);
        ownSellsYs.push(y);
      } else {
        const botId = t.buyer.toLowerCase().startsWith("mark ") ? t.buyer : (t.seller.toLowerCase().startsWith("mark ") ? t.seller : "Other Bots");
        
        if (botFilterEnabled && botId.toLowerCase().startsWith("mark ") && !selectedBotIds.includes(botId)) {
          continue; 
        }

        if (!botTradesById.has(botId)) botTradesById.set(botId, { xs: [], ys: [] });
        const group = botTradesById.get(botId);
        group.xs.push(x);
        group.ys.push(y);
      }
    }

    if (state.prefs.priceBuys)
      markers.push({
        name: "Own buys",
        color: "#4ade80",
        outline: "#052e16",
        shape: "up",
        size: 11,
        xs: ownBuysXs,
        ys: ownBuysYs,
      });
    if (state.prefs.priceSells)
      markers.push({
        name: "Own sells",
        color: "#fb7185",
        outline: "#450a0a",
        shape: "down",
        size: 11,
        xs: ownSellsXs,
        ys: ownSellsYs,
      });

    if (state.prefs.priceBots) {
      const botColors = [
        "#f472b6", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#a78bfa",
        "#ec4899", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#8b5cf6"
      ];
      let colorIdx = 0;
      
      for (const [botId, group] of botTradesById.entries()) {
        const isSelectedBot = botId.toLowerCase().startsWith("mark ");
        const color = isSelectedBot 
          ? botColors[colorIdx++ % botColors.length]
          : "#d4d4d8";
          
        markers.push({
          name: botId,
          color: color,
          outline: isSelectedBot ? "#00000066" : "#18181b",
          shape: "dot",
          size: isSelectedBot ? 8 : 6,
          xs: group.xs,
          ys: group.ys,
        });
      }
    }

    if (state.prefs.priceMo && product === "HYDROGEL_PACK") {
      const buyXs = [], buyYs = [];
      const sellXs = [], sellYs = [];
      const sp = ps.spread;
      const mid = ps.midPrice;
      const ts = ref.timestamps;
      const asks = ps.bestAsk;
      const bids = ps.bestBid;
      
      for (let i = 1; i < sp.length; i++) {
        if (sp[i] < 10) {
          const delta = mid[i] - mid[i-1];
          if (delta > 0) {
            buyXs.push(ts[i]);
            buyYs.push(bids[i]); // Plotted at the new higher Bid
          } else if (delta < 0) {
            sellXs.push(ts[i]);
            sellYs.push(asks[i]); // Plotted at the new lower Ask
          } else {
            buyXs.push(ts[i]);
            buyYs.push(bids[i]);
          }
        }
      }
      
      if (buyXs.length > 0) {
        markers.push({
          name: "MO Buy",
          color: "#10b981",
          outline: "#064e3b",
          shape: "diamond",
          size: 6,
          xs: buyXs,
          ys: buyYs,
        });
      }
      if (sellXs.length > 0) {
        markers.push({
          name: "MO Sell",
          color: "#ef4444",
          outline: "#450a0a",
          shape: "diamond",
          size: 6,
          xs: sellXs,
          ys: sellYs,
        });
      }
    }

    // Dedupe legend by series name (overlay mode emits N sub-series per
    // metric that should collapse into one legend row).
    const legendByName = new Map();
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      const existing = legendByName.get(s.name);
      if (existing) {
        existing.seriesIdx.push(i);
      } else {
        legendByName.set(s.name, {
          name: s.name,
          color: s.color,
          dash: !!s.dash,
          seriesIdx: [i],
        });
      }
    }
    currentLegend = Array.from(legendByName.values());
    for (const mk of markers) {
      currentLegend.push({
        name: `${mk.name} (${mk.xs.length})`,
        color: mk.color,
        marker: mk.shape,
      });
    }

    const seriesOutput = [];
    for (const s of series) {
      if (showLine) {
        seriesOutput.push(s);
      } else {
        seriesOutput.push({ ...s, width: 0, color: "transparent" });
      }
      if (showDot) {
        markers.push({
          name: s.name,
          color: s.color,
          shape: "dot",
          size: 4,
          xs: s.xs,
          ys: s.ys,
        });
      }
    }

    return {
      xFormat: (v) => Math.round(v % 1000000).toLocaleString(),
      yFormat: (v) => v.toFixed(1),
      targetPoints: state.prefs.showSampled ? 1500 : Infinity,
      series: seriesOutput,
      markers,
      makeZSeries,
    };
  }

  function render() {
    const state = getState();
    const ref = getReference(state);
    const product = state.selectedProduct ?? ref?.products[0] ?? null;
    titleEl.textContent = `Price & Liquidity ${product ? "· " + product : ""}`;

    levelsCheck.checked = state.prefs.priceLevels !== false;
    midCheck.checked = state.prefs.priceMid !== false;
    microCheck.checked = state.prefs.priceMicro !== false;
    wallMidCheck.checked = state.prefs.priceWallMid !== false;
    buysCheck.checked = !!state.prefs.priceBuys;
    sellsCheck.checked = !!state.prefs.priceSells;
    botsCheck.checked = !!state.prefs.priceBots;
    moCheck.checked = !!state.prefs.priceMo;
    bidAskCheck.checked = state.prefs.priceBidAsk !== false;
    sigma1Check.checked = state.prefs.zScoreSigma1 !== false;
    sigma2Check.checked = state.prefs.zScoreSigma2 !== false;
    sigma3Check.checked = state.prefs.zScoreSigma3 !== false;
    overlayCheck.checked = !!state.prefs.priceOverlayDays;
    joinGapsCheck.checked = state.prefs.priceJoinGaps !== false;

    if (!ref || !product) {
      if (chart) {
        chart.destroy();
        chart = null;
      }
      currentLegend = [];
      legendEl.innerHTML = "";
      emptyEl.textContent = ref ? "Select a product." : "Load a log to see prices.";
      emptyEl.classList.remove("hidden");
      canvasEl.classList.add("hidden");
      return;
    }
    emptyEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
    ensureChart();

    const key = [
      ref.id,
      product,
      state.prefs.showSampled,
      state.prefs.priceLevels !== false,
      state.prefs.priceMid !== false,
      state.prefs.priceMicro !== false,
      state.prefs.priceWallMid !== false,
      !!state.prefs.priceBuys,
      !!state.prefs.priceSells,
      !!state.prefs.priceBots,
      !!state.prefs.botFilterEnabled,
      (state.prefs.selectedBotIds || []).join(","),
      !!state.prefs.priceMo,
      state.prefs.priceBidAsk !== false,
      state.prefs.zScoreSigma1 !== false,
      state.prefs.zScoreSigma2 !== false,
      state.prefs.zScoreSigma3 !== false,
      !!state.prefs.priceOverlayDays,
      state.prefs.priceJoinGaps !== false,
      showLine,
      showDot,
    ].join("|");

    if (key !== lastKey) {
      const model = computeModel(state, ref, product);
      chart.setData(model);
      
      if (zScoreChart) {
        const ps = ref.series[product];
        const zSeries = [];
        
        // Determine filtering threshold based on highest enabled sigma
        let threshold = 0;
        if (state.prefs.zScoreSigma3 !== false) threshold = 3;
        else if (state.prefs.zScoreSigma2 !== false) threshold = 2;
        else if (state.prefs.zScoreSigma1 !== false) threshold = 1;

        const addZ = (field, name, color) => {
          zSeries.push(...model.makeZSeries(field, threshold, { name, color, width: 1.5 }));
        };

        if (state.prefs.priceBidAsk !== false) {
          addZ("zAsk", "Ask Z", "#f87171");
          addZ("zBid", "Bid Z", "#34d399");
        }
        if (state.prefs.priceMid !== false) addZ("zMid", "Mid Z", "#a78bfa");
        if (state.prefs.priceMicro !== false) addZ("zMicro", "Micro Z", "#2dd4bf");
        if (state.prefs.priceWallMid !== false) addZ("zWallMid", "Wall Mid Z", "#3b82f6");

        const limits = [];
        if (state.prefs.zScoreSigma1 !== false) {
          limits.push({ value: 1, color: "#71717a", dash: [4, 4] });
          limits.push({ value: -1, color: "#71717a", dash: [4, 4] });
        }
        if (state.prefs.zScoreSigma2 !== false) {
          limits.push({ value: 2, color: "#52525b", dash: [2, 2] });
          limits.push({ value: -2, color: "#52525b", dash: [2, 2] });
        }
        if (state.prefs.zScoreSigma3 !== false) {
          limits.push({ value: 3, color: "#3f3f46", dash: [1, 1] });
          limits.push({ value: -3, color: "#3f3f46", dash: [1, 1] });
        }
        limits.push({ value: 0, color: "#ffffff33", width: 1 });

        const zMarkers = [];
        for (const mk of model.markers) {
          const zxs = [];
          const zys = [];
          const psField = mk.name.includes("MO") ? "zMid" : "zMid";
          const zSource = ps[psField];
          if (!zSource) continue;
          
          for (let i = 0; i < mk.xs.length; i++) {
            const tx = mk.xs[i];
            const ts = ref.timestamps;
            let lo = 0, hi = ts.length - 1;
            while(lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (ts[mid] < tx) lo = mid + 1; else hi = mid;
            }
            const z = zSource[lo] ?? NaN;
            if (Number.isFinite(z) && (threshold === 0 || Math.abs(z) >= threshold)) {
              zxs.push(tx);
              zys.push(z);
            }
          }
          if (zxs.length > 0) {
            zMarkers.push({ ...mk, xs: zxs, ys: zys, size: mk.size * 0.8 });
          }
        }

        zScoreChart.setData({
          xFormat: model.xFormat,
          yFormat: (v) => v.toFixed(1) + "σ",
          targetPoints: 2000,
          yRange: [-4, 4],
          series: showLine ? zSeries : zSeries.map(s => ({ ...s, color: "transparent", width: 0 })),
          markers: [
            ...(showDot ? zSeries.map(s => ({ ...s, shape: "dot", size: 4 })) : []),
            ...zMarkers
          ],
          limitLines: limits,
        });
      }
      
      lastKey = key;
      renderLegend(null);
    }
    const cursorX = state.prefs.priceOverlayDays
      ? ref.rawTimestamps[state.tickIdx] ?? 0
      : ref.timestamps[state.tickIdx] ?? 0;
    chart.setCursorX(cursorX);
    zScoreChart?.setCursorX(cursorX);
  }

  subscribe(render);
  render();
}


function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Split the flat per-tick arrays into per-day segments (for overlay mode)
 * or return a single segment spanning everything (for side-by-side mode).
 * Each segment carries its own xs array already built from either raw ts
 * (overlay) or tickKey (side-by-side), so the caller can plot directly.
 */
function buildSegments(ref, overlay) {
  const days = ref.days ?? [];
  const rawTs = ref.rawTimestamps ?? [];
  const tickKeys = ref.timestamps ?? [];
  const len = tickKeys.length;
  if (!overlay || len === 0) {
    return [{ day: days[0] ?? 0, start: 0, end: len, xs: tickKeys }];
  }
  const segs = [];
  let start = 0;
  for (let i = 1; i <= len; i++) {
    if (i === len || days[i] !== days[start]) {
      segs.push({
        day: days[start] ?? 0,
        start,
        end: i,
        xs: rawTs.slice(start, i),
      });
      start = i;
    }
  }
  return segs;
}

