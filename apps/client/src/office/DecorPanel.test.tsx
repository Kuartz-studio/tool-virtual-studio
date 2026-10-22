import { DECOR_CATEGORIES, DEFAULT_DESK_DECOR, decorItem, decorItemsOf, type DeskAck, type DeskInfo, type PublicPlayer } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { DecorPanel } from './DecorPanel';

const me: PublicPlayer = {
  id: 'moi',
  name: 'Léa',
  avatarKey: null,
  x: 80,
  y: 400,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
};
const desk = (key: string, ownerId: string | null): DeskInfo => ({
  key,
  ownerId,
  ownerName: ownerId === null ? null : 'Léa',
  name: null,
  locked: false,
  closedByState: false,
  floor: DEFAULT_DESK_DECOR.floor,
  wall: DEFAULT_DESK_DECOR.wall,
  items: [],
});

function setup(desks: DeskInfo[] = [desk('A2', 'moi')]) {
  const socket = new FakeSocket();
  socket.connected = true;
  act(() => {
    useOfficeStore.getState().applyInit({ self: me, players: [], mapKey: 'office', chatHistory: [], desks, closedDesks: [], deskBans: [] });
  });
  let closed = 0;
  const view = render(<DecorPanel socket={socket.asSocket()} onClose={() => closed++} />);
  return { socket, view, closed: () => closed };
}

async function ack(socket: FakeSocket, response: DeskAck = { ok: true }) {
  await act(async () => socket.serverAcks('desk:do', response));
}

beforeEach(() => {
  useOfficeStore.getState().reset();
});

describe('sans bureau', () => {
  test('on dit de prendre un bureau d\'abord ; aucun éditeur ne s\'ouvre', () => {
    setup([desk('A2', null)]);
    expect(screen.getByText(fr.decor.noDesk)).toBeTruthy();
    expect(useOfficeStore.getState().decorEditor).toBeNull();
  });
});

describe('une déco enregistrée qui ne tient plus dans la pièce (la carte a changé)', () => {
  // Le serveur montre alors le poste par défaut et garde la déco en base ; enregistrer la remplacerait pour de bon : le panneau prévient avant.
  test('le panneau le dit, et dit que le poste par défaut est montré', () => {
    setup([{ ...desk('A2', 'moi'), decorUnfit: true }]);
    expect(screen.getByText(fr.decor.unfit)).toBeTruthy();
  });

  test('une déco qui tient, ou la déco des autres : aucun avertissement', () => {
    setup([desk('A2', 'moi'), { ...desk('A3', 'autre'), decorUnfit: true }]);
    expect(screen.queryByText(fr.decor.unfit)).toBeNull();
  });
});

describe('avec un bureau', () => {
  test('ouvrir le panneau ouvre l\'éditeur sur son bureau, le fermer le ferme', () => {
    const { view } = setup();
    expect(useOfficeStore.getState().decorEditor?.deskKey).toBe('A2');
    view.unmount();
    expect(useOfficeStore.getState().decorEditor).toBeNull();
  });

  test('la banque a une catégorie par bouton, le poste de travail d\'abord, et montre les éléments de celle qu\'on choisit', async () => {
    const user = userEvent.setup();
    setup();
    const categories = within(screen.getByRole('group', { name: fr.decor.categories })).getAllByRole('button');
    expect(categories.map((b) => b.textContent)).toEqual(DECOR_CATEGORIES.map((c) => c.label));
    expect(categories[0]!.textContent).toBe('Écrans & informatique');
    expect(categories.length).toBeLessThanOrEqual(10);
    const grid = () => screen.getByRole('group', { name: /^Éléments :/ });
    expect(within(grid()).getAllByRole('button')).toHaveLength(decorItemsOf('ecrans').length);
    await user.click(screen.getByRole('button', { name: 'Plantes' }));
    expect(within(grid()).getAllByRole('button')).toHaveLength(decorItemsOf('plantes').length);
  });

  test('cliquer un élément le prend en main (une fois de plus : le lâche) ; le panneau le dit', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Écran bleu (face)' }));
    expect(useOfficeStore.getState().decorEditor!.held).toBe('of-14-12');
    expect(screen.getByRole('status').textContent).toContain(t(fr.decor.held, { name: 'Écran bleu (face)' }));
    await user.click(screen.getByRole('button', { name: 'Écran bleu (face)' }));
    expect(useOfficeStore.getState().decorEditor!.held).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(fr.decor.help);
  });

  test('une recherche porte sur toute la banque', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText(fr.decor.searchLabel), 'canapé');
    const names = within(screen.getByRole('group', { name: /^Éléments :/ })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThan(3);
    expect(names.every((name) => name!.toLowerCase().includes('canapé'))).toBe(true);
    await user.clear(screen.getByLabelText(fr.decor.searchLabel));
    await user.type(screen.getByLabelText(fr.decor.searchLabel), 'zzzz');
    expect(screen.getByText(fr.decor.empty)).toBeTruthy();
  });

  test('Murs et sol : choisir un thème change le brouillon', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: fr.decor.tabs.themes }));
    await user.click(screen.getByRole('button', { name: 'Noyer' }));
    await user.click(screen.getByRole('button', { name: 'Rouge' }));
    expect(useOfficeStore.getState().decorEditor!.draft).toMatchObject({ floor: 'noyer', wall: 'rouge' });
    expect(screen.getByRole('button', { name: 'Noyer' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('Enregistrer envoie toute la déco d\'un bloc (decor) et n\'est actif que s\'il y a des changements', async () => {
    const user = userEvent.setup();
    const { socket } = setup();
    const save = screen.getByRole('button', { name: fr.decor.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(screen.getByRole('tab', { name: fr.decor.tabs.themes }));
    await user.click(screen.getByRole('button', { name: 'Noyer' }));
    expect(screen.getByText(fr.decor.unsaved)).toBeTruthy();
    await user.click(save);
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'decor', floor: 'noyer', wall: DEFAULT_DESK_DECOR.wall, items: [] }]);
    await ack(socket);
    expect(screen.getByText(fr.decor.saved)).toBeTruthy();
    expect(useOfficeStore.getState().decorEditor!.saved.floor).toBe('noyer');
    expect((screen.getByRole('button', { name: fr.decor.save }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('le serveur refuse : la raison s\'affiche, le brouillon reste', async () => {
    const user = userEvent.setup();
    const { socket } = setup();
    await user.click(screen.getByRole('tab', { name: fr.decor.tabs.themes }));
    await user.click(screen.getByRole('button', { name: 'Noyer' }));
    await user.click(screen.getByRole('button', { name: fr.decor.save }));
    await ack(socket, { ok: false, error: 'bad_decor', reason: 'unreachable' });
    expect(screen.getByRole('alert').textContent).toBe(fr.decor.errors.unreachable);
    expect(useOfficeStore.getState().decorEditor!.draft.floor).toBe('noyer');
  });

  test('« Poste par défaut » et « Tout vider » remplacent le brouillon', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: fr.decor.reset }));
    expect(useOfficeStore.getState().decorEditor!.draft.items).toHaveLength(DEFAULT_DESK_DECOR.items.length);
    await user.click(screen.getByRole('button', { name: fr.decor.clear }));
    expect(useOfficeStore.getState().decorEditor!.draft.items).toEqual([]);
    expect(screen.getByText(t(fr.decor.count, { count: 0, max: 80 }))).toBeTruthy();
  });

  test('Échap lâche l\'élément tenu, puis ferme le panneau', async () => {
    const user = userEvent.setup();
    const { closed } = setup();
    await user.click(screen.getByRole('button', { name: 'Écran bleu (face)' }));
    await user.keyboard('{Escape}');
    expect(useOfficeStore.getState().decorEditor!.held).toBeNull();
    expect(closed()).toBe(0);
    await user.keyboard('{Escape}');
    expect(closed()).toBe(1);
  });

  test('la gomme : un bouton enfoncé qui vide la main ; prendre un élément reprend la pose ; Échap quitte la gomme avant de fermer', async () => {
    const user = userEvent.setup();
    const { closed } = setup();
    await user.click(screen.getByRole('button', { name: 'Écran bleu (face)' }));
    const eraser = screen.getByRole('button', { name: fr.decor.erase });
    expect(eraser.getAttribute('aria-pressed')).toBe('false');

    await user.click(eraser);
    expect(eraser.getAttribute('aria-pressed')).toBe('true');
    expect(useOfficeStore.getState().decorEditor).toMatchObject({ tool: 'erase', held: null });
    expect(screen.getByRole('status').textContent).toBe(fr.decor.eraseHelp);

    // Prendre un élément reprend la pose.
    await user.click(screen.getByRole('button', { name: 'Écran bleu (face)' }));
    expect(eraser.getAttribute('aria-pressed')).toBe('false');

    await user.click(eraser);
    await user.keyboard('{Escape}');
    expect(useOfficeStore.getState().decorEditor!.tool).toBe('place');
    expect(closed()).toBe(0);
    await user.keyboard('{Escape}');
    expect(closed()).toBe(1);
  });

  describe('remplacer un élément posé', () => {
    // Le bureau a déjà un meuble à (3, 2) ; on tient une plante et on la pose dessus : la confirmation s'ouvre.
    function askToReplace() {
      act(() => {
        const store = useOfficeStore.getState();
        store.openDecorEditor({ ...desk('A2', 'moi'), items: [{ id: 'of-7-28', x: 3, y: 2 }] });
        store.holdDecorItem('of-6-10');
        store.placeHeld({ x: 4, y: 3 });
      });
    }

    test('la fenêtre demande « voulez-vous vraiment le remplacer ? » avec l\'élément qui part et celui qui arrive, sans rien changer encore', () => {
      setup();
      askToReplace();
      const dialog = screen.getByRole('alertdialog', { name: fr.decor.replace.titleOne });
      expect(within(dialog).getByText(fr.decor.replace.bodyOne, { exact: false })).toBeTruthy();
      expect(dialog.textContent).toContain(t(fr.decor.replace.detail, { old: decorItem('of-7-28')!.name, new: decorItem('of-6-10')!.name }));
      expect(useOfficeStore.getState().decorEditor!.draft.items).toEqual([{ id: 'of-7-28', x: 3, y: 2 }]);
      // Le focus est sur le geste sûr.
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: fr.decor.replace.cancel }));
    });

    test('« Remplacer » remplace, la fenêtre se ferme', async () => {
      const user = userEvent.setup();
      setup();
      askToReplace();
      await user.click(screen.getByRole('button', { name: fr.decor.replace.confirm }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(useOfficeStore.getState().decorEditor!.draft.items).toEqual([{ id: 'of-6-10', x: 4, y: 3 }]);
    });

    test('« Annuler » renonce, et Échap aussi, sans fermer le panneau', async () => {
      const user = userEvent.setup();
      const { closed } = setup();
      askToReplace();
      await user.click(screen.getByRole('button', { name: fr.decor.replace.cancel }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(useOfficeStore.getState().decorEditor!.draft.items).toEqual([{ id: 'of-7-28', x: 3, y: 2 }]);

      act(() => {
        useOfficeStore.getState().placeHeld({ x: 4, y: 3 });
      });
      expect(screen.getByRole('alertdialog')).toBeTruthy();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(closed()).toBe(0);
      expect(useOfficeStore.getState().decorEditor!.draft.items).toEqual([{ id: 'of-7-28', x: 3, y: 2 }]);
    });

    test('Tab boucle entre les deux boutons', async () => {
      const user = userEvent.setup();
      setup();
      askToReplace();
      const cancel = screen.getByRole('button', { name: fr.decor.replace.cancel });
      const confirm = screen.getByRole('button', { name: fr.decor.replace.confirm });
      expect(document.activeElement).toBe(cancel);
      await user.tab();
      expect(document.activeElement).toBe(confirm);
      await user.tab();
      expect(document.activeElement).toBe(cancel);
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(confirm);
    });

    test('plusieurs éléments à remplacer : la fenêtre le dit au pluriel', () => {
      setup();
      act(() => {
        const store = useOfficeStore.getState();
        store.openDecorEditor({ ...desk('A2', 'moi'), items: [{ id: 'of-6-10', x: 2, y: 2 }, { id: 'of-6-10', x: 4, y: 2 }] });
        store.holdDecorItem('of-7-28');
        store.placeHeld({ x: 3, y: 2 });
      });
      expect(screen.getByRole('alertdialog', { name: fr.decor.replace.titleMany })).toBeTruthy();
    });
  });
});
