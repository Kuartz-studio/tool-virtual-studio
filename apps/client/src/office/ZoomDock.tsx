import { MAX_ZOOM_LEVEL } from '../game/zoom';
import { fr } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { MinusIcon, PlusIcon } from './icons';
import { IconButton } from './ui/IconButton';

// Le zoom, en bas à droite à côté du dock des panneaux : plus loin, plus près. Le jeu lit le niveau au magasin ; la molette et les touches
// + - 0 le changent aussi. Chaque bouton s'éteint à sa limite (×2 plus près, ×4 plus loin). La vue de départ (100 %) est dans le menu « Plus ».
export function ZoomDock() {
  const level = useOfficeStore((state) => state.zoomLevel);
  const stepZoom = useOfficeStore((state) => state.stepZoom);
  return (
    <div className="dock dock-zoom" role="group" aria-label={fr.zoom.group}>
      <IconButton label={fr.zoom.out} shortcut="−" disabled={level <= 0} onClick={() => stepZoom(-1)}>
        <MinusIcon />
      </IconButton>
      <IconButton label={fr.zoom.in} shortcut="+" disabled={level >= MAX_ZOOM_LEVEL} onClick={() => stepZoom(1)}>
        <PlusIcon />
      </IconButton>
    </div>
  );
}
