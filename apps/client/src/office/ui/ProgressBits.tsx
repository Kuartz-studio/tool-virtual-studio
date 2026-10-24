import { MISSION_TIERS, gradeOf, levelProgress, type MissionTier } from '@bureau/shared';
import { fr, t } from '../../i18n/fr';
import { formatNumber } from '../progress-format';

// Les petites pièces de la progression, partout les mêmes : la pastille du niveau, la barre de l'XP, les crans de la difficulté d'une mission.

// La pastille du niveau : le nombre, dans un écusson dont la teinte suit le grade (`data-grade`, styles.css). Un lecteur d'écran entend « Niveau 12 ».
export function LevelBadge({ level, size = 'small' }: { level: number; size?: 'small' | 'large' }) {
  return (
    <span className={`level-badge is-${size}`} data-grade={gradeOf(level)}>
      <span aria-hidden="true">{level}</span>
      <span className="visually-hidden">{t(fr.progress.level, { level })}</span>
    </span>
  );
}

// La barre de l'XP du niveau en cours : faite sur 1 000. Pleine au niveau maximal.
export function XpBar({ xp, label }: { xp: number; label?: string }) {
  const { into, size, ratio } = levelProgress(xp);
  const text = t(fr.progress.xpBar, { into: formatNumber(into), size: formatNumber(size) });
  return (
    <div className="xp-bar" role="progressbar" aria-label={label ?? text} aria-valuemin={0} aria-valuemax={size} aria-valuenow={into} aria-valuetext={text}>
      <span className="xp-bar-fill" style={{ width: `${Math.round(ratio * 1000) / 10}%` }} />
    </div>
  );
}

// Les dix crans de la difficulté d'une mission, pleins jusqu'à la sienne. Décoratifs : le texte à côté dit la difficulté.
export function TierPips({ tier }: { tier: MissionTier }) {
  return (
    <span className="tier-pips" data-tier={tier} aria-hidden="true">
      {MISSION_TIERS.map((step) => (
        <span key={step} className={step <= tier ? 'tier-pip is-on' : 'tier-pip'} />
      ))}
    </span>
  );
}
