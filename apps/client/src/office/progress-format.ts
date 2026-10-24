import { XP_PER_LEVEL, gradeOf, type MissionTier } from '@bureau/shared';
import { fr, t } from '../i18n/fr';

// Les nombres de la progression, écrits comme en français (« 12 340 XP », « 1 250 écus »), et ce qu'ils veulent dire.

const integer = new Intl.NumberFormat('fr-FR');
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export const formatNumber = (n: number): string => integer.format(n);

export const xpText = (xp: number): string => t(fr.progress.xp, { xp: formatNumber(xp) });

export const ecusText = (count: number): string => (count === 1 ? fr.progress.ecu : t(fr.progress.ecus, { count: formatNumber(count) }));

export const gradeLabel = (level: number): string => fr.progress.grades[gradeOf(level)];

export const tierLabel = (tier: MissionTier): string => fr.progress.tiers[tier].label;

// Ce que représente une XP, en part de niveau : « 5 % d'un niveau », « la moitié d'un niveau », « 1,25 niveau », « 5 niveaux » (le singulier sous deux, comme
// on l'écrit en français).
export function shareText(xp: number): string {
  const share = xp / XP_PER_LEVEL;
  if (share === 0.5) return fr.progress.share.half;
  if (share < 1) return t(fr.progress.share.percent, { percent: Math.round(share * 100) });
  return t(share < 2 ? fr.progress.share.level : fr.progress.share.levels, { count: decimal.format(share) });
}
