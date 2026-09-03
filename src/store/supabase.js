/**
 * Stockage distant sur Supabase, via son API REST — aucune bibliothèque à installer,
 * `fetch` suffit. C'est ce stockage qu'utilise le robot de collecte hébergé, pour que
 * les fiches soient consultables depuis le téléphone.
 *
 * La clé de service contourne les règles d'accès : elle ne doit jamais quitter
 * le fichier .env local ni les secrets GitHub, et surtout jamais aller dans la page web.
 */

import { fusionner, depuisLigne } from '../fusion.js';

const URL_BASE = process.env.SUPABASE_URL ?? '';
const CLE = process.env.SUPABASE_SERVICE_KEY ?? '';

/** Décrit l'URL configurée : sert au diagnostic, et ne révèle rien de secret. */
export function inspecterUrl() {
  const brut = process.env.SUPABASE_URL ?? '';
  const anomalies = [];
  if (!brut) return { brut, hote: null, anomalies: ['SUPABASE_URL est vide'] };
  if (brut !== brut.trim()) anomalies.push('espace ou saut de ligne au début ou à la fin');
  if (!/^https?:\/\//.test(brut.trim())) anomalies.push('il manque « https:// » au début');

  let hote = null;
  try {
    const u = new URL(brut.trim());
    hote = u.host;
    if (u.pathname !== '/' && u.pathname !== '') {
      anomalies.push(`l'adresse contient un chemin (« ${u.pathname} ») : il faut seulement la racine`);
    }
    if (u.host.includes('supabase.com')) {
      anomalies.push("c'est l'adresse du tableau de bord, pas celle du projet : il faut https://<référence>.supabase.co");
    } else if (!/\.supabase\.(co|in)$/.test(u.host)) {
      anomalies.push(`le nom d'hôte « ${u.host} » ne ressemble pas à une adresse Supabase`);
    }
  } catch {
    anomalies.push("l'adresse n'est pas une URL valide");
  }
  return { brut: brut.trim(), hote, anomalies };
}

function hoteLisible() {
  return inspecterUrl().hote ?? process.env.SUPABASE_URL ?? '(vide)';
}

function entetes(extra = {}) {
  return { apikey: CLE, Authorization: `Bearer ${CLE}`, 'Content-Type': 'application/json', ...extra };
}

/** Traduit les erreurs les plus fréquentes en conseil actionnable. */
function conseil(statut, corps) {
  if (statut === 401 || statut === 403) {
    return "clé refusée — vérifier SUPABASE_SERVICE_KEY (c'est la clé « service_role », pas la « anon »)";
  }
  if (statut === 404) return 'table ou fonction absente — le contenu de supabase/schema.sql a-t-il bien été exécuté ?';
  if (corps.includes('PGRST204') || corps.includes('does not exist')) {
    return 'colonne absente — rejouer supabase/schema.sql, qui a évolué depuis';
  }
  if (statut === 414) return 'adresse trop longue';
  return null;
}

async function rest(chemin, options = {}) {
  let rep;
  try {
    rep = await fetch(`${URL_BASE}/rest/v1/${chemin}`, { ...options, headers: entetes(options.headers) });
  } catch (e) {
    // Node range la vraie cause réseau dans `cause` : sans elle, « fetch failed »
    // ne distingue pas un nom d'hôte inexistant d'un projet en veille.
    const code = e.cause?.code ?? e.cause?.message ?? e.message;
    const explication = {
      ENOTFOUND: "ce nom d'hôte n'existe pas — l'URL est mal recopiée",
      EAI_AGAIN: "nom d'hôte irrésolu — l'URL est probablement mal recopiée",
      ECONNREFUSED: 'connexion refusée — le projet Supabase est peut-être en veille',
      CERT_HAS_EXPIRED: 'certificat expiré',
      ERR_INVALID_URL: "l'URL est mal formée — il manque https:// ou il y a un espace",
    }[code];
    throw new Error(
      `Supabase injoignable sur « ${hoteLisible()} » [${code}]`
      + (explication ? ` : ${explication}` : '')
    );
  }
  if (!rep.ok) {
    const corps = (await rep.text()).slice(0, 300);
    const aide = conseil(rep.status, corps);
    throw new Error(`Supabase ${rep.status} sur « ${chemin.split('?')[0]} »${aide ? ` : ${aide}` : ''} — ${corps}`);
  }
  const texte = await rep.text();
  return texte ? JSON.parse(texte) : null;
}

const ligne = (p, maintenant) => ({
  id: p.id, genre: p.genre, source: p.source, evenement: p.evenement ?? null, nom: p.nom,
  commune: p.commune ?? null, code_commune: p.codeCommune ?? null, code_postal: p.codePostal ?? null,
  adresse: p.adresse ?? null, naf: p.naf ?? null, activite: p.activite ?? null,
  siret: p.siret ?? null, siren: p.siren ?? null,
  telephone: p.telephone ?? null, site: p.site ?? null,
  dirigeants: p.dirigeants ?? null, capital: p.capital ?? null, employeur: !!p.employeur,
  date_fait: p.dateFait ?? null, url: p.url ?? null, score: p.score ?? 0,
  offres: p.offres ?? [], raisons: p.raisons ?? [], brut: p.brut ?? {},
  vu_le: p.vuLe ?? maintenant, maj_le: maintenant,
});

/**
 * Insère par paquets. `merge-duplicates` met à jour les fiches déjà connues.
 *
 * Les colonnes `statut` et `notes` ne figurent volontairement pas dans les lignes
 * envoyées : ce sont les seules saisies à la main, et PostgREST ne touche pas aux
 * colonnes absentes du corps. Une collecte ne peut donc jamais effacer le travail
 * de la semaine.
 */
export async function enregistrerLot(prospects) {
  if (!prospects.length) return { nouveaux: 0 };

  // On relit toute la table plutôt que d'interroger identifiant par identifiant : elle
  // tient dans quelques centaines de lignes, et il faut les colonnes complètes pour
  // pouvoir refusionner une entreprise déjà connue qui revient par l'autre source.
  const anciennes = new Map(
    (await rest('prospects?select=*&limit=100000')).map((r) => [r.id, r]),
  );
  const maintenant = new Date().toISOString();

  const aEcrire = prospects.map((entrant) => {
    const ancienne = anciennes.get(entrant.id);
    return ligne(ancienne ? fusionner(depuisLigne(ancienne), entrant) : entrant, maintenant);
  });

  for (let i = 0; i < aEcrire.length; i += 200) {
    await rest('prospects?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(aEcrire.slice(i, i + 200)),
    });
  }
  return { nouveaux: prospects.filter((p) => !anciennes.has(p.id)).length };
}

export async function journaliser(source, s) {
  await rest('collectes', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      source, examines: s.examines ?? 0, nouveaux: s.nouveaux ?? 0,
      ecartes: s.ecartes ?? 0, erreur: s.erreur ?? null,
    }),
  });
}

export async function nouveautesDepuis(iso) {
  return rest(`prospects?select=*&vu_le=gte.${iso}&score=gt.0&order=score.desc,date_fait.desc`);
}

export async function lister({ statut, genre, recherche } = {}) {
  const p = new URLSearchParams({ select: '*', 'score': 'gt.0', order: 'score.desc,date_fait.desc', limit: '400' });
  if (statut) p.set('statut', `eq.${statut}`);
  if (genre) p.set('genre', `eq.${genre}`);
  if (recherche) p.set('or', `(nom.ilike.*${recherche}*,commune.ilike.*${recherche}*,activite.ilike.*${recherche}*)`);
  return rest(`prospects?${p}`);
}

/** Toutes les fiches, sans filtre de score : sert à la migration et aux vérifications. */
export async function toutes() {
  return rest('prospects?select=*&limit=100000');
}

export async function majStatut(id, statut, notes) {
  const corps = { statut, maj_le: new Date().toISOString() };
  if (notes !== undefined) corps.notes = notes;
  await rest(`prospects?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(corps),
  });
}

export async function supprimer(id) {
  await rest(`prospects?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  });
}

export async function purger(jours = 365) {
  // La fonction SQL peut manquer si le schéma a été exécuté dans une version antérieure.
  // Ce n'est pas une raison pour perdre la collecte du jour : on se rabat sur une
  // suppression directe, qui fait exactement la même chose.
  try {
    const n = await rest('rpc/purger_anciennes', { method: 'POST', body: JSON.stringify({ jours }) });
    return Number(n) || 0;
  } catch {
    const limite = new Date(Date.now() - jours * 86400000).toISOString();
    const filtre = `vu_le=lt.${limite}&statut=in.(nouveau,sans_suite)`;
    const avant = await rest(`prospects?select=id&${filtre}`);
    if (!avant.length) return 0;
    await rest(`prospects?${filtre}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return avant.length;
  }
}

export async function purgerSansPotentiel() {
  const avant = await rest('prospects?select=id&score=lte.0&statut=eq.nouveau');
  if (!avant.length) return 0;
  await rest('prospects?score=lte.0&statut=eq.nouveau', {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  });
  return avant.length;
}

export async function aEnrichir() {
  // Sans filtre de source : une fiche fusionnée porte « bodacc+sirene », et toute
  // entreprise sans code d'activité mérite d'être complétée, d'où qu'elle vienne.
  return rest('prospects?select=id,brut,evenement,capital,commune,siren&genre=eq.entreprise&naf=is.null');
}

export async function majEnrichissement(id, v) {
  await rest(`prospects?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      naf: v.naf, activite: v.activite, employeur: !!v.employeur,
      score: v.score, offres: v.offres, raisons: v.raisons,
    }),
  });
}

export async function statistiques() {
  const compter = async (filtre = '') =>
    Number((await fetch(`${URL_BASE}/rest/v1/prospects?select=id${filtre}`, {
      headers: entetes({ Prefer: 'count=exact', Range: '0-0' }),
    })).headers.get('content-range')?.split('/')[1] ?? 0);

  const semaineISO = new Date(Date.now() - 7 * 86400000).toISOString();
  const lignes = await rest('prospects?select=statut');
  const parStatut = Object.entries(
    lignes.reduce((acc, r) => ((acc[r.statut] = (acc[r.statut] ?? 0) + 1), acc), {}),
  ).map(([statut, n]) => ({ statut, n }));

  return { total: await compter(), semaine: await compter(`&vu_le=gte.${semaineISO}`), parStatut };
}
