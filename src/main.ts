// ----- src/main.ts -----
// Author: Bryce Han
// CMPM 121, Fall 2025
// D3: World of bits

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

// ----- Config -----
const CLASSROOM = {
  lat: 36.99785920944698,
  lng: -122.05683743811225,
  zoom: 17,
};

// allow geolocation if you toggle this:
const USE_GEOLOCATION = false;

// ----- Ensure map container -----
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

// ----- Fix default icon URLs for Vite -----
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

// ----- Pulsing player dot -----
function installPlayerStyles() {
  if (document.getElementById("player-dot-style")) return;
  const style = document.createElement("style");
  style.id = "player-dot-style";
  style.textContent = `
    .player-dot {
      width: 16px; height: 16px; border-radius: 50%;
      background: rgba(0, 122, 255, 1);
      box-shadow: 0 0 0 2px white inset, 0 0 6px rgba(0,0,0,0.35);
      transform: translate(-8px, -8px);
      position: relative;
    }
    .player-dot::after {
      content: "";
      position: absolute; left: 50%; top: 50%;
      width: 16px; height: 16px; border-radius: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 122, 255, 0.35);
      animation: pulse 1.8s ease-out infinite;
    }
    @keyframes pulse {
      0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.6; }
      70%  { transform: translate(-50%, -50%) scale(2.4); opacity: 0;   }
      100% { transform: translate(-50%, -50%) scale(1);   opacity: 0;   }
    }
    .player-badge {
      position: absolute; top: 8px; left: 8px;
      background: rgba(0,0,0,0.6); color: #fff;
      font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      padding: 6px 8px; border-radius: 8px;
      z-index: 9999;
    }
  `;
  document.head.appendChild(style);
}

// ----- Player layer -----
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
      this.map.setView(pos as L.LatLngExpression, CLASSROOM.zoom);
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

// ----- HUD badge (tiny helper to visualize current mode) -----
function ensureHudBadge(): HTMLElement {
  let el = document.querySelector(".player-badge") as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "player-badge";
    document.body.appendChild(el);
  }
  return el;
}

// ----- Initialize map -----
function initMap() {
  installPlayerStyles();
  const container = ensureMapContainer();

  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
  }).setView([CLASSROOM.lat, CLASSROOM.lng], CLASSROOM.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const player = new PlayerLayer(map);
  const badge = ensureHudBadge();

  // Mode A: fixed classroom point (assignment default)
  if (!USE_GEOLOCATION) {
    badge.textContent = "Player: fixed classroom location";
    player.showFixed([CLASSROOM.lat, CLASSROOM.lng]);
    return map;
  }

  // Mode B: live geolocation (optional)
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

  return map;
}

// ----- Start everything -----
initMap();
