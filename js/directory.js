import { supabaseClient } from "./config.js";

async function fetchDirectoryEntries() {
  const { data, error } = await supabaseClient
    .from("directory_entries")
    .select("id, service_name, phone, uf_number")
    .order("service_name", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

function renderEntries(entries) {
  if (!entries.length) {
    return '<p class="empty-state">Aucune entrée trouvée.</p>';
  }

  return `
    <div class="card-grid">
      ${entries
        .map(
          (entry) => `
            <article class="directory-card">
              <p class="card-tag">Annuaire</p>
              <h4>${entry.service_name}</h4>
              <p class="directory-meta">Téléphone : ${entry.phone || "Non renseigné"}</p>
              <p class="directory-meta">UF : ${entry.uf_number || "Non renseigné"}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

export async function renderDirectoryView(container) {
  container.innerHTML = '<p class="muted">Chargement de l\'annuaire...</p>';

  try {
    const entries = await fetchDirectoryEntries();
    let query = "";

    const render = () => {
      const filteredEntries = entries.filter((entry) =>
        entry.service_name?.toLowerCase().includes(query.toLowerCase())
      );

      container.innerHTML = `
        <div class="stack">
          <div class="directory-toolbar">
            <input id="directorySearch" class="search-input" type="search" placeholder="Rechercher un service..." value="${query}">
            <div class="info-card">
              <p class="inline-label">Résultats</p>
              <strong>${filteredEntries.length}</strong>
            </div>
          </div>
          ${renderEntries(filteredEntries)}
        </div>
      `;

      container.querySelector("#directorySearch")?.addEventListener("input", (event) => {
        query = event.target.value;
        render();
      });
    };

    render();
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="feedback is-error">Impossible de charger l\'annuaire.</p>';
  }
}
