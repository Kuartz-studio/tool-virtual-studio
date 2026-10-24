import { isTimezone, timezoneOrDefault } from '@bureau/shared';
import { fr, t } from '../i18n/fr';

// L'heure qu'il est dans un fuseau horaire (un nom IANA), en fonctions pures : la carte de l'heure locale d'une personne, la liste des fuseaux du menu
// « Moi » et les horloges murales du jeu s'en servent. Tout part d'un instant (`at`, en ms depuis 1970, Date.now()) : rien n'avance tout seul, et
// rien ne dérive. Un onglet qui revient d'arrière-plan relit l'heure, et elle est juste.

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// Un formateur par fuseau : Intl met du temps à en préparer un. `h23` : minuit s'écrit 0, jamais 24 (ce que donnent certains moteurs avec hour12: false).
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

// Le décalage de chaque fuseau, gardé pour la minute (UTC) où il a été calculé : il ne change qu'aux heures d'été et d'hiver, toujours à une minute
// ronde. Les horloges murales le demandent à chaque image : Intl n'est appelé qu'une fois par minute et par fuseau.
const offsets = new Map<string, { minute: number; offset: number }>();

// Le décalage du fuseau sur le temps universel à cet instant, en minutes (Paris : 60 l'hiver, 120 l'été ; Montréal : -300 ou -240). Un fuseau
// que ce navigateur ne connaît pas compte pour celui de Paris.
export function zoneOffsetMinutes(zone: string, at: number): number {
  const known = timezoneOrDefault(zone);
  const minute = Math.floor(at / MINUTE_MS);
  const cached = offsets.get(known);
  if (cached?.minute === minute) return cached.offset;
  const parts = formatterOf(known).formatToParts(minute * MINUTE_MS);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));
  const offset = Math.round((local - minute * MINUTE_MS) / MINUTE_MS);
  offsets.set(known, { minute, offset });
  return offset;
}

// L'heure qu'affiche une horloge de ce fuseau à cet instant : heures (0 à 23), minutes, secondes, millièmes, et le numéro du jour (les jours depuis
// 1970 à l'heure de ce fuseau), qui dit si l'on est déjà demain chez quelqu'un.
export interface WallTime {
  hours: number;
  minutes: number;
  seconds: number;
  ms: number;
  day: number;
}

export function wallTime(zone: string, at: number): WallTime {
  const local = at + zoneOffsetMinutes(zone, at) * MINUTE_MS;
  const day = Math.floor(local / DAY_MS);
  const inDay = local - day * DAY_MS;
  return {
    hours: Math.floor(inDay / HOUR_MS),
    minutes: Math.floor(inDay / MINUTE_MS) % 60,
    seconds: Math.floor(inDay / SECOND_MS) % 60,
    ms: inDay % SECOND_MS,
    day,
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

// « 08:05 », « 18:42 » : l'heure sur 24 h, comme on l'écrit en France.
export function formatClock({ hours, minutes }: Pick<WallTime, 'hours' | 'minutes'>): string {
  return `${pad(hours)}:${pad(minutes)}`;
}

// « UTC+2 », « UTC−5 », « UTC+5:30 », « UTC » : le décalage d'un fuseau, avec le vrai signe moins (celui qu'Intl écrit aussi).
export function formatUtcOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return fr.time.utc;
  const abs = Math.abs(offsetMinutes);
  const [h, m] = [Math.floor(abs / 60), abs % 60];
  return `${fr.time.utc}${offsetMinutes > 0 ? '+' : '−'}${h}${m === 0 ? '' : `:${pad(m)}`}`;
}

// Un écart entre deux fuseaux, sans signe : « 6 h », « 5 h 30 », « 30 min ».
export function formatGap(minutes: number): string {
  const abs = Math.abs(minutes);
  const [h, m] = [Math.floor(abs / 60), abs % 60];
  if (h === 0) return t(fr.time.gapMinutes, { m });
  return m === 0 ? t(fr.time.gapHours, { h }) : t(fr.time.gapHoursMinutes, { h, m: pad(m) });
}

// L'écart entre son heure et la mienne, en minutes : positif quand il est plus tard chez elle.
export function gapMinutes(theirs: string, mine: string, at: number): number {
  return zoneOffsetMinutes(theirs, at) - zoneOffsetMinutes(mine, at);
}

// L'écart dit en clair : « 7 h d'avance sur toi », « 6 h de retard sur toi », « Même heure que toi ».
export function describeGap(theirs: string, mine: string, at: number): string {
  const gap = gapMinutes(theirs, mine, at);
  if (gap === 0) return fr.time.sameTime;
  return t(gap > 0 ? fr.time.ahead : fr.time.behind, { gap: formatGap(gap) });
}

// Le moment de la journée chez quelqu'un, d'après son heure : le matin de 6 h à midi, l'après-midi jusqu'à 18 h, la soirée jusqu'à 22 h, la nuit
// ensuite. Un indice pour savoir si c'est le moment de lui écrire.
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export function dayPart(hours: number): DayPart {
  if (hours >= 6 && hours < 12) return 'morning';
  if (hours >= 12 && hours < 18) return 'afternoon';
  if (hours >= 18 && hours < 22) return 'evening';
  return 'night';
}

// Le fuseau de cet appareil (celui que le navigateur dit), s'il est un nom IANA connu ; null sinon.
export function deviceTimezone(): string | null {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isTimezone(zone) ? zone : null;
  } catch {
    return null;
  }
}
