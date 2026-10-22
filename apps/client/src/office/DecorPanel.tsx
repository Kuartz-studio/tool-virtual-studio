import {
  DECOR_CATEGORIES,
  FLOOR_THEMES,
  MAX_DECOR_ITEMS,
  WALL_THEMES,
  decorCategoryLabel,
  decorItem,
  decorItemsOf,
  defaultDeskDecor,
  type DecorCategoryId,
} from '@bureau/shared';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { sendDeskCommand } from '../net/desk-commands';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { selectDeskOf, useOfficeStore } from '../state/office-store';
import { roomOfDesk, sameDecor } from './decor-draft';
import { EraserIcon, CloseIcon } from './icons';
import { deskErrorText } from './desks';
import { ReplaceDialog } from './ReplaceDialog';
import { DecorThumb, FloorSwatch, WallSwatch } from './sprites';

// Le panneau Décorer mon bureau : la banque d'éléments (9 catégories, le poste de travail d'abord), et les murs et le sol. Il pilote le
// brouillon de l'éditeur (le magasin) que le jeu montre dans la pièce : on choisit un élément, on le pose en cliquant dans la pièce
// (DecorEditorView). « Enregistrer » envoie toute la déco d'un bloc ; le serveur la valide à son tour et la diffuse à tout le bureau.
// Ouvrir le panneau ouvre l'éditeur sur son bureau ; le fermer le ferme. La gomme efface d'un clic l'élément qu'on vise ; poser sur un autre
// élément le remplace, après la confirmation de ReplaceDialog. Échap lâche l'élément tenu (ou quitte la gomme), puis ferme.
type Tab = 'items' | 'themes';

export function DecorPanel({ id, socket, onClose }: { id?: string; socket: OfficeSocket | null; onClose(): void }) {
  const selfId = useOfficeStore((state) => state.selfId);
  const desks = useOfficeStore((state) => state.desks);
  const ready = useOfficeStore((state) => state.ready);
  const editor = useOfficeStore((state) => state.decorEditor);
  const mine = useMemo(() => selectDeskOf({ desks }, selfId), [desks, selfId]);
  const mineKey = mine?.key;

  // Le panneau ouvre l'éditeur sur son bureau, et le ferme en partant.
  useEffect(() => {
    const store = useOfficeStore.getState();
    const desk = store.desks.find((d) => d.key === mineKey);
    if (desk && store.decorEditor?.deskKey !== desk.key) store.openDecorEditor(desk);
    return () => useOfficeStore.getState().closeDecorEditor();
  }, [mineKey]);

  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const [tab, setTab] = useState<Tab>('items');
  const [category, setCategory] = useState<DecorCategoryId>(DECOR_CATEGORIES[0].id);
  const [search, setSearch] = useState('');
  const items = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('fr');
    // Une recherche porte sur toute la banque ; sans elle, on voit la catégorie choisie.
    if (needle === '') return decorItemsOf(category);
    return DECOR_CATEGORIES.flatMap(({ id: c }) => decorItemsOf(c)).filter((item) => item.name.toLocaleLowerCase('fr').includes(needle));
  }, [category, search]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const store = useOfficeStore.getState;
  const dirty = editor !== null && !sameDecor(editor.draft, editor.saved);
  const held = editor?.held ? decorItem(editor.held) : undefined;

  async function save() {
    if (!editor) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { floor, wall, items: placed } = editor.draft;
    const ack = await sendDeskCommand(socket, { type: 'decor', floor, wall, items: placed });
    setBusy(false);
    if (ack.ok) {
      store().markDecorSaved();
      setNotice(fr.decor.saved);
    } else {
      setError(deskErrorText(ack));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (editor?.held) store().holdDecorItem(null);
    else if (editor?.tool === 'erase') store().setDecorTool('place');
    else onClose();
  }

  const refused = editor?.error ? fr.decor.errors[editor.error] : null;

  return (
    <aside id={id} className="people-panel decor-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="people-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {fr.decor.title}
        </h2>
        <button type="button" className="bar-button" aria-label={fr.decor.close} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {mine === undefined ? (
        <div className="people-lists desk-body">
          <p>{fr.decor.noDesk}</p>
        </div>
      ) : (
        <>
          <div className="decor-tabs" role="tablist" aria-label={fr.decor.tabs.label}>
            <button type="button" role="tab" className="bar-button" aria-selected={tab === 'items'} onClick={() => setTab('items')}>
              {fr.decor.tabs.items}
            </button>
            <button type="button" role="tab" className="bar-button" aria-selected={tab === 'themes'} onClick={() => setTab('themes')}>
              {fr.decor.tabs.themes}
            </button>
          </div>

          <div className="people-lists decor-body">
            {tab === 'items' ? (
              <>
                <div className="decor-tools" role="group" aria-label={fr.decor.tools}>
                  <button
                    type="button"
                    className="bar-button"
                    aria-pressed={editor?.tool === 'erase'}
                    onClick={() => store().setDecorTool(editor?.tool === 'erase' ? 'place' : 'erase')}
                  >
                    <EraserIcon />
                    {fr.decor.erase}
                  </button>
                </div>
                <div className="decor-search">
                  <label className="visually-hidden" htmlFor={`${titleId}-search`}>
                    {fr.decor.searchLabel}
                  </label>
                  <input
                    id={`${titleId}-search`}
                    type="search"
                    value={search}
                    placeholder={fr.decor.searchPlaceholder}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div className="decor-categories" role="group" aria-label={fr.decor.categories}>
                  {DECOR_CATEGORIES.map(({ id: c, label }) => (
                    <button
                      key={c}
                      type="button"
                      className="bar-button"
                      aria-pressed={search.trim() === '' && category === c}
                      onClick={() => {
                        setCategory(c);
                        setSearch('');
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="decor-grid" role="group" aria-label={t(fr.decor.items, { category: search.trim() === '' ? decorCategoryLabel(category) : search.trim() })}>
                  {items.length === 0 && <p className="desk-hint">{fr.decor.empty}</p>}
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="decor-item"
                      aria-pressed={editor?.held === item.id}
                      title={item.name}
                      aria-label={item.name}
                      onClick={() => store().holdDecorItem(editor?.held === item.id ? null : item.id)}
                    >
                      <DecorThumb item={item} />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h3 className="desk-subtitle">{fr.decor.floorTitle}</h3>
                <div className="swatch-grid" role="group" aria-label={fr.decor.floorTitle}>
                  {FLOOR_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className="swatch"
                      aria-pressed={editor?.draft.floor === theme.id}
                      title={theme.label}
                      aria-label={theme.label}
                      onClick={() => store().patchDecorTheme({ floor: theme.id })}
                    >
                      <FloorSwatch gid={theme.gid} />
                    </button>
                  ))}
                </div>
                <h3 className="desk-subtitle">{fr.decor.wallTitle}</h3>
                <div className="swatch-grid" role="group" aria-label={fr.decor.wallTitle}>
                  {WALL_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className="swatch"
                      aria-pressed={editor?.draft.wall === theme.id}
                      title={theme.label}
                      aria-label={theme.label}
                      onClick={() => store().patchDecorTheme({ wall: theme.id })}
                    >
                      <WallSwatch top={theme.top} bottom={theme.bottom} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <footer className="decor-footer">
            {mine?.decorUnfit && (
              <p className="desk-hint" role="status">
                {fr.decor.unfit}
              </p>
            )}
            <p className="desk-hint" role="status">
              {held ? (
                <>
                  {t(fr.decor.held, { name: held.name })}{' '}
                  <button type="button" className="decor-link" onClick={() => store().holdDecorItem(null)}>
                    {fr.decor.drop}
                  </button>
                </>
              ) : editor?.tool === 'erase' ? (
                fr.decor.eraseHelp
              ) : (
                (refused ?? fr.decor.help)
              )}
            </p>
            {held && refused && <p className="decor-refused">{refused}</p>}
            {error && <Alert>{error}</Alert>}
            {notice && !dirty && (
              <p className="desk-hint" role="status">
                {notice}
              </p>
            )}
            <div className="decor-footer-row">
              <span className="desk-hint">{t(fr.decor.count, { count: editor?.draft.items.length ?? 0, max: MAX_DECOR_ITEMS })}</span>
              {dirty && <span className="desk-hint decor-unsaved">{fr.decor.unsaved}</span>}
            </div>
            <div className="decor-footer-row">
              <button type="button" className="bar-button" disabled={busy || !ready || !dirty} onClick={() => void save()}>
                {busy ? fr.decor.saving : fr.decor.save}
              </button>
              <button type="button" className="bar-button" onClick={onClose}>
                {dirty ? fr.decor.cancel : fr.decor.done}
              </button>
            </div>
            <div className="decor-footer-row">
              <button type="button" className="bar-button" onClick={() => editor && store().setDecorDraft(defaultDeskDecor(roomOfDesk(store().officeMap, editor.deskKey)))}>
                {fr.decor.reset}
              </button>
              <button type="button" className="bar-button" onClick={() => editor && store().setDecorDraft({ ...editor.draft, items: [] })}>
                {fr.decor.clear}
              </button>
            </div>
            <p className="desk-hint credits">{fr.decor.credits}</p>
          </footer>
          {editor?.replace && (
            <ReplaceDialog
              replacing={editor.replace.replacing.map((index) => editor.draft.items[index]?.id).filter((id): id is string => id !== undefined)}
              incoming={editor.replace.id}
              onConfirm={() => store().confirmReplace()}
              onCancel={() => store().cancelReplace()}
            />
          )}
        </>
      )}
    </aside>
  );
}
