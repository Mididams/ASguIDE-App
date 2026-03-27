import { supabaseClient } from "./config.js";
import {
  createOpenDocumentUrl,
  getResourceOpenMode
} from "./uploads.js";

const FAVORITES_STORAGE_KEY = "asguide.favoriteResources";

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

async function fetchCategories() {
  const { data, error } = await supabaseClient
    .from("categories")
    .select("*");

  if (error) {
    throw error;
  }

  return (data ?? []).sort(compareBySortOrder);
}

async function fetchResources() {
  const { data, error } = await supabaseClient
    .from("resources")
    .select("*");

  if (error) {
    throw error;
  }

  return (data ?? []).sort(compareBySortOrder);
}

function getStoredFavoriteIds() {
  try {
    const rawValue = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((value) => String(value));
  } catch (error) {
    console.error("Impossible de lire les favoris locaux.", error);
    return [];
  }
}

function saveFavoriteIds(ids) {
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent("favorites:changed", { detail: { count: ids.length } }));
}

export function getFavoriteIds() {
  return getStoredFavoriteIds();
}

export function getFavoritesCount() {
  return getStoredFavoriteIds().length;
}

export function toggleFavoriteResource(resourceId) {
  const resourceKey = String(resourceId);
  const currentIds = getStoredFavoriteIds();
  const exists = currentIds.includes(resourceKey);
  const nextIds = exists
    ? currentIds.filter((id) => id !== resourceKey)
    : [...currentIds, resourceKey];

  saveFavoriteIds(nextIds);
  return !exists;
}

function buildCategoryMap(categories) {
  return new Map(categories.map((category) => [String(category.id), category]));
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

function resolveCategoryType(category, categoryMap) {
  if (!category) {
    return "";
  }

  if (category.type) {
    return normalizeText(category.type);
  }

  let currentCategory = category;

  while (currentCategory?.parent_id != null) {
    currentCategory = categoryMap.get(String(currentCategory.parent_id)) ?? null;

    if (!currentCategory) {
      break;
    }

    if (currentCategory.type) {
      return normalizeText(currentCategory.type);
    }
  }

  return inferTypeFromName(currentCategory?.name ?? category.name) ?? "protocole";
}

function getDirectChildren(categories, parentId) {
  return categories
    .filter((category) => String(category.parent_id) === String(parentId))
    .sort(compareBySortOrder);
}

function getRootCategoriesForType(categories, categoryType, categoryMap) {
  return categories
    .filter((category) => category.parent_id == null)
    .filter((category) => resolveCategoryType(category, categoryMap) === normalizeText(categoryType))
    .sort(compareBySortOrder);
}

function getFilteredCategories(categories, categoryType, categoryMap) {
  return categories
    .filter((category) => resolveCategoryType(category, categoryMap) === normalizeText(categoryType))
    .sort(compareBySortOrder);
}

function getFilteredResources(resources, filteredCategories) {
  const allowedCategoryIds = new Set(filteredCategories.map((category) => String(category.id)));

  return resources
    .filter((resource) => allowedCategoryIds.has(String(resource.category_id)))
    .sort(compareBySortOrder);
}

function getResourceTypeLabel(type) {
  return type ? String(type).toUpperCase() : "DOCUMENT";
}

function getResourceIcon(type) {
  const normalizedType = normalizeText(type);

  if (normalizedType.includes("pdf")) return "PDF";
  if (normalizedType.includes("image") || normalizedType.includes("jpg") || normalizedType.includes("png")) return "IMG";
  if (normalizedType.includes("word") || normalizedType.includes("doc")) return "DOC";
  if (normalizedType.includes("excel") || normalizedType.includes("xls")) return "XLS";
  if (normalizedType.includes("link") || normalizedType.includes("url")) return "WEB";
  return "DOC";
}

function countDocumentsForCategory(resources, categoryId) {
  return resources.filter((resource) => String(resource.category_id) === String(categoryId)).length;
}

function renderSelectableList(items, selectedId, options = {}) {
  const {
    buttonAttr,
    emptyMessage,
    helperText = null
  } = options;

  if (!items.length) {
    return `<p class="empty-state">${emptyMessage}</p>`;
  }

  return `
    <div class="category-list">
      ${items
        .map((item) => {
          const meta = helperText ? helperText(item) : "";

          return `
            <button
              class="category-item-button ${String(item.id) === String(selectedId) ? "is-selected" : ""}"
              type="button"
              ${buttonAttr}="${item.id}"
            >
              <strong>${item.name}</strong>
              ${meta ? `<small>${meta}</small>` : ""}
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderDocuments(resources, favoriteIds, fallbackMessage) {
  if (!resources.length) {
    return `<p class="empty-state">${fallbackMessage}</p>`;
  }

  return `
    <div class="document-list">
      ${resources
        .map((resource) => {
          const isFavorite = favoriteIds.includes(String(resource.id));
          const openMode = getResourceOpenMode(resource);
          const hasOpenAction = openMode !== "none";
          const actionLabel = openMode === "external"
            ? "Lien externe"
            : openMode === "signed"
              ? "Accès sécurisé"
              : "Lien non disponible";

          return `
            <article class="document-card ${isFavorite ? "is-favorite" : ""}">
              <div class="document-card-header">
                <div class="document-badge-group">
                  <span class="doc-icon">${getResourceIcon(resource.type)}</span>
                  <p class="card-tag">${getResourceTypeLabel(resource.type)}</p>
                </div>
                <button
                  class="favorite-toggle ${isFavorite ? "is-active" : ""}"
                  type="button"
                  data-favorite-id="${resource.id}"
                  aria-label="${isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}"
                >
                  ★
                </button>
              </div>

              <h4>${resource.title}</h4>
              <p class="document-meta">${resource.description || "Aucune description renseignée."}</p>

              <div class="document-actions">
                <button
                  class="button button-secondary button-small"
                  type="button"
                  ${hasOpenAction ? `data-open-resource-id="${resource.id}"` : "disabled"}
                >
                  Ouvrir
                </button>
                <span class="document-hint">${actionLabel}</span>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function buildBreadcrumb(rootCategory, subcategory) {
  if (!rootCategory) {
    return "Aucune categorie selectionnee";
  }

  if (!subcategory) {
    return rootCategory.name;
  }

  return `${rootCategory.name} > ${subcategory.name}`;
}

function normalizeSelection(categories, rootCategories, selectedRootId, selectedSubcategoryId) {
  const safeRoot = rootCategories.find((category) => String(category.id) === String(selectedRootId)) ?? rootCategories[0] ?? null;
  const subcategories = safeRoot ? getDirectChildren(categories, safeRoot.id) : [];

  if (!safeRoot) {
    return {
      selectedRoot: null,
      selectedSubcategory: null,
      subcategories,
      selectedRootId: null,
      selectedSubcategoryId: null
    };
  }

  if (!subcategories.length) {
    return {
      selectedRoot: safeRoot,
      selectedSubcategory: null,
      subcategories,
      selectedRootId: safeRoot.id,
      selectedSubcategoryId: null
    };
  }

  const safeSubcategory =
    subcategories.find((subcategory) => String(subcategory.id) === String(selectedSubcategoryId)) ?? subcategories[0];

  return {
    selectedRoot: safeRoot,
    selectedSubcategory: safeSubcategory,
    subcategories,
    selectedRootId: safeRoot.id,
    selectedSubcategoryId: safeSubcategory.id
  };
}

function buildSearchResults(query, categories, resources, rootCategories, categoryMap) {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return [];
  }

  const rootIdSet = new Set(rootCategories.map((category) => String(category.id)));

  const categoryResults = rootCategories
    .filter((category) => normalizeText(category.name).includes(normalizedQuery))
    .map((category) => ({
      id: `root-${category.id}`,
      kind: "categorie",
      label: category.name,
      meta: "Categorie racine",
      rootId: category.id,
      subcategoryId: null
    }));

  const subcategoryResults = categories
    .filter((category) => category.parent_id != null && normalizeText(category.name).includes(normalizedQuery))
    .filter((category) => rootIdSet.has(String(category.parent_id)))
    .map((category) => ({
      id: `subcategory-${category.id}`,
      kind: "sous-categorie",
      label: category.name,
      meta: `Sous-categorie de ${categoryMap.get(String(category.parent_id))?.name ?? "Categorie inconnue"}`,
      rootId: category.parent_id,
      subcategoryId: category.id
    }));

  const documentResults = resources
    .filter((resource) => normalizeText(resource.title).includes(normalizedQuery))
    .map((resource) => {
      const category = categoryMap.get(String(resource.category_id)) ?? null;
      const rootCategory = category?.parent_id != null
        ? categoryMap.get(String(category.parent_id)) ?? null
        : category;

      const rootId = rootCategory?.id ?? category?.id ?? null;
      const subcategoryId = category?.parent_id != null ? category.id : null;
      const location = rootCategory && category?.parent_id != null
        ? `${rootCategory.name} > ${category.name}`
        : category?.name ?? "Non classe";

      return {
        id: `resource-${resource.id}`,
        kind: "document",
        label: resource.title,
        meta: `Document - ${location}`,
        rootId,
        subcategoryId
      };
    })
    .filter((result) => result.rootId != null);

  return [...categoryResults, ...subcategoryResults, ...documentResults];
}

function renderSearchResults(results, query) {
  if (!query.trim()) {
    return "";
  }

  return `
    <section class="search-results-panel">
      <div class="category-toolbar-header">
        <div>
          <p class="section-kicker">Recherche</p>
          <h3>Resultats</h3>
        </div>
        <span class="pill is-user">${results.length} resultat(s)</span>
      </div>

      ${
        results.length
          ? `
            <div class="search-results-list">
              ${results
                .map(
                  (result) => `
                    <button
                      class="search-result-card"
                      type="button"
                      data-search-root-id="${result.rootId}"
                      data-search-subcategory-id="${result.subcategoryId ?? ""}"
                    >
                      <span class="search-result-kind">${result.kind}</span>
                      <strong>${result.label}</strong>
                      <small>${result.meta}</small>
                    </button>
                  `
                )
                .join("")}
            </div>
          `
          : `<p class="empty-state">Aucun resultat pour "${query}".</p>`
      }
    </section>
  `;
}

function attachSharedDocumentEvents(container, rerender, resources) {
  container.querySelectorAll("[data-open-resource-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const resourceId = button.dataset.openResourceId;
      const targetResource = resources.find((item) => String(item.id) === String(resourceId));
      const pendingWindow = isMobileCategoriesLayout()
        ? window.open("", "_blank")
        : null;

      button.disabled = true;
      const initialLabel = button.textContent;
      button.textContent = "Ouverture...";

      try {
        const openUrl = await createOpenDocumentUrl(targetResource);

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
        button.textContent = initialLabel;
      }
    });
  });

  container.querySelectorAll("[data-favorite-id]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleFavoriteResource(button.dataset.favoriteId);
      rerender();
    });
  });
}

function enhanceMobileFocus(container) {
  const documentsColumn = container.querySelector(".category-column-documents");

  if (documentsColumn && window.innerWidth <= 960) {
    documentsColumn.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function isMobileCategoriesLayout() {
  return window.innerWidth <= 960;
}

export async function renderFavoritesView(container) {
  container.innerHTML = '<p class="muted">Chargement des favoris...</p>';

  try {
    const resources = await fetchResources();

    const render = () => {
      const refreshedFavorites = getStoredFavoriteIds();
      const visibleResources = resources
        .filter((resource) => refreshedFavorites.includes(String(resource.id)))
        .sort(compareBySortOrder);

      container.innerHTML = `
        <div class="favorites-view stack">
          <div class="info-card">
            <p class="section-kicker">Favoris</p>
            <strong>${visibleResources.length} document(s) enregistre(s)</strong>
            <p class="muted">Les favoris sont stockes localement dans ce navigateur.</p>
          </div>

          ${renderDocuments(
            visibleResources,
            refreshedFavorites,
            "Aucun favori enregistre pour le moment."
          )}
        </div>
      `;

      attachSharedDocumentEvents(container, render, resources);
    };

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger les favoris.</p>';
  }
}

export async function renderCategoriesView(container, options = {}) {
  const {
    categoryType = "",
    emptyMessage = "Aucune categorie racine disponible."
  } = options;

  container.innerHTML = '<p class="muted">Chargement des categories...</p>';

  try {
    const [allCategories, allResources] = await Promise.all([fetchCategories(), fetchResources()]);
    const allCategoryMap = buildCategoryMap(allCategories);
    const categories = getFilteredCategories(allCategories, categoryType, allCategoryMap);
    const resources = getFilteredResources(allResources, categories);
    const categoryMap = buildCategoryMap(categories);
    const rootCategories = getRootCategoriesForType(categories, categoryType, categoryMap);

    let selectedRootId = rootCategories[0]?.id ?? null;
    let selectedSubcategoryId = null;
    let searchQuery = "";
    let mobilePanel = null;

    function render() {
      const favoriteIds = getStoredFavoriteIds();
      const normalized = normalizeSelection(categories, rootCategories, selectedRootId, selectedSubcategoryId);

      selectedRootId = normalized.selectedRootId;
      selectedSubcategoryId = normalized.selectedSubcategoryId;

      const selectedRoot = normalized.selectedRoot;
      const subcategories = normalized.subcategories;
      const selectedSubcategory = normalized.selectedSubcategory;
      const activeDocumentCategoryId = selectedSubcategory?.id ?? selectedRoot?.id ?? null;
      const documents = resources
        .filter((resource) => String(resource.category_id) === String(activeDocumentCategoryId))
        .sort(compareBySortOrder);
      const breadcrumb = buildBreadcrumb(selectedRoot, selectedSubcategory);
      const searchResults = buildSearchResults(searchQuery, categories, resources, rootCategories, categoryMap);
      const hasRootCategories = rootCategories.length > 0;
      const documentsTitle = selectedSubcategory
        ? `Documents de ${selectedSubcategory.name}`
        : selectedRoot
          ? `Documents de ${selectedRoot.name}`
          : "Aucun document selectionne";
      const mobilePanelMarkup = isMobileCategoriesLayout() && mobilePanel
        ? `
          <div class="mobile-stage-overlay" data-mobile-stage-close>
            <div class="mobile-stage-sheet" role="dialog" aria-modal="true" aria-label="${mobilePanel === "subcategories" ? "Sous-categories" : "Documents"}">
              <div class="mobile-stage-header">
                <button class="button button-secondary button-small" type="button" data-mobile-stage-back>
                  ${mobilePanel === "documents" && subcategories.length ? "Retour" : "Fermer"}
                </button>
                <strong>${mobilePanel === "subcategories" ? "Sous-categories" : "Documents"}</strong>
                <button class="button button-ghost button-small" type="button" data-mobile-stage-close-button>
                  Fermer
                </button>
              </div>
              <p class="mobile-stage-breadcrumb">${breadcrumb}</p>
              ${
                mobilePanel === "subcategories"
                  ? (
                    subcategories.length
                      ? renderSelectableList(subcategories, selectedSubcategoryId, {
                          buttonAttr: "data-subcategory-id",
                          emptyMessage: "Aucune sous-categorie disponible.",
                          helperText: (subcategory) => `${countDocumentsForCategory(resources, subcategory.id)} document(s)`
                        })
                      : `
                        <div class="empty-panel">
                          <p class="empty-state">${hasRootCategories ? "Aucune sous-categorie pour cette categorie." : "Aucune sous-categorie disponible."}</p>
                          <p class="muted">${hasRootCategories ? "Les documents sont disponibles dans l'etape suivante." : "Selectionnez une categorie des qu'elle sera disponible."}</p>
                        </div>
                      `
                  )
                  : `
                      <p class="column-context">${documentsTitle}</p>
                      ${renderDocuments(
                        documents,
                        favoriteIds,
                        !hasRootCategories
                          ? "Aucun document disponible."
                          : selectedSubcategory
                            ? "Aucun document n'est lie a cette sous-categorie."
                            : "Aucun document n'est lie a cette categorie."
                      )}
                    `
              }
            </div>
          </div>
        `
        : "";

      container.innerHTML = `
        <div class="categories-v2">
          <div class="category-toolbar">
            <div class="category-search">
              <label class="field">
                <span class="inline-label">Recherche rapide</span>
                <input
                  id="categorySearchInput"
                  class="search-input"
                  type="search"
                  placeholder="Rechercher une categorie, sous-categorie ou un document..."
                  value="${searchQuery}"
                >
              </label>
            </div>

            <div class="category-toolbar-stats">
              <div class="info-card compact-card">
                <p class="inline-label">Favoris</p>
                <strong>${favoriteIds.length}</strong>
              </div>
              <div class="info-card compact-card">
                <p class="inline-label">Documents</p>
                <strong>${documents.length}</strong>
              </div>
            </div>
          </div>

          ${renderSearchResults(searchResults, searchQuery)}

          <div class="categories-summary">
            <div class="info-card breadcrumb-card">
              <strong>${breadcrumb}</strong>
            </div>
          </div>

          <div class="categories-columns">
            <section class="category-column">
              <div class="category-column-header">
                <p class="section-kicker">Etape 1</p>
                <h3>Categories</h3>
              </div>
              ${renderSelectableList(rootCategories, selectedRootId, {
                buttonAttr: "data-root-id",
                emptyMessage,
                helperText: (category) => {
                  const subcategoryCount = getDirectChildren(categories, category.id).length;
                  const documentCount = countDocumentsForCategory(resources, category.id);
                  return `${subcategoryCount} sous-categorie(s) • ${documentCount} document(s)`;
                }
              })}
            </section>

            <section class="category-column">
              <div class="category-column-header">
                <p class="section-kicker">Etape 2</p>
                <h3>Sous-categories</h3>
              </div>
              ${
                subcategories.length
                  ? renderSelectableList(subcategories, selectedSubcategoryId, {
                      buttonAttr: "data-subcategory-id",
                      emptyMessage: "Aucune sous-categorie disponible.",
                      helperText: (subcategory) => `${countDocumentsForCategory(resources, subcategory.id)} document(s)`
                    })
                  : `
                    <div class="empty-panel">
                      <p class="empty-state">${hasRootCategories ? "Aucune sous-categorie pour cette categorie." : "Aucune sous-categorie disponible."}</p>
                      <p class="muted">${hasRootCategories ? "Les documents affiches a droite sont donc ceux lies directement a la categorie selectionnee." : "Selectionnez une categorie a l'etape 1 des qu'elle sera disponible."}</p>
                    </div>
                  `
              }
            </section>

            <section class="category-column category-column-documents">
              <div class="category-column-header">
                <p class="section-kicker">Etape 3</p>
                <h3>Documents</h3>
              </div>
              <p class="column-context">${documentsTitle}</p>
              ${renderDocuments(
                documents,
                favoriteIds,
                !hasRootCategories
                  ? "Aucun document disponible."
                  : selectedSubcategory
                  ? "Aucun document n'est lie a cette sous-categorie."
                  : "Aucun document n'est lie a cette categorie."
              )}
            </section>
          </div>
          ${mobilePanelMarkup}
        </div>
      `;

      container.querySelector("#categorySearchInput")?.addEventListener("input", (event) => {
        searchQuery = event.target.value;
        const cursorPosition = event.target.selectionStart ?? searchQuery.length;

        render();

        window.requestAnimationFrame(() => {
          const refreshedSearchInput = container.querySelector("#categorySearchInput");

          if (!refreshedSearchInput) {
            return;
          }

          refreshedSearchInput.focus();
          refreshedSearchInput.setSelectionRange(cursorPosition, cursorPosition);
        });
      });

      container.querySelectorAll("[data-search-root-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedRootId = button.dataset.searchRootId;
          selectedSubcategoryId = button.dataset.searchSubcategoryId || null;
          searchQuery = "";
          mobilePanel = isMobileCategoriesLayout()
            ? (selectedSubcategoryId ? "documents" : null)
            : null;
          render();

          if (isMobileCategoriesLayout()) {
            const refreshedSubcategories = selectedRootId ? getDirectChildren(categories, selectedRootId) : [];
            mobilePanel = selectedSubcategoryId ? "documents" : (refreshedSubcategories.length ? "subcategories" : "documents");
            render();
          } else {
            enhanceMobileFocus(container);
          }
        });
      });

      container.querySelectorAll("[data-root-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedRootId = button.dataset.rootId;
          selectedSubcategoryId = null;
          mobilePanel = null;
          render();

          if (isMobileCategoriesLayout()) {
            const refreshedSubcategories = selectedRootId ? getDirectChildren(categories, selectedRootId) : [];
            mobilePanel = refreshedSubcategories.length ? "subcategories" : "documents";
            render();
          } else {
            enhanceMobileFocus(container);
          }
        });
      });

      container.querySelectorAll("[data-subcategory-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedSubcategoryId = button.dataset.subcategoryId;
          mobilePanel = isMobileCategoriesLayout() ? "documents" : null;
          render();

          if (!isMobileCategoriesLayout()) {
            enhanceMobileFocus(container);
          }
        });
      });

      container.querySelector("[data-mobile-stage-close]")?.addEventListener("click", (event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        mobilePanel = null;
        render();
      });

      container.querySelector("[data-mobile-stage-close-button]")?.addEventListener("click", () => {
        mobilePanel = null;
        render();
      });

      container.querySelector("[data-mobile-stage-back]")?.addEventListener("click", () => {
        mobilePanel = mobilePanel === "documents" && subcategories.length ? "subcategories" : null;
        render();
      });

      attachSharedDocumentEvents(container, render, resources);
    }

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger les categories et documents.</p>';
  }
}
