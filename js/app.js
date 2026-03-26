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
import { renderAdminView } from "./admin.js";

const state = {
  session: null,
  user: null,
  profile: null,
  currentView: "medications"
};

const NAV_ITEMS = [
  {
    id: "medications",
    label: "Médicaments",
    kind: "generic",
    categoryType: "medicament",
    emptyMessage: "Aucune categorie medicament disponible."
  },
  {
    id: "protocols",
    label: "Protocoles / Procédures",
    kind: "generic",
    categoryType: "protocole",
    emptyMessage: "Aucune categorie protocole disponible."
  },
  {
    id: "favorites",
    label: "Favoris",
    kind: "favorites"
  },
  {
    id: "emergency-meds",
    label: "Médocs d'urgence",
    kind: "emergency"
  },
  {
    id: "directories",
    label: "Annuaires",
    kind: "generic",
    categoryType: "annuaire",
    emptyMessage: "Aucune categorie annuaire disponible."
  },
  {
    id: "codes",
    label: "Codes",
    kind: "generic",
    categoryType: "code",
    emptyMessage: "Aucune categorie code disponible."
  }
];

const VIEW_CONFIG = {
  admin: {
    id: "admin",
    label: "Administration",
    kind: "admin"
  }
};

const navigationMap = new Map([...NAV_ITEMS, VIEW_CONFIG.admin].map((item) => [item.id, item]));

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
  return NAV_ITEMS;
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

function getNavLabel(item) {
  if (item.id === "favorites") {
    return `${item.label} (${getFavoritesCount()})`;
  }

  return item.label;
}

function navigateTo(view) {
  state.currentView = view;
  renderNavigation();
  renderCurrentView();
}

function renderNavigation() {
  const items = getNavigationItems();
  const canAccessAdmin = state.currentView === "admin" && state.profile?.role === "admin";

  if (!navigationMap.has(state.currentView) || (state.currentView === "admin" && !canAccessAdmin)) {
    state.currentView = items[0]?.id ?? "medications";
  }

  elements.mainNav.innerHTML = items
    .map(
      (item) => `
        <button class="nav-button ${state.currentView === item.id ? "is-active" : ""}" type="button" data-view="${item.id}">
          ${getNavLabel(item)}
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

async function renderEmergencyView() {
  await renderCardsView(elements.mainContent);
}

async function renderCurrentView() {
  const config = navigationMap.get(state.currentView);

  switch (config?.kind) {
    case "generic":
      await renderCategoriesView(elements.mainContent, {
        categoryType: config.categoryType,
        emptyMessage: config.emptyMessage
      });
      break;
    case "favorites":
      await renderFavoritesView(elements.mainContent);
      break;
    case "emergency":
      await renderEmergencyView();
      break;
    case "admin":
      if (state.profile?.role === "admin") {
        await renderAdminView(elements.mainContent);
      } else {
        state.currentView = NAV_ITEMS[0].id;
        renderNavigation();
        await renderCurrentView();
      }
      break;
    default:
      state.currentView = NAV_ITEMS[0].id;
      renderNavigation();
      await renderCurrentView();
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
  state.currentView = NAV_ITEMS[0].id;
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

    if (state.currentView === "favorites") {
      renderCurrentView();
    }
  });
}

async function initApp() {
  registerEvents();
  await refreshAuthState();
}

initApp();
