// La progression de chacun : l'expérience (XP), le niveau qu'elle donne, et ce que chaque niveau rapporte (des kuartzons, de l'autorité, un grade). Une seule
// source pour le client et le serveur : le serveur compte, le client affiche avec les mêmes règles.
//
// Les choix, et pourquoi :
// - Un niveau vaut toujours XP_PER_LEVEL (1 000 XP), du premier au dernier. Les récompenses des missions sont données en fractions de niveau (une mission
//   de difficulté 1 vaut 5 % d'un niveau, de difficulté 5 la moitié, de difficulté 10 environ cinq niveaux) : avec un niveau de taille fixe, cela reste vrai
//   pour tout le monde, à tout niveau, et la même mission rapporte la même XP à chacun. Une courbe qui grandirait avec le niveau ferait mentir ces paliers
//   pour les plus avancés, ou donnerait des XP différentes pour la même mission.
// - Ce qui grandit avec le niveau, ce sont ses récompenses : chaque niveau atteint donne plus de kuartzons (kuartzonsForLevel) et plus d'autorité (authorityForLevel)
//   que le précédent. Plus on monte, plus on gagne.
// - Le niveau s'arrête à MAX_LEVEL (200). L'XP continue de s'additionner au-delà (le total se lit dans les caractéristiques), sans rien rapporter de plus.

export const XP_PER_LEVEL = 1000;
export const MAX_LEVEL = 200;

// La difficulté d'une mission, de 1 à 10, et l'XP qu'elle rapporte. Les paliers montent de façon exponentielle : un facteur 10^(1/4) (×1,78) de 1 à 5, puis
// 10^(1/5) (×1,58) de 5 à 10, arrondis à des nombres ronds : 5 % d'un niveau, la moitié d'un niveau à 5, cinq niveaux à 10.
export const MISSION_TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type MissionTier = (typeof MISSION_TIERS)[number];
const MISSION_XP: Readonly<Record<MissionTier, number>> = { 1: 50, 2: 90, 3: 160, 4: 280, 5: 500, 6: 800, 7: 1250, 8: 2000, 9: 3150, 10: 5000 };

export function missionXp(tier: MissionTier): number {
  return MISSION_XP[tier];
}

export function isMissionTier(value: unknown): value is MissionTier {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;
}

// Les autres façons de gagner de l'XP, chacune bornée par jour (le jour de la personne, dans son fuseau) pour qu'on ne puisse pas en faire une rente :
// - une tâche de sa propre liste, cochée : TODO_XP, jusqu'à TODO_DAILY_XP par jour (cinq tâches) ;
// - le pointage, à la première arrivée du jour : CHECKIN_XP, plus CHECKIN_STREAK_BONUS par jour de série au-delà du premier, jusqu'à CHECKIN_STREAK_MAX jours
//   (20 XP le premier jour, 50 XP à partir du septième). La série compte les jours ouvrés : un week-end sans venir ne la casse pas ;
// - une partie classée finie, à une table de jeu : GAME_LOSS_XP pour l'avoir jouée, GAME_DRAW_XP pour une nulle, GAME_WIN_XP pour une victoire, jusqu'à
//   GAME_DAILY_XP par jour.
// Les missions confiées par les autres n'ont pas de plafond : c'est la façon principale de progresser.
export const TODO_XP = 20;
export const TODO_DAILY_XP = 100;
export const CHECKIN_XP = 20;
export const CHECKIN_STREAK_BONUS = 5;
export const CHECKIN_STREAK_MAX = 7;
export const GAME_LOSS_XP = 15;
export const GAME_DRAW_XP = 30;
export const GAME_WIN_XP = 60;
export const GAME_DAILY_XP = 150;

// L'XP du pointage pour une série de `streak` jours (1 : le premier jour).
export function checkInXp(streak: number): number {
  const days = Math.min(Math.max(1, Math.floor(streak)), CHECKIN_STREAK_MAX);
  return CHECKIN_XP + CHECKIN_STREAK_BONUS * (days - 1);
}

// Le niveau que donne cette XP (de 0 à MAX_LEVEL).
export function levelOf(xp: number): number {
  return Math.min(MAX_LEVEL, Math.floor(Math.max(0, xp) / XP_PER_LEVEL));
}

// Où en est la personne dans son niveau : l'XP déjà faite dans ce niveau (`into`), sur XP_PER_LEVEL (`size`), et la part (`ratio`, de 0 à 1). Au niveau
// maximal, la barre est pleine.
export function levelProgress(xp: number): { level: number; into: number; size: number; ratio: number } {
  const level = levelOf(xp);
  if (level >= MAX_LEVEL) return { level, into: XP_PER_LEVEL, size: XP_PER_LEVEL, ratio: 1 };
  const into = Math.max(0, Math.floor(xp)) - level * XP_PER_LEVEL;
  return { level, into, size: XP_PER_LEVEL, ratio: into / XP_PER_LEVEL };
}

// La part d'un niveau que représente une XP (0,5 pour 500 XP) : ce que l'interface dit d'une mission (« la moitié d'un niveau »).
export function levelShare(xp: number): number {
  return xp / XP_PER_LEVEL;
}

// Les kuartzons que rapporte le fait d'atteindre ce niveau (1 à MAX_LEVEL) : 25 au niveau 1, 70 au niveau 10, 520 au niveau 100, 1 020 au niveau 200.
export function kuartzonsForLevel(level: number): number {
  return level >= 1 && level <= MAX_LEVEL ? 20 + 5 * level : 0;
}

// Les kuartzons gagnés en passant du niveau `from` au niveau `to` (to > from) : la somme de ceux de chaque niveau atteint. 475 pour aller de 0 à 10, 7 375 de 0 à
// 50, 104 500 de 0 à 200.
export function kuartzonsBetween(from: number, to: number): number {
  let total = 0;
  for (let level = Math.max(1, from + 1); level <= Math.min(MAX_LEVEL, to); level++) total += kuartzonsForLevel(level);
  return total;
}

// L'autorité que rapporte le fait d'atteindre ce niveau : 1 point par niveau du 1 au 20, 2 du 21 au 40… 10 du 181 au 200. Elle ne donne encore aucun
// pouvoir : c'est un rang qu'on lit dans les caractéristiques.
export function authorityForLevel(level: number): number {
  return level >= 1 && level <= MAX_LEVEL ? 1 + Math.floor((level - 1) / 20) : 0;
}

// L'autorité totale d'une personne de ce niveau : 20 au niveau 20, 60 au niveau 40, 300 au niveau 100, 1 100 au niveau 200.
export function authorityOf(level: number): number {
  let total = 0;
  for (let reached = 1; reached <= Math.min(MAX_LEVEL, level); reached++) total += authorityForLevel(reached);
  return total;
}

// Les grades, par tranches de 20 niveaux, puis « Légende » au niveau maximal. Des noms qui valent pour tout le monde (épicènes) ; leur texte est dans fr.ts.
export const GRADES = ['stagiaire', 'junior', 'specialiste', 'senior', 'pilier', 'mentor', 'stratege', 'architecte', 'visionnaire', 'sage', 'legende'] as const;
export type Grade = (typeof GRADES)[number];

export function gradeOf(level: number): Grade {
  if (level >= MAX_LEVEL) return 'legende';
  return GRADES[Math.min(GRADES.length - 2, Math.floor(Math.max(0, level) / 20))]!;
}

// Ce que rapporte une XP ajoutée à une autre : le niveau d'avant et d'après, les kuartzons gagnés en route, et si le grade a changé. La même règle sert au serveur,
// qui compte, et au client, qui annonce.
export function gainOf(xpBefore: number, amount: number): { levelBefore: number; levelAfter: number; kuartzons: number; gradeChanged: boolean } {
  const levelBefore = levelOf(xpBefore);
  const levelAfter = levelOf(xpBefore + Math.max(0, amount));
  return { levelBefore, levelAfter, kuartzons: kuartzonsBetween(levelBefore, levelAfter), gradeChanged: gradeOf(levelBefore) !== gradeOf(levelAfter) };
}

// La rareté d'un élément de la boutique, d'après son prix en kuartzons : de quoi le ranger et le colorer.
export const RARITIES = ['commun', 'rare', 'epique', 'legendaire'] as const;
export type Rarity = (typeof RARITIES)[number];

export function rarityOf(price: number): Rarity {
  if (price >= 5000) return 'legendaire';
  if (price >= 1200) return 'epique';
  if (price >= 300) return 'rare';
  return 'commun';
}

// Le jour (« AAAA-MM-JJ ») qu'il est à cet instant dans ce fuseau : les plafonds par jour et la série du pointage se comptent dans le fuseau de la personne.
// Un fuseau inconnu compte comme Paris (celui de tout le monde par défaut).
export function dayIn(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  }
}

// Le jour ouvré qui précède ce jour (« AAAA-MM-JJ ») : la veille, sauf le lundi (le vendredi d'avant) et le week-end (le vendredi de la même semaine).
export function previousWorkday(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  do date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

// La série du pointage d'aujourd'hui : celle d'hier qui continue si l'on est venu depuis le dernier jour ouvré (un samedi venu compte : il est après le
// vendredi), sinon une nouvelle série d'un jour. `last` : le jour du dernier pointage (null : jamais).
export function nextStreak(last: string | null, streak: number, today: string): number {
  if (last === today) return Math.max(1, streak);
  if (last !== null && last >= previousWorkday(today) && last < today) return Math.max(0, streak) + 1;
  return 1;
}
