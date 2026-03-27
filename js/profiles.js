import { supabaseClient } from "./config.js";

const PROFILE_FIELDS = "id, email, first_name, last_name, role, status, approved";

function getUserMetadata(user) {
  return user?.user_metadata ?? {};
}

function buildProfileIdentityPayload(user) {
  const metadata = getUserMetadata(user);

  return {
    id: user.id,
    email: user.email ?? null,
    first_name: String(metadata.first_name ?? "").trim() || null,
    last_name: String(metadata.last_name ?? "").trim() || null
  };
}

export async function fetchProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("id", userId)
    .maybeSingle();

  return { profile: data ?? null, error };
}

async function insertProfile(user) {
  const payload = {
    ...buildProfileIdentityPayload(user),
    approved: false,
    status: "pending",
    role: "user"
  };

  const { data, error } = await supabaseClient
    .from("profiles")
    .insert(payload)
    .select(PROFILE_FIELDS)
    .single();

  return { profile: data ?? null, error };
}

async function updateProfileIdentity(user) {
  const payload = buildProfileIdentityPayload(user);

  const { data, error } = await supabaseClient
    .from("profiles")
    .update(payload)
    .eq("id", user.id)
    .select(PROFILE_FIELDS)
    .single();

  return { profile: data ?? null, error };
}

export async function ensureProfile(user) {
  if (!user?.id) {
    return { profile: null, error: null };
  }

  const { profile: existingProfile, error: fetchError } = await fetchProfile(user.id);

  if (fetchError) {
    return { profile: null, error: fetchError };
  }

  if (!existingProfile) {
    const insertResult = await insertProfile(user);

    if (!insertResult.error) {
      return insertResult;
    }

    const insertMessage = String(insertResult.error.message ?? "").toLowerCase();
    if (insertMessage.includes("duplicate") || insertMessage.includes("unique")) {
      return updateProfileIdentity(user);
    }

    return insertResult;
  }

  return updateProfileIdentity(user);
}

export function getProfileApprovalState(profile) {
  if (!profile) {
    return "pending";
  }

  if (profile.status === "rejected") {
    return "rejected";
  }

  if (profile.approved === true || profile.status === "approved") {
    return "approved";
  }

  return "pending";
}

export function isProfileApproved(profile) {
  return getProfileApprovalState(profile) === "approved";
}

export function getProfileDisplayName(profile) {
  if (!profile) {
    return "Utilisateur";
  }

  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return fullName || profile.email || "Utilisateur";
}

export function getProfileStatusLabel(profile) {
  const approvalState = getProfileApprovalState(profile);

  if (approvalState === "approved") {
    return "approuvé";
  }

  if (approvalState === "rejected") {
    return "refusé";
  }

  return "en attente";
}
