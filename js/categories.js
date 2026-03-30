import { supabaseClient } from "./config.js";
import {
  createOpenDocumentUrl,
  getResourceOpenMode
} from "./uploads.js";
import {
  getFavoriteIds,
  initFavorites,
  toggleFavoriteResource
} from "./favorites.js";

const CATEGORY_ORDER_STORAGE_KEY = "asguide.categoryOrderPreferences";
const RESOURCE_ORDER_STORAGE_KEY = "asguide.resourceOrderPreferences";

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

async function getCurrentUserId() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Impossible de lire la session active pour l'ordre des categories.", error);
    return "anonymous";
  }

  return data.session?.user?.id ?? "anonymous";
}

function readCategoryOrderPreferences() {
  try {
    const rawValue = window.localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Impossible de lire les preferences de tri des categories.", error);
    return {};
  }
}

function writeCategoryOrderPreferences(preferences) {
  try {
    window.localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.error("Impossible d'enregistrer les preferences de tri des categories.", error);
  }
}

function readResourceOrderPreferences() {
  try {
    const rawValue = window.localStorage.getItem(RESOURCE_ORDER_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Impossible de lire les preferences de tri des documents.", error);
    return {};
  }
}

function writeResourceOrderPreferences(preferences) {
  try {
    window.localStorage.setItem(RESOURCE_ORDER_STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.error("Impossible d'enregistrer les preferences de tri des documents.", error);
  }
}

export function getCategoryOrderScopeKey({ userId, categoryType, parentId = null }) {
  return `${String(userId || "anonymous")}::${normalizeText(categoryType) || "all"}::${parentId == null ? "root" : String(parentId)}`;
}

export function applyStoredOrder(items, preferences, scopeKey) {
  const preferredOrder = Array.isArray(preferences?.[scopeKey]) ? preferences[scopeKey].map(String) : [];

  if (!preferredOrder.length) {
    return [...items];
  }

  const orderIndex = new Map(preferredOrder.map((id, index) => [String(id), index]));

  return [...items].sort((a, b) => {
    const aIndex = orderIndex.has(String(a.id)) ? orderIndex.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
    const bIndex = orderIndex.has(String(b.id)) ? orderIndex.get(String(b.id)) : Number.MAX_SAFE_INTEGER;

    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }

    return compareBySortOrder(a, b);
  });
}

function saveStoredOrder(preferences, scopeKey, orderedIds) {
  return {
    ...preferences,
    [scopeKey]: orderedIds.map((id) => String(id))
  };
}

function getResourceOrderScopeKey({ userId, categoryId }) {
  return `${String(userId || "anonymous")}::${String(categoryId || "uncategorized")}`;
}

function applyStoredResourceOrder(items, preferences, scopeKey) {
  const preferredOrder = Array.isArray(preferences?.[scopeKey]) ? preferences[scopeKey].map(String) : [];

  if (!preferredOrder.length) {
    return [...items];
  }

  const orderIndex = new Map(preferredOrder.map((id, index) => [String(id), index]));

  return [...items].sort((a, b) => {
    const aIndex = orderIndex.has(String(a.id)) ? orderIndex.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
    const bIndex = orderIndex.has(String(b.id)) ? orderIndex.get(String(b.id)) : Number.MAX_SAFE_INTEGER;

    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }

    return compareBySortOrder(a, b);
  });
}

function getUserScopedPreferences(preferences, userId) {
  const prefix = `${String(userId || "anonymous")}::`;

  return Object.fromEntries(
    Object.entries(preferences).filter(([key, value]) => key.startsWith(prefix) && Array.isArray(value))
  );
}

function getUserScopedResourcePreferences(preferences, userId) {
  const prefix = `${String(userId || "anonymous")}::`;

  return Object.fromEntries(
    Object.entries(preferences).filter(([key, value]) => key.startsWith(prefix) && Array.isArray(value))
  );
}

async function fetchRemoteCategoryOrderPreferences(userId) {
  if (!userId || userId === "anonymous") {
    return {};
  }

  const { data, error } = await supabaseClient
    .from("user_category_orders")
    .select("scope_key, ordered_category_ids")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return Object.fromEntries(
    (data ?? []).map((entry) => [
      String(entry.scope_key),
      Array.isArray(entry.ordered_category_ids) ? entry.ordered_category_ids.map(String) : []
    ])
  );
}

async function fetchRemoteResourceOrderPreferences(userId) {
  if (!userId || userId === "anonymous") {
    return {};
  }

  const { data, error } = await supabaseClient
    .from("user_resource_orders")
    .select("scope_key, ordered_resource_ids")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return Object.fromEntries(
    (data ?? []).map((entry) => [
      String(entry.scope_key),
      Array.isArray(entry.ordered_resource_ids) ? entry.ordered_resource_ids.map(String) : []
    ])
  );
}

async function syncLocalCategoryOrdersToRemote(userId, preferences) {
  if (!userId || userId === "anonymous") {
    return;
  }

  const scopedPreferences = getUserScopedPreferences(preferences, userId);
  const entries = Object.entries(scopedPreferences);

  if (!entries.length) {
    return;
  }

  const payload = entries.map(([scopeKey, orderedCategoryIds]) => {
    const [, categoryType = "all", parentScope = "root"] = scopeKey.split("::");

    return {
      user_id: userId,
      scope_key: scopeKey,
      category_type: categoryType,
      parent_id: parentScope === "root" ? null : parentScope,
      ordered_category_ids: orderedCategoryIds,
      updated_at: new Date().toISOString()
    };
  });

  const { error } = await supabaseClient
    .from("user_category_orders")
    .upsert(payload, { onConflict: "user_id,scope_key" });

  if (error) {
    throw error;
  }
}

function buildDefaultCategoryOrderPreferences(userId, categories) {
  const categoryMap = buildCategoryMap(categories);
  const preferences = {};

  ["medicament", "protocole", "annuaire", "code"].forEach((categoryType) => {
    const rootScopeKey = getCategoryOrderScopeKey({
      userId,
      categoryType,
      parentId: null
    });
    const roots = getRootCategoriesForType(categories, categoryType, categoryMap);

    if (roots.length) {
      preferences[rootScopeKey] = roots.map((category) => String(category.id));
    }

    roots.forEach((rootCategory) => {
      const childScopeKey = getCategoryOrderScopeKey({
        userId,
        categoryType,
        parentId: rootCategory.id
      });
      const children = getDirectChildren(categories, rootCategory.id);

      if (children.length) {
        preferences[childScopeKey] = children.map((category) => String(category.id));
      }
    });
  });

  return preferences;
}

function buildDefaultResourceOrderPreferences(userId, resources) {
  const groupedResources = resources.reduce((accumulator, resource) => {
    const scopeKey = getResourceOrderScopeKey({
      userId,
      categoryId: resource.category_id
    });

    if (!accumulator[scopeKey]) {
      accumulator[scopeKey] = [];
    }

    accumulator[scopeKey].push(String(resource.id));
    return accumulator;
  }, {});

  return groupedResources;
}

async function syncLocalResourceOrdersToRemote(userId, preferences) {
  if (!userId || userId === "anonymous") {
    return;
  }

  const scopedPreferences = getUserScopedResourcePreferences(preferences, userId);
  const entries = Object.entries(scopedPreferences);

  if (!entries.length) {
    return;
  }

  const payload = entries.map(([scopeKey, orderedResourceIds]) => {
    const [, categoryId = "uncategorized"] = scopeKey.split("::");

    return {
      user_id: userId,
      scope_key: scopeKey,
      category_id: categoryId === "uncategorized" ? null : categoryId,
      ordered_resource_ids: orderedResourceIds,
      updated_at: new Date().toISOString()
    };
  });

  const { error } = await supabaseClient
    .from("user_resource_orders")
    .upsert(payload, { onConflict: "user_id,scope_key" });

  if (error) {
    throw error;
  }
}

export async function initCategoryOrderPreferences(userId, categories = []) {
  const localPreferences = readCategoryOrderPreferences();

  if (!userId || userId === "anonymous") {
    return localPreferences;
  }

  try {
    const remotePreferences = await fetchRemoteCategoryOrderPreferences(userId);

    if (!Object.keys(remotePreferences).length) {
      const seededPreferences = Object.keys(localPreferences).length
        ? localPreferences
        : buildDefaultCategoryOrderPreferences(userId, categories);

      writeCategoryOrderPreferences(seededPreferences);
      await syncLocalCategoryOrdersToRemote(userId, seededPreferences);
      return seededPreferences;
    }

    const mergedPreferences = {
      ...localPreferences,
      ...remotePreferences
    };

    writeCategoryOrderPreferences(mergedPreferences);
    return mergedPreferences;
  } catch (error) {
    console.error("Impossible de synchroniser l'ordre des categories.", error);
    return localPreferences;
  }
}

async function initResourceOrderPreferences(userId, resources) {
  const localPreferences = readResourceOrderPreferences();

  if (!userId || userId === "anonymous") {
    return localPreferences;
  }

  try {
    const remotePreferences = await fetchRemoteResourceOrderPreferences(userId);

    if (!Object.keys(remotePreferences).length) {
      const seededPreferences = Object.keys(localPreferences).length
        ? localPreferences
        : buildDefaultResourceOrderPreferences(userId, resources);

      writeResourceOrderPreferences(seededPreferences);
      await syncLocalResourceOrdersToRemote(userId, seededPreferences);
      return seededPreferences;
    }

    const mergedPreferences = {
      ...localPreferences,
      ...remotePreferences
    };

    writeResourceOrderPreferences(mergedPreferences);
    return mergedPreferences;
  } catch (error) {
    console.error("Impossible de synchroniser l'ordre des documents.", error);
    return localPreferences;
  }
}

async function persistCategoryOrderPreference(userId, preferences, scopeKey, categoryType, parentId, orderedIds) {
  const nextPreferences = saveStoredOrder(preferences, scopeKey, orderedIds);
  writeCategoryOrderPreferences(nextPreferences);

  if (!userId || userId === "anonymous") {
    return nextPreferences;
  }

  try {
    const { error } = await supabaseClient
      .from("user_category_orders")
      .upsert(
        {
          user_id: userId,
          scope_key: scopeKey,
          category_type: normalizeText(categoryType) || "all",
          parent_id: parentId == null ? null : String(parentId),
          ordered_category_ids: orderedIds.map((id) => String(id)),
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id,scope_key" }
      );

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error("Impossible d'enregistrer l'ordre des categories en ligne.", error);
  }

  return nextPreferences;
}

async function persistResourceOrderPreference(userId, preferences, scopeKey, categoryId, orderedIds) {
  const nextPreferences = saveStoredOrder(preferences, scopeKey, orderedIds);
  writeResourceOrderPreferences(nextPreferences);

  if (!userId || userId === "anonymous") {
    return nextPreferences;
  }

  try {
    const { error } = await supabaseClient
      .from("user_resource_orders")
      .upsert(
        {
          user_id: userId,
          scope_key: scopeKey,
          category_id: categoryId || null,
          ordered_resource_ids: orderedIds.map(String),
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id,scope_key" }
      );

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error("Impossible de synchroniser l'ordre des documents distants.", error);
  }

  return nextPreferences;
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

function getSectionLabel(categoryType) {
  switch (normalizeText(categoryType)) {
    case "medicament":
      return "Médicaments";
    case "protocole":
      return "Protocoles / Procédures";
    case "annuaire":
      return "Annuaires";
    case "code":
      return "Codes";
    default:
      return "Favoris";
  }
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
    helperText = null,
    listAttr = ""
  } = options;

  if (!items.length) {
    return `<p class="empty-state">${emptyMessage}</p>`;
  }

  return `
    <div class="category-list" ${listAttr}>
      ${items
        .map((item) => {
          const meta = helperText ? helperText(item) : "";

          return `
            <button
              class="category-item-button ${String(item.id) === String(selectedId) ? "is-selected" : ""}"
              type="button"
              ${buttonAttr}="${item.id}"
              data-category-sort-id="${item.id}"
            >
              <span class="category-drag-handle" aria-hidden="true">⋮⋮</span>
              <strong>${item.name}</strong>
              ${meta ? `<small>${meta}</small>` : ""}
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderDocuments(resources, favoriteIds, fallbackMessage, options = {}) {
  const {
    listAttr = "",
    sortable = false
  } = options;

  if (!resources.length) {
    return `<p class="empty-state">${fallbackMessage}</p>`;
  }

  return `
    <div class="document-list" ${listAttr}>
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
            <article class="document-card ${isFavorite ? "is-favorite" : ""}" ${sortable ? `data-resource-sort-id="${resource.id}"` : ""}>
              <div class="document-card-header">
                <div class="document-badge-group">
                  ${sortable ? '<span class="document-drag-handle" aria-hidden="true">⋮⋮</span>' : ""}
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
              ${resource.description ? `<p class="document-meta">${resource.description}</p>` : ""}

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
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        await toggleFavoriteResource(button.dataset.favoriteId);
        rerender();
      } catch (error) {
        console.error(error);
        window.alert("Impossible de mettre a jour les favoris pour le moment.");
      } finally {
        button.disabled = false;
      }
    });
  });
}

function enhanceMobileFocus(container) {
  const documentsColumn = container.querySelector(".category-column-documents");

  if (documentsColumn && window.innerWidth <= 960) {
    documentsColumn.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function focusDesktopSubcategoriesColumn(container) {
  if (isMobileCategoriesLayout()) {
    return;
  }

  const target = container.querySelector(".categories-columns .category-column:nth-child(2)");
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function alignDocumentsWithSelection(container) {
  if (isMobileCategoriesLayout()) {
    return;
  }

  const selectedSubcategoryButton = container.querySelector("[data-subcategory-id].is-selected");
  const selectedRootButton = container.querySelector("[data-root-id].is-selected");
  const referenceButton = selectedSubcategoryButton ?? selectedRootButton;
  const documentsBody = container.querySelector("#documentsStageBody");
  const documentCard = documentsBody?.querySelector(".document-card");

  if (!referenceButton || !documentsBody) {
    return;
  }

  const referenceRect = referenceButton.getBoundingClientRect();
  const bodyRect = documentsBody.getBoundingClientRect();
  const documentRect = documentCard?.getBoundingClientRect() ?? null;
  const referenceCenter = referenceRect.top + (referenceRect.height / 2);
  const documentCenterOffset = documentRect ? (documentRect.height / 2) : 0;
  const offset = Math.max(0, referenceCenter - bodyRect.top - documentCenterOffset);

  documentsBody.style.marginTop = `${offset}px`;
}

function focusMobileStageSheet(container) {
  if (!isMobileCategoriesLayout()) {
    return;
  }

  const sheet = container.querySelector(".mobile-stage-sheet");

  if (!sheet) {
    return;
  }

  requestAnimationFrame(() => {
    sheet.scrollTop = 0;
    sheet.focus({ preventScroll: true });
    sheet.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  });
}

function isMobileCategoriesLayout() {
  return window.innerWidth <= 960;
}

export async function renderFavoritesView(container) {
  return renderFavoritesViewWithOptions(container);
}

export async function renderFavoritesViewWithOptions(container, options = {}) {
  const {
    categoryType = "",
    title = "Favoris"
  } = options;

  container.innerHTML = '<p class="muted">Chargement des favoris...</p>';

  try {
    await initFavorites();
    const [resources, categories] = await Promise.all([fetchResources(), fetchCategories()]);
    const categoryMap = buildCategoryMap(categories);

    const render = () => {
      const refreshedFavorites = getFavoriteIds();
      const visibleResources = resources
        .filter((resource) => refreshedFavorites.includes(String(resource.id)))
        .filter((resource) => {
          if (!categoryType) {
            return true;
          }

          const resourceCategory = categoryMap.get(String(resource.category_id)) ?? null;
          return resolveCategoryType(resourceCategory, categoryMap) === normalizeText(categoryType);
        })
        .sort(compareBySortOrder);

      const emptyMessage = categoryType
        ? `Aucun favori enregistre pour la rubrique ${title}.`
        : "Aucun favori enregistre pour le moment.";
      const helperText = categoryType
        ? `Cette vue affiche uniquement les favoris de la rubrique ${title}. Le bouton Favoris du menu reste global.`
        : "Cette vue affiche tous vos favoris, toutes rubriques confondues.";
      const kickerLabel = categoryType ? `Favoris - ${title}` : "Favoris";

      container.innerHTML = `
        <div class="favorites-view stack">
          <div class="info-card">
            <p class="section-kicker">${kickerLabel}</p>
            <strong>${visibleResources.length} document(s) enregistre(s)</strong>
            <p class="muted">${helperText}</p>
          </div>

          ${renderDocuments(
            visibleResources,
            refreshedFavorites,
            emptyMessage
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
    emptyMessage = "Aucune categorie racine disponible.",
    initialRootId = null,
    initialSubcategoryId = null
  } = options;

  container.innerHTML = '<p class="muted">Chargement des categories...</p>';

  try {
    await initFavorites();
    const currentUserId = await getCurrentUserId();
    const [allCategories, allResources] = await Promise.all([fetchCategories(), fetchResources()]);
    let orderPreferences = await initCategoryOrderPreferences(currentUserId, allCategories);
    let resourceOrderPreferences = await initResourceOrderPreferences(currentUserId, allResources);
    const allCategoryMap = buildCategoryMap(allCategories);
    const categories = getFilteredCategories(allCategories, categoryType, allCategoryMap);
    const resources = getFilteredResources(allResources, categories);
    const categoryMap = buildCategoryMap(categories);
    const rootCategories = getRootCategoriesForType(categories, categoryType, categoryMap);

    let selectedRootId = initialRootId ?? rootCategories[0]?.id ?? null;
    let selectedSubcategoryId = initialSubcategoryId ?? null;
    let searchQuery = "";
    let mobilePanel = null;
    let pendingMobilePanelFocus = false;

    function render() {
      const favoriteIds = getFavoriteIds();
      const rootScopeKey = getCategoryOrderScopeKey({
        userId: currentUserId,
        categoryType,
        parentId: null
      });
      const orderedRootCategories = applyStoredOrder(rootCategories, orderPreferences, rootScopeKey);
      const normalized = normalizeSelection(categories, orderedRootCategories, selectedRootId, selectedSubcategoryId);

      selectedRootId = normalized.selectedRootId;
      selectedSubcategoryId = normalized.selectedSubcategoryId;

      const selectedRoot = normalized.selectedRoot;
      const subcategoryScopeKey = getCategoryOrderScopeKey({
        userId: currentUserId,
        categoryType,
        parentId: selectedRoot?.id ?? null
      });
      const subcategories = applyStoredOrder(normalized.subcategories, orderPreferences, subcategoryScopeKey);
      const selectedSubcategory =
        subcategories.find((subcategory) => String(subcategory.id) === String(selectedSubcategoryId)) ??
        normalized.selectedSubcategory;
      const sectionFavoriteCount = resources
        .filter((resource) => favoriteIds.includes(String(resource.id)))
        .filter((resource) => {
          const resourceCategory = categoryMap.get(String(resource.category_id)) ?? null;
          return resolveCategoryType(resourceCategory, categoryMap) === normalizeText(categoryType);
        })
        .length;
      const activeDocumentCategoryId = selectedSubcategory?.id ?? selectedRoot?.id ?? null;
      const documentScopeKey = getResourceOrderScopeKey({
        userId: currentUserId,
        categoryId: activeDocumentCategoryId
      });
      const documents = applyStoredResourceOrder(
        resources
          .filter((resource) => String(resource.category_id) === String(activeDocumentCategoryId))
          .sort(compareBySortOrder),
        resourceOrderPreferences,
        documentScopeKey
      );
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
            <div class="mobile-stage-sheet" role="dialog" aria-modal="true" aria-label="${mobilePanel === "subcategories" ? "Sous-categories" : "Documents"}" tabindex="-1">
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
                          listAttr: `data-category-sort-list="subcategories" data-category-sort-scope="${subcategoryScopeKey}"`,
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
                            : "Aucun document n'est lie a cette categorie.",
                        {
                          listAttr: `data-resource-sort-list="documents" data-resource-sort-scope="${documentScopeKey}" data-resource-category-id="${activeDocumentCategoryId ?? ""}"`,
                          sortable: true
                        }
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
              <button class="info-card compact-card compact-card-button" type="button" data-open-favorites-view>
                <p class="inline-label">Favoris</p>
                <strong>${sectionFavoriteCount}</strong>
              </button>
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
              ${renderSelectableList(orderedRootCategories, selectedRootId, {
                buttonAttr: "data-root-id",
                listAttr: `data-category-sort-list="roots" data-category-sort-scope="${rootScopeKey}"`,
                emptyMessage,
                helperText: (category) => {
                  const subcategoryCount = getDirectChildren(categories, category.id).length;
                  const documentCount = countDocumentsForCategory(resources, category.id);
                  return subcategoryCount
                    ? `${subcategoryCount} sous-categorie(s)`
                    : `${documentCount} document(s)`;
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
                      listAttr: `data-category-sort-list="subcategories" data-category-sort-scope="${subcategoryScopeKey}"`,
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
              <div id="documentsStageBody" class="documents-stage-body">
                <p class="column-context">${documentsTitle}</p>
                ${renderDocuments(
                  documents,
                  favoriteIds,
                  !hasRootCategories
                    ? "Aucun document disponible."
                    : selectedSubcategory
                    ? "Aucun document n'est lie a cette sous-categorie."
                    : "Aucun document n'est lie a cette categorie.",
                  {
                    listAttr: `data-resource-sort-list="documents" data-resource-sort-scope="${documentScopeKey}" data-resource-category-id="${activeDocumentCategoryId ?? ""}"`,
                    sortable: true
                  }
                )}
              </div>
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

      container.querySelector("#categorySearchInput")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) {
          return;
        }

        event.preventDefault();
        event.target.blur();
      });

      if (window.Sortable) {
        container.querySelectorAll("[data-category-sort-list]").forEach((list) => {
          if (list._sortableInstance) {
            list._sortableInstance.destroy();
          }

          list._sortableInstance = window.Sortable.create(list, {
            animation: 180,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            handle: ".category-drag-handle",
            draggable: "[data-category-sort-id]",
            ghostClass: "is-drag-ghost",
            chosenClass: "is-drag-chosen",
            dragClass: "is-drag-active",
            onEnd: async () => {
              const scopeKey = list.dataset.categorySortScope;
              const orderedIds = Array.from(list.querySelectorAll("[data-category-sort-id]"))
                .map((item) => item.dataset.categorySortId)
                .filter(Boolean);

              if (!scopeKey || !orderedIds.length) {
                return;
              }

              const parentScope = scopeKey.split("::")[2] ?? "root";
              orderPreferences = await persistCategoryOrderPreference(
                currentUserId,
                orderPreferences,
                scopeKey,
                categoryType,
                parentScope === "root" ? null : parentScope,
                orderedIds
              );
              render();
            }
          });
        });

        container.querySelectorAll("[data-resource-sort-list='documents']").forEach((list) => {
          if (list._sortableInstance) {
            list._sortableInstance.destroy();
          }

          list._sortableInstance = window.Sortable.create(list, {
            animation: 180,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            handle: ".document-drag-handle",
            draggable: "[data-resource-sort-id]",
            ghostClass: "is-drag-ghost",
            chosenClass: "is-drag-chosen",
            dragClass: "is-drag-active",
            onEnd: async () => {
              const scopeKey = list.dataset.resourceSortScope;
              const categoryId = list.dataset.resourceCategoryId || null;
              const orderedIds = Array.from(list.querySelectorAll("[data-resource-sort-id]"))
                .map((item) => item.dataset.resourceSortId)
                .filter(Boolean);

              if (!scopeKey || !orderedIds.length) {
                return;
              }

              resourceOrderPreferences = await persistResourceOrderPreference(
                currentUserId,
                resourceOrderPreferences,
                scopeKey,
                categoryId,
                orderedIds
              );
              render();
            }
          });
        });
      }

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
            pendingMobilePanelFocus = Boolean(mobilePanel);
            render();
          } else if (!selectedSubcategoryId) {
            focusDesktopSubcategoriesColumn(container);
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
            pendingMobilePanelFocus = Boolean(mobilePanel);
            render();
          } else {
            focusDesktopSubcategoriesColumn(container);
          }
        });
      });

      container.querySelectorAll("[data-subcategory-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedSubcategoryId = button.dataset.subcategoryId;
          mobilePanel = isMobileCategoriesLayout() ? "documents" : null;
          pendingMobilePanelFocus = Boolean(mobilePanel);
          render();
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

      container.querySelector("[data-open-favorites-view]")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("app:navigate", {
          detail: {
            view: "favorites",
            context: {
              categoryType,
              title: getSectionLabel(categoryType)
            }
          }
        }));
      });

      attachSharedDocumentEvents(container, render, resources);
      alignDocumentsWithSelection(container);

      if (pendingMobilePanelFocus) {
        pendingMobilePanelFocus = false;
        focusMobileStageSheet(container);
      }
    }

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger les categories et documents.</p>';
  }
}
