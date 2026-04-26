/**
 * panelLayout.js — drag-to-reorder + resize handles for dashboard panels.
 *
 * Strategy:
 *  - All panels already have unique IDs.
 *  - The grid uses span-based placement; we remove explicit column-start
 *    overrides via inline styles so auto-placement handles order.
 *  - Drag-to-reorder: HTML5 DnD reorders DOM nodes; CSS auto-placement
 *    recalculates the grid instantly.
 *  - Resize: a handle div on the bottom edge drags to change grid-row span.
 *  - Layout is persisted in localStorage (order + row spans + collapsed state).
 *  - "Restore default" re-sorts DOM to original order and clears inline styles.
 */

const LAYOUT_KEY = "op:panel-layout:v7";
const ROW_H = 42; // matches grid-auto-rows in CSS
const MIN_SPAN = 1;
const MAX_COL_SPAN = 12;

let defaultOrder = []; // panel IDs in original document order

/* ─── Span helpers ─── */

function getRowSpan(panel) {
  const inline = panel.style.gridRow;
  if (inline) {
    const m = inline.match(/span\s*(\d+)/i);
    if (m) return parseInt(m[1]);
  }
  const computed = getComputedStyle(panel).gridRow;
  const m = computed.match(/span\s*(\d+)/i);
  return m ? parseInt(m[1]) : 7;
}

function setRowSpan(panel, span) {
  panel.style.gridRow = `span ${Math.max(MIN_SPAN, span)}`;
}

function getColSpan(panel) {
  const inline = panel.style.gridColumn;
  if (inline) {
    const m = inline.match(/span\s*(\d+)/i);
    if (m) return parseInt(m[1]);
  }
  const computed = getComputedStyle(panel).gridColumn;
  const m = computed.match(/span\s*(\d+)/i);
  return m ? parseInt(m[1]) : 6;
}

function setColSpan(panel, span) {
  panel.style.gridColumn = `span ${Math.min(MAX_COL_SPAN, Math.max(MIN_SPAN, span))}`;
}

/* ─── Persistence ─── */

function saveLayout(dashboard) {
  const panels = [...dashboard.querySelectorAll(":scope > .panel")];
  const state = panels.map((p) => ({
    id: p.id,
    rowSpan: getRowSpan(p),
    colSpan: getColSpan(p),
    collapsed: p.classList.contains("collapsed"),
  }));
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(state));
}

function loadLayout(dashboard) {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    const byId = {};
    dashboard.querySelectorAll(":scope > .panel").forEach((p) => (byId[p.id] = p));

    for (const { id, rowSpan, colSpan, collapsed } of state) {
      const panel = byId[id];
      if (!panel) continue;
      if (rowSpan) setRowSpan(panel, rowSpan);
      if (colSpan) setColSpan(panel, colSpan);
      panel.classList.toggle("collapsed", !!collapsed);
      dashboard.appendChild(panel); // re-append in saved order
    }
    return true;
  } catch {
    return false;
  }
}

/* ─── Resize handle ─── */

function addResizeHandle(panel, dashboard) {
  // Bottom handle for row span
  const handleY = document.createElement("div");
  handleY.className = "panel-resize-handle-y";
  handleY.title = "Drag to resize height";
  panel.appendChild(handleY);

  handleY.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startSpan = getRowSpan(panel);

    const onMove = (e) => {
      const delta = Math.round((e.clientY - startY) / ROW_H);
      setRowSpan(panel, startSpan + delta);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      saveLayout(dashboard);
    };

    document.body.style.cursor = "ns-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Right handle for column span
  const handleX = document.createElement("div");
  handleX.className = "panel-resize-handle-x";
  handleX.title = "Drag to resize width";
  panel.appendChild(handleX);

  handleX.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startSpan = getColSpan(panel);
    // Determine the width of one column roughly
    const rect = dashboard.getBoundingClientRect();
    const colW = rect.width / 12;

    const onMove = (e) => {
      const delta = Math.round((e.clientX - startX) / colW);
      setColSpan(panel, startSpan + delta);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      saveLayout(dashboard);
    };

    document.body.style.cursor = "ew-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

/* ─── Drag-to-reorder ─── */

let dragged = null;

function addDragHandle(panel, dashboard) {
  const header = panel.querySelector(".panel-header");
  if (!header) return;

  // Drag grip icon — sits after the collapse button
  const grip = document.createElement("span");
  grip.className = "panel-drag-grip";
  grip.title = "Drag to reorder";
  grip.innerHTML = "&#8942;&#8942;"; // ⋮⋮
  grip.style.cursor = "grab";

  // Insert after the first child (the collapse button)
  const collapseBtn = header.querySelector(".panel-collapse-btn");
  if (collapseBtn) {
    collapseBtn.insertAdjacentElement("afterend", grip);
  } else {
    header.insertBefore(grip, header.firstChild);
  }

  // Make the panel draggable only when the grip is pressed
  grip.addEventListener("mousedown", () => {
    panel.draggable = true;
  });
  document.addEventListener("mouseup", () => {
    panel.draggable = false;
  });

  panel.addEventListener("dragstart", (e) => {
    dragged = panel;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", panel.id);
    // Slight delay so the ghost image renders before we add the class
    requestAnimationFrame(() => panel.classList.add("panel-dragging"));
  });

  panel.addEventListener("dragend", () => {
    panel.draggable = false;
    panel.classList.remove("panel-dragging");
    document.querySelectorAll(".panel-drop-target").forEach((p) =>
      p.classList.remove("panel-drop-target")
    );
    dragged = null;
    saveLayout(dashboard);
  });

  panel.addEventListener("dragover", (e) => {
    if (!dragged || dragged === panel) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    panel.classList.add("panel-drop-target");
  });

  panel.addEventListener("dragleave", (e) => {
    // Only remove if leaving the panel entirely (not a child element)
    if (!panel.contains(e.relatedTarget)) {
      panel.classList.remove("panel-drop-target");
    }
  });

  panel.addEventListener("drop", (e) => {
    if (!dragged || dragged === panel) return;
    e.preventDefault();
    panel.classList.remove("panel-drop-target");

    // Insert before or after target depending on cursor position
    const rect = panel.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      dashboard.insertBefore(dragged, panel);
    } else {
      dashboard.insertBefore(dragged, panel.nextSibling);
    }
    saveLayout(dashboard);
  });
}

/* ─── Public API ─── */

export function initLayout() {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard) return;

  // Record the pristine DOM order
  const panels = [...dashboard.querySelectorAll(":scope > .panel")];
  defaultOrder = panels.map((p) => p.id);

  // Load persisted layout (order + spans + collapsed state)
  loadLayout(dashboard);

  // Add handles to every panel
  panels.forEach((panel) => {
    addResizeHandle(panel, dashboard);
    addDragHandle(panel, dashboard);
  });
}

export function restoreDefaultLayout() {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard) return;

  const byId = {};
  dashboard
    .querySelectorAll(":scope > .panel")
    .forEach((p) => (byId[p.id] = p));

  // Re-append in original order
  for (const id of defaultOrder) {
    const panel = byId[id];
    if (!panel) continue;
    panel.style.gridRow = ""; // remove inline span override
    panel.style.gridColumn = "";
    panel.classList.remove("collapsed");
    dashboard.appendChild(panel);
  }

  localStorage.removeItem(LAYOUT_KEY);
}
