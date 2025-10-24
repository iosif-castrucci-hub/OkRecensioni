let autocompleteService, placesService, inputEl, resultsContainer;

function initApp() {
  if (!google || !google.maps || !google.maps.places) return;
  autocompleteService = new google.maps.places.AutocompleteService();
  placesService = new google.maps.places.PlacesService(document.createElement("div"));
  inputEl = document.getElementById("place-input");
  resultsContainer = document.createElement("div");
  resultsContainer.className = "autocomplete-results glass";
  inputEl.parentNode.appendChild(resultsContainer);

  inputEl.addEventListener("input", handleInput);
  document.addEventListener("click", (e) => {
    if (!resultsContainer.contains(e.target) && e.target !== inputEl)
      resultsContainer.innerHTML = "";
  });
}

function handleInput() {
  const q = inputEl.value.trim();
  resultsContainer.innerHTML = "";
  if (!q) return;
  autocompleteService.getPlacePredictions(
    { input: q, types: ["establishment"], componentRestrictions: { country: "it" } },
    (predictions, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions?.length) return;
      renderPredictions(predictions.slice(0, 6));
    }
  );
}

function renderPredictions(list) {
  resultsContainer.innerHTML = "";
  list.forEach((p) => {
    const item = document.createElement("div");
    item.className = "autocomplete-item";
    item.textContent = p.description;
    item.onclick = () => selectPlace(p.place_id, p.description);
    resultsContainer.appendChild(item);
  });
}

function selectPlace(placeId, description) {
  resultsContainer.innerHTML = "";
  inputEl.value = description;
  placesService.getDetails(
    {
      placeId,
      fields: ["name", "formatted_address", "rating", "user_ratings_total", "reviews", "geometry"],
    },
    (details, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !details) {
        showMessage("Impossibile ottenere dettagli dell’attività.");
        return;
      }
      showPlace(details);
    }
  );
}

function showPlace(details) {
  const card = document.getElementById("place-card");
  const noRes = document.getElementById("no-results");
  const nameEl = document.getElementById("place-name");
  const addrEl = document.getElementById("place-address");
  const ratingEl = document.getElementById("place-rating");
  const reviewsDiv = document.getElementById("reviews-list");

  noRes.classList.add("hidden");
  card.classList.remove("hidden");

  nameEl.textContent = details.name;
  addrEl.textContent = details.formatted_address;
  ratingEl.innerHTML = details.rating
    ? `⭐ ${details.rating} (${details.user_ratings_total} recensioni)`
    : "Nessuna valutazione";

  const pos = Math.floor(Math.random() * 8) + 8; // posizione finta
  reviewsDiv.innerHTML = `
    <div class="ranking-card glass">
      <h3>📊 Il tuo posizionamento stimato</h3>
      <div class="rank-number">${pos}º</div>
      <p class="muted">Scopri chi ti sta superando nella zona:</p>
      <div id="leaderboard" class="leaderboard"></div>
      <button id="showReviewsBtn" class="show-reviews-btn">Mostra le recensioni</button>
      <button class="improve-btn" onclick="window.location.href='migliora.html'">💪 Migliora le tue recensioni ora</button>
    </div>
  `;

  loadNearbyCompetitors(details);

  document.getElementById("showReviewsBtn").onclick = () =>
    renderReviews(details, reviewsDiv);
}

function loadNearbyCompetitors(details) {
  const leaderboard = document.getElementById("leaderboard");
  leaderboard.innerHTML = "<p class='muted'>Caricamento attività vicine...</p>";

  if (!details.geometry?.location) {
    leaderboard.innerHTML = "<p class='muted'>Posizione non disponibile.</p>";
    return;
  }

  const request = {
    location: details.geometry.location,
    radius: 2000, // 2 km intorno
    type: ["restaurant", "bar", "cafe", "food"],
  };

  placesService.nearbySearch(request, (results, status) => {
    if (status !== google.maps.places.PlacesServiceStatus.OK || !results?.length) {
      leaderboard.innerHTML = "<p class='muted'>Nessun concorrente trovato.</p>";
      return;
    }

    const nearby = results
      .filter((r) => r.name !== details.name && r.rating)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 7);

    leaderboard.innerHTML = `<h4 class="leaderboard-title">🏆 Attività più visibili nella tua zona</h4>` +
      nearby
        .map(
          (c) => `
          <div class="competitor-card glass">
            <div class="competitor-info">
              <div class="competitor-name">${escapeHtml(c.name)}</div>
              <div class="competitor-meta">
                ⭐ ${c.rating.toFixed(1)} · ${c.user_ratings_total || 0} recensioni
              </div>
            </div>
          </div>`
        )
        .join("");
  });
}

function renderReviews(details, container) {
  container.innerHTML = "";
  if (!details.reviews?.length) {
    container.innerHTML = "<p class='muted'>Nessuna recensione disponibile.</p>";
    return;
  }
  details.reviews.slice(0, 5).forEach((r) => {
    const div = document.createElement("div");
    div.className = "review";
    div.innerHTML = `
      <strong>${escapeHtml(r.author_name)}</strong>
      <span class="muted">${r.relative_time_description || ""}</span>
      <p>${escapeHtml(r.text)}</p>
    `;
    container.appendChild(div);
  });
}

function showMessage(msg) {
  const card = document.getElementById("place-card");
  const noRes = document.getElementById("no-results");
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
