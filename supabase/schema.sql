-- Schéma de la base de prospection, à coller dans l'éditeur SQL de Supabase.
-- Reprend la structure locale SQLite, avec en plus le contrôle d'accès.

create table if not exists prospects (
  id            text primary key,       -- clé naturelle : siret, id BODACC, ou hash d'URL
  genre         text not null,          -- 'entreprise' | 'evenement'
  source        text not null,          -- 'sirene' | 'bodacc' | 'presse'
  evenement     text,
  nom           text not null,
  commune       text,
  code_commune  text,
  code_postal   text,
  adresse       text,
  naf           text,
  activite      text,
  dirigeants    text,
  capital       integer,
  employeur     boolean default false,
  date_fait     date,
  url           text,
  score         integer default 0,
  offres        text[] default '{}',
  raisons       text[] default '{}',
  brut          jsonb default '{}'::jsonb,
  vu_le         timestamptz not null default now(),
  statut        text not null default 'nouveau'
                check (statut in ('nouveau','a_appeler','appele','rdv','signe','sans_suite')),
  notes         text default '',
  maj_le        timestamptz default now()
);

create index if not exists idx_prospects_tri   on prospects (statut, score desc, date_fait desc);
create index if not exists idx_prospects_vu    on prospects (vu_le desc);
create index if not exists idx_prospects_genre on prospects (genre);

-- Journal des collectes, pour savoir si le lundi s'est bien passé.
create table if not exists collectes (
  id        bigserial primary key,
  lancee_le timestamptz not null default now(),
  source    text not null,
  examines  integer default 0,
  nouveaux  integer default 0,
  ecartes   integer default 0,
  erreur    text
);

-- --------------------------------------------------------------------------
-- Contrôle d'accès
--
-- La table contient des noms de personnes et des adresses de domicile : elle ne
-- doit être lisible que par toi, une fois connecté. Les politiques ci-dessous
-- n'ouvrent rien aux visiteurs anonymes.
--
-- IMPORTANT : pense à désactiver l'inscription publique dans Supabase
-- (Authentication > Sign In / Providers > décocher « Allow new users to sign up »)
-- une fois ton propre compte créé. Sans ça, n'importe qui pourrait s'inscrire
-- et devenir « authentifié ».
-- --------------------------------------------------------------------------

alter table prospects enable row level security;
alter table collectes enable row level security;

drop policy if exists "lecture authentifiee" on prospects;
create policy "lecture authentifiee" on prospects
  for select to authenticated using (true);

drop policy if exists "mise a jour authentifiee" on prospects;
create policy "mise a jour authentifiee" on prospects
  for update to authenticated using (true) with check (true);

drop policy if exists "suppression authentifiee" on prospects;
create policy "suppression authentifiee" on prospects
  for delete to authenticated using (true);

drop policy if exists "lecture collectes" on collectes;
create policy "lecture collectes" on collectes
  for select to authenticated using (true);

-- L'écriture des prospects est réservée au robot de collecte, qui utilise la clé
-- de service. Cette clé contourne les politiques : aucune règle d'insertion n'est
-- donc nécessaire ici, et le tableau de bord ne peut pas créer de fiches à la main.

-- --------------------------------------------------------------------------
-- Purge RGPD automatique : les fiches de plus d'un an jamais travaillées
-- disparaissent d'elles-mêmes. Appelée par le robot à chaque collecte.
-- --------------------------------------------------------------------------

create or replace function purger_anciennes(jours integer default 365)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare supprimees integer;
begin
  delete from prospects
   where vu_le < now() - (jours || ' days')::interval
     and statut in ('nouveau','sans_suite');
  get diagnostics supprimees = row_count;
  return supprimees;
end;
$$;
