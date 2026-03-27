# notify-admin-new-signup

Edge Function Supabase appelee par un trigger SQL sur `public.profiles`.

Elle :
- verifie un secret de webhook transmis dans l'en-tete `x-webhook-secret`
- lit le profil nouvellement cree
- envoie un email admin via Resend

Variables attendues :
- `APP_NAME`
- `ADMIN_NOTIFICATION_EMAIL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SIGNUP_WEBHOOK_SECRET`
- `ADMIN_REVIEW_URL` optionnelle
