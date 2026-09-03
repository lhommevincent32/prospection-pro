import { createServer } from 'node:http';
import { lister, majStatut, supprimer, statistiques, STATUTS, LIBELLE_STATUT } from './store/index.js';
import { STYLE, echapper, dateFr, palier, pastillesOffres, libelleEvenement, listeRaisons } from './vue.js';

const PORT = Number(process.env.PORT ?? 4321);

function fiche(p) {
  const pal = palier(p.score);
  const lieu = [p.adresse, p.commune].filter(Boolean).join(', ');
  const meta = [
    p.genre === 'entreprise' ? libelleEvenement(p.evenement) : p.evenement,
    p.genre === 'entreprise' ? p.activite : null,
    lieu,
    p.date_fait ? dateFr(p.date_fait) : null,
  ].filter(Boolean).map(echapper).join(' · ');

  const raisons = listeRaisons(p.raisons);

  const options = STATUTS.map((s) =>
    `<option value="${s}"${s === p.statut ? ' selected' : ''}>${LIBELLE_STATUT[s]}</option>`).join('');

  return `
  <article class="fiche ${pal.cle}" data-id="${echapper(p.id)}">
    <div class="entete">
      <h3 class="nom">${p.url ? `<a href="${echapper(p.url)}" target="_blank" rel="noopener">${echapper(p.nom)}</a>` : echapper(p.nom)}</h3>
      <span class="note ${pal.cle}">${pal.libelle} · ${p.score}</span>
    </div>
    <p class="meta">${meta}</p>
    ${p.dirigeants ? `<p class="meta">Dirigeant : <b>${echapper(p.dirigeants)}</b></p>` : ''}
    ${raisons}
    <div class="offres">${pastillesOffres(p.offres)}</div>
    <div class="suivi">
      <select class="statut" aria-label="Statut de ${echapper(p.nom)}">${options}</select>
      <input class="notes" value="${echapper(p.notes)}" placeholder="Notes d'appel…" aria-label="Notes">
      <button class="oublier" title="Supprimer définitivement cette fiche (droit d'opposition)">Oublier</button>
      <span class="etat" aria-live="polite"></span>
    </div>
  </article>`;
}

async function page(prospects, filtres) {
  const s = await statistiques();
  const compte = Object.fromEntries(s.parStatut.map((r) => [r.statut, r.n]));
  const onglet = (val, lib) => {
    const actif = (filtres.statut ?? '') === val;
    const n = val ? (compte[val] ?? 0) : s.total;
    return `<a class="onglet${actif ? ' actif' : ''}" href="?${new URLSearchParams({ ...filtres, statut: val })}">${lib} <span>${n}</span></a>`;
  };

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prospection Nord-Gers</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${STYLE}
header{padding:30px 0 18px;border-bottom:2px solid var(--encre);margin-bottom:18px}
.barre{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;margin-top:16px}
.onglets{display:flex;flex-wrap:wrap;gap:4px}
.onglet{text-decoration:none;color:var(--gris);font-size:13.5px;padding:6px 11px;border-radius:4px;
  border:1px solid transparent}
.onglet:hover{background:var(--trait2)}
.onglet.actif{background:var(--surface);border-color:var(--trait);color:var(--encre);font-weight:600}
.onglet span{font:500 11.5px "IBM Plex Mono",ui-monospace,monospace;color:var(--gris);margin-left:3px}
form.rech{display:flex;gap:6px;flex-wrap:wrap}
form.rech input[name=q]{flex:1;min-width:150px}
@media (max-width:620px){
  .barre{flex-direction:column;align-items:stretch}
  form.rech{width:100%}
}
input,select,button{font:inherit;font-size:13.5px;padding:6px 9px;border:1px solid var(--trait);
  border-radius:4px;background:var(--surface);color:var(--encre)}
button{cursor:pointer}
button:hover{border-color:var(--vert);color:var(--vert)}
.suivi{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-top:12px;
  padding-top:12px;border-top:1px solid var(--trait2)}
.suivi .notes{flex:1;min-width:180px}
.suivi .oublier{color:var(--brique);border-color:var(--trait)}
.suivi .oublier:hover{border-color:var(--brique);background:var(--brique-clair)}
.etat{font-size:12px;color:var(--vert);min-width:56px}
.vide{color:var(--gris);font-style:italic;padding:26px 0;text-align:center}
:focus-visible{outline:2px solid var(--vert);outline-offset:2px}
</style></head><body>
<div class="enveloppe">
  <header>
    <h1>Prospection Nord-Gers</h1>
    <p class="sous">125 communes · ${s.semaine} nouvelle(s) fiche(s) cette semaine · ${s.total} au total</p>
    <div class="barre">
      <nav class="onglets">
        ${onglet('', 'Tous')}
        ${STATUTS.map((st) => onglet(st, LIBELLE_STATUT[st])).join('')}
      </nav>
      <form class="rech" method="get">
        <input type="hidden" name="statut" value="${echapper(filtres.statut ?? '')}">
        <select name="genre">
          <option value="">Tout</option>
          <option value="entreprise"${filtres.genre === 'entreprise' ? ' selected' : ''}>Entreprises</option>
          <option value="evenement"${filtres.genre === 'evenement' ? ' selected' : ''}>Événements</option>
        </select>
        <input name="q" value="${echapper(filtres.recherche ?? '')}" placeholder="Nom, commune, activité…">
        <button>Filtrer</button>
      </form>
    </div>
  </header>

  ${prospects.length ? prospects.map(fiche).join('') : '<p class="vide">Aucune fiche ne correspond à ce filtre.</p>'}
</div>

<script>
document.addEventListener('change', async (e) => {
  const carte = e.target.closest('.fiche');
  if (!carte || !e.target.matches('.statut, .notes')) return;
  await sauver(carte);
});
document.addEventListener('click', async (e) => {
  if (!e.target.matches('.oublier')) return;
  const carte = e.target.closest('.fiche');
  if (!confirm("Supprimer définitivement cette fiche ?\\n\\nÀ utiliser si la personne demande à ne plus être démarchée.")) return;
  await fetch('/api/prospect/' + encodeURIComponent(carte.dataset.id), { method: 'DELETE' });
  carte.remove();
});
async function sauver(carte) {
  const etat = carte.querySelector('.etat');
  const rep = await fetch('/api/prospect/' + encodeURIComponent(carte.dataset.id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      statut: carte.querySelector('.statut').value,
      notes: carte.querySelector('.notes').value,
    }),
  });
  etat.textContent = rep.ok ? 'Enregistré' : 'Échec';
  setTimeout(() => { etat.textContent = ''; }, 1800);
}
</script>
</body></html>`;
}

function corps(req) {
  return new Promise((res, rej) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch (e) { rej(e); } });
  });
}

createServer(async (req, rep) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  const api = url.pathname.match(/^\/api\/prospect\/(.+)$/);
  if (api) {
    const id = decodeURIComponent(api[1]);
    if (req.method === 'PATCH') {
      const { statut, notes } = await corps(req);
      if (!STATUTS.includes(statut)) {
        rep.writeHead(400).end('statut inconnu');
        return;
      }
      await majStatut(id, statut, notes);
      rep.writeHead(204).end();
      return;
    }
    if (req.method === 'DELETE') {
      await supprimer(id);
      rep.writeHead(204).end();
      return;
    }
  }

  if (url.pathname !== '/') { rep.writeHead(404).end('Introuvable'); return; }

  const filtres = {
    statut: url.searchParams.get('statut') || '',
    genre: url.searchParams.get('genre') || '',
    recherche: url.searchParams.get('q') || '',
  };
  const prospects = await lister({
    statut: filtres.statut || undefined,
    genre: filtres.genre || undefined,
    recherche: filtres.recherche || undefined,
  });
  rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  rep.end(await page(prospects, filtres));
}).listen(PORT, () => {
  console.log(`\nTableau de bord : http://localhost:${PORT}\n`);
});
