import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

type DeleteUserRequest = {
  userId?: string;
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

function buildCallerClient(authHeader: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
}

function buildServiceClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return json({ error: "Missing Supabase environment variables" }, 500);
  }

  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return json({ error: "Missing Authorization header" }, 401);
  }

  try {
    const callerClient = buildCallerClient(authHeader);
    const serviceClient = buildServiceClient();
    const { userId } = (await request.json()) as DeleteUserRequest;

    if (!userId) {
      return json({ error: "userId is required" }, 400);
    }

    const {
      data: { user: callerUser },
      error: callerError
    } = await callerClient.auth.getUser();

    if (callerError || !callerUser) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (callerUser.id === userId) {
      return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
    }

    const { data: callerProfile, error: callerProfileError } = await callerClient
      .from("profiles")
      .select("id, role, approved, status")
      .eq("id", callerUser.id)
      .single();

    if (callerProfileError || !callerProfile) {
      return json({ error: "Profil admin introuvable." }, 403);
    }

    const isApprovedAdmin =
      callerProfile.role === "admin" &&
      callerProfile.approved === true &&
      callerProfile.status === "approved";

    if (!isApprovedAdmin) {
      return json({ error: "Acces refuse." }, 403);
    }

    const { data: targetProfile, error: targetProfileError } = await serviceClient
      .from("profiles")
      .select("id, role, approved, status")
      .eq("id", userId)
      .maybeSingle();

    if (targetProfileError) {
      return json({ error: targetProfileError.message }, 500);
    }

    if (!targetProfile) {
      return json({ error: "Utilisateur introuvable." }, 404);
    }

    const targetIsApprovedAdmin =
      targetProfile.role === "admin" &&
      targetProfile.approved === true &&
      targetProfile.status === "approved";

    if (targetIsApprovedAdmin) {
      const { count: approvedAdminCount, error: countError } = await serviceClient
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("approved", true)
        .eq("status", "approved");

      if (countError) {
        return json({ error: countError.message }, 500);
      }

      if ((approvedAdminCount ?? 0) <= 1) {
        return json({ error: "Impossible de supprimer le dernier administrateur approuve." }, 400);
      }
    }

    const deleteAuthResult = await serviceClient.auth.admin.deleteUser(userId);

    if (deleteAuthResult.error) {
      const authErrorMessage = String(deleteAuthResult.error.message ?? "").toLowerCase();

      if (authErrorMessage.includes("foreign key")) {
        const { error: deleteProfileFirstError } = await serviceClient
          .from("profiles")
          .delete()
          .eq("id", userId);

        if (deleteProfileFirstError) {
          return json({ error: deleteProfileFirstError.message }, 500);
        }

        const retryDeleteAuthResult = await serviceClient.auth.admin.deleteUser(userId);

        if (retryDeleteAuthResult.error) {
          return json({ error: retryDeleteAuthResult.error.message }, 500);
        }
      } else {
        return json({ error: deleteAuthResult.error.message }, 500);
      }
    }

    // Nettoie le profil si la suppression Auth n'a pas entraine la cascade.
    const { error: cleanupError } = await serviceClient
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (cleanupError) {
      console.warn("Profile cleanup warning:", cleanupError.message);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("admin-delete-user failed", error);
    return json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500
    );
  }
});
