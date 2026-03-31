import {
  getFriendlyAuthError,
  getSession,
  signIn,
  signOut,
  signUp,
  subscribeToAuthChanges
} from "./auth.js";
import {
  ensureProfile,
  fetchProfile,
  getProfileApprovalState,
  getProfileDisplayName,
  getProfileStatusLabel,
  isProfileApproved
} from "./profiles.js";
import {
  renderCategoriesView,
  renderFavoritesView,
  renderFavoritesViewWithOptions
} from "./categories.js";
import { renderCardsView } from "./cards.js";
import { renderAdminView } from "./admin.js";
import { getFavoritesCount, initFavorites } from "./favorites.js";
import { renderGlobalSearchView } from "./global-search.js";

const state = {
  session: null,
  user: null,
  profile: null,
  currentView: "medications",
  authMode: "login",
  viewContext: {}
};

const APP_STATE_STORAGE_KEY = "asguide.appState";

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
    id: "services",
    label: "Services",
    kind: "generic",
    categoryType: "service",
    emptyMessage: "Aucune categorie service disponible."
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
    label: "Codes / Liens",
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
  },
  search: {
    id: "search",
    label: "Recherche",
    kind: "search"
  },
  favorites: {
    id: "favorites",
    label: "Favoris",
    kind: "favorites"
  }
};

const navigationMap = new Map([...NAV_ITEMS, VIEW_CONFIG.admin, VIEW_CONFIG.search, VIEW_CONFIG.favorites].map((item) => [item.id, item]));

const AUTH_COPY = {
  login: {
    kicker: "Connexion sécurisée",
    title: "Accès réservé à l'équipe",
    description: "Connectez-vous avec votre compte Supabase existant pour accéder aux contenus du service."
  },
  signup: {
    kicker: "Création de compte",
    title: "Demande d'accès à l'application",
    description: "Créez votre compte puis attendez la validation d'un administrateur avant d'accéder aux ressources."
  }
};

const elements = {
  mainLayout: document.getElementById("mainLayout"),
  authPanel: document.getElementById("authPanel"),
  waitingPanel: document.getElementById("waitingPanel"),
  appPanel: document.getElementById("appPanel"),
  authKicker: document.getElementById("authKicker"),
  authTitle: document.getElementById("authTitle"),
  authDescription: document.getElementById("authDescription"),
  loginForm: document.getElementById("loginForm"),
  signupForm: document.getElementById("signupForm"),
  showLoginBtn: document.getElementById("showLoginBtn"),
  showSignupBtn: document.getElementById("showSignupBtn"),
  signupLinkBtn: document.getElementById("signupLinkBtn"),
  loginLinkBtn: document.getElementById("loginLinkBtn"),
  loginSwitchText: document.getElementById("loginSwitchText"),
  loginLinkRow: document.getElementById("loginLinkRow"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  signupFirstNameInput: document.getElementById("signupFirstNameInput"),
  signupLastNameInput: document.getElementById("signupLastNameInput"),
  signupEmailInput: document.getElementById("signupEmailInput"),
  signupPasswordInput: document.getElementById("signupPasswordInput"),
  signupPasswordConfirmInput: document.getElementById("signupPasswordConfirmInput"),
  signupPrivacyConsent: document.getElementById("signupPrivacyConsent"),
  authMessage: document.getElementById("authMessage"),
  userStatus: document.getElementById("userStatus"),
  logoutBtn: document.getElementById("logoutBtn"),
  adminBtn: document.getElementById("adminBtn"),
  globalSearchForm: document.getElementById("globalSearchForm"),
  globalSearchInput: document.getElementById("globalSearchInput"),
  favoritesShortcutBtn: document.getElementById("favoritesShortcutBtn"),
  waitingMessage: document.getElementById("waitingMessage"),
  mainNav: document.getElementById("mainNav"),
  mainContent: document.getElementById("mainContent"),
  mobileNav: document.getElementById("mobileNav")
};

const MOBILE_NAV_ICONS = {
  medications: "💊",
  protocols: "📋",
  "emergency-meds": "⚡",
  services: "🏥",
  directories: "☎",
  codes: "#"
};

function persistAppState() {
  try {
    window.localStorage.setItem(
      APP_STATE_STORAGE_KEY,
      JSON.stringify({
        currentView: state.currentView,
        viewContext: state.viewContext ?? {}
      })
    );
  } catch (error) {
    console.error("Impossible d'enregistrer l'etat de navigation.", error);
  }
}

function restoreAppState() {
  try {
    const rawValue = window.localStorage.getItem(APP_STATE_STORAGE_KEY);

    if (!rawValue) {
      return;
    }

    const parsed = JSON.parse(rawValue);

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    if (typeof parsed.currentView === "string" && navigationMap.has(parsed.currentView)) {
      state.currentView = parsed.currentView;
    }

    if (parsed.viewContext && typeof parsed.viewContext === "object") {
      state.viewContext = parsed.viewContext;
    }
  } catch (error) {
    console.error("Impossible de restaurer l'etat de navigation.", error);
  }
}

function clearStoredAppState() {
  try {
    window.localStorage.removeItem(APP_STATE_STORAGE_KEY);
  } catch (error) {
    console.error("Impossible d'effacer l'etat de navigation.", error);
  }
}

function finishBoot() {
  document.body.classList.remove("app-booting");
}

function setFeedback(message = "", type = "is-error") {
  elements.authMessage.textContent = message;
  elements.authMessage.className = message ? `feedback ${type}` : "feedback hidden";

  if (!message) {
    elements.authMessage.classList.add("hidden");
  }
}

function setAuthMode(mode, options = {}) {
  state.authMode = mode;

  const copy = AUTH_COPY[mode] ?? AUTH_COPY.login;
  const isLoginMode = mode === "login";

  elements.authKicker.textContent = copy.kicker;
  elements.authTitle.textContent = copy.title;
  elements.authDescription.textContent = copy.description;

  elements.loginForm.classList.toggle("hidden", !isLoginMode);
  elements.signupForm.classList.toggle("hidden", isLoginMode);

  elements.showLoginBtn.classList.toggle("is-active", isLoginMode);
  elements.showLoginBtn.setAttribute("aria-selected", String(isLoginMode));
  elements.showSignupBtn.classList.toggle("is-active", !isLoginMode);
  elements.showSignupBtn.setAttribute("aria-selected", String(!isLoginMode));

  elements.loginSwitchText.classList.toggle("hidden", !isLoginMode);
  elements.signupLinkBtn.classList.toggle("hidden", !isLoginMode);
  elements.loginLinkRow.classList.toggle("hidden", isLoginMode);

  if (!options.preserveFeedback) {
    setFeedback("");
  }
}

function getNavigationItems() {
  return NAV_ITEMS;
}

function updateUserStatus() {
  const label = state.user ? getProfileDisplayName(state.profile) : "Non connecté";
  const approvalState = getProfileApprovalState(state.profile);
  const info = state.user
    ? `${state.profile?.role ?? "utilisateur"} - accès ${getProfileStatusLabel(state.profile)}`
    : "Veuillez vous identifier";

  const dotClass = !state.user
    ? "is-offline"
    : approvalState === "approved"
      ? "is-online"
      : approvalState === "rejected"
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
  return item.label;
}

function updateFavoritesShortcut() {
  if (!elements.favoritesShortcutBtn) {
    return;
  }

  elements.favoritesShortcutBtn.textContent = `Favoris (${getFavoritesCount()})`;
  elements.favoritesShortcutBtn.classList.toggle("is-active", state.currentView === "favorites");
}

function shouldFocusContentOnMobile() {
  return window.matchMedia?.("(max-width: 960px)").matches ?? false;
}

function scrollToActiveContent() {
  const target = elements.mainContent ?? elements.mainNav ?? elements.appPanel;

  if (!target) {
    return;
  }

  const top = Math.max(window.scrollY + target.getBoundingClientRect().top - 12, 0);
  const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  window.scrollTo({ top, behavior });
}

async function navigateTo(view, context = {}, options = {}) {
  state.currentView = view;
  state.viewContext = context ?? {};
  persistAppState();
  renderNavigation();
  await renderCurrentView();

  if (options.focusContentOnMobile && shouldFocusContentOnMobile()) {
    window.requestAnimationFrame(() => {
      scrollToActiveContent();
    });
  }
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

  elements.mobileNav.innerHTML = items
    .map(
      (item) => `
        <button
          class="mobile-nav-button ${state.currentView === item.id ? "is-active" : ""}"
          type="button"
          data-mobile-view="${item.id}"
          aria-label="${item.label}"
        >
          <span class="mobile-nav-icon" aria-hidden="true">${MOBILE_NAV_ICONS[item.id] ?? "•"}</span>
          <span class="mobile-nav-label">${item.label}</span>
        </button>
      `
    )
    .join("");

  elements.mainNav.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.view);
    });
  });

  elements.mobileNav.querySelectorAll("[data-mobile-view]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.mobileView, {}, { focusContentOnMobile: true });
    });
  });

  updateFavoritesShortcut();
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
        emptyMessage: config.emptyMessage,
        initialRootId: state.viewContext?.rootId ?? null,
        initialSubcategoryId: state.viewContext?.subcategoryId ?? null
      });
      break;
    case "favorites":
      if (state.viewContext?.categoryType) {
        await renderFavoritesViewWithOptions(elements.mainContent, {
          categoryType: state.viewContext.categoryType,
          title: state.viewContext.title ?? "Favoris"
        });
      } else {
        await renderFavoritesView(elements.mainContent);
      }
      break;
    case "emergency":
      await renderEmergencyView();
      break;
    case "admin":
      if (state.profile?.role === "admin") {
        await renderAdminView(elements.mainContent);
      } else {
        state.currentView = NAV_ITEMS[0].id;
        state.viewContext = {};
        renderNavigation();
        await renderCurrentView();
      }
      break;
    case "search":
      await renderGlobalSearchView(elements.mainContent, {
        query: state.viewContext?.query ?? elements.globalSearchInput?.value ?? ""
      });
      break;
    default:
      state.currentView = NAV_ITEMS[0].id;
      state.viewContext = {};
      renderNavigation();
      await renderCurrentView();
      break;
  }
}

function renderAccessState() {
  updateUserStatus();

  const isConnected = Boolean(state.user);
  const approvalState = getProfileApprovalState(state.profile);
  const isApproved = isProfileApproved(state.profile);
  const isAdmin = state.profile?.role === "admin";

  elements.logoutBtn.classList.toggle("hidden", !isConnected);
  elements.adminBtn.classList.toggle("hidden", !isConnected || !isApproved || !isAdmin);
  elements.globalSearchForm.classList.toggle("hidden", !isConnected || !isApproved);
  elements.favoritesShortcutBtn?.classList.toggle("hidden", !isConnected || !isApproved);
  elements.authPanel.classList.toggle("hidden", isConnected);
  elements.waitingPanel.classList.toggle("hidden", !isConnected || isApproved);
  elements.appPanel.classList.toggle("hidden", !isConnected || !isApproved);
  elements.mobileNav.classList.toggle("hidden", !isConnected || !isApproved);
  elements.mainLayout.classList.toggle("is-auth-only", !isConnected || !isApproved);

  if (isConnected && !isApproved) {
    elements.mainContent.innerHTML = "";
    elements.mainNav.innerHTML = "";
    elements.mobileNav.innerHTML = "";
    elements.waitingMessage.textContent =
      approvalState === "rejected"
        ? "Votre accès a été refusé. Contactez un administrateur du service."
        : "Compte en attente de validation. Vous êtes bien connecté, mais l'accès aux ressources reste bloqué jusqu'à approbation.";
  }

  if (isConnected && isApproved) {
    renderNavigation();
    renderCurrentView();
  } else if (elements.globalSearchInput) {
    elements.globalSearchInput.value = "";
  }
}

async function refreshAuthState() {
  const { session, error: sessionError } = await getSession();

  if (sessionError || !session?.user) {
    state.session = null;
    state.user = null;
    state.profile = null;
    await initFavorites({ force: true });
    clearStoredAppState();
    renderAccessState();
    finishBoot();
    return;
  }

  state.session = session;
  state.user = session.user;

  const { error: ensureError } = await ensureProfile(session.user);

  if (ensureError) {
    console.error(ensureError);
  }

  const { profile, error: profileError } = await fetchProfile(session.user.id);
  state.profile = profile;

  if (profileError) {
    console.error(profileError);
  }

  await initFavorites({ force: true });
  renderAccessState();
  finishBoot();
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
      setFeedback(getFriendlyAuthError(error, "login"), "is-error");
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

async function handleSignupSubmit(event) {
  event.preventDefault();
  setFeedback("");

  const firstName = elements.signupFirstNameInput.value.trim();
  const lastName = elements.signupLastNameInput.value.trim();
  const email = elements.signupEmailInput.value.trim();
  const password = elements.signupPasswordInput.value;
  const passwordConfirm = elements.signupPasswordConfirmInput.value;
  const privacyConsentAccepted = Boolean(elements.signupPrivacyConsent?.checked);

  if (!firstName || !lastName || !email || !password || !passwordConfirm) {
    setFeedback("Tous les champs d'inscription sont obligatoires.", "is-warning");
    return;
  }

  if (!privacyConsentAccepted) {
    setFeedback("Veuillez accepter la politique de confidentialité pour créer votre compte.", "is-warning");
    return;
  }

  if (password.length < 6) {
    setFeedback("Le mot de passe est trop court. Utilisez au moins 6 caractères.", "is-warning");
    return;
  }

  if (password !== passwordConfirm) {
    setFeedback("Les mots de passe ne correspondent pas.", "is-warning");
    return;
  }

  const submitButton = elements.signupForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Création...";

  try {
    const { data, error } = await signUp({
      firstName,
      lastName,
      email,
      password
    });

    if (error) {
      setFeedback(getFriendlyAuthError(error, "signup"), "is-error");
      return;
    }

    if (data?.session?.user) {
      const { error: ensureError } = await ensureProfile(data.session.user);

      if (ensureError) {
        console.error(ensureError);
      }
    }

    elements.signupForm.reset();

    if (data?.user && !data?.session) {
      setAuthMode("login", { preserveFeedback: true });
      setFeedback(
        "Compte créé. Vérifiez votre boîte mail pour confirmer votre adresse, puis attendez la validation de votre accès.",
        "is-success"
      );
      return;
    }

    setFeedback("Compte créé. Votre accès sera activé après validation.", "is-success");
    await refreshAuthState();
  } catch (error) {
    console.error(error);
    setFeedback("Erreur réseau. Vérifiez votre connexion et réessayez.", "is-error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Créer mon compte";
  }
}

async function handleLogout() {
  await signOut();
  state.currentView = NAV_ITEMS[0].id;
  state.viewContext = {};
  clearStoredAppState();
  setAuthMode("login", { preserveFeedback: true });
  setFeedback("");
  await refreshAuthState();
}

function performGlobalSearch() {
  const query = elements.globalSearchInput?.value.trim() ?? "";
  elements.globalSearchInput?.blur();
  navigateTo("search", { query });
}

function registerEvents() {
  elements.loginForm.addEventListener("submit", handleLoginSubmit);
  elements.signupForm.addEventListener("submit", handleSignupSubmit);
  elements.logoutBtn.addEventListener("click", handleLogout);
  elements.adminBtn.addEventListener("click", () => navigateTo("admin"));
  elements.showLoginBtn.addEventListener("click", () => setAuthMode("login"));
  elements.showSignupBtn.addEventListener("click", () => setAuthMode("signup"));
  elements.signupLinkBtn.addEventListener("click", () => setAuthMode("signup"));
  elements.loginLinkBtn?.addEventListener("click", () => setAuthMode("login"));
  elements.globalSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    performGlobalSearch();
  });
  elements.globalSearchInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) {
      return;
    }

    event.preventDefault();
    performGlobalSearch();
  });
  elements.favoritesShortcutBtn?.addEventListener("click", () => {
    navigateTo("favorites", {}, { focusContentOnMobile: true });
  });

  subscribeToAuthChanges(async (event, session) => {
    if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) {
      return;
    }

    if (
      event === "SIGNED_IN" &&
      state.user?.id &&
      session?.user?.id &&
      String(state.user.id) === String(session.user.id)
    ) {
      return;
    }

    await refreshAuthState();
  });

  window.addEventListener("favorites:changed", () => {
    renderNavigation();

    if (state.currentView === "favorites") {
      renderCurrentView();
    }
  });

  window.addEventListener("app:navigate", (event) => {
    const view = event?.detail?.view;
    const context = event?.detail?.context ?? {};

    if (!view || !navigationMap.has(view)) {
      return;
    }

    navigateTo(view, context);
  });

  window.addEventListener("app:view-context-updated", (event) => {
    const context = event?.detail?.context;

    if (!context || typeof context !== "object") {
      return;
    }

    state.viewContext = {
      ...state.viewContext,
      ...context
    };
    persistAppState();
  });
}

async function initApp() {
  setAuthMode("login", { preserveFeedback: true });
  restoreAppState();
  registerEvents();
  await refreshAuthState();
}

initApp();
