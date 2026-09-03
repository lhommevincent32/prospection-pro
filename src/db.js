import { DatabaseSync } from 'node:sqlite';
import { BASE_SQLITE } from './config.js';

export const db = new DatabaseSync(BASE_SQLITE);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS prospects (
  id            TEXT PRIMARY KEY,      -- clé naturelle : siret, siren+date, ou hash d'URL
  genre         TEXT NOT NULL,         -- 'entreprise' | 'evenement'
  source        TEXT NOT NULL,         -- 'sirene' | 'bodacc' | 'presse'
  evenement     TEXT,                  -- creation | vente | transfert | dirigeant | modification
  nom           TEXT NOT NULL,
  commune       TEXT,
  code_commune  TEXT,
  code_postal   TEXT,
  adresse       TEXT,
  naf           TEXT,
  activite      TEXT,
  dirigeants    TEXT,
  capital       INTEGER,
  employeur     INTEGER DEFAULT 0,
  date_fait     TEXT,                  -- date de création / parution / événement
  url           TEXT,
  score         INTEGER DEFAULT 0,
  offres        TEXT,                  -- liste séparée par des virgules
  raisons       TEXT,                  -- pourquoi ce score, une raison par ligne
  brut          TEXT,                  -- payload d'origine, pour ne rien perdre
  vu_le         TEXT NOT NULL,         -- première fois que la collecte l'a vu
  statut        TEXT NOT NULL DEFAULT 'nouveau',
  notes         TEXT DEFAULT '',
  maj_le        TEXT
);

CREATE INDEX IF NOT EXISTS idx_prospects_tri    ON prospects(statut, score DESC, date_fait DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_vu     ON prospects(vu_le);
CREATE INDEX IF NOT EXISTS idx_prospects_genre  ON prospects(genre);

CREATE TABLE IF NOT EXISTS collectes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lancee_le  TEXT NOT NULL,
  source     TEXT NOT NULL,
  examines   INTEGER DEFAULT 0,
  nouveaux   INTEGER DEFAULT 0,
  ecartes    INTEGER DEFAULT 0,
  erreur     TEXT
);
`);

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

const INSERT = db.prepare(`
  INSERT INTO prospects (id, genre, source, evenement, nom, commune, code_commune, code_postal,
                         adresse, naf, activite, dirigeants, capital, employeur, date_fait, url,
                         score, offres, raisons, brut, vu_le, maj_le)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    score  = excluded.score,
    offres = excluded.offres,
    raisons= excluded.raisons,
    maj_le = excluded.maj_le
`);

/**
 * Enregistre un prospect. Le conflit sur la clé naturelle assure qu'une même
 * entreprise vue par Sirene puis par le BODACC ne crée pas deux fiches, et que
 * le statut de suivi saisi à la main n'est jamais écrasé par une collecte.
 * @returns {boolean} vrai s'il s'agit d'une fiche nouvelle
 */
export function enregistrer(p) {
  const existe = db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(p.id);
  const maintenant = new Date().toISOString();
  INSERT.run(
    p.id, p.genre, p.source, p.evenement ?? null, p.nom,
    p.commune ?? null, p.codeCommune ?? null, p.codePostal ?? null,
    p.adresse ?? null, p.naf ?? null, p.activite ?? null,
    p.dirigeants ?? null, p.capital ?? null, p.employeur ? 1 : 0,
    p.dateFait ?? null, p.url ?? null,
    p.score ?? 0, (p.offres ?? []).join(','), (p.raisons ?? []).join('\n'),
    JSON.stringify(p.brut ?? {}), p.vuLe ?? maintenant, maintenant,
  );
  return !existe;
}

export function journaliser(source, stats) {
  db.prepare(
    'INSERT INTO collectes (lancee_le, source, examines, nouveaux, ecartes, erreur) VALUES (?,?,?,?,?,?)',
  ).run(new Date().toISOString(), source, stats.examines ?? 0, stats.nouveaux ?? 0, stats.ecartes ?? 0, stats.erreur ?? null);
}

/** Prospects apparus depuis une date, les mieux notés d'abord. */
export function nouveautesDepuis(iso) {
  return db.prepare(
    `SELECT * FROM prospects WHERE vu_le >= ? AND score > 0 ORDER BY score DESC, date_fait DESC`,
  ).all(iso);
}

export function lister({ statut, genre, recherche, min = 0 } = {}) {
  const clauses = ['score >= ?'];
  const args = [min];
  if (statut) { clauses.push('statut = ?'); args.push(statut); }
  if (genre) { clauses.push('genre = ?'); args.push(genre); }
  if (recherche) {
    clauses.push('(nom LIKE ? OR commune LIKE ? OR activite LIKE ?)');
    const q = `%${recherche}%`;
    args.push(q, q, q);
  }
  return db.prepare(
    `SELECT * FROM prospects WHERE ${clauses.join(' AND ')} ORDER BY score DESC, date_fait DESC LIMIT 400`,
  ).all(...args);
}

export function majStatut(id, statut, notes) {
  const champs = ['statut = ?', 'maj_le = ?'];
  const args = [statut, new Date().toISOString()];
  if (notes !== undefined) { champs.splice(1, 0, 'notes = ?'); args.splice(1, 0, notes); }
  args.push(id);
  db.prepare(`UPDATE prospects SET ${champs.join(', ')} WHERE id = ?`).run(...args);
}

export function supprimer(id) {
  db.prepare('DELETE FROM prospects WHERE id = ?').run(id);
}

/**
 * Purge RGPD : au-delà de la durée de conservation, une fiche jamais travaillée
 * n'a plus de raison d'être gardée. Les fiches devenues clientes sont conservées.
 */
export function purger(joursMax = 365) {
  const limite = new Date(Date.now() - joursMax * 86400000).toISOString();
  const r = db.prepare(
    `DELETE FROM prospects WHERE vu_le < ? AND statut IN ('nouveau','sans_suite')`,
  ).run(limite);
  return r.changes;
}

export function statistiques() {
  const parStatut = db.prepare('SELECT statut, COUNT(*) n FROM prospects GROUP BY statut').all();
  const total = db.prepare('SELECT COUNT(*) n FROM prospects').get().n;
  const semaine = db.prepare(
    "SELECT COUNT(*) n FROM prospects WHERE vu_le >= datetime('now','-7 days')",
  ).get().n;
  return { total, semaine, parStatut };
}
