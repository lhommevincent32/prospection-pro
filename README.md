# Veille prospection — Nord-Gers

Détecte chaque semaine les entreprises qui se créent ou qui bougent sur le secteur,
ainsi que les événements locaux à venir, et les classe par potentiel commercial.

Aucune dépendance à installer : tout tourne avec Node 22 ou plus récent.

## Les trois commandes

```bash
npm run collecte    # interroge les sources et remplit la base
npm run digest      # écrit le récapitulatif dans data/digest.html
npm start           # ouvre le tableau de bord sur http://localhost:4321
```

`npm run collecte 90` élargit la fenêtre à 90 jours si besoin (45 par défaut).

## Où vont les fiches

Le stockage se choisit tout seul, selon ce que contient `.env` :

- **SQLite local** (`data/prospects.db`) si rien n'est configuré. Pratique hors ligne.
- **Supabase** dès que `SUPABASE_URL` et `SUPABASE_SERVICE_KEY` sont renseignées.
  C'est ce mode qu'utilise la collecte automatique, et c'est ce que lit le tableau
  de bord consultable depuis le téléphone.

Les collecteurs ne savent pas lequel des deux ils alimentent : voir `src/store/`.

## Mise en service hébergée

1. **Supabase** — créer un projet, coller `supabase/schema.sql` dans l'éditeur SQL,
   puis désactiver l'inscription publique une fois son propre compte créé.
2. **GitHub** — déposer le dépôt, puis dans *Settings > Secrets and
   variables > Actions* :
   - onglet **Secrets** : `INSEE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
   - onglet **Variables** : `SUPABASE_URL`, `SUPABASE_ANON_KEY`
3. **Pages** — activer GitHub Pages avec la source « GitHub Actions ».

Dès lors, `collecte.yml` tourne chaque matin et `pages.yml` publie le tableau de bord
à chaque modification de `public/`.

### Le troisième workflow, et pourquoi il existe

GitHub désactive les tâches planifiées d'un dépôt **public** resté 60 jours sans
activité. Ce projet n'étant plus modifié une fois en service, la collecte quotidienne
finirait par s'arrêter d'elle-même.

`maintien.yml` dépose donc chaque 1er du mois un commit d'une ligne dans
`.github/derniere-activite.txt`, ce qui remet le compteur à zéro. Il vérifie au passage
que la collecte est toujours active et la réactive sinon.

GitHub ne documente pas précisément ce qu'il considère comme « activité » : l'envoi d'un
commit est le déclencheur le plus sûr, mais rien ne le garantit formellement. Si la
désactivation survenait malgré tout, GitHub envoie un courriel d'avertissement, et un
clic sur **Enable workflow** dans l'onglet Actions suffit à repartir.

La clé de service (`SUPABASE_SERVICE_KEY`) contourne toutes les règles d'accès : elle
ne doit vivre que dans `.env` et dans les secrets GitHub. La clé « anon », elle, est
faite pour être publique — elle n'ouvre rien sans connexion.

### Le dépôt doit être public, et c'est sans risque

GitHub Pages ne publie pas les dépôts privés sur un compte gratuit. Or ce dépôt ne
contient **aucune donnée de prospection et aucune clé** : les fiches vivent dans
Supabase, les clés dans les secrets. Ce qui serait visible, c'est le code, la liste
des 125 communes et la grille de score — rien de confidentiel.

L'adresse du tableau de bord serait publique, mais la page n'affiche rien sans
connexion, et l'inscription est désactivée : personne d'autre ne peut créer de compte.

Si tu préfères malgré tout un dépôt privé, **Cloudflare Pages** ou **Netlify** le
publient gratuitement. La collecte, elle, fonctionne dans les deux cas — GitHub
Actions tourne aussi sur les dépôts privés.

## Ce que fait la collecte

| Source | Ce qu'elle apporte | Clé |
|---|---|---|
| **Sirene** (INSEE) | Toutes les créations, entrepreneurs individuels compris | `INSEE_API_KEY` dans `.env` |
| **BODACC** | Reprises de fonds, déménagements, changements de dirigeant | aucune |
| **La Dépêche** | Fêtes, foires et ouvertures à venir → prospects flyers | aucune |

Un quatrième passage complète les fiches BODACC avec leur code d'activité, récupéré
chez Sirene à partir du SIREN — sans lui, une reprise de boulangerie et une reprise de
cabinet comptable auraient la même note.

## Le périmètre

125 communes du nord du Gers, définies dans `data/zone.json` : limite départementale au
nord et à l'ouest, Lectoure et Saint-Clar à l'est, ligne Fleurance — Montestruc —
Vic-Fezensac au sud. Nogaro, Auch et Sainte-Christie sont exclues.

Le filtrage se fait sur le **nom de commune**, pas sur le code postal : 57 communes hors
secteur partagent un code postal avec le nôtre, dont précisément celles qui sont exclues.

## Une entreprise, une fiche

Sirene et le BODACC voient tous deux les sociétés : sans rapprochement, une même
société occupait deux lignes avec deux scores différents. Les fiches sont donc
identifiées par leur **SIREN** — l'entreprise, pas l'établissement — et fusionnées
quand les deux sources la décrivent.

La fusion n'est pas un simple choix du mieux noté : le BODACC apporte l'événement
et le capital, Sirene apporte le code d'activité, et **le score est recalculé** une
fois les deux réunis. Un déménagement signalé par le BODACC, invisible dans Sirene,
peut ainsi être noté avec l'activité que seul Sirene connaissait.

`src/migrer.js` reprend les fiches enregistrées avant ce changement. Il simule par
défaut et n'écrit qu'avec `--appliquer` ; le workflow **Fusionner les doublons** fait
la même chose sur Supabase. Statuts et notes sont conservés, en gardant le statut le
plus avancé des fiches rapprochées.

## Filtrer et trier

Le tableau de bord (mobile comme local) filtre sur :

- le **statut** de suivi, en pastilles ;
- le **type** : entreprises, événements, ou les deux ;
- la **nature du signal** : reprise de fonds, déménagement, nouveau dirigeant, création ;
- l'**offre** concernée : colis, courrier, flyers, téléphonie, Swile ;
- l'**ancienneté** : moins d'un mois, 3 mois, 6 mois, un an.

Et trie par potentiel, par date la plus récente ou la plus ancienne.

Les compteurs des pastilles de statut tiennent compte des autres filtres : en filtrant
sur les reprises de fonds, « À appeler » affiche combien de reprises restent à appeler,
pas le total toutes catégories confondues.

La date utilisée est celle de l'événement : date de création pour Sirene, date
d'**immatriculation** pour le BODACC — et non sa date de parution, qui peut suivre
l'immatriculation de plusieurs semaines et ferait paraître une fiche plus fraîche
qu'elle ne l'est.

`npm start` sert aussi la page mobile sur `/mobile`, avec les identifiants du `.env`,
pour pouvoir la tester avant publication.

## Le score

De 0 à 100, il ne sert qu'à donner un ordre de lecture. Il combine le type d'activité
(code NAF), le type d'événement, le fait d'être employeur, le capital et la taille de la
commune. Chaque fiche affiche les raisons de sa note — si un critère te semble faux,
il se change dans `src/score.js`, en haut du fichier.

Les reprises de fonds de commerce sont volontairement mieux notées que les créations :
le repreneur remet tous ses contrats à plat, alors qu'une entreprise qui démarre n'a
encore aucun volume.

## Deux points à ne pas déplacer

**Le filtre de diffusion.** 28 % des créations du secteur émanent d'entrepreneurs ayant
exercé leur droit d'opposition à la diffusion de leurs données. Le filtre
`statutDiffusionEtablissement:O` est posé dans la requête Sirene elle-même, pas dans un
tri après coup, pour que ces fiches n'entrent jamais dans la base.

**La fenêtre de 45 jours.** Sirene publie avec un décalage important : un mois écoulé
n'affiche d'abord qu'un tiers de ses créations et se remplit ensuite. Ne pas réduire
cette fenêtre à 7 jours, sinon les créations publiées en retard sont perdues
définitivement. Le dédoublonnage fait que seules les fiches réellement nouvelles
remontent.

## Le téléphone et le site : pourquoi ils ne sont pas remplis

Les colonnes `telephone` et `site` existent mais restent vides. Aucune source publique
française ne publie le téléphone d'une entreprise, et les deux pistes gratuites ont été
mesurées avant d'être écartées :

- **OpenStreetMap** recense 744 numéros sur la zone, mais n'apparie que **4 %** des
  prospects — et l'essentiel de ces 4 % est du bruit. C'est logique : personne ne
  cartographie une entreprise la semaine de sa création.
- **Pages Jaunes** et **Societe.com** l'interdisent dans leurs conditions d'utilisation.

Chaque fiche porte donc un bouton **Chercher**, qui ouvre une recherche déjà remplie avec
le nom et la commune, et un bouton **Itinéraire**. Un appui, et le résultat est meilleur
que ce qu'un enrichissement automatique aurait produit.

Si tu veux automatiser malgré tout, **Google Places** donne le téléphone et le site de
façon fiable, dans les clous de ses conditions, et gratuitement à ce volume — mais il
faut un compte Google Cloud avec une carte bancaire enregistrée. Le jour où tu l'ouvres,
il suffira de remplir ces deux colonnes : l'affichage est déjà prêt et fera apparaître
un bouton **Appeler**.

## RGPD

La plupart des fiches concernent des entreprises individuelles : ce sont des personnes
physiques, avec parfois leur adresse personnelle.

- Le bouton **Oublier** supprime définitivement une fiche, à utiliser dès qu'une
  personne demande à ne plus être démarchée.
- La collecte purge automatiquement les fiches de plus d'un an jamais travaillées.
- La clé INSEE vit dans `.env`, qui n'est pas suivi par git.

Avant une mise en service régulière, valider l'usage avec le manager ou le
correspondant conformité : cet outil constitue un fichier de prospection à côté du CRM.
