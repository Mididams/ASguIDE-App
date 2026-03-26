import { supabaseClient } from "./config.js";

async function fetchCategoriesMap() {
  const { data, error } = await supabaseClient
    .from("categories")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((item) => [item.id, item.name]));
}

async function fetchCards() {
  const { data, error } = await supabaseClient
    .from("cards")
    .select("id, title, content, category_id")
    .order("title", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

function truncateText(text, maxLength = 160) {
  if (!text) {
    return "Aucun contenu disponible.";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

export async function renderCardsView(container) {
  container.innerHTML = '<p class="muted">Chargement des medocs d\'urgence...</p>';

  try {
    const [cards, categoriesMap] = await Promise.all([fetchCards(), fetchCategoriesMap()]);
    let selectedCardId = cards[0]?.id ?? null;

    const render = () => {
      const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;

      container.innerHTML = `
        <div class="stack emergency-view">
          <div class="info-card emergency-hero">
            <p class="section-kicker">Medocs d'urgence</p>
            <strong>Ecran dedie aux fiches prioritaires</strong>
            <p class="muted">Cette vue reste separee pour accueillir ensuite des fiches plus visuelles et des reperes couleur.</p>
          </div>

          <div class="two-columns">
            <div class="list-panel">
              <h3>Fiches disponibles</h3>
            ${
              cards.length
                ? cards
                    .map(
                      (card) => `
                        <button class="list-button ${card.id === selectedCardId ? "is-selected" : ""}" type="button" data-card-id="${card.id}">
                          <strong>${card.title}</strong>
                          <small>${categoriesMap.get(card.category_id) ?? "Sans catégorie"}</small>
                        </button>
                      `
                    )
                    .join("")
                : '<p class="empty-state">Aucune fiche médicament disponible.</p>'
            }
            </div>

            <div class="detail-panel">
              ${
                selectedCard
                  ? `
                    <div class="stack">
                      <div class="info-card emergency-detail-card">
                        <p class="section-kicker">Fiche d'urgence</p>
                        <strong>${selectedCard.title}</strong>
                        <p class="muted">Categorie : ${categoriesMap.get(selectedCard.category_id) ?? "Sans categorie"}</p>
                      </div>
                      <div class="detail-body">${selectedCard.content || "Contenu non renseigne."}</div>
                    </div>
                  `
                  : '<p class="empty-state">Selectionnez une fiche pour afficher son detail.</p>'
              }
            </div>
          </div>

          ${
            cards.length
              ? `
                <div class="stack">
                  <h3>Vue cartes</h3>
                  <div class="card-grid">
                    ${cards
                      .map(
                        (card) => `
                          <article class="med-card emergency-card-preview">
                            <p class="card-tag">${categoriesMap.get(card.category_id) ?? "Sans categorie"}</p>
                            <h4>${card.title}</h4>
                            <p>${truncateText(card.content)}</p>
                          </article>
                        `
                      )
                      .join("")}
                  </div>
                </div>
              `
              : ""
          }
        </div>
      `;

      container.querySelectorAll("[data-card-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedCardId = Number(button.dataset.cardId);
          render();
        });
      });
    };

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger les medocs d\'urgence.</p>';
  }
}
