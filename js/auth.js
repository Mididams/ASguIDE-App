import { supabaseClient } from "./config.js";

export async function signIn(email, password) {
  return supabaseClient.auth.signInWithPassword({ email, password });
}

export async function signUp({ firstName, lastName, email, password }) {
  return supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        full_name: [firstName, lastName].filter(Boolean).join(" ").trim()
      }
    }
  });
}

export async function signOut() {
  return supabaseClient.auth.signOut();
}

export async function getSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  return { session: data.session ?? null, error };
}

export async function fetchProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, first_name, last_name, role, status")
    .eq("id", userId)
    .single();

  return { profile: data ?? null, error };
}

export async function getAuthContext() {
  const { session, error: sessionError } = await getSession();

  if (sessionError || !session?.user) {
    return {
      session: null,
      user: null,
      profile: null,
      error: sessionError ?? null
    };
  }

  const { profile, error: profileError } = await fetchProfile(session.user.id);

  return {
    session,
    user: session.user,
    profile,
    error: profileError ?? null
  };
}

export function subscribeToAuthChanges(callback) {
  const {
    data: { subscription }
  } = supabaseClient.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });

  return subscription;
}

export function getFriendlyAuthError(error, context = "login") {
  const message = String(error?.message ?? "").toLowerCase();
  const status = Number(error?.status ?? 0);

  if (message.includes("invalid login credentials")) {
    return "Email ou mot de passe incorrect.";
  }

  if (message.includes("user already registered") || message.includes("already been registered")) {
    return "Un compte existe déjà avec cette adresse email.";
  }

  if (message.includes("password should be at least") || message.includes("password is too short")) {
    return "Le mot de passe est trop court. Utilisez au moins 6 caractères.";
  }

  if (message.includes("email not confirmed")) {
    return "Adresse email non confirmée. Vérifiez votre boîte mail avant de vous connecter.";
  }

  if (message.includes("failed to fetch") || message.includes("network") || status === 0) {
    return "Erreur réseau. Vérifiez votre connexion et réessayez.";
  }

  if (context === "signup") {
    return error?.message || "Inscription impossible pour le moment.";
  }

  return error?.message || "Connexion impossible pour le moment.";
}
