import { buildOfficeTiledMap, parseOfficeMap, placeByKey, type DeskInfo, type InitPayload, type PublicPlayer, type RoomMusic } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAudioStore } from '../audio/audio-store';
import { SCENE_IDS } from '../audio/catalog';
import { DEFAULT_AUDIO_PREFS } from '../audio/prefs';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { RoomMusicButton } from './RoomMusic';

// La grande carte, comme le jeu et le serveur la lisent.
const map = parseOfficeMap(buildOfficeTiledMap());
const middleOf = (key: string) => {
  const rect = placeByKey(map, key)!.rects[0]!;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

const me = (at: { x: number; y: number }): PublicPlayer => ({ id: 'moi', name: 'Moi', avatarKey: null, x: at.x, y: at.y, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } });
const desk = (key: string, ownerId: string | null): DeskInfo => ({ key, ownerId, ownerName: ownerId, name: null, locked: false, closedByState: false, floor: 'parquet-clair', wall: 'creme', items: [] });
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
const roomSwitch = () => screen.getByRole('switch', { name: fr.roomMusic.on }) as HTMLInputElement;
const sceneRadio = (id: (typeof SCENE_IDS)[number]) => screen.getByRole('radio', { name: new RegExp(`^${fr.sound.scenes[id].title}`) }) as HTMLInputElement;
const defaultRadio = () => screen.getByRole('radio', { name: new RegExp(`^${fr.roomMusic.default}`) }) as HTMLInputElement;

describe('qui peut régler la musique, et où', () => {
  test('dans une rue, une salle sans enceinte : pas de bouton', () => {
    enterAt(middleOf('street-n'));
    const { container } = render(<RoomMusicButton />);
    expect(container.firstChild).toBeNull();
    act(() => emitOnBus(EventBus, 'local:move', { ...middleOf('client'), dir: 'down', moving: true } as never));
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
    // Dans le bureau d'Alice : le bouton disparaît.
    act(() => emitOnBus(EventBus, 'local:move', { ...middleOf('desk:A2'), dir: 'down', moving: true } as never));
    expect(container.firstChild).toBeNull();
    // Dans un bureau libre : de même.
    act(() => useOfficeStore.getState().setDesk(desk('A3', null)));
    act(() => emitOnBus(EventBus, 'local:move', { ...middleOf('desk:A3'), dir: 'down', moving: true } as never));
    expect(container.firstChild).toBeNull();
  });

  test('on le suit de pièce en pièce : le bouton apparaît en entrant dans une salle à enceinte et disparaît en la quittant', () => {
    enterAt(middleOf('street-n'));
    const { container } = render(<RoomMusicButton />);
    expect(container.firstChild).toBeNull();
    act(() => emitOnBus(EventBus, 'local:move', { ...middleOf('gym'), dir: 'down', moving: true } as never));
    expect(button()).toBeTruthy();
    act(() => emitOnBus(EventBus, 'local:move', { ...middleOf('street-n'), dir: 'down', moving: true } as never));
    expect(container.firstChild).toBeNull();
  });
});

describe('la fenêtre', () => {
  test('ouverte : l\'interrupteur (allumé), « Par défaut » coché, et les six ambiances', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(roomSwitch().checked).toBe(true);
    expect(defaultRadio().checked).toBe(true);
    for (const id of SCENE_IDS) expect(sceneRadio(id).checked).toBe(false);
    expect(screen.getAllByRole('radio')).toHaveLength(SCENE_IDS.length + 1);
  });

  test('« Par défaut » dit l\'ambiance que la carte donne à la pièce', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    expect(defaultRadio().closest('label')!.textContent).toContain(fr.sound.scenes.dusk.title);
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
  });

  test('rallumer, quand elle est éteinte, demande l\'état contraire', async () => {
    enterAt(middleOf('game'), { music: { game: OFF } });
    render(<RoomMusicButton />);
    await open();
    expect(roomSwitch().checked).toBe(false);
    await userEvent.click(roomSwitch());
    expect(asked).toEqual([{ place: 'game', on: true }]);
  });

  test('choisir une ambiance la demande ; « Par défaut » demande de revenir à celle de la carte (null)', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    await userEvent.click(sceneRadio('quest'));
    expect(asked).toEqual([{ place: 'game', scene: 'quest' }]);
    act(() => useOfficeStore.getState().setRoomMusic('game', QUEST));
    expect(sceneRadio('quest').checked).toBe(true);
    expect(defaultRadio().checked).toBe(false);
    await userEvent.click(defaultRadio());
    expect(asked).toEqual([{ place: 'game', scene: 'quest' }, { place: 'game', scene: null }]);
  });

  test('elle suit ce que le serveur annonce, y compris quand un autre règle la pièce', async () => {
    enterAt(middleOf('game'));
    render(<RoomMusicButton />);
    await open();
    act(() => useOfficeStore.getState().setRoomMusic('game', { ...QUEST, on: false }));
    expect(roomSwitch().checked).toBe(false);
    expect(sceneRadio('quest').checked).toBe(true);
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

  test('le bouton montre la pièce coupée : haut-parleur barré', async () => {
    enterAt(middleOf('game'), { music: { game: OFF } });
    render(<RoomMusicButton />);
    expect(button().className).toContain('is-muted');
    act(() => useOfficeStore.getState().setRoomMusic('game', { ...OFF, on: true }));
    expect(button().className).not.toContain('is-muted');
  });

  test('quand on écoute une ambiance choisie dans le panneau Son (son casque), la fenêtre le dit : le réglage est pour les autres', async () => {
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
    act(() => emitOnBus(EventBus, 'local:move', { ...middleOf('street-n'), dir: 'down', moving: true } as never));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
