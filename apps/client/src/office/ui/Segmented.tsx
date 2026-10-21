import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  // Un petit nombre, en retrait, après le libellé (les gens qui sont ici).
  count?: number;
  disabled?: boolean;
  // L'infobulle : pourquoi l'option est inactive.
  title?: string;
}

interface SegmentedProps<T extends string> {
  // Le nom du groupe, pour les lecteurs d'écran.
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  // Un choix, et comment il a été fait : au pointeur (un clic), ou au clavier (une flèche, Entrée ou Espace sur l'onglet : un clic sans pointeur).
  // Au pointeur, l'appelant peut mener le focus où l'on va écrire ; au clavier, il reste sur les onglets.
  onSelect(id: T, how: 'pointer' | 'keyboard'): void;
  // Le panneau que le sélecteur commande, et le nom de chaque onglet, que ce panneau reprend (`aria-labelledby`).
  panelId: string;
  tabId(id: T): string;
}

// Un sélecteur à deux ou trois positions (Ici / Tout le bureau, Tout le monde / À proximité) : une piste en retrait, et l'onglet choisi, en relief.
// Il suit le motif « tabs » : le choisi est le seul dans l'ordre de tabulation ; ← → passent de l'un à l'autre (le focus avec la sélection), Début et
// Fin vont aux extrémités, un onglet inactif est sauté. Ces flèches sont aussi celles de l'avatar : prises ici (preventDefault), il ne les voit pas.
export function Segmented<T extends string>({ label, value, options, onSelect, panelId, tabId }: SegmentedProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = options.filter((option) => !option.disabled);
    const index = enabled.findIndex((option) => option.id === value);
    let next: SegmentedOption<T> | undefined;
    switch (event.key) {
      case 'ArrowRight':
        next = enabled[(index + 1) % enabled.length];
        break;
      case 'ArrowLeft':
        next = enabled[(index - 1 + enabled.length) % enabled.length];
        break;
      case 'Home':
        next = enabled[0];
        break;
      case 'End':
        next = enabled.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next === undefined) return;
    onSelect(next.id, 'keyboard');
    buttons.current.get(next.id)?.focus();
  }

  return (
    <div className="seg" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          key={option.id}
          ref={(element) => {
            if (element) buttons.current.set(option.id, element);
            else buttons.current.delete(option.id);
          }}
          type="button"
          role="tab"
          id={tabId(option.id)}
          className="seg-tab"
          aria-selected={value === option.id}
          aria-controls={panelId}
          // Seul l'onglet choisi est dans l'ordre de tabulation : les flèches mènent aux autres.
          tabIndex={value === option.id ? 0 : -1}
          disabled={option.disabled}
          title={option.title}
          onClick={(event) => onSelect(option.id, event.detail > 0 ? 'pointer' : 'keyboard')}
        >
          {option.label}
          {option.count !== undefined && (
            <>
              {' '}
              <i className="seg-count">{option.count}</i>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
