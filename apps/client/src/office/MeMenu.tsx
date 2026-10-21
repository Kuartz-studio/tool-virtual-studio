import { STATUSES, type ActivityState, type Status } from '@bureau/shared';
import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react';
import { useAudioStore } from '../audio/audio-store';
import { fr } from '../i18n/fr';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { ActivityMark } from './ActivityMark';
import { DeskIcon, LogOutIcon, PlusIcon, ShirtIcon, VolumeIcon } from './icons';
import type { PanelControls, PanelId } from './panels';
import { StatusDot } from './StatusDot';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { Popover } from './ui/Popover';

// Les lignes qu'on choisit dans le menu : les statuts, les modes, et les autres lignes.
const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

export interface MeMenuProps {
  open: boolean;
  onClose(): void;
  // La puce, qui l'ouvre : le menu se pose au-dessus d'elle, et le focus lui revient après un choix.
  anchorRef: RefObject<HTMLButtonElement | null>;
  id: string;
  // Le nom et l'e-mail du compte, en haut du menu.
  name: string;
  email: string;
  // La connexion au bureau, null avant que la page l'ouvre.
  socket: OfficeSocket | null;
  // Comment ouvrir un panneau (l'apparence, le bureau, le son, les modes) : le focus reviendra à la puce quand il se fermera.
  panels: PanelControls;
  onSignOut(): void;
  signingOut: boolean;
}

// Le menu « Moi » (spec §10 pour le statut), qui s'ouvre au-dessus de la puce :
// - en haut, ton portrait, ton nom, ton e-mail et « Changer d'apparence » (le panneau du personnage) ;
// - « Statut » : les quatre statuts, choisis à la main ; ce que le serveur confirme (`status:changed`) est ce que la puce affiche ;
// - « Mode » : les états d'activité que tu as créés (chacun avec son icône, ou le point de sa couleur), « Aucun » (retour au statut), et « + »
//   qui ouvre leur panneau ;
// - Mon bureau, Son et musique, et Se déconnecter. Il n'y a pas de « Compte » : l'e-mail, en haut, et la déconnexion en tiennent lieu.
//
// Le menu suit le motif « menu » : le focus va, à l'ouverture, à ce qui est choisi (le mode en cours, sinon le statut) ; ↓ → et ↑ ← passent d'une
// ligne à l'autre, Début et Fin vont aux extrémités, Entrée ou Espace choisit, Échap ferme et rend le focus à la puce, Tab aussi (la touche
// continue depuis la puce). Celles que le menu prend ne vont pas plus loin : le clavier de l'avatar (game/input.ts) ignore une touche déjà
// traitée, et ↓ ↑ dans le menu ne font pas marcher l'avatar.
//
// Un état d'activité passe avant le statut : pris, il est coché seul, et aucun statut ne l'est. Le prendre retient le choix de cet onglet
// (chosenActivityId) et oublie le statut choisi ; un statut ordinaire, au contraire, prend la place de l'état, même quand c'est le même statut
// (le serveur efface l'état). Ces choix sont aussi retenus au magasin : la connexion les redit à un serveur redémarré, qui les a oubliés.
//
// Rien ne part au serveur tant qu'il ne prendrait pas le message (pas de socket, pas encore d'`init`, connexion coupée, ou revenue mais pas
// encore replacée par son `init`) : les statuts, les modes, l'apparence et le bureau sont alors inactifs. Le son et la déconnexion, eux, ne
// dépendent pas du serveur : on doit pouvoir se déconnecter, et couper le son, sans lui.
export function MeMenu({ open, onClose, anchorRef, id, name, email, socket, panels, onSignOut, signingOut }: MeMenuProps) {
  const avatarKey = useOfficeStore((state) => state.self?.avatarKey ?? null);
  const current = useOfficeStore((state) => state.self?.status ?? null);
  const activity = useOfficeStore((state) => state.self?.activity ?? null);
  const myStates = useOfficeStore((state) => state.myStates);
  const ready = useOfficeStore((state) => state.ready);
  // Le haut-parleur du Son est barré quand ni la musique ni les effets ne sonnent.
  const silent = useAudioStore((state) => !state.prefs.musicOn && !state.prefs.sfxOn);
  const enabled = socket !== null && ready && current !== null;

  const list = useRef<HTMLDivElement>(null);
  const statusLabelId = useId();
  const modeLabelId = useId();

  // Les lignes qu'on peut choisir, dans l'ordre de la page : celles qui ne sont pas inactives.
  const lines = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? []).filter((line) => !line.disabled);

  // À l'ouverture, le focus va à ce qui est choisi (le statut en cours, ou le mode : un seul des deux l'est dans l'ordre de la page), sinon à
  // la première ligne qu'on peut choisir.
  useEffect(() => {
    if (!open) return;
    const all = lines();
    (all.find((line) => line.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
    // Seulement à l'ouverture (`open`) : un statut qui change menu ouvert ne déplace pas le focus.
  }, [open]);

  // La connexion tombe menu ouvert : les lignes qui en dépendent s'éteignent, et le focus, s'il était sur l'une d'elles, passe à une ligne qui
  // marche (la déconnexion ne dépend pas d'elle) : le clavier ne reste pas sur une ligne inactive.
  useEffect(() => {
    if (!open || enabled) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement) || active.disabled || !list.current?.contains(active)) lines()[0]?.focus();
  }, [open, enabled]);

  // Un choix referme le menu, et le focus revient à la puce. Un choix qui ouvre un panneau le lui laisse : le panneau prend le focus, et le rend
  // à la puce en se fermant.
  function finish() {
    onClose();
    anchorRef.current?.focus();
  }

  function chooseStatus(status: Status) {
    finish();
    const store = useOfficeStore.getState();
    store.setChosenStatus(status);
    store.setChosenActivity(null);
    if (status !== current || activity !== null) socket?.emit('status:set', status);
  }

  // Un mode : celui-ci, ou aucun (null), qui rend le statut qu'on avait dessous (le serveur le garde pendant l'état). Le choix de cet onglet
  // n'est plus l'état : si le serveur est redémarré, c'est ce statut-là qu'il faudra lui redire, et que le choix d'un état avait fait oublier.
  function chooseMode(state: ActivityState | null) {
    finish();
    const store = useOfficeStore.getState();
    if (state === null) {
      if (activity === null) return;
      store.setChosenActivity(null);
      store.setChosenStatus(current);
      socket?.emit('state:set', null);
      return;
    }
    store.setChosenActivity(state.id);
    store.setChosenStatus(null);
    if (activity?.id !== state.id) socket?.emit('state:set', state.id);
  }

  function openPanel(panel: PanelId) {
    onClose();
    panels.show(panel, anchorRef.current);
  }

  function signOut() {
    finish();
    onSignOut();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const all = lines();
    const index = all.findIndex((line) => line === document.activeElement);
    const focusAt = (at: number) => all[(at + all.length) % all.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        focusAt(index === -1 ? 0 : index + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        focusAt(index === -1 ? -1 : index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(-1);
        break;
      case 'Tab':
        // Le focus revient à la puce, d'où la touche continue : l'élément suivant (ou précédent avec Maj) de la puce, et non du menu qui
        // disparaît.
        onClose();
        anchorRef.current?.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} placement="top-start" label={fr.me.menu} role="menu" id={id}>
      <div ref={list} className="me-menu" onKeyDown={onMenuKeyDown}>
        <div className="me-head">
          <AvatarPortrait avatarKey={avatarKey} name={name} size={52} />
          <div className="me-id">
            <span className="me-id-name" title={name}>
              {name}
            </span>
            <span className="me-id-mail" title={email}>
              {email}
            </span>
            <button type="button" role="menuitem" tabIndex={-1} className="me-look" disabled={!panels.ready} onClick={() => openPanel('character')}>
              <ShirtIcon />
              <span>{fr.character.toggle}</span>
            </button>
          </div>
        </div>

        <div role="group" aria-labelledby={statusLabelId}>
          <div className="me-label">
            <span id={statusLabelId}>{fr.me.status}</span>
            {activity === null && current !== null && <em>{fr.status[current]}</em>}
          </div>
          <div className="me-statuses">
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                role="menuitemradio"
                aria-checked={activity === null && status === current}
                aria-label={fr.status[status]}
                title={fr.status[status]}
                tabIndex={-1}
                className="status-tile"
                disabled={!enabled}
                onClick={() => chooseStatus(status)}
              >
                <StatusDot status={status} />
              </button>
            ))}
          </div>
        </div>

        <div role="group" aria-labelledby={modeLabelId}>
          <div className="me-label">
            <span id={modeLabelId}>{fr.me.mode}</span>
          </div>
          <div className="mode-chips">
            {myStates.map((state) => (
              <button key={state.id} type="button" role="menuitemradio" aria-checked={activity?.id === state.id} tabIndex={-1} className="mode-chip" disabled={!enabled} onClick={() => chooseMode(state)}>
                <ActivityMark activity={state} />
                <span>{state.label}</span>
              </button>
            ))}
            <button type="button" role="menuitemradio" aria-checked={activity === null} tabIndex={-1} className="mode-chip" disabled={!enabled} onClick={() => chooseMode(null)}>
              <span>{fr.me.modeNone}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label={fr.me.modeManage}
              title={fr.me.modeManage}
              tabIndex={-1}
              className="mode-chip is-add"
              disabled={!enabled}
              onClick={() => openPanel('states')}
            >
              <PlusIcon />
            </button>
          </div>
        </div>

        <div className="menu-rule" role="separator" />
        <button type="button" role="menuitem" tabIndex={-1} className="menu-item" disabled={!panels.ready} onClick={() => openPanel('desk')}>
          <DeskIcon />
          <span>{fr.desk.toggle}</span>
        </button>
        <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => openPanel('sound')}>
          <VolumeIcon off={silent} />
          <span>{fr.sound.toggle}</span>
        </button>
        <div className="menu-rule" role="separator" />
        <button type="button" role="menuitem" tabIndex={-1} className="menu-item" disabled={signingOut} onClick={signOut}>
          <LogOutIcon />
          <span>{signingOut ? fr.office.signingOut : fr.office.signOut}</span>
        </button>
      </div>
    </Popover>
  );
}
