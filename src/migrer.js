import { toutes, enregistrerLot, supprimer, majStatut, OU } from './store/index.js';
import { cleNaturelle, fusionnerLot, depuisLigne } from './fusion.js';

/**
 * Reprise des fiches enregistrées avant la fusion par SIREN.
 *
 * Jusqu'ici, une fiche Sirene était identifiée par son SIRET et une fiche BODACC par
 * son numéro d'annonce : la même société pouvait donc occuper deux lignes. Ce script
 * ré-identifie les fiches existantes par leur SIREN, fusionne celles qui se retrouvent
 * sous la même clé, et supprime les anciennes.
 *
 * Les statuts et les notes saisis à la main sont conservés : si l'une des deux fiches
 * a été travaillée, son statut est repris sur la fiche fusionnée.
 *
 *   node --env-file=.env src/migrer.js          simulation, n'écrit rien
 *   node --env-file=.env src/migrer.js --appliquer
 */

const appliquer = process.argv.includes('--appliquer');

const lignes = await toutes();
console.log(`\nStockage : ${OU}`);
console.log(`${lignes.length} fiche(s) en base.\n`);

/** Statut le plus avancé des fiches fusionnées : le travail fait ne doit pas se perdre. */
const RANG_STATUT = { nouveau: 0, sans_suite: 1, a_appeler: 2, appele: 3, rdv: 4, signe: 5 };

const groupes = new Map();
for (const l of lignes) {
  const p = depuisLigne(l);
  const cle = cleNaturelle({ ...p, cleSource: l.id });
  if (!groupes.has(cle)) groupes.set(cle, []);
  groupes.get(cle).push({ ligne: l, prospect: { ...p, id: cle } });
}

const aFusionner = [...groupes.entries()].filter(([, v]) => v.length > 1);
const aRenommer = [...groupes.entries()].filter(([cle, v]) => v.length === 1 && v[0].ligne.id !== cle);

console.log(`  ${groupes.size} entreprise(s) distincte(s)`);
console.log(`  ${aFusionner.length} groupe(s) à fusionner (${lignes.length - groupes.size} fiche(s) en trop)`);
console.log(`  ${aRenommer.length} fiche(s) à ré-identifier sans fusion\n`);

if (aFusionner.length) {
  console.log('Fusions prévues :');
  for (const [cle, membres] of aFusionner.slice(0, 12)) {
    console.log(`  ${cle}`);
    for (const m of membres) {
      const st = m.ligne.statut !== 'nouveau' ? ` [${m.ligne.statut}]` : '';
      console.log(`     ← ${m.ligne.source}/${m.ligne.evenement} · ${m.ligne.score} pts${st} · ${m.ligne.nom.slice(0, 40)}`);
    }
  }
  if (aFusionner.length > 12) console.log(`  … et ${aFusionner.length - 12} autre(s)`);
  console.log('');
}

if (!appliquer) {
  console.log('Simulation : rien n\'a été modifié.');
  console.log('Pour appliquer : node --env-file=.env src/migrer.js --appliquer\n');
  process.exit(0);
}

let fusionnees = 0;
let supprimees = 0;

for (const [cle, membres] of [...aFusionner, ...aRenommer]) {
  const consolidee = fusionnerLot(membres.map((m) => m.prospect))[0];

  // On retient le statut le plus avancé et on concatène les notes non vides.
  const meilleurStatut = membres
    .map((m) => m.ligne.statut ?? 'nouveau')
    .sort((a, b) => (RANG_STATUT[b] ?? 0) - (RANG_STATUT[a] ?? 0))[0];
  const notes = [...new Set(membres.map((m) => (m.ligne.notes ?? '').trim()).filter(Boolean))].join(' — ');

  await enregistrerLot([consolidee]);
  if (meilleurStatut !== 'nouveau' || notes) await majStatut(cle, meilleurStatut, notes);

  for (const m of membres) {
    if (m.ligne.id !== cle) { await supprimer(m.ligne.id); supprimees++; }
  }
  fusionnees++;
}

const apres = await toutes();
console.log(`${fusionnees} fiche(s) consolidée(s), ${supprimees} ancienne(s) supprimée(s).`);
console.log(`Base : ${lignes.length} → ${apres.length} fiches.\n`);
