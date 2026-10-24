import { z } from 'zod';

// Le fuseau horaire de chacun, réglé dans le menu « Moi » : son nom IANA (« Europe/Paris », « America/Montreal », « Asia/Tokyo »), que le navigateur
// comme le serveur savent lire (Intl), et dont les heures d'été suivent les règles de la base IANA sans qu'on ait rien à tenir à jour. Chacun voit,
// au survol d'un collègue, l'heure qu'il est chez lui ; les horloges murales d'un bureau donnent celle de son occupant.

// Tout le monde est à l'heure de Paris tant qu'il n'a rien choisi : les comptes d'avant la colonne aussi (migration 0011), et une place libre.
export const DEFAULT_TIMEZONE = 'Europe/Paris';

// Le nom le plus long de la base IANA fait 32 caractères (America/Argentina/ComodRivadavia) : 64 laisse de la marge sans ouvrir la porte à un roman.
export const TIMEZONE_MAX_LENGTH = 64;

// La forme d'un nom IANA : des mots (lettres, chiffres, « _ », « - », « + ») séparés par « / », le premier commençant par une lettre. Elle écarte ce
// qu'Intl accepterait aussi sans que ce soit un fuseau de la base : un décalage fixe (« +01:00 »), que les heures d'été ne suivraient pas.
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

// Les réponses déjà calculées : Intl met un peu de temps à préparer un fuseau, et le client pose la question à chaque rendu d'une heure.
const known = new Map<string, boolean>();

// Ce nom est-il un fuseau IANA que ce moteur connaît ? Intl lève une RangeError pour un nom inconnu. Les anciens noms de la base (« Asia/Calcutta »,
// « Europe/Kiev », « US/Eastern ») en font partie : ils restent valables partout, et un navigateur peut encore donner le sien sous l'un d'eux.
export function isTimezone(name: string): boolean {
  const cached = known.get(name);
  if (cached !== undefined) return cached;
  let valid = name.length <= TIMEZONE_MAX_LENGTH && IANA_NAME.test(name);
  if (valid) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: name });
    } catch {
      valid = false;
    }
  }
  if (known.size < 1000) known.set(name, valid);
  return valid;
}

// Le fuseau qu'on peut afficher : le sien, ou celui de Paris quand il manque (un joueur fabriqué par un test) ou que ce moteur ne le connaît pas
// (un navigateur plus ancien que la base du serveur).
export function timezoneOrDefault(name: string | null | undefined): string {
  return name && isTimezone(name) ? name : DEFAULT_TIMEZONE;
}

// Un fuseau envoyé par le client (PATCH /api/me) : un nom IANA réel, gardé tel qu'il est écrit. On ne le remplace pas par celui qu'Intl donne en
// retour : Node appelle encore « Asia/Kolkata » « Asia/Calcutta », et la liste du client ne s'y retrouverait plus.
export const timezoneSchema = z.string().trim().min(1).max(TIMEZONE_MAX_LENGTH).refine(isTimezone);
