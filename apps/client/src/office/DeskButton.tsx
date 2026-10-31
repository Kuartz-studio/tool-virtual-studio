import { useEffect, useMemo, useState } from 'react';
import { EventBus } from '../game/EventBus';
import { fr } from '../i18n/fr';
import { emitOnBus, listenOnBus } from '../net/office-connection';
import { selectDeskOf, useOfficeStore } from '../state/office-store';
import { DoorOpenIcon, SlidersIcon } from './icons';
import type { PanelControls } from './panels';
import { IconButton } from './ui/IconButton';
import { useInMyDesk } from './use-here';

// Le bouton du bureau, dans le dock du milieu, à droite de la musique : il change selon l'endroit, et sans transition (c'est le même bouton, qui
// change de nom, d'icône et de geste).
// - Hors de son bureau : « Aller à mon bureau ». Le clic demande au jeu de faire marcher l'avatar jusque-là (`local:walk-to-desk`, game/auto-walk.ts :
//   il marche comme au clavier, les autres le voient passer). Pendant la marche, le bouton est enfoncé (le jeu dit `walk:state`) et un second clic
//   l'arrête (`local:walk-cancel`).
// - Dans son bureau (la pièce qui contient les pieds, comme pour « Bureau de Léa » : where.ts) : « Réglages du bureau », qui ouvre le panneau du bureau,
//   ou le ferme. Enfoncé tant qu'il est ouvert.
// Sans bureau à soi (toutes les places étaient prises, ou il a été rendu), rien : il n'y a nulle part où aller.
export function DeskButton({ panels }: { panels: PanelControls }) {
  const desks = useOfficeStore((state) => state.desks);
  const selfId = useOfficeStore((state) => state.selfId);
  const hasDesk = useMemo(() => Boolean(selectDeskOf({ desks }, selfId)), [desks, selfId]);
  const inside = useInMyDesk();

  // Le jeu dit quand l'avatar part, et quand il s'arrête (arrivé, interrompu, bloqué). Une course vers un point (un double-clic) n'est pas pour son bureau.
  const [walking, setWalking] = useState(false);
  useEffect(() => listenOnBus(EventBus, 'walk:state', (state) => setWalking(state.walking && state.to !== 'point')), []);

  if (!hasDesk) return null;

  if (inside) {
    const open = panels.open === 'desk';
    return (
      <IconButton
        label={fr.desk.settings}
        pressed={open}
        aria-controls={open ? panels.idOf('desk') : undefined}
        data-sfx={open ? 'panel-close' : 'panel-open'}
        onClick={(event) => panels.toggle('desk', event.currentTarget)}
      >
        <SlidersIcon />
      </IconButton>
    );
  }
  return (
    <IconButton label={fr.desk.goto} pressed={walking} onClick={() => emitOnBus(EventBus, walking ? 'local:walk-cancel' : 'local:walk-to-desk')}>
      <DoorOpenIcon />
    </IconButton>
  );
}
