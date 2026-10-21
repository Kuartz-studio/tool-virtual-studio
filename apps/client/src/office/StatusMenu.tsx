import { STATUSES, type ActivityState, type Status } from '@bureau/shared';
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
// Après les quatre statuts, les états d'activité que la personne a créés (même motif : un choix à la fois, cochés), puis, si `onManage` est
// donné, « Mes états d'activité… » qui ouvre leur panneau. Un état d'activité passe avant le statut pour le point et le nom du bouton.
//
// Le statut affiché ne change qu'à la confirmation du serveur (`status:changed`) : pas de changement affiché que le serveur n'a pas
// pris. Le bouton est donc inactif tant que le serveur ne prendrait pas le message : pas de socket, ou connexion pas prête (pas encore
// d'`init`, connexion coupée, ou revenue mais pas encore replacée par son `init`).
// Une ligne du menu : un statut, un état d'activité, ou « Mes états d'activité… ».
type Entry = { key: string; kind: 'status'; status: Status } | { key: string; kind: 'state'; state: ActivityState } | { key: string; kind: 'manage' };

export function StatusMenu({ socket, onManage }: { socket: OfficeSocket | null; onManage?: () => void }) {
  const current = useOfficeStore((state) => state.self?.status ?? null);
  const activity = useOfficeStore((state) => state.self?.activity ?? null);
  const myStates = useOfficeStore((state) => state.myStates);
  const ready = useOfficeStore((state) => state.ready);
  const enabled = socket !== null && ready && current !== null;

  const [open, setOpen] = useState(false);
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const entries: Entry[] = [
    ...STATUSES.map((status): Entry => ({ key: status, kind: 'status', status })),
    ...myStates.map((state): Entry => ({ key: `state:${state.id}`, kind: 'state', state })),
    ...(onManage ? [{ key: 'manage', kind: 'manage' } as const] : []),
  ];
  // Le nom affiché : celui de l'état d'activité en cours, sinon du statut.
  const currentLabel = current === null ? null : activity ? activity.label : fr.status[current];

  // Après un choix, le focus revient au bouton, dont le nom ne change qu'à la confirmation du serveur : un lecteur d'écran n'entendrait
  // que l'ancien statut. Le nouveau est annoncé (aria-live), mais seulement quand c'est le sien qui change : ni à l'arrivée au
  // bureau, ni pour les autres.
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(currentLabel);
  useEffect(() => {
    if (currentLabel !== null && announced.current !== null && currentLabel !== announced.current) {
      setAnnouncement(t(fr.office.statusMenu.current, { status: currentLabel }));
    }
    announced.current = currentLabel;
  }, [currentLabel]);

  // Plus de changement possible : le menu se ferme.
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  // À l'ouverture, le focus va au statut en cours.
  useEffect(() => {
    if (open) {
      const at = activity ? entries.findIndex((entry) => entry.kind === 'state' && entry.state.id === activity.id) : STATUSES.indexOf(current ?? STATUSES[0]);
      items.current[Math.max(0, at)]?.focus();
    }
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

  // Le choix est aussi retenu au magasin (chosenStatus) : la connexion le redit à un serveur redémarré, qui l'a oublié.
  // Un statut ordinaire prend la place de l'état d'activité en cours : le serveur l'efface, même si le statut ne change pas.
  function choose(status: Status) {
    close();
    useOfficeStore.getState().setChosenStatus(status);
    useOfficeStore.getState().setChosenActivity(null);
    if (status !== current || activity !== null) socket?.emit('status:set', status);
  }

  // Un état d'activité : retenu comme choix de cet onglet (le statut choisi, lui, est oublié : il n'est plus celui de la personne).
  function chooseState(state: ActivityState) {
    close();
    useOfficeStore.getState().setChosenActivity(state.id);
    useOfficeStore.getState().setChosenStatus(null);
    if (activity?.id !== state.id) socket?.emit('state:set', state.id);
  }

  function manage() {
    setOpen(false);
    onManage?.();
  }

  function focusItem(index: number) {
    items.current[(index + entries.length) % entries.length]?.focus();
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
        focusItem(entries.length - 1);
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

  const label = currentLabel ?? fr.office.statusMenu.label;

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
        <StatusDot status={current} activity={activity} />
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
          {entries.map((entry, index) => {
            const ref = (element: HTMLButtonElement | null) => {
              items.current[index] = element;
            };
            if (entry.kind === 'manage') {
              return (
                <button key={entry.key} ref={ref} type="button" role="menuitem" tabIndex={-1} className="status-menu-item status-menu-manage" onClick={manage}>
                  <span>{fr.office.statusMenu.manage}</span>
                </button>
              );
            }
            const isState = entry.kind === 'state';
            const checked = isState ? activity?.id === entry.state.id : activity === null && entry.status === current;
            return (
              <button
                key={entry.key}
                ref={ref}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                className="status-menu-item"
                onClick={() => (isState ? chooseState(entry.state) : choose(entry.status))}
              >
                {isState ? <StatusDot status={null} activity={entry.state} /> : <StatusDot status={entry.status} />}
                <span>{isState ? entry.state.label : fr.status[entry.status]}</span>
                {checked && (
                  <span className="status-menu-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
