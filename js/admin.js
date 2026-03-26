import { supabaseClient } from "./config.js";

async function fetchProfiles() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, first_name, last_name, role, status")
    .order("email", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

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

async function approveUser(profileId) {
  const { error } = await supabaseClient
    .from("profiles")
    .update({ status: "approved" })
    .eq("id", profileId);

  if (error) {
    throw error;
  }
}

function getStatusClass(status) {
  if (status === "approved") return "is-approved";
  if (status === "rejected") return "is-rejected";
  return "is-pending";
}

function getRoleClass(role) {
  return role === "admin" ? "is-admin" : "is-user";
}

function formatName(profile) {
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return fullName || "Nom non renseigné";
}

export async function renderAdminView(container) {
  container.innerHTML = '<p class="muted">Chargement de l\'administration...</p>';

  try {
    let [profiles, categories] = await Promise.all([fetchProfiles(), fetchCategories()]);
    let feedback = "";
    let feedbackClass = "is-success";

    const render = () => {
      container.innerHTML = `
        <div class="stack">
          <div class="admin-toolbar">
            <div class="info-card">
              <p class="inline-label">Utilisateurs</p>
              <strong>${profiles.length}</strong>
            </div>
            <div class="info-card">
              <p class="inline-label">Catégories</p>
              <strong>${categories.length}</strong>
            </div>
            ${feedback ? `<p class="feedback ${feedbackClass}">${feedback}</p>` : ""}
          </div>

          <div class="admin-grid">
            <article class="admin-card">
              <p class="section-kicker">Utilisateurs</p>
              <h4>Gestion des accès</h4>
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
                            <span class="pill ${getStatusClass(profile.status)}">${profile.status}</span>
                          </p>
                        </div>
                        <button class="button button-ghost" type="button" data-approve-id="${profile.id}" ${profile.status === "approved" ? "disabled" : ""}>
                          Approuver
                        </button>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </article>

            <article class="admin-card">
              <p class="section-kicker">Structure</p>
              <h4>Catégories existantes</h4>
              <div class="table-like">
                ${categories
                  .map(
                    (category) => `
                      <div class="table-row">
                        <div>
                          <strong>${category.name}</strong>
                          <p>ID : ${category.id}</p>
                          <p>Parent : ${category.parent_id ?? "Catégorie racine"}</p>
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </article>
          </div>
        </div>
      `;

      container.querySelectorAll("[data-approve-id]").forEach((button) => {
        button.addEventListener("click", async () => {
          const profileId = button.dataset.approveId;
          button.disabled = true;

          try {
            await approveUser(profileId);
            profiles = await fetchProfiles();
            categories = await fetchCategories();
            feedback = "Utilisateur approuvé avec succès.";
            feedbackClass = "is-success";
          } catch (error) {
            console.error(error);
            feedback = "Approbation impossible. Vérifiez vos policies Supabase ou vos droits admin.";
            feedbackClass = "is-error";
          }

          render();
        });
      });
    };

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger la zone d\'administration.</p>';
  }
}
