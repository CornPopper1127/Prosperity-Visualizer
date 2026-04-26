import {
  subscribe,
  getState,
  addStrategy,
  setState,
  replaceStrategies,
} from "./js/store.js";
import { mountRail } from "./js/panels/rail.js";
import { mountTopBar } from "./js/panels/topBar.js";
import { mountKpi } from "./js/panels/kpi.js";
import { mountPnlChart } from "./js/panels/pnlChart.js";
import { mountPriceChart } from "./js/panels/priceChart.js";
import { mountPositionChart } from "./js/panels/positionChart.js";
import { mountSummary } from "./js/panels/summary.js";
import { mountOrderBook } from "./js/panels/orderBook.js";
import { mountPressure } from "./js/panels/pressure.js";
import { mountOwnFills } from "./js/panels/ownFills.js";
import { mountLogs } from "./js/panels/logs.js";

import { mountMoneynessChart, mountVolSmileChart, mountMoneynessTimeChart, mountIVTimeChart, mountIVMoneynessScatterChart, mountIVMoneynessLogChart } from "./js/panels/optionsAnalytics.js";
import { showAboutModal } from "./js/panels/about.js";
import { loadStrategies } from "./js/persistence.js";
import { loadDemoLog } from "./js/demoLog.js";
import { parseLogText } from "./js/parserClient.js";
import { pickColor } from "./js/colors.js";
import { uid } from "./js/uid.js";
import { loadCsvData, loadAllCsvDays } from "./js/csvLoader.js";
import { initLayout, restoreDefaultLayout } from "./js/panelLayout.js";

const DEMO_LOADED_KEY = "openprosperity:demo-loaded:v1";

function $(id) {
  return document.getElementById(id);
}

function openAbout() {
  showAboutModal($("modal-root"));
}

function applyTheme(theme) {
  document.body.classList.toggle("theme-dark", theme === "dark");
  document.body.classList.toggle("theme-light", theme === "light");
}

async function hydrate() {
  if (!getState().prefs.persistEnabled) return;
  try {
    const list = await loadStrategies();
    if (list.length > 0) replaceStrategies(list);
  } catch {
    /* ignore */
  }
}

async function maybeLoadDemo() {
  // Disabled — using CSV data source instead. Uncomment to re-enable.
  // if (getState().strategies.length > 0) return;
  // if (localStorage.getItem(DEMO_LOADED_KEY) === "1") return;
  // try {
  //   const text = await loadDemoLog();
  //   if (getState().strategies.length > 0) return;
  //   const strat = await parseLogText(text, {
  //     id: uid("demo"),
  //     name: "Demo — IMC Day 0 Sample",
  //     color: pickColor([]),
  //     filename: "demo.log",
  //   });
  //   addStrategy(strat);
  //   localStorage.setItem(DEMO_LOADED_KEY, "1");
  // } catch (err) {
  //   console.warn("Demo load failed:", err);
  // }
}

async function loadCsvDataSource() {
  try {
    const strats = await loadAllCsvDays([0, 1, 2]);
    if (strats.length === 0) {
      console.warn("No CSV days loaded.");
      return;
    }
    // Register all days as separate strategies
    replaceStrategies(strats);
    // Auto-select Day 0 as the reference
    setState({ referenceId: strats[0].id });
  } catch (err) {
    console.warn("CSV data load failed:", err);
  }
}

/** Inject a ▾ collapse toggle into every panel header automatically. */
function initPanelCollapse() {
  document.querySelectorAll(".panel").forEach((panel) => {
    const header = panel.querySelector(".panel-header");
    if (!header) return;
    const btn = document.createElement("button");
    btn.className = "panel-collapse-btn";
    btn.title = "Collapse / expand";
    btn.textContent = "▾";
    btn.addEventListener("click", () => panel.classList.toggle("collapsed"));
    // Insert as first child of header so it sits to the left of the title
    header.insertBefore(btn, header.firstChild);
  });
}

async function main() {
  // Theme init
  applyTheme(getState().prefs.theme);
  subscribe((state, prev) => {
    if (state.prefs.theme !== prev.prefs?.theme) applyTheme(state.prefs.theme);
  });

  // Rail
  mountRail({
    railEl: $("rail"),
    railExpandEl: $("rail-expand"),
    dropzoneEl: $("dropzone"),
    fileInputEl: $("file-input"),
    listEl: $("rail-list"),
    progressEl: $("parse-progress"),
    progressMessage: $("parse-progress-message"),
    progressPct: $("parse-progress-pct"),
    progressFill: $("parse-progress-fill"),
    persistToggle: $("persist-toggle"),
    collapseBtn: $("rail-collapse"),
    onShowAbout: openAbout,
  });
  $("open-about").addEventListener("click", openAbout);

  // Top bar
  mountTopBar({
    scrubberEl: $("scrubber"),
    tickCurEl: $("tick-cur"),
    tickMaxEl: $("tick-max"),
    tickTsEl: $("tick-ts"),
    tickDayPrefixEl: $("tick-day-prefix"),
    playBtn: $("play"),
    stepBackBtn: $("step-back"),
    stepFwdBtn: $("step-fwd"),
    speedGroupEl: $("speed-group"),
    productSelect: $("product-select"),
    themeBtn: $("theme-toggle"),
    aboutBtn: $("open-about-top"),
    onShowAbout: openAbout,
  });

  // Panels
  mountKpi($("kpi-grid"));

  mountPnlChart({
    canvasEl: $("chart-pnl"),
    emptyEl: $("chart-pnl-empty"),
    legendEl: $("pnl-legend"),
    normCheck: $("pnl-norm"),
    diffCheck: $("pnl-diff"),
    sampledCheck: $("pnl-sampled"),
    exportBtn: $("pnl-export"),
    resetZoomBtn: $("pnl-reset-zoom"),
    modeLineBtn: $("pnl-mode-line"),
    modeDotBtn: $("pnl-mode-dot"),
  });

  mountSummary({
    bodyEl: $("summary-body"),
    exportBtn: $("summary-export"),
  });

  mountPriceChart({
    canvasEl: $("chart-price"),
    emptyEl: $("chart-price-empty"),
    titleEl: $("price-title"),
    legendEl: $("price-legend"),
    levelsCheck: $("price-levels"),
    midCheck: $("price-mid"),
    microCheck: $("price-micro"),
    wallMidCheck: $("price-wallmid"),
    buysCheck: $("price-buys"),
    sellsCheck: $("price-sells"),
    botsCheck: $("price-bots"),
    moCheck: $("price-mo"),
    bidAskCheck: $("price-bidask"),
    sigma1Check: $("price-sigma1"),
    sigma2Check: $("price-sigma2"),
    sigma3Check: $("price-sigma3"),
    overlayCheck: $("price-overlay"),
    joinGapsCheck: $("price-join-gaps"),
    resetZoomBtn: $("price-reset-zoom"),
    modeLineBtn: $("price-mode-line"),
    modeDotBtn: $("price-mode-dot"),
  });

  mountOrderBook({
    bodyEl: $("book-body"),
    titleEl: $("book-title"),
    midSpreadEl: $("book-mid-spread"),
  });

  mountPressure({
    bodyEl: $("pressure-body"),
    titleEl: $("pressure-title"),
    valueEl: $("pressure-value"),
  });

  mountPositionChart({
    canvasEl: $("chart-position"),
    emptyEl: $("chart-position-empty"),
    titleEl: $("position-title"),
    legendEl: $("position-legend"),
    limitInput: $("position-limit"),
    resetZoomBtn: $("position-reset-zoom"),
    modeLineBtn: $("position-mode-line"),
    modeDotBtn: $("position-mode-dot"),
  });

  mountOwnFills({
    bodyEl: $("fills-body"),
    titleEl: $("fills-title"),
    showAllInput: $("fills-all"),
    currentOnlyInput: $("fills-current"),
  });

  mountLogs({
    bodyEl: $("logs-body"),
    tsEl: $("logs-ts"),
    tabsEl: $("panel-logs").querySelector(".tabs"),
  });

  mountMoneynessChart({
    canvasEl: $("chart-moneyness"),
    emptyEl: $("chart-moneyness-empty"),
    titleEl: $("moneyness-title"),
    legendEl: $("moneyness-legend"),
    premiumToggle: $("moneyness-premium"),
    resetZoomBtn: $("moneyness-reset-zoom"),
    paramsEl: $("moneyness-params"),
    modeLineBtn: $("moneyness-mode-line"),
    modeDotBtn: $("moneyness-mode-dot"),
  });

  mountVolSmileChart({
    canvasEl: $("chart-volsmile"),
    emptyEl: $("chart-volsmile-empty"),
    titleEl: $("volsmile-title"),
    legendEl: $("volsmile-legend"),
    resetZoomBtn: $("volsmile-reset-zoom"),
    paramsEl: $("volsmile-params"),
    modeLineBtn: $("volsmile-mode-line"),
    modeDotBtn: $("volsmile-mode-dot"),
  });

  mountMoneynessTimeChart({
    canvasEl: $("chart-moneyness-time"),
    emptyEl: $("chart-moneyness-time-empty"),
    titleEl: $("moneyness-time-title"),
    legendEl: $("moneyness-time-legend"),
    premiumToggle: $("moneyness-time-premium"),
    clampToggle: $("moneyness-time-clamp"),
    resetZoomBtn: $("moneyness-time-reset-zoom"),
    modeLineBtn: $("moneyness-time-mode-line"),
    modeDotBtn: $("moneyness-time-mode-dot"),
  });

  mountIVTimeChart({
    canvasEl: $("chart-iv-time"),
    emptyEl: $("chart-iv-time-empty"),
    titleEl: $("iv-time-title"),
    legendEl: $("iv-time-legend"),
    resetZoomBtn: $("iv-time-reset-zoom"),
    modeLineBtn: $("iv-time-mode-line"),
    modeDotBtn: $("iv-time-mode-dot"),
  });


  mountIVMoneynessScatterChart({
    canvasEl: $("chart-iv-moneyness"),
    emptyEl: $("chart-iv-moneyness-empty"),
    titleEl: $("iv-moneyness-title"),
    legendEl: $("iv-moneyness-legend"),
    premiumToggle: $("iv-moneyness-premium"),
    fitToggle: $("iv-moneyness-fit"),
    resetZoomBtn: $("iv-moneyness-reset-zoom"),
  });

  mountIVMoneynessLogChart({
    canvasEl: $("chart-iv-moneyness-log"),
    emptyEl: $("chart-iv-moneyness-log-empty"),
    titleEl: $("iv-moneyness-log-title"),
    legendEl: $("iv-moneyness-log-legend"),
    premiumToggle: $("iv-moneyness-log-premium"),
    fitToggle: $("iv-moneyness-log-fit"),
    resetZoomBtn: $("iv-moneyness-log-reset-zoom"),
  });

  initPanelCollapse();
  initLayout();

  // Wire up the restore-layout button
  const restoreBtn = document.getElementById("restore-layout");
  if (restoreBtn) restoreBtn.addEventListener("click", restoreDefaultLayout);

  // ── Day tab wiring ────────────────────────────────────────────────────────
  // After CSV load each tab button switches the visible day by setting the
  // matching strategy as the reference.  The active class tracks the store.
  const dayTabsEl = $("day-tabs");
  if (dayTabsEl) {
    dayTabsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".day-tab");
      if (!btn) return;
      const day = parseInt(btn.dataset.day, 10);
      const { strategies } = getState();
      // CSV strategies are named "CSV · Round 3 Day N" — match by day number
      const match = strategies.find((s) =>
        s.filename?.includes(`_day_${day}.csv`)
      );
      if (match) setState({ referenceId: match.id });
    });

    // Keep tab highlight in sync with the store's referenceId
    subscribe((state) => {
      const ref = state.strategies.find((s) => s.id === state.referenceId);
      if (!ref) return;
      dayTabsEl.querySelectorAll(".day-tab").forEach((btn) => {
        const day = btn.dataset.day;
        btn.classList.toggle(
          "active",
          ref.filename?.includes(`_day_${day}.csv`) ?? false
        );
      });
    });
  }

  await hydrate();
  await loadCsvDataSource();
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<pre style="color:#f87171;padding:12px;font-family:monospace">Boot error: ${String(err)}</pre>`
  );
});
