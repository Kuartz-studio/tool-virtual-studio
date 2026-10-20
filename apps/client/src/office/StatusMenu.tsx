import { STATUSES, type Status } from '@bureau/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { fr, t } from '../i18n/fr';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { StatusDot } from './StatusDot';

// Le statut, choisi à la main (spec §10) : un bouton qui dit le statut en cours (celui que le serveur a confirmé, lu au magasin), et un
// menu pour en changer, ce qui envoie `status:set`. Le menu suit le motif « menu button » : Entrée ou Espace sur le bouton l'ouvre ;
// dedans, ↓ ↑ Début Fin passent d'un statut à l'autre, Entrée ou Espace choisit, Échap ferme, et le focus revient au bouton.
// Le bouton, lui, n'ouvre pas le menu avec ↓ ou ↑ (facultatif dans le motif) : ce sont les flèches de l'avatar, et le bouton garde le
// focus après un choix. Elles ne doivent pas rouvrir le menu quand on repart.
//
// Le statut affiché ne change qu'à la confirmation du serveur (`status:changed`) : pas de changement affiché que le serveur n'a pas
// pris. Le bouton est donc inactif tant que le serveur ne prendrait pas le message : pas de socket, ou connexion pas prête (pas encore
// d'`init`, connexion coupée, ou revenue mais pas encore replacée par son `init`).
export function StatusMenu({ socket }: { socket: OfficeSocket | null }) {
  const current = useOfficeStore((state) => state.self?.status ?? null);
  const ready = useOfficeStore((state) => state.ready);
  const enabled = socket !== null && ready && current !== null;

  const [open, setOpen] = useState(false);
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);

  // Après un choix, le focus revient au bouton, dont le nom ne change qu'à la confirmation du serveur : un lecteur d'écran n'entendrait
  // que l'ancien statut. Le nouveau est annoncé (aria-live), mais seulement quand c'est le sien qui change : ni à l'arrivée au
  // bureau, ni pour les autres.
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(current);
  useEffect(() => {
    if (current !== null && announced.current !== null && current !== announced.current) {
      setAnnouncement(t(fr.office.statusMenu.current, { status: fr.status[current] }));
    }
    announced.current = current;
  }, [current]);

  // Plus de changement possible : le menu se ferme.
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  // À l'ouverture, le focus va au statut en cours.
  useEffect(() => {
    if (open) items.current[Math.max(0, STATUSES.indexOf(current ?? STATUSES[0]))]?.focus();
    // Seulement à l'ouverture (`open`) : un statut qui change menu ouvert ne déplace pas le focus.
  }, [open]);

  // Un clic en dehors du menu le ferme.
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function choose(status: Status) {
    close();
    if (status !== current) socket?.emit('status:set', status);
  }

  function focusItem(index: number) {
    items.current[(index + STATUSES.length) % STATUSES.length]?.focus();
  }

  // Les touches du menu. Celles qu'il prend ne vont pas plus loin (preventDefault) : le clavier de l'avatar (game/input.ts) ignore une
  // touche déjà traitée, et ↓ ↑ dans le menu ne font pas marcher l'avatar.
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.current.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case 'ArrowDown':
        focusItem(index + 1);
        break;
      case 'ArrowUp':
        focusItem(index - 1);
        break;
      case 'Home':
        focusItem(0);
        break;
      case 'End':
        focusItem(STATUSES.length - 1);
        break;
      case 'Escape':
        close();
        break;
      case 'Tab':
        // Le focus revient au bouton, d'où la touche continue : l'élément suivant (ou précédent avec Maj) du bouton, et non du menu
        // qui disparaît.
        close();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  const label = current === null ? fr.office.statusMenu.label : fr.status[current];

  return (
    <div className="status-menu" ref={container}>
      <button
        ref={trigger}
        type="button"
        className="bar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={current === null ? fr.office.statusMenu.label : t(fr.office.statusMenu.current, { status: label })}
        disabled={!enabled}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <StatusDot status={current} />
        <span>{label}</span>
        <span className="bar-button-caret" aria-hidden="true">
          ▴
        </span>
      </button>
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {open && (
        <div id={menuId} className="status-menu-list" role="menu" aria-label={fr.office.statusMenu.menu} onKeyDown={onMenuKeyDown}>
          {STATUSES.map((status, index) => (
            <button
              key={status}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={status === current}
              tabIndex={-1}
              className="status-menu-item"
              onClick={() => choose(status)}
            >
              <StatusDot status={status} />
              <span>{fr.status[status]}</span>
              {status === current && (
                <span className="status-menu-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
