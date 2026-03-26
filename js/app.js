import {
  getAuthContext,
  getProfileDisplayName,
  signIn,
  signOut,
  subscribeToAuthChanges
} from "./auth.js";
import {
  getFavoritesCount,
  renderCategoriesView,
  renderFavoritesView
} from "./categories.js";
import { renderCardsView } from "./cards.js";
import { renderDirectoryView } from "./directory.js";
import { renderAdminView } from "./admin.js";

const state = {
  session: null,
  user: null,
  profile: null,
  currentView: "home"
};

const QUICK_LINKS = [
  { id: "categories", title: "Catégories", description: "Accéder rapidement à l'arborescence médicale." },
  { id: "directory", title: "Annuaires", description: "Retrouver les numéros utiles du service." },
  { id: "cards", title: "Fiches médicaments", description: "Consulter les fiches thérapeutiques." },
  { id: "favorites", title: "Favoris", description: "Ouvrir vos documents enregistrés localement." }
];

const viewConfig = {
  home: {
    label: "Accueil",
    title: "Accueil",
    description: "Vue d'ensemble du profil connecté et des modules disponibles."
  },
  categories: {
    label: "Catégories",
    title: "Catégories",
    description: "Parcourez les catégories, sous-catégories et documents."
  },
  favorites: {
    label: "Favoris",
    title: "Favoris",
    description: "Retrouvez rapidement vos documents enregistrés dans ce navigateur."
  },
  cards: {
    label: "Fiches médicaments",
    title: "Fiches médicaments",
    description: "Consultez les fiches thérapeutiques stockées dans la table cards."
  },
  directory: {
    label: "Annuaires",
    title: "Annuaires",
    description: "Retrouvez les numéros utiles et les UF du service."
  },
  codes: {
    label: "Codes",
    title: "Codes",
    description: "Section privée prévue pour les codes utiles du service."
  },
  admin: {
    label: "Administration",
    title: "Administration",
    description: "Outils réservés aux administrateurs."
  }
};

const elements = {
  mainLayout: document.getElementById("mainLayout"),
  authPanel: document.getElementById("authPanel"),
  waitingPanel: document.getElementById("waitingPanel"),
  appPanel: document.getElementById("appPanel"),
  loginForm: document.getElementById("loginForm"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  authMessage: document.getElementById("authMessage"),
  userStatus: document.getElementById("userStatus"),
  logoutBtn: document.getElementById("logoutBtn"),
  adminBtn: document.getElementById("adminBtn"),
  waitingMessage: document.getElementById("waitingMessage"),
  mainNav: document.getElementById("mainNav"),
  mainContent: document.getElementById("mainContent")
};

function setFeedback(message = "", type = "is-error") {
  elements.authMessage.textContent = message;
  elements.authMessage.className = message ? `feedback ${type}` : "feedback hidden";

  if (!message) {
    elements.authMessage.classList.add("hidden");
  }
}

function getNavigationItems() {
  return ["home", "categories", "favorites", "cards", "directory", "codes"];
}

function updateUserStatus() {
  const label = state.user ? getProfileDisplayName(state.profile) : "Non connecté";
  const info = state.user
    ? `${state.profile?.role ?? "utilisateur"} - statut : ${state.profile?.status ?? "inconnu"}`
    : "Veuillez vous identifier";

  const dotClass = !state.user
    ? "is-offline"
    : state.profile?.status === "approved"
      ? "is-online"
      : state.profile?.status === "rejected"
        ? "is-danger"
        : "is-warning";

  elements.userStatus.innerHTML = `
    <span class="status-dot ${dotClass}"></span>
    <div>
      <strong>${label}</strong>
      <p>${info}</p>
    </div>
  `;
}

function getNavLabel(key) {
  if (key === "favorites") {
    return `${viewConfig[key].label} (${getFavoritesCount()})`;
  }

  return viewConfig[key].label;
}

function navigateTo(view) {
  state.currentView = view;
  renderNavigation();
  renderCurrentView();
}

function renderNavigation() {
  const items = getNavigationItems();
  const canAccessAdmin = state.currentView === "admin" && state.profile?.role === "admin";

  if (!items.includes(state.currentView) && !canAccessAdmin) {
    state.currentView = "home";
  }

  elements.mainNav.innerHTML = items
    .map(
      (key) => `
        <button class="nav-button ${state.currentView === key ? "is-active" : ""}" type="button" data-view="${key}">
          ${getNavLabel(key)}
        </button>
      `
    )
    .join("");

  elements.mainNav.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.view);
    });
  });
}

function renderHomeView() {
  const favoritesCount = getFavoritesCount();

  elements.mainContent.innerHTML = `
    <div class="stack">
      <section class="quick-links-panel">
        <div class="panel-header">
          <div>
            <p class="section-kicker">Accès rapide</p>
            <h3>Raccourcis utiles</h3>
          </div>
        </div>

        <div class="quick-links-grid">
          ${QUICK_LINKS
            .map(
              (item) => `
                <button class="quick-link-card" type="button" data-shortcut-view="${item.id}">
                  <p class="card-tag">${item.title === "Favoris" ? `${favoritesCount} favori(s)` : "Raccourci"}</p>
                  <strong>${item.title}</strong>
                  <span>${item.description}</span>
                </button>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;

  elements.mainContent.querySelectorAll("[data-shortcut-view]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.shortcutView);
    });
  });
}

async function renderCurrentView() {
  switch (state.currentView) {
    case "categories":
      await renderCategoriesView(elements.mainContent);
      break;
    case "favorites":
      await renderFavoritesView(elements.mainContent);
      break;
    case "cards":
      await renderCardsView(elements.mainContent);
      break;
    case "directory":
      await renderDirectoryView(elements.mainContent);
      break;
    case "codes":
      await renderCategoriesView(elements.mainContent, { rootCategoryName: "Codes" });
      break;
    case "admin":
      if (state.profile?.role === "admin") {
        await renderAdminView(elements.mainContent);
      } else {
        state.currentView = "home";
        renderNavigation();
        renderHomeView();
      }
      break;
    default:
      renderHomeView();
      break;
  }
}

function renderAccessState() {
  updateUserStatus();

  const isConnected = Boolean(state.user);
  const isApproved = state.profile?.status === "approved";
  const isAdmin = state.profile?.role === "admin";

  elements.logoutBtn.classList.toggle("hidden", !isConnected);
  elements.adminBtn.classList.toggle("hidden", !isConnected || !isApproved || !isAdmin);
  elements.authPanel.classList.toggle("hidden", isConnected);
  elements.waitingPanel.classList.toggle("hidden", !isConnected || isApproved);
  elements.appPanel.classList.toggle("hidden", !isConnected || !isApproved);
  elements.mainLayout.classList.toggle("is-auth-only", !isConnected);

  if (isConnected && !isApproved) {
    elements.waitingMessage.textContent =
      state.profile?.status === "rejected"
        ? "Votre accès a été refusé. Contactez un administrateur du service."
        : "Votre compte est connecté mais doit encore être validé par un administrateur.";
  }

  if (isConnected && isApproved) {
    renderNavigation();
    renderCurrentView();
  }
}

async function refreshAuthState() {
  const { session, user, profile, error } = await getAuthContext();

  state.session = session;
  state.user = user;
  state.profile = profile;

  if (error && user) {
    console.error(error);
  }

  renderAccessState();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  setFeedback("");

  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;

  if (!email || !password) {
    setFeedback("Veuillez renseigner un email et un mot de passe.", "is-warning");
    return;
  }

  const submitButton = elements.loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Connexion...";

  try {
    const { error } = await signIn(email, password);

    if (error) {
      setFeedback(error.message, "is-error");
      return;
    }

    elements.loginForm.reset();
    setFeedback("Connexion réussie.", "is-success");
    await refreshAuthState();
  } catch (error) {
    console.error(error);
    setFeedback("Erreur inattendue lors de la connexion.", "is-error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Se connecter";
  }
}

async function handleLogout() {
  await signOut();
  state.currentView = "home";
  setFeedback("");
  await refreshAuthState();
}

function registerEvents() {
  elements.loginForm.addEventListener("submit", handleLoginSubmit);
  elements.logoutBtn.addEventListener("click", handleLogout);
  elements.adminBtn.addEventListener("click", () => navigateTo("admin"));

  subscribeToAuthChanges(async () => {
    await refreshAuthState();
  });

  window.addEventListener("favorites:changed", () => {
    renderNavigation();

    if (state.currentView === "home" || state.currentView === "favorites") {
      renderCurrentView();
    }
  });
}

async function initApp() {
  registerEvents();
  await refreshAuthState();
}

initApp();
