import type { DeskInfo, PublicPlayer } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_ZOOM_LEVEL } from '../game/zoom';
import { fr } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import type { PanelControls } from './panels';
import { SocialDock } from './SocialDock';

const player = (id: string, name: string): PublicPlayer => ({
  id,
  name,
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
});

const desk = (ownerId: string | null): DeskInfo => ({ key: 'A1', ownerId, ownerName: ownerId ? 'Léa' : null, name: null, locked: false, closedByState: false, floor: 'gris', wall: 'bleu', items: [] }) as unknown as DeskInfo;

beforeEach(() => {
  useOfficeStore.getState().reset();
  act(() =>
    useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [], mapKey: 'dev-office', chatHistory: [], desks: [desk('moi')], closedDesks: [], deskBans: [] }),
  );
});

function fakePanels(over: Partial<PanelControls> = {}): PanelControls {
  return { open: null, toggle: vi.fn(), show: vi.fn(), idOf: (id) => `panneau-${id}`, ready: true, unread: 0, admin: false, sim: false, ...over };
}

function renderDock(over: Partial<PanelControls> = {}) {
  const panels = fakePanels(over);
  const view = render(
    <>
      <SocialDock panels={panels} />
      <p>Ailleurs</p>
    </>,
  );
  return { panels, ...view };
}

const more = () => screen.getByRole('button', { name: fr.office.more.toggle });
const menu = () => screen.getByRole('menu', { name: fr.office.more.menu });
const entry = (name: string) => screen.getByRole('menuitem', { name }) as HTMLButtonElement;
const entryNames = () => screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label') ?? item.textContent);

describe('le menu « Plus »', () => {
  test('fermé au départ ; le bouton l\'ouvre et le ferme, et le dit (aria-haspopup, aria-expanded, aria-controls)', async () => {
    const user = userEvent.setup();
    renderDock();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more().getAttribute('aria-haspopup')).toBe('menu');
    expect(more().getAttribute('aria-expanded')).toBe('false');
    expect(more().hasAttribute('aria-controls')).toBe(false);

    await user.click(more());
    expect(more().getAttribute('aria-expanded')).toBe('true');
    expect(more().getAttribute('aria-controls')).toBe(menu().id);

    await user.click(more());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more().getAttribute('aria-expanded')).toBe('false');
  });

  test('un membre y trouve la déco et le zoom ; un admin y ajoute Admin ; le faux live, le Bac à sable', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDock();
    await user.click(more());
    expect(entryNames()).toEqual([fr.decor.toggle, fr.zoom.reset]);
    unmount();

    const admin = renderDock({ admin: true });
    await user.click(more());
    expect(entryNames()).toEqual([fr.decor.toggle, fr.admin.toggle, fr.zoom.reset]);
    admin.unmount();

    renderDock({ admin: true, sim: true });
    await user.click(more());
    expect(entryNames()).toEqual([fr.decor.toggle, fr.admin.toggle, fr.sim.toggle, fr.zoom.reset]);
  });

  test('un choix de panneau le demande à la coque, depuis le bouton « Plus », et ferme le menu', async () => {
    const user = userEvent.setup();
    const { panels } = renderDock({ admin: true });
    await user.click(more());
    await user.click(entry(fr.admin.toggle));
    expect(panels.show).toHaveBeenCalledExactlyOnceWith('admin', more());
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(more());
    await user.click(entry(fr.decor.toggle));
    expect(panels.show).toHaveBeenLastCalledWith('decor', more());
  });

  test('le focus va à la première ligne à l\'ouverture ; ↓ ↑ Début Fin passent de l\'une à l\'autre en tournant', async () => {
    const user = userEvent.setup();
    renderDock({ admin: true });
    await user.click(more());
    expect(document.activeElement).toBe(entry(fr.decor.toggle));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(entry(fr.admin.toggle));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(entry(fr.zoom.reset));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(entry(fr.decor.toggle));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(entry(fr.zoom.reset));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(entry(fr.decor.toggle));
  });

  test('Échap ferme et rend le focus au bouton ; Tab aussi, d\'où la touche continue ; un clic ailleurs ferme', async () => {
    const user = userEvent.setup();
    renderDock();
    await user.click(more());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more());

    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(more());
    await user.click(screen.getByText('Ailleurs'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('« Rétablir le zoom (100 %) » : son nom ne change pas, il dit le niveau du moment à droite, et rend le zoom de départ', async () => {
    const user = userEvent.setup();
    renderDock();
    act(() => {
      useOfficeStore.getState().stepZoom(-1);
      useOfficeStore.getState().stepZoom(-1);
    });
    await user.click(more());
    expect(entry(fr.zoom.reset).textContent).toContain('25 %');
    await user.click(entry(fr.zoom.reset));
    expect(useOfficeStore.getState().zoomLevel).toBe(DEFAULT_ZOOM_LEVEL);
    // Rien n'ouvre de panneau : le focus revient au bouton.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  test('Décorer a besoin d\'un bureau, et du serveur', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDock({ ready: false });
    await user.click(more());
    expect(entry(fr.decor.toggle).disabled).toBe(true);
    unmount();

    act(() =>
      useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [], mapKey: 'dev-office', chatHistory: [], desks: [desk(null)], closedDesks: [], deskBans: [] }),
    );
    renderDock();
    await user.click(screen.getAllByRole('button', { name: fr.office.more.toggle })[0]!);
    expect(entry(fr.decor.toggle).disabled).toBe(true);
  });
});
