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
const USE_GEOLOCATION = true;
const MERGE_RESULT_IN_HAND = true;
const MEMORYLESS = true;
const VIEW_RADIUS = INTERACT_RANGE + 5;

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

type MovementMode = "buttons" | "geo";

let currentMovementMode: MovementMode = USE_GEOLOCATION ? "geo" : "buttons";

const STORAGE_KEY = "world-of-bits-state";
const STORAGE_VERSION = 3;

// Only store cells that have been modified by the player.
// Unmodified cells derive from baseTokenValue(row, col)
type TokenState = { v: number };

const tokenStore = new Map<CellKey, TokenState>();

// --- Memento support (in-memory only) ---
type Memento = {
  tokens: [CellKey, TokenState][];
  inventory: { value: number } | null;
  playerCell: GridCell;
  movementMode?: MovementMode;
  target?: number;
};

let _lastMemento: Memento | null = null;

function serializeState(): Memento {
  return {
    tokens: Array.from(tokenStore.entries()),
    inventory: inventory ? { value: inventory.value } : null,
    playerCell: { row: playerCell.row, col: playerCell.col },
    movementMode: currentMovementMode,
    target: TARGET,
  };
}

function restoreFromMemento(m: Memento) {
  tokenStore.clear();
  for (const [key, state] of m.tokens) {
    tokenStore.set(key, { v: state.v });
  }
  inventory = m.inventory ? { value: m.inventory.value } : null;
  playerCell = { row: m.playerCell.row, col: m.playerCell.col };
  if (m.movementMode) {
    currentMovementMode = m.movementMode;
  }
}

let saveTimer: number | undefined;

function saveState() {
  try {
    const snapshot = serializeState();
    const payload = {
      version: STORAGE_VERSION,
      snapshot,
    };
    const json = JSON.stringify(payload);

    // Size guard (~200KB)
    if (json.length > 200_000) {
      console.warn("Save skipped: payload too large", json.length);
      return;
    }

    localStorage.setItem(STORAGE_KEY, json);
  } catch (err) {
    console.warn("Failed to save state", err);
  }
}

function scheduleStateSave() {
  if (saveTimer !== undefined) return;
  saveTimer = globalThis.setTimeout(() => {
    saveTimer = undefined;
    saveState();
  }, 250);
}

function loadState(): Memento | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const payload = JSON.parse(raw);
    if (!payload || payload.version !== STORAGE_VERSION || !payload.snapshot) {
      return null;
    }

    const snapshot = payload.snapshot as Memento;

    if (!Array.isArray(snapshot.tokens) || !snapshot.playerCell) {
      return null;
    }

    return snapshot;
  } catch (err) {
    console.warn("Failed to load state, ignoring", err);
    return null;
  }
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

let playerCell = latLngToCell(CLASSROOM.lat, CLASSROOM.lng);
function inRange(row: number, col: number): boolean {
  const dr = Math.abs(row - playerCell.row);
  const dc = Math.abs(col - playerCell.col);
  return Math.max(dr, dc) <= INTERACT_RANGE;
}

// Helper: center of a grid cell (lat/lng)
function cellCenterLatLng(row: number, col: number): L.LatLng {
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
  // In-memory only + schedule a debounced write to localStorage
  _lastMemento = serializeState();
  scheduleStateSave();
}

function loadMemento() {
  const loaded = loadState();
  if (!loaded) return;
  _lastMemento = loaded;
  restoreFromMemento(loaded);
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
    // center on player
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
  setCell(cell: GridCell) {
    this.currentCell = { row: cell.row, col: cell.col };
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
    this.badge.textContent =
      `Player: simulated @ cell (${this.currentCell.row}, ${this.currentCell.col})`;

    // Notify game logic of the initial pos
    this.inPosition?.(centerLL.lat, centerLL.lng);
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

  constructor(player: PlayerLayer, badge: HTMLElement) {
    this.player = player;
    this.badge = badge;
  }

  onPosition(callback: (lat: number, lng: number) => void): void {
    this.onPositionCallback = callback;
  }

  start(): void {
    if (!("geolocation" in navigator)) {
      this.badge.textContent =
        "Geolocation unavailable — using classroom location";
      const ll: [number, number] = [CLASSROOM.lat, CLASSROOM.lng];
      this.player.showFixed(ll);
      this.onPositionCallback?.(CLASSROOM.lat, CLASSROOM.lng);
      return;
    }

    this.badge.textContent = "Player: geolocation (awaiting fix…)";

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        // Visually: use the *real* geolocation
        this.player.showGeo(pos);

        // Game logic: use real-world lat/lng; the grid math happens in latLngToCell
        this.onPositionCallback?.(lat, lng);

        this.badge.textContent = "Player: geolocation (tracking)";
      },
      (err) => {
        console.warn("Geolocation error:", err);
        this.badge.textContent = "Geolocation error — using classroom location";
        const ll: [number, number] = [CLASSROOM.lat, CLASSROOM.lng];
        this.player.showFixed(ll);
        this.onPositionCallback?.(CLASSROOM.lat, CLASSROOM.lng);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      },
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
    // Use the leaflet viewport bounds instead of a tiny radius around the player
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    // Convert the corners of the viewport to grid cells
    const swCell = latLngToCell(sw.lat, sw.lng);
    const neCell = latLngToCell(ne.lat, ne.lng);

    // Expand by a 1-cell margin so we don't thrash at the edges
    return {
      minRow: (swCell.row + VIEW_RADIUS),
      maxRow: (neCell.row - VIEW_RADIUS),
      minCol: (swCell.col + VIEW_RADIUS + 17),
      maxCol: (neCell.col - VIEW_RADIUS - 17),
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
    redrawTimer = globalThis.setTimeout(() => {
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

  // Shared callback: how the *game* responds to movement updates
  const handleMovementPosition = (lat: number, lng: number) => {
    // Update logical grid position from lat/lng
    const cc = latLngToCell(lat, lng);
    playerCell = cc;

    // Resync rendered grid to the new playerCell
    syncGridToPlayerWindow();
    refreshVisibleCells();
    checkWin();
  };

  // Create both controllers up front
  const initialCell: GridCell = { row: playerCell.row, col: playerCell.col };

  const buttonMovement = new ButtonMovementController(
    map,
    player,
    badge,
    initialCell,
  );
  buttonMovement.onPosition(handleMovementPosition);

  // Active controller pointer
  const geoMovement = new GeolocationMovementController(player, badge);
  geoMovement.onPosition(handleMovementPosition);

  let activeMovement: MovementController = currentMovementMode === "geo"
    ? geoMovement
    : buttonMovement;

  // D-pad control handle (created later)
  let moveCtl: L.Control | null = null;

  function useMovement(next: MovementController) {
    if (activeMovement === next) return;

    if (next === buttonMovement) {
      buttonMovement.setCell(playerCell);
    }
    activeMovement.stop();
    activeMovement = next;
    currentMovementMode = next === geoMovement ? "geo" : "buttons";

    // Toggle D-pad visibility
    if (moveCtl) {
      if (activeMovement === buttonMovement) {
        map.addControl(moveCtl);
      } else {
        map.removeControl(moveCtl);
      }
    }

    activeMovement.start();
    saveMemento();
  }

  // Kick off whichever is active on load
  activeMovement.start();

  // D-pad control (for button-based movement)
  if (buttonMovement.stepBy) {
    const MoveControl = L.Control.extend({
      onAdd: function () {
        const div = L.DomUtil.create("div", "leaflet-bar");
        div.style.background = "#fff";
        div.style.padding = "6px";
        div.style.borderRadius = "8px";
        div.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
        div.style.userSelect = "none";

        const makeBtn = (label: string, di: number, dj: number) => {
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
            buttonMovement.stepBy?.(di, dj);
          });
          return b;
        };

        div.appendChild(makeBtn("N", 0, 1));
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "4px";
        row.style.justifyContent = "center";
        row.appendChild(makeBtn("W", -1, 0));
        row.appendChild(makeBtn("S", 0, -1));
        row.appendChild(makeBtn("E", 1, 0));
        div.appendChild(row);

        L.DomEvent.disableClickPropagation(div);
        return div;
      },
      onRemove: function () {},
    });

    // deno-lint-ignore no-explicit-any
    moveCtl = new (MoveControl as any)({ position: "bottomright" });

    // Only show D-pad when we’re in button mode
    if (activeMovement === buttonMovement && moveCtl) {
      map.addControl(moveCtl);
    }
  }

  // Mode toggle control: hot-swap between Button + Geo controllers
  const ModeToggleControl = L.Control.extend({
    onAdd: function () {
      const div = L.DomUtil.create("div", "leaflet-bar");
      div.style.background = "#fff";
      div.style.padding = "4px";
      div.style.borderRadius = "8px";
      div.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
      div.style.userSelect = "none";

      const btn = document.createElement("button");
      btn.type = "button";
      Object.assign(btn.style, {
        display: "block",
        padding: "4px 8px",
        border: "1px solid #ccc",
        borderRadius: "6px",
        background: "#f7f7f7",
        cursor: "pointer",
        font: "11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        whiteSpace: "nowrap",
      } as CSSStyleDeclaration);

      const updateLabel = () => {
        btn.textContent = activeMovement === buttonMovement
          ? "Mode: Buttons"
          : "Mode: Geolocation";
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        // Toggle between controllers
        if (activeMovement === buttonMovement) {
          useMovement(geoMovement);
        } else {
          useMovement(buttonMovement);
        }
        updateLabel();
      });

      updateLabel();
      div.appendChild(btn);

      L.DomEvent.disableClickPropagation(div);
      return div;
    },
    onRemove: function () {},
  });

  // deno-lint-ignore no-explicit-any
  const modeCtl = new (ModeToggleControl as any)({ position: "bottomleft" });
  map.addControl(modeCtl);
  // New Game control: confirm → clear saved state → reload
  const NewGameControl = L.Control.extend({
    onAdd: function () {
      const div = L.DomUtil.create("div", "leaflet-bar");
      div.style.background = "#fff";
      div.style.padding = "4px";
      div.style.borderRadius = "8px";
      div.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
      div.style.userSelect = "none";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "New Game";
      Object.assign(btn.style, {
        display: "block",
        padding: "4px 8px",
        border: "1px solid #ccc",
        borderRadius: "6px",
        background: "#fbe9e7",
        cursor: "pointer",
        font: "11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        whiteSpace: "nowrap",
      } as CSSStyleDeclaration);

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const ok = globalThis.confirm(
          "Start a new game? This will clear your saved progress.",
        );
        if (!ok) return;

        try {
          // Clear persisted state
          localStorage.removeItem(STORAGE_KEY);

          // Clear in-memory state
          tokenStore.clear();
          inventory = null;
          _lastMemento = null;
          playerCell = latLngToCell(CLASSROOM.lat, CLASSROOM.lng);
        } finally {
          // Full re-init: reload the page
          globalThis.location.reload();
        }
      });

      div.appendChild(btn);
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
    onRemove: function () {},
  });

  // deno-lint-ignore no-explicit-any
  const newGameCtl = new (NewGameControl as any)({ position: "bottomleft" });
  map.addControl(newGameCtl);
}

// Kick off AFTER everything is defined
initMap();
