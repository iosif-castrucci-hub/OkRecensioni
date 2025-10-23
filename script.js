let autocompleteService;
let placesService;
let resultsContainer;

window.addEventListener("load", () => {
  const input = document.getElementById("place-input");
  resultsContainer = document.createElement("div");
  resultsContainer.className = "autocomplete-results glass";
  input.parentNode.appendChild(resultsContainer);

  if (window.google && google.maps && google.maps.places) {
    initializeGoogleServices();
  } else {
    // In caso di caricamento ritardato dello script Google
    setTimeout(initializeGoogleServices, 1000);
  }

  // Gestione digitazione in tempo reale
  input.addEventListener("input", onInputChange);
});

function initializeGoogleServices() {
  autocompleteService = new google.maps.places.AutocompleteService();
  placesService = new google.maps.places.PlacesService(document.createElement("div"));
}

function onInputChange(e) {
  const query = e.target.value.trim();
  resultsContainer.innerHTML = "";
  if (!query) return;

  autocompleteService.getPlacePredictions(
    {
      input: query,
      types: ["establishment"],
      componentRestrictions: { country: "it" },
    },
    displayPredictions
  );
}

function displayPredictions(predictions, status) {
  if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
    resultsContainer.innerHTML = "<p class='muted small'>Nessun risultato trovato.</p>";
    return;
  }

  resultsContainer.innerHTML = "";
  predictions.slice(0, 6).forEach((p) => {
    const item = document.createElement("div");
    item.className = "autocomplete-item";
    item.textContent = p.description;
    item.addEventListener("click", () => selectPlace(p.place_id));
    resultsContainer.appendChild(item);
  });
}

function selectPlace(placeId) {
  resultsContainer.innerHTML = "";
  const input = document.getElementById("place-input");
  input.blur();

  placesService.getDetails(
    {
      placeId,
      fields: ["name", "formatted_address", "rating", "user_ratings_total", "reviews", "url"],
    },
    (details, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !details) {
        showMessage("Nessuna attività trovata.");
        return;
      }
      showPlace(details);
    }
  );
}

function showPlace(details) {
  document.getElementById("no-results").classList.add("hidden");
  const card = document.getElementById("place-card");
  card.classList.remove("hidden");

  document.getElementById("place-name").textContent = details.name;
  document.getElementById("place-address").textContent = details.formatted_address;
  document.getElementById("place-rating").innerHTML = `⭐ ${details.rating} (${details.user_ratings_total} recensioni)`;

  const reviewsDiv = document.getElementById("reviews-list");
  reviewsDiv.innerHTML = "";

  if (details.reviews && details.reviews.length) {
    details.reviews.slice(0, 5).forEach((r) => {
      const el = document.createElement("div");
      el.classList.add("review");
      el.innerHTML = `
        <strong>${r.author_name}</strong><br>
        <span class="muted">${r.relative_time_description}</span>
        <p>"${r.text}"</p>
      `;
      reviewsDiv.appendChild(el);
    });
  } else {
    reviewsDiv.innerHTML = "<p class='muted'>Nessuna recensione disponibile.</p>";
  }

  // Aggiungi link Google Maps
  if (details.url) {
    const link = document.createElement("a");
    link.href = details.url;
    link.target = "_blank";
    link.className = "maps-link glass";
    link.textContent = "🌍 Apri su Google Maps";
    reviewsDiv.appendChild(link);
  }

  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showMessage(msg) {
  const noRes = document.getElementById("no-results");
  noRes.classList.remove("hidden");
  noRes.innerHTML = `<p>${msg}</p>`;
}
