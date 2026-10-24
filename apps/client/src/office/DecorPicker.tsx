import { DECOR_CATEGORIES, decorItem, decorItemsOf, type DecorCategoryId, type DecorItem } from '@bureau/shared';
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { BuyOffer } from './BuyOffer';
import { loadDecorRecents, rememberDecorItem, searchDecorItems } from './decor-picker';
import { DecorCategoryIcon, EraserIcon, LockIcon, RecentIcon, SearchIcon } from './icons';
import { formatNumber } from './progress-format';
import { DecorThumb } from './sprites';

// Le sélecteur d'éléments de l'onglet « Objets » du panneau Décorer, à la manière d'un sélecteur d'émojis : la recherche et la gomme en
// haut, une rangée d'onglets à icônes (les récents, puis une par catégorie de la banque, son nom en infobulle), le nom de ce qu'on regarde,
// une grille de grandes vignettes, et dessous l'élément survolé (ou celui qu'on tient) : son nom, sa taille en cases, comment il se pose.
// Un clic sur une vignette prend l'élément en main (un autre clic le lâche) ; on le pose ensuite dans la pièce (DecorEditorView).
// La recherche porte sur toute la banque, sans tenir compte des accents ; Échap la vide avant de fermer le panneau.
// Un élément de la boutique qu'on n'a pas acheté porte un cadenas et son prix : un clic ne le prend pas en main, il propose de l'acheter (sous la grille,
// « Acheter pour 800 kuartzons », éteint s'il manque des kuartzons) ; acheté, il se prend en main comme les autres.
type Shelf = DecorCategoryId | 'recent';

export function DecorPicker({ idPrefix, hidden = false }: { idPrefix: string; hidden?: boolean }) {
  const editor = useOfficeStore((state) => state.decorEditor);
  const store = useOfficeStore.getState;

  const [recents, setRecents] = useState(loadDecorRecents);
  // On rouvre le panneau sur ses récents quand il y en a : ce sont les éléments qu'on reprend.
  const [shelf, setShelf] = useState<Shelf>(() => (recents.length > 0 ? 'recent' : DECOR_CATEGORIES[0].id));
  const [search, setSearch] = useState('');
  const [peeked, setPeeked] = useState<string | null>(null);
  // L'élément de la boutique qu'on propose d'acheter (un clic sur un élément pas encore acheté).
  const [offer, setOffer] = useState<DecorItem | null>(null);
  const progress = useOfficeStore((state) => state.progress);
  const owned = useMemo(() => new Set(progress?.owned ?? []), [progress?.owned]);
  const locked = (item: DecorItem) => item.price !== undefined && !owned.has(item.id);
  const grid = useRef<HTMLDivElement>(null);

  const query = search.trim();
  const items = useMemo((): DecorItem[] => {
    if (query !== '') return searchDecorItems(query);
    if (shelf === 'recent') return recents.map(decorItem).filter((item): item is DecorItem => item !== undefined);
    return decorItemsOf(shelf);
  }, [query, shelf, recents]);

  const title =
    query !== ''
      ? t(fr.decor.results, { query })
      : shelf === 'recent'
        ? fr.decor.recents
        : (DECOR_CATEGORIES.find((c) => c.id === shelf)?.label ?? shelf);

  function open(next: Shelf) {
    setShelf(next);
    setSearch('');
    if (grid.current) grid.current.scrollTop = 0;
  }

  function take(id: string) {
    const item = decorItem(id);
    if (item && locked(item)) {
      setOffer(item);
      return;
    }
    hold(id);
  }

  // Prendre un élément en main (ou le lâcher, si on le tenait) ; un élément qu'on vient d'acheter passe par ici, sans attendre que le magasin le sache.
  function hold(id: string) {
    setOffer(null);
    const held = editor?.held === id ? null : id;
    store().holdDecorItem(held);
    if (held === null) return;
    const next = rememberDecorItem(held);
    // Sur l'onglet des récents, la grille ne se réordonne pas sous le pointeur : le nouvel ordre vaudra à la prochaine ouverture.
    if (query !== '' || shelf !== 'recent') setRecents(next);
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape' || search === '') return;
    event.preventDefault();
    event.stopPropagation();
    setSearch('');
  }

  const shelves: { id: Shelf; label: string }[] = [
    ...(recents.length > 0 ? [{ id: 'recent' as const, label: fr.decor.recents }] : []),
    ...DECOR_CATEGORIES.map(({ id, label }) => ({ id, label })),
  ];
  const shown = decorItem(peeked ?? editor?.held ?? '');

  return (
    <div className="decor-picker" hidden={hidden}>
      <div className="decor-picker-top">
        <div className="decor-search">
          <SearchIcon />
          <label className="visually-hidden" htmlFor={`${idPrefix}-search`}>
            {fr.decor.searchLabel}
          </label>
          <input
            id={`${idPrefix}-search`}
            type="search"
            value={search}
            placeholder={fr.decor.searchPlaceholder}
            autoComplete="off"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={onSearchKey}
          />
        </div>
        <button
          type="button"
          className="bar-button decor-erase"
          aria-pressed={editor?.tool === 'erase'}
          onClick={() => store().setDecorTool(editor?.tool === 'erase' ? 'place' : 'erase')}
        >
          <EraserIcon />
          {fr.decor.erase}
        </button>
      </div>

      <div
        className="decor-shelves"
        role="group"
        aria-label={fr.decor.categories}
        style={{ '--shelves': shelves.length, '--shelves-half': Math.ceil(shelves.length / 2) } as CSSProperties}
      >
        {shelves.map(({ id, label }) => (
          <button key={id} type="button" className="decor-shelf" aria-pressed={query === '' && shelf === id} title={label} onClick={() => open(id)}>
            {id === 'recent' ? <RecentIcon /> : <DecorCategoryIcon category={id} />}
            <span className="visually-hidden">{label}</span>
          </button>
        ))}
      </div>

      <p className="decor-shelf-title">
        <span>{title}</span>
        <span className="decor-shelf-count">{items.length}</span>
      </p>

      <div ref={grid} className="decor-tiles-scroll">
        {items.length === 0 ? (
          <p className="desk-hint">{fr.decor.empty}</p>
        ) : (
          <div
            className="decor-tiles"
            role="group"
            aria-label={t(fr.decor.items, { category: title })}
            onPointerLeave={() => setPeeked(null)}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="decor-tile"
                aria-pressed={editor?.held === item.id}
                aria-label={item.name}
                onClick={() => take(item.id)}
                onPointerEnter={() => setPeeked(item.id)}
                onFocus={() => setPeeked(item.id)}
                onBlur={() => setPeeked(null)}
              >
                <DecorThumb item={item} box={64} />
                {locked(item) && (
                  <span className="decor-tile-price" title={t(fr.shop.locked, { price: formatNumber(item.price!) })}>
                    <LockIcon />
                    {formatNumber(item.price!)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {offer && <BuyOffer key={offer.id} id={offer.id} name={offer.name} price={offer.price!} thumb={<DecorThumb item={offer} box={36} />} onBought={() => hold(offer.id)} />}

      <div className="decor-peek">
        {shown ? (
          <>
            <span className="decor-peek-thumb">
              <DecorThumb item={shown} box={36} />
            </span>
            <span className="decor-peek-text">
              <span className="decor-peek-name">
                {shown.name}
                {shown.id === editor?.held && <span className="decor-peek-tag">{fr.decor.heldTag}</span>}
              </span>
              <span className="decor-peek-meta">
                {shown.w * shown.h === 1 ? fr.decor.sizeOne : t(fr.decor.size, { w: shown.w, h: shown.h })} · {fr.decor.kinds[shown.kind]}
              </span>
            </span>
          </>
        ) : (
          <span className="decor-peek-hint">{fr.decor.peekHint}</span>
        )}
      </div>
    </div>
  );
}
