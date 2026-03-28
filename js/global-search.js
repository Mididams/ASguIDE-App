import { supabaseClient } from "./config.js";
import { createOpenDocumentUrl } from "./uploads.js";

const VIEW_LABELS = {
  medications: "Medicaments",
  protocols: "Protocoles / Procedures",
  directories: "Annuaires",
  codes: "Codes"
};

const TYPE_TO_VIEW = {
  medicament: "medications",
  protocole: "protocols",
  annuaire: "directories",
  code: "codes"
};

let catalogPromise = null;

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function compareBySortOrder(a, b) {
  const aOrder = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
  const bOrder = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;

  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  return normalizeText(a?.name ?? a?.title).localeCompare(normalizeText(b?.name ?? b?.title));
}

function inferTypeFromName(name) {
  const normalizedName = normalizeText(name);

  if (normalizedName === "medicaments" || normalizedName === "medicament") return "medicament";
  if (normalizedName === "annuaires" || normalizedName === "annuaire") return "annuaire";
  if (normalizedName === "codes" || normalizedName === "code") return "code";
  if (normalizedName === "protocoles et procedures" || normalizedName === "protocoles" || normalizedName === "protocoles/procedures") {
    return "protocole";
  }

  return null;
}

function buildCategoryMap(categories) {
  return new Map(categories.map((category) => [String(category.id), category]));
}

function resolveCategoryType(category, categoryMap) {
  if (!category) {
    return "";
  }

  if (category.type) {
    return normalizeText(category.type);
  }

  let currentCategory = category;

  while (currentCategory) {
    const inferredType = inferTypeFromName(currentCategory.name);

    if (inferredType) {
      return inferredType;
    }

    if (!currentCategory.parent_id) {
      return "";
    }

    currentCategory = categoryMap.get(String(currentCategory.parent_id)) ?? null;
  }

  return "";
}

function resolveRootCategory(category, categoryMap) {
  let currentCategory = category ?? null;

  while (currentCategory?.parent_id) {
    currentCategory = categoryMap.get(String(currentCategory.parent_id)) ?? null;
  }

  return currentCategory ?? null;
}

function getLocationLabel(category, rootCategory) {
  if (!category) {
    return "Non classe";
  }

  if (rootCategory && String(rootCategory.id) !== String(category.id)) {
    return `${rootCategory.name} > ${category.name}`;
  }

  return category.name;
}

function getQueryScore(value, query) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (normalizedValue === query) {
    return 0;
  }

  if (normalizedValue.startsWith(query)) {
    return 1;
  }

  if (normalizedValue.includes(query)) {
    return 2;
  }

  return Number.MAX_SAFE_INTEGER;
}

async function fetchSearchCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [categoriesResult, resourcesResult] = await Promise.all([
        supabaseClient.from("categories").select("*"),
        supabaseClient.from("resources").select("*")
      ]);

      if (categoriesResult.error) {
        throw categoriesResult.error;
      }

      if (resourcesResult.error) {
        throw resourcesResult.error;
      }

      return {
        categories: (categoriesResult.data ?? []).sort(compareBySortOrder),
        resources: (resourcesResult.data ?? []).sort(compareBySortOrder)
      };
    })();
  }

  return catalogPromise;
}

function buildGlobalResults(query, categories, resources) {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return [];
  }

  const categoryMap = buildCategoryMap(categories);

  const categoryResults = categories
    .map((category) => {
      const rootCategory = resolveRootCategory(category, categoryMap);
      const categoryType = resolveCategoryType(category, categoryMap);
      const viewId = TYPE_TO_VIEW[categoryType] ?? "";
      const labelScore = getQueryScore(category.name, normalizedQuery);

      if (!viewId || labelScore === Number.MAX_SAFE_INTEGER) {
        return null;
      }

      return {
        id: `category-${category.id}`,
        action: "navigate",
        kind: category.parent_id ? "Sous-categorie" : "Categorie",
        label: category.name,
        meta: `${VIEW_LABELS[viewId] ?? "Rubrique"} • ${getLocationLabel(category, rootCategory)}`,
        viewId,
        rootId: rootCategory?.id ?? category.id,
        subcategoryId: category.parent_id ? category.id : null,
        score: labelScore
      };
    })
    .filter(Boolean);

  const resourceResults = resources
    .map((resource) => {
      const category = categoryMap.get(String(resource.category_id)) ?? null;
      const rootCategory = resolveRootCategory(category, categoryMap);
      const categoryType = resolveCategoryType(category, categoryMap);
      const viewId = TYPE_TO_VIEW[categoryType] ?? "";

      const titleScore = getQueryScore(resource.title, normalizedQuery);
      const descriptionScore = getQueryScore(resource.description, normalizedQuery) + 1;
      const categoryScore = getQueryScore(getLocationLabel(category, rootCategory), normalizedQuery) + 2;
      const score = Math.min(titleScore, descriptionScore, categoryScore);

      if (!viewId || score === Number.MAX_SAFE_INTEGER) {
        return null;
      }

      return {
        id: `resource-${resource.id}`,
        action: "open",
        kind: "Document",
        label: resource.title,
        meta: `${VIEW_LABELS[viewId] ?? "Rubrique"} • ${getLocationLabel(category, rootCategory)}`,
        resourceId: resource.id,
        score
      };
    })
    .filter(Boolean);

  return [...categoryResults, ...resourceResults]
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }

      return normalizeText(a.label).localeCompare(normalizeText(b.label));
    })
    .slice(0, 50);
}

function renderResults(results, query) {
  if (!query.trim()) {
    return `
      <div class="empty-panel">
        <p class="empty-state">Lance une recherche globale pour parcourir tout le contenu.</p>
        <p class="muted">Exemples : amiodarone, AVC, annuaire, douleur, protocole.</p>
      </div>
    `;
  }

  if (!results.length) {
    return `<p class="empty-state">Aucun resultat pour "${query}".</p>`;
  }

  return `
    <div class="search-results-list">
      ${results
        .map((result) => {
          if (result.action === "navigate") {
            return `
              <button
                class="search-result-card"
                type="button"
                data-global-nav-view="${result.viewId}"
                data-global-root-id="${result.rootId ?? ""}"
                data-global-subcategory-id="${result.subcategoryId ?? ""}"
              >
                <span class="search-result-kind">${result.kind}</span>
                <strong>${result.label}</strong>
                <small>${result.meta}</small>
              </button>
            `;
          }

          return `
            <button
              class="search-result-card"
              type="button"
              data-global-open-resource-id="${result.resourceId}"
            >
              <span class="search-result-kind">${result.kind}</span>
              <strong>${result.label}</strong>
              <small>${result.meta}</small>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

export async function renderGlobalSearchView(container, options = {}) {
  const query = String(options.query ?? "").trim();

  container.innerHTML = '<p class="muted">Chargement de la recherche globale...</p>';

  try {
    const { categories, resources } = await fetchSearchCatalog();
    const results = buildGlobalResults(query, categories, resources);
    const resourceMap = new Map(resources.map((resource) => [String(resource.id), resource]));

    container.innerHTML = `
      <div class="stack">
        <div class="info-card">
          <p class="section-kicker">Recherche globale</p>
          <strong>${query ? `${results.length} resultat(s)` : "Recherche sur tout le contenu"}</strong>
          <p class="muted">La recherche parcourt les categories, documents, annuaires et codes.</p>
        </div>

        <section class="search-results-panel">
          <div class="category-toolbar-header">
            <div>
              <p class="section-kicker">Resultats</p>
              <h3>${query ? `Recherche : ${query}` : "Aucun mot-cle saisi"}</h3>
            </div>
            ${query ? `<span class="pill is-user">${results.length} resultat(s)</span>` : ""}
          </div>

          ${renderResults(results, query)}
        </section>
      </div>
    `;

    container.querySelectorAll("[data-global-nav-view]").forEach((button) => {
      button.addEventListener("click", () => {
        window.dispatchEvent(
          new CustomEvent("app:navigate", {
            detail: {
              view: button.dataset.globalNavView,
              context: {
                rootId: button.dataset.globalRootId || null,
                subcategoryId: button.dataset.globalSubcategoryId || null
              }
            }
          })
        );
      });
    });

    container.querySelectorAll("[data-global-open-resource-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const resource = resourceMap.get(String(button.dataset.globalOpenResourceId));

        if (!resource) {
          window.alert("Document introuvable.");
          return;
        }

        button.disabled = true;
        const pendingWindow = window.open("", "_blank");

        try {
          const openUrl = await createOpenDocumentUrl(resource);

          if (!openUrl) {
            throw new Error("Aucun lien exploitable pour ce document.");
          }

          if (pendingWindow) {
            pendingWindow.location.href = openUrl;
          } else {
            window.open(openUrl, "_blank", "noopener,noreferrer");
          }
        } catch (error) {
          console.error(error);
          pendingWindow?.close();
          window.alert("Ouverture impossible pour ce document.");
        } finally {
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger la recherche globale.</p>';
  }
}
