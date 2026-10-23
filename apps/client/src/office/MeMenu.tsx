import type { ActivityState, Status } from '@bureau/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { fr } from '../i18n/fr';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { LogOutIcon, ShirtIcon } from './icons';
import { ModeEditor } from './ModeEditor';
import { ModeList } from './ModeList';
import type { PanelControls, PanelId } from './panels';
import { AvatarPortrait } from './ui/AvatarPortrait';
import { Popover } from './ui/Popover';

// Les lignes qu'on choisit dans le menu : les statuts, les modes, leurs crayons, et les autres lignes.
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
  // Comment ouvrir un panneau (l'apparence) : le focus reviendra à la puce quand il se fermera.
  panels: PanelControls;
  onSignOut(): void;
  signingOut: boolean;
}

// Le menu « Moi » (spec §10 pour le statut), qui s'ouvre au-dessus de la puce :
// - en haut, ton portrait, ton nom, ton e-mail et « Changer d'apparence » (le panneau du personnage) ;
// - « Mode » : une seule liste (ModeList), les quatre statuts d'abord (Disponible, l'état normal, puis Occupé, Absent, Ne pas déranger), puis tes modes (Manger,
//   Sport, Concentration, que ton compte a reçus, et ceux que tu as créés), et « Nouveau mode ». Une seule ligne est cochée ; ce que le serveur confirme
//   (`status:changed`, `activity:changed`) est ce que la puce et le menu affichent. Le crayon d'un mode, et « Nouveau mode », ouvrent son éditeur (ModeEditor)
//   dans le menu même, à la place de la liste : le menu devient alors une petite fenêtre (dialog), et la liste revient quand l'éditeur se ferme ;
// - Se déconnecter. Il n'y a pas de « Compte » : l'e-mail, en haut, et la déconnexion en tiennent lieu. Le bureau et le son sont dans le dock du
//   milieu (MediaDock) : ce menu ne parle que de toi.
//
// La liste suit le motif « menu » : le focus va, à l'ouverture, à ce qui est choisi ; ↓ → et ↑ ← passent d'une ligne à l'autre (le crayon d'un mode en est
// une), Début et Fin vont aux extrémités, Entrée ou Espace choisit, Échap ferme et rend le focus à la puce, Tab aussi (la touche continue depuis la puce).
// Celles que le menu prend ne vont pas plus loin : le clavier de l'avatar (game/input.ts) ignore une touche déjà traitée, et ↓ ↑ dans le menu ne font pas
// marcher l'avatar.
//
// Un mode passe avant le statut : pris, il est coché seul. Le prendre retient le choix de cet onglet (chosenActivityId) et oublie le statut choisi ; un statut,
// au contraire, prend la place du mode, même quand c'est le même statut (le serveur efface le mode) : Disponible, le premier, est ainsi « aucun mode ». Ces
// choix sont aussi retenus au magasin : la connexion les redit à un serveur redémarré, qui les a oubliés.
//
// Rien ne part au serveur tant qu'il ne prendrait pas le message (pas de socket, pas encore d'`init`, connexion coupée, ou revenue mais pas
// encore replacée par son `init`) : les statuts, les modes et l'apparence sont alors inactifs. La déconnexion, elle, ne dépend pas du serveur : on doit
// pouvoir se déconnecter sans lui.
export function MeMenu({ open, onClose, anchorRef, id, name, email, socket, panels, onSignOut, signingOut }: MeMenuProps) {
  const avatarKey = useOfficeStore((state) => state.self?.avatarKey ?? null);
  const current = useOfficeStore((state) => state.self?.status ?? null);
  const activity = useOfficeStore((state) => state.self?.activity ?? null);
  const myStates = useOfficeStore((state) => state.myStates);
  const map = useOfficeStore((state) => state.officeMap);
  const ready = useOfficeStore((state) => state.ready);
  const enabled = socket !== null && ready && current !== null;

  const list = useRef<HTMLDivElement>(null);
  const modeLabelId = useId();
  // L'éditeur ouvert à la place de la liste : pour ce mode, ou pour un nouveau (null) ; undefined : la liste.
  const [editing, setEditing] = useState<ActivityState | null | undefined>(undefined);
  // La ligne qui reprend le focus quand la liste revient : le mode (son identifiant), ou « Nouveau mode » (null).
  const refocus = useRef<string | null | undefined>(undefined);

  // Les lignes qu'on peut choisir, dans l'ordre de la page : celles qui ne sont pas inactives.
  const lines = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? []).filter((line) => !line.disabled);

  // À l'ouverture, le focus va à ce qui est choisi (le statut en cours, ou le mode : un seul des deux l'est), sinon à la première ligne qu'on peut choisir.
  // Le menu fermé oublie l'éditeur : il rouvre sur la liste.
  useEffect(() => {
    if (!open) {
      setEditing(undefined);
      return;
    }
    const all = lines();
    (all.find((line) => line.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
    // Seulement à l'ouverture (`open`) : un statut qui change menu ouvert ne déplace pas le focus.
  }, [open]);

  // L'éditeur se ferme : la liste revient, et le focus va au mode qu'on vient de créer ou de modifier (sinon à « Nouveau mode »).
  useEffect(() => {
    if (!open || editing !== undefined || refocus.current === undefined) return;
    const id = refocus.current;
    refocus.current = undefined;
    const line = id === null ? null : list.current?.querySelector<HTMLButtonElement>(`[data-mode="${CSS.escape(id)}"] .mode-pick`);
    (line ?? list.current?.querySelector<HTMLButtonElement>('.mode-new'))?.focus();
  }, [open, editing]);

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

  // Un mode : le prendre (le serveur le confirme, et conduit l'avatar là où le mode mène).
  function chooseMode(state: ActivityState) {
    finish();
    const store = useOfficeStore.getState();
    store.setChosenActivity(state.id);
    store.setChosenStatus(null);
    if (activity?.id !== state.id) socket?.emit('state:set', state.id);
  }

  function closeEditor(focusId: string | null) {
    refocus.current = focusId;
    setEditing(undefined);
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

  if (editing !== undefined) {
    return (
      <Popover open={open} onClose={onClose} anchorRef={anchorRef} placement="top-start" label={editing === null ? fr.modes.titleCreate : fr.modes.titleEdit} role="dialog" id={id}>
        <div className="me-menu">
          <ModeEditor state={editing} map={map} onClose={closeEditor} />
        </div>
      </Popover>
    );
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

        <div role="group" aria-labelledby={modeLabelId}>
          <div className="me-label">
            <span id={modeLabelId}>{fr.me.mode}</span>
          </div>
          <ModeList
            status={current}
            activity={activity}
            myStates={myStates}
            map={map}
            enabled={enabled}
            onStatus={chooseStatus}
            onMode={chooseMode}
            onEdit={(state) => setEditing(state)}
            onCreate={() => setEditing(null)}
          />
        </div>

        <div className="menu-rule" role="separator" />
        <button type="button" role="menuitem" tabIndex={-1} className="menu-item" disabled={signingOut} onClick={signOut}>
          <LogOutIcon />
          <span>{signingOut ? fr.office.signingOut : fr.office.signOut}</span>
        </button>
      </div>
    </Popover>
  );
}
