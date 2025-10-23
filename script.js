// script.js — OkRecensioni Autocomplete + Reviews

let autocompleteService = null;
let placesService = null;
let resultsContainer = null;
let inputEl = null;
let debounceTimer = null;

function initApp() {
  if (!window.google || !google.maps || !google.maps.places) {
    console.error("Google Places non disponibile");
    return;
  }

  inputEl = document.getElementById("place-input");
  if (!inputEl) return;

  const searchBox = inputEl.parentNode;
  resultsContainer = document.createElement("div");
  resultsContainer.className = "autocomplete-results glass";
  searchBox.appendChild(resultsContainer);

  autocompleteService = new google.maps.places.AutocompleteService();
  placesService = new google.maps.places.PlacesService(document.createElement("div"));

  // Ricerca dinamica
  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim();
    resultsContainer.innerHTML = "";
    if (!q) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      getPredictions(q);
    }, 250);
  });

  document.addEventListener("click", (e) => {
    if (!resultsContainer.contains(e.target) && e.target !== inputEl) {
      resultsContainer.innerHTML = "";
    }
  });

  console.log("✅ Google Places inizializzato correttamente");
}

function getPredictions(query) {
  if (!autocompleteService) return;
  autocompleteService.getPlacePredictions(
    {
      input: query,
      types: ["establishment"],
      componentRestrictions: { country: "it" },
    },
    (predictions, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions?.length) {
        resultsContainer.innerHTML = "<div class='autocomplete-item muted'>Nessun risultato</div>";
        return;
      }
      renderPredictions(predictions.slice(0, 8));
    }
  );
}

function renderPredictions(list) {
  resultsContainer.innerHTML = "";
  list.forEach((p) => {
    const item = document.createElement("div");
    item.className = "autocomplete-item";
    item.textContent = p.description;
    item.addEventListener("click", () => selectPlace(p.place_id, p.description));
    resultsContainer.appendChild(item);
  });
}

function selectPlace(placeId, description) {
  resultsContainer.innerHTML = "";
  if (description) inputEl.value = description;

  placesService.getDetails(
    {
      placeId,
      fields: ["name", "formatted_address", "rating", "user_ratings_total", "reviews", "url"],
    },
    (details, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !details) {
        showMessage("Impossibile recuperare i dettagli dell'attività.");
        return;
      }
      showPlace(details);
    }
  );
}

function showPlace(details) {
  const noRes = document.getElementById("no-results");
  const card = document.getElementById("place-card");
  const nameEl = document.getElementById("place-name");
  const addrEl = document.getElementById("place-address");
  const ratingEl = document.getElementById("place-rating");
  const reviewsDiv = document.getElementById("reviews-list");

  noRes.classList.add("hidden");
  card.classList.remove("hidden");

  nameEl.textContent = details.name || "";
  addrEl.textContent = details.formatted_address || "";
  ratingEl.innerHTML = details.rating
    ? `⭐ ${details.rating} (${details.user_ratings_total || 0} recensioni)`
    : "Nessuna valutazione";

  reviewsDiv.innerHTML = "";
  if (details.reviews?.length) {
    details.reviews.slice(0, 5).forEach((r) => {
      const el = document.createElement("div");
      el.className = "review";
      el.innerHTML = `
        <strong>${escapeHtml(r.author_name || "Utente Google")}</strong>
        <span class="muted">${r.relative_time_description || ""}</span>
        <p>${escapeHtml(r.text || "")}</p>
      `;
      reviewsDiv.appendChild(el);
    });
  } else {
    reviewsDiv.innerHTML = "<p class='muted'>Nessuna recensione disponibile.</p>";
  }

  if (details.url) {
    const link = document.createElement("a");
    link.href = details.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "maps-link glass";
    link.textContent = "🌍 Apri su Google Maps";
    reviewsDiv.appendChild(link);
  }

  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showMessage(msg) {
  const noRes = document.getElementById("no-results");
  const card = document.getElementById("place-card");
  card.classList.add("hidden");
  noRes.classList.remove("hidden");
  noRes.innerHTML = `<p>${escapeHtml(msg)}</p>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.initApp = initApp;
