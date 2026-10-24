import { FOLLOW_RANGE_TILES, TILE_SIZE, refusesGameInvites, type JoinAck } from '@bureau/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { sendDeskCommand } from '../net/desk-commands';
import { sendJoin } from '../net/join-commands';
import { emitOnBus } from '../net/office-connection';
import type { OfficeSocket } from '../net/socket';
import { selectDeskOf, useOfficeStore } from '../state/office-store';
import { deskErrorText } from './desks';
import { DoorOpenIcon, FollowIcon, JoinIcon, ProfileIcon, StopFollowIcon } from './icons';
import { useToasts } from './Toasts';
import { useFeetRef, useInMyDesk } from './use-here';
import { deskKeyAt } from './where';

// L'écart gardé entre le menu et les bords de la page, en pixels.
const EDGE = 8;

// Une ligne du menu.
interface Entry {
  key: string;
  label: string;
  icon: ReactNode;
  // Ce qui s'écrit à droite : pourquoi la ligne est inactive.
  hint?: string;
  disabled?: boolean;
  run(): void;
}

// Ce que dit « Rejoindre » qui n'a pas abouti.
function joinErrorText(ack: JoinAck): string {
  if (ack.ok) return '';
  const errors: Record<string, string> = fr.person.joinErrors;
  return errors[ack.error] ?? fr.person.joinErrors.generic;
}

// Où poser le menu, en coordonnées de la page : sous le point du clic et à sa droite, ramené dans la page (au-dessus du point, ou à sa gauche, s'il n'y tient pas).
export function placeAtPoint(point: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  const left = point.x + size.width + EDGE <= viewport.width ? point.x : Math.max(EDGE, point.x - size.width);
  const top = point.y + size.height + EDGE <= viewport.height ? point.y : Math.max(EDGE, point.y - size.height);
  return { left, top };
}

// Le menu d'une personne : un clic droit sur son avatar (le jeu) ou sur sa ligne du panneau Personnes l'ouvre là où l'on a cliqué (le magasin : `personMenu`), à la
// place de celui du navigateur. Ses lignes :
// - Profil : ses caractéristiques (les siennes : l'onglet Caractéristiques du panneau Missions) ;
// - Suivre, quand on est à moins de FOLLOW_RANGE_TILES cases d'elle (l'avatar marche derrière elle et s'arrête à une case : le jeu, Follow), ou Rejoindre, plus loin
//   (le serveur pose l'avatar à côté d'elle, `person:join`) ; Arrêter de suivre quand on la suit déjà ;
// - Inviter dans le bureau, quand on est dans le sien et qu'elle n'y est pas : elle voit l'invitation, et arrive dans la pièce si elle l'accepte, porte fermée
//   comprise. Qui ne veut pas être dérangé (Ne pas déranger, un mode qui ferme sa porte ou la conduit ailleurs) n'est pas invité : la ligne le dit, inactive.
// Pour soi, ou pour une personne hors ligne : Profil seulement. La distance est prise à l'ouverture (ses pieds et la dernière position connue de la personne).
// Le motif « menu » : le focus va à la première ligne, ↓ ↑ Début Fin passent de l'une à l'autre, Entrée ou Espace choisit ; Échap ferme et rend le focus à ce qui
// l'a ouvert (une ligne du panneau), un clic ailleurs ferme.
export function PersonMenu({ socket }: { socket: OfficeSocket | null }) {
  const menu = useOfficeStore((state) => state.personMenu);
  const selfId = useOfficeStore((state) => state.selfId);
  const following = useOfficeStore((state) => state.following);
  const person = useOfficeStore((state) => (menu === null ? undefined : state.self?.id === menu.userId ? state.self : state.players[menu.userId]));
  const myDesk = useOfficeStore((state) => selectDeskOf(state, state.selfId)?.key ?? null);
  const officeMap = useOfficeStore((state) => state.officeMap);
  const inMyDesk = useInMyDesk();
  const feet = useFeetRef();
  const element = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const [placed, setPlaced] = useState<CSSProperties | null>(null);

  const name = person?.name ?? menu?.name ?? '';
  const online = person !== undefined;
  const mine = menu !== null && menu.userId === selfId;

  // À l'ouverture : la distance jusqu'à elle, en cases (null : on ne la sait pas), et si elle est déjà dans son bureau.
  const where = useMemo(() => {
    if (menu === null || !online || mine) return null;
    const at = useOfficeStore.getState().positions.get(menu.userId) ?? person;
    const me = feet.current;
    return {
      tiles: me ? Math.hypot(at.x - me.x, at.y - me.y) / TILE_SIZE : null,
      inMyDesk: myDesk !== null && deskKeyAt(officeMap, at.x, at.y) === myDesk,
    };
    // La position se lit à l'ouverture seulement : le menu ne change pas de ligne pendant qu'on le regarde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  const close = (restoreFocus: boolean) => {
    const opener = menu?.opener;
    useOfficeStore.getState().openPersonMenu(null);
    if (restoreFocus) opener?.focus();
  };
  const say = (icon: ReactNode, text: string) => useToasts.getState().push({ key: 'person-menu', icon, text });

  const entries: Entry[] = [];
  if (menu !== null) {
    const userId = menu.userId;
    entries.push({
      key: 'profile',
      label: fr.person.profile,
      icon: <ProfileIcon />,
      run: () => useOfficeStore.getState().requestPanel(mine ? { panel: 'missions', tab: 'sheet' } : { panel: 'sheet', userId }),
    });
    if (online && !mine) {
      if (following === userId) {
        entries.push({ key: 'unfollow', label: fr.person.unfollow, icon: <StopFollowIcon />, run: () => emitOnBus(EventBus, 'local:follow', { id: null }) });
      } else if (where !== null && where.tiles !== null && where.tiles < FOLLOW_RANGE_TILES) {
        entries.push({ key: 'follow', label: fr.person.follow, icon: <FollowIcon />, run: () => emitOnBus(EventBus, 'local:follow', { id: userId }) });
      } else {
        entries.push({
          key: 'join',
          label: fr.person.join,
          icon: <JoinIcon />,
          run: () => {
            void sendJoin(socket, userId).then((ack) => {
              if (!ack.ok) say(<JoinIcon />, joinErrorText(ack));
            });
          },
        });
      }
      if (inMyDesk && !where?.inMyDesk) {
        const refused = refusesGameInvites(person);
        entries.push({
          key: 'invite',
          label: fr.person.invite,
          icon: <DoorOpenIcon />,
          disabled: refused,
          hint: refused ? (person.activity?.label ?? fr.person.inviteRefused) : undefined,
          run: () => {
            void sendDeskCommand(socket, { type: 'invite', userId }).then((ack) => say(<DoorOpenIcon />, ack.ok ? t(fr.person.inviteSent, { name }) : deskErrorText(ack)));
          },
        });
      }
    }
  }

  // Posé au point du clic, puis ramené dans la page une fois mesuré.
  useLayoutEffect(() => {
    if (menu === null) {
      setPlaced(null);
      return;
    }
    const box = element.current;
    const { clientWidth, clientHeight } = document.documentElement;
    const size = box ? { width: box.offsetWidth, height: box.offsetHeight } : { width: 0, height: 0 };
    setPlaced(placeAtPoint(menu, size, { width: clientWidth, height: clientHeight }));
  }, [menu]);

  // À l'ouverture, le focus va à la première ligne qu'on peut choisir.
  useEffect(() => {
    if (menu !== null) items.current.find((item) => item !== null && !item.disabled)?.focus();
  }, [menu]);

  // Un clic ailleurs (le jeu, un autre panneau, un autre clic droit), Échap, ou la fenêtre qui change de taille ou perd la main : le menu se ferme.
  useEffect(() => {
    if (menu === null) return;
    const onPointer = (event: PointerEvent) => {
      if (!element.current?.contains(event.target as Node)) useOfficeStore.getState().openPersonMenu(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      useOfficeStore.getState().openPersonMenu(null);
      menu.opener?.focus();
    };
    const dismiss = () => useOfficeStore.getState().openPersonMenu(null);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [menu]);

  if (menu === null) return null;

  const enabled = () => items.current.filter((item): item is HTMLButtonElement => item !== null && !item.disabled);
  function focusAt(offset: number | 'first' | 'last') {
    const lines = enabled();
    if (lines.length === 0) return;
    const index = lines.findIndex((line) => line === document.activeElement);
    const next = offset === 'first' ? 0 : offset === 'last' ? lines.length - 1 : (index + offset + lines.length) % lines.length;
    lines[next]?.focus();
  }
  // Les touches du menu ; celles qu'il prend ne vont pas plus loin (le clavier de l'avatar ignore une touche déjà traitée).
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowDown':
        focusAt(1);
        break;
      case 'ArrowUp':
        focusAt(-1);
        break;
      case 'Home':
        focusAt('first');
        break;
      case 'End':
        focusAt('last');
        break;
      case 'Tab':
        close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={element}
      role="menu"
      aria-label={t(fr.person.menu, { name })}
      className="popover person-menu"
      data-placement="bottom-start"
      style={placed ?? { left: menu.x, top: menu.y, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="person-menu-name" aria-hidden="true">
        {name}
      </p>
      <div className="menu-list">
        {entries.map((entry, index) => (
          <button
            key={entry.key}
            ref={(button) => {
              items.current[index] = button;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="menu-item"
            disabled={entry.disabled}
            onClick={() => {
              close(entry.key !== 'profile');
              entry.run();
            }}
          >
            {entry.icon}
            <span>{entry.label}</span>
            {entry.hint && <span className="menu-hint">{entry.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
