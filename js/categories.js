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

function findCategoryByName(categories, targetName) {
  return categories.find(
    (category) => normalizeText(category.name) === normalizeText(targetName)
  );
}

function getDirectChildren(categories, parentId) {
  return categories
    .filter((category) => String(category.parent_id) === String(parentId))
    .sort(compareBySortOrder);
}

function getRootCategories(categories, rootCategoryName) {
  if (!rootCategoryName) {
    return categories.filter((category) => category.parent_id == null).sort(compareBySortOrder);
  }

  const namedRoot = findCategoryByName(categories, rootCategoryName);

  if (!namedRoot) {
    return { namedRoot: null, rootCategories: [] };
  }

  const children = getDirectChildren(categories, namedRoot.id);

  return {
    namedRoot,
    rootCategories: children.length ? children : [namedRoot]
  };
}

function buildCategoryMap(categories) {
  return new Map(categories.map((category) => [String(category.id), category]));
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
    return "Aucune catégorie sélectionnée";
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
      kind: "category",
      label: category.name,
      meta: "Catégorie racine",
      rootId: category.id,
      subcategoryId: null
    }));

  const subcategoryResults = categories
    .filter((category) => category.parent_id != null && normalizeText(category.name).includes(normalizedQuery))
    .filter((category) => rootIdSet.has(String(category.parent_id)))
    .map((category) => ({
      id: `subcategory-${category.id}`,
      kind: "subcategory",
      label: category.name,
      meta: `Sous-catégorie de ${categoryMap.get(String(category.parent_id))?.name ?? "Catégorie inconnue"}`,
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
        : category?.name ?? "Non classé";

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
          <h3>Résultats</h3>
        </div>
        <span class="pill is-user">${results.length} résultat(s)</span>
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
          : `<p class="empty-state">Aucun résultat pour "${query}".</p>`
      }
    </section>
  `;
}

function attachSharedDocumentEvents(container, rerender, resources) {
  container.querySelectorAll("[data-open-resource-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const resourceId = button.dataset.openResourceId;
      const targetResource = resources.find((item) => String(item.id) === String(resourceId));

      button.disabled = true;
      const initialLabel = button.textContent;
      button.textContent = "Ouverture...";

      try {
        const openUrl = await createOpenDocumentUrl(targetResource);

        if (!openUrl) {
          throw new Error("Aucun lien exploitable pour ce document.");
        }

        window.open(openUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        console.error(error);
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
            <strong>${visibleResources.length} document(s) enregistré(s)</strong>
            <p class="muted">Les favoris sont stockés localement dans ce navigateur.</p>
          </div>

          ${renderDocuments(
            visibleResources,
            refreshedFavorites,
            "Aucun favori enregistré pour le moment."
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
  const { rootCategoryName = null } = options;
  container.innerHTML = '<p class="muted">Chargement des catégories...</p>';

  try {
    const [categories, resources] = await Promise.all([fetchCategories(), fetchResources()]);
    const categoryMap = buildCategoryMap(categories);

    const rootResult = rootCategoryName
      ? getRootCategories(categories, rootCategoryName)
      : { namedRoot: null, rootCategories: getRootCategories(categories) };

    if (rootCategoryName && !rootResult.namedRoot) {
      container.innerHTML = `<p class="feedback is-warning">La catégorie "${rootCategoryName}" est introuvable.</p>`;
      return;
    }

    const rootCategories = rootResult.rootCategories;

    if (!rootCategories.length) {
      container.innerHTML = '<p class="empty-state">Aucune catégorie racine disponible.</p>';
      return;
    }

    let selectedRootId = rootCategories[0].id;
    let selectedSubcategoryId = null;
    let searchQuery = "";

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
      const documentsTitle = selectedSubcategory
        ? `Documents de ${selectedSubcategory.name}`
        : selectedRoot
          ? `Documents de ${selectedRoot.name}`
          : "Documents";

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
                  placeholder="Rechercher une catégorie, sous-catégorie ou un document..."
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
            <div class="info-card">
              <p class="section-kicker">Navigation rapide</p>
              <strong>${breadcrumb}</strong>
              <p class="muted">
                ${rootCategories.length} catégorie(s), ${subcategories.length} sous-catégorie(s), ${documents.length} document(s).
              </p>
            </div>
          </div>

          <div class="categories-columns">
            <section class="category-column">
              <div class="category-column-header">
                <p class="section-kicker">Étape 1</p>
                <h3>Catégories</h3>
              </div>
              ${renderSelectableList(rootCategories, selectedRootId, {
                buttonAttr: "data-root-id",
                emptyMessage: "Aucune catégorie racine disponible.",
                helperText: (category) => {
                  const subcategoryCount = getDirectChildren(categories, category.id).length;
                  const documentCount = countDocumentsForCategory(resources, category.id);
                  return `${subcategoryCount} sous-catégorie(s) • ${documentCount} document(s)`;
                }
              })}
            </section>

            <section class="category-column">
              <div class="category-column-header">
                <p class="section-kicker">Étape 2</p>
                <h3>Sous-catégories</h3>
              </div>
              ${
                subcategories.length
                  ? renderSelectableList(subcategories, selectedSubcategoryId, {
                      buttonAttr: "data-subcategory-id",
                      emptyMessage: "Aucune sous-catégorie disponible.",
                      helperText: (subcategory) => `${countDocumentsForCategory(resources, subcategory.id)} document(s)`
                    })
                  : `
                    <div class="empty-panel">
                      <p class="empty-state">Aucune sous-catégorie pour cette catégorie.</p>
                      <p class="muted">Les documents affichés à droite sont donc ceux liés directement à la catégorie sélectionnée.</p>
                    </div>
                  `
              }
            </section>

            <section class="category-column category-column-documents">
              <div class="category-column-header">
                <p class="section-kicker">Étape 3</p>
                <h3>Documents</h3>
              </div>
              <p class="column-context">${documentsTitle}</p>
              ${renderDocuments(
                documents,
                favoriteIds,
                selectedSubcategory
                  ? "Aucun document n'est lié à cette sous-catégorie."
                  : "Aucun document n'est lié à cette catégorie."
              )}
            </section>
          </div>
        </div>
      `;

      container.querySelector("#categorySearchInput")?.addEventListener("input", (event) => {
        searchQuery = event.target.value;
        render();
      });

      container.querySelectorAll("[data-search-root-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedRootId = button.dataset.searchRootId;
          selectedSubcategoryId = button.dataset.searchSubcategoryId || null;
          searchQuery = "";
          render();
          enhanceMobileFocus(container);
        });
      });

      container.querySelectorAll("[data-root-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedRootId = button.dataset.rootId;
          selectedSubcategoryId = null;
          render();
          enhanceMobileFocus(container);
        });
      });

      container.querySelectorAll("[data-subcategory-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedSubcategoryId = button.dataset.subcategoryId;
          render();
          enhanceMobileFocus(container);
        });
      });

      attachSharedDocumentEvents(container, render, resources);
    }

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger les catégories et documents.</p>';
  }
}
