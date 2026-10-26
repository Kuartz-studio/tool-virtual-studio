import { useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { COLOR_DOTS, FLOOR_ENTRIES, WALL_ENTRIES, materialsOf, shelvesByColor, type ColorShelf, type MaterialFilter } from './decor-themes';
import { LockIcon } from './icons';
import { formatNumber } from './progress-format';
import { FloorSwatch, WallSwatch } from './sprites';

// L'onglet « Murs et sol » du panneau Décorer : en haut, le sélecteur de matière (Toutes, puis chacune de celles qu'ont les thèmes) ; dessous, les sols puis
// les murs, rangés par couleur : le nom de la couleur et sa pastille, puis les thèmes de cette couleur. Choisir une matière filtre les deux listes, et une
// couleur qui n'a rien dans cette matière disparaît. Un clic sur un thème l'essaie dans la pièce (le brouillon de l'éditeur). Un mur de la boutique pas
// encore acheté porte un cadenas et son prix, et se choisit quand même, à l'essai : c'est l'enregistrement qui demande de l'acheter (DecorPanel).
const MATERIALS: readonly MaterialFilter[] = ['all', ...materialsOf(FLOOR_ENTRIES, WALL_ENTRIES)];

export function DecorThemes({ owned }: { owned: ReadonlySet<string> }) {
  const draft = useOfficeStore((state) => state.decorEditor?.draft);
  const store = useOfficeStore.getState;
  const [material, setMaterial] = useState<MaterialFilter>('all');
  const floors = useMemo(() => shelvesByColor(FLOOR_ENTRIES, material), [material]);
  const walls = useMemo(() => shelvesByColor(WALL_ENTRIES, material), [material]);

  return (
    <>
      <div className="theme-materials" role="group" aria-label={fr.decor.materialsLabel}>
        {MATERIALS.map((id) => (
          <button key={id} type="button" className="bar-button" aria-pressed={material === id} onClick={() => setMaterial(id)}>
            {id === 'all' ? fr.decor.allMaterials : fr.decor.materials[id]}
          </button>
        ))}
      </div>

      <h3 className="desk-subtitle">{fr.decor.floorTitle}</h3>
      <div className="theme-shelves" role="group" aria-label={fr.decor.floorTitle}>
        {floors.length === 0 && <p className="desk-hint">{fr.decor.noFloors}</p>}
        {floors.map((shelf) => (
          <Shelf key={shelf.color} shelf={shelf}>
            {(theme) => (
              <button
                key={theme.id}
                type="button"
                className="swatch"
                aria-pressed={draft?.floor === theme.id}
                title={theme.label}
                aria-label={theme.label}
                onClick={() => store().patchDecorTheme({ floor: theme.id })}
              >
                <FloorSwatch gid={theme.gid} />
              </button>
            )}
          </Shelf>
        ))}
      </div>

      <h3 className="desk-subtitle">{fr.decor.wallTitle}</h3>
      <div className="theme-shelves" role="group" aria-label={fr.decor.wallTitle}>
        {walls.length === 0 && <p className="desk-hint">{fr.decor.noWalls}</p>}
        {walls.map((shelf) => (
          <Shelf key={shelf.color} shelf={shelf}>
            {(theme) => {
              const locked = theme.price !== undefined && !owned.has(theme.id);
              const label = locked ? t(fr.decor.lockedWall, { name: theme.label, price: formatNumber(theme.price!) }) : theme.label;
              return (
                <button
                  key={theme.id}
                  type="button"
                  className="swatch"
                  data-locked={locked || undefined}
                  aria-pressed={draft?.wall === theme.id}
                  title={label}
                  aria-label={label}
                  onClick={() => store().patchDecorTheme({ wall: theme.id })}
                >
                  <WallSwatch top={theme.top} bottom={theme.bottom} />
                  {locked && (
                    <span className="decor-tile-price">
                      <LockIcon />
                      {formatNumber(theme.price!)}
                    </span>
                  )}
                </button>
              );
            }}
          </Shelf>
        ))}
      </div>
    </>
  );
}

// Une couleur : son nom et sa pastille (le nom du groupe, pour les lecteurs d'écran), puis ses thèmes.
function Shelf<T>({ shelf, children }: { shelf: ColorShelf<T>; children(theme: T): ReactNode }) {
  const nameId = useId();
  return (
    <div className="theme-shelf" role="group" aria-labelledby={nameId}>
      <span className="theme-shelf-name" id={nameId}>
        <span className="theme-color-dot" style={{ '--dot': COLOR_DOTS[shelf.color] } as CSSProperties} aria-hidden="true" />
        {fr.decor.colors[shelf.color]}
      </span>
      <div className="swatch-grid">{shelf.themes.map(children)}</div>
    </div>
  );
}
