import { collecterSirene } from './sources/sirene.js';
import { collecterBodacc } from './sources/bodacc.js';
import { collecterPresse } from './sources/presse.js';
import { enrichirDepuisSirene } from './enrichir.js';
import { enregistrerLot, journaliser, statistiques, purger, OU } from './store/index.js';

const jour = (d) => d.toISOString().slice(0, 10);

/**
 * Fenêtre de collecte, volontairement large.
 *
 * Sirene publie avec un décalage important : mesuré sur ce secteur, un mois écoulé
 * n'affiche d'abord qu'un tiers de ses créations, et se remplit sur les semaines
 * suivantes (36 pour août contre 94 pour mars, au même instant). Ratisser seulement
 * les 7 derniers jours ferait perdre définitivement les créations publiées en retard.
 *
 * On repasse donc sur 45 jours à chaque fois : le dédoublonnage par clé naturelle
 * fait que seules les fiches réellement nouvelles remontent dans l'email.
 */
const FENETRE_PAR_DEFAUT = 45;

function periode(joursEnArriere) {
  const fin = new Date();
  const debut = new Date(Date.now() - joursEnArriere * 86400000);
  return { depuis: jour(debut), jusqua: jour(fin) };
}

async function lancer(nom, fn) {
  process.stdout.write(`  ${nom.padEnd(10)} `);
  try {
    const { prospects, stats } = await fn();
    const { nouveaux } = await enregistrerLot(prospects);
    stats.nouveaux = nouveaux;
    await journaliser(nom, stats);
    console.log(`${String(stats.examines).padStart(5)} examinés · ${String(nouveaux).padStart(4)} nouveaux · ${stats.ecartes} écartés`);
    return nouveaux;
  } catch (err) {
    await journaliser(nom, { erreur: err.message });
    console.log(`échec — ${err.message}`);
    return 0;
  }
}

const jours = Number(process.argv[2] ?? FENETRE_PAR_DEFAUT);
const { depuis, jusqua } = periode(jours);

console.log(`\nCollecte sur les ${jours} derniers jours (${depuis} → ${jusqua})\n`);

let total = 0;
total += await lancer('sirene', () => collecterSirene({ depuis, jusqua }));
total += await lancer('bodacc', () => collecterBodacc({ depuis }));
total += await lancer('presse', () => collecterPresse());

process.stdout.write('  enrichi    ');
const enr = await enrichirDepuisSirene();
console.log(`${String(enr.examines).padStart(5)} SIREN    · ${String(enr.enrichis).padStart(4)} activités retrouvées`);

const purgees = await purger(365);
if (purgees) console.log(`\n  purge RGPD : ${purgees} fiche(s) de plus d'un an jamais travaillées, supprimées`);

const s = await statistiques();
console.log(`\n${total} nouveau(x) prospect(s). Base : ${s.total} fiches, dont ${s.semaine} vues cette semaine.`);
console.log(`\nPour voir le tableau de bord :  npm start\n`);
