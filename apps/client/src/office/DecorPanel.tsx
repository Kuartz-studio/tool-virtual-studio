import { FLOOR_THEMES, MAX_DECOR_ITEMS, SHOP_WALL_THEMES, WALL_THEMES, decorItem, defaultDeskDecor, type DeskDecor } from '@bureau/shared';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { sendDeskCommand } from '../net/desk-commands';
import { emitOnBus } from '../net/office-connection';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { selectDeskOf, useOfficeStore } from '../state/office-store';
import { cartTotal, unpaidIn, withoutLine, withoutUnpaid, type CartLine } from './decor-cart';
import { DecorCheckout } from './DecorCheckout';
import { roomOfDesk, sameDecor } from './decor-draft';
import { DecorPicker } from './DecorPicker';
import { CloseIcon, InfoIcon, KuartzonIcon, LockIcon } from './icons';
import { deskErrorText } from './desks';
import { ReplaceDialog } from './ReplaceDialog';
import { formatNumber } from './progress-format';
import { FloorSwatch, WallSwatch } from './sprites';
import { useToasts } from './Toasts';
import { IconButton } from './ui/IconButton';

// Le panneau Décorer mon bureau : la banque d'éléments (le sélecteur, DecorPicker), et les murs et le sol. Il pilote le
// brouillon de l'éditeur (le magasin) que le jeu montre dans la pièce : on choisit un élément, on le pose en cliquant dans la pièce
// (DecorEditorView). « Enregistrer » envoie toute la déco d'un bloc ; le serveur la valide à son tour et la diffuse à tout le bureau.
// Ouvrir le panneau ouvre l'éditeur sur son bureau ; le fermer le ferme. La gomme efface d'un clic l'élément qu'on vise ; poser sur un autre
// élément le remplace, après la confirmation de ReplaceDialog. Échap lâche l'élément tenu (ou quitte la gomme), puis ferme ; la croix
// de l'en-tête ferme aussi (sans enregistrer : le brouillon part avec l'éditeur).
// La boutique s'essaie : ses éléments et ses murs se posent comme les autres, même pas encore achetés (le brouillon n'est montré qu'ici). Le pied du panneau
// dit ce qui est à l'essai et combien il coûte ; « Enregistrer » ouvre alors la caisse (DecorCheckout) : acheter et enregistrer d'un coup, ou enregistrer
// sans ces articles.
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
  // Ce qu'on possède de la boutique, et sa bourse : ce que le brouillon essaie sans l'avoir acheté (`cart`) s'achète en enregistrant.
  const ownedList = useOfficeStore((state) => state.progress?.owned);
  const owned = useMemo(() => new Set(ownedList ?? []), [ownedList]);
  const kuartzons = useOfficeStore((state) => state.progress?.kuartzons ?? 0);
  const cart = useMemo(() => (editor ? unpaidIn(editor.draft, owned) : []), [editor, owned]);
  const [checkout, setCheckout] = useState(false);
  // La caisse se ferme d'elle-même quand il n'y a plus rien à acheter : tout retiré, ou acheté entre-temps.
  useEffect(() => {
    if (cart.length === 0) setCheckout(false);
  }, [cart.length]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const store = useOfficeStore.getState;
  const dirty = editor !== null && !sameDecor(editor.draft, editor.saved);
  const held = editor?.held ? decorItem(editor.held) : undefined;

  // Enregistrer cette déco, en achetant ces articles du même coup (le serveur achète tout ou rien, et seulement une déco qu'il accepte).
  async function send(draft: DeskDecor, buying: readonly CartLine[] = []) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { floor, wall, items: placed } = draft;
    const ack = await sendDeskCommand(socket, { type: 'decor', floor, wall, items: placed, ...(buying.length > 0 ? { buy: buying.map((line) => line.id) } : {}) });
    setBusy(false);
    if (!ack.ok) {
      setError(deskErrorText(ack));
      return;
    }
    store().markDecorSaved();
    setCheckout(false);
    if (buying.length > 0) {
      emitOnBus(EventBus, 'shop:bought', { itemId: buying[0]!.id });
      useToasts.getState().push({ icon: <KuartzonIcon />, text: t(fr.decor.checkout.done, { names: buying.map((line) => line.name).join(', ') }) });
    }
    setNotice(buying.length > 0 ? fr.decor.checkout.saved : fr.decor.saved);
  }

  // « Enregistrer » : tout de suite si rien n'est à l'essai, sinon la caisse.
  function save() {
    if (!editor) return;
    setError(null);
    if (cart.length > 0) setCheckout(true);
    else void send(editor.draft);
  }

  // Renoncer aux achats : la déco sans ce qui n'est pas acheté (le mur enregistré revient), enregistrée si elle change encore quelque chose.
  function saveWithout() {
    if (!editor) return;
    const next = withoutUnpaid(editor.draft, owned, editor.saved.wall);
    store().setDecorDraft(next);
    if (sameDecor(next, editor.saved)) setCheckout(false);
    else void send(next);
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
            {/* Le sélecteur reste monté sous « Murs et sol » : on y retrouve sa catégorie et sa recherche. */}
            <DecorPicker idPrefix={titleId} hidden={tab !== 'items'} />
            {tab === 'themes' && (
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
                <h3 className="desk-subtitle">{fr.decor.shopWallsTitle}</h3>
                <div className="swatch-grid" role="group" aria-label={fr.decor.shopWallsTitle}>
                  {SHOP_WALL_THEMES.map((theme) => {
                    const locked = !owned.has(theme.id);
                    const label = locked ? t(fr.decor.lockedWall, { name: theme.label, price: formatNumber(theme.price) }) : theme.label;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        className="swatch"
                        data-locked={locked || undefined}
                        aria-pressed={editor?.draft.wall === theme.id}
                        title={label}
                        aria-label={label}
                        onClick={() => store().patchDecorTheme({ wall: theme.id })}
                      >
                        <WallSwatch top={theme.top} bottom={theme.bottom} />
                        {locked && (
                          <span className="decor-tile-price">
                            <LockIcon />
                            {formatNumber(theme.price)}
                          </span>
                        )}
                      </button>
                    );
                  })}
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
            {/* Ce qui se passe, en une ligne courte : l'élément en main, la gomme, un refus. L'aide entière est derrière l'icône « i ». */}
            {(held || editor?.tool === 'erase' || refused) && (
              <p className="desk-hint decor-status" role="status">
                {held ? (
                  <>
                    {t(fr.decor.held, { name: held.name })}
                    {' · '}
                    <button type="button" className="decor-link" onClick={() => store().holdDecorItem(null)}>
                      {fr.decor.drop}
                    </button>
                  </>
                ) : editor?.tool === 'erase' ? (
                  fr.decor.eraseHelp
                ) : (
                  refused
                )}
              </p>
            )}
            {held && refused && <p className="decor-refused">{refused}</p>}
            {error && !checkout && <Alert>{error}</Alert>}
            {cart.length > 0 && (
              <p className="decor-cart" role="status">
                <KuartzonIcon />
                <span>{t(cart.length === 1 ? fr.decor.cart.one : fr.decor.cart.many, { count: cart.length, total: formatNumber(cartTotal(cart)) })}</span>
              </p>
            )}
            <div className="decor-meta">
              <IconButton className="decor-help" small label={fr.decor.helpLabel} hint={fr.decor.help}>
                <InfoIcon />
              </IconButton>
              <span className="desk-hint">{t(fr.decor.count, { count: editor?.draft.items.length ?? 0, max: MAX_DECOR_ITEMS })}</span>
              <span className="decor-state" data-unsaved={dirty || undefined} aria-live="polite">
                {dirty ? fr.decor.unsaved : notice}
              </span>
            </div>
            <div className="decor-actions">
              <button
                type="button"
                className="bar-button"
                aria-label={fr.decor.reset}
                onClick={() => editor && store().setDecorDraft(defaultDeskDecor(roomOfDesk(store().officeMap, editor.deskKey)))}
              >
                {fr.decor.resetShort}
              </button>
              <button type="button" className="bar-button" onClick={() => editor && store().setDecorDraft({ ...editor.draft, items: [] })}>
                {fr.decor.clear}
              </button>
              <button type="button" className="bar-button is-primary" disabled={busy || !ready || !dirty} onClick={save}>
                {busy ? fr.decor.saving : fr.decor.save}
              </button>
            </div>
            <p className="desk-hint credits">{fr.decor.credits}</p>
          </footer>
          {checkout && editor && cart.length > 0 && (
            <DecorCheckout
              lines={cart}
              kuartzons={kuartzons}
              busy={busy}
              error={error}
              onBuy={() => void send(editor.draft, cart)}
              onWithout={saveWithout}
              onRemove={(id) => store().setDecorDraft(withoutLine(editor.draft, id, editor.saved.wall))}
              onCancel={() => {
                setCheckout(false);
                setError(null);
              }}
            />
          )}
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
