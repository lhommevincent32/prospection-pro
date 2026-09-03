import { INSEE, INSEE_API_KEY, CODES_INSEE, communeDepuisCode } from '../config.js';
import { scorerEntreprise } from '../score.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function interroger(q, curseur = '*') {
  const url = new URL(`${INSEE.base}/siret`);
  url.searchParams.set('q', q);
  url.searchParams.set('nombre', '1000');
  url.searchParams.set('curseur', curseur);
  const rep = await fetch(url, {
    headers: { 'X-INSEE-Api-Key-Integration': INSEE_API_KEY, Accept: 'application/json' },
  });
  if (rep.status === 404) return { etablissements: [], header: { total: 0 } }; // aucun résultat
  if (!rep.ok) throw new Error(`Sirene a répondu ${rep.status} : ${(await rep.text()).slice(0, 200)}`);
  return rep.json();
}

function nomDe(u) {
  return (
    u.denominationUniteLegale ||
    [u.prenomUsuelUniteLegale ?? u.prenom1UniteLegale, u.nomUsageUniteLegale ?? u.nomUniteLegale]
      .filter(Boolean).join(' ') ||
    'Nom non communiqué'
  );
}

function adresseDe(a) {
  return [a.numeroVoieEtablissement, a.typeVoieEtablissement, a.libelleVoieEtablissement]
    .filter((x) => x && x !== '[ND]').join(' ').trim() || null;
}

/**
 * Récupère les établissements créés sur le secteur entre deux dates.
 *
 * Le filtre `statutDiffusionEtablissement:O` est posé DANS la requête, et non après
 * coup : 28 % des créations du secteur émanent d'entrepreneurs ayant exercé leur droit
 * d'opposition à la diffusion. Ces fiches ne doivent jamais entrer dans la base.
 */
export async function collecterSirene({ depuis, jusqua }) {
  if (!INSEE_API_KEY) throw new Error('INSEE_API_KEY absente du fichier .env');

  const periode = `dateCreationEtablissement:[${depuis} TO ${jusqua}]`;
  const stats = { examines: 0, nouveaux: 0, ecartes: 0 };
  const prospects = [];

  for (let i = 0; i < CODES_INSEE.length; i += INSEE.communesParRequete) {
    const lot = CODES_INSEE.slice(i, i + INSEE.communesParRequete);
    const communes = `(${lot.map((c) => `codeCommuneEtablissement:${c}`).join(' OR ')})`;
    // `etatAdministratifEtablissement` n'est pas filtrable côté requête (Sirene renvoie
    // une erreur de syntaxe) : il vit dans periodesEtablissement, on le vérifie à la lecture.
    const q = `${communes} AND ${periode} AND statutDiffusionEtablissement:O`;

    let curseur = '*';
    for (;;) {
      const data = await interroger(q, curseur);
      const lots = data.etablissements ?? [];
      for (const e of lots) {
        stats.examines++;
        const u = e.uniteLegale ?? {};
        const a = e.adresseEtablissement ?? {};
        // La période courante porte l'état, l'activité et le caractère employeur
        // de l'établissement lui-même — plus juste que ceux de l'unité légale.
        const p = e.periodesEtablissement?.[0] ?? {};
        if (p.etatAdministratifEtablissement && p.etatAdministratifEtablissement !== 'A') {
          stats.ecartes++; continue; // déjà fermé
        }
        const commune = communeDepuisCode(a.codeCommuneEtablissement);
        if (!commune) { stats.ecartes++; continue; }

        const base = {
          naf: p.activitePrincipaleEtablissement ?? u.activitePrincipaleUniteLegale,
          categorieJuridique: u.categorieJuridiqueUniteLegale,
          evenement: 'creation',
          employeur: (p.caractereEmployeurEtablissement ?? u.caractereEmployeurUniteLegale) === 'O',
          population: commune.pop,
        };
        const { score, offres, raisons, activite } = scorerEntreprise(base);
        if (score <= 0) { stats.ecartes++; continue; }

        prospects.push({
          id: `siret:${e.siret}`,
          genre: 'entreprise',
          source: 'sirene',
          evenement: 'creation',
          nom: nomDe(u),
          commune: commune.nom,
          codeCommune: commune.code,
          codePostal: a.codePostalEtablissement,
          adresse: adresseDe(a),
          naf: base.naf,
          activite,
          employeur: base.employeur,
          dateFait: e.dateCreationEtablissement,
          url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${e.siren}`,
          score, offres, raisons,
          brut: { siret: e.siret, siren: e.siren, categorieJuridique: base.categorieJuridique },
        });
      }
      const suivant = data.header?.curseurSuivant;
      if (!suivant || suivant === curseur || lots.length === 0) break;
      curseur = suivant;
      await pause(INSEE.pauseMs);
    }
    await pause(INSEE.pauseMs);
  }
  return { prospects, stats };
}
