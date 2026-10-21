import { buildOfficeTiledMap, GRAND_HALL, LOUNGE, parseOfficeMap, type InitPayload, type PublicPlayer } from '@bureau/shared';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EventBus } from '../game/EventBus';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { createFakeAudio, type FakeAudio } from '../test/fake-audio';
import { FakeChannel } from '../test/fake-broadcast-channel';
import { AudioDirector, DUCK_HOLD_MS, PLACE_SETTLE_MS } from './AudioDirector';
import { useAudioStore } from './audio-store';
import { DUCK_LEVEL, AudioEngine } from './engine';
import { DEFAULT_AUDIO_PREFS } from './prefs';

const map = parseOfficeMap(buildOfficeTiledMap());
const px = (tile: number) => tile * map.tileSize + map.tileSize / 2;

const me: PublicPlayer = { id: 'moi', name: 'Moi', avatarKey: null, x: map.spawn.x, y: map.spawn.y, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } };
const init: InitPayload = { self: me, players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] };

let audio: FakeAudio;
let engine: AudioEngine;

// Laisse aller jusqu'au bout les téléchargements et décodages que le moteur a lancés (les minuteries sont simulées).
const settle = () => act(() => vi.advanceTimersByTimeAsync(1));
const gesture = () => act(() => void fireEvent.pointerDown(document.body));
// Le navigateur laisse démarrer le son.
const allow = () => act(() => audio.context.run());
const musicNow = () => audio.context.sources.filter((source) => source.loop && source.stoppedAt === null).map((source) => (source.buffer as { url: string }).url);

// Le geste, puis le navigateur qui laisse démarrer le son, puis les chargements.
async function startSound(): Promise<void> {
  await gesture();
  await allow();
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  audio = createFakeAudio();
  engine = new AudioEngine(audio.runtime);
  useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, place: 'lobby', status: 'locked', playing: null });
});

afterEach(() => {
  useOfficeStore.getState().reset();
  vi.useRealTimers();
});

describe('le geste', () => {
  test('rien ne se passe tant que la personne n\'a rien touché ; le premier clic ou la première touche débloque le son', async () => {
    render(<AudioDirector engine={engine} />);
    await settle();
    expect(audio.context.gains).toHaveLength(0);
    expect(useAudioStore.getState().status).toBe('locked');

    await gesture();
    await allow();
    await settle();
    expect(useAudioStore.getState().status).toBe('running');
  });

  test.each(['pointerDown', 'keyDown', 'click', 'touchEnd'] as const)('%s débloque le son', async (name) => {
    render(<AudioDirector engine={engine} />);
    act(() => void fireEvent[name](document.body));
    expect(audio.context.gains.length).toBeGreaterThan(0);
  });

  test('démonté, il ne débloque plus rien', () => {
    const { unmount } = render(<AudioDirector engine={engine} />);
    unmount();
    fireEvent.pointerDown(document.body);
    expect(audio.context.gains).toHaveLength(0);
  });
});

describe('la musique', () => {
  test('hors du bureau (la connexion, l\'écran d\'entrée) : la salle d\'attente, dès le premier geste', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    expect(musicNow()).toEqual(['/assets/audio/music/lobby.ogg']);
    expect(useAudioStore.getState().playing).toBe('lobby');
  });

  test('couper la musique la fait taire, la rallumer la relance', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    act(() => useAudioStore.getState().setPrefs({ musicOn: false }));
    expect(musicNow()).toEqual([]);
    expect(useAudioStore.getState().playing).toBeNull();
    act(() => useAudioStore.getState().setPrefs({ musicOn: true }));
    await settle();
    expect(musicNow()).toEqual(['/assets/audio/music/lobby.ogg']);
  });

  test('choisir une ambiance la joue partout, « auto » rend la main au lieu', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    act(() => useAudioStore.getState().setPrefs({ scene: 'dusk' }));
    await settle();
    expect(musicNow()).toContain('/assets/audio/music/dusk.ogg');
    expect(useAudioStore.getState().playing).toBe('dusk');
    act(() => useAudioStore.getState().setPrefs({ scene: 'auto' }));
    await settle();
    expect(useAudioStore.getState().playing).toBe('lobby');
  });

  test('les volumes et les coupures des réglages vont au moteur', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    const [music, , sfx] = audio.context.gains;
    act(() => useAudioStore.getState().setPrefs({ musicVolume: 0.5, sfxVolume: 0.2 }));
    expect(music!.gain.value).toBeCloseTo(0.25, 5);
    expect(sfx!.gain.value).toBeCloseTo(0.04, 5);
  });

  test('les réglages sont enregistrés pour la prochaine visite', () => {
    act(() => useAudioStore.getState().setPrefs({ sfxOn: false, musicVolume: 0.3 }));
    expect(JSON.parse(localStorage.getItem('bureau.audio.v1')!)).toMatchObject({ sfxOn: false, musicVolume: 0.3 });
  });
});

describe('le lieu', () => {
  // Le bureau est affiché : le jeu a lu la carte, et le serveur a placé la personne.
  function enterOffice(x: number, y: number): void {
    act(() => {
      useOfficeStore.getState().applyInit({ ...init, self: { ...me, x, y } });
      useOfficeStore.getState().setOfficeMap(map);
    });
  }
  const walkTo = (tx: number, ty: number) => act(() => emitOnBus(EventBus, 'local:move', { x: px(tx), y: px(ty), dir: 'down', moving: true } as never));

  test('à l\'arrivée, l\'ambiance de l\'endroit où l\'on apparaît, tout de suite', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterOffice(px(LOUNGE.x + 25), px(LOUNGE.y + 6));
    await settle();
    expect(useAudioStore.getState().place).toBe('dusk');
    expect(musicNow()).toContain('/assets/audio/music/dusk.ogg');
  });

  test('on change de pièce : l\'ambiance ne change qu\'après un moment dans la nouvelle', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterOffice(px(54), px(41));
    expect(useAudioStore.getState().place).toBe('lobby');

    walkTo(GRAND_HALL.x + 3, GRAND_HALL.y + 3);
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS - 1));
    expect(useAudioStore.getState().place).toBe('lobby');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(useAudioStore.getState().place).toBe('drift');
    await settle();
    expect(useAudioStore.getState().playing).toBe('drift');
  });

  test('traverser une pièce sans s\'y arrêter ne change pas la musique', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterOffice(px(54), px(41));
    walkTo(GRAND_HALL.x + 3, GRAND_HALL.y + 3);
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS / 2));
    walkTo(54, 41);
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS * 3));
    expect(useAudioStore.getState().place).toBe('lobby');
  });

  test('quitter le bureau (la carte est retirée) : retour à la salle d\'attente', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterOffice(px(LOUNGE.x + 25), px(LOUNGE.y + 6));
    expect(useAudioStore.getState().place).toBe('dusk');
    act(() => useOfficeStore.getState().setOfficeMap(null));
    expect(useAudioStore.getState().place).toBe('lobby');
  });
});

describe('la voix', () => {
  test('quand quelqu\'un parle la musique baisse, et elle remonte un peu après la dernière voix', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    const duck = audio.context.gains[1]!;
    act(() => emitOnBus(EventBus, 'media:speaking', ['a']));
    expect(duck.gain.value).toBe(DUCK_LEVEL);
    // Une voix en remplace une autre : la musique ne remonte pas entre les deux.
    act(() => emitOnBus(EventBus, 'media:speaking', []));
    await act(() => vi.advanceTimersByTimeAsync(DUCK_HOLD_MS / 2));
    act(() => emitOnBus(EventBus, 'media:speaking', ['b']));
    await act(() => vi.advanceTimersByTimeAsync(DUCK_HOLD_MS));
    expect(duck.gain.value).toBe(DUCK_LEVEL);
    act(() => emitOnBus(EventBus, 'media:speaking', []));
    await act(() => vi.advanceTimersByTimeAsync(DUCK_HOLD_MS));
    expect(duck.gain.value).toBe(1);
  });
});

describe('les effets', () => {
  test('un clic de l\'interface fait son bruit, quand les effets sont allumés', async () => {
    render(
      <>
        <AudioDirector engine={engine} />
        <button type="button">Chat</button>
      </>,
    );
    await startSound();
    await settle();
    const button = document.querySelector('button')!;
    act(() => button.click());
    expect(audio.context.sources.filter((source) => !source.loop)).toHaveLength(1);
    act(() => useAudioStore.getState().setPrefs({ sfxOn: false }));
    audio.advance(1000);
    act(() => button.click());
    expect(audio.context.sources.filter((source) => !source.loop)).toHaveLength(1);
  });
});

describe('un seul onglet joue', () => {
  const lobby = '/assets/audio/music/lobby.ogg';

  test('un onglet que le serveur a remplacé par un autre se tait ; il rejoue quand il reprend la main', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    expect(musicNow()).toEqual([lobby]);
    act(() => useOfficeStore.getState().setReplaced(true));
    expect(musicNow()).toEqual([]);
    expect(useAudioStore.getState().playing).toBeNull();
    act(() => useOfficeStore.getState().setReplaced(false));
    await settle();
    expect(musicNow()).toEqual([lobby]);
  });

  test('un onglet remplacé ne fait plus aucun effet', async () => {
    render(
      <>
        <AudioDirector engine={engine} />
        <button type="button">Chat</button>
      </>,
    );
    await startSound();
    await settle();
    act(() => useOfficeStore.getState().setReplaced(true));
    audio.advance(1000);
    act(() => document.querySelector('button')!.click());
    expect(audio.context.sources.filter((source) => !source.loop)).toHaveLength(0);
  });

  test('un autre onglet de l\'appli prend la main (on y a cliqué) : celui-ci se tait, et rejoue à son prochain geste', async () => {
    FakeChannel.all = [];
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    render(<AudioDirector engine={engine} />);
    await startSound();
    expect(musicNow()).toEqual([lobby]);

    const otherTab = new FakeChannel('bureau.audio.owner');
    act(() => otherTab.postMessage({ owner: 'un-autre-onglet' }));
    expect(musicNow()).toEqual([]);

    await gesture();
    await settle();
    expect(musicNow()).toEqual([lobby]);
    otherTab.close();
  });
});
