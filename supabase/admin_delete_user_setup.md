# Suppression d'utilisateurs depuis l'administration

## Fichier concerne

- `supabase/functions/admin-delete-user/index.ts`

## Deploiement

1. Verifier que la fonction `admin-delete-user` est presente.
2. Deployer la fonction:
   - `supabase functions deploy admin-delete-user`
3. Tester depuis l'administration avec un compte admin approuve.

## Comportement

- seul un admin approuve peut supprimer un utilisateur
- l'admin ne peut pas supprimer son propre compte
- la suppression du dernier admin approuve est bloquee
- la fonction supprime le compte Auth et nettoie le profil si besoin
