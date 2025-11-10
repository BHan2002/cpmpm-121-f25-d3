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
  zoom: 17,
};

const CELL_DEG = 0.000125; // ~13.9m at this latitude
const INTERACT_RANGE = 3; // cells (Chebyshev distance)
const TARGET = 16; // win threshold
const USE_GEOLOCATION = false; // optional

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

const originCell = latLngToCell(CLASSROOM.lat, CLASSROOM.lng);
function inRange(row: number, col: number): boolean {
  const dr = Math.abs(row - originCell.row);
  const dc = Math.abs(col - originCell.col);
  return Math.max(dr, dc) <= INTERACT_RANGE;
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
  const data = {
    overrides: Array.from(overrides.entries()),
    inventory,
  };
  localStorage.setItem("d3_state", JSON.stringify(data));
}

function loadMemento() {
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

  // Draw grid covering viewport
  function drawGridCells() {
    gridLayer.clearLayers();

    const mapBounds = map.getBounds();
    const sw = mapBounds.getSouthWest();
    const ne = mapBounds.getNorthEast();

    const { row: minRow, col: minCol } = latLngToCell(sw.lat, sw.lng);
    const { row: maxRow, col: maxCol } = latLngToCell(ne.lat, ne.lng);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const bounds = cellBounds(row, col);
        const val = getEffectiveValue(row, col);
        const rangeOK = inRange(row, col);

        const rect = L.rectangle(bounds, {
          pane: GRID_PANE,
          // color by value (optional; uncomment for colors)
          // color: val === 0 ? "#6c757d" : (val === 2 ? "#4caf50" : val === 4 ? "#2196f3" : val === 8 ? "#9c27b0" : "#ff9800"),
          color: "#3388ff",
          weight: 1,
          opacity: rangeOK ? 0.9 : 0.25,
          fillOpacity: val > 0 ? (rangeOK ? 0.18 : 0.08) : 0.04,
          interactive: true,
        }).addTo(gridLayer);

        // Label (skip zeros to reduce clutter)
        if (val > 0) {
          const center = bounds.getCenter();
          L.tooltip({
            permanent: true,
            direction: "center",
            className: "cell-label",
            opacity: rangeOK ? 0.9 : 0.45,
            offset: [0, 0],
          })
            .setContent(String(val))
            .setLatLng(center)
            .addTo(gridLayer);
        }

        rect.on("click", () => handleCellClick(row, col));
      }
    }
  }

  function handleCellClick(row: number, col: number) {
    if (!inRange(row, col)) return;

    const cellVal = getEffectiveValue(row, col);

    // A) Pick up
    if (!inventory) {
      if (cellVal > 0) {
        inventory = { value: cellVal };
        setEffectiveValue(row, col, 0);
        updateInventoryHUD();
        saveMemento();
        drawGridCells();
      }
      return;
    }

    // B) Merge equal
    const held = inventory.value;
    if (cellVal === held && held > 0) {
      const newVal = held * 2;
      setEffectiveValue(row, col, newVal); // result stays in cell
      inventory = null; // hand empty
      updateInventoryHUD();
      saveMemento();
      drawGridCells();
      if (newVal >= TARGET) {
        alert(`🎉 Crafted ${newVal}! (Win threshold ${TARGET})`);
      }
      return;
    }

    // (Optional) place into empty cells:
    // if (cellVal === 0) {
    //   setEffectiveValue(row, col, held);
    //   inventory = null;
    //   updateInventoryHUD();
    //   saveMemento();
    //   drawGridCells();
    // }
  }

  // initial draw + redraw on move
  drawGridCells();
  map.on("moveend", drawGridCells);

  // --- PLAYER LAYER / BADGE ---
  const player = new PlayerLayer(map);
  const badge = ensureHudBadge();

  if (!USE_GEOLOCATION) {
    badge.textContent = "Player: fixed classroom location";
    player.showFixed([CLASSROOM.lat, CLASSROOM.lng]);
    return map;
  }

  if (!("geolocation" in navigator)) {
    badge.textContent = "Geolocation unavailable — using classroom location";
    player.showFixed([CLASSROOM.lat, CLASSROOM.lng]);
    return map;
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

  return map;
}

// Kick off AFTER everything is defined
initMap();
