import { INSEE, INSEE_API_KEY, communeDepuisNom } from './config.js';
import { scorerEntreprise } from './score.js';
import { db } from './db.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Le BODACC publie la dénomination, l'adresse et les dirigeants, mais jamais le code
 * d'activité. Sans lui, une reprise de fonds de commerce — le meilleur signal du lot —
 * se retrouve notée comme une modification quelconque, parce que le score ne peut pas
 * savoir s'il s'agit d'une boulangerie ou d'un cabinet comptable.
 *
 * On récupère donc l'activité auprès de Sirene à partir du SIREN, puis on recalcule
 * le score. Une seule requête suffit pour 25 entreprises.
 */
export async function enrichirDepuisSirene() {
  if (!INSEE_API_KEY) return { examines: 0, enrichis: 0 };

  const aFaire = db.prepare(`
    SELECT id, brut, evenement, capital, commune
    FROM prospects
    WHERE genre = 'entreprise' AND naf IS NULL AND source = 'bodacc'
  `).all();

  const parSiren = new Map();
  for (const p of aFaire) {
    const siren = String(JSON.parse(p.brut ?? '{}').siren ?? '').replace(/\D/g, '');
    if (siren.length === 9) parSiren.set(siren, p);
  }

  const sirens = [...parSiren.keys()];
  const maj = db.prepare('UPDATE prospects SET naf=?, activite=?, employeur=?, score=?, offres=?, raisons=? WHERE id=?');
  let enrichis = 0;

  for (let i = 0; i < sirens.length; i += INSEE.communesParRequete) {
    const lot = sirens.slice(i, i + INSEE.communesParRequete);
    const q = `(${lot.map((s) => `siren:${s}`).join(' OR ')}) AND etablissementSiege:true`;
    const url = new URL(`${INSEE.base}/siret`);
    url.searchParams.set('q', q);
    url.searchParams.set('nombre', '1000');

    let data;
    try {
      const rep = await fetch(url, {
        headers: { 'X-INSEE-Api-Key-Integration': INSEE_API_KEY, Accept: 'application/json' },
      });
      if (rep.status === 404) { await pause(INSEE.pauseMs); continue; }
      if (!rep.ok) throw new Error(`Sirene ${rep.status}`);
      data = await rep.json();
    } catch {
      await pause(INSEE.pauseMs);
      continue; // l'enrichissement est un bonus : son échec ne doit pas casser la collecte
    }

    for (const e of data.etablissements ?? []) {
      const p = parSiren.get(e.siren);
      if (!p) continue;
      const per = e.periodesEtablissement?.[0] ?? {};
      const u = e.uniteLegale ?? {};
      const naf = per.activitePrincipaleEtablissement ?? u.activitePrincipaleUniteLegale;
      if (!naf) continue;

      const commune = communeDepuisNom(p.commune);
      const note = scorerEntreprise({
        naf,
        categorieJuridique: u.categorieJuridiqueUniteLegale,
        evenement: p.evenement,
        employeur: (per.caractereEmployeurEtablissement ?? u.caractereEmployeurUniteLegale) === 'O',
        capital: p.capital,
        population: commune?.pop,
      });

      maj.run(naf, note.activite, note.offres.includes('swile') ? 1 : 0,
        note.score, note.offres.join(','), note.raisons.join('\n'), p.id);
      enrichis++;
    }
    await pause(INSEE.pauseMs);
  }

  // Une SCI ou une holding révélée par l'enrichissement n'a plus rien à faire dans la base.
  const purgees = db.prepare("DELETE FROM prospects WHERE score <= 0 AND statut = 'nouveau'").run().changes;

  return { examines: sirens.length, enrichis, purgees };
}
