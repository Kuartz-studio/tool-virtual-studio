import { MAX_LEVEL, MISSION_TIERS, authorityOf, gradeOf, levelOf, levelProgress, type CharacterStats } from '@bureau/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { fr, t } from '../i18n/fr';
import { fetchStats } from '../lib/progress-api';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { AuthorityIcon, GamepadIcon, GivenIcon, KuartzonIcon, MemberSinceIcon, MissionsIcon, StreakIcon, TodosIcon, XpIcon } from './icons';
import { LastSeen } from './LastSeen';
import { LocalTimeCard } from './LocalTime';
import { formatNumber, gradeLabel, tierLabel } from './progress-format';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { Drawer } from './ui/Drawer';
import { LevelBadge } from './ui/ProgressBits';

// La date d'arrivée, courte : « 24 oct. 2026 ».
const memberSince = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

// La barre de l'expérience a dix cases de cent XP.
const SEGMENTS = 10;

// L'expérience du niveau en cours, en cases comme sur la fiche d'un personnage de jeu de rôle : son nom et sa valeur, puis dix cases égales, pleines jusqu'à
// la valeur (la dernière en partie).
function XpSegments({ xp }: { xp: number }) {
  const { into, size } = levelProgress(xp);
  const step = size / SEGMENTS;
  return (
    <div className="sheet-bar">
      <span className="sheet-bar-label" aria-hidden="true">
        {fr.sheet.xpBar}
      </span>
      <span
        className="sheet-bar-track"
        role="progressbar"
        aria-label={fr.sheet.xpBar}
        aria-valuemin={0}
        aria-valuemax={size}
        aria-valuenow={into}
        aria-valuetext={t(fr.progress.xpBar, { into: formatNumber(into), size: formatNumber(size) })}
      >
        {Array.from({ length: SEGMENTS }, (_, index) => {
          const fill = Math.min(1, Math.max(0, (into - index * step) / step));
          return (
            <span key={index} className="sheet-seg">
              <span className="sheet-seg-fill" style={{ width: `${Math.round(fill * 1000) / 10}%` }} />
            </span>
          );
        })}
      </span>
      <span className="sheet-bar-value" aria-hidden="true">
        {t(fr.sheet.barValue, { value: formatNumber(into), max: formatNumber(size) })}
      </span>
    </div>
  );
}

// L'en-tête d'une fiche : le portrait, le nom, le grade et la pastille du niveau, puis l'expérience du niveau en cours et ce qu'il reste avant le suivant. La
// carte prend, très légèrement, la teinte du grade (celle de la pastille). Le panneau Missions le pose au-dessus de ses onglets, avec sa propre progression ;
// la fiche de quelqu'un d'autre l'a en tête. Le niveau n'est dit qu'ici.
export function CharacterHero({ name, avatarKey, xp }: { name: string; avatarKey: string | null; xp: number }) {
  const level = levelOf(xp);
  const { into, size } = levelProgress(xp);
  return (
    <div className="sheet-hero" data-grade={gradeOf(level)}>
      <div className="sheet-hero-id">
        <AvatarPortrait avatarKey={avatarKey} name={name} size={52} />
        <span className="sheet-hero-text">
          <span className="sheet-hero-name">{name}</span>
          <span className="sheet-hero-grade">{gradeLabel(level)}</span>
        </span>
        <LevelBadge level={level} size="large" />
      </div>
      <div className="sheet-hero-xp">
        <XpSegments xp={xp} />
        <p className="sheet-hero-next">{level >= MAX_LEVEL ? fr.progress.maxed : t(fr.progress.toNext, { left: formatNumber(size - into), next: level + 1 })}</p>
      </div>
    </div>
  );
}

// La teinte d'une ligne : chaque donnée a la sienne, comme chaque caractéristique d'un personnage (styles.css, .sheet-row[data-hue]).
type Hue = 'gold' | 'violet' | 'pink' | 'blue' | 'teal' | 'green' | 'orange' | 'rose' | 'slate';

// Une ligne de la fiche : une pastille à la teinte de la donnée, son nom à gauche, sa valeur alignée à droite, et (facultatif) une phrase en infobulle.
function Row({ hue, icon, label, value, hint }: { hue: Hue; icon: ReactNode; label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="sheet-row" data-hue={hue} title={hint}>
      <dt>
        <span className="sheet-row-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="sheet-row-label">{label}</span>
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

// Les caractéristiques d'une personne (GET /api/people/:id/stats), à la manière d'une fiche de personnage de jeu de rôle : l'en-tête (CharacterHero : portrait,
// grade, niveau, expérience), puis ses données en lignes, le nom à gauche et la valeur à droite : l'essentiel d'abord, surligné (expérience totale, autorité,
// kuartzons pour soi), puis son activité (missions accomplies et confiées, tâches cochées, série de pointage, parties gagnées, date d'arrivée) ; l'heure qu'il est
// chez elle (son fuseau horaire), ses missions par difficulté, et, pour soi, son journal (les derniers gains d'XP). `hero` : faux quand le panneau montre déjà
// l'en-tête (le panneau Missions, au-dessus de ses onglets).
//
// La fiche est relue quand sa progression change (pour soi : le magasin la tient ; pour un autre : son niveau annoncé), sans clignoter : la précédente reste
// affichée pendant la lecture.
export function CharacterSheet({ userId, hero = true }: { userId: string; hero?: boolean }) {
  const selfId = useOfficeStore((state) => state.selfId);
  const mine = userId === selfId;
  // Ce qui fait relire la fiche : pour soi, son XP, ses kuartzons ou les missions qu'elle a confiées ; pour un autre, le niveau qu'on lui connaît.
  const version = useOfficeStore((state) =>
    mine ? `${state.progress?.xp ?? 0}|${state.progress?.kuartzons ?? 0}|${state.given?.length ?? 0}` : `${state.players[userId]?.level ?? -1}`,
  );
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
  const maxTier = Math.max(1, ...stats.missionsByTier);

  return (
    <div className="sheet" data-user={stats.id}>
      {hero && <CharacterHero name={stats.name} avatarKey={stats.avatarKey} xp={stats.xp} />}

      <dl className="sheet-stats is-key" aria-label={fr.sheet.essentials}>
        <Row hue="gold" icon={<XpIcon />} label={fr.sheet.totalXp} value={t(fr.progress.xp, { xp: formatNumber(stats.xp) })} />
        <Row hue="violet" icon={<AuthorityIcon />} label={fr.sheet.authority} value={formatNumber(authorityOf(level))} hint={fr.sheet.authorityHint} />
        {stats.kuartzons !== undefined && <Row hue="pink" icon={<KuartzonIcon />} label={fr.sheet.kuartzons} value={formatNumber(stats.kuartzons)} />}
      </dl>

      <dl className="sheet-stats" aria-label={fr.sheet.activity}>
        <Row hue="blue" icon={<MissionsIcon />} label={fr.sheet.missionsDone} value={formatNumber(stats.missionsDone)} />
        <Row hue="teal" icon={<GivenIcon />} label={fr.sheet.missionsGiven} value={formatNumber(stats.missionsGiven)} />
        <Row hue="green" icon={<TodosIcon />} label={fr.sheet.todosDone} value={formatNumber(stats.todosDone)} />
        <Row hue="orange" icon={<StreakIcon />} label={fr.sheet.streak} value={stats.streak === 1 ? fr.sheet.streakDay : t(fr.sheet.streakDays, { count: stats.streak })} />
        <Row hue="rose" icon={<GamepadIcon />} label={fr.sheet.games} value={t(fr.sheet.gamesValue, { won: stats.gamesWon, played: stats.gamesPlayed })} />
        <Row hue="slate" icon={<MemberSinceIcon />} label={fr.sheet.memberSince} value={memberSince.format(new Date(stats.memberSince))} />
      </dl>

      <div className="sheet-time">
        <LocalTimeCard timezone={stats.timezone} name={stats.name} self={mine} />
      </div>

      <section className="sheet-section" aria-label={fr.sheet.byTier}>
        <h3>{fr.sheet.byTier}</h3>
        {stats.missionsDone === 0 ? (
          <p className="people-empty">{fr.sheet.byTierEmpty}</p>
        ) : (
          <div className="sheet-tiers">
            {MISSION_TIERS.map((tier) => {
              const count = stats.missionsByTier[tier - 1] ?? 0;
              return (
                <span key={tier} className="sheet-tier" data-tier={tier} title={`${tierLabel(tier)} · ${t(fr.sheet.byTierBar, { tier, count })}`}>
                  <span className="sheet-tier-bar" style={{ height: `${Math.round((count / maxTier) * 100)}%` }} data-empty={count === 0 || undefined} />
                  <span className="sheet-tier-n" aria-hidden="true">
                    {tier}
                  </span>
                  <span className="visually-hidden">{t(fr.sheet.byTierBar, { tier, count })}</span>
                </span>
              );
            })}
          </div>
        )}
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
