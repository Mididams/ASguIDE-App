# Suppression d'utilisateurs depuis l'administration

## Fichier concerne

- `supabase/functions/admin-delete-user/index.ts`

## Deploiement

1. Verifier que la fonction `admin-delete-user` est presente.
2. Deployer la fonction:
   - `supabase functions deploy admin-delete-user`
3. Si la fonction etait deja deployee, la redeployer apres modification.
4. Tester depuis l'administration avec un compte admin approuve.

## Comportement

- seul un admin approuve peut supprimer un utilisateur
- l'admin ne peut pas supprimer son propre compte
- la suppression du dernier admin approuve est bloquee
- la fonction supprime le compte Auth et nettoie le profil si besoin

## Si le front affiche "Failed to send a request to the Edge Function"

- verifier que la fonction est bien deployee
- verifier qu'elle a bien ete redeployee apres modification
- verifier les logs de la fonction dans Supabase

## Si la fonction repond `401 Invalid JWT`

- verifier dans Supabase que l'option `Verify JWT with legacy secret` est desactivee pour cette Edge Function
- si cette option est activee alors que la fonction verifie deja correctement l'utilisateur via le header `Authorization`, Supabase peut rejeter la requete avant meme d'executer votre code
- c'est un piege classique avec les Edge Functions: on croit que le probleme vient du code, alors que le refus est fait en amont par Supabase
