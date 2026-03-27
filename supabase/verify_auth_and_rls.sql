-- ASguIDE - verifications rapides Auth / Profiles / RLS
-- A lancer apres setup_auth_and_rls.sql
-- Certaines requetes sont a executer dans SQL Editor avec un contexte utilisateur adapte.

-- ------------------------------------------------------------
-- 1. Verifier la structure de public.profiles
-- ------------------------------------------------------------

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in ('first_name', 'last_name', 'approved', 'role', 'status')
order by column_name;

-- ------------------------------------------------------------
-- 2. Verifier que le trigger existe
-- ------------------------------------------------------------

select
  trigger_name,
  event_manipulation,
  event_object_schema,
  event_object_table
from information_schema.triggers
where event_object_schema = 'auth'
  and event_object_table = 'users'
  and trigger_name = 'on_auth_user_created';

select
  trigger_name,
  event_manipulation,
  event_object_schema,
  event_object_table
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'profiles'
  and trigger_name = 'notify_admin_new_signup';

-- ------------------------------------------------------------
-- 3. Verifier la presence des policies
-- ------------------------------------------------------------

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where schemaname in ('public', 'storage')
  and (
    tablename in ('profiles', 'categories', 'resources', 'cards', 'directory_entries')
    or tablename = 'objects'
  )
order by schemaname, tablename, policyname;

-- ------------------------------------------------------------
-- 4. Verifier les nouveaux comptes en attente
-- Adapte le filtre email si besoin.
-- ------------------------------------------------------------

select
  id,
  email,
  first_name,
  last_name,
  approved,
  role,
  status,
  created_at
from public.profiles
where email ilike '%@%'
order by created_at desc nulls last, email asc;

-- ------------------------------------------------------------
-- 5. Verifier la coherence approved / status
-- Cette requete devrait idealement renvoyer 0 ligne.
-- ------------------------------------------------------------

select
  id,
  email,
  approved,
  status,
  role
from public.profiles
where
  (approved = true and status <> 'approved')
  or (approved = false and status = 'approved');

-- ------------------------------------------------------------
-- 6. Verifier les fonctions utilitaires
-- A executer en tant qu'utilisateur connecte dans SQL Editor.
-- ------------------------------------------------------------

select auth.uid() as current_user_id, public.is_approved_user() as is_approved_user, public.is_admin() as is_admin;

-- ------------------------------------------------------------
-- 7. Tests fonctionnels RLS
-- Important:
-- - SQL Editor execute souvent en role eleve. Pour tester vraiment la RLS,
--   utilise de preference l'onglet policy tester si disponible,
--   ou une session cliente connectee avec un vrai JWT utilisateur.
-- - Les requetes ci-dessous sont les verifications a faire avec 3 profils:
--   A. utilisateur non approuve
--   B. utilisateur approuve
--   C. admin approuve
-- ------------------------------------------------------------

-- 7A. Attendu pour un utilisateur non approuve:
-- - doit voir uniquement son propre profil
-- - ne doit pas lire le contenu protege
-- - ne doit pas pouvoir s'auto-approuver

select * from public.profiles where id = auth.uid();
select count(*) as categories_visible from public.categories;
select count(*) as resources_visible from public.resources;
select count(*) as cards_visible from public.cards;
select count(*) as directory_entries_visible from public.directory_entries;

-- Cette requete doit echouer ou n'affecter aucune ligne
update public.profiles
set approved = true, status = 'approved'
where id = auth.uid();

-- Cette requete doit etre autorisee seulement pour first_name / last_name / email
-- et en gardant approved = false, role = user, status non approuve.
update public.profiles
set first_name = 'Test',
    last_name = 'Utilisateur'
where id = auth.uid();

-- 7B. Attendu pour un utilisateur approuve:
-- - peut lire le contenu protege
-- - ne peut toujours pas gerer le contenu

select count(*) as categories_visible from public.categories;
select count(*) as resources_visible from public.resources;
select count(*) as cards_visible from public.cards;
select count(*) as directory_entries_visible from public.directory_entries;

-- Cette requete doit echouer pour un utilisateur approuve non admin
insert into public.categories (name, type)
values ('Test RLS', 'protocole');

-- 7C. Attendu pour un admin approuve:
-- - peut lire et modifier le contenu
-- - peut approuver un profil

-- Exemple d'approbation
-- remplace l'UUID ci-dessous
update public.profiles
set approved = true, status = 'approved'
where id = '00000000-0000-0000-0000-000000000000';

-- Exemple de creation / suppression de categorie de test
insert into public.categories (name, type)
values ('Test Admin RLS', 'protocole');

delete from public.categories
where name = 'Test Admin RLS';

-- ------------------------------------------------------------
-- 8. Verifier les policies storage du bucket documents
-- A valider depuis l'application ou via API avec un vrai JWT.
-- Attendus:
-- - non approuve: pas de lecture de signed URL / objets
-- - approuve non admin: lecture oui, upload/suppression non
-- - admin approuve: lecture + upload + suppression oui
-- ------------------------------------------------------------

select
  id,
  bucket_id,
  name,
  owner
from storage.objects
where bucket_id = 'documents'
order by created_at desc
limit 20;
