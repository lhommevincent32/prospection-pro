import { DatabaseSync } from 'node:sqlite';
import { BASE_SQLITE } from '../config.js';

/**
 * Stockage local, sans réseau ni compte. Sert au développement et au repli
 * quand on veut travailler hors ligne. Même interface que le stockage Supabase.
 */

const db = new DatabaseSync(BASE_SQLITE);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY, genre TEXT NOT NULL, source TEXT NOT NULL, evenement TEXT,
  nom TEXT NOT NULL, commune TEXT, code_commune TEXT, code_postal TEXT, adresse TEXT,
  naf TEXT, activite TEXT, siret TEXT, siren TEXT, telephone TEXT, site TEXT,
  dirigeants TEXT, capital INTEGER, employeur INTEGER DEFAULT 0,
  date_fait TEXT, url TEXT, score INTEGER DEFAULT 0, offres TEXT, raisons TEXT, brut TEXT,
  vu_le TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'nouveau', notes TEXT DEFAULT '', maj_le TEXT
);
CREATE INDEX IF NOT EXISTS idx_prospects_tri   ON prospects(statut, score DESC, date_fait DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_vu    ON prospects(vu_le);
CREATE INDEX IF NOT EXISTS idx_prospects_genre ON prospects(genre);

CREATE TABLE IF NOT EXISTS collectes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lancee_le TEXT NOT NULL, source TEXT NOT NULL,
  examines INTEGER DEFAULT 0, nouveaux INTEGER DEFAULT 0, ecartes INTEGER DEFAULT 0, erreur TEXT
);
`);

// Rattrape les bases créées avant l'ajout de ces colonnes.
for (const col of ['siret TEXT', 'siren TEXT', 'telephone TEXT', 'site TEXT']) {
  try { db.exec(`ALTER TABLE prospects ADD COLUMN ${col}`); } catch { /* déjà présente */ }
}

/** Les listes sont stockées en texte ici, en tableaux chez Supabase : on uniformise. */
const sortie = (r) => r && ({
  ...r,
  employeur: !!r.employeur,
  offres: (r.offres ?? '').split(',').filter(Boolean),
  raisons: (r.raisons ?? '').split('\n').filter(Boolean),
});

const INSERT = db.prepare(`
  INSERT INTO prospects (id, genre, source, evenement, nom, commune, code_commune, code_postal,
    adresse, naf, activite, siret, siren, dirigeants, capital, employeur, date_fait, url, score,
    offres, raisons, brut, vu_le, maj_le)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET
    -- On rafraîchit ce qui vient des sources, jamais le statut de suivi ni les notes :
    -- ce sont les seules colonnes saisies à la main, et une collecte ne doit pas
    -- effacer le travail de la semaine.
    score = excluded.score, offres = excluded.offres, raisons = excluded.raisons,
    naf = COALESCE(excluded.naf, prospects.naf),
    activite = COALESCE(excluded.activite, prospects.activite),
    siret = COALESCE(excluded.siret, prospects.siret),
    siren = COALESCE(excluded.siren, prospects.siren),
    adresse = COALESCE(excluded.adresse, prospects.adresse),
    dirigeants = COALESCE(excluded.dirigeants, prospects.dirigeants),
    maj_le = excluded.maj_le`);

export async function enregistrerLot(prospects) {
  const connus = new Set(db.prepare('SELECT id FROM prospects').all().map((r) => r.id));
  const maintenant = new Date().toISOString();
  let nouveaux = 0;
  for (const p of prospects) {
    if (!connus.has(p.id)) nouveaux++;
    INSERT.run(
      p.id, p.genre, p.source, p.evenement ?? null, p.nom, p.commune ?? null,
      p.codeCommune ?? null, p.codePostal ?? null, p.adresse ?? null, p.naf ?? null,
      p.activite ?? null, p.siret ?? null, p.siren ?? null,
      p.dirigeants ?? null, p.capital ?? null, p.employeur ? 1 : 0,
      p.dateFait ?? null, p.url ?? null, p.score ?? 0,
      (p.offres ?? []).join(','), (p.raisons ?? []).join('\n'),
      JSON.stringify(p.brut ?? {}), p.vuLe ?? maintenant, maintenant,
    );
  }
  return { nouveaux };
}

export async function journaliser(source, s) {
  db.prepare('INSERT INTO collectes (lancee_le, source, examines, nouveaux, ecartes, erreur) VALUES (?,?,?,?,?,?)')
    .run(new Date().toISOString(), source, s.examines ?? 0, s.nouveaux ?? 0, s.ecartes ?? 0, s.erreur ?? null);
}

export async function nouveautesDepuis(iso) {
  return db.prepare('SELECT * FROM prospects WHERE vu_le >= ? AND score > 0 ORDER BY score DESC, date_fait DESC')
    .all(iso).map(sortie);
}

export async function lister({ statut, genre, recherche } = {}) {
  const ou = ['score > 0'];
  const args = [];
  if (statut) { ou.push('statut = ?'); args.push(statut); }
  if (genre) { ou.push('genre = ?'); args.push(genre); }
  if (recherche) {
    ou.push('(nom LIKE ? OR commune LIKE ? OR activite LIKE ?)');
    const q = `%${recherche}%`; args.push(q, q, q);
  }
  return db.prepare(`SELECT * FROM prospects WHERE ${ou.join(' AND ')} ORDER BY score DESC, date_fait DESC LIMIT 400`)
    .all(...args).map(sortie);
}

export async function majStatut(id, statut, notes) {
  const champs = ['statut = ?', 'maj_le = ?'];
  const args = [statut, new Date().toISOString()];
  if (notes !== undefined) { champs.splice(1, 0, 'notes = ?'); args.splice(1, 0, notes); }
  db.prepare(`UPDATE prospects SET ${champs.join(', ')} WHERE id = ?`).run(...args, id);
}

export async function supprimer(id) {
  db.prepare('DELETE FROM prospects WHERE id = ?').run(id);
}

export async function purger(jours = 365) {
  const limite = new Date(Date.now() - jours * 86400000).toISOString();
  return db.prepare("DELETE FROM prospects WHERE vu_le < ? AND statut IN ('nouveau','sans_suite')")
    .run(limite).changes;
}

export async function purgerSansPotentiel() {
  return db.prepare("DELETE FROM prospects WHERE score <= 0 AND statut = 'nouveau'").run().changes;
}

export async function aEnrichir() {
  return db.prepare("SELECT id, brut, evenement, capital, commune FROM prospects WHERE genre='entreprise' AND naf IS NULL AND source='bodacc'")
    .all();
}

export async function majEnrichissement(id, v) {
  db.prepare('UPDATE prospects SET naf=?, activite=?, employeur=?, score=?, offres=?, raisons=? WHERE id=?')
    .run(v.naf, v.activite, v.employeur ? 1 : 0, v.score, v.offres.join(','), v.raisons.join('\n'), id);
}

export async function statistiques() {
  return {
    total: db.prepare('SELECT COUNT(*) n FROM prospects').get().n,
    semaine: db.prepare("SELECT COUNT(*) n FROM prospects WHERE vu_le >= datetime('now','-7 days')").get().n,
    parStatut: db.prepare('SELECT statut, COUNT(*) n FROM prospects GROUP BY statut').all(),
  };
}
