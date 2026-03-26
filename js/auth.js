import { supabaseClient } from "./config.js";

export async function signIn(email, password) {
  return supabaseClient.auth.signInWithPassword({ email, password });
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
  } = supabaseClient.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return subscription;
}

export function getProfileDisplayName(profile) {
  if (!profile) {
    return "Utilisateur";
  }

  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return fullName || profile.email || "Utilisateur";
}
