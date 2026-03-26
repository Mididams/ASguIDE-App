const supabaseUrl = "https://wconzbxoisgvoodccact.supabase.co";
const supabaseKey = "sb_publishable_Q16mJNhf0kCWvRcdsr-ymw_9bDdoz_E";

if (!window.supabase) {
  throw new Error("Supabase JS n'est pas chargé.");
}

export const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
export const APP_NAME = "ASguIDE";
