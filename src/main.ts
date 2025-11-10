// src/main.ts
// Basic Leaflet map + fixed player location

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

// --- Fix default marker icon URLs for Vite bundling ---
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

// --- 1) Choose your fixed "classroom" location (replace with your real lat/lng) ---
const CLASSROOM = {
  lat: 36.9916, // placeholder: McHenry Library-ish (UCSC). Change these!
  lng: -122.0583,
  zoom: 17,
};

// --- 2) Ensure a map container exists (full-viewport). If #map doesn't exist, create it. ---
function ensureMapContainer(): HTMLElement {
  const existing = document.getElementById("map");
  if (existing) return existing;

  const el = document.createElement("div");
  el.id = "map";
  Object.assign(el.style, {
    width: "100vw",
    height: "100vh",
    margin: "0",
    padding: "0",
  });
  document.body.style.margin = "0";
  document.body.appendChild(el);
  return el;
}

// --- 3) Initialize map ---
function initMap() {
  const container = ensureMapContainer();

  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
  }).setView([CLASSROOM.lat, CLASSROOM.lng], CLASSROOM.zoom);

  // Tile layer (OpenStreetMap)
  L.tileLayer(
    // You can switch to other providers later if you want different styling
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  ).addTo(map);

  // --- 4) Draw the player ("classroom") location ---
  drawPlayerLocation(map);

  return map;
}

// --- 5) Player marker + a small radius to make it visually obvious ---
function drawPlayerLocation(map: L.Map) {
  const pos: L.LatLngExpression = [CLASSROOM.lat, CLASSROOM.lng];

  // Marker pin
  L.marker(pos).addTo(map).bindPopup("Player (Classroom)").openPopup();

  // Circle for emphasis (10m-ish visual; adjust as you like)
  L.circle(pos, {
    radius: 10, // in meters
    stroke: true,
    weight: 2,
    opacity: 0.8,
    fillOpacity: 0.15,
  }).addTo(map);
}

// Kick it off
initMap();
