import { collecterSirene } from './sources/sirene.js';
import { collecterBodacc } from './sources/bodacc.js';
import { collecterPresse } from './sources/presse.js';
import { enrichirDepuisSirene } from './enrichir.js';
import { enregistrerLot, journaliser, statistiques, purger, OU } from './store/index.js';
import { INSEE_API_KEY, COMMUNES } from './config.js';
import { inspecterUrl } from './store/supabase.js';

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

/** Ce qui a échoué, pour décider du code de sortie et l'afficher en clair à la fin. */
const echecs = [];

/**
 * Contrôle préalable de la configuration.
 *
 * Sans lui, une variable d'environnement oubliée se manifeste bien plus loin par une
 * erreur incompréhensible. On ne montre jamais les valeurs, seulement leur présence.
 */
function verifierConfiguration() {
  const distant = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  console.log('Configuration');
  console.log(`  communes du secteur     ${COMMUNES.length}`);
  console.log(`  INSEE_API_KEY           ${INSEE_API_KEY ? `présente (${INSEE_API_KEY.length} caractères)` : 'ABSENTE'}`);
  console.log(`  SUPABASE_URL            ${process.env.SUPABASE_URL ? 'présente' : 'absente'}`);
  console.log(`  SUPABASE_SERVICE_KEY    ${process.env.SUPABASE_SERVICE_KEY ? `présente (${process.env.SUPABASE_SERVICE_KEY.length} caractères)` : 'absente'}`);
  console.log(`  stockage retenu         ${OU}`);

  if (!INSEE_API_KEY) {
    console.log('\n  Sans clé INSEE, les créations d\'entreprises ne peuvent pas être collectées.');
    console.log('  À déposer dans Settings > Secrets and variables > Actions > Secrets.');
  }
  if (!distant && (process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_KEY)) {
    console.log('\n  Une seule des deux valeurs Supabase est renseignée : il en faut deux.');
    console.log('  Les fiches seront écrites en local et perdues à la fin de l\'exécution.');
  }
  if (distant) {
    // L'URL du projet n'est pas un secret : elle vit aussi dans la page web publique.
    // L'afficher permet de repérer une faute de recopie en un coup d'œil.
    const u = inspecterUrl();
    console.log(`  adresse Supabase        ${u.brut}`);
    for (const a of u.anomalies) console.log(`     /!\\  ${a}`);
  }
  console.log('');
}

async function lancer(nom, fn) {
  process.stdout.write(`  ${nom.padEnd(10)} `);
  try {
    const { prospects, stats } = await fn();
    const { nouveaux } = await enregistrerLot(prospects);
    stats.nouveaux = nouveaux;
    await journaliser(nom, stats).catch(() => {});
    console.log(`${String(stats.examines).padStart(5)} examinés · ${String(nouveaux).padStart(4)} nouveaux · ${stats.ecartes} écartés`);
    return nouveaux;
  } catch (err) {
    console.log(`ÉCHEC`);
    echecs.push({ etape: nom, message: err.message });
    await journaliser(nom, { erreur: err.message }).catch(() => {});
    return 0;
  }
}

/** Enveloppe les étapes qui ne sont pas des collecteurs, pour qu'un pépin n'annule pas tout. */
async function tenter(nom, fn, surEchec = null) {
  try {
    return await fn();
  } catch (err) {
    echecs.push({ etape: nom, message: err.message });
    return surEchec;
  }
}

const jours = Number(process.argv[2] ?? FENETRE_PAR_DEFAUT);
const { depuis, jusqua } = periode(jours);

console.log('');
verifierConfiguration();
console.log(`Collecte sur les ${jours} derniers jours (${depuis} → ${jusqua})\n`);

let total = 0;
total += await lancer('sirene', () => collecterSirene({ depuis, jusqua }));
total += await lancer('bodacc', () => collecterBodacc({ depuis }));
total += await lancer('presse', () => collecterPresse());

process.stdout.write('  enrichi    ');
const enr = await tenter('enrichissement', () => enrichirDepuisSirene(), { examines: 0, enrichis: 0 });
console.log(enr
  ? `${String(enr.examines).padStart(5)} SIREN    · ${String(enr.enrichis).padStart(4)} activités retrouvées`
  : 'ÉCHEC');

const purgees = await tenter('purge', () => purger(365), 0);
if (purgees) console.log(`\n  purge RGPD : ${purgees} fiche(s) de plus d'un an jamais travaillées, supprimées`);

const s = await tenter('statistiques', () => statistiques(), null);
if (s) {
  console.log(`\n${total} nouveau(x) prospect(s). Base : ${s.total} fiches, dont ${s.semaine} vues cette semaine.`);
} else {
  console.log(`\n${total} nouveau(x) prospect(s).`);
}

if (echecs.length) {
  console.log('\n--- Détail des échecs ---');
  for (const e of echecs) console.log(`  [${e.etape}] ${e.message}`);
}

// On n'échoue que si aucune source n'a rien pu ramener : un collecteur en panne ne doit
// pas masquer le travail des deux autres, mais un silence complet doit être signalé.
const sourcesEnEchec = echecs.filter((e) => ['sirene', 'bodacc', 'presse'].includes(e.etape));
if (sourcesEnEchec.length === 3) {
  console.log('\nLes trois sources ont échoué : la collecte est considérée en erreur.');
  process.exit(1);
}
if (echecs.length) {
  console.log('\nCollecte terminée malgré des erreurs partielles (voir ci-dessus).');
}
