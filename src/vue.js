import { LIBELLE_OFFRE } from './score.js';
import { LIBELLE_STATUT } from './db.js';

export function echapper(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function dateFr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(+d) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const LIBELLE_EVENEMENT = {
  creation: 'Création',
  vente: 'Reprise de fonds',
  transfert: 'Déménagement',
  dirigeant: 'Nouveau dirigeant',
  modification: 'Modification',
};

export function libelleEvenement(e) {
  return LIBELLE_EVENEMENT[e] ?? e ?? '';
}

/** Trois paliers de lecture : ce qu'on appelle, ce qu'on regarde, ce qu'on garde au chaud. */
export function palier(score) {
  if (score >= 60) return { cle: 'fort', libelle: 'Prioritaire' };
  if (score >= 35) return { cle: 'moyen', libelle: 'À regarder' };
  return { cle: 'faible', libelle: 'Secondaire' };
}

export function pastillesOffres(offres) {
  return (offres ?? '')
    .split(',')
    .filter(Boolean)
    .map((o) => `<span class="offre offre-${o}">${echapper(LIBELLE_OFFRE[o] ?? o)}</span>`)
    .join('');
}

export { LIBELLE_STATUT };

/** Palette et mise en forme communes au tableau de bord et à l'email. */
export const STYLE = `
:root{
  --encre:#141C26; --encre2:#3A4759; --gris:#6E7B8C; --trait:#DDE3EA; --trait2:#EAEFF4;
  --fond:#F5F7F9; --surface:#FFFFFF;
  --vert:#0D6E6E; --vert-clair:#E2EFEE;
  --ambre:#7E6318; --ambre-clair:#F6EEDA;
  --brique:#9C4A2F; --brique-clair:#F6E7E1;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --encre:#E6EDF3; --encre2:#B7C3D1; --gris:#7E8B9C; --trait:#26313F; --trait2:#1D2733;
  --fond:#0E141B; --surface:#161F29;
  --vert:#59C4B8; --vert-clair:#11302E;
  --ambre:#CBAA55; --ambre-clair:#2A2415;
  --brique:#DE8D71; --brique-clair:#2E1F19;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--fond);color:var(--encre);
  font:15px/1.55 "Public Sans","Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--vert)}
.enveloppe{max-width:1080px;margin:0 auto;padding:0 20px 80px}
h1{font-size:26px;letter-spacing:-.01em;margin:0 0 4px}
.sous{color:var(--gris);font-size:14px;margin:0}
.fiche{background:var(--surface);border:1px solid var(--trait);border-radius:5px;
  padding:16px 18px;margin-bottom:10px;border-left:4px solid var(--trait)}
.fiche.fort{border-left-color:var(--vert)}
.fiche.moyen{border-left-color:var(--ambre)}
.fiche.faible{border-left-color:var(--trait)}
.entete{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between}
.nom{font-size:16.5px;font-weight:700;letter-spacing:-.005em;margin:0}
.note{font:600 12px/1 "IBM Plex Mono",ui-monospace,monospace;padding:4px 8px;border-radius:3px;white-space:nowrap}
.note.fort{background:var(--vert-clair);color:var(--vert)}
.note.moyen{background:var(--ambre-clair);color:var(--ambre)}
.note.faible{background:var(--trait2);color:var(--gris)}
.meta{color:var(--gris);font-size:13px;margin:3px 0 9px}
.meta b{color:var(--encre2);font-weight:600}
.raisons{margin:0 0 10px;padding:0;list-style:none;font-size:13.5px;color:var(--encre2)}
.raisons li{padding-left:14px;position:relative;margin-bottom:3px}
.raisons li::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;
  border-radius:50%;background:var(--trait)}
.offres{display:flex;flex-wrap:wrap;gap:5px}
.offre{font:500 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.04em;
  text-transform:uppercase;padding:4px 7px;border-radius:3px;background:var(--trait2);color:var(--encre2)}
.offre-colis,.offre-flyers{background:var(--vert-clair);color:var(--vert)}
.groupe-titre{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--gris);
  font-weight:600;margin:32px 0 12px;padding-bottom:7px;border-bottom:1px solid var(--trait)}
`;
