import { ZOOM_BUTTON_STEP, ZOOM_MAX_PERCENT, ZOOM_MIN_PERCENT } from '../game/zoom';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { MinusIcon, PlusIcon } from './icons';
import { IconButton } from './ui/IconButton';

// Le zoom, en bas à droite à côté du dock des panneaux : plus loin, le pourcentage du moment (un clic le ramène à 100 %), plus près. Le jeu
// lit le pourcentage au magasin ; la molette et les touches + - 0 le changent aussi. Un bouton fait 10 %, un cran de molette 5 % ; chaque bouton
// s'éteint à sa limite (200 % au plus près, 25 % au plus loin).
export function ZoomDock() {
  const percent = useOfficeStore((state) => state.zoomPercent);
  const stepZoom = useOfficeStore((state) => state.stepZoom);
  const resetZoom = useOfficeStore((state) => state.resetZoom);
  return (
    <div className="dock dock-zoom" role="group" aria-label={fr.zoom.group}>
      <IconButton label={fr.zoom.out} shortcut="−" disabled={percent <= ZOOM_MIN_PERCENT} onClick={() => stepZoom(-1, ZOOM_BUTTON_STEP)}>
        <MinusIcon />
      </IconButton>
      <IconButton className="zoom-reset" label={fr.zoom.reset} shortcut="0" onClick={() => resetZoom()}>
        <span className="zoom-value">{t(fr.zoom.level, { percent })}</span>
      </IconButton>
      <IconButton label={fr.zoom.in} shortcut="+" disabled={percent >= ZOOM_MAX_PERCENT} onClick={() => stepZoom(1, ZOOM_BUTTON_STEP)}>
        <PlusIcon />
      </IconButton>
    </div>
  );
}
