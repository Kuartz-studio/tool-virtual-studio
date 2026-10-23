import { fr, t } from '../i18n/fr';

// La dernière connexion d'un membre, dite comme on la dirait : « À l'instant », « Il y a 26 min », « Il y a 3 h », « Il y a 5 jours »,
// puis en semaines, en mois, en années. Chaque unité est arrondie vers le bas : « Il y a 3 h » jusqu'à la quatrième heure pleine.

export const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const seen = fr.office.people.seen;
const plural = (count: number, one: string, many: string): string => (count === 1 ? one : t(many, { count }));

// `seenAt` et `now` en millisecondes depuis l'époque Unix. Une heure du serveur un peu en avance sur l'horloge du navigateur
// (une dernière connexion « dans le futur ») vaut « À l'instant ».
export function formatLastSeen(seenAt: number, now: number): string {
  const elapsed = Math.max(0, now - seenAt);
  if (elapsed < MINUTE_MS) return seen.now;
  if (elapsed < HOUR_MS) return t(seen.minutes, { count: Math.floor(elapsed / MINUTE_MS) });
  if (elapsed < DAY_MS) return t(seen.hours, { count: Math.floor(elapsed / HOUR_MS) });
  const days = Math.floor(elapsed / DAY_MS);
  if (days < 7) return plural(days, seen.day, seen.days);
  if (days < 30) return plural(Math.floor(days / 7), seen.week, seen.weeks);
  if (days < 365) return t(seen.months, { count: Math.floor(days / 30) });
  return plural(Math.floor(days / 365), seen.year, seen.years);
}

const fullDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });

// La date entière, pour l'infobulle : « vendredi 23 octobre 2026 à 14:05 ».
export function formatSeenDate(seenAt: number): string {
  return fullDate.format(seenAt);
}
