import { supabaseClient } from "./config.js";

async function fetchCategories() {
  const { data, error } = await supabaseClient
    .from("categories")
    .select("id, name, parent_id")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function fetchResources() {
  const { data, error } = await supabaseClient
    .from("resources")
    .select("id, title, type, category_id")
    .order("title", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

function findCategoryByName(categories, targetName) {
  return categories.find(
    (category) => category.name.trim().toLowerCase() === targetName.trim().toLowerCase()
  );
}

function getDirectChildren(categories, parentId) {
  return categories.filter((category) => category.parent_id === parentId);
}

function getRootCategories(categories, rootCategoryName) {
  if (!rootCategoryName) {
    return categories.filter((category) => category.parent_id == null);
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

function getResourceTypeLabel(type) {
  return type ? String(type).toUpperCase() : "DOCUMENT";
}

function countDocumentsForCategory(resources, categoryId) {
  return resources.filter((resource) => resource.category_id === categoryId).length;
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
              class="category-item-button ${item.id === selectedId ? "is-selected" : ""}"
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

function renderDocuments(resources, fallbackMessage) {
  if (!resources.length) {
    return `<p class="empty-state">${fallbackMessage}</p>`;
  }

  return `
    <div class="document-list">
      ${resources
        .map(
          (resource) => `
            <article class="document-card">
              <div class="document-card-header">
                <p class="card-tag">${getResourceTypeLabel(resource.type)}</p>
              </div>
              <h4>${resource.title}</h4>
              <p class="document-meta">Document prêt pour extension : type, description, lien, bouton ouvrir.</p>
            </article>
          `
        )
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
  const safeRoot = rootCategories.find((category) => category.id === selectedRootId) ?? rootCategories[0] ?? null;
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
    subcategories.find((subcategory) => subcategory.id === selectedSubcategoryId) ?? subcategories[0];

  return {
    selectedRoot: safeRoot,
    selectedSubcategory: safeSubcategory,
    subcategories,
    selectedRootId: safeRoot.id,
    selectedSubcategoryId: safeSubcategory.id
  };
}

export async function renderCategoriesView(container, options = {}) {
  const { rootCategoryName = null } = options;
  container.innerHTML = '<p class="muted">Chargement des catégories...</p>';

  try {
    const [categories, resources] = await Promise.all([fetchCategories(), fetchResources()]);

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

    function render() {
      const normalized = normalizeSelection(
        categories,
        rootCategories,
        selectedRootId,
        selectedSubcategoryId
      );

      selectedRootId = normalized.selectedRootId;
      selectedSubcategoryId = normalized.selectedSubcategoryId;

      const selectedRoot = normalized.selectedRoot;
      const subcategories = normalized.subcategories;
      const selectedSubcategory = normalized.selectedSubcategory;

      // If no subcategory exists, we still show documents attached directly to the root
      // category so the UI stays useful for mixed data models.
      const activeDocumentCategoryId = selectedSubcategory?.id ?? selectedRoot?.id ?? null;
      const documents = resources.filter((resource) => resource.category_id === activeDocumentCategoryId);
      const breadcrumb = buildBreadcrumb(selectedRoot, selectedSubcategory);
      const documentsTitle = selectedSubcategory
        ? `Documents de ${selectedSubcategory.name}`
        : selectedRoot
          ? `Documents de ${selectedRoot.name}`
          : "Documents";

      container.innerHTML = `
        <div class="categories-v2">
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
                helperText: (category) => `${getDirectChildren(categories, category.id).length} sous-catégorie(s)`
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
                selectedSubcategory
                  ? "Aucun document n'est lié à cette sous-catégorie."
                  : "Aucun document n'est lié à cette catégorie."
              )}
            </section>
          </div>
        </div>
      `;

      container.querySelectorAll("[data-root-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedRootId = button.dataset.rootId;
          selectedSubcategoryId = null;
          render();
        });
      });

      container.querySelectorAll("[data-subcategory-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedSubcategoryId = button.dataset.subcategoryId;
          render();
        });
      });
    }

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger les catégories et documents.</p>';
  }
}
