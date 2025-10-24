// ===================== UTILITIES =====================
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function log1p(n) {
  return Math.log(1 + Math.max(0, n));
}

function formatDistance(meters) {
  if (!meters && meters !== 0) return "";
  if (meters >= 1000) return (meters / 1000).toFixed(1) + " km";
  return Math.round(meters) + " m";
}

function getSafe(obj, path, def = "") {
  try {
    return path.split(".").reduce((o, k) => (o || {})[k], obj) ?? def;
  } catch {
    return def;
  }
}

// ===================== CACHE =====================
const CACHE_KEY = "places_cache_v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function loadCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    const now = Date.now();
    for (const key in data) {
      if (now - data[key].ts > CACHE_TTL_MS) delete data[key];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    return data;
  } catch {
    return {};
  }
}

function saveCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}

function getCached(id) {
  const c = loadCache();
  return c[id]?.data || null;
}

function setCached(id, data) {
  const c = loadCache();
  c[id] = { ts: Date.now(), data };
  saveCache(c);
}

// ===================== DISTANCES =====================
function distanceMeters(fromLatLng, toLocation) {
  if (!fromLatLng || !toLocation) return 0;
  try {
    const R = 6371000;
    const lat1 = typeof fromLatLng.lat === "function" ? fromLatLng.lat() : fromLatLng.lat;
    const lon1 = typeof fromLatLng.lng === "function" ? fromLatLng.lng() : fromLatLng.lng;
    const lat2 = typeof toLocation.lat === "function" ? toLocation.lat() : toLocation.lat;
    const lon2 = typeof toLocation.lng === "function" ? toLocation.lng() : toLocation.lng;
    if ([lat1, lon1, lat2, lon2].some(v => typeof v !== "number" || isNaN(v))) return 0;

    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
  } catch {
    return 0;
  }
}

// ===================== SCORE =====================
function scorePlace({ rating = 0, total = 0, distanceM = 0 }) {
  const distKm = distanceM / 1000;
  return rating * 20 + log1p(total) * 3 - distKm * 1.2;
}

// ===================== DOM SHORTCUTS =====================
const inputEl = document.getElementById("place-input");
const noResultsEl = document.getElementById("no-results");
const placeCardEl = document.getElementById("place-card");
const placeNameEl = document.getElementById("place-name");
const placeAddrEl = document.getElementById("place-address");
const placeRatingEl = document.getElementById("place-rating");
const reviewsDiv = document.getElementById("reviews-list");

// ===================== GOOGLE PLACES =====================
let mapDummy, placesService, autocompleteService;

window.initApp = function initApp() {
  const dummy = document.createElement("div");
  dummy.style.display = "none";
  document.body.appendChild(dummy);
  mapDummy = new google.maps.Map(dummy);
  placesService = new google.maps.places.PlacesService(mapDummy);
  autocompleteService = new google.maps.places.AutocompleteService();
  attachInputEvents();
  showMessage("Inizia digitando il nome della tua attività sopra 👆");
};

// ===================== AUTOCOMPLETE =====================
let debounceTimer = null;
const acContainer = document.createElement("div");
acContainer.className = "autocomplete-results hidden";
inputEl.parentElement.appendChild(acContainer);

function attachInputEvents() {
  inputEl.addEventListener("input", () => {
    const q = (inputEl.value || "").trim();
    if (q.length < 3) {
      acContainer.classList.add("hidden");
      acContainer.innerHTML = "";
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => showPredictions(q), 220);
  });
}

function showPredictions(query) {
  autocompleteService.getPlacePredictions(
    { input: query, language: "it", types: ["establishment"] },
    (preds, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !preds?.length) {
        acContainer.innerHTML = "<div class='autocomplete-item muted'>Nessun risultato</div>";
        acContainer.classList.remove("hidden");
        return;
      }
      acContainer.innerHTML = "";
      preds.slice(0, 6).forEach(p => {
        const el = document.createElement("div");
        el.className = "autocomplete-item";
        el.innerHTML = `<strong>${escapeHtml(p.structured_formatting.main_text)}</strong><div style="font-size:.9rem;color:rgba(255,255,255,.8)">${escapeHtml(p.structured_formatting.secondary_text)}</div>`;
        el.onclick = () => {
          inputEl.value = p.description;
          acContainer.classList.add("hidden");
          fetchPlaceDetails(p.place_id);
        };
        acContainer.appendChild(el);
      });
      acContainer.classList.remove("hidden");
    }
  );
}

// ===================== CATEGORY DETECTION =====================
const CATEGORY_MAP = [
  { test: /ristorant|pizzer|trattor|osteria|sushi|kebab/i, type: "restaurant", keyword: "ristorante" },
  { test: /hotel|alberg|b&b|bnb/i, type: "lodging", keyword: "hotel" },
  { test: /farmac|parafarmac/i, type: "pharmacy", keyword: "farmacia" },
  { test: /palestr|gym|fitness/i, type: "gym", keyword: "palestra" },
  { test: /bar|pub/i, type: "bar", keyword: "bar" },
  { test: /caff[eè]/i, type: "cafe", keyword: "caffè" },
  { test: /supermercat|market/i, type: "supermarket", keyword: "supermercato" },
  { test: /bibliotec/i, type: "library", keyword: "biblioteca" },
  { test: /scuola|universit|asilo/i, type: "school", keyword: "scuola" },
  { test: /centro\s?estetic|beauty/i, type: "beauty_salon", keyword: "centro estetico" },
];

function detectCategory(queryText, placeTypes = []) {
  const q = (queryText || "").toLowerCase();
  for (const row of CATEGORY_MAP) if (row.test.test(q)) return row;
  const t = (placeTypes || []).map(t => t.toLowerCase());
  if (t.includes("restaurant")) return { type: "restaurant", keyword: "ristorante" };
  if (t.includes("lodging")) return { type: "lodging", keyword: "hotel" };
  if (t.includes("pharmacy")) return { type: "pharmacy", keyword: "farmacia" };
  if (t.includes("gym")) return { type: "gym", keyword: "palestra" };
  return { type: "restaurant", keyword: "ristorante" };
}

// ===================== PLACE DETAILS + RANKING =====================
function fetchPlaceDetails(placeId) {
  const cached = getCached(placeId);
  if (cached) return showPlaceAndRank(cached);

  showMessage("Caricamento dettagli attività...");
  placesService.getDetails(
    { placeId, fields: ["name", "formatted_address", "geometry", "rating", "user_ratings_total", "types", "place_id"] },
    (details, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !details)
        return showMessage("Impossibile recuperare i dettagli dell'attività.");
      setCached(placeId, details);
      showPlaceAndRank(details);
    }
  );
}

function showPlaceAndRank(details) {
  noResultsEl.classList.add("hidden");
  placeCardEl.classList.remove("hidden");
  placeNameEl.textContent = details.name || "Attività";
  placeAddrEl.textContent = details.formatted_address || "";
  placeRatingEl.innerHTML = details.rating
    ? `⭐ <strong>${escapeHtml(String(details.rating))}</strong> · (${details.user_ratings_total || 0} recensioni)`
    : "";

  const { type, keyword } = detectCategory(inputEl.value, details.types);
  buildRealRanking(details, { type, keyword });
}

function buildRealRanking(targetDetails, cat) {
  const location = getSafe(targetDetails, "geometry.location", null);
  if (!location) return showMessage("Posizione non trovata.");
  const center = new google.maps.LatLng(location.lat(), location.lng());

  const reqNearby = { location: center, radius: 10000, type: cat.type, language: "it" }; // 10 km
  if (cat.keyword) reqNearby.keyword = cat.keyword;

  renderRankingCard("…");

  placesService.nearbySearch(reqNearby, (res, st) => {
    if (st !== google.maps.places.PlacesServiceStatus.OK || !res?.length) {
      const textReq = { query: cat.keyword || cat.type, location: center, radius: 10000, language: "it" };
      placesService.textSearch(textReq, (res2) => finalizeRanking(targetDetails, center, res2 || []));
    } else finalizeRanking(targetDetails, center, res);
  });
}

// ===================== RENDERING =====================
function finalizeRanking(targetDetails, center, rawList) {
  const mapped = (rawList || []).map(p => ({
    place_id: p.place_id,
    name: p.name,
    rating: p.rating || 0,
    total: p.user_ratings_total || 0,
    distanceM: distanceMeters(center, p.geometry?.location)
  }));

  const target = {
    place_id: targetDetails.place_id,
    name: targetDetails.name,
    rating: targetDetails.rating || 0,
    total: targetDetails.user_ratings_total || 0,
    distanceM: 0,
  };
  if (!mapped.some(m => m.place_id === target.place_id)) mapped.push(target);

  const ranked = mapped.map(m => ({ ...m, score: scorePlace(m) })).sort((a,b) => b.score - a.score);
  const pos = ranked.findIndex(r => r.place_id === target.place_id) + 1 || "—";

  renderRankingCard(pos);
  const ahead = typeof pos === "number" ? ranked.slice(0, pos - 1) : [];
  renderNearbyPlaces(ahead.slice(0,7), target);
}

function renderRankingCard(pos) {
  reviewsDiv.innerHTML = `
  <div class="ranking-card glass">
    <h3>📊 Il tuo posizionamento stimato</h3>
    <p class="muted">Il tuo posizionamento nella ricerca locale:</p>
    <div class="rank-number">${pos}${typeof pos === "number" ? "º" : ""}</div>
    <p class="muted">Scopri chi ti sta superando nella zona:</p>
    <div id="nearby-list" style="margin-top:.6rem;"></div>
    <div style="display:flex;justify-content:center;margin-top:1.5rem;">
      <a href="https://wa.me/393534907105?text=Ciao%20👋%20Ho%20appena%20visto%20il%20mio%20posizionamento%20su%20+Recensioni..."
        target="_blank" class="whatsapp-btn pulse-mobile"
        style="background:linear-gradient(90deg,#25D366 0%,#1EBE5A 100%);color:white;font-weight:600;padding:0.9rem 1.8rem;border-radius:50px;font-size:1rem;box-shadow:0 4px 14px rgba(0,0,0,0.25);text-decoration:none;transition:all .25s ease;">
        💬 Migliora la tua posizione su Google
      </a>
    </div>
  </div>`;
}

function renderNearbyPlaces(list, target) {
  const box = document.getElementById("nearby-list");
  if (!list.length) {
    box.innerHTML = `<p class="muted">Nessun competitor trovato in zona.</p>`;
    return;
  }

  let html = `<h4>🏆 Attività più visibili nella tua zona</h4><div style="display:flex;flex-direction:column;gap:.7rem;margin-top:.6rem;">`;
  list.forEach(p => {
    html += `<div class="service-card glass" style="padding:1rem;border-radius:12px;">
      <div style="font-weight:700;font-size:1.05rem;color:#fff">${escapeHtml(p.name)}</div>
      <div style="color:rgba(255,255,255,.85);font-size:.95rem;margin-top:.3rem;">
        <span style="color:gold;">⭐ ${p.rating.toFixed(1)}</span> · ${p.total} recensioni · 📍 ${formatDistance(p.distanceM)}
      </div></div>`;
  });
  html += `</div>`;

  // --- Analisi comparativa ---
  if (target && list.length > 0) {
    const avgR = list.reduce((s, x) => s + x.rating, 0) / list.length;
    const avgT = list.reduce((s, x) => s + x.total, 0) / list.length;
    const diffR = target.rating - avgR;
    const diffT = target.total - avgT;
    const color = diffR < -0.2 || diffT < -20 ? "#FF5252" : "#FFC107";
    const trend = diffR < -0.2
      ? "⚠️ Il tuo rating è inferiore alla media nella tua zona."
      : "😐 Hai un punteggio simile alla media locale.";
    html += `<div style="margin-top:1.5rem;padding:1rem;border-radius:12px;background:rgba(255,255,255,0.08);font-size:.95rem;">
    <strong>🔍 Analisi comparativa</strong><br>
    Media top competitor: ${avgR.toFixed(1)}⭐ – ${Math.round(avgT)} recensioni<br>
    Tua attività: ${target.rating.toFixed(1)}⭐ – ${target.total} recensioni<br>
    <div style="margin-top:.4rem;color:${color};font-weight:600;">${trend}</div></div>`;
  }

  box.innerHTML = html;
}

function showMessage(msg) {
  noResultsEl.classList.remove("hidden");
  placeCardEl.classList.add("hidden");
  noResultsEl.innerHTML = `<p>${escapeHtml(msg)}</p>`;
}
