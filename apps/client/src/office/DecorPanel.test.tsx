import { DECOR_CATEGORIES, DEFAULT_DESK_DECOR, SHOP_WALL_THEMES, decorItem, decorItemsOf, type DeskAck, type DeskInfo, type MyProgress, type PublicPlayer } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import * as progressApi from '../lib/progress-api';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { DecorPanel } from './DecorPanel';
import { formatNumber } from './progress-format';

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
  localStorage.clear();
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
    expect(categories.length).toBeLessThanOrEqual(11);
    const grid = () => screen.getByRole('group', { name: /^Éléments :/ });
    expect(within(grid()).getAllByRole('button')).toHaveLength(decorItemsOf('ecrans').length);
    await user.click(screen.getByRole('button', { name: 'Plantes' }));
    expect(within(grid()).getAllByRole('button')).toHaveLength(decorItemsOf('plantes').length);
  });

  test('le survol d\'une vignette montre son nom, sa taille en cases et comment elle se pose', async () => {
    const user = userEvent.setup();
    const { view } = setup();
    const item = decorItem('of-14-12')!;
    await user.hover(screen.getByRole('button', { name: item.name }));
    const peek = view.container.querySelector('.decor-peek')!;
    expect(peek.textContent).toContain(item.name);
    expect(peek.textContent).toContain(item.w * item.h === 1 ? fr.decor.sizeOne : t(fr.decor.size, { w: item.w, h: item.h }));
    expect(peek.textContent).toContain(fr.decor.kinds[item.kind]);
    await user.unhover(screen.getByRole('button', { name: item.name }));
    expect(peek.textContent).toBe(fr.decor.peekHint);
  });

  test('un élément pris rejoint les récents : un onglet de plus, en tête, et le panneau rouvre dessus', async () => {
    const user = userEvent.setup();
    const { view } = setup();
    await user.click(screen.getByRole('button', { name: 'Plantes' }));
    await user.click(screen.getByRole('button', { name: 'Plante en pot' }));
    const shelves = within(screen.getByRole('group', { name: fr.decor.categories })).getAllByRole('button');
    expect(shelves[0]!.textContent).toBe(fr.decor.recents);
    expect(shelves).toHaveLength(DECOR_CATEGORIES.length + 1);

    view.unmount();
    setup();
    expect(screen.getByRole('button', { name: fr.decor.recents }).getAttribute('aria-pressed')).toBe('true');
    const grid = screen.getByRole('group', { name: t(fr.decor.items, { category: fr.decor.recents }) });
    expect(within(grid).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Plante en pot']);
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
    await user.type(screen.getByLabelText(fr.decor.searchLabel), 'canape');
    const names = within(screen.getByRole('group', { name: /^Éléments :/ })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThan(3);
    expect(names.every((name) => name!.toLowerCase().includes('canapé'))).toBe(true);
    await user.clear(screen.getByLabelText(fr.decor.searchLabel));
    await user.type(screen.getByLabelText(fr.decor.searchLabel), 'zzzz');
    expect(screen.getByText(fr.decor.empty)).toBeTruthy();
  });

  test('Échap dans la recherche la vide sans fermer le panneau ; la fermeture n\'est que la croix de l\'en-tête', async () => {
    const user = userEvent.setup();
    const { closed } = setup();
    const search = screen.getByLabelText(fr.decor.searchLabel) as HTMLInputElement;
    await user.type(search, 'plante');
    await user.keyboard('{Escape}');
    expect(search.value).toBe('');
    expect(closed()).toBe(0);
    expect(screen.queryByRole('button', { name: 'Fermer' })).toBeNull();
    await user.click(screen.getByRole('button', { name: fr.decor.close }));
    expect(closed()).toBe(1);
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

describe('les murs de la boutique', () => {
  const wall = SHOP_WALL_THEMES[0];
  const progress = (over: Partial<MyProgress> = {}): MyProgress => ({ xp: 0, kuartzons: 0, streak: 0, todoXpLeft: 100, owned: [], ...over });

  test('sous « Murs et sol » : un mur pas encore acheté porte son prix ; un clic propose de l\'acheter, et l\'achat le met au brouillon', async () => {
    const user = userEvent.setup();
    setup();
    act(() => useOfficeStore.getState().setProgress(progress({ kuartzons: 1000 })));
    vi.mocked(progressApi.buyItem).mockResolvedValueOnce(progress({ kuartzons: 1000 - wall.price, owned: [wall.id] }));
    await user.click(screen.getByRole('tab', { name: fr.decor.tabs.themes }));
    await user.click(screen.getByRole('button', { name: t(fr.decor.lockedWall, { name: wall.label, price: formatNumber(wall.price) }) }));
    expect(useOfficeStore.getState().decorEditor!.draft.wall).toBe(DEFAULT_DESK_DECOR.wall);
    await user.click(screen.getByRole('button', { name: t(fr.shop.buyHere, { price: formatNumber(wall.price) }) }));
    expect(progressApi.buyItem).toHaveBeenCalledWith(wall.id);
    expect(useOfficeStore.getState().decorEditor!.draft.wall).toBe(wall.id);
    expect(screen.getByRole('button', { name: wall.label }).getAttribute('aria-pressed')).toBe('true');
  });

  test('pas assez de kuartzons : le bouton d\'achat est éteint et dit combien il en manque', async () => {
    const user = userEvent.setup();
    setup();
    act(() => useOfficeStore.getState().setProgress(progress({ kuartzons: 100 })));
    await user.click(screen.getByRole('tab', { name: fr.decor.tabs.themes }));
    await user.click(screen.getByRole('button', { name: t(fr.decor.lockedWall, { name: wall.label, price: formatNumber(wall.price) }) }));
    const buy = screen.getByRole('button', { name: t(fr.shop.buyHere, { price: formatNumber(wall.price) }) }) as HTMLButtonElement;
    expect(buy.disabled).toBe(true);
    expect(buy.title).toBe(t(fr.shop.missing, { count: formatNumber(wall.price - 100) }));
  });

  test('un objet de la boutique, dans le sélecteur : un clic propose de l\'acheter ; acheté, il est pris en main', async () => {
    const user = userEvent.setup();
    const item = decorItemsOf('boutique')[0]!;
    setup();
    act(() => useOfficeStore.getState().setProgress(progress({ kuartzons: 20_000 })));
    vi.mocked(progressApi.buyItem).mockResolvedValueOnce(progress({ kuartzons: 20_000 - item.price!, owned: [item.id] }));
    await user.click(screen.getByRole('button', { name: 'Boutique' }));
    await user.click(within(screen.getByRole('group', { name: /^Éléments :/ })).getByRole('button', { name: item.name }));
    expect(useOfficeStore.getState().decorEditor!.held).toBeNull();
    await user.click(screen.getByRole('button', { name: t(fr.shop.buyHere, { price: formatNumber(item.price!) }) }));
    expect(progressApi.buyItem).toHaveBeenCalledWith(item.id);
    expect(useOfficeStore.getState().decorEditor!.held).toBe(item.id);
  });

  test('un mur acheté se choisit comme les autres', async () => {
    const user = userEvent.setup();
    setup();
    act(() => useOfficeStore.getState().setProgress(progress({ owned: [wall.id] })));
    await user.click(screen.getByRole('tab', { name: fr.decor.tabs.themes }));
    await user.click(screen.getByRole('button', { name: wall.label }));
    expect(useOfficeStore.getState().decorEditor!.draft.wall).toBe(wall.id);
  });
});
