// ----- src/main.ts -----
// Author: Bryce Han
// CMPM 121, Fall 2025
// D3: World of bits

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import luck from "./_luck.ts";

// =======================
// Config & constants
// =======================
const CLASSROOM = {
  lat: 36.99785920944698,
  lng: -122.05683743811225,
  zoom: 18.75,
};

const CELL_DEG = 0.000125; // ~13.9m at this latitude
const INTERACT_RANGE = 3; // cells (Chebyshev distance)
const TARGET = 16; // win threshold
const USE_GEOLOCATION = false;
const MERGE_RESULT_IN_HAND = true;
const RENDER_RADIUS = INTERACT_RANGE + 6;
const MEMORYLESS = true;

// =======================
// Grid helpers
// =======================
function latLngToCell(lat: number, lng: number): { row: number; col: number } {
  const dLat = lat - CLASSROOM.lat;
  const dLng = lng - CLASSROOM.lng;
  const row = Math.floor(dLat / CELL_DEG);
  const col = Math.floor(dLng / CELL_DEG);
  return { row, col };
}

function cellBounds(row: number, col: number): L.LatLngBounds {
  const south = CLASSROOM.lat + row * CELL_DEG;
  const north = CLASSROOM.lat + (row + 1) * CELL_DEG;
  const west = CLASSROOM.lng + col * CELL_DEG;
  const east = CLASSROOM.lng + (col + 1) * CELL_DEG;
  return L.latLngBounds([south, west], [north, east]);
}

let playerCell = latLngToCell(CLASSROOM.lat, CLASSROOM.lng); // NEW
function inRange(row: number, col: number): boolean {
  const dr = Math.abs(row - playerCell.row);
  const dc = Math.abs(col - playerCell.col);
  return Math.max(dr, dc) <= INTERACT_RANGE;
}

// Helper: center of a grid cell (lat/lng)
function cellCenterLatLng(row: number, col: number): L.LatLng { // NEW
  return cellBounds(row, col).getCenter();
}

// Canvas renderer for all grid rectangles
const canvasRenderer = L.canvas();

// Here is a pool of visible cells
type CellKey = string; // "row:col"
const visibleCells = new Map<CellKey, CellView>();

function keyOf(row: number, col: number): CellKey {
  return `${row}:${col}`;
}

// forward declaration for handler (will be assigned inside initMap)
let handleCellClick: (row: number, col: number) => void = () => {};

// Class for cell views
class CellView {
  private map: L.Map;
  rect: L.Rectangle;
  label: L.Marker | null = null;
  row: number;
  col: number;
  value: number = 0;
  inRange: boolean = false;

  constructor(
    row: number,
    col: number,
    pane: string,
    layerGroup: L.LayerGroup,
    map: L.Map,
  ) {
    this.row = row;
    this.col = col;
    this.rect = L.rectangle(cellBounds(row, col), {
      pane,
      renderer: canvasRenderer,
      weight: 1,
      interactive: true,
    });
    this.rect.addTo(layerGroup);
    this.map = map;
    // Handle clicks
    this.rect.on("click", () => {
      handleCellClick(this.row, this.col);
    });
  }
  setValue(value: number, rangeOK: boolean, layerGroup: L.LayerGroup) {
    this.value = value;
    this.inRange = rangeOK;

    const color = value === 0
      ? "#000000"
      : value === 2
      ? "#4caf50"
      : value === 4
      ? "#2196f3"
      : value === 8
      ? "#9c27b0"
      : value === 16
      ? "#ff9800"
      : "#f44336";

    this.rect.setStyle({
      color: color,
      opacity: rangeOK ? 0.9 : 0.25,
      fillOpacity: value > 0 ? (rangeOK ? 0.18 : 0.08) : 0.04,
    });

    // Label(DivIcon) - create only for >0 values else remove if present
    const bounds = cellBounds(this.row, this.col);
    const center = this.pixelCenterOfBounds(bounds);

    if (value > 0) {
      if (!this.label) {
        this.label = L.marker(center, {
          interactive: false,
          pane: this.rect.options.pane,
          icon: L.divIcon({
            className: "cell-label",
            html: `<span class="cell-label-inner">${value}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        }).addTo(layerGroup);
      } else {
        this.label.setLatLng(center);
        const el = this.label.getElement() as HTMLElement | null;
        if (el) {
          (el.querySelector(".cell-label-inner") as HTMLElement).textContent =
            String(value);
        }
      }
      const el = this.label.getElement() as HTMLElement | null;
      if (el) el.style.opacity = rangeOK ? "1" : "0.5";
    } else {
      if (this.label) {
        layerGroup.removeLayer(this.label);
        this.label = null;
      }
    }
  }

  private pixelCenterOfBounds(b: L.LatLngBounds): L.LatLng {
    const sw = this.map.project(b.getSouthWest());
    const ne = this.map.project(b.getNorthEast());
    const cx = (sw.x + ne.x) / 2;
    const cy = (sw.y + ne.y) / 2;
    return this.map.unproject(L.point(cx, cy));
  }

  updateBounds() {
    const bounds = cellBounds(this.row, this.col);
    this.rect.setBounds(bounds);
    if (this.label) {
      this.label.setLatLng(this.pixelCenterOfBounds(bounds));
    }
  }

  destroy(layerGroup: L.LayerGroup) {
    layerGroup.removeLayer(this.rect);
    if (this.label) {
      layerGroup.removeLayer(this.label);
    }
  }
}

// =======================
// Deterministic token spawn + overrides
// =======================
function baseTokenValue(row: number, col: number): number {
  const r = luck(`cell:${row}:${col}:seed1`);
  if (r < 0.14) return 2;
  if (r < 0.20) return 4;
  if (r < 0.22) return 8;
  return 0;
}

const overrides = new Map<string, number>(); // "row:col" -> value
const k = (row: number, col: number) => `${row}:${col}`;

function getEffectiveValue(row: number, col: number): number {
  return overrides.has(k(row, col))
    ? (overrides.get(k(row, col)) as number)
    : baseTokenValue(row, col);
}

function setEffectiveValue(row: number, col: number, value: number) {
  overrides.set(k(row, col), value);
  saveMemento();
}

// =======================
// Inventory + HUD + Memento  (DECLARED BEFORE initMap)
// =======================
let inventory: { value: number } | null = null;

function ensureInventoryHUD(): HTMLElement {
  let el = document.getElementById("inv-hud") as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "inv-hud";
    Object.assign(el.style, {
      position: "absolute",
      top: "8px",
      right: "8px",
      background: "rgba(0,0,0,0.6)",
      color: "#fff",
      font: "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      padding: "6px 8px",
      borderRadius: "8px",
      zIndex: "9999",
    } as CSSStyleDeclaration);
    document.body.appendChild(el);
  }
  return el;
}

function updateInventoryHUD() {
  const hud = ensureInventoryHUD();
  hud.textContent = inventory
    ? `Held token: ${inventory.value}`
    : "Held token: (none)";
}

function checkWin() {
  if (inventory && inventory.value >= TARGET) {
    alert(`🎉 You crafted a token of value ${inventory.value}!`);
  }
}

function saveMemento() {
  /* Maybe enable later?
  const data = {
    overrides: Array.from(overrides.entries()),
    inventory,
  };
  localStorage.setItem("d3_state", JSON.stringify(data));
  */
}

function loadMemento() {
  /* Maybe enable later? */
  /*
  const raw = localStorage.getItem("d3_state");
  if (!raw) return;
  try {
    const data = JSON.parse(raw) as {
      overrides: [string, number][];
      inventory: { value: number } | null;
    };
    overrides.clear();
    for (const [kk, v] of data.overrides) overrides.set(kk, v);
    inventory = data.inventory;
  } catch {
    // ignore corrupt state
  }
  */
}

// =======================
// Map container & Leaflet assets
// =======================
function ensureMapContainer(): HTMLElement {
  const existing = document.getElementById("map");
  if (existing) return existing;
  const el = document.createElement("div");
  el.id = "map";
  Object.assign(el.style, { width: "100vw", height: "100vh" });
  document.body.style.margin = "0";
  document.body.appendChild(el);
  return el;
}

// Fix default marker icon URLs for Vite
import marker2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
// deno-lint-ignore no-explicit-any
(L.Icon.Default.prototype as any)._getIconUrl = function () {};
L.Icon.Default.mergeOptions({
  iconRetinaUrl: marker2xUrl,
  iconUrl: markerUrl,
  shadowUrl: shadowUrl,
});

// =======================
// Styling (player + cell labels)
// =======================
function installPlayerStyles() {
  if (document.getElementById("player-dot-style")) return;
  const style = document.createElement("style");
  style.id = "player-dot-style";
  style.textContent = `
    html, body { overflow: hidden; }
    .player-dot {
      width: 16px; height: 16px; border-radius: 50%;
      background: rgba(0, 122, 255, 1);
      box-shadow: 0 0 0 2px white inset, 0 0 6px rgba(0,0,0,0.35);
      transform: translate(-8px, -8px); position: relative;
    }
    .player-dot::after {
      content: ""; position: absolute; left: 50%; top: 50%;
      width: 16px; height: 16px; border-radius: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 122, 255, 0.35);
      animation: pulse 1.8s ease-out infinite;
    }
    @keyframes pulse {
      0% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
      70% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
      100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
    }
    .player-badge {
      position: absolute; top: 8px; left: 8px;
      background: rgba(0,0,0,0.6); color: #fff;
      font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      padding: 6px 8px; border-radius: 8px; z-index: 9999;
    }
    .cell-label {
      background: transparent; border: none; box-shadow: none;
      color: #111; font: 11px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      text-shadow: 0 0 2px rgba(255,255,255,0.9);
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

// =======================
// Player layer
// =======================
class PlayerLayer {
  private map: L.Map;
  private marker: L.Marker | null = null;
  private accuracy: L.Circle | null = null;
  private firstFix = true;

  constructor(map: L.Map) {
    this.map = map;
  }

  showFixed(pos: L.LatLngExpression) {
    const icon = L.divIcon({ className: "player-dot", iconSize: [16, 16] });
    if (!this.marker) {
      this.marker = L.marker(pos, { icon }).addTo(this.map).bindPopup("Player");
    } else {
      this.marker.setLatLng(pos);
    }
    if (this.accuracy) {
      this.map.removeLayer(this.accuracy);
      this.accuracy = null;
    }
    if (this.firstFix) {
      this.map.setView(pos, CLASSROOM.zoom);
      this.firstFix = false;
    }
  }

  showGeo(pos: GeolocationPosition) {
    const ll: L.LatLngExpression = [pos.coords.latitude, pos.coords.longitude];
    const acc = pos.coords.accuracy ?? 0;
    const icon = L.divIcon({ className: "player-dot", iconSize: [16, 16] });
    if (!this.marker) {
      this.marker = L.marker(ll, { icon }).addTo(this.map).bindPopup(
        "You are here",
      );
    } else {
      this.marker.setLatLng(ll);
    }
    if (!this.accuracy) {
      this.accuracy = L.circle(ll, {
        radius: Math.max(5, acc),
        fillOpacity: 0.1,
        opacity: 0.4,
      }).addTo(this.map);
    } else {
      this.accuracy.setLatLng(ll);
      this.accuracy.setRadius(Math.max(5, acc));
    }
    if (this.firstFix) {
      this.map.setView(ll, CLASSROOM.zoom);
      this.firstFix = false;
    }
  }
}

function ensureHudBadge(): HTMLElement {
  let el = document.querySelector(".player-badge") as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "player-badge";
    document.body.appendChild(el);
  }
  return el;
}

// =======================
// Init map (now that all deps exist)
// =======================
function initMap() {
  installPlayerStyles();
  const container = ensureMapContainer();

  const map = L.map(container, {
    zoomControl: false,
    attributionControl: true,
    zoom: CLASSROOM.zoom,
    minZoom: CLASSROOM.zoom,
    maxZoom: CLASSROOM.zoom,
  }).setView([CLASSROOM.lat, CLASSROOM.lng], CLASSROOM.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // Load persisted state + HUD
  loadMemento();
  updateInventoryHUD();

  // --- GRID pane & layer ---
  const GRID_PANE = "grid-pane";
  const gridPaneEl = map.createPane(GRID_PANE);
  gridPaneEl.style.zIndex = "400"; // tiles ~200, markers ~600

  const gridLayer = L.layerGroup([], { pane: GRID_PANE }).addTo(map);

  // Track which cells are visible
  function playerVisibleCellRange(): {
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
  } {
    return {
      minRow: playerCell.row - RENDER_RADIUS / 4,
      maxRow: playerCell.row + RENDER_RADIUS / 4,
      minCol: playerCell.col - RENDER_RADIUS / 4,
      maxCol: playerCell.col + RENDER_RADIUS / 4,
    };
  }
  // Create/update only what’s in the player window; remove cells that left it
  function syncGridToPlayerWindow() {
    const { minRow, maxRow, minCol, maxCol } = playerVisibleCellRange();

    // mark existing as stale initially
    const stale = new Set(visibleCells.keys());

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const kk = keyOf(row, col);
        stale.delete(kk);

        let cv = visibleCells.get(kk);
        if (!cv) {
          cv = new CellView(row, col, GRID_PANE, gridLayer, map);
          visibleCells.set(kk, cv);
        } else {
          cv.updateBounds(); // projection jitter safety
        }

        const val = getEffectiveValue(row, col);
        const rangeOK = inRange(row, col);
        cv.setValue(val, rangeOK, gridLayer);
      }
    }

    // remove any cells that are now outside the player window
    for (const kk of stale) {
      const cv = visibleCells.get(kk)!;
      cv.destroy(gridLayer);
      visibleCells.delete(kk);

      // MEMORYLESS: drop any overrides so this cell resets next time we see it
      if (MEMORYLESS) {
        const [rStr, cStr] = kk.split(":");
        const r = parseInt(rStr, 10), c = parseInt(cStr, 10);
        overrides.delete(k(r, c));
      }
    }
  }

  // initial draw + light throttling on move/zoom
  syncGridToPlayerWindow();

  function refreshVisibleCells() { // NEW
    for (const [kk, cv] of visibleCells) {
      const [rStr, cStr] = kk.split(":");
      const r = parseInt(rStr, 10);
      const c = parseInt(cStr, 10);
      const val = getEffectiveValue(r, c);
      cv.setValue(val, inRange(r, c), gridLayer);
    }
  }

  let redrawTimer: number | undefined;
  function scheduleSync() {
    if (redrawTimer) return;
    redrawTimer = self.setTimeout(() => {
      redrawTimer = undefined;
      syncGridToPlayerWindow();
    }, 16); // ~1 frame
  }
  map.on("move", scheduleSync);
  map.on("moveend", syncGridToPlayerWindow);

  function updateCell(row: number, col: number) {
    const kk = keyOf(row, col);
    const cv = visibleCells.get(kk);
    if (!cv) return;
    const val = getEffectiveValue(row, col);
    cv.setValue(val, inRange(row, col), gridLayer);
  }

  // cell click handler (separate from updateCell so scope stays correct)
  handleCellClick = (row: number, col: number) => {
    if (!inRange(row, col)) return;

    const cellVal = getEffectiveValue(row, col);

    // A) Pick up
    if (!inventory) {
      if (cellVal > 0) {
        inventory = { value: cellVal };
        setEffectiveValue(row, col, 0);
        updateInventoryHUD();
        saveMemento();
        updateCell(row, col);
        checkWin();
      }
      return;
    }

    // B) Merge equal
    const held = inventory.value;
    if (cellVal === held && held > 0) {
      const newVal = held * 2;

      if (MERGE_RESULT_IN_HAND) {
        setEffectiveValue(row, col, 0);
        inventory = { value: newVal };
      } else {
        setEffectiveValue(row, col, newVal);
        inventory = null;
      }

      updateInventoryHUD();
      saveMemento();
      updateCell(row, col); // <— only this cell changes visually
      checkWin();
      return;
    }

    // place into empty cells
    if (cellVal === 0) {
      setEffectiveValue(row, col, held);
      inventory = null;
      updateInventoryHUD();
      saveMemento();
      updateCell(row, col);
    }
  };

  // initial draw + redraw on move
  syncGridToPlayerWindow();
  map.on("moveend", syncGridToPlayerWindow);

  // --- PLAYER LAYER / BADGE ---
  const player = new PlayerLayer(map);
  const badge = ensureHudBadge();

  function movePlayer(dx: number, dy: number) {
    // Only used in simulation mode; works either way but makes most sense when USE_GEOLOCATION=false
    playerCell = { row: playerCell.row + dy, col: playerCell.col + dx };

    // Move the player marker to the *center of the new cell*
    const newLL = cellCenterLatLng(playerCell.row, playerCell.col);
    player.showFixed(newLL);

    // Keep camera on player (optional)
    map.panTo(newLL, { animate: true });

    // Update badge
    const cellTxt = `(${playerCell.row}, ${playerCell.col})`;
    badge.textContent = `Player: simulated @ cell ${cellTxt}`;

    syncGridToPlayerWindow();

    // Redraw grid styling for in-range state
    refreshVisibleCells();
  }

  if (!USE_GEOLOCATION) {
    badge.textContent =
      `Player: simulated @ cell (${playerCell.row}, ${playerCell.col})`;
    player.showFixed([CLASSROOM.lat, CLASSROOM.lng]);
  } else if (!("geolocation" in navigator)) {
    badge.textContent = "Geolocation unavailable — using classroom location";
    player.showFixed([CLASSROOM.lat, CLASSROOM.lng]);
  } else {
    badge.textContent = "Player: geolocation (awaiting fix…)";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        badge.textContent = "Player: geolocation (fixed)";
        player.showGeo(pos);
      },
      () => {
        badge.textContent = "Geolocation denied — using classroom location";
        player.showFixed([CLASSROOM.lat, CLASSROOM.lng]);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  badge.textContent = "Player: geolocation (awaiting fix…)";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      badge.textContent = "Player: geolocation (fixed)";
      player.showGeo(pos);
    },
    () => {
      badge.textContent = "Geolocation denied — using classroom location";
      player.showFixed([CLASSROOM.lat, CLASSROOM.lng]);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
  );

  navigator.geolocation.watchPosition(
    (pos) => {
      badge.textContent = "Player: geolocation (tracking)";
      player.showGeo(pos);
    },
    undefined,
    { enableHighAccuracy: true, maximumAge: 2000 },
  );

  checkWin();

  // D-pad control (Leaflet Control) — NEW
  const MoveControl = L.Control.extend({
    onAdd: function () {
      const div = L.DomUtil.create("div", "leaflet-bar");
      div.style.background = "#fff";
      div.style.padding = "6px";
      div.style.borderRadius = "8px";
      div.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
      div.style.userSelect = "none";

      const makeBtn = (label: string, onClick: () => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        Object.assign(b.style, {
          display: "block",
          width: "36px",
          height: "28px",
          margin: "2px auto",
          border: "1px solid #ccc",
          borderRadius: "6px",
          background: "#f7f7f7",
          cursor: "pointer",
        } as CSSStyleDeclaration);
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener("click", (e) => {
          e.preventDefault();
          onClick();
        });
        return b;
      };

      // Layout:
      //   [ N ]
      // [ W ][ S ][ E ]  (S in the middle row for compactness)
      div.appendChild(makeBtn("N", () => movePlayer(0, 1)));
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "4px";
      row.style.justifyContent = "center";
      row.appendChild(makeBtn("W", () => movePlayer(-1, 0)));
      row.appendChild(makeBtn("S", () => movePlayer(0, -1)));
      row.appendChild(makeBtn("E", () => movePlayer(1, 0)));
      div.appendChild(row);

      // Disable map drag when pressing on control
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
    onRemove: function () {},
  });

  // deno-lint-ignore no-explicit-any
  const moveCtl = new (MoveControl as any)({ position: "bottomright" });
  map.addControl(moveCtl);

  syncGridToPlayerWindow();
  return map;
}

// Kick off AFTER everything is defined
initMap();
