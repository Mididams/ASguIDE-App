# Notification email admin a chaque inscription

## Fichiers

- `supabase/functions/notify-admin-new-signup/index.ts`
- `supabase/functions/.env.example`
- `supabase/setup_admin_signup_notifications.sql`

## Variables d'environnement

- `APP_NAME`
- `ADMIN_NOTIFICATION_EMAIL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SIGNUP_WEBHOOK_SECRET`
- `ADMIN_REVIEW_URL` optionnelle

## Deploiement

1. Installer et connecter la CLI Supabase.
2. Depuis la racine du projet, initialiser Supabase si besoin:
   - `supabase init`
3. Copier `supabase/functions/.env.example` vers `supabase/functions/.env` et remplacer les valeurs.
4. Lier le projet si besoin:
   - `supabase link --project-ref <project-ref>`
5. Declarer les secrets de production:
   - `supabase secrets set APP_NAME="ASguIDE" ADMIN_NOTIFICATION_EMAIL="admin@exemple.com" RESEND_API_KEY="re_xxx" RESEND_FROM_EMAIL="ASguIDE <no-reply@ton-domaine.com>" SIGNUP_WEBHOOK_SECRET="<long-secret>" ADMIN_REVIEW_URL="https://ton-app.example.com"`
6. Deployer la fonction sans verification JWT:
   - `supabase functions deploy notify-admin-new-signup --no-verify-jwt`
7. Executer `supabase/setup_admin_signup_notifications.sql` dans le SQL Editor apres avoir remplace:
   - `<project-ref>`
   - `<signup-webhook-secret>`
8. Creer un nouveau compte de test et verifier la reception du mail.

## Test local

- `supabase start`
- `supabase functions serve notify-admin-new-signup --no-verify-jwt --env-file supabase/functions/.env`

## Remarque

Le systeme n'expose aucune cle sensible au front: l'application continue simplement a creer le compte et le profil, puis la notification part cote serveur via le trigger SQL et l'Edge Function.
