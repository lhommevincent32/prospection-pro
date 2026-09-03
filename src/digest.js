import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from './config.js';
import { nouveautesDepuis, statistiques } from './store/index.js';
import { STYLE, echapper, dateFr, palier, pastillesOffres, libelleEvenement, listeRaisons } from './vue.js';

const jours = Number(process.argv[2] ?? 7);
const depuis = new Date(Date.now() - jours * 86400000).toISOString();

const tout = await nouveautesDepuis(depuis);
const entreprises = tout.filter((p) => p.genre === 'entreprise');
const evenements = tout.filter((p) => p.genre === 'evenement');

function fiche(p) {
  const pal = palier(p.score);
  const lieu = [p.adresse, p.commune].filter(Boolean).join(', ');
  const meta = [
    p.genre === 'entreprise' ? `<b>${echapper(libelleEvenement(p.evenement))}</b>` : `<b>${echapper(p.evenement)}</b>`,
    p.activite && p.genre === 'entreprise' ? echapper(p.activite) : null,
    lieu ? echapper(lieu) : null,
    p.date_fait ? dateFr(p.date_fait) : null,
  ].filter(Boolean).join(' · ');

  const raisons = listeRaisons(p.raisons);

  return `
  <article class="fiche ${pal.cle}">
    <div class="entete">
      <h3 class="nom">${p.url ? `<a href="${echapper(p.url)}">${echapper(p.nom)}</a>` : echapper(p.nom)}</h3>
      <span class="note ${pal.cle}">${pal.libelle} · ${p.score}</span>
    </div>
    <p class="meta">${meta}</p>
    ${p.dirigeants ? `<p class="meta">Dirigeant : <b>${echapper(p.dirigeants)}</b></p>` : ''}
    ${raisons}
    <div class="offres">${pastillesOffres(p.offres)}</div>
  </article>`;
}

const s = await statistiques();
const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prospects de la semaine — Nord-Gers</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${STYLE}
header{padding:36px 0 22px;border-bottom:2px solid var(--encre);margin-bottom:8px}
.chiffres{display:flex;gap:26px;flex-wrap:wrap;margin-top:16px;font-size:13.5px;color:var(--gris)}
.chiffres b{display:block;font-size:24px;color:var(--encre);font-weight:600;line-height:1.1}
.vide{color:var(--gris);font-style:italic;padding:14px 0}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--trait);color:var(--gris);font-size:12.5px}
</style></head><body>
<div class="enveloppe">
  <header>
    <h1>Prospects de la semaine</h1>
    <p class="sous">Secteur Nord-Gers · 125 communes · ${dateFr(depuis)} au ${dateFr(new Date().toISOString())}</p>
    <div class="chiffres">
      <span><b>${entreprises.length}</b> mouvements d'entreprise</span>
      <span><b>${evenements.length}</b> événements à couvrir</span>
      <span><b>${s.total}</b> fiches au total</span>
    </div>
  </header>

  <h2 class="groupe-titre">Entreprises — colis, courrier, téléphonie, Swile</h2>
  ${entreprises.length ? entreprises.map(fiche).join('') : '<p class="vide">Aucun mouvement cette semaine.</p>'}

  <h2 class="groupe-titre">Événements locaux — distribution de flyers</h2>
  ${evenements.length ? evenements.map(fiche).join('') : '<p class="vide">Aucun événement repéré dans la presse cette semaine.</p>'}

  <footer>
    Sources : Sirene (INSEE), BODACC, presse locale. Les entreprises ayant exercé leur droit
    d'opposition à la diffusion sont exclues à la source et n'apparaissent jamais ici.
  </footer>
</div></body></html>`;

const sortie = join(RACINE, 'data/digest.html');
writeFileSync(sortie, html, 'utf8');

/**
 * Seconde sortie, sans les balises d'enveloppe : c'est le format attendu pour publier
 * la page en ligne et la consulter depuis le téléphone. Le contenu est identique.
 */
const fragment = html
  .replace(/^[\s\S]*?<head>/, '')
  .replace(/<\/head>\s*<body>/, '')
  .replace(/<\/body><\/html>\s*$/, '')
  .replace(/<meta[^>]*>\s*/g, '');
const sortieWeb = join(RACINE, 'data/digest-web.html');
writeFileSync(sortieWeb, fragment, 'utf8');

console.log(`\nRécapitulatif écrit :`);
console.log(`  ${sortie}      (à ouvrir ou à envoyer par mail)`);
console.log(`  ${sortieWeb}  (à publier pour consultation sur téléphone)`);
console.log(`\n  ${entreprises.length} entreprise(s), ${evenements.length} événement(s) sur ${jours} jours.\n`);
