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
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  } catch {
    return 0;
  }
}

function scorePlace({ rating = 0, total = 0, distanceM = 0 }) {
  const distKm = distanceM / 1000;
  return rating * 20 + log1p(total) * 3 - distKm * 1.2;
}

// ===================== DOM =====================
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

// ===================== GOOGLE PLACES =====================
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
}

function showPredictions(query) {
  autocompleteService.getPlacePredictions(
    { input: query, language: "it", types: ["establishment"] },
    (preds, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !preds || !preds.length) return;
      fetchPlaceDetails(preds[0].place_id);
    }
  );
}

// ===================== CATEGORY DETECTION =====================
const CATEGORY_MAP = [
  // Ristorazione
  { test: /ristorant|pizzer|osteria|trattor|sushi|bracer|tavola/i, type: "restaurant" },
  { test: /bar|pub|enotec|birrer|cocktail/i, type: "bar" },
  { test: /caff[eè]|torrefaz|caffetter/i, type: "cafe" },
  { test: /pasticc|panetter|forn|bakery/i, type: "bakery" },
  { test: /asporto|take\s?away|delivery|fast\s?food/i, type: "meal_takeaway" },
  // Ospitalità
  { test: /hotel|alberg|bnb|b&b|ostello|agritur|resort/i, type: "lodging" },
  // Sanità
  { test: /farmac|parafarmac/i, type: "pharmacy" },
  { test: /ospedal|clinic|pronto\s?soccorso/i, type: "hospital" },
  { test: /dentist|odontoiatr/i, type: "dentist" },
  { test: /studio\s?medic|fisioterap|veterinar/i, type: "doctor" },
  // Benessere
  { test: /parrucch|estetic|beauty|spa|barbier/i, type: "beauty_salon" },
  { test: /palestr|fitness|gym/i, type: "gym" },
  // Commercio
  { test: /supermerc|alimentar|discount/i, type: "supermarket" },
  { test: /negozio|shop|store/i, type: "store" },
  { test: /elettronic|telefon|computer|tv/i, type: "electronics_store" },
  { test: /abbigliament|moda|boutique/i, type: "clothing_store" },
  { test: /scarpe|calzatur/i, type: "shoe_store" },
  { test: /gioiell|orefic/i, type: "jewelry_store" },
  { test: /librer|bookstore/i, type: "book_store" },
  { test: /animali|pet\s?shop/i, type: "pet_store" },
  { test: /fiorai|garden|vivaio/i, type: "florist" },
  // Auto e officine
  { test: /officin|meccanic|carrozzer|gommist|autolavagg/i, type: "car_repair" },
  { test: /concessionar|autosal|auto\b/i, type: "car_dealer" },
  { test: /noleggio\s?auto|rent\s?a\s?car/i, type: "car_rental" },
  // Istruzione e PA
  { test: /scuol|liceo|universit|bibliotec/i, type: "school" },
  { test: /museo|galleria|teatro|cinema/i, type: "museum" },
  { test: /comune|municipio|anagrafe|inps/i, type: "local_government_office" },
  { test: /poste?|ufficio\s?postale/i, type: "post_office" },
  { test: /polizia|carabinier|vigili/i, type: "police" },
  // Altro
  { test: /banca|atm|bancomat/i, type: "bank" },
  { test: /agenzia\s?immobiliare/i, type: "real_estate_agency" },
  { test: /tribunal|avvocat|studio\s?legale/i, type: "lawyer" },
];

function detectCategory(queryText, placeTypes = []) {
  const q = (queryText || "").toLowerCase();
  for (const row of CATEGORY_MAP) if (row.test.test(q)) return { type: row.type, keyword: "" };
  const t = (placeTypes || []).map(t => t.toLowerCase());
  const known = ["restaurant", "bar", "cafe", "bakery", "lodging", "hospital", "pharmacy", "gym", "store"];
  for (const type of known) if (t.includes(type)) return { type, keyword: "" };
  return { type: "establishment", keyword: "" };
}

// ===================== PLACE DETAILS =====================
function fetchPlaceDetails(placeId) {
  showMessage("Caricamento dettagli attività...");
  placesService.getDetails(
    { placeId, fields: ["name", "formatted_address", "geometry", "rating", "user_ratings_total", "types", "place_id"] },
    (details, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !details) {
        showMessage("Impossibile recuperare i dettagli dell'attività.");
        return;
      }
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

// ===================== RANKING =====================
function buildRealRanking(targetDetails, cat) {
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
      placesService.textSearch(textReq, (res2, st2) => finalizeRanking(targetDetails, center, res2 || []));
    } else {
      finalizeRanking(targetDetails, center, res);
    }
  });
}

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
  renderNearbyPlaces(withScore.slice(0, position - 1).slice(0, 7), position);
}

// ===================== RENDERING =====================
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

function renderNearbyPlaces(list, position) {
  const box = document.getElementById("nearby-list");
  if (!box) return;
  if (!list || !list.length) {
    box.innerHTML = `<p class="muted">Al momento non abbiamo trovato attività che ti superano in zona.</p>`;
    return;
  }
  let html = `<h4>🏆 Attività più visibili nella tua zona</h4><div style="display:flex;flex-direction:column;gap:.7rem;margin-top:.6rem;">`;
  list.forEach(item => {
    html += `<div class="service-card glass" style="padding:1rem;border-radius:12px;">
        <div style="font-weight:700;font-size:1.05rem;color:#fff">${escapeHtml(item.name)}</div>
        <div style="color:rgba(255,255,255,.85);font-size:.95rem;margin-top:.3rem;">
          <span style="color:gold;">⭐ ${item.rating.toFixed(1)}</span> · ${item.total} recensioni · 📍 ${formatDistance(item.distanceM)}
        </div></div>`;
  });
  box.innerHTML = html + "</div>";
}

function showMessage(msg) {
  noResultsEl.classList.remove("hidden");
  placeCardEl.classList.add("hidden");
  noResultsEl.innerHTML = `<p>${escapeHtml(msg)}</p>`;
}
