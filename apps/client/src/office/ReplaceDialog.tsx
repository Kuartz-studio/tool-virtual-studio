import { decorItem, type DecorItem } from '@bureau/shared';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import { DecorThumb } from './sprites';

// La confirmation d'un remplacement : poser un élément sur d'autres de la même sorte les remplace, et la personne doit le vouloir. Une boîte
// de dialogue modale (alertdialog) comme celle du retrait d'une personne (AdminPanel) : le focus est sur « Annuler », le geste sûr ; Tab ne
// sort pas de la boîte ; Échap et « Annuler » renoncent ; un clic sur le fond ne fait rien. Les touches de la boîte n'en sortent pas :
// Échap ne ferme pas le panneau, et les flèches ne font pas marcher l'avatar. Elle montre l'élément qui part, une flèche, celui qui arrive.
export function ReplaceDialog({ replacing, incoming, onConfirm, onCancel }: { replacing: readonly string[]; incoming: string; onConfirm(): void; onCancel(): void }) {
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
  }, []);

  const outgoing = replacing.map((id) => decorItem(id)).filter((item): item is DecorItem => item !== undefined);
  const arriving = decorItem(incoming);
  const many = outgoing.length > 1;
  const names = outgoing.map((item) => item.name).join(', ');

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Tab') {
      // Le focus boucle entre les deux boutons. (Un clic dans la boîte, hors d'eux, donne le focus à la boîte elle-même.)
      const active = document.activeElement;
      if (event.shiftKey && (active === cancelButton.current || active === dialog.current)) {
        event.preventDefault();
        confirmButton.current?.focus();
      } else if (!event.shiftKey && active === confirmButton.current) {
        event.preventDefault();
        cancelButton.current?.focus();
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
      <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1} className="admin-dialog" onKeyDown={onKeyDown}>
        <h4 id={titleId}>{many ? fr.decor.replace.titleMany : fr.decor.replace.titleOne}</h4>
        <div className="replace-preview" aria-hidden="true">
          {outgoing.map((item, index) => (
            <DecorThumb key={`${item.id}-${index}`} item={item} />
          ))}
          <span className="replace-arrow">→</span>
          {arriving && <DecorThumb item={arriving} />}
        </div>
        <p id={bodyId}>
          {many ? fr.decor.replace.bodyMany : fr.decor.replace.bodyOne}
          <span className="visually-hidden"> {t(many ? fr.decor.replace.detailMany : fr.decor.replace.detail, { old: names, new: arriving?.name ?? '' })}</span>
        </p>
        <div className="admin-dialog-actions">
          <button ref={cancelButton} type="button" className="bar-button" onClick={onCancel}>
            {fr.decor.replace.cancel}
          </button>
          <button ref={confirmButton} type="button" className="bar-button bar-button-danger" onClick={onConfirm}>
            {fr.decor.replace.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
