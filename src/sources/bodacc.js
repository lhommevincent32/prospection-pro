import { BODACC, CODES_POSTAUX, communeDepuisNom } from '../config.js';
import { scorerEntreprise } from '../score.js';

/** Familles d'annonces exploitables, et l'événement commercial qu'elles signalent. */
const FAMILLES = {
  creation: 'creation',
  immatriculation: 'creation',
  vente: 'vente',
  modification: 'modification',
};

function jsonSur(champ) {
  if (!champ) return null;
  try { return typeof champ === 'string' ? JSON.parse(champ) : champ; } catch { return null; }
}

/** Le BODACC empile les dirigeants dans une chaîne libre. On la nettoie sans la découper. */
function dirigeantsDe(personnes) {
  const p = jsonSur(personnes)?.personne;
  if (!p) return null;
  return (p.administration ?? '').replace(/\s+/g, ' ').trim() || null;
}

function capitalDe(personnes) {
  const p = jsonSur(personnes)?.personne;
  const montant = Number(p?.capital?.montantCapital);
  return Number.isFinite(montant) ? Math.round(montant) : null;
}

function adresseDe(personnes) {
  const a = jsonSur(personnes)?.personne?.adresseSiegeSocial;
  if (!a) return null;
  return [a.numeroVoie, a.typeVoie, a.nomVoie].filter(Boolean).join(' ').trim() || null;
}

/**
 * Une modification peut être un transfert de siège, un changement de dirigeant, ou
 * un détail administratif sans intérêt. On lit le texte de l'annonce pour trancher :
 * seuls les deux premiers cas valent un appel.
 */
function preciserModification(modifications) {
  const texte = JSON.stringify(jsonSur(modifications) ?? '').toLowerCase();
  if (texte.includes('transfert') || texte.includes('nouvelle adresse') || texte.includes('siège social')) {
    return 'transfert';
  }
  if (texte.includes('président') || texte.includes('gérant') || texte.includes('directeur')
      || texte.includes('administration')) {
    return 'dirigeant';
  }
  return null; // modification sans portée commerciale : on ne la remonte pas
}

/**
 * Récupère les annonces du BODACC pour le secteur.
 *
 * Le filtrage se fait en deux temps : d'abord par code postal pour alléger la requête,
 * puis par nom de commune — car 57 communes hors secteur partagent un code postal avec
 * le nôtre, dont Nogaro, Mauvezin et Sainte-Christie, précisément exclues du secteur.
 */
export async function collecterBodacc({ depuis }) {
  const stats = { examines: 0, nouveaux: 0, ecartes: 0 };
  const prospects = [];
  const cps = CODES_POSTAUX.map((c) => `'${c}'`).join(',');
  const familles = Object.keys(FAMILLES).map((f) => `'${f}'`).join(',');

  let offset = 0;
  for (;;) {
    const url = new URL(BODACC);
    url.searchParams.set('where', `cp IN (${cps}) AND familleavis IN (${familles}) AND dateparution >= date'${depuis}'`);
    url.searchParams.set('order_by', 'dateparution desc');
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', String(offset));

    const rep = await fetch(url);
    if (!rep.ok) throw new Error(`BODACC a répondu ${rep.status}`);
    const data = await rep.json();
    const lots = data.results ?? [];
    if (lots.length === 0) break;

    for (const a of lots) {
      stats.examines++;
      const commune = communeDepuisNom(a.ville);
      if (!commune) { stats.ecartes++; continue; } // hors secteur malgré le code postal

      let evenement = FAMILLES[a.familleavis];
      if (evenement === 'modification') {
        evenement = preciserModification(a.modificationsgenerales);
        if (!evenement) { stats.ecartes++; continue; }
      }

      const capital = capitalDe(a.listepersonnes);
      const personne = jsonSur(a.listepersonnes)?.personne ?? {};
      const base = {
        naf: null, // le BODACC ne publie pas le code NAF ; Sirene le complètera
        categorieJuridique: null,
        evenement,
        employeur: false,
        capital,
        population: commune.pop,
      };
      const { score, offres, raisons, activite } = scorerEntreprise(base);
      if (score <= 0) { stats.ecartes++; continue; }

      const siren = (Array.isArray(a.registre) ? a.registre[0] : a.registre) ?? a.numeroannonce;
      prospects.push({
        id: `bodacc:${a.id}`,
        genre: 'entreprise',
        source: 'bodacc',
        evenement,
        nom: a.commercant || personne.denomination || 'Sans dénomination',
        commune: commune.nom,
        codeCommune: commune.code,
        codePostal: a.cp,
        adresse: adresseDe(a.listepersonnes),
        naf: null,
        activite,
        dirigeants: dirigeantsDe(a.listepersonnes),
        capital,
        dateFait: a.dateparution,
        url: a.url_complete,
        score, offres, raisons,
        brut: { siren, formeJuridique: personne.formeJuridique, tribunal: a.tribunal },
      });
    }

    offset += lots.length;
    if (offset >= (data.total_count ?? 0) || offset >= 900) break; // l'API plafonne à 1000
  }
  return { prospects, stats };
}
