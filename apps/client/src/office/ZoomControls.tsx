import { MAX_ZOOM_LEVEL, zoomPercent } from '../game/zoom';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';

// Les boutons du zoom, en bas à gauche, au-dessus de la barre : plus près, la vue de départ (le pourcentage), plus loin. Le jeu lit le
// niveau au magasin ; la molette et les touches + - 0 le changent aussi. Chaque bouton s'éteint à sa limite (×2 plus près, ×4 plus loin).
export function ZoomControls() {
  const level = useOfficeStore((state) => state.zoomLevel);
  const stepZoom = useOfficeStore((state) => state.stepZoom);
  const resetZoom = useOfficeStore((state) => state.resetZoom);
  const percent = zoomPercent(level);
  return (
    <div className="zoom-controls" role="group" aria-label={fr.zoom.group}>
      <button type="button" className="bar-button" aria-label={fr.zoom.in} disabled={level >= MAX_ZOOM_LEVEL} onClick={() => stepZoom(1)}>
        <span aria-hidden="true">+</span>
      </button>
      <button type="button" className="bar-button zoom-level" aria-label={fr.zoom.reset} title={fr.zoom.reset} onClick={resetZoom}>
        {t(fr.zoom.level, { percent })}
      </button>
      <button type="button" className="bar-button" aria-label={fr.zoom.out} disabled={level <= 0} onClick={() => stepZoom(-1)}>
        <span aria-hidden="true">−</span>
      </button>
    </div>
  );
}
