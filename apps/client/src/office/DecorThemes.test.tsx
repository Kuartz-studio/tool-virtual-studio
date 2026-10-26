import { DEFAULT_DESK_DECOR, FLOOR_THEMES, SHOP_WALL_THEMES, WALL_THEMES, type DeskInfo, type MyProgress, type PublicPlayer } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { DecorPanel } from './DecorPanel';
import { formatNumber } from './progress-format';

// L'onglet « Murs et sol » du panneau Décorer : les sols et les murs rangés par couleur, le sélecteur de matière (DecorThemes).
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
const desk: DeskInfo = {
  key: 'A2',
  ownerId: 'moi',
  ownerName: 'Léa',
  name: null,
  locked: false,
  closedByState: false,
  floor: DEFAULT_DESK_DECOR.floor,
  wall: DEFAULT_DESK_DECOR.wall,
  items: [],
};

async function openThemes() {
  const socket = new FakeSocket();
  socket.connected = true;
  act(() => {
    useOfficeStore.getState().applyInit({ self: me, players: [], mapKey: 'office', chatHistory: [], desks: [desk], closedDesks: [], deskBans: [] });
  });
  render(<DecorPanel socket={socket.asSocket()} onClose={() => {}} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: fr.decor.tabs.themes }));
  return { socket, user };
}

const floors = () => screen.getByRole('group', { name: fr.decor.floorTitle });
const walls = () => screen.getByRole('group', { name: fr.decor.wallTitle });
// Les couleurs d'une liste, dans l'ordre (le nom de chaque groupe), et les thèmes de l'une d'elles.
const shelfNames = (list: HTMLElement) => within(list).getAllByRole('group').map((group) => document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent);
const themesOf = (list: HTMLElement, color: string) => within(within(list).getByRole('group', { name: color })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
const lockedLabel = (wall: (typeof SHOP_WALL_THEMES)[number]) => t(fr.decor.lockedWall, { name: wall.label, price: formatNumber(wall.price) });
const shopWall = (id: string) => SHOP_WALL_THEMES.find((wall) => wall.id === id)!;

beforeEach(() => {
  useOfficeStore.getState().reset();
  localStorage.clear();
});

describe('rangés par couleur', () => {
  test('les sols puis les murs, chacun par couleur, dans l\'ordre des couleurs ; tous les thèmes y sont', async () => {
    await openThemes();
    expect(shelfNames(floors())).toEqual(['Blanc', 'Crème', 'Beige', 'Gris', 'Noir', 'Brun', 'Rouge', 'Rose', 'Vert', 'Bleu', 'Violet']);
    expect(shelfNames(walls())).toEqual(['Crème', 'Beige', 'Gris', 'Noir', 'Brun', 'Rouge', 'Rose', 'Orange', 'Vert', 'Bleu', 'Violet', 'Multicolore']);
    expect(within(floors()).getAllByRole('button')).toHaveLength(FLOOR_THEMES.length);
    expect(within(walls()).getAllByRole('button')).toHaveLength(WALL_THEMES.length + SHOP_WALL_THEMES.length);
  });

  test('dans une couleur, ses matières : le noir a ses quatre sols, et ses murs, ceux de la boutique compris, avec leur cadenas et leur prix', async () => {
    await openThemes();
    expect(themesOf(floors(), 'Noir')).toEqual(['Noir mat', 'Bois noir', 'Carrelage noir', 'Moquette noire']);
    expect(themesOf(walls(), 'Noir')).toEqual(['Noir mat', 'Lambris noir', 'Carrelage noir', lockedLabel(shopWall('mur-marbre-or')), 'Brique noire', lockedLabel(shopWall('mur-neon'))]);
    const neon = within(walls()).getByRole('button', { name: lockedLabel(shopWall('mur-neon')) });
    expect(neon.querySelector('.decor-tile-price')!.textContent).toBe(formatNumber(shopWall('mur-neon').price));
  });

  test('chaque pastille dit son nom au survol et au lecteur d\'écran', async () => {
    await openThemes();
    for (const button of [...within(floors()).getAllByRole('button'), ...within(walls()).getAllByRole('button')]) {
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
    }
  });
});

describe('le sélecteur de matière', () => {
  const materials = () => screen.getByRole('group', { name: fr.decor.materialsLabel });

  test('« Toutes » d\'abord, choisie ; puis les matières qui existent', async () => {
    await openThemes();
    const buttons = within(materials()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Toutes', 'Uni', 'Bois', 'Carrelage', 'Moquette', 'Pierre', 'Béton', 'Brique', 'Tissu', 'Motif']);
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  test('une matière filtre les deux listes, et une couleur sans rien de cette matière disparaît ; « Toutes » les remet', async () => {
    const { user } = await openThemes();
    await user.click(within(materials()).getByRole('button', { name: 'Bois' }));
    expect(within(materials()).getByRole('button', { name: 'Bois' }).getAttribute('aria-pressed')).toBe('true');
    expect(shelfNames(floors())).toEqual(['Beige', 'Noir', 'Brun', 'Rouge']);
    expect(within(floors()).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Parquet clair', 'Bois noir', 'Parquet brun', 'Noyer', 'Parquet rouge', 'Chevrons']);
    expect(shelfNames(walls())).toEqual(['Noir', 'Brun', 'Vert']);
    expect(themesOf(walls(), 'Vert')).toEqual([lockedLabel(shopWall('mur-lambris'))]);

    // Aucun sol en brique : la liste le dit.
    await user.click(within(materials()).getByRole('button', { name: 'Brique' }));
    expect(within(floors()).queryAllByRole('button')).toEqual([]);
    expect(within(floors()).getByText(fr.decor.noFloors)).toBeTruthy();
    expect(within(walls()).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Brique claire', 'Brique noire', lockedLabel(shopWall('mur-neon'))]);

    await user.click(within(materials()).getByRole('button', { name: 'Toutes' }));
    expect(within(floors()).getAllByRole('button')).toHaveLength(FLOOR_THEMES.length);
  });

  test('au clavier : Entrée sur une matière la choisit, Espace sur une pastille la pose', async () => {
    const { user } = await openThemes();
    within(materials()).getByRole('button', { name: 'Uni' }).focus();
    await user.keyboard('{Enter}');
    expect(shelfNames(floors())).toEqual(['Beige', 'Noir']);
    within(floors()).getByRole('button', { name: 'Noir mat' }).focus();
    await user.keyboard(' ');
    expect(useOfficeStore.getState().decorEditor!.draft.floor).toBe('noir-mat');
  });
});

describe('les sols et les murs noirs', () => {
  const progress = (over: Partial<MyProgress> = {}): MyProgress => ({ xp: 0, kuartzons: 0, streak: 0, todoXpLeft: 100, owned: [], ...over });

  test('le sol noir mat et le mur de brique noire se posent gratuitement : rien n\'est à l\'essai, Enregistrer les envoie tout de suite', async () => {
    const { socket, user } = await openThemes();
    act(() => useOfficeStore.getState().setProgress(progress()));
    await user.click(within(floors()).getByRole('button', { name: 'Noir mat' }));
    await user.click(within(walls()).getByRole('button', { name: 'Brique noire' }));
    expect(useOfficeStore.getState().decorEditor!.draft).toMatchObject({ floor: 'noir-mat', wall: 'brique-noire' });
    expect(within(floors()).getByRole('button', { name: 'Noir mat' }).getAttribute('aria-pressed')).toBe('true');
    // Le mur « Noir mat » est un autre thème : il n'est pas choisi.
    expect(within(walls()).getByRole('button', { name: 'Noir mat' }).getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.decor-cart')).toBeNull();

    await user.click(screen.getByRole('button', { name: fr.decor.save }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'decor', floor: 'noir-mat', wall: 'brique-noire', items: [] }]);
  });
});
