import { scorerEntreprise } from './score.js';
import { communeDepuisNom } from './config.js';

/**
 * Rapprochement des fiches qui désignent la même entreprise.
 *
 * Sirene et le BODACC voient tous deux les sociétés : une création de SARL apparaît
 * dans les deux, et un déménagement publié au BODACC concerne souvent une entreprise
 * déjà connue par Sirene. Sans rapprochement, la même société occupe deux lignes,
 * avec deux scores différents, et se fait appeler deux fois.
 */

/**
 * Clé d'identité d'un prospect.
 *
 * Pour les entreprises, c'est le SIREN : il désigne l'entreprise, là où le SIRET
 * désigne l'établissement. Deux établissements d'une même société dans le secteur
 * ne feront donc qu'une fiche — c'est voulu, on passe un coup de fil à une entreprise,
 * pas à un local. À défaut de SIREN, on retombe sur la clé propre à la source.
 */
export function cleNaturelle(p) {
  const siren = String(p.siren ?? p.siret ?? '').replace(/\D/g, '').slice(0, 9);
  if (p.genre === 'entreprise' && siren.length === 9) return `siren:${siren}`;
  return p.cleSource;
}

/** Ordre de préférence des événements, à score égal : le plus actionnable gagne. */
const POIDS_EVENEMENT = { vente: 5, transfert: 4, dirigeant: 3, creation: 2, modification: 1 };

/**
 * Choisit la fiche qui impose son événement.
 *
 * C'est l'événement qui décide, pas le score : une fiche BODACC signalant un
 * déménagement n'a pas encore de code d'activité au moment de la fusion, donc un
 * score bas, alors que c'est le signal le plus actionnable des deux. Le score est
 * de toute façon recalculé juste après, une fois les deux sources réunies.
 */
function meilleur(a, b) {
  const pa = POIDS_EVENEMENT[a.evenement] ?? 0;
  const pb = POIDS_EVENEMENT[b.evenement] ?? 0;
  if (pa !== pb) return pa > pb ? a : b;
  return (a.score ?? 0) >= (b.score ?? 0) ? a : b;
}

/**
 * Recalcule le score une fois les deux sources réunies.
 *
 * C'est tout l'intérêt de la fusion : le BODACC apporte l'événement et le capital,
 * Sirene apporte le code d'activité. Séparément, aucune des deux fiches ne pouvait
 * être notée correctement.
 */
function rescorer(p) {
  if (p.genre !== 'entreprise' || !p.naf) return p;
  const note = scorerEntreprise({
    naf: p.naf,
    categorieJuridique: p.brut?.categorieJuridique ?? null,
    evenement: p.evenement,
    employeur: p.employeur,
    capital: p.capital,
    population: communeDepuisNom(p.commune)?.pop,
  });
  const corroboration = p.raisons.filter((r) => r.startsWith('Confirmée par'));
  return {
    ...p,
    score: note.score,
    offres: [...new Set([...note.offres, ...p.offres])],
    raisons: [...note.raisons, ...corroboration],
    activite: note.activite ?? p.activite,
  };
}

const premierRenseigne = (...v) => v.find((x) => x !== null && x !== undefined && x !== '') ?? null;
const plusAncienne = (a, b) => (!a ? b : !b ? a : (a < b ? a : b));

/**
 * Fusionne deux fiches d'une même entreprise.
 *
 * La fiche la mieux notée impose son événement, son nom et son lien — c'est elle
 * qu'on veut voir affichée. Tout le reste se cumule : les offres des deux sources,
 * leurs raisons, et le premier renseignement disponible pour chaque champ.
 */
export function fusionner(a, b) {
  const gagnante = meilleur(a, b);
  const autre = gagnante === a ? b : a;

  const offres = [...new Set([...(a.offres ?? []), ...(b.offres ?? [])])];
  const raisons = [...new Set([...(a.raisons ?? []), ...(b.raisons ?? [])])];

  // Une entreprise vue par les deux sources est mieux établie qu'une autre : le
  // signaler évite de se demander pourquoi la fiche cumule autant d'informations.
  const sources = [...new Set([a.source, b.source])].sort();
  if (sources.length > 1) {
    const mention = 'Confirmée par Sirene et par le BODACC.';
    if (!raisons.includes(mention)) raisons.push(mention);
  }

  return rescorer({
    ...autre,
    ...gagnante,
    id: gagnante.id,
    source: sources.join('+'),
    score: Math.max(a.score ?? 0, b.score ?? 0),   // repris par rescorer() si le NAF est connu
    offres,
    raisons,
    nom: gagnante.nom,
    evenement: gagnante.evenement,
    url: premierRenseigne(gagnante.url, autre.url),
    dateFait: premierRenseigne(gagnante.dateFait, autre.dateFait),
    // Ces champs-là n'ont pas de raison de dépendre de la fiche gagnante : on prend
    // le premier qui soit renseigné, chaque source en connaissant certains et pas d'autres.
    siret: premierRenseigne(a.siret, b.siret),
    siren: premierRenseigne(a.siren, b.siren),
    adresse: premierRenseigne(a.adresse, b.adresse),
    codePostal: premierRenseigne(a.codePostal, b.codePostal),
    naf: premierRenseigne(a.naf, b.naf),
    activite: premierRenseigne(a.activite, b.activite),
    dirigeants: premierRenseigne(a.dirigeants, b.dirigeants),
    capital: premierRenseigne(a.capital, b.capital),
    telephone: premierRenseigne(a.telephone, b.telephone),
    site: premierRenseigne(a.site, b.site),
    employeur: Boolean(a.employeur || b.employeur),
    // La fiche reste « vue » à sa première apparition : une entreprise déjà connue
    // ne doit pas remonter comme nouveauté parce qu'une seconde source la confirme.
    vuLe: plusAncienne(a.vuLe, b.vuLe),
    brut: { ...(autre.brut ?? {}), ...(gagnante.brut ?? {}) },
  });
}

/** Réduit une liste de prospects en fusionnant ceux qui partagent la même clé. */
export function fusionnerLot(prospects) {
  const par = new Map();
  for (const p of prospects) {
    const existante = par.get(p.id);
    par.set(p.id, existante ? fusionner(existante, p) : p);
  }
  return [...par.values()];
}

/** Remet une ligne relue en base au format des prospects, pour pouvoir la fusionner. */
export function depuisLigne(r) {
  return {
    id: r.id,
    genre: r.genre,
    source: r.source,
    evenement: r.evenement,
    nom: r.nom,
    commune: r.commune,
    codeCommune: r.code_commune,
    codePostal: r.code_postal,
    adresse: r.adresse,
    naf: r.naf,
    activite: r.activite,
    siret: r.siret,
    siren: r.siren,
    telephone: r.telephone,
    site: r.site,
    dirigeants: r.dirigeants,
    capital: r.capital,
    employeur: !!r.employeur,
    dateFait: r.date_fait,
    url: r.url,
    score: r.score ?? 0,
    offres: Array.isArray(r.offres) ? r.offres : String(r.offres ?? '').split(',').filter(Boolean),
    raisons: Array.isArray(r.raisons) ? r.raisons : String(r.raisons ?? '').split('\n').filter(Boolean),
    brut: typeof r.brut === 'string' ? JSON.parse(r.brut || '{}') : (r.brut ?? {}),
    vuLe: r.vu_le,
  };
}
