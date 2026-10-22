import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { fr } from '../i18n/fr';

// La confirmation d'un abandon : une boîte de dialogue modale (alertdialog), nommée par sa question et décrite par ses conséquences, comme le retrait d'un membre (AdminPanel). Le
// focus est sur « Annuler », le geste sûr ; Tab ne sort pas de la boîte ; Échap et « Annuler » renoncent. Un clic sur le fond ne fait rien : un double clic sur « Abandonner » la
// fermerait à peine ouverte, et la décision doit être un geste voulu. Aucune touche n'en sort (stopPropagation) : ni vers le panneau (Échap le fermerait), ni vers l'avatar.
export function ResignDialog({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Tab') {
      // Le focus boucle entre les deux boutons.
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
        // Appuyer sur le fond retirerait le focus à la boîte : le clavier n'y serait plus.
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1} className="admin-dialog" onKeyDown={onKeyDown}>
        <h4 id={titleId}>{fr.games.actions.resignTitle}</h4>
        <p id={bodyId}>{fr.games.actions.resignBody}</p>
        <div className="admin-dialog-actions">
          <button ref={cancelButton} type="button" className="bar-button" data-sfx="none" onClick={onCancel}>
            {fr.games.actions.resignCancel}
          </button>
          <button ref={confirmButton} type="button" className="bar-button bar-button-danger" onClick={onConfirm}>
            {fr.games.actions.resignConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
