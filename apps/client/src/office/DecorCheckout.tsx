import { decorItem, wallTheme } from '@bureau/shared';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { cartTotal, type CartLine } from './decor-cart';
import { CloseIcon, KuartzonIcon } from './icons';
import { formatNumber } from './progress-format';
import { DecorThumb, WallPreview } from './sprites';
import { IconButton } from './ui/IconButton';

// La caisse du panneau Décorer : enregistrer une déco qui essaie des articles de la boutique demande de les acheter. Une boîte de dialogue modale comme
// ReplaceDialog (alertdialog : le focus sur « Annuler », le geste sûr ; Tab ne sort pas de la boîte ; Échap renonce ; un clic sur le fond ne fait rien ; ses
// touches n'en sortent pas, ni Échap vers le panneau, ni les flèches vers l'avatar). Elle liste ce qu'on achèterait (l'imagette, le nom, le prix, une croix pour
// le retirer de la pièce), le total, la bourse et ce qu'il en resterait, ou ce qui manque. Puis, l'un sous l'autre : « Acheter et enregistrer », éteint s'il
// manque des kuartzons ; « Enregistrer sans ces articles » ; « Annuler », qui garde l'aperçu.
export function DecorCheckout({
  lines,
  kuartzons,
  busy,
  error,
  onBuy,
  onWithout,
  onRemove,
  onCancel,
}: {
  lines: readonly CartLine[];
  kuartzons: number;
  busy: boolean;
  error: string | null;
  onBuy(): void;
  onWithout(): void;
  onRemove(id: string): void;
  onCancel(): void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
  }, []);

  const total = cartTotal(lines);
  const missing = total - kuartzons;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Tab') {
      // Le focus boucle sur les boutons de la boîte (une croix retirée, un bouton éteint, en sortent d'eux-mêmes).
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const [first, last] = [buttons[0], buttons[buttons.length - 1]];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  return (
    <div
      className="admin-dialog-backdrop"
      onMouseDown={(event) => {
        // Appuyer sur le fond retirerait le focus à la boîte, et le clavier n'y serait plus.
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="admin-dialog decor-checkout"
        onKeyDown={onKeyDown}
      >
        <h4 id={titleId}>{fr.decor.checkout.title}</h4>
        <p id={bodyId}>{lines.length === 1 ? fr.decor.checkout.bodyOne : fr.decor.checkout.bodyMany}</p>
        <ul className="decor-checkout-lines" aria-label={fr.decor.checkout.lines}>
          {lines.map((line) => (
            <li key={line.id} className="decor-checkout-line">
              <span className="decor-checkout-thumb">
                <LineThumb line={line} />
              </span>
              <span className="decor-checkout-text">
                <span className="decor-checkout-name">{line.name}</span>
                <span className="decor-checkout-meta">{lineMeta(line)}</span>
              </span>
              <span className="decor-checkout-price">
                <KuartzonIcon />
                {formatNumber(line.price)}
              </span>
              <IconButton small label={t(fr.decor.checkout.remove, { name: line.name })} disabled={busy} onClick={() => onRemove(line.id)}>
                <CloseIcon />
              </IconButton>
            </li>
          ))}
        </ul>
        <dl className="decor-checkout-sum">
          <div>
            <dt>{fr.decor.checkout.total}</dt>
            <dd>
              <KuartzonIcon />
              {formatNumber(total)}
            </dd>
          </div>
          <div>
            <dt>{fr.decor.checkout.wallet}</dt>
            <dd>{formatNumber(kuartzons)}</dd>
          </div>
          {missing > 0 ? (
            <div data-missing="">
              <dt>{fr.decor.checkout.missing}</dt>
              <dd>{formatNumber(missing)}</dd>
            </div>
          ) : (
            <div>
              <dt>{fr.decor.checkout.after}</dt>
              <dd>{formatNumber(-missing)}</dd>
            </div>
          )}
        </dl>
        {error && (
          <p className="decor-refused" role="alert">
            {error}
          </p>
        )}
        <div className="decor-checkout-actions">
          <button type="button" className="bar-button is-primary" disabled={busy || missing > 0} data-sfx="none" onClick={onBuy}>
            <KuartzonIcon />
            {busy ? fr.decor.checkout.buying : fr.decor.checkout.buy}
          </button>
          <button type="button" className="bar-button" disabled={busy} onClick={onWithout}>
            {fr.decor.checkout.without}
          </button>
          <button ref={cancelButton} type="button" className="bar-button" onClick={onCancel}>
            {fr.decor.checkout.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

// L'imagette d'une ligne : l'élément, ou deux cases de la face du mur.
function LineThumb({ line }: { line: CartLine }) {
  if (line.kind === 'wall') {
    const wall = wallTheme(line.id);
    return wall ? <WallPreview top={wall.top} bottom={wall.bottom} /> : null;
  }
  const item = decorItem(line.id);
  return item ? <DecorThumb item={item} box={36} /> : null;
}

// Sous le nom : « Mur de la pièce », ou la taille de l'élément en cases.
function lineMeta(line: CartLine): string {
  if (line.kind === 'wall') return fr.shop.wallMeta;
  const item = decorItem(line.id);
  if (!item) return '';
  return item.w * item.h === 1 ? fr.decor.sizeOne : t(fr.decor.size, { w: item.w, h: item.h });
}
