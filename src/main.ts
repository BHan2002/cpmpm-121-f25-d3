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
const TARGET = 64; // win threshold
const USE_GEOLOCATION = false;
const MERGE_RESULT_IN_HAND = true;
const RENDER_RADIUS = INTERACT_RANGE + 6;
const MEMORYLESS = true;

// --- Cell identity & keys ---
type GridCell = { row: number; col: number };
type CellKey = string; // "row:col"

function cellKeyFromRC(row: number, col: number): CellKey {
  return `${row}:${col}`;
}

// New interface for Movement Controller
interface MovementController {
  start(): void;
  stop(): void;
  onPosition(callback: (lat: number, lng: number) => void): void;
  stepBy?: (dx: number, dy: number) => void;
}

// Only store cells that have been modified by the player.
// Unmodified cells derive from baseTokenValue(row, col)
type TokenState = { v: number };

const tokenStore = new Map<CellKey, TokenState>();

// --- Memento support (in-memory only) ---
type Memento = {
  tokens: [CellKey, TokenState][];
  inventory: { value: number } | null;
  playerCell: GridCell;
};

let lastMemento: Memento | null = null;

function serializeState(): Memento {
  return {
    tokens: Array.from(tokenStore.entries()),
    inventory: inventory ? { value: inventory.value } : null,
    playerCell: { row: playerCell.row, col: playerCell.col },
  };
}

function restoreFromMemento(m: Memento) {
  tokenStore.clear();
  for (const [key, state] of m.tokens) {
    tokenStore.set(key, { v: state.v });
  }
  inventory = m.inventory ? { value: m.inventory.value } : null;
  playerCell = { row: m.playerCell.row, col: m.playerCell.col };
}

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

const visibleCells = new Map<CellKey, CellView>();

function keyOf(row: number, col: number): CellKey {
  return cellKeyFromRC(row, col);
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

  constructor(
    row: number,
    col: number,
    pane: string,
    layerGroup: L.LayerGroup,
    map: L.Map,
  ) {
    this.row = row;
    this.col = col;
    this.map = map;

    this.rect = L.rectangle(cellBounds(row, col), {
      pane,
      renderer: canvasRenderer,
      weight: 1,
      interactive: true,
    });
    this.rect.addTo(layerGroup);

    this.rect.on("click", () => handleCellClick(this.row, this.col));
  }

  // purely visual, no state stored
  setVisual(value: number, rangeOK: boolean, layerGroup: L.LayerGroup) {
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
      : value === 32
      ? "#e91e63"
      : value === 64
      ? "#ffff00"
      : "#000000";

    this.rect.setStyle({
      color,
      opacity: rangeOK ? 0.9 : 0.25,
      fillOpacity: value > 0 ? (rangeOK ? 0.18 : 0.08) : 0.04,
    });

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

function getEffectiveValue(row: number, col: number): number {
  const key = cellKeyFromRC(row, col);
  const s = tokenStore.get(key);
  return s ? s.v : baseTokenValue(row, col);
}

function setEffectiveValue(row: number, col: number, value: number) {
  const key = cellKeyFromRC(row, col);
  const base = baseTokenValue(row, col);

  // Only store if the cell has diverged from base. If it matches base, drop it.
  if (value === base) {
    tokenStore.delete(key);
  } else {
    tokenStore.set(key, { v: value });
  }
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
  // In-memory only: remember the last snapshot
  lastMemento = serializeState();
}

function loadMemento() {
  if (!lastMemento) return;
  restoreFromMemento(lastMemento);
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

// New Class for Button Movement Controller
class ButtonMovementController implements MovementController {
  private map: L.Map;
  private player: PlayerLayer;
  private badge: HTMLElement;
  private currentCell: GridCell;
  private inPosition: ((lat: number, lng: number) => void) | null = null;

  constructor(
    map: L.Map,
    player: PlayerLayer,
    badge: HTMLElement,
    initialCell: GridCell,
  ) {
    this.map = map;
    this.player = player;
    this.badge = badge;
    this.currentCell = initialCell;
  }

  onPosition(callback: (lat: number, lng: number) => void): void {
    this.inPosition = callback;
  }
  start(): void {
    // Draw player at initial cell
    const centerLL = cellCenterLatLng(
      this.currentCell.row,
      this.currentCell.col,
    );
    this.player.showFixed(centerLL);
  }
  stop(): void {
    // No-op for button controller
  }
  stepBy(dx: number, dy: number): void {
    this.currentCell = {
      row: this.currentCell.row + dy,
      col: this.currentCell.col + dx,
    };

    // Update visuals and notify position callback after moving
    const centerLL = cellCenterLatLng(
      this.currentCell.row,
      this.currentCell.col,
    );
    this.player.showFixed(centerLL);
    this.map.panTo(centerLL, { animate: true });
    this.badge.textContent =
      `Player: simulated @ cell (${this.currentCell.row}, ${this.currentCell.col})`;
    this.inPosition?.(centerLL.lat, centerLL.lng);
  }
}

// Class for Geolocation Movement Controller
class GeolocationMovementController implements MovementController {
  private player: PlayerLayer;
  private badge: HTMLElement;
  private onPositionCallback: ((lat: number, lng: number) => void) | null =
    null;
  private watchId: number | null = null;
  private started: boolean = false;

  constructor(player: PlayerLayer, badge: HTMLElement) {
    this.player = player;
    this.badge = badge;
  }
  onPosition(callback: (lat: number, lng: number) => void): void {
    this.onPositionCallback = callback;
  }
  start(): void {
    if (!("geolocation" in navigator)) {
      // Hard fallback to classroom location
      this.badge.textContent =
        "Geolocation unavailable — using classroom location";
      this.player.showFixed([CLASSROOM.lat, CLASSROOM.lng]);
      this.onPositionCallback?.(CLASSROOM.lat, CLASSROOM.lng);
      return;
    }
    this.badge.textContent = "Player: geolocation (awaiting fix…)";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.badge.textContent = "Player: geolocation";
        this.player.showFixed([pos.coords.latitude, pos.coords.longitude]);
        this.onPositionCallback?.(pos.coords.latitude, pos.coords.longitude);
      },
      (_err) => {
        this.badge.textContent = "Geolocation error — using classroom location";
        this.player.showFixed([CLASSROOM.lat, CLASSROOM.lng]);
        this.onPositionCallback?.(CLASSROOM.lat, CLASSROOM.lng);
      },
    );
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.badge.textContent = "Player: geolocation (tracking)";
        this.player.showGeo(pos);
        this.onPositionCallback?.(pos.coords.latitude, pos.coords.longitude);
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
  }
  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
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

  function syncGridToPlayerWindow() {
    saveMemento();

    const { minRow, maxRow, minCol, maxCol } = playerVisibleCellRange();

    const stale = new Set(visibleCells.keys());

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const kk = cellKeyFromRC(row, col);
        stale.delete(kk);

        let cv = visibleCells.get(kk);
        if (!cv) {
          cv = new CellView(row, col, GRID_PANE, gridLayer, map);
          visibleCells.set(kk, cv);
        } else {
          cv.updateBounds();
        }

        const val = getEffectiveValue(row, col);
        const rangeOK = inRange(row, col);
        cv.setVisual(val, rangeOK, gridLayer);
      }
    }

    // destroy off-screen views and (optionally) forget their state
    for (const kk of stale) {
      const cv = visibleCells.get(kk)!;
      cv.destroy(gridLayer);
      visibleCells.delete(kk);

      if (MEMORYLESS) {
        tokenStore.delete(kk);
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
      cv.setVisual(val, inRange(r, c), gridLayer);
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
    cv.setVisual(val, inRange(row, col), gridLayer);
  }

  // cell click handler (separate from updateCell so scope stays correct)
  handleCellClick = (row: number, col: number) => {
    if (!inRange(row, col)) return;

    const cellVal = getEffectiveValue(row, col);

    // A) Pick up
    if (!inventory) {
      if (cellVal > 0) {
        inventory = { value: cellVal };

        // write-through: model
        setEffectiveValue(row, col, 0);

        // HUD + view
        updateInventoryHUD();
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
        // clear cell, put new value in hand
        setEffectiveValue(row, col, 0);
        inventory = { value: newVal };
      } else {
        // write merged value into the cell, clear hand
        setEffectiveValue(row, col, newVal);
        inventory = null;
      }

      updateInventoryHUD();
      updateCell(row, col);
      checkWin();
      return;
    }

    // C) Place into empty cell
    if (cellVal === 0) {
      setEffectiveValue(row, col, held);
      inventory = null;
      updateInventoryHUD();
      updateCell(row, col);
    }
  };

  // initial draw + redraw on move
  syncGridToPlayerWindow();
  map.on("moveend", syncGridToPlayerWindow);

  // --- PLAYER LAYER / BADGE ---
  const player = new PlayerLayer(map);
  const badge = ensureHudBadge();

  let movement: MovementController;

  if (USE_GEOLOCATION) {
    movement = new GeolocationMovementController(player, badge);
  } else {
    // convert your current playerCell { row, col } to GridCell { row, col }
    const initialCell: GridCell = {
      row: playerCell.row,
      col: playerCell.col,
    };
    movement = new ButtonMovementController(map, player, badge, initialCell);
  }

  // Update playerCell when controller reports a new position and refresh the grid
  movement.onPosition((lat: number, lng: number) => {
    playerCell = latLngToCell(lat, lng);

    // Resync rendered grid to the new playerCell
    syncGridToPlayerWindow();
    refreshVisibleCells();
    // Win state doesn’t actually depend on position, but safe to call here
    checkWin();
  });

  if (movement.stepBy) {
    // D-pad control (Leaflet Control)
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
            movement.stepBy?.(
              onClick === north
                ? 0
                : onClick === west
                ? -1
                : onClick === east
                ? 1
                : 0,
              onClick === north ? 1 : onClick === south ? -1 : 0,
            );
          });
          return b;
        };

        const north = () => movement.stepBy?.(0, 1);
        const south = () => movement.stepBy?.(0, -1);
        const west = () => movement.stepBy?.(-1, 0);
        const east = () => movement.stepBy?.(1, 0);

        div.appendChild(makeBtn("N", north));
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "4px";
        row.style.justifyContent = "center";
        row.appendChild(makeBtn("W", west));
        row.appendChild(makeBtn("S", south));
        row.appendChild(makeBtn("E", east));
        div.appendChild(row);

        L.DomEvent.disableClickPropagation(div);
        return div;
      },
      onRemove: function () {},
    });

    // deno-lint-ignore no-explicit-any
    const moveCtl = new (MoveControl as any)({ position: "bottomright" });
    map.addControl(moveCtl);
  }

  movement.start();
}

// Kick off AFTER everything is defined
initMap();
