/**
 * Stockage distant sur Supabase, via son API REST — aucune bibliothèque à installer,
 * `fetch` suffit. C'est ce stockage qu'utilise le robot de collecte hébergé, pour que
 * les fiches soient consultables depuis le téléphone.
 *
 * La clé de service contourne les règles d'accès : elle ne doit jamais quitter
 * le fichier .env local ni les secrets GitHub, et surtout jamais aller dans la page web.
 */

const URL_BASE = process.env.SUPABASE_URL ?? '';
const CLE = process.env.SUPABASE_SERVICE_KEY ?? '';

function entetes(extra = {}) {
  return { apikey: CLE, Authorization: `Bearer ${CLE}`, 'Content-Type': 'application/json', ...extra };
}

async function rest(chemin, options = {}) {
  const rep = await fetch(`${URL_BASE}/rest/v1/${chemin}`, { ...options, headers: entetes(options.headers) });
  if (!rep.ok) throw new Error(`Supabase ${rep.status} sur ${chemin} : ${(await rep.text()).slice(0, 300)}`);
  const texte = await rep.text();
  return texte ? JSON.parse(texte) : null;
}

const ligne = (p, maintenant) => ({
  id: p.id, genre: p.genre, source: p.source, evenement: p.evenement ?? null, nom: p.nom,
  commune: p.commune ?? null, code_commune: p.codeCommune ?? null, code_postal: p.codePostal ?? null,
  adresse: p.adresse ?? null, naf: p.naf ?? null, activite: p.activite ?? null,
  siret: p.siret ?? null, siren: p.siren ?? null,
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

  const ids = prospects.map((p) => `"${p.id}"`).join(',');
  const connus = new Set(
    (await rest(`prospects?select=id&id=in.(${encodeURIComponent(ids)})`)).map((r) => r.id),
  );
  const maintenant = new Date().toISOString();

  for (let i = 0; i < prospects.length; i += 200) {
    const paquet = prospects.slice(i, i + 200).map((p) => ligne(p, maintenant));
    await rest('prospects?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(paquet),
    });
  }
  return { nouveaux: prospects.filter((p) => !connus.has(p.id)).length };
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
  const n = await rest('rpc/purger_anciennes', { method: 'POST', body: JSON.stringify({ jours }) });
  return Number(n) || 0;
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
  return rest("prospects?select=id,brut,evenement,capital,commune&genre=eq.entreprise&naf=is.null&source=eq.bodacc");
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
