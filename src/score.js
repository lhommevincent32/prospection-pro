/**
 * Attribution d'un potentiel commercial à chaque prospect, en fonction des offres
 * réellement proposées : colis (Colissimo / Chronopost), courrier et courrier non
 * adressé (distribution de flyers sur zone), téléphonie (Bbox Pro, La Poste Mobile)
 * et avantages salariés (Swile).
 *
 * Le score n'est pas une vérité, c'est un ordre de lecture : il sert à mettre en haut
 * de l'email du lundi ce qui mérite un appel, et à faire descendre les SCI.
 */

/** Familles d'activité repérées par préfixe de code NAF. Le plus long préfixe gagne. */
const ACTIVITES = [
  // --- Très fort potentiel colis : ces gens expédient, c'est leur métier ---
  { naf: '47.91', libelle: 'Vente à distance', points: 45, offres: ['colis', 'courrier'],
    note: "E-commerce : l'expédition est au cœur de son activité." },
  { naf: '47.99', libelle: 'Vente hors magasin', points: 30, offres: ['colis'] },
  { naf: '82.92', libelle: 'Conditionnement', points: 30, offres: ['colis'] },

  // --- Commerce avec local : boutique physique, donc connexion + colis + flyers ---
  { naf: '47.', libelle: 'Commerce de détail', points: 32, offres: ['colis', 'telecom', 'flyers'],
    note: 'Boutique : besoin internet/caisse, envois clients, et communication locale.' },
  { naf: '56.', libelle: 'Restauration', points: 26, offres: ['telecom', 'flyers'],
    note: 'Local ouvert au public : connexion, et flyers à chaque changement de carte.' },
  { naf: '96.02', libelle: 'Coiffure et beauté', points: 24, offres: ['telecom', 'flyers'] },
  { naf: '93.13', libelle: 'Salle de sport', points: 24, offres: ['telecom', 'flyers'] },
  { naf: '55.', libelle: 'Hébergement', points: 22, offres: ['telecom', 'flyers'] },

  // --- Artisanat du bâtiment : gros consommateurs de flyers de zone ---
  { naf: '43.', libelle: 'Travaux de construction', points: 28, offres: ['flyers', 'telecom'],
    note: 'Artisan du bâtiment : la prospection par boîtage sur une zone est son canal naturel.' },
  { naf: '41.', libelle: 'Construction de bâtiments', points: 22, offres: ['flyers', 'telecom'] },
  { naf: '81.', libelle: 'Services aux bâtiments', points: 22, offres: ['flyers'] },
  { naf: '01.6', libelle: 'Services agricoles', points: 16, offres: ['flyers'] },

  // --- Production artisanale : expédie ses produits ---
  { naf: '10.', libelle: 'Industrie alimentaire', points: 30, offres: ['colis', 'flyers'],
    note: 'Producteur local : vente en ligne et expédition très fréquentes dans le Gers.' },
  { naf: '11.02', libelle: 'Vinification', points: 34, offres: ['colis'],
    note: 'Domaine viticole : expéditions de bouteilles, très gros potentiel colis.' },
  { naf: '32.', libelle: 'Fabrication diverse', points: 24, offres: ['colis'] },
  { naf: '13.', libelle: 'Textile', points: 22, offres: ['colis'] },

  // --- Services : potentiel courrier et téléphonie, peu de colis ---
  { naf: '86.', libelle: 'Santé', points: 14, offres: ['courrier', 'telecom'] },
  { naf: '69.', libelle: 'Juridique et comptable', points: 16, offres: ['courrier'],
    note: 'Gros volume de courrier sortant.' },
  { naf: '85.', libelle: 'Enseignement', points: 12, offres: ['courrier', 'flyers'] },
  { naf: '68.3', libelle: 'Agences immobilières', points: 22, offres: ['flyers', 'courrier'],
    note: 'Le boîtage sur zone est un outil quotidien du métier.' },

  // --- À écarter : ces structures ne consomment rien de ce qu'on vend ---
  { naf: '68.20', libelle: 'Location immobilière (SCI)', points: -100, offres: [],
    note: 'SCI : structure patrimoniale, sans activité commerciale.' },
  { naf: '64.20', libelle: 'Holding', points: -100, offres: [], note: 'Holding : aucun besoin opérationnel.' },
  { naf: '64.', libelle: 'Activités financières', points: -60, offres: [] },
  { naf: '70.10', libelle: 'Siège social', points: -60, offres: [] },
];

/** Catégories juridiques à écarter d'office (SCI, sociétés civiles, holdings). */
const FORMES_ECARTEES = new Set(['6540', '6541', '6521', '6532', '6533', '6534', '6535', '6539']);

function activitePour(naf) {
  if (!naf) return null;
  const code = String(naf).replace(/\s/g, '');
  let trouve = null;
  for (const a of ACTIVITES) {
    if (code.startsWith(a.naf) && (!trouve || a.naf.length > trouve.naf.length)) trouve = a;
  }
  return trouve;
}

/**
 * Score un mouvement d'entreprise.
 * @returns {{score:number, offres:string[], raisons:string[], activite:string|null}}
 */
export function scorerEntreprise(p) {
  const raisons = [];
  const offres = new Set();
  let score = 0;

  const act = activitePour(p.naf);
  if (act) {
    score += act.points;
    act.offres.forEach((o) => offres.add(o));
    if (act.points <= -60) raisons.push(act.note ?? `${act.libelle} : sans potentiel.`);
    else raisons.push(act.note ?? `${act.libelle}.`);
  }

  if (FORMES_ECARTEES.has(String(p.categorieJuridique ?? ''))) {
    score -= 100;
    raisons.push('Société civile ou patrimoniale : à écarter.');
  }

  // Le type d'événement pèse autant que l'activité : une reprise de fonds vaut mieux
  // qu'une création, parce que les contrats existent déjà et sont remis à plat.
  switch (p.evenement) {
    case 'vente':
      score += 35;
      offres.add('colis').add('telecom').add('courrier');
      raisons.push('Reprise de fonds de commerce : le repreneur renégocie tous ses contrats.');
      break;
    case 'transfert':
      score += 25;
      offres.add('courrier').add('telecom');
      raisons.push('Déménagement : réexpédition du courrier et nouvelle ligne à prévoir.');
      break;
    case 'dirigeant':
      score += 15;
      raisons.push('Nouveau dirigeant : interlocuteur neuf, ouvert à un réexamen des coûts.');
      break;
    case 'creation':
      score += 10;
      raisons.push('Création récente : aucun contrat en place, mais volumes à construire.');
      break;
    case 'modification':
      score += 5;
      break;
  }

  if (p.employeur) {
    score += 12;
    offres.add('swile');
    raisons.push('Employeur : éligible aux titres restaurant et titres cadeaux.');
  }

  if (p.capital && p.capital >= 10000) {
    score += 8;
    raisons.push(`Capital de ${p.capital.toLocaleString('fr-FR')} € : projet financé.`);
  }

  // Une commune de plus de 1 500 habitants a un vrai tissu commercial ;
  // en dessous, l'activité est souvent domiciliée sans local.
  if (p.population && p.population >= 1500) score += 6;

  return {
    score: Math.max(0, Math.min(100, score)),
    offres: [...offres],
    raisons,
    activite: act?.libelle ?? null,
  };
}

/** Événements locaux : les organisateurs sont des prospects pour la distribution de flyers. */
const MOTS_EVENEMENT = [
  { mots: ['fête locale', 'fêtes locales', 'fête du village', 'comité des fêtes'], points: 40, type: 'Fête locale' },
  { mots: ['festival'], points: 38, type: 'Festival' },
  { mots: ['vide-grenier', 'vide grenier', 'brocante', 'braderie'], points: 34, type: 'Brocante' },
  { mots: ['marché de noël', 'marché gourmand', 'marché nocturne'], points: 34, type: 'Marché événementiel' },
  { mots: ['foire', 'salon', 'comice'], points: 32, type: 'Foire ou salon' },
  { mots: ['portes ouvertes', 'inauguration', "ouvre ses portes", "s'installe"], points: 36, type: 'Ouverture' },
  { mots: ['loto', 'thé dansant', 'repas de quartier', 'bal'], points: 26, type: 'Animation associative' },
  { mots: ['concert', 'spectacle', 'exposition'], points: 24, type: 'Spectacle' },
  { mots: ['course', 'randonnée', 'tournoi', 'trail'], points: 22, type: 'Événement sportif' },
];

/**
 * Score un article de presse. Un événement à venir sur une commune du secteur est
 * une occasion de proposer une distribution de flyers — à condition qu'il reste
 * assez de délai pour organiser le boîtage.
 */
export function scorerEvenement({ titre, description, commune }) {
  const texte = `${titre ?? ''} ${description ?? ''}`.toLowerCase();
  const raisons = [];
  let score = 0;
  let type = null;

  for (const m of MOTS_EVENEMENT) {
    if (m.mots.some((mot) => texte.includes(mot))) {
      if (m.points > score) {
        score = m.points;
        type = m.type;
      }
    }
  }
  if (!score) return null;

  raisons.push(`${type} : l'organisateur a besoin de faire connaître l'événement.`);

  if (commune) {
    score += 20;
    raisons.push(`Sur ${commune.nom}, dans ton secteur de distribution.`);
    if (commune.pop >= 1000) score += 5;
  }

  // Un événement annoncé pour dans plusieurs semaines laisse le temps d'organiser
  // le boîtage ; annoncé pour demain, c'est trop tard pour vendre quoi que ce soit.
  const dansXjours = delaiAnnonce(texte);
  if (dansXjours !== null) {
    if (dansXjours >= 21) {
      score += 15;
      raisons.push(`Annoncé pour dans ~${dansXjours} jours : le délai permet d'organiser une distribution.`);
    } else if (dansXjours <= 7) {
      score -= 20;
      raisons.push('Événement imminent : trop tard pour une distribution, mais utile pour le contact.');
    }
  }

  return { score: Math.max(0, Math.min(100, score)), type, raisons, offres: ['flyers'] };
}

const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

/** Estime, très grossièrement, dans combien de jours l'événement a lieu. `null` si indéterminable. */
function delaiAnnonce(texte) {
  const m = texte.match(/\b(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/);
  if (!m) return null;
  const jour = Number(m[1]);
  const mois = MOIS.indexOf(m[2]);
  const now = new Date();
  let cible = new Date(now.getFullYear(), mois, jour);
  if (cible < now) cible = new Date(now.getFullYear() + 1, mois, jour);
  return Math.round((cible - now) / 86400000);
}

export const LIBELLE_OFFRE = {
  colis: 'Colis',
  courrier: 'Courrier',
  flyers: 'Flyers',
  telecom: 'Téléphonie',
  swile: 'Swile',
};
