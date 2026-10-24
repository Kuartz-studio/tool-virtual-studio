import { authorityOf, levelOf, levelProgress, MAX_LEVEL, MISSION_TIERS, type CharacterStats } from '@bureau/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { fr, t } from '../i18n/fr';
import { fetchStats } from '../lib/progress-api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { AuthorityIcon, EcusIcon, GamepadIcon, GivenIcon, MissionsIcon, StreakIcon, TodosIcon, XpIcon } from './icons';
import { LastSeen } from './LastSeen';
import { LocalTimeCard } from './LocalTime';
import { formatNumber, gradeLabel, tierLabel } from './progress-format';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { Drawer } from './ui/Drawer';
import { LevelBadge, XpBar } from './ui/ProgressBits';

const memberSince = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// Une case de la fiche : une icône, une valeur en grand, son nom dessous, et (facultatif) une phrase en infobulle.
function Stat({ icon, value, label, hint }: { icon: ReactNode; value: ReactNode; label: string; hint?: string }) {
  return (
    <div className="sheet-stat" title={hint}>
      <span className="sheet-stat-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="sheet-stat-value">{value}</span>
      <span className="sheet-stat-label">{label}</span>
    </div>
  );
}

// Les caractéristiques d'une personne (GET /api/people/:id/stats), à la manière d'une fiche de personnage : son portrait, son niveau, son grade et la barre
// de son XP, puis une grille (niveau, autorité, écus pour soi, missions accomplies et confiées, tâches cochées, série de pointage, parties gagnées), ses missions
// par difficulté, l'heure qu'il est chez elle (son fuseau horaire), et, pour soi, son journal (les derniers gains d'XP).
//
// La fiche est relue quand sa progression change (pour soi : le magasin la tient ; pour un autre : son niveau annoncé), sans clignoter : la précédente reste
// affichée pendant la lecture.
export function CharacterSheet({ userId }: { userId: string }) {
  const selfId = useOfficeStore((state) => state.selfId);
  const mine = userId === selfId;
  // Ce qui fait relire la fiche : sa propre XP, ou le niveau qu'on connaît de l'autre.
  const version = useOfficeStore((state) => (mine ? (state.progress?.xp ?? 0) : (state.players[userId]?.level ?? -1)));
  const [stats, setStats] = useState<CharacterStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    fetchStats(userId).then(
      (next) => {
        if (!current) return;
        setStats(next);
        setFailed(false);
      },
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [userId, version]);

  if (stats === null) return failed ? <Alert>{fr.sheet.loadFailed}</Alert> : <p className="people-loading">{fr.common.loading}</p>;

  const level = levelOf(stats.xp);
  const { level: shown, into, size } = levelProgress(stats.xp);
  const maxTier = Math.max(1, ...stats.missionsByTier);

  return (
    <div className="sheet" data-user={stats.id}>
      <div className="sheet-head">
        <AvatarPortrait avatarKey={stats.avatarKey} name={stats.name} size={64} />
        <div className="sheet-id">
          <span className="sheet-name">{stats.name}</span>
          <span className="sheet-grade">{gradeLabel(level)}</span>
          <span className="sheet-since">{t(fr.sheet.memberSince, { date: memberSince.format(new Date(stats.memberSince)) })}</span>
        </div>
        <LevelBadge level={level} size="large" />
      </div>

      <div className="sheet-xp">
        <XpBar xp={stats.xp} />
        <span className="sheet-xp-text">
          {shown >= MAX_LEVEL ? fr.progress.maxed : t(fr.progress.toNext, { left: formatNumber(size - into), next: shown + 1 })}
          {' · '}
          {t(fr.progress.total, { xp: formatNumber(stats.xp) })}
        </span>
      </div>

      <div className="sheet-grid">
        <Stat icon={<XpIcon />} value={`${level} / ${MAX_LEVEL}`} label={fr.sheet.level} />
        <Stat icon={<AuthorityIcon />} value={formatNumber(authorityOf(level))} label={fr.sheet.authority} hint={fr.sheet.authorityHint} />
        {stats.ecus !== undefined && <Stat icon={<EcusIcon />} value={formatNumber(stats.ecus)} label={fr.sheet.ecus} />}
        <Stat icon={<MissionsIcon />} value={formatNumber(stats.missionsDone)} label={fr.sheet.missionsDone} />
        <Stat icon={<GivenIcon />} value={formatNumber(stats.missionsGiven)} label={fr.sheet.missionsGiven} />
        <Stat icon={<TodosIcon />} value={formatNumber(stats.todosDone)} label={fr.sheet.todosDone} />
        <Stat icon={<StreakIcon />} value={stats.streak === 1 ? fr.sheet.streakDay : t(fr.sheet.streakDays, { count: stats.streak })} label={fr.sheet.streak} />
        <Stat icon={<GamepadIcon />} value={t(fr.sheet.gamesValue, { won: stats.gamesWon, played: stats.gamesPlayed })} label={fr.sheet.games} />
      </div>

      <div className="sheet-time">
        <LocalTimeCard timezone={stats.timezone} name={stats.name} self={mine} />
      </div>

      <section className="sheet-section" aria-label={fr.sheet.byTier}>
        <h3>{fr.sheet.byTier}</h3>
        <div className="sheet-tiers">
          {MISSION_TIERS.map((tier) => {
            const count = stats.missionsByTier[tier - 1] ?? 0;
            return (
              <span key={tier} className="sheet-tier" title={`${tierLabel(tier)} · ${t(fr.sheet.byTierBar, { tier, count })}`}>
                <span className="sheet-tier-bar" style={{ height: `${Math.round((count / maxTier) * 100)}%` }} data-empty={count === 0 || undefined} />
                <span className="sheet-tier-n" aria-hidden="true">
                  {tier}
                </span>
                <span className="visually-hidden">{t(fr.sheet.byTierBar, { tier, count })}</span>
              </span>
            );
          })}
        </div>
      </section>

      {stats.history && (
        <section className="sheet-section" aria-label={fr.sheet.history}>
          <h3>{fr.sheet.history}</h3>
          {stats.history.length === 0 ? (
            <p className="people-empty">{fr.sheet.historyEmpty}</p>
          ) : (
            <ul className="sheet-history">
              {stats.history.map((entry) => (
                <li key={`${entry.at}-${entry.label}-${entry.amount}`}>
                  <span className="sheet-history-xp">+{formatNumber(entry.amount)}</span>
                  <span className="sheet-history-text">
                    <span className="sheet-history-source">{fr.sheet.sources[entry.source]}</span> {entry.label}
                  </span>
                  <span className="sheet-history-when">
                    <LastSeen at={Date.parse(entry.at)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// Le panneau des caractéristiques de quelqu'un d'autre (une ligne du panneau Personnes) : sa fiche, sous son nom. Les siennes sont dans le panneau Missions.
export function SheetPanel({ id, userId, name, onClose }: { id?: string; userId: string; name: string; onClose(): void }) {
  return (
    <Drawer title={name ? t(fr.sheet.titleOf, { name }) : fr.sheet.title} onClose={onClose} id={id} className="sheet-panel">
      <CharacterSheet userId={userId} />
    </Drawer>
  );
}
