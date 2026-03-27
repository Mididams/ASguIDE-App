import { supabaseClient } from "./config.js";

const FAVORITES_STORAGE_KEY = "asguide.favoriteResources";

const state = {
  ids: [],
  loadedForUserId: null,
  loadingPromise: null
};

function normalizeFavoriteIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => String(item)).filter(Boolean))];
}

function readLocalFavorites() {
  try {
    const rawValue = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    return normalizeFavoriteIds(rawValue ? JSON.parse(rawValue) : []);
  } catch (error) {
    console.error("Impossible de lire les favoris locaux.", error);
    return [];
  }
}

function writeLocalFavorites(ids) {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
  } catch (error) {
    console.error("Impossible d'enregistrer les favoris locaux.", error);
  }
}

function emitFavoritesChanged() {
  window.dispatchEvent(new CustomEvent("favorites:changed", { detail: { count: state.ids.length } }));
}

function setFavorites(ids, { persistLocal = true, notify = true } = {}) {
  state.ids = normalizeFavoriteIds(ids);

  if (persistLocal) {
    writeLocalFavorites(state.ids);
  }

  if (notify) {
    emitFavoritesChanged();
  }
}

async function getCurrentUserId() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Impossible de lire la session active pour les favoris.", error);
    return null;
  }

  return data.session?.user?.id ?? null;
}

async function fetchRemoteFavorites(userId) {
  const { data, error } = await supabaseClient
    .from("user_favorites")
    .select("resource_id")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return normalizeFavoriteIds((data ?? []).map((entry) => entry.resource_id));
}

async function syncLocalFavoritesToRemote(userId, localIds) {
  if (!localIds.length) {
    return [];
  }

  const payload = localIds.map((resourceId) => ({
    user_id: userId,
    resource_id: String(resourceId)
  }));

  const { error } = await supabaseClient
    .from("user_favorites")
    .upsert(payload, { onConflict: "user_id,resource_id", ignoreDuplicates: true });

  if (error) {
    throw error;
  }

  return localIds;
}

export async function initFavorites(options = {}) {
  const { force = false } = options;

  if (state.loadingPromise && !force) {
    return state.loadingPromise;
  }

  state.loadingPromise = (async () => {
    const userId = await getCurrentUserId();
    const localIds = readLocalFavorites();

    if (!userId) {
      state.loadedForUserId = null;
      setFavorites(localIds, { persistLocal: false, notify: true });
      return state.ids;
    }

    if (!force && state.loadedForUserId === userId) {
      return state.ids;
    }

    try {
      let remoteIds = await fetchRemoteFavorites(userId);

      if (!remoteIds.length && localIds.length) {
        remoteIds = await syncLocalFavoritesToRemote(userId, localIds);
      }

      state.loadedForUserId = userId;
      setFavorites(remoteIds, { notify: true });
      return state.ids;
    } catch (error) {
      console.error("Impossible de synchroniser les favoris distants.", error);
      state.loadedForUserId = userId;
      setFavorites(localIds, { persistLocal: false, notify: true });
      return state.ids;
    }
  })();

  try {
    return await state.loadingPromise;
  } finally {
    state.loadingPromise = null;
  }
}

export function getFavoriteIds() {
  return [...state.ids];
}

export function getFavoritesCount() {
  return state.ids.length;
}

export async function toggleFavoriteResource(resourceId) {
  const resourceKey = String(resourceId);
  await initFavorites();

  const currentIds = getFavoriteIds();
  const exists = currentIds.includes(resourceKey);
  const nextIds = exists
    ? currentIds.filter((id) => id !== resourceKey)
    : [...currentIds, resourceKey];

  const userId = await getCurrentUserId();

  if (!userId) {
    state.loadedForUserId = null;
    setFavorites(nextIds);
    return !exists;
  }

  try {
    if (exists) {
      const { error } = await supabaseClient
        .from("user_favorites")
        .delete()
        .eq("user_id", userId)
        .eq("resource_id", resourceKey);

      if (error) {
        throw error;
      }
    } else {
      const { error } = await supabaseClient
        .from("user_favorites")
        .upsert(
          {
            user_id: userId,
            resource_id: resourceKey
          },
          { onConflict: "user_id,resource_id", ignoreDuplicates: true }
        );

      if (error) {
        throw error;
      }
    }

    state.loadedForUserId = userId;
    setFavorites(nextIds);
    return !exists;
  } catch (error) {
    console.error("Impossible de mettre a jour les favoris distants.", error);
    throw error;
  }
}
