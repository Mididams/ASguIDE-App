import { supabaseClient } from "./config.js";
import {
  applyStoredOrder,
  getCategoryOrderScopeKey,
  initCategoryOrderPreferences
} from "./categories.js";
import { getProfileApprovalState } from "./profiles.js";
import {
  deleteFileFromStorage,
  deleteResource,
  insertResource,
  updateResource,
  uploadFileToStorage
} from "./uploads.js";

const CATEGORY_TYPE_OPTIONS = [
  { value: "medicament", label: "Medicaments" },
  { value: "protocole", label: "Protocoles et procedures" },
  { value: "annuaire", label: "Annuaires" },
  { value: "code", label: "Codes" }
];

const ADMIN_CONTENT_SHORTCUTS = [
  ...CATEGORY_TYPE_OPTIONS,
  { value: "emergency", label: "Medocs d'urgence", disabled: true }
];

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

async function fetchProfiles() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, first_name, last_name, role, status, approved")
    .order("email", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
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

async function fetchCurrentUser() {
  const {
    data: { user },
    error
  } = await supabaseClient.auth.getUser();

  if (error) {
    throw error;
  }

  return user;
}

async function approveUser(profileId) {
  const { error } = await supabaseClient
    .from("profiles")
    .update({ approved: true, status: "approved" })
    .eq("id", profileId);

  if (error) {
    throw error;
  }
}

async function updateUserRole(profileId, role) {
  const normalizedRole = role === "admin" ? "admin" : "user";

  const { error } = await supabaseClient
    .from("profiles")
    .update({ role: normalizedRole })
    .eq("id", profileId);

  if (error) {
    throw error;
  }
}

async function deleteManagedUser(userId) {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  const { data, error } = await supabaseClient.functions.invoke("admin-delete-user", {
    body: { userId },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    const message = String(error.message ?? "");

    if (message.includes("Failed to send a request to the Edge Function")) {
      throw new Error(
        "La fonction Supabase `admin-delete-user` est indisponible. Verifiez qu'elle est bien deployee sur votre projet, puis redeployez-la si besoin."
      );
    }

    throw error;
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

async function createCategory(payload) {
  const { data, error } = await supabaseClient
    .from("categories")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function updateCategory(categoryId, payload) {
  const { data, error } = await supabaseClient
    .from("categories")
    .update(payload)
    .eq("id", categoryId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function updateCategorySortOrders(entries) {
  if (!entries.length) {
    return;
  }

  const { error } = await supabaseClient
    .from("categories")
    .upsert(entries, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

async function updateResourceSortOrders(entries) {
  if (!entries.length) {
    return;
  }

  const { error } = await supabaseClient
    .from("resources")
    .upsert(entries, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

async function removeCategory(categoryId) {
  const { error } = await supabaseClient
    .from("categories")
    .delete()
    .eq("id", categoryId);

  if (error) {
    throw error;
  }
}

function getStatusClass(status) {
  if (status === "approved") return "is-approved";
  if (status === "rejected") return "is-rejected";
  return "is-pending";
}

function getProfileStatus(profile) {
  return getProfileApprovalState(profile);
}

function getRoleClass(role) {
  return role === "admin" ? "is-admin" : "is-user";
}

function formatName(profile) {
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return fullName || "Nom non renseigne";
}

function getChildren(categories, parentId) {
  return categories
    .filter((category) => String(category.parent_id) === String(parentId))
    .sort(compareBySortOrder);
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
    return category.type;
  }

  let currentCategory = category;

  while (currentCategory?.parent_id != null) {
    currentCategory = categoryMap.get(String(currentCategory.parent_id)) ?? null;

    if (!currentCategory) {
      break;
    }

    if (currentCategory.type) {
      return currentCategory.type;
    }
  }

  return inferTypeFromName(currentCategory?.name ?? category.name) ?? "protocole";
}

function getTypeLabel(type) {
  return CATEGORY_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "Type non defini";
}

function getRootCategories(categories, type = null, categoryMap = buildCategoryMap(categories)) {
  return categories
    .filter((category) => category.parent_id == null)
    .filter((category) => (type ? resolveCategoryType(category, categoryMap) === type : true))
    .sort(compareBySortOrder);
}

function getResourcesForCategory(resources, categoryId) {
  return resources
    .filter((resource) => String(resource.category_id) === String(categoryId))
    .sort(compareBySortOrder);
}

function getNextSortOrder(items) {
  if (!items.length) {
    return 1;
  }

  return Math.max(...items.map((item) => Number(item.sort_order) || 0)) + 1;
}

function hasCategorySortOrder(categories) {
  return categories.some((category) => Object.prototype.hasOwnProperty.call(category, "sort_order"));
}

function hasResourceSortOrder(resources) {
  return resources.some((resource) => Object.prototype.hasOwnProperty.call(resource, "sort_order"));
}

function buildCategorySortPayload(categoryIds, categories) {
  const categoryMap = new Map(categories.map((category) => [String(category.id), category]));

  return categoryIds
    .map((categoryId, index) => {
      const category = categoryMap.get(String(categoryId));

      if (!category) {
        return null;
      }

      return {
        id: category.id,
        parent_id: category.parent_id,
        type: category.type,
        name: category.name,
        sort_order: index + 1
      };
    })
    .filter(Boolean);
}

function buildResourceSortPayload(resourceIds, resources) {
  const resourceMap = new Map(resources.map((resource) => [String(resource.id), resource]));

  return resourceIds
    .map((resourceId, index) => {
      const resource = resourceMap.get(String(resourceId));

      if (!resource) {
        return null;
      }

      return {
        id: resource.id,
        title: resource.title,
        description: resource.description,
        type: resource.type,
        category_id: resource.category_id,
        external_url: resource.external_url,
        file_path: resource.file_path,
        file_name: resource.file_name,
        mime_type: resource.mime_type,
        file_size: resource.file_size,
        sort_order: index + 1
      };
    })
    .filter(Boolean);
}

function getUploadFeedbackMarkup(feedback) {
  if (!feedback?.message) {
    return "";
  }

  return `<p class="feedback ${feedback.type}">${feedback.message}</p>`;
}

function buildCategoryEditModalMarkup(editingCategory, categories, selectedCategoryType, feedback) {
  if (!editingCategory) {
    return "";
  }

  return `
    <div class="admin-modal-backdrop" data-close-category-editor>
      <div class="admin-modal-card admin-editor-modal-card" role="dialog" aria-modal="true" aria-labelledby="categoryEditorTitle">
        <p class="section-kicker">Modifier</p>
        <h4 id="categoryEditorTitle">Modifier une categorie / sous-categorie</h4>
        <form id="inlineCategoryEditForm" class="stack admin-upload-form">
          <div class="admin-form-grid">
            <label class="field">
              <span>Nom</span>
              <input name="name" type="text" value="${editingCategory.name ?? ""}" required>
            </label>

            <label class="field">
              <span>Categorie parente</span>
              <select id="modalCategoryParentSelect" name="parent_id" class="search-input">
                ${buildParentCategoryOptions(
                  categories.filter((category) => String(category.id) !== String(editingCategory.id)),
                  editingCategory.parent_id ?? ""
                )}
              </select>
            </label>

            <label class="field">
              <span>Type</span>
              <select id="modalCategoryTypeSelect" name="category_type" class="search-input">
                ${CATEGORY_TYPE_OPTIONS
                  .map(
                    (option) => `
                      <option value="${option.value}" ${selectedCategoryType === option.value ? "selected" : ""}>
                        ${option.label}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            </label>
          </div>

          <p id="modalCategoryTypeHint" class="muted"></p>

          <div class="admin-form-actions">
            <button class="button button-primary" type="submit">Enregistrer</button>
            <button class="button button-secondary" type="button" data-cancel-category-editor>Annuler</button>
            ${getUploadFeedbackMarkup(feedback)}
          </div>
        </form>
      </div>
    </div>
  `;
}

function buildDocumentEditModalMarkup(editingDocument, categories, feedback) {
  if (!editingDocument) {
    return "";
  }

  return `
    <div class="admin-modal-backdrop" data-close-document-editor>
      <div class="admin-modal-card admin-editor-modal-card" role="dialog" aria-modal="true" aria-labelledby="documentEditorTitle">
        <p class="section-kicker">Modifier</p>
        <h4 id="documentEditorTitle">Modifier un document</h4>
        <p class="muted">Le champ fichier reste optionnel si vous ne remplacez pas le fichier existant.</p>

        <form id="inlineDocumentEditForm" class="stack admin-upload-form">
          <div class="admin-form-grid">
            <label class="field">
              <span>Titre</span>
              <input name="title" type="text" value="${editingDocument.title ?? ""}" required>
            </label>

            <label class="field">
              <span>Type</span>
              <select id="modalResourceTypeSelect" name="type" class="search-input" required>
                ${["pdf", "word", "excel", "image", "link"].map((type) => `
                  <option value="${type}" ${editingDocument.type === type ? "selected" : ""}>${type}</option>
                `).join("")}
              </select>
            </label>
          </div>

          <label class="field">
            <span>Description</span>
            <textarea name="description" class="search-input admin-textarea" rows="4" placeholder="Description optionnelle du document">${editingDocument.description ?? ""}</textarea>
          </label>

          <div class="admin-form-grid">
            <label class="field">
              <span>Categorie / sous-categorie</span>
              <select name="category_id" class="search-input" required>
                ${buildCategoryTargetOptions(categories, editingDocument.category_id ?? "")}
              </select>
            </label>

            <label id="modalExternalUrlField" class="field ${editingDocument.type === "link" ? "" : "hidden"}">
              <span>Lien externe</span>
              <input name="external_url" type="url" class="search-input" placeholder="https://..." value="${editingDocument.external_url ?? ""}">
            </label>
          </div>

          <label id="modalFileField" class="field ${editingDocument.type === "link" ? "hidden" : ""}">
            <span>Fichier (laisser vide pour conserver l'existant)</span>
            <input name="file" type="file" class="search-input">
          </label>

          <div class="admin-form-actions">
            <button class="button button-primary" type="submit">Enregistrer</button>
            <button class="button button-secondary" type="button" data-cancel-document-editor>Annuler</button>
            ${getUploadFeedbackMarkup(feedback)}
          </div>
        </form>
      </div>
    </div>
  `;
}

function buildParentCategoryOptions(categories, selectedId = "") {
  const categoryMap = buildCategoryMap(categories);

  return `
    <option value="">Categorie principale</option>
    ${CATEGORY_TYPE_OPTIONS
      .map((typeOption) => {
        const roots = getRootCategories(categories, typeOption.value, categoryMap);

        if (!roots.length) {
          return "";
        }

        return `
          <optgroup label="${typeOption.label}">
            ${roots
              .map(
                (category) => `
                  <option value="${category.id}" ${String(category.id) === String(selectedId) ? "selected" : ""}>
                    ${category.name}
                  </option>
                `
              )
              .join("")}
          </optgroup>
        `;
      })
      .join("")}
  `;
}

function buildCategoryTargetOptions(categories, selectedId = "") {
  const categoryMap = buildCategoryMap(categories);

  return `
    <option value="">Selectionner une categorie</option>
    ${CATEGORY_TYPE_OPTIONS
      .map((typeOption) => {
        const roots = getRootCategories(categories, typeOption.value, categoryMap);

        if (!roots.length) {
          return "";
        }

        return roots
          .map((rootCategory) => {
            const children = getChildren(categories, rootCategory.id);

            return `
              <optgroup label="${typeOption.label} - ${rootCategory.name}">
                <option value="${rootCategory.id}" ${String(rootCategory.id) === String(selectedId) ? "selected" : ""}>
                  ${rootCategory.name}
                </option>
                ${children
                  .map(
                    (child) => `
                      <option value="${child.id}" ${String(child.id) === String(selectedId) ? "selected" : ""}>
                        ${rootCategory.name} > ${child.name}
                      </option>
                    `
                  )
                  .join("")}
              </optgroup>
            `;
          })
          .join("");
      })
      .join("")}
  `;
}
async function swapCategoryOrder(categories, categoryId, direction) {
  if (!hasCategorySortOrder(categories)) {
    throw new Error("La colonne categories.sort_order est absente en base.");
  }

  const target = categories.find((category) => String(category.id) === String(categoryId));

  if (!target) {
    return;
  }

  const siblings = categories
    .filter((category) => String(category.parent_id ?? "") === String(target.parent_id ?? ""))
    .sort(compareBySortOrder);

  const index = siblings.findIndex((category) => String(category.id) === String(categoryId));
  const otherIndex = direction === "up" ? index - 1 : index + 1;
  const other = siblings[otherIndex];

  if (!other) {
    return;
  }

  const targetOrder = Number(target.sort_order) || index + 1;
  const otherOrder = Number(other.sort_order) || otherIndex + 1;

  await Promise.all([
    updateCategory(target.id, { sort_order: otherOrder }),
    updateCategory(other.id, { sort_order: targetOrder })
  ]);
}

async function reorderCategoryGroup(categories, orderedCategoryIds) {
  if (!hasCategorySortOrder(categories)) {
    throw new Error("La colonne categories.sort_order est absente en base.");
  }

  const payload = buildCategorySortPayload(orderedCategoryIds, categories);

  if (!payload.length) {
    return;
  }

  await updateCategorySortOrders(payload);
}

async function swapResourceOrder(resources, resourceId, direction) {
  if (!hasResourceSortOrder(resources)) {
    throw new Error("La colonne resources.sort_order est absente en base.");
  }

  const target = resources.find((resource) => String(resource.id) === String(resourceId));

  if (!target) {
    return;
  }

  const siblings = resources
    .filter((resource) => String(resource.category_id) === String(target.category_id))
    .sort(compareBySortOrder);

  const index = siblings.findIndex((resource) => String(resource.id) === String(resourceId));
  const otherIndex = direction === "up" ? index - 1 : index + 1;
  const other = siblings[otherIndex];

  if (!other) {
    return;
  }

  const targetOrder = Number(target.sort_order) || index + 1;
  const otherOrder = Number(other.sort_order) || otherIndex + 1;

  await Promise.all([
    updateResource(target.id, { sort_order: otherOrder }),
    updateResource(other.id, { sort_order: targetOrder })
  ]);
}

async function reorderResourceGroup(resources, orderedResourceIds) {
  if (!hasResourceSortOrder(resources)) {
    throw new Error("La colonne resources.sort_order est absente en base.");
  }

  const payload = buildResourceSortPayload(orderedResourceIds, resources);

  if (!payload.length) {
    return;
  }

  await updateResourceSortOrders(payload);
}

function buildCategoryTreeMarkup(categories, resources, options = {}) {
  const categoryMap = buildCategoryMap(categories);
  const {
    categorySortOrderEnabled = true,
    adminSearchQuery = "",
    orderPreferences = {},
    currentUserId = "anonymous"
  } = options;
  const documentsSortOrderEnabled = hasResourceSortOrder(resources);
  const normalizedSearchQuery = normalizeText(adminSearchQuery);
  const hasSearchQuery = Boolean(normalizedSearchQuery);

  const matchesAdminSearch = (...values) => {
    if (!hasSearchQuery) {
      return true;
    }

    return values.some((value) => normalizeText(value).includes(normalizedSearchQuery));
  };

  const resourceMatchesSearch = (resource) => matchesAdminSearch(
    resource?.title,
    resource?.description,
    resource?.type,
    resource?.file_name
  );

  const buildDocumentRowsMarkup = (documentList, categoryId, options = {}) => {
    const { nested = false } = options;

    return documentList.length
      ? `
        <div
          class="admin-documents-list ${nested ? "is-nested" : ""}"
          data-resource-sort-list
          data-resource-category-id="${categoryId}"
        >
          ${documentList
            .map(
              (resource) => `
                <div class="admin-document-row" data-resource-sort-item data-resource-id="${resource.id}">
                  <div>
                    <strong>${resource.title}</strong>
                    <p class="muted">${resource.type || "document"} - ordre ${resource.sort_order ?? "-"}</p>
                  </div>

                  <div class="inline-actions">
                    <span class="admin-drag-handle" title="${documentsSortOrderEnabled ? "Glisser pour reordonner" : "Migration sort_order requise"}">⋮⋮</span>
                    <button class="button button-secondary button-small" type="button" data-document-move-up="${resource.id}">↑</button>
                    <button class="button button-secondary button-small" type="button" data-document-move-down="${resource.id}">↓</button>
                    <button class="button button-ghost button-small" type="button" data-document-edit="${resource.id}">Modifier</button>
                    <button class="button button-secondary button-small" type="button" data-document-delete="${resource.id}">Supprimer</button>
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
      `
      : "";
  };

  return CATEGORY_TYPE_OPTIONS
    .map((typeOption) => {
      const rootScopeKey = getCategoryOrderScopeKey({
        userId: currentUserId,
        categoryType: typeOption.value,
        parentId: null
      });
      const roots = applyStoredOrder(
        getRootCategories(categories, typeOption.value, categoryMap),
        orderPreferences,
        rootScopeKey
      );
      const visibleRoots = roots
        .map((rootCategory) => {
          const childScopeKey = getCategoryOrderScopeKey({
            userId: currentUserId,
            categoryType: typeOption.value,
            parentId: rootCategory.id
          });
          const children = applyStoredOrder(
            getChildren(categories, rootCategory.id),
            orderPreferences,
            childScopeKey
          );
          const rootDocuments = getResourcesForCategory(resources, rootCategory.id);
          const visibleRootDocuments = hasSearchQuery
            ? rootDocuments.filter(resourceMatchesSearch)
            : rootDocuments;
          const visibleChildren = children
            .map((child) => {
              const childDocuments = getResourcesForCategory(resources, child.id);
              const visibleChildDocuments = hasSearchQuery
                ? childDocuments.filter(resourceMatchesSearch)
                : childDocuments;
              const childMatches = matchesAdminSearch(child.name);

              if (hasSearchQuery && !childMatches && !visibleChildDocuments.length) {
                return null;
              }

              return {
                child,
                visibleChildDocuments
              };
            })
            .filter(Boolean);
          const rootMatches = matchesAdminSearch(rootCategory.name, typeOption.label);

          if (hasSearchQuery && !rootMatches && !visibleChildren.length && !visibleRootDocuments.length) {
            return null;
          }

          return {
            rootCategory,
            visibleChildren,
            visibleRootDocuments
          };
        })
        .filter(Boolean);

      return `
        <section class="stack admin-content-section" id="admin-content-${typeOption.value}">
          <div class="admin-type-heading">
            <p class="section-kicker">Type</p>
            <h5>${typeOption.label}</h5>
          </div>
          ${
            visibleRoots.length
              ? `
                  <div
                    class="admin-category-sort-list"
                    data-category-sort-list
                    data-sort-parent=""
                    data-sort-type="${typeOption.value}"
                  >
                    ${visibleRoots
                      .map(({ rootCategory, visibleChildren, visibleRootDocuments }) => {
                        return `
                      <article class="admin-entity-card" data-category-sort-item data-category-id="${rootCategory.id}">
                        <div class="admin-entity-header">
                          <div>
                            <p class="section-kicker">Categorie</p>
                            <h5>${rootCategory.name}</h5>
                            <p class="muted">
                              ${visibleChildren.length} sous-categorie(s) - ${visibleRootDocuments.length} document(s) direct(s)
                            </p>
                          </div>

                          <div class="inline-actions">
                            <span class="admin-drag-handle" title="${categorySortOrderEnabled ? "Glisser pour reordonner" : "Migration sort_order requise"}">⋮⋮</span>
                            <button class="button button-secondary button-small" type="button" data-category-move-up="${rootCategory.id}" ${categorySortOrderEnabled ? "" : 'title="Migration sort_order requise"'}>
                              ↑ Monter
                            </button>
                            <button class="button button-secondary button-small" type="button" data-category-move-down="${rootCategory.id}" ${categorySortOrderEnabled ? "" : 'title="Migration sort_order requise"'}>
                              ↓ Descendre
                            </button>
                            <button class="button button-ghost button-small" type="button" data-category-edit="${rootCategory.id}">Modifier</button>
                            <button class="button button-secondary button-small" type="button" data-category-delete="${rootCategory.id}">Supprimer</button>
                          </div>
                        </div>

                        ${
                          visibleChildren.length
                            ? `
                              <div
                                class="admin-subtree admin-category-sort-list"
                                data-category-sort-list
                                data-sort-parent="${rootCategory.id}"
                                data-sort-type="${typeOption.value}"
                              >
                                ${visibleChildren
                                  .map(({ child, visibleChildDocuments }) => {
                                    return `
                                      <div class="admin-subentity-card" data-category-sort-item data-category-id="${child.id}">
                                        <div class="admin-subentity-header">
                                          <div>
                                            <p class="admin-item-kicker">Sous-categorie</p>
                                            <strong>${child.name}</strong>
                                            <p class="muted">${visibleChildDocuments.length} document(s)</p>
                                          </div>

                                          <div class="inline-actions">
                                            <span class="admin-drag-handle" title="${categorySortOrderEnabled ? "Glisser pour reordonner" : "Migration sort_order requise"}">⋮⋮</span>
                                            <button class="button button-secondary button-small" type="button" data-category-move-up="${child.id}" ${categorySortOrderEnabled ? "" : 'title="Migration sort_order requise"'}>
                                              ↑
                                            </button>
                                            <button class="button button-secondary button-small" type="button" data-category-move-down="${child.id}" ${categorySortOrderEnabled ? "" : 'title="Migration sort_order requise"'}>
                                              ↓
                                            </button>
                                            <button class="button button-ghost button-small" type="button" data-category-edit="${child.id}">Modifier</button>
                                            <button class="button button-secondary button-small" type="button" data-category-delete="${child.id}">Supprimer</button>
                                          </div>
                                        </div>

                                        ${
                                          visibleChildDocuments.length
                                            ? buildDocumentRowsMarkup(visibleChildDocuments, child.id, { nested: true })
                                            : '<p class="empty-state">Aucun document dans cette sous-categorie.</p>'
                                        }
                                      </div>
                                    `;
                                  })
                                  .join("")}
                              </div>
                            `
                            : '<p class="empty-state">Aucune sous-categorie pour cette categorie.</p>'
                        }
                        ${
                          visibleRootDocuments.length
                            ? `
                              <div class="stack admin-direct-documents-block">
                                <p class="admin-item-kicker">Documents directs</p>
                                ${buildDocumentRowsMarkup(visibleRootDocuments, rootCategory.id)}
                              </div>
                            `
                            : ""
                        }
                      </article>
                    `;
                      })
                      .join("")}
                  </div>
                `
              : `<p class="empty-state">${hasSearchQuery ? "Aucun resultat pour cette rubrique." : "Aucune categorie enregistree pour ce type."}</p>`
          }
        </section>
      `;
    })
    .join("");
}

function buildAdminContentShortcutMarkup() {
  return `
    <div class="admin-content-shortcuts" aria-label="Acces rapide au contenu">
      ${ADMIN_CONTENT_SHORTCUTS
        .map((item) => (
          item.disabled
            ? `
              <span class="admin-content-shortcut is-disabled" title="Gestion admin distincte des medocs d'urgence">
                ${item.label}
              </span>
            `
            : `
              <a class="admin-content-shortcut" href="#admin-content-${item.value}">
                ${item.label}
              </a>
            `
        ))
        .join("")}
    </div>
  `;
}

export async function renderAdminView(container) {
  container.innerHTML = '<p class="muted">Chargement de l\'administration...</p>';

  try {
    let [profiles, categories, resources, currentUser] = await Promise.all([
      fetchProfiles(),
      fetchCategories(),
      fetchResources(),
      fetchCurrentUser()
    ]);
    let orderPreferences = await initCategoryOrderPreferences(currentUser?.id ?? "anonymous", categories);

    let feedback = "";
    let feedbackClass = "is-success";
    let categoryFeedback = { message: "", type: "is-success" };
    let documentFeedback = { message: "", type: "is-success" };
    let editingCategoryId = null;
    let editingDocumentId = null;
    let pendingUserDeletionId = null;
    let adminContentSearchQuery = "";
    let pendingEditorFocus = null;

    const refreshData = async () => {
      [profiles, categories, resources] = await Promise.all([
        fetchProfiles(),
        fetchCategories(),
        fetchResources()
      ]);
      orderPreferences = await initCategoryOrderPreferences(currentUser?.id ?? "anonymous", categories);
    };

    const getPendingDeletionProfile = () =>
      profiles.find((profile) => String(profile.id) === String(pendingUserDeletionId)) ?? null;

    const initCategorySortables = () => {
      if (!window.Sortable) {
        categoryFeedback = {
          message: "SortableJS n'est pas charge. Le drag & drop est indisponible.",
          type: "is-warning"
        };
        return;
      }

      container.querySelectorAll("[data-category-sort-list]").forEach((list) => {
        if (list._sortableInstance) {
          list._sortableInstance.destroy();
        }

        const sortParent = list.dataset.sortParent ?? "";
        const sortType = list.dataset.sortType ?? "";

        list._sortableInstance = window.Sortable.create(list, {
          animation: 180,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          handle: ".admin-drag-handle",
          draggable: "[data-category-sort-item]",
          ghostClass: "is-drag-ghost",
          chosenClass: "is-drag-chosen",
          dragClass: "is-drag-active",
          group: {
            name: `category-${sortType}-${sortParent}`,
            pull: false,
            put: false
          },
          onEnd: async () => {
            const orderedCategoryIds = Array.from(list.querySelectorAll("[data-category-sort-item]"))
              .map((item) => item.dataset.categoryId)
              .filter(Boolean);

            if (!orderedCategoryIds.length) {
              return;
            }

            try {
              await reorderCategoryGroup(categories, orderedCategoryIds);
              categoryFeedback = {
                message: "Ordre des categories mis a jour.",
                type: "is-success"
              };
              await refreshData();
            } catch (error) {
              console.error(error);
              categoryFeedback = {
                message: error.message ?? "Reorganisation impossible.",
                type: "is-error"
              };
            }

            render();
          }
        });
      });
    };

    const initResourceSortables = () => {
      if (!window.Sortable) {
        documentFeedback = {
          message: "SortableJS n'est pas charge. Le drag & drop des documents est indisponible.",
          type: "is-warning"
        };
        return;
      }

      container.querySelectorAll("[data-resource-sort-list]").forEach((list) => {
        if (list._sortableInstance) {
          list._sortableInstance.destroy();
        }

        const categoryId = list.dataset.resourceCategoryId ?? "";

        list._sortableInstance = window.Sortable.create(list, {
          animation: 180,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          handle: ".admin-drag-handle",
          draggable: "[data-resource-sort-item]",
          ghostClass: "is-drag-ghost",
          chosenClass: "is-drag-chosen",
          dragClass: "is-drag-active",
          group: {
            name: `resource-${categoryId}`,
            pull: false,
            put: false
          },
          onEnd: async () => {
            const orderedResourceIds = Array.from(list.querySelectorAll("[data-resource-sort-item]"))
              .map((item) => item.dataset.resourceId)
              .filter(Boolean);

            if (!orderedResourceIds.length) {
              return;
            }

            try {
              await reorderResourceGroup(resources, orderedResourceIds);
              documentFeedback = {
                message: "Ordre des documents mis a jour.",
                type: "is-success"
              };
              await refreshData();
            } catch (error) {
              console.error(error);
              documentFeedback = {
                message: error.message ?? "Reorganisation impossible pour le document.",
                type: "is-error"
              };
            }

            render();
          }
        });
      });
    };

    const render = () => {
      const categoryMap = buildCategoryMap(categories);
      const categorySortOrderEnabled = hasCategorySortOrder(categories);
      const editingCategory = categories.find((category) => String(category.id) === String(editingCategoryId)) ?? null;
      const editingDocument = resources.find((resource) => String(resource.id) === String(editingDocumentId)) ?? null;
      const pendingDeletionProfile = getPendingDeletionProfile();
      const editingParent = editingCategory?.parent_id
        ? categories.find((category) => String(category.id) === String(editingCategory.parent_id)) ?? null
        : null;
      const selectedCategoryType = resolveCategoryType(editingParent ?? editingCategory, categoryMap) || CATEGORY_TYPE_OPTIONS[0].value;
      const pendingDeletionLabel = pendingDeletionProfile
        ? `${formatName(pendingDeletionProfile)} (${pendingDeletionProfile.email ?? "email inconnu"})`
        : "";

      container.innerHTML = `
        <div class="stack">
          <div class="admin-toolbar">
            <div class="info-card">
              <p class="inline-label">Utilisateurs</p>
              <strong>${profiles.length}</strong>
            </div>
            <div class="info-card">
              <p class="inline-label">Categories</p>
              <strong>${categories.length}</strong>
            </div>
            <div class="info-card">
              <p class="inline-label">Documents</p>
              <strong>${resources.length}</strong>
            </div>
            ${feedback ? `<p class="feedback ${feedbackClass}">${feedback}</p>` : ""}
          </div>

          <div class="admin-grid admin-grid-wide">
            <article class="admin-card admin-upload-card">
              <p class="section-kicker">${editingCategory ? "Modifier" : "Creer"}</p>
              <h4>${editingCategory ? "Modifier une categorie / sous-categorie" : "Ajouter une categorie / sous-categorie"}</h4>
              <form id="categoryForm" class="stack admin-upload-form">
                <div class="admin-form-grid">
                  <label class="field">
                    <span>Nom</span>
                    <input name="name" type="text" value="${editingCategory?.name ?? ""}" required>
                  </label>

                  <label class="field">
                    <span>Categorie parente</span>
                    <select name="parent_id" class="search-input">
                      ${buildParentCategoryOptions(
                        categories.filter((category) => String(category.id) !== String(editingCategoryId)),
                        editingCategory?.parent_id ?? ""
                      )}
                    </select>
                  </label>

                  <label class="field">
                    <span>Type</span>
                    <select id="categoryTypeSelect" name="category_type" class="search-input">
                      ${CATEGORY_TYPE_OPTIONS
                        .map(
                          (option) => `
                            <option value="${option.value}" ${selectedCategoryType === option.value ? "selected" : ""}>
                              ${option.label}
                            </option>
                          `
                        )
                        .join("")}
                    </select>
                  </label>
                </div>

                <p id="categoryTypeHint" class="muted"></p>

                <div class="admin-form-actions">
                  <button class="button button-primary" type="submit">${editingCategory ? "Enregistrer" : "Creer"}</button>
                  ${editingCategory ? '<button id="cancelCategoryEdit" class="button button-secondary" type="button">Annuler</button>' : ""}
                  ${getUploadFeedbackMarkup(categoryFeedback)}
                </div>
              </form>
            </article>

            <article class="admin-card admin-upload-card">
              <p class="section-kicker">${editingDocument ? "Modifier" : "Ajouter"}</p>
              <h4>${editingDocument ? "Modifier un document" : "Uploader un document"}</h4>
              <p class="muted">Bucket prive + signed URL. Le champ fichier reste optionnel en mode edition si vous ne remplacez pas le fichier.</p>

              <form id="resourceUploadForm" class="stack admin-upload-form">
                <div class="admin-form-grid">
                  <label class="field">
                    <span>Titre</span>
                    <input name="title" type="text" value="${editingDocument?.title ?? ""}" required>
                  </label>

                  <label class="field">
                    <span>Type</span>
                    <select id="resourceTypeSelect" name="type" class="search-input" required>
                      ${["pdf", "word", "excel", "image", "link"].map((type) => `
                        <option value="${type}" ${editingDocument?.type === type || (!editingDocument && type === "pdf") ? "selected" : ""}>${type}</option>
                      `).join("")}
                    </select>
                  </label>
                </div>

                <label class="field">
                  <span>Description</span>
                  <textarea name="description" class="search-input admin-textarea" rows="4" placeholder="Description optionnelle du document">${editingDocument?.description ?? ""}</textarea>
                </label>

                <div class="admin-form-grid">
                  <label class="field">
                    <span>Categorie / sous-categorie</span>
                    <select name="category_id" class="search-input" required>
                      ${buildCategoryTargetOptions(categories, editingDocument?.category_id ?? "")}
                    </select>
                  </label>

                  <label id="externalUrlField" class="field ${editingDocument?.type === "link" ? "" : "hidden"}">
                    <span>Lien externe</span>
                    <input name="external_url" type="url" class="search-input" placeholder="https://..." value="${editingDocument?.external_url ?? ""}">
                  </label>
                </div>

                <label id="fileField" class="field ${editingDocument?.type === "link" ? "hidden" : ""}">
                  <span>Fichier ${editingDocument ? "(laisser vide pour conserver l'existant)" : ""}</span>
                  <input name="file" type="file" class="search-input">
                </label>

                <div class="admin-form-actions">
                  <button id="uploadSubmitBtn" class="button button-primary" type="submit">${editingDocument ? "Enregistrer" : "Uploader"}</button>
                  ${editingDocument ? '<button id="cancelDocumentEdit" class="button button-secondary" type="button">Annuler</button>' : ""}
                  ${getUploadFeedbackMarkup(documentFeedback)}
                </div>
              </form>
            </article>
          </div>
          <div class="admin-grid">
            <article class="admin-card">
              <p class="section-kicker">Contenu</p>
              <h4>Categories, sous-categories et documents</h4>
              <div class="stack">
                <label class="field admin-content-search-field">
                  <span>Recherche rapide dans le contenu</span>
                  <input
                    id="adminContentSearchInput"
                    class="search-input"
                    type="search"
                    placeholder="Categorie, sous-categorie, document..."
                    value="${adminContentSearchQuery}"
                  >
                </label>
                ${buildAdminContentShortcutMarkup()}
                ${buildCategoryTreeMarkup(categories, resources, {
                  categorySortOrderEnabled,
                  adminSearchQuery: adminContentSearchQuery,
                  orderPreferences,
                  currentUserId: currentUser?.id ?? "anonymous"
                }) || '<p class="empty-state">Aucune categorie enregistree.</p>'}
              </div>
            </article>

            <article class="admin-card">
              <p class="section-kicker">Utilisateurs</p>
              <h4>Gestion des acces</h4>
              <div class="table-like">
                ${profiles
                  .map(
                    (profile) => `
                      <div class="table-row">
                        <div>
                          <strong>${formatName(profile)}</strong>
                          <p>${profile.email}</p>
                          <p class="admin-meta">
                            <span class="pill ${getRoleClass(profile.role)}">${profile.role}</span>
                            <span class="pill ${getStatusClass(getProfileStatus(profile))}">${getProfileStatus(profile)}</span>
                          </p>
                        </div>
                        <div class="inline-actions">
                          <div class="admin-role-editor">
                            <label class="admin-role-label" for="role-select-${profile.id}">Role</label>
                            <select
                              id="role-select-${profile.id}"
                              class="search-input admin-role-select"
                              data-role-select="${profile.id}"
                              data-current-role="${profile.role ?? "user"}"
                              ${String(profile.id) === String(currentUser?.id ?? "") ? 'disabled title="Modification de votre propre role bloquee"' : ""}
                            >
                              <option value="user" ${profile.role === "user" ? "selected" : ""}>User</option>
                              <option value="admin" ${profile.role === "admin" ? "selected" : ""}>Admin</option>
                            </select>
                          </div>
                          <button
                            class="button button-secondary"
                            type="button"
                            data-role-update-id="${profile.id}"
                            ${String(profile.id) === String(currentUser?.id ?? "") ? 'disabled title="Modification de votre propre role bloquee"' : ""}
                          >
                            Modifier role
                          </button>
                          <button class="button button-ghost" type="button" data-approve-id="${profile.id}" ${getProfileStatus(profile) === "approved" ? "disabled" : ""}>
                            Approuver
                          </button>
                          <button class="button button-secondary" type="button" data-delete-user-id="${profile.id}" ${String(profile.id) === String(currentUser?.id ?? "") ? "disabled title=\"Suppression de votre propre compte bloquée\"" : ""}>
                            Supprimer
                          </button>
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </article>
          </div>
          ${
            pendingDeletionProfile
              ? `
                <div class="admin-modal-backdrop admin-delete-user-modal-backdrop" data-close-delete-user-modal>
                  <div class="admin-modal-card admin-delete-user-modal-card" role="dialog" aria-modal="true" aria-labelledby="deleteUserModalTitle">
                    <p class="section-kicker">Suppression utilisateur</p>
                    <h4 id="deleteUserModalTitle">Confirmer la suppression</h4>
                    <p class="muted">
                      Vous allez supprimer <strong>${pendingDeletionLabel}</strong>.
                      Cette action supprimera aussi son acces Auth.
                    </p>
                    <div class="admin-modal-actions">
                      <button class="button button-secondary" type="button" data-cancel-delete-user>
                        Annuler
                      </button>
                      <button class="button button-danger" type="button" data-confirm-delete-user="${pendingDeletionProfile.id}">
                        Supprimer definitivement
                      </button>
                    </div>
                  </div>
                </div>
              `
              : ""
          }
        </div>
      `;

      const typeSelect = container.querySelector("#resourceTypeSelect");
      const categoryParentSelect = container.querySelector('select[name="parent_id"]');
      const adminContentSearchInput = container.querySelector("#adminContentSearchInput");
      const categoryTypeSelect = container.querySelector("#categoryTypeSelect");
      const categoryTypeHint = container.querySelector("#categoryTypeHint");
      const externalUrlField = container.querySelector("#externalUrlField");
      const fileField = container.querySelector("#fileField");
      const externalUrlInput = container.querySelector('input[name="external_url"]');
      const fileInput = container.querySelector('input[name="file"]');

      adminContentSearchInput?.addEventListener("input", (event) => {
        const nextQuery = String(event.currentTarget.value ?? "");
        const cursorPosition = event.currentTarget.selectionStart ?? nextQuery.length;
        adminContentSearchQuery = nextQuery;
        render();

        requestAnimationFrame(() => {
          const refreshedSearchInput = container.querySelector("#adminContentSearchInput");

          if (!refreshedSearchInput) {
            return;
          }

          refreshedSearchInput.focus();
          refreshedSearchInput.setSelectionRange(cursorPosition, cursorPosition);
        });
      });

      function syncCategoryTypeField(parentSelect, typeSelect, hintNode) {
        if (!typeSelect || !hintNode) {
          return;
        }

        const parentId = String(parentSelect?.value ?? "").trim();
        const parentCategory = categories.find((category) => String(category.id) === String(parentId)) ?? null;
        const parentType = resolveCategoryType(parentCategory, categoryMap);

        if (parentCategory) {
          typeSelect.value = parentType || typeSelect.value;
          typeSelect.disabled = true;
          hintNode.textContent = `Type herite du parent : ${getTypeLabel(parentType)}.`;
          return;
        }

        typeSelect.disabled = false;
        hintNode.textContent = "Le type choisi definira la famille de navigation de cette categorie racine.";
      }

      function syncDocumentFields(resourceTypeSelect, resourceExternalUrlField, resourceFileField, resourceExternalUrlInput, resourceFileInput, isEditMode = false) {
        const isLinkType = resourceTypeSelect?.value === "link";

        resourceExternalUrlField?.classList.toggle("hidden", !isLinkType);
        resourceFileField?.classList.toggle("hidden", isLinkType);

        if (resourceExternalUrlInput) {
          resourceExternalUrlInput.required = isLinkType;
        }

        if (resourceFileInput) {
          resourceFileInput.required = !isLinkType && !isEditMode;
        }
      }

      typeSelect?.addEventListener("change", () => syncDocumentFields(typeSelect, externalUrlField, fileField, externalUrlInput, fileInput, Boolean(editingDocument)));
      categoryParentSelect?.addEventListener("change", () => syncCategoryTypeField(categoryParentSelect, categoryTypeSelect, categoryTypeHint));
      syncDocumentFields(typeSelect, externalUrlField, fileField, externalUrlInput, fileInput, Boolean(editingDocument));
      syncCategoryTypeField(categoryParentSelect, categoryTypeSelect, categoryTypeHint);

      container.querySelector("#cancelCategoryEdit")?.addEventListener("click", () => {
        editingCategoryId = null;
        categoryFeedback = { message: "", type: "is-success" };
        render();
      });

      container.querySelector("#cancelDocumentEdit")?.addEventListener("click", () => {
        editingDocumentId = null;
        documentFeedback = { message: "", type: "is-success" };
        render();
      });

      container.querySelectorAll("[data-approve-id]").forEach((button) => {
        button.addEventListener("click", async () => {
          const profileId = button.dataset.approveId;
          button.disabled = true;

          try {
            await approveUser(profileId);
            profiles = await fetchProfiles();
            feedback = "Utilisateur approuve avec succes.";
            feedbackClass = "is-success";
          } catch (error) {
            console.error(error);
            feedback = "Approbation impossible. Verifiez vos policies Supabase ou vos droits admin.";
            feedbackClass = "is-error";
          }

          render();
        });
      });

      container.querySelectorAll("[data-role-update-id]").forEach((button) => {
        button.addEventListener("click", async () => {
          const profileId = button.dataset.roleUpdateId;
          const roleSelect = container.querySelector(`[data-role-select="${profileId}"]`);
          const nextRole = String(roleSelect?.value ?? "").trim().toLowerCase();
          const targetProfile = profiles.find((profile) => String(profile.id) === String(profileId));

          if (!profileId || !roleSelect || !targetProfile) {
            return;
          }

          if (String(profileId) === String(currentUser?.id ?? "")) {
            feedback = "Modification de votre propre role bloquee pour eviter de perdre l'acces admin.";
            feedbackClass = "is-warning";
            render();
            return;
          }

          if (!["user", "admin"].includes(nextRole)) {
            feedback = "Role invalide.";
            feedbackClass = "is-warning";
            render();
            return;
          }

          if ((targetProfile.role ?? "user") === nextRole) {
            feedback = "Aucun changement de role a enregistrer.";
            feedbackClass = "is-warning";
            render();
            return;
          }

          button.disabled = true;
          roleSelect.disabled = true;

          try {
            await updateUserRole(profileId, nextRole);
            profiles = await fetchProfiles();
            feedback = `Role mis a jour : ${nextRole}.`;
            feedbackClass = "is-success";
          } catch (error) {
            console.error(error);
            feedback = "Modification du role impossible. Verifiez vos policies Supabase ou vos droits admin.";
            feedbackClass = "is-error";
          }

          render();
        });
      });

      container.querySelectorAll("[data-delete-user-id]").forEach((button) => {
        button.addEventListener("click", async () => {
          const userId = button.dataset.deleteUserId;
          const targetProfile = profiles.find((profile) => String(profile.id) === String(userId));

          if (!userId || !targetProfile) {
            return;
          }

          if (String(userId) === String(currentUser?.id ?? "")) {
            feedback = "Suppression de votre propre compte bloquée.";
            feedbackClass = "is-warning";
            render();
            return;
          }

          pendingUserDeletionId = userId;
          render();
        });
      });

      container.querySelector("[data-cancel-delete-user]")?.addEventListener("click", () => {
        pendingUserDeletionId = null;
        render();
      });

      container.querySelector("[data-close-delete-user-modal]")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) {
          pendingUserDeletionId = null;
          render();
        }
      });

      container.querySelector("[data-confirm-delete-user]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const userId = button.dataset.confirmDeleteUser;

        if (!userId) {
          return;
        }

        button.disabled = true;

        try {
          await deleteManagedUser(userId);
          pendingUserDeletionId = null;
          await refreshData();
          feedback = "Utilisateur supprime avec succes.";
          feedbackClass = "is-success";
        } catch (error) {
          console.error(error);
          pendingUserDeletionId = null;
          feedback = `Suppression impossible : ${error.message ?? "erreur inconnue"}`;
          feedbackClass = "is-error";
        }

        render();
      });

      container.querySelectorAll("[data-category-edit]").forEach((button) => {
        button.addEventListener("click", () => {
          editingCategoryId = button.dataset.categoryEdit;
          pendingEditorFocus = "category";
          categoryFeedback = { message: "", type: "is-success" };
          render();
        });
      });

      container.querySelectorAll("[data-category-delete]").forEach((button) => {
        button.addEventListener("click", async () => {
          const categoryId = button.dataset.categoryDelete;
          const children = getChildren(categories, categoryId);
          const linkedDocuments = getResourcesForCategory(resources, categoryId);

          if (children.length || linkedDocuments.length) {
            categoryFeedback = {
              message: "Suppression bloquee : cette categorie contient des sous-categories ou des documents.",
              type: "is-warning"
            };
            render();
            return;
          }

          if (!window.confirm("Confirmer la suppression de cette categorie ?")) {
            return;
          }

          try {
            await removeCategory(categoryId);
            if (String(editingCategoryId) === String(categoryId)) {
              editingCategoryId = null;
            }
            await refreshData();
            categoryFeedback = {
              message: "Categorie supprimee.",
              type: "is-success"
            };
          } catch (error) {
            console.error(error);
            categoryFeedback = {
              message: "Suppression impossible pour cette categorie.",
              type: "is-error"
            };
          }

          render();
        });
      });

      container.querySelectorAll("[data-category-move-up]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await swapCategoryOrder(categories, button.dataset.categoryMoveUp, "up");
            await refreshData();
          } catch (error) {
            console.error(error);
            categoryFeedback = {
              message: error.message ?? "Reorganisation impossible.",
              type: "is-error"
            };
          }

          render();
        });
      });

      container.querySelectorAll("[data-category-move-down]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await swapCategoryOrder(categories, button.dataset.categoryMoveDown, "down");
            await refreshData();
          } catch (error) {
            console.error(error);
            categoryFeedback = {
              message: error.message ?? "Reorganisation impossible.",
              type: "is-error"
            };
          }

          render();
        });
      });
      container.querySelectorAll("[data-document-edit]").forEach((button) => {
        button.addEventListener("click", () => {
          editingDocumentId = button.dataset.documentEdit;
          pendingEditorFocus = "document";
          documentFeedback = { message: "", type: "is-success" };
          render();
        });
      });

      container.querySelectorAll("[data-document-delete]").forEach((button) => {
        button.addEventListener("click", async () => {
          const resourceId = button.dataset.documentDelete;
          const targetResource = resources.find((resource) => String(resource.id) === String(resourceId));

          if (!targetResource) {
            return;
          }

          if (!window.confirm("Confirmer la suppression de ce document ?")) {
            return;
          }

          try {
            await deleteResource(resourceId);

            let storageCleanupWarning = "";

            if (targetResource.file_path) {
              try {
                await deleteFileFromStorage(targetResource.file_path);
              } catch (storageError) {
                console.error(storageError);
                storageCleanupWarning = " Le document a ete retire de l'administration, mais le fichier physique n'a pas pu etre supprime automatiquement.";
              }
            }

            if (String(editingDocumentId) === String(resourceId)) {
              editingDocumentId = null;
            }

            await refreshData();
            documentFeedback = {
              message: `Document supprime.${storageCleanupWarning}`,
              type: storageCleanupWarning ? "is-warning" : "is-success"
            };
          } catch (error) {
            console.error(error);
            documentFeedback = {
              message: "Suppression impossible pour ce document.",
              type: "is-error"
            };
          }

          render();
        });
      });

      container.querySelectorAll("[data-document-move-up]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await swapResourceOrder(resources, button.dataset.documentMoveUp, "up");
            await refreshData();
          } catch (error) {
            console.error(error);
            documentFeedback = {
              message: "Reorganisation impossible pour le document.",
              type: "is-error"
            };
          }

          render();
        });
      });

      container.querySelectorAll("[data-document-move-down]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await swapResourceOrder(resources, button.dataset.documentMoveDown, "down");
            await refreshData();
          } catch (error) {
            console.error(error);
            documentFeedback = {
              message: "Reorganisation impossible pour le document.",
              type: "is-error"
            };
          }

          render();
        });
      });

      initCategorySortables();
      initResourceSortables();

      container.querySelector("#categoryForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const formData = new FormData(event.currentTarget);
        const name = String(formData.get("name") ?? "").trim();
        const parentId = String(formData.get("parent_id") ?? "").trim() || null;
        const selectedType = String(formData.get("category_type") ?? "").trim();
        const parentCategory = parentId
          ? categories.find((category) => String(category.id) === String(parentId)) ?? null
          : null;
        const resolvedType = resolveCategoryType(parentCategory, categoryMap) || selectedType;

        if (!name || !resolvedType) {
          categoryFeedback = {
            message: "Le nom et le type de la categorie sont obligatoires.",
            type: "is-warning"
          };
          render();
          return;
        }

        try {
          if (editingCategory) {
            const oldParentId = editingCategory.parent_id ?? null;
            const siblings = categories.filter(
              (category) =>
                String(category.parent_id ?? "") === String(parentId ?? "") &&
                String(category.id) !== String(editingCategory.id)
            );
            const payload = {
              name,
              parent_id: parentId,
              type: resolvedType
            };

            if (hasCategorySortOrder(categories)) {
              payload.sort_order =
                String(oldParentId ?? "") === String(parentId ?? "")
                  ? editingCategory.sort_order
                  : getNextSortOrder(siblings);
            }

            await updateCategory(editingCategory.id, payload);

            categoryFeedback = {
              message: "Categorie mise a jour avec succes.",
              type: "is-success"
            };
            editingCategoryId = null;
          } else {
            const siblings = categories.filter(
              (category) => String(category.parent_id ?? "") === String(parentId ?? "")
            );
            const payload = {
              name,
              parent_id: parentId,
              type: resolvedType
            };

            if (hasCategorySortOrder(categories)) {
              payload.sort_order = getNextSortOrder(siblings);
            }

            await createCategory(payload);

            categoryFeedback = {
              message: "Categorie creee avec succes.",
              type: "is-success"
            };
          }

          await refreshData();
        } catch (error) {
          console.error(error);
          categoryFeedback = {
            message: `Enregistrement impossible pour cette categorie : ${error.message ?? "erreur inconnue"}`,
            type: "is-error"
          };
        }

        render();
      });
      container.querySelector("#resourceUploadForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const formData = new FormData(event.currentTarget);
        const title = String(formData.get("title") ?? "").trim();
        const description = String(formData.get("description") ?? "").trim();
        const type = String(formData.get("type") ?? "").trim();
        const categoryId = String(formData.get("category_id") ?? "").trim();
        const externalUrl = String(formData.get("external_url") ?? "").trim();
        const file = formData.get("file");
        const isLinkType = type === "link";

        if (!title || !type || !categoryId) {
          documentFeedback = {
            message: "Titre, type et categorie sont obligatoires.",
            type: "is-warning"
          };
          render();
          return;
        }

        if (isLinkType && !externalUrl) {
          documentFeedback = {
            message: "Veuillez renseigner un lien externe pour le type link.",
            type: "is-warning"
          };
          render();
          return;
        }

        if (!isLinkType && !editingDocument && !(file instanceof File && file.name)) {
          documentFeedback = {
            message: "Veuillez selectionner un fichier.",
            type: "is-warning"
          };
          render();
          return;
        }

        try {
          const siblings = resources.filter(
            (resource) =>
              String(resource.category_id) === String(categoryId) &&
              String(resource.id) !== String(editingDocument?.id ?? "")
          );
          const previousFilePath = editingDocument?.file_path ?? null;
          let uploadedReplacementPath = null;

          let payload = {
            title,
            description: description || null,
            type,
            category_id: categoryId,
            external_url: isLinkType ? externalUrl : null
          };

          if (hasResourceSortOrder(resources)) {
            payload.sort_order = editingDocument && String(editingDocument.category_id) === String(categoryId)
              ? editingDocument.sort_order
              : getNextSortOrder(siblings);
          }

          if (isLinkType) {
            payload = {
              ...payload,
              file_path: null,
              file_name: null,
              mime_type: null,
              file_size: null
            };
          } else if (file instanceof File && file.name) {
            if (file.size > 20 * 1024 * 1024) {
              throw new Error("Le fichier depasse 20 Mo.");
            }

            const storageData = await uploadFileToStorage({
              file,
              categoryId,
              userId: currentUser.id
            });
            uploadedReplacementPath = storageData.filePath;

            payload = {
              ...payload,
              file_path: storageData.filePath,
              file_name: storageData.fileName,
              mime_type: storageData.mimeType,
              file_size: storageData.fileSize,
              external_url: null
            };
          } else if (editingDocument) {
            payload = {
              ...payload,
              file_path: editingDocument.file_path,
              file_name: editingDocument.file_name,
              mime_type: editingDocument.mime_type,
              file_size: editingDocument.file_size
            };
          }

          if (editingDocument) {
            await updateResource(editingDocument.id, payload);

            if (isLinkType && previousFilePath) {
              await deleteFileFromStorage(previousFilePath);
            }

            if (!isLinkType && uploadedReplacementPath && previousFilePath && previousFilePath !== uploadedReplacementPath) {
              await deleteFileFromStorage(previousFilePath);
            }

            documentFeedback = {
              message: "Document mis a jour avec succes.",
              type: "is-success"
            };
            editingDocumentId = null;
          } else {
            await insertResource(payload);
            documentFeedback = {
              message: "Document ajoute avec succes.",
              type: "is-success"
            };
          }

          await refreshData();
        } catch (error) {
          console.error(error);
          documentFeedback = {
            message: `Operation impossible : ${error.message ?? "erreur inconnue"}`,
            type: "is-error"
          };
        }

        render();
      });

      if (pendingEditorFocus) {
        const focusTarget = pendingEditorFocus === "category"
          ? container.querySelector('#categoryForm input[name="name"]')
          : container.querySelector('#resourceUploadForm input[name="title"]');
        const focusCard = focusTarget?.closest(".admin-card");

        pendingEditorFocus = null;

        requestAnimationFrame(() => {
          focusCard?.scrollIntoView({ behavior: "smooth", block: "start" });
          focusTarget?.focus();
          focusTarget?.select?.();
        });
      }
    };

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger la zone d\'administration.</p>';
  }
}
