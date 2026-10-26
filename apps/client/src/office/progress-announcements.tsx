import { gradeOf, type XpGain } from '@bureau/shared';
import { useEffect, useState } from 'react';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { listenOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { KuartzonIcon, LevelUpIcon, MissionsIcon, XpIcon } from './icons';
import { formatNumber, gradeLabel } from './progress-format';
import { useToasts } from './Toasts';
import { LevelBadge } from './ui/ProgressBits';

// Combien de temps restent les annonces : un gain, une mission reçue, la montée de niveau en grand.
const GAIN_TOAST_MS = 3000;
const MISSION_TOAST_MS = 9000;
const LEVEL_UP_MS = 4500;

// Ce que la progression annonce dans la file des toasts :
// - un gain d'XP à soi (« +500 XP · Refaire le logo ») : un seul toast à la fois, le dernier gain remplace l'autre ;
// - le niveau d'un autre qui monte (« Bob passe au niveau 12 ! », et son nouveau grade s'il en change), avec son portrait ;
// - une mission reçue (« Ana te confie une mission : « … » »), avec « Voir », qui ouvre le panneau Missions ;
// - une mission qu'on a confiée, faite ou rendue ; une mission qu'on avait reçue, retirée.
// Sa propre montée de niveau a son annonce en grand (LevelUpBanner).
export function useProgressToasts(): void {
  useEffect(() => {
    const push = (toast: Parameters<ReturnType<typeof useToasts.getState>['push']>[0]) => useToasts.getState().push(toast);
    const avatarOf = (id: string) => useOfficeStore.getState().players[id]?.avatarKey ?? null;
    const offs = [
      listenOnBus(EventBus, 'progress:gain', (gain) => {
        push({ key: 'xp-gain', icon: <XpIcon />, text: t(fr.progress.gained, { xp: formatNumber(gain.amount), label: gain.label }), ttl: GAIN_TOAST_MS });
      }),
      listenOnBus(EventBus, 'net:level', ({ id, level, before }) => {
        const { selfId, players } = useOfficeStore.getState();
        if (id === selfId || level <= before) return;
        const name = players[id]?.name ?? '';
        const grade = gradeOf(level) !== gradeOf(before) ? gradeLabel(level) : null;
        push({
          key: `level:${id}`,
          icon: <LevelUpIcon />,
          avatarKey: avatarOf(id),
          name,
          text: grade ? t(fr.progress.levelUpOtherGrade, { name, level, grade }) : t(fr.progress.levelUpOther, { name, level }),
        });
      }),
      listenOnBus(EventBus, 'task:assigned', (task) => {
        // Une mission qu'on vient de se donner ne s'annonce pas : on sait ce qu'on y a mis.
        if (task.giver?.id === useOfficeStore.getState().selfId) return;
        const name = task.giver?.name ?? '';
        push({
          key: `mission:${task.id}`,
          icon: <MissionsIcon />,
          avatarKey: task.giver ? avatarOf(task.giver.id) : null,
          name,
          text: t(fr.missions.assigned, { name, title: task.title }),
          ttl: MISSION_TOAST_MS,
          actions: [
            {
              label: fr.missions.see,
              onClick: () => {
                useToasts.getState().dismiss(`mission:${task.id}`);
                useOfficeStore.getState().requestPanel({ panel: 'missions', tab: 'todo' });
              },
            },
          ],
        });
      }),
      listenOnBus(EventBus, 'task:changed', (task) => {
        const { selfId } = useOfficeStore.getState();
        if (task.giver?.id === selfId && (task.status === 'done' || task.status === 'declined')) {
          const name = task.owner.name;
          push({ icon: <MissionsIcon />, avatarKey: avatarOf(task.owner.id), name, text: t(task.status === 'done' ? fr.missions.doneBy : fr.missions.declinedBy, { name, title: task.title }) });
        } else if (task.owner.id === selfId && task.status === 'cancelled') {
          const name = task.giver?.name ?? '';
          push({ icon: <MissionsIcon />, avatarKey: task.giver ? avatarOf(task.giver.id) : null, name, text: t(fr.missions.cancelledBy, { name, title: task.title }) });
        }
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);
}

// Sa propre montée de niveau, en grand, au milieu de l'écran : la pastille du nouveau niveau, « Niveau 12 ! », le nouveau grade s'il change, et les kuartzons gagnés.
// Elle s'efface seule (ou d'un clic) ; avec prefers-reduced-motion, sans rien qui bouge (styles.css). Annoncée aux lecteurs d'écran.
export function LevelUpBanner() {
  const [gain, setGain] = useState<XpGain | null>(null);

  useEffect(
    () =>
      listenOnBus(EventBus, 'progress:gain', (next) => {
        if (next.levelAfter > next.levelBefore) setGain(next);
      }),
    [],
  );

  useEffect(() => {
    if (gain === null) return;
    const timer = setTimeout(() => setGain(null), LEVEL_UP_MS);
    return () => clearTimeout(timer);
  }, [gain]);

  if (gain === null) return null;
  const level = gain.levelAfter;
  const newGrade = gradeOf(level) !== gradeOf(gain.levelBefore);
  return (
    <div className="level-up" role="status" onClick={() => setGain(null)}>
      <div className="level-up-card">
        <span className="level-up-burst" aria-hidden="true" />
        <LevelBadge level={level} size="large" />
        <span className="level-up-title">{t(fr.progress.levelUpTitle, { level })}</span>
        {newGrade && <span className="level-up-grade">{t(fr.progress.levelUpGrade, { grade: gradeLabel(level) })}</span>}
        {gain.kuartzons > 0 && (
          <span className="level-up-kuartzons">
            <KuartzonIcon />
            {t(fr.progress.levelUpKuartzons, { count: formatNumber(gain.kuartzons) })}
          </span>
        )}
      </div>
    </div>
  );
}
