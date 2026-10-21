import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { zoomPercent } from '../game/zoom';
import { fr, t } from '../i18n/fr';
import { selectDeskOf, useOfficeStore } from '../state/office-store';
import { ChatIcon, DecorIcon, FlaskIcon, MoreIcon, ShieldIcon, UsersIcon, ZoomResetIcon } from './icons';
import type { PanelControls } from './panels';
import { IconButton } from './ui/IconButton';
import { Popover } from './ui/Popover';

// Le plus grand nombre écrit sur la pastille du chat.
const BADGE_MAX = 99;

// Une ligne du menu « Plus ». `run` reçoit le bouton « Plus » : c'est lui qui reprend le focus quand le panneau qu'elle ouvre se ferme.
interface MoreEntry {
  key: string;
  label: string;
  icon: ReactNode;
  // Ce qui s'écrit à droite (le niveau du zoom).
  hint?: string;
  // Son nom pour un lecteur d'écran, quand il n'est pas son texte.
  name?: string;
  disabled?: boolean;
  // Elle ouvre un panneau, qui prend le focus ; les autres le rendent au bouton « Plus ».
  panel?: boolean;
  run(opener: HTMLElement | null): void;
}

// Le dock de droite : le chat (avec la pastille de ses messages non lus), les personnes (avec le compte de celles en ligne), et le menu
// « Plus » : la déco du bureau, l'Admin (pour un admin), le Bac à sable (du faux live), et la vue de départ du zoom.
// Le menu suit le motif « menu button » : il s'ouvre au-dessus du bouton, le focus va à la première ligne ; ↓ ↑ Début Fin passent de l'une à
// l'autre, Entrée ou Espace choisit, Échap ferme et rend le focus au bouton.
export function SocialDock({ panels }: { panels: PanelControls }) {
  const online = useOfficeStore((state) => (state.self === null ? 0 : 1) + Object.keys(state.players).length);
  const level = useOfficeStore((state) => state.zoomLevel);
  const resetZoom = useOfficeStore((state) => state.resetZoom);
  const desks = useOfficeStore((state) => state.desks);
  const selfId = useOfficeStore((state) => state.selfId);
  const hasDesk = useMemo(() => Boolean(selectDeskOf({ desks }, selfId)), [desks, selfId]);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const more = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);

  // Ouvert, le chat n'a rien de non lu à signaler : le panneau montre tout.
  const unread = panels.open === 'chat' ? 0 : panels.unread;
  const chatLabel = unread > 0 ? `${fr.chat.toggle}, ${t(unread === 1 ? fr.chat.unreadOne : fr.chat.unreadMany, { count: unread })}` : fr.chat.toggle;

  const own: MoreEntry[] = [
    { key: 'decor', label: fr.decor.toggle, icon: <DecorIcon />, disabled: !panels.ready || !hasDesk, panel: true, run: (opener) => panels.show('decor', opener) },
    ...(panels.admin ? [{ key: 'admin', label: fr.admin.toggle, icon: <ShieldIcon />, panel: true, run: (opener: HTMLElement | null) => panels.show('admin', opener) }] : []),
    ...(panels.sim ? [{ key: 'sim', label: fr.sim.toggle, icon: <FlaskIcon />, panel: true, run: (opener: HTMLElement | null) => panels.show('sim', opener) }] : []),
    { key: 'zoom', label: fr.zoom.reset, name: fr.zoom.reset, hint: t(fr.zoom.level, { percent: zoomPercent(level) }), icon: <ZoomResetIcon />, run: () => resetZoom() },
  ];

  // Les lignes qu'on peut choisir : celles qui ne sont pas inactives.
  const enabled = () => items.current.filter((item): item is HTMLButtonElement => item !== null && !item.disabled);

  // À l'ouverture, le focus va à la première ligne.
  useEffect(() => {
    if (menuOpen) enabled()[0]?.focus();
  }, [menuOpen]);

  function choose(entry: MoreEntry) {
    setMenuOpen(false);
    if (!entry.panel) more.current?.focus();
    entry.run(more.current);
  }

  function focusAt(offset: number | 'first' | 'last') {
    const lines = enabled();
    if (lines.length === 0) return;
    const index = lines.findIndex((line) => line === document.activeElement);
    const next = offset === 'first' ? 0 : offset === 'last' ? lines.length - 1 : (index + offset + lines.length) % lines.length;
    lines[next]?.focus();
  }

  // Les touches du menu. Celles qu'il prend ne vont pas plus loin : le clavier de l'avatar ignore une touche déjà traitée.
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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
        // Le focus revient au bouton, d'où la touche continue : l'élément suivant (ou précédent avec Maj) du bouton, et non du menu qui disparaît.
        setMenuOpen(false);
        more.current?.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  const chatOpen = panels.open === 'chat';
  const peopleOpen = panels.open === 'people';
  return (
    <div className="dock dock-social">
      <IconButton
        label={chatLabel}
        badge={unread > 0 ? (unread > BADGE_MAX ? `${BADGE_MAX}+` : unread) : undefined}
        aria-expanded={chatOpen}
        aria-controls={chatOpen ? panels.idOf('chat') : undefined}
        disabled={!panels.ready}
        onClick={(event) => panels.toggle('chat', event.currentTarget)}
      >
        <ChatIcon />
      </IconButton>
      <IconButton
        label={fr.office.people.toggle}
        count={online > 0 ? online : undefined}
        aria-expanded={peopleOpen}
        aria-controls={peopleOpen ? panels.idOf('people') : undefined}
        disabled={!panels.ready}
        onClick={(event) => panels.toggle('people', event.currentTarget)}
      >
        <UsersIcon />
      </IconButton>
      <IconButton
        ref={more}
        label={fr.office.more.toggle}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen((wasOpen) => !wasOpen)}
      >
        <MoreIcon />
      </IconButton>
      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={more} placement="top-end" label={fr.office.more.menu} role="menu" id={menuId}>
        <div className="menu-list" onKeyDown={onMenuKeyDown}>
          {own.map((entry, index) => (
            <button
              key={entry.key}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="menu-item"
              aria-label={entry.name}
              disabled={entry.disabled}
              onClick={() => choose(entry)}
            >
              {entry.icon}
              <span>{entry.label}</span>
              {entry.hint && <span className="menu-hint">{entry.hint}</span>}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
