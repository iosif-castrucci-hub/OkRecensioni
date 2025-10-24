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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 ore

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

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
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
  try {
    if (!fromLatLng || !toLocation) return 0;
    const R = 6371000;
    const lat1 = fromLatLng.lat();
    const lon1 = fromLatLng.lng();
    const lat2 = typeof toLocation.lat === "function" ? toLocation.lat() : toLocation.lat;
    const lon2 = typeof toLocation.lng === "function" ? toLocation.lng() : toLocation.lng;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  } catch {
    return 0;
  }
}

// ===================== SCORE =====================
function scorePlace({ rating = 0, total = 0, distanceM = 0 }) {
  const distKm = distanceM / 10000;
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

const acContainer = document.createElement("div");
acContainer.className = "autocomplete-results hidden";
inputEl.parentElement.appendChild(acContainer);

// ===================== GOOGLE PLACES SETUP =====================
let mapDummy = null;
let placesService = null;
let autocompleteService = null;

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

function attachInputEvents() {
  inputEl.addEventListener("input", () => {
    const q = (inputEl.value || "").trim();
    if (q.length < 3) {
      acContainer.innerHTML = "";
      acContainer.classList.add("hidden");
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => showPredictions(q), 220);
  });

  inputEl.addEventListener("focus", () => {
    if (acContainer.innerHTML) acContainer.classList.remove("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!acContainer.contains(e.target) && e.target !== inputEl) {
      acContainer.classList.add("hidden");
    }
  });
}

function showPredictions(query) {
  autocompleteService.getPlacePredictions(
    { input: query, language: "it", types: ["establishment"] },
    (preds, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !preds || !preds.length) {
        acContainer.innerHTML = "<div class='autocomplete-item muted'>Nessun risultato</div>";
        acContainer.classList.remove("hidden");
        return;
      }
      acContainer.innerHTML = "";
      preds.slice(0, 6).forEach(p => {
        const el = document.createElement("div");
        el.className = "autocomplete-item";
        const main = escapeHtml(getSafe(p, "structured_formatting.main_text", ""));
        const sec = escapeHtml(getSafe(p, "structured_formatting.secondary_text", ""));
        el.innerHTML = `<strong>${main}</strong><div style="font-size:.9rem;color:rgba(255,255,255,.8)">${sec}</div>`;
        el.addEventListener("click", () => {
          inputEl.value = p.description;
          acContainer.classList.add("hidden");
          fetchPlaceDetails(p.place_id);
        });
        acContainer.appendChild(el);
      });
      acContainer.classList.remove("hidden");
    }
  );
}

// ===================== CATEGORY DETECTION =====================
const CATEGORY_MAP = [
  { test: /pizz|pizzeria/i, type: "restaurant", keyword: "pizzeria" },
  { test: /trattor/i, type: "restaurant", keyword: "trattoria" },
  { test: /ristorant/i, type: "restaurant", keyword: "ristorante" },
  { test: /osteria/i, type: "restaurant", keyword: "osteria" },
  { test: /sushi|giappo/i, type: "restaurant", keyword: "sushi" },
  { test: /kebab/i, type: "restaurant", keyword: "kebab" },
  { test: /gelat|ice\s?cream/i, type: "cafe", keyword: "gelateria" },
  { test: /bar|pub/i, type: "bar", keyword: "bar" },
  { test: /caff[eè]/i, type: "cafe", keyword: "caffetteria" },
  { test: /panetter|forn|bakery/i, type: "bakery", keyword: "" },
  { test: /hotel|alberg|b&b|bnb/i, type: "lodging", keyword: "" },
  { test: /pasticc|pastry/i, type: "bakery", keyword: "pasticceria" },
  { test: /farmac|parafarmac/i, type: "pharmacy", keyword: "farmacia" },
  { test: /palestr|gym|fitness/i, type: "gym", keyword: "palestra" },
  { test: /centro\s?estetic|beauty/i, type: "beauty_salon", keyword: "centro estetico" },
  { test: /officina|meccanic/i, type: "car_repair", keyword: "officina" },
  { test: /supermercat|market/i, type: "supermarket", keyword: "" },
  { test: /scuola|universit|asilo/i, type: "school", keyword: "scuola" },
  { test: /bibliotec/i, type: "library", keyword: "biblioteca" },
  { test: /food|cucina|mangiare/i, type: "restaurant", keyword: "" },
];

function detectCategory(queryText, placeTypes = []) {
  const q = (queryText || "").toLowerCase();
  for (const row of CATEGORY_MAP) {
    if (row.test.test(q)) return { type: row.type, keyword: row.keyword };
  }
  const t = (placeTypes || []).map(t => t.toLowerCase());
  if (t.includes("lodging")) return { type: "lodging", keyword: "" };
  if (t.includes("bar")) return { type: "bar", keyword: "" };
  if (t.includes("cafe")) return { type: "cafe", keyword: "" };
  if (t.includes("bakery")) return { type: "bakery", keyword: "" };
  if (t.includes("restaurant")) return { type: "restaurant", keyword: "" };
  return { type: "restaurant", keyword: "" };
}

// ===================== PLACE DETAILS + RANKING =====================
function fetchPlaceDetails(placeId) {
  const cached = getCached(placeId);
  if (cached) {
    showPlaceAndRank(cached);
    return;
  }

  showMessage("Caricamento dettagli attività...");
  placesService.getDetails(
    { placeId, fields: ["name", "formatted_address", "geometry", "rating", "user_ratings_total", "types", "place_id"] },
    (details, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !details) {
        showMessage("Impossibile recuperare i dettagli dell'attività.");
        return;
      }
      setCached(placeId, details);
      showPlaceAndRank(details);
    }
  );
}

function showPlaceAndRank(details) {
  noResultsEl.classList.add("hidden");
  placeCardEl.classList.remove("hidden");
  placeNameEl.textContent = getSafe(details, "name", "Attività");
  placeAddrEl.textContent = getSafe(details, "formatted_address", "");
  const r = getSafe(details, "rating", null);
  const n = getSafe(details, "user_ratings_total", null);
  placeRatingEl.innerHTML = r ? `⭐ <strong>${escapeHtml(String(r))}</strong> ${n ? `· (${n} recensioni)` : ""}` : "";
  const { type, keyword } = detectCategory(inputEl.value, details.types);
  buildRealRanking(details, { type, keyword });
}

function buildRealRanking(targetDetails, cat) {
  const cacheKey = "rank_" + getSafe(targetDetails, "place_id", "");
  const cachedRank = getCached(cacheKey);
  if (cachedRank) {
    finalizeRanking(targetDetails, cachedRank.center, cachedRank.rawList);
    return;
  }

  const location = getSafe(targetDetails, "geometry.location", null);
  if (!location) {
    renderRankingCard("—");
    renderNearbyPlaces([], 0);
    return;
  }

  const center = new google.maps.LatLng(location.lat(), location.lng());
  const nearbyReq = { location: center, radius: 5000, type: cat.type, language: "it" };
  if (cat.keyword) nearbyReq.keyword = cat.keyword;

  renderRankingCard("…");
  placesService.nearbySearch(nearbyReq, (res, st) => {
    if (st !== google.maps.places.PlacesServiceStatus.OK || !res || !res.length) {
      const textReq = { query: inputEl.value + " Italia", language: "it" };
      placesService.textSearch(textReq, (res2, st2) => {
        setCached(cacheKey, { center, rawList: res2 || [] });
        finalizeRanking(targetDetails, center, res2 || []);
      });
    } else {
      setCached(cacheKey, { center, rawList: res });
      finalizeRanking(targetDetails, center, res);
    }
  });
}

// ===================== RENDERING =====================
function finalizeRanking(targetDetails, center, rawList) {
  const mapped = (rawList || []).map(p => ({
    place_id: getSafe(p, "place_id", ""),
    name: getSafe(p, "name", ""),
    rating: getSafe(p, "rating", 0),
    total: getSafe(p, "user_ratings_total", 0),
    distanceM: distanceMeters(center, getSafe(p, "geometry.location", null)),
  }));

  const target = {
    place_id: getSafe(targetDetails, "place_id", ""),
    name: getSafe(targetDetails, "name", ""),
    rating: getSafe(targetDetails, "rating", 0),
    total: getSafe(targetDetails, "user_ratings_total", 0),
    distanceM: 0,
  };
  if (!mapped.some(m => m.place_id === target.place_id)) mapped.push(target);

  const withScore = mapped.map(m => ({ ...m, score: scorePlace(m) })).sort((a, b) => b.score - a.score);
  const idx = withScore.findIndex(x => x.place_id === target.place_id);
  const position = idx >= 0 ? idx + 1 : "—";

  renderRankingCard(position);
  const ahead = typeof position === "number" ? withScore.slice(0, position - 1) : [];
  renderNearbyPlaces(ahead.slice(0, 7), position, target);
}

function renderRankingCard(position) {
  reviewsDiv.innerHTML = `
    <div class="ranking-card glass">
      <h3>📊 Il tuo posizionamento stimato</h3>
      <p class="muted">Il tuo posizionamento nella ricerca locale:</p>
      <div class="rank-number">${position}${typeof position === "number" ? "º" : ""}</div>
      <p class="muted">Scopri chi ti sta superando nella zona:</p>
      <div id="nearby-list" style="margin-top:.6rem;"></div>
      <div style="display:flex;justify-content:center;margin-top:1.5rem;">
        <a href="https://wa.me/393534907105?text=Ciao%20👋%20Ho%20appena%20visto%20il%20mio%20posizionamento%20su%20+Recensioni%20e%20vorrei%20migliorare%20la%20mia%20visibilità%20su%20Google.%20Puoi%20aiutarmi%3F"
          target="_blank" class="whatsapp-btn pulse-mobile"
          style="background:linear-gradient(90deg,#25D366 0%,#1EBE5A 100%);color:white;font-weight:600;padding:0.9rem 1.8rem;border-radius:50px;font-size:1rem;box-shadow:0 4px 14px rgba(0,0,0,0.25);text-decoration:none;transition:all .25s ease;">
          💬 Migliora la tua posizione su Google
        </a>
      </div>
    </div>`;
}

function renderNearbyPlaces(list, position, target) {
  const box = document.getElementById("nearby-list");
  if (!box) return;
  if (!list || !list.length) {
    box.innerHTML = `<p class="muted">Al momento non abbiamo trovato attività che ti superano in zona.</p>`;
    return;
  }

  let html = `<h4>🏆 Attività più visibili nella tua zona</h4>
              <div style="display:flex;flex-direction:column;gap:.7rem;margin-top:.6rem;">`;
  list.forEach(item => {
    html += `<div class="service-card glass" style="padding:1rem;border-radius:12px;">
      <div style="font-weight:700;font-size:1.05rem;color:#fff">${escapeHtml(item.name)}</div>
      <div style="color:rgba(255,255,255,.85);font-size:.95rem;margin-top:.3rem;">
        <span style="color:gold;">⭐ ${item.rating.toFixed(1)}</span> · ${item.total} recensioni · 📍 ${formatDistance(item.distanceM)}
      </div></div>`;
  });
  html += `</div>`;

  // --- SMART COMPARISON ---
  if (target && list.length > 0) {
    const avgRating = list.reduce((sum, x) => sum + (x.rating || 0), 0) / list.length;
    const avgTotal = list.reduce((sum, x) => sum + (x.total || 0), 0) / list.length;
    const diffRating = target.rating - avgRating;
    const diffTotal = target.total - avgTotal;

    let color = "#cccccc";
    if (diffRating >= 0.2) color = "#4CAF50"; // verde
    else if (diffRating >= -0.2) color = "#FFC107"; // giallo
    else color = "#FF5252"; // rosso

    const trend =
      diffRating > 0.2
        ? "🌟 Hai un punteggio migliore della media locale!"
        : diffRating < -0.2
        ? "⚠️ Il tuo rating è inferiore alla media nella tua zona."
        : "😐 Hai un punteggio simile agli altri.";

    html += `<div style="margin-top:1.5rem;padding:1rem;border-radius:12px;background:rgba(255,255,255,0.08);font-size:.95rem;">
      <strong>🔍 Analisi comparativa</strong><br>
      Media top competitor: ${avgRating.toFixed(1)}⭐ – ${Math.round(avgTotal)} recensioni<br>
      Tua attività: ${target.rating.toFixed(1)}⭐ – ${target.total} recensioni<br>
      <div style="margin-top:.4rem;color:${color};font-weight:600;">${trend}</div>
    </div>`;
  }

  box.innerHTML = html;
}

function showMessage(msg) {
  noResultsEl.classList.remove("hidden");
  placeCardEl.classList.add("hidden");
  noResultsEl.innerHTML = `<p>${escapeHtml(msg)}</p>`;
}
