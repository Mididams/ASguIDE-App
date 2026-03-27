-- ASguIDE - notification email admin a chaque nouveau profil
-- A executer apres setup_auth_and_rls.sql
--
-- Remplacez les deux valeurs ci-dessous avant execution:
--   <project-ref>
--   <signup-webhook-secret>

drop trigger if exists notify_admin_new_signup on public.profiles;

create trigger notify_admin_new_signup
after insert on public.profiles
for each row
execute function supabase_functions.http_request(
  'https://<project-ref>.supabase.co/functions/v1/notify-admin-new-signup',
  'POST',
  '{"Content-Type":"application/json","x-webhook-secret":"<signup-webhook-secret>"}',
  '{}',
  '5000'
);
