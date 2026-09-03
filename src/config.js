import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Les 125 communes du secteur, avec code INSEE, code postal et population. */
export const COMMUNES = JSON.parse(readFileSync(join(RACINE, 'data/zone.json'), 'utf8'));

export const CODES_INSEE = COMMUNES.map((c) => c.code);
export const CODES_POSTAUX = [...new Set(COMMUNES.flatMap((c) => c.cp))].sort();

/** Marques diacritiques combinantes, à retirer après normalisation NFD. */
const ACCENTS = /[̀-ͯ]/g;

/**
 * Normalise un nom de commune pour comparaison : sans accents, sans ponctuation,
 * en minuscules. Indispensable car le BODACC ne fournit pas le code INSEE, et que
 * 57 communes hors secteur partagent un code postal avec le nôtre.
 */
export function normaliser(nom) {
  return (nom ?? '')
    .normalize('NFD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const INDEX_COMMUNES = new Map(COMMUNES.map((c) => [normaliser(c.nom), c]));

/** Retrouve une commune du secteur à partir d'un nom libre. `null` si hors secteur. */
export function communeDepuisNom(nom) {
  return INDEX_COMMUNES.get(normaliser(nom)) ?? null;
}

export function communeDepuisCode(code) {
  return COMMUNES.find((c) => c.code === code) ?? null;
}

export const INSEE_API_KEY = process.env.INSEE_API_KEY ?? '';

/** Quota INSEE : 30 requêtes/minute. On se garde une marge. */
export const INSEE = {
  base: 'https://api.insee.fr/api-sirene/3.11',
  communesParRequete: 25,
  pauseMs: 2500,
};

export const BODACC =
  'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';

/** Seul flux de presse locale qui renvoie réellement des articles (vérifié). */
export const FLUX_PRESSE = [
  { nom: 'La Dépêche — Gers', url: 'https://www.ladepeche.fr/grand-sud/gers/rss.xml' },
];

export const BASE_SQLITE = join(RACINE, 'data/prospects.db');
