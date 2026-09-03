/**
 * Choisit où ranger les fiches : Supabase si les identifiants sont présents,
 * SQLite local sinon. Les collecteurs ne savent pas lequel des deux ils alimentent.
 */

const distant = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

export const OU = distant ? 'Supabase' : 'SQLite local';

const store = distant
  ? await import('./supabase.js')
  : await import('./sqlite.js');

export const {
  enregistrerLot, journaliser, nouveautesDepuis, lister, majStatut,
  supprimer, purger, purgerSansPotentiel, aEnrichir, majEnrichissement, statistiques,
} = store;

/** Statuts de suivi, dans l'ordre du cycle de prospection. */
export const STATUTS = ['nouveau', 'a_appeler', 'appele', 'rdv', 'signe', 'sans_suite'];

export const LIBELLE_STATUT = {
  nouveau: 'Nouveau',
  a_appeler: 'À appeler',
  appele: 'Appelé',
  rdv: 'RDV pris',
  signe: 'Signé',
  sans_suite: 'Sans suite',
};
