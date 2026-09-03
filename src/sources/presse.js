import { createHash } from 'node:crypto';
import { FLUX_PRESSE, COMMUNES, normaliser } from '../config.js';
import { scorerEvenement } from '../score.js';

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ', '#8217': '’' };

function decoder(s) {
  return (s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e) => ENTITES[e] ?? (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/\s+/g, ' ')
    .trim();
}

function champ(bloc, nom) {
  const m = bloc.match(new RegExp(`<${nom}[^>]*>([\\s\\S]*?)</${nom}>`, 'i'));
  return m ? decoder(m[1]) : null;
}

/**
 * Cherche une commune du secteur citée dans le texte. On compare sur les formes
 * normalisées et on retient la plus longue correspondance, pour que « Saint-Clar »
 * ne soit pas confondu avec un « Clar » isolé.
 */
function communeCitee(texte) {
  const t = normaliser(texte);
  let trouvee = null;
  for (const c of COMMUNES) {
    const n = normaliser(c.nom);
    if (n.length >= 4 && t.includes(n) && (!trouvee || n.length > normaliser(trouvee.nom).length)) {
      trouvee = c;
    }
  }
  return trouvee;
}

/**
 * Dépouille les flux de presse locale à la recherche d'événements à venir.
 *
 * Ces articles ne servent pas à repérer des créations d'entreprise — le test l'a
 * montré, le rendement y est nul. Ils servent à repérer les fêtes de village,
 * foires et ouvertures, dont les organisateurs sont des prospects pour la
 * distribution de flyers sur zone.
 */
export async function collecterPresse() {
  const stats = { examines: 0, nouveaux: 0, ecartes: 0 };
  const prospects = [];

  for (const flux of FLUX_PRESSE) {
    let xml;
    try {
      const rep = await fetch(flux.url, { headers: { 'User-Agent': 'veille-nord-gers/1.0' } });
      if (!rep.ok) { stats.ecartes++; continue; }
      xml = await rep.text();
    } catch { stats.ecartes++; continue; }

    for (const bloc of xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []) {
      stats.examines++;
      const titre = champ(bloc, 'title');
      const description = champ(bloc, 'description');
      const lien = champ(bloc, 'link');
      const date = champ(bloc, 'pubDate');
      if (!titre) { stats.ecartes++; continue; }

      const commune = communeCitee(`${titre} ${description ?? ''}`);
      const note = scorerEvenement({ titre, description, commune });
      if (!note || note.score <= 0) { stats.ecartes++; continue; }
      if (!commune) { stats.ecartes++; continue; } // sans commune du secteur, inexploitable

      prospects.push({
        id: `presse:${createHash('sha1').update(lien ?? titre).digest('hex').slice(0, 16)}`,
        genre: 'evenement',
        source: 'presse',
        evenement: note.type,
        nom: titre,
        commune: commune.nom,
        codeCommune: commune.code,
        adresse: null,
        activite: note.type,
        dateFait: date ? new Date(date).toISOString().slice(0, 10) : null,
        url: lien,
        score: note.score,
        offres: note.offres,
        raisons: note.raisons,
        brut: { journal: flux.nom, description },
      });
    }
  }
  return { prospects, stats };
}
