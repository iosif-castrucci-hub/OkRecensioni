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

// Calcolo distanza in metri (Haversine)
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

// Autocomplete dropdown (semplice, invisibile; usiamo solo il 1° risultato per UX rapida)
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
    if (q.length < 3) return;
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
// Ordine di specificità: il primo che combacia vince
const SPECIFICITY_ORDER = [
  // ultra specifici (sanità, scuole, PA, ecc.)
  "veterinary_care","dentist","doctor","pharmacy","hospital","physiotherapist",
  "beauty_salon","hair_care","spa","gym",
  "university","school","library",
  "museum","art_gallery","aquarium","zoo",
  "stadium","tourist_attraction","amusement_park",
  "police","fire_station","embassy","courthouse","local_government_office","city_hall","post_office",
  "bank","atm","insurance_agency","real_estate_agency","lawyer","accounting","travel_agency",
  "car_dealer","car_rental","car_repair","car_wash","parking",
  "bicycle_store","motorcycle_dealer","gas_station","electric_vehicle_charging_station",
  "electronics_store","furniture_store","home_goods_store","hardware_store","clothing_store",
  "shoe_store","jewelry_store","book_store","pet_store","supermarket","shopping_mall","store",
  "restaurant","cafe","bar","bakery","meal_takeaway","meal_delivery","food",
  "lodging","campground","rv_park","tourist_information_center",
  "place_of_worship","church","mosque","synagogue","hindu_temple",
  "cemetery","funeral_home",
  "park","night_club","movie_theater","bowling_alley"
];

// Mappa completa tipi Google -> sinonimi/keyword in italiano.
// NB: includiamo la maggior parte dei place types pubblici; se Google restituisce un type non qui presente, lo useremo comunque via details.types + SPECIFICITY_ORDER
const CATEGORY_SYNONYMS = [
  // Ristorazione & cibo
  ["restaurant", [/ristorant/i, /trattor/i, /osteria/i, /pizz/i, /bracer|grigli/i, /tramezz/i, /tavola\s?cald/i, /ristorazione/i]],
  ["cafe", [/caff[eè]/i, /bar\b/i, /torrefaz/i, /caffetter/i, /coffee/i]],
  ["bar", [/bar\b/i, /pub/i, /cocktail/i, /birrer/i, /enotec/i, /wine\s?bar/i]],
  ["bakery", [/panetter/i, /forn/i, /pasticc/i, /bakery/i, /forno/i]],
  ["meal_takeaway", [/asporto/i, /take\s?away/i, /da\s?asporto/i, /kebab/i, /paniner/i, /fast\s?food/i, /street\s?food/i]],
  ["meal_delivery", [/consegna/i, /delivery/i, /a\s?domicilio/i]],
  ["food", [/alimentar/i, /gastronom/i, /salumer/i, /maceller/i, /pescher/i, /fruttivendol/i]],
  // Ospitalità
  ["lodging", [/hotel/i, /alberg/i, /b&b/i, /\bbnb\b/i, /ostello/i, /resort/i, /agritur/i, /guest\s?house/i, /motel/i, /affittacamer/i, /casa\s?vacanze/i]],
  ["campground", [/campegg/i, /camping/i]],
  ["rv_park", [/area\s?(sosta|camper)/i]],
  // Sanità
  ["pharmacy", [/farmac/i, /parafarmac/i, /drogheri/i]],
  ["hospital", [/ospedal/i, /clinic/i, /casa\s?di\s?cura/i, /pronto\s?soccorso/i]],
  ["doctor", [/studio\s?medic/i, /medico/i, /pediatr/i, /cardiolog/i, /dermatolog/i, /oculist/i, /otorino/i, /ortoped/i, /ginecolog/i]],
  ["dentist", [/dentist/i, /odontoiatr/i, /igienista/i]],
  ["physiotherapist", [/fisioterap/i, /riabilitaz/i]],
  ["veterinary_care", [/veterinari/i, /clinica\s?veterinaria/i]],
  // Benessere & Fitness
  ["beauty_salon", [/estetic/i, /beauty/i, /centro\s?benessere/i, /spa/i, /nail\s?shop/i, /solarium/i]],
  ["hair_care", [/parrucch/i, /barbier/i, /hair/i, /acconciatur/i]],
  ["spa", [/spa\b/i, /terme/i, /hammam/i]],
  ["gym", [/palestr/i, /gym/i, /crossfit/i, /fitness/i]],
  // Istruzione & cultura
  ["school", [/scuol/i, /asilo/i, /liceo/i, /istituto/i, /accadem/i/]],
  ["university", [/universit/i, /politecn/i, /ateneo/i]],
  ["library", [/bibliotec/i, /library/i]],
  ["museum", [/museo/i, /galleria\s?museum/i]],
  ["art_gallery", [/galleria\s?d'?arte/i, /mostr/i]],
  ["movie_theater", [/cinema/i, /multisala/i]],
  ["bowling_alley", [/bowling/i]],
  // Pubblica amministrazione & istituzioni
  ["city_hall", [/comune\b/i, /municipio/i]],
  ["local_government_office", [/ufficio\s?comunale/i, /anagrafe/i, /asl\b/i, /usl\b/i, /inps\b/i, /agenzia\s?delle\s?entrate/i, /motorizz/i]],
  ["post_office", [/poste?\s?italiane/i, /ufficio\s?postale/i]],
  ["courthouse", [/tribunal/i, /palazzo\s?di\s?giustiz/i, /giudice\s?di\s?pac/i]],
  ["police", [/questur/i, /polizia/i, /carabinier/i, /guardia\s?di\s?finanza/i]],
  ["fire_station", [/vigili\s?del\s?fuoco/i, /caserma\s?vvf/i]],
  ["embassy", [/ambasciat/i, /consolat/i]],
  // Banche, finanza, agenzie
  ["bank", [/banc[ao]/i, /credito/i]],
  ["atm", [/bancomat/i, /\batm\b/i]],
  ["insurance_agency", [/assicuraz/i, /broker/i]],
  ["real_estate_agency", [/agenzia\s?immobiliare/i, /immobil/i]],
  ["lawyer", [/studio\s?legale/i, /avvocat/i, /notai/o?\\b/i]],
  ["accounting", [/commercialist/i, /caf\b/i, /consulent[ei]\s?fiscal/i]],
  ["travel_agency", [/agenzia\s?viaggi/i, /tour\s?operator/i]],
  // Auto & trasporti
  ["car_dealer", [/concessionar/i, /auto\s?salone/i]],
  ["car_rental", [/noleggio\s?auto/i, /rent\s?a\s?car/i]],
  ["car_repair", [/officin/i, /meccanic/i, /carrozzer/i, /gommist/i, /elettraut/i]],
  ["car_wash", [/autolavagg/i, /car\s?wash/i]],
  ["parking", [/parchegg/i, /autorimes/i, /garage/i]],
  ["gas_station", [/benzina/i, /distributore/i, /stazione\s?di\s?serviz/i]],
  ["electric_vehicle_charging_station", [/colonnin/i, /ricaric[ae]\s?auto\s?elettric/i]],
  ["bicycle_store", [/biciclett/i, /cicli/i, /bici\s?shop/i]],
  ["motorcycle_dealer", [/motoconcessionar/i, /moto\s?store/i, /scooter/i]],
  ["taxi_stand", [/stazion[ei]\s?taxi/i]],
  ["bus_station", [/autostazion/i, /stazione\s?bus/i]],
  ["train_station", [/stazione\s?ferroviar/i, /treni/i]],
  ["subway_station", [/metropolit/i, /stazione\s?metro/i]],
  ["light_rail_station", [/tram/i]],
  ["transit_station", [/stazione\s?dei\s?trasporti/i]],
  ["airport", [/aeroport/i, /aerop/i]],
  ["seaport", [/porto\b/i, /marittim/i]],
  // Commercio & negozi
  ["shopping_mall", [/centro\s?commercial/i, /mall/i]],
  ["supermarket", [/supermercat/i, /ipermercat/i, /discount/i]],
  ["convenience_store", [/minimarket/i, /alimentari/i, /drogheria/i]],
  ["department_store", [/grande\s?magazzin/i, /rinascente/i]],
  ["store", [/negozio/i, /shop/i, /rivendit/i]],
  ["electronics_store", [/elettronic/i, /telefon/i, /smartphon/i, /computer/i, /tv\b/i]],
  ["furniture_store", [/arred/i, /mobili/i, /ikea/i]],
  ["home_goods_store", [/casalingh/i, /articoli\s?per\s?la\s?casa/i]],
  ["hardware_store", [/ferrament/i, /brico/i, /utensiler/i]],
  ["clothing_store", [/abbigliamento/i, /boutique/i/]],
  ["shoe_store", [/scarpe/i, /calzatur/i]],
  ["jewelry_store", [/gioiell/i, /orefic/i]],
  ["book_store", [/librer/i, /bookstore/i]],
  ["pet_store", [/animali/i, /pet\s?shop/i]],
  ["florist", [/fiorai/i, /garden/i, /vivaio/i]],
  ["liquor_store", [/enotec/i, /alcolic/i, /liquor/i]],
  ["butcher_shop", [/maceller/i]],
  ["seafood_market", [/pescher/i]],
  ["bakery_store", [/panetter/i, /forn/i, /pasticc/i]],
  // Tempo libero & attrazioni
  ["park", [/parco\b/i, /giardin/i]],
  ["tourist_attraction", [/attrazione\s?turistic/i, /monument/i, /punto\s?panoramic/i]],
  ["amusement_park", [/parco\s?divertiment/i, /luna\s?park/i]],
  ["stadium", [/stadio/i, /palazzetto/i, /arena/i]],
  ["night_club", [/discotec/i, /night\s?club/i]],
  ["casino", [/casin[oò]/i]],
  ["aquarium", [/acquari/o?/i]],
  ["zoo", [/zoo\b/i, /bioparco/i]],
  // Culto & cimiteri
  ["church", [/chies/i, /basilic/i, /duomo/i, /santuario/i]],
  ["mosque", [/moschea/i]],
  ["synagogue", [/sinagog/i]],
  ["hindu_temple", [/tempio\s?hindu/i]],
  ["place_of_worship", [/luogo\s?di\s?culto/i]],
  ["cemetery", [/cimitero/i]],
  ["funeral_home", [/onoranze\s?funebr/i, /pompe\s?funebr/i]]
];

// Sceglie la categoria più specifica tra quelle restituite da Google, secondo un ordine personalizzato
function pickMostSpecificFromTypes(types = []) {
  if (!types || !types.length) return "";
  for (const t of SPECIFICITY_ORDER) {
    if (types.includes(t)) return t;
  }
  // fallback: il primo type noto
  return types[0];
}

// Detect category: 1) regex su query; 2) dai types Google con priorità; 3) fallback
function detectCategory(queryText, placeTypes = []) {
  const q = (queryText || "").toLowerCase();
  let matched = null;

  // 1) Prova con sinonimi italiani (il più specifico vince: ordiniamo per posizione in SPECIFICITY_ORDER)
  const candidates = [];
  for (const [type, patterns] of CATEGORY_SYNONYMS) {
    for (const re of patterns) {
      try {
        if (re.test(q)) {
          candidates.push(type);
          break;
        }
      } catch {}
    }
  }
  if (candidates.length) {
    candidates.sort((a,b) => SPECIFICITY_ORDER.indexOf(a) - SPECIFICITY_ORDER.indexOf(b));
    matched = candidates[0];
  }

  // 2) Se non c'è match dai sinonimi, scegli il type più specifico restituito da Google
  if (!matched && placeTypes && placeTypes.length) {
    matched = pickMostSpecificFromTypes(placeTypes);
  }

  // 3) Fallback generico
  if (!matched) matched = "establishment";

  // Keyword leggibile in italiano (usata per la ricerca testuale città)
  const typeToKeyword = {
    restaurant: "ristorante", cafe: "bar", bar: "bar", bakery: "panetteria",
    meal_takeaway: "asporto", meal_delivery: "consegna", food: "alimentari",
    lodging: "hotel", campground: "campeggio", rv_park: "area sosta camper",
    pharmacy: "farmacia", hospital: "ospedale", doctor: "studio medico",
    dentist: "dentista", physiotherapist: "fisioterapia", veterinary_care: "veterinario",
    beauty_salon: "centro estetico", hair_care: "parrucchiere", spa: "spa", gym: "palestra",
    school: "scuola", university: "università", library: "biblioteca",
    museum: "museo", art_gallery: "galleria d'arte", movie_theater: "cinema", bowling_alley: "bowling",
    city_hall: "municipio", local_government_office: "ufficio comunale", post_office: "ufficio postale",
    courthouse: "tribunale", police: "polizia", fire_station: "vigili del fuoco", embassy: "ambasciata",
    bank: "banca", atm: "bancomat", insurance_agency: "assicurazioni", real_estate_agency: "agenzia immobiliare",
    lawyer: "studio legale", accounting: "commercialista", travel_agency: "agenzia viaggi",
    car_dealer: "concessionaria", car_rental: "noleggio auto", car_repair: "officina",
    car_wash: "autolavaggio", parking: "parcheggio", gas_station: "stazione di servizio",
    electric_vehicle_charging_station: "colonnina ricarica", bicycle_store: "negozio bici",
    motorcycle_dealer: "concessionaria moto", taxi_stand: "stazione taxi",
    bus_station: "autostazione", train_station: "stazione ferroviaria",
    subway_station: "stazione metro", light_rail_station: "tram", transit_station: "stazione trasporti",
    airport: "aeroporto", seaport: "porto",
    shopping_mall: "centro commerciale", supermarket: "supermercato",
    convenience_store: "minimarket", department_store: "grande magazzino", store: "negozio",
    electronics_store: "negozio elettronica", furniture_store: "arredamento",
    home_goods_store: "casalinghi", hardware_store: "ferramenta", clothing_store: "abbigliamento",
    shoe_store: "negozio scarpe", jewelry_store: "gioielleria", book_store: "libreria",
    pet_store: "negozio animali", florist: "fioraio", liquor_store: "enoteca",
    butcher_shop: "macelleria", seafood_market: "pescheria", bakery_store: "panetteria",
    park: "parco", tourist_attraction: "attrazione turistica", amusement_park: "parco divertimenti",
    stadium: "stadio", night_club: "discoteca", casino: "casino", aquarium: "acquario", zoo: "zoo",
    church: "chiesa", mosque: "moschea", synagogue: "sinagoga", hindu_temple: "tempio hindu",
    place_of_worship: "luogo di culto", cemetery: "cimitero", funeral_home: "onoranze funebri",
    establishment: ""
  };

  return { type: matched, keyword: typeToKeyword[matched] ?? "" };
}

// ===================== PLACE DETAILS + RANKING =====================
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

// Estrae la città da un formatted_address (approccio robusto per indirizzi IT)
function extractCityFromAddress(address) {
  if (!address) return "";
  // Esempi: "Via Roma, 10, 50123 Firenze FI, Italia" -> "Firenze"
  const re = /,\s*\d{5}\s*([^,]+)\s*(?:[A-Z]{2})?,\s*Italia/i;
  const m = address.match(re);
  if (m && m[1]) return m[1].trim();
  // fallback: penultima parte prima di "Italia"
  const parts = address.split(",");
  const idx = parts.findIndex(p => /italia/i.test(p));
  if (idx > 1) return parts[idx - 1].replace(/[A-Z]{2}/, "").trim();
  return parts.length > 1 ? parts[parts.length - 2].trim() : address;
}

function showPlaceAndRank(details) {
  noResultsEl.classList.add("hidden");
  placeCardEl.classList.remove("hidden");
  placeNameEl.textContent = getSafe(details, "name", "Attività");
  placeAddrEl.textContent = getSafe(details, "formatted_address", "");
  const r = getSafe(details, "rating", null);
  const n = getSafe(details, "user_ratings_total", null);
  placeRatingEl.innerHTML = r ? `⭐ <strong>${escapeHtml(String(r))}</strong> ${n ? `· (${n} recensioni)` : ""}` : "";

  const { type, keyword } = detectCategory(inputEl.value, getSafe(details,"types",[]));
  const city = extractCityFromAddress(details.formatted_address);
  buildRealRanking(details, { type, keyword, city });
}

// ===================== RANKING INTELLIGENTE =====================
function buildRealRanking(targetDetails, cat) {
  const location = getSafe(targetDetails, "geometry.location", null);
  if (!location) {
    renderRankingCard("—");
    renderNearbyPlaces([], 0);
    return;
  }

  const center = new google.maps.LatLng(location.lat(), location.lng());
  const nearbyReq = {
    location: center,
    radius: 2500,
    type: cat.type === "establishment" ? undefined : cat.type,
    keyword: cat.keyword || "",
    language: "it",
  };

  renderRankingCard("…");

  placesService.nearbySearch(nearbyReq, (res, st) => {
    if (st !== google.maps.places.PlacesServiceStatus.OK || !res || res.length < 3) {
      const cityQuery = (cat.keyword || inputEl.value) + (cat.city ? ` ${cat.city}` : "");
      const cityReq = {
        query: cityQuery.trim(),
        language: "it",
      };
      placesService.textSearch(cityReq, (res2, st2) => {
        finalizeRanking(targetDetails, center, res2 || []);
      });
    } else {
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

  const withScore = mapped.map(m => ({ ...m, score: scorePlace(m) }));
  withScore.sort((a, b) => b.score - a.score);

  const idx = withScore.findIndex(x => x.place_id === target.place_id);
  const position = idx >= 0 ? idx + 1 : "—";

  renderRankingCard(position);
  const ahead = typeof position === "number" ? withScore.slice(0, position - 1) : [];
  renderNearbyPlaces(ahead.slice(0, 7), position);
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
        <a 
          href="https://wa.me/393512345678?text=Ciao%20👋%20Ho%20appena%20visto%20il%20mio%20posizionamento%20su%20Più%20Recensioni%20e%20vorrei%20migliorare%20la%20mia%20visibilità%20su%20Google.%20Puoi%20aiutarmi%3F"
          target="_blank"
          id="whatsappButton"
          class="whatsapp-btn pulse-mobile"
          style="
            background: linear-gradient(90deg, #25D366 0%, #1EBE5A 100%);
            color: white;
            font-weight: 600;
            padding: 0.9rem 1.8rem;
            border-radius: 50px;
            font-size: 1rem;
            box-shadow: 0 4px 14px rgba(0,0,0,0.25);
            text-decoration: none;
            transition: all 0.25s ease;
          "
          onmouseover="this.style.transform='scale(1.05)'"
          onmouseout="this.style.transform='scale(1)'"
        >
          💬 Migliora la tua posizione su Google
        </a>
      </div>
    </div>
  `;

  const whatsappBtn = document.getElementById("whatsappButton");
  if (whatsappBtn && navigator.vibrate) {
    whatsappBtn.addEventListener("click", () => navigator.vibrate(50));
  }
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
    html += `
      <div class="service-card glass" style="padding:1rem;border-radius:12px;">
        <div style="font-weight:700;font-size:1.05rem;color:#fff">${escapeHtml(item.name)}</div>
        <div style="color:rgba(255,255,255,.85);font-size:.95rem;margin-top:.3rem;">
          <span style="color:gold;">⭐ ${item.rating.toFixed(1)}</span> · ${item.total} recensioni · 📍 ${formatDistance(item.distanceM)}
        </div>
      </div>`;
  });
  box.innerHTML = html + "</div>";
}

function showMessage(msg) {
  noResultsEl.classList.remove("hidden");
  placeCardEl.classList.add("hidden");
  noResultsEl.innerHTML = `<p>${escapeHtml(msg)}</p>`;
}
