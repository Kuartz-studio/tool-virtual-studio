import { buildOfficeTiledMap, parseOfficeMap, placeByKey, type DeskInfo, type InitPayload, type PublicPlayer, type RoomMusic } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAudioStore } from '../audio/audio-store';
import { scenesOfTheme, type SceneId } from '../audio/catalog';
import { DEFAULT_AUDIO_PREFS } from '../audio/prefs';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { RoomMusicButton, RoomMusicCard, useRoomMusic } from './RoomMusic';

// La grande carte, comme le jeu et le serveur la lisent.
const map = parseOfficeMap(buildOfficeTiledMap());
const middleOf = (key: string) => {
  const rect = placeByKey(map, key)!.rects[0]!;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

const me = (at: { x: number; y: number }): PublicPlayer => ({ id: 'moi', name: 'Moi', avatarKey: null, x: at.x, y: at.y, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } });
const desk = (key: string, ownerId: string | null, ownerName: string | null = ownerId): DeskInfo => ({ key, ownerId, ownerName, name: null, locked: false, closedByState: false, floor: 'parquet-clair', wall: 'creme', items: [] });
const ALICE = { id: 'alice', name: 'Alice' };
const OFF: RoomMusic = { on: false, scene: null, by: ALICE, at: 1 };
const QUEST: RoomMusic = { on: true, scene: 'quest', by: ALICE, at: 2 };

// On est à cet endroit : le serveur nous y a placés, et le jeu a lu la carte.
function enterAt(at: { x: number; y: number }, extra: Partial<InitPayload> = {}): void {
  act(() => {
    useOfficeStore.getState().applyInit({ self: me(at), players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [], ...extra });
    useOfficeStore.getState().setOfficeMap(map);
  });
}
const walkTo = (key: string) => act(() => emitOnBus(EventBus, 'local:move', { ...middleOf(key), dir: 'down', moving: true } as never));

// Ce que la personne demande au serveur (le bus du jeu : `local:music`).
let asked: unknown[];
const ask = (payload: unknown) => void asked.push(payload);

beforeEach(() => {
  localStorage.clear();
  useOfficeStore.getState().reset();
  useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, status: 'running', playing: null, place: 'lobby', placeKey: null });
  asked = [];
  EventBus.on('local:music', ask);
});
afterEach(() => {
  EventBus.off('local:music', ask);
  vi.restoreAllMocks();
});

const button = () => screen.getByRole('button', { name: fr.roomMusic.button });
const open = async () => {
  await userEvent.click(button());
  return screen.getByRole('dialog', { name: fr.roomMusic.title });
};
const change = () => screen.getByRole('button', { name: new RegExp(`^${fr.roomMusic.change}`) });
// Ouvre la fenêtre, puis la liste des musiques (la vignette).
const openList = async () => {
  await open();
  await userEvent.click(change());
};
const roomSwitch = () => screen.getByRole('switch', { name: fr.roomMusic.on }) as HTMLInputElement;
const row = (id: SceneId) => screen.getByRole('button', { name: new RegExp(`^${fr.sound.scenes[id].title}`) });
const defaultRow = () => screen.getByRole('button', { name: new RegExp(`^${fr.roomMusic.default}`) });
const isCurrent = (element: HTMLElement) => element.getAttribute('aria-current') === 'true';

describe('qui peut régler la musique, et où', () => {
  test('dans une rue, un lieu sans enceinte : pas de bouton', () => {
    enterAt(middleOf('street-n'));
    const { container } = render(<RoomMusicButton />);
    expect(container.firstChild).toBeNull();
  });

  test('sans carte (le jeu n\'est pas là) : pas de bouton', () => {
    const { container } = render(<RoomMusicButton />);
    expect(container.firstChild).toBeNull();
  });

  test('dans une pièce à enceinte : le bouton « Musique de la pièce », fermé', () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('dans son bureau : oui ; dans le bureau de quelqu\'un d\'autre, ou un bureau libre : non', () => {
    enterAt(middleOf('desk:A1'), { desks: [desk('A1', 'moi'), desk('A2', 'alice')] });
    const { container } = render(<RoomMusicButton />);
    expect(button()).toBeTruthy();
    walkTo('desk:A2');
    expect(container.firstChild).toBeNull();
    act(() => useOfficeStore.getState().setDesk(desk('A3', null)));
    walkTo('desk:A3');
    expect(container.firstChild).toBeNull();
  });

  test('on le suit de pièce en pièce : le bouton apparaît en entrant dans une salle à enceinte et disparaît en la quittant', () => {
    enterAt(middleOf('street-n'));
    const { container } = render(<RoomMusicButton />);
    expect(container.firstChild).toBeNull();
    walkTo('gym');
    expect(button()).toBeTruthy();
    walkTo('street-n');
    expect(container.firstChild).toBeNull();
  });
});

// La carte seule, telle que le juke-box la montre : là où l'on ne peut pas changer la musique, elle ne fait que montrer, et dit pourquoi.
function CardHarness() {
  const view = useRoomMusic();
  return view === null ? null : <RoomMusicCard view={view} heard onChange={() => {}} />;
}

describe('la carte, là où l\'on ne peut pas changer la musique', () => {
  test('dans le bureau d\'un autre : sa musique, sans bouton, et la raison avec son nom', () => {
    enterAt(middleOf('desk:A2'), { desks: [desk('A2', 'alice', 'Alice')], music: { 'desk:A2': QUEST } });
    render(<CardHarness />);
    const card = screen.getByRole('region', { name: fr.roomMusic.title });
    expect(card.textContent).toContain(fr.sound.scenes.quest.title);
    expect(card.textContent).toContain(t(fr.roomMusic.locked.desk, { name: 'Alice' }));
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).queryByRole('switch')).toBeNull();
  });

  test('dans un bureau libre, ou sans enceinte : la raison qui va', () => {
    enterAt(middleOf('desk:A3'), { desks: [desk('A3', null)] });
    render(<CardHarness />);
    expect(screen.getByText(fr.roomMusic.locked.freeDesk)).toBeTruthy();
    walkTo('street-n');
    expect(screen.getByText(fr.roomMusic.locked.noSpeaker)).toBeTruthy();
    // La rue joue la salle d'attente, sa musique de toujours.
    expect(screen.getByRole('region', { name: fr.roomMusic.title }).textContent).toContain(fr.sound.scenes.lobby.title);
  });

  test('sans carte du bureau : rien', () => {
    const { container } = render(<CardHarness />);
    expect(container.firstChild).toBeNull();
  });
});

describe('la fenêtre', () => {
  test('ouverte : la carte de la pièce, son interrupteur (allumé) ; la vignette ouvre la liste, « Par défaut de la pièce » coché', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(roomSwitch().checked).toBe(true);
    expect(change().getAttribute('aria-label')).toBe(`${fr.roomMusic.change} : ${fr.sound.scenes.dusk.title}`);
    await userEvent.click(change());
    expect(isCurrent(defaultRow())).toBe(true);
    for (const id of scenesOfTheme('default')) expect(isCurrent(row(id))).toBe(false);
  });

  test('« Par défaut de la pièce » dit l\'ambiance que la carte donne à la pièce', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await openList();
    expect(defaultRow().textContent).toContain(fr.sound.scenes.dusk.title);
  });

  test('éteindre demande music:set au serveur ; la fenêtre ne change qu\'à son annonce', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    await userEvent.click(roomSwitch());
    expect(asked).toEqual([{ place: 'game', on: false }]);
    expect(roomSwitch().checked).toBe(true);
    act(() => useOfficeStore.getState().setRoomMusic('game', OFF));
    expect(roomSwitch().checked).toBe(false);
    expect(screen.getByRole('region', { name: fr.roomMusic.title }).textContent).toContain(fr.roomMusic.off);
  });

  test('rallumer, quand elle est éteinte, demande l\'état contraire', async () => {
    enterAt(middleOf('game'), { music: { game: OFF } });
    render(<RoomMusicButton />);
    await open();
    expect(roomSwitch().checked).toBe(false);
    await userEvent.click(roomSwitch());
    expect(asked).toEqual([{ place: 'game', on: true }]);
  });

  test('choisir une musique la demande ; « Par défaut de la pièce » demande de revenir à celle de la carte (null) ; la même ne demande rien', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await openList();
    await userEvent.click(row('quest'));
    expect(asked).toEqual([{ place: 'game', scene: 'quest' }]);
    act(() => useOfficeStore.getState().setRoomMusic('game', QUEST));
    expect(isCurrent(row('quest'))).toBe(true);
    expect(isCurrent(defaultRow())).toBe(false);
    await userEvent.click(row('quest'));
    expect(asked).toHaveLength(1);
    await userEvent.click(defaultRow());
    expect(asked).toEqual([
      { place: 'game', scene: 'quest' },
      { place: 'game', scene: null },
    ]);
  });

  test('une musique pirate se choisit dans son thème ; dans une pièce éteinte, la choisir la rallume', async () => {
    enterAt(middleOf('game'), { music: { game: OFF } });
    render(<RoomMusicButton />);
    await openList();
    await userEvent.click(screen.getByRole('tab', { name: fr.sound.themes.pirate }));
    await userEvent.click(row('black-flag-rise'));
    expect(asked).toEqual([{ place: 'game', on: true, scene: 'black-flag-rise' }]);
  });

  test('elle suit ce que le serveur annonce, y compris quand un autre règle la pièce', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    act(() => useOfficeStore.getState().setRoomMusic('game', QUEST));
    expect(change().getAttribute('aria-label')).toBe(`${fr.roomMusic.change} : ${fr.sound.scenes.quest.title}`);
    act(() => useOfficeStore.getState().setRoomMusic('game', { ...QUEST, on: false }));
    expect(roomSwitch().checked).toBe(false);
  });

  test('l\'état d\'une autre pièce ne compte pas', async () => {
    enterAt(middleOf('game'), { music: { gym: OFF } });
    render(<RoomMusicButton />);
    await open();
    expect(roomSwitch().checked).toBe(true);
  });

  test('qui l\'a réglée en dernier, quand quelqu\'un l\'a fait', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    expect(screen.queryByText(/Réglée par/)).toBeNull();
    act(() => useOfficeStore.getState().setRoomMusic('game', OFF));
    expect(screen.getByText(t(fr.roomMusic.by, { name: 'Alice' }))).toBeTruthy();
  });

  test('le bouton montre la pièce coupée : haut-parleur barré', () => {
    enterAt(middleOf('game'), { music: { game: OFF } });
    render(<RoomMusicButton />);
    expect(button().className).toContain('is-muted');
    act(() => useOfficeStore.getState().setRoomMusic('game', { ...OFF, on: true }));
    expect(button().className).not.toContain('is-muted');
  });

  test('quand on écoute sa propre musique (son casque), la fenêtre le dit : le réglage est pour les autres', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    expect(screen.queryByText(fr.roomMusic.headphones)).toBeNull();
    act(() => useAudioStore.getState().setPrefs({ scene: 'sunny' }));
    expect(screen.getByText(fr.roomMusic.headphones)).toBeTruthy();
  });

  test('Échap la ferme, le focus revient au bouton ; la quitter, la pièce, la ferme aussi', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button());
    await open();
    walkTo('street-n');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
