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

function createChildrenMap(categories) {
  const map = new Map();

  categories.forEach((category) => {
    const key = category.parent_id ?? "root";
    const siblings = map.get(key) ?? [];
    siblings.push(category);
    map.set(key, siblings);
  });

  return map;
}

function buildTreeFromParent(parentKey, byParent) {
  return (byParent.get(parentKey) ?? []).map((category) => ({
    ...category,
    children: buildTreeFromParent(category.id, byParent)
  }));
}

function findCategoryByName(categories, targetName) {
  return categories.find(
    (category) => category.name.trim().toLowerCase() === targetName.trim().toLowerCase()
  );
}

function collectCategoryIds(category, categoriesByParent) {
  const ids = [category.id];
  const children = categoriesByParent.get(category.id) ?? [];

  children.forEach((child) => {
    ids.push(...collectCategoryIds(child, categoriesByParent));
  });

  return ids;
}

function getResourceLabel(type) {
  return type ? String(type).toUpperCase() : "DOCUMENT";
}

function renderTree(nodes, selectedId) {
  if (!nodes.length) {
    return '<p class="empty-state">Aucune catégorie disponible.</p>';
  }

  return nodes
    .map(
      (node) => `
        <div class="tree-node">
          <button class="tree-button ${node.id === selectedId ? "is-selected" : ""}" data-category-id="${node.id}" type="button">
            <strong>${node.name}</strong>
            <small>${node.children.length} sous-catégorie(s)</small>
          </button>
          ${node.children.length ? `<div class="tree-children">${renderTree(node.children, selectedId)}</div>` : ""}
        </div>
      `
    )
    .join("");
}

function renderResources(resources) {
  if (!resources.length) {
    return '<p class="empty-state">Aucun document trouvé dans cette section.</p>';
  }

  return `
    <div class="resource-grid">
      ${resources
        .map(
          (resource) => `
            <article class="resource-card">
              <p class="card-tag">${getResourceLabel(resource.type)}</p>
              <h4>${resource.title}</h4>
              <p class="resource-meta">Catégorie ID : ${resource.category_id}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function buildCategoryDetails(category, categoriesByParent, resources) {
  const ids = collectCategoryIds(category, categoriesByParent);
  const relatedResources = resources.filter((resource) => ids.includes(resource.category_id));
  const childCategories = categoriesByParent.get(category.id) ?? [];

  return `
    <div class="stack">
      <div class="info-card">
        <p class="section-kicker">Catégorie sélectionnée</p>
        <strong>${category.name}</strong>
        <p class="muted">${childCategories.length} sous-catégorie(s) et ${relatedResources.length} document(s) disponibles.</p>
      </div>

      ${
        childCategories.length
          ? `
            <div class="list-panel">
              <h3>Sous-catégories</h3>
              <div class="resource-grid">
                ${childCategories
                  .map(
                    (child) => `
                      <article class="resource-card">
                        <h4>${child.name}</h4>
                        <p class="resource-meta">Sous-catégorie de ${category.name}</p>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }

      <div class="list-panel">
        <h3>Documents</h3>
        ${renderResources(relatedResources)}
      </div>
    </div>
  `;
}

export async function renderCategoriesView(container, options = {}) {
  const { rootCategoryName = null } = options;
  container.innerHTML = '<p class="muted">Chargement des catégories...</p>';

  try {
    const [categories, resources] = await Promise.all([fetchCategories(), fetchResources()]);
    const byParent = createChildrenMap(categories);

    let tree = buildTreeFromParent("root", byParent);
    let selectedCategory = tree[0] ?? null;

    if (rootCategoryName) {
      const rootCategory = findCategoryByName(categories, rootCategoryName);

      if (!rootCategory) {
        container.innerHTML = `<p class="feedback is-warning">La catégorie "${rootCategoryName}" est introuvable.</p>`;
        return;
      }

      tree = buildTreeFromParent(rootCategory.id, byParent);
      selectedCategory = tree[0] ?? rootCategory;
    }

    let selectedCategoryId = selectedCategory?.id ?? null;

    const render = () => {
      const activeCategory = categories.find((item) => item.id === selectedCategoryId) ?? null;

      container.innerHTML = `
        <div class="two-columns">
          <div class="list-panel">
            <h3>${rootCategoryName ? "Arborescence ciblée" : "Arborescence"}</h3>
            ${renderTree(tree, selectedCategoryId)}
          </div>
          <div class="detail-panel">
            ${
              activeCategory
                ? buildCategoryDetails(activeCategory, byParent, resources)
                : '<p class="empty-state">Sélectionnez une catégorie pour voir ses documents.</p>'
            }
          </div>
        </div>
      `;

      container.querySelectorAll("[data-category-id]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedCategoryId = Number(button.dataset.categoryId);
          render();
        });
      });
    };

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger les catégories et documents.</p>';
  }
}
