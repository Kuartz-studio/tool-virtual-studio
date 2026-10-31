import { buildOfficeTiledMap, parseOfficeMap, placeByKey, type InitPayload, type OfficeMap, type Place, type PublicPlayer, type RoomMusic } from '@bureau/shared';
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
// Le milieu d'un lieu de la carte (son premier rectangle), en pixels.
const middleOf = (key: string) => {
  const rect = placeByKey(map, key)!.rects[0]!;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

const me: PublicPlayer = { id: 'moi', name: 'Moi', avatarKey: null, x: map.spawn.x, y: map.spawn.y, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } };
const init: InitPayload = { self: me, players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] };

let audio: FakeAudio;
let engine: AudioEngine;

// Laisse aller jusqu'au bout les téléchargements et décodages que le moteur a lancés (les minuteries sont simulées).
const settle = () => act(() => vi.advanceTimersByTimeAsync(1));
const gesture = () => act(() => void fireEvent.pointerDown(document.body));
// Le navigateur laisse démarrer le son.
const allow = () => act(() => audio.context.run());
// Les boucles qui jouent : la musique, et celles de la nature (l'eau, les insectes).
const loopsNow = (kind: 'music' | 'nature') =>
  audio.context.sources
    .filter((source) => source.loop && source.stoppedAt === null)
    .map((source) => (source.buffer as { url: string }).url)
    .filter((url) => url.includes(`/${kind}/`));
const musicNow = () => loopsNow('music');

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
  useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, place: 'lobby', placeKey: null, status: 'locked', playing: null });
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
  function enterOffice(at: { x: number; y: number }): void {
    act(() => {
      useOfficeStore.getState().applyInit({ ...init, self: { ...me, x: at.x, y: at.y } });
      useOfficeStore.getState().setOfficeMap(map);
    });
  }
  const walkTo = (at: { x: number; y: number }) => act(() => emitOnBus(EventBus, 'local:move', { x: at.x, y: at.y, dir: 'down', moving: true } as never));

  test('à l\'arrivée, l\'ambiance de l\'endroit où l\'on apparaît, tout de suite', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    // La salle de jeu : le crépuscule.
    enterOffice(middleOf('game'));
    await settle();
    expect(useAudioStore.getState().place).toBe('dusk');
    expect(musicNow()).toContain('/assets/audio/music/dusk.ogg');
  });

  test('on change de pièce : l\'ambiance ne change qu\'après un moment dans la nouvelle', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterOffice(map.spawn);
    expect(useAudioStore.getState().place).toBe('lobby');

    // La salle de conférence : l'étrange et le planant.
    walkTo(middleOf('conference'));
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
    enterOffice(map.spawn);
    walkTo(middleOf('conference'));
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS / 2));
    walkTo(map.spawn);
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS * 3));
    expect(useAudioStore.getState().place).toBe('lobby');
  });

  test('quitter le bureau (la carte est retirée) : retour à la salle d\'attente', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterOffice(middleOf('game'));
    expect(useAudioStore.getState().place).toBe('dusk');
    act(() => useOfficeStore.getState().setOfficeMap(null));
    expect(useAudioStore.getState().place).toBe('lobby');
  });
});

// Le dehors : un jardin (lieu `outside`) avec son bassin, à côté d'un hall. Une petite carte à part : celle du bureau peut changer, pas ce qu'on vérifie.
describe('dehors, la nature', () => {
  const tile = (n: number) => n * map.tileSize;
  const place = (key: string, kind: Place['kind'], x: number): Place => ({
    key,
    label: key,
    kind,
    rects: [{ x: tile(x), y: 0, width: tile(12), height: tile(12) }],
    scene: 'lobby',
    music: false,
    destination: false,
  });
  const garden: OfficeMap = {
    ...map,
    zones: [],
    places: [place('garden', 'outside', 0), place('hall', 'room', 12)],
    waters: [{ x: tile(1), y: tile(4), width: tile(3), height: tile(3) }],
    spawn: { x: tile(18), y: tile(6) },
  };
  const walkTo = (x: number, y: number) => act(() => emitOnBus(EventBus, 'local:move', { x, y, dir: 'down', moving: true } as never));
  const natureFetched = () => audio.fetched.filter((url) => url.includes('/nature/'));

  test('sortir au jardin : la musique se tait (pas d\'enceinte), l\'eau du bassin et les oiseaux s\'entendent ; rentrer ramène la musique', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    act(() => {
      useOfficeStore.getState().applyInit({ ...init, self: { ...me, x: garden.spawn.x, y: garden.spawn.y } });
      useOfficeStore.getState().setOfficeMap(garden);
    });
    await settle();
    // Dans le hall, loin du bassin, le jour : la musique, rien de la nature.
    expect(musicNow()).toEqual(['/assets/audio/music/lobby.ogg']);
    expect(natureFetched()).toEqual([]);

    // Au bord du bassin : l'eau tout de suite, les oiseaux et le vent se chargent ; la musique attend PLACE_SETTLE_MS, puis se tait.
    walkTo(tile(5), tile(5));
    await settle();
    expect(loopsNow('nature')).toEqual(['/assets/audio/nature/water.ogg']);
    expect(natureFetched()).toEqual(expect.arrayContaining(['/assets/audio/nature/birds.ogg', '/assets/audio/nature/wind.ogg']));
    expect(useAudioStore.getState().outside).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS));
    expect(useAudioStore.getState().outside).toBe(true);
    expect(musicNow()).toEqual([]);

    // La nuit tombe (la lumière s'éteint) : les insectes.
    act(() => useOfficeStore.getState().setLights({ level: 'off', by: null, at: 1 }));
    await settle();
    expect(loopsNow('nature')).toContain('/assets/audio/nature/insects.ogg');

    // Rentrer : la musique revient.
    walkTo(tile(18), tile(6));
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS));
    await settle();
    expect(musicNow()).toEqual(['/assets/audio/music/lobby.ogg']);
  });

  test('les effets coupés font taire la nature avec eux', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    act(() => useAudioStore.getState().setPrefs({ sfxOn: false }));
    act(() => {
      useOfficeStore.getState().applyInit({ ...init, self: { ...me, x: tile(5), y: tile(5) } });
      useOfficeStore.getState().setOfficeMap(garden);
    });
    await settle();
    expect(natureFetched()).toEqual([]);
    expect(loopsNow('nature')).toEqual([]);
  });
});

// La musique de chaque pièce : ceux qui y sont la règlent pour tous (le serveur la dit : music:changed, au magasin du bureau). On entend celle de la pièce où l'on est,
// sauf l'ambiance qu'on a choisie soi-même dans le panneau Son.
describe('la musique de chaque pièce', () => {
  const BY = { id: 'a', name: 'A' };
  const OFF: RoomMusic = { on: false, scene: null, by: BY, at: 1 };
  const QUEST: RoomMusic = { on: true, scene: 'quest', by: BY, at: 2 };
  const url = (scene: string) => `/assets/audio/music/${scene}.ogg`;

  // On arrive à cet endroit : le serveur dit où l'on est et, dans son init, la musique des pièces déjà réglées (un init la remplace toute).
  const enterAt = (at: { x: number; y: number }, music: Record<string, RoomMusic> = {}) =>
    act(() => {
      useOfficeStore.getState().applyInit({ ...init, self: { ...me, x: at.x, y: at.y }, music });
      useOfficeStore.getState().setOfficeMap(map);
    });
  const walkTo = (at: { x: number; y: number }) => act(() => emitOnBus(EventBus, 'local:move', { x: at.x, y: at.y, dir: 'down', moving: true } as never));
  const setMusic = (place: string, state: RoomMusic) => act(() => useOfficeStore.getState().setRoomMusic(place, state));

  test('arriver dans une pièce éteinte : le silence ; allumée sous nos pieds, la musique repart', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterAt(middleOf('game'), { game: OFF });
    await settle();
    expect(musicNow()).toEqual([]);
    expect(useAudioStore.getState().playing).toBeNull();
    expect(useAudioStore.getState().placeKey).toBe('game');

    setMusic('game', { on: true, scene: null, by: BY, at: 3 });
    await settle();
    expect(musicNow()).toEqual([url('dusk')]);
  });

  test('arriver dans une pièce dont on a choisi l\'ambiance : celle-là, à la place de celle par défaut', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterAt(middleOf('game'), { game: QUEST });
    await settle();
    expect(musicNow()).toEqual([url('quest')]);
    expect(useAudioStore.getState().playing).toBe('quest');
  });

  test('quelqu\'un règle la pièce où l\'on est : la musique suit tout de suite, sans attendre', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterAt(middleOf('game'));
    await settle();
    expect(musicNow()).toEqual([url('dusk')]);

    setMusic('game', OFF);
    expect(musicNow()).toEqual([]);
    setMusic('game', { ...QUEST, at: 4 });
    await settle();
    expect(musicNow()).toEqual([url('quest')]);
  });

  test('quelqu\'un d\'autre règle la musique de la pièce où l\'on est : le bruit d\'un interrupteur s\'ajoute ; celle d\'une autre pièce, ou la nôtre, ne sonne pas', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterAt(middleOf('game'));
    await settle();
    // Les effets joués depuis l'arrivée au bureau (le jingle de bienvenue n'est pas compté).
    const welcome = audio.context.sources.filter((source) => !source.loop).length;
    const effects = () => audio.context.sources.filter((source) => !source.loop).length - welcome;

    setMusic('gym', OFF);
    expect(effects()).toBe(0);
    setMusic('game', { ...OFF, by: { id: 'moi', name: 'Moi' }, at: 3 });
    expect(effects()).toBe(0);
    setMusic('game', { ...QUEST, at: 4 });
    expect(effects()).toBe(1);
  });

  test('entrer dans une pièce éteinte coupe la musique, mais seulement après PLACE_SETTLE_MS : on ne coupe pas en longeant sa porte', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterAt(map.spawn, { game: OFF });
    await settle();
    expect(musicNow()).toEqual([url('lobby')]);

    walkTo(middleOf('game'));
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS - 1));
    expect(musicNow()).toEqual([url('lobby')]);
    await act(() => vi.advanceTimersByTimeAsync(1));
    await settle();
    expect(musicNow()).toEqual([]);

    // Et en sortir la relance : le couloir joue.
    walkTo(map.spawn);
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS));
    await settle();
    expect(musicNow()).toEqual([url('lobby')]);
  });

  test('deux pièces de même ambiance par défaut : passer de l\'une à l\'autre change la pièce dont on entend la musique, après PLACE_SETTLE_MS', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    // La salle de sport et l'octogone jouent la même ambiance (« quest ») ; celle de la salle de sport est coupée, pas celle de l'octogone.
    enterAt(middleOf('gym'), { gym: OFF });
    await settle();
    expect(musicNow()).toEqual([]);
    expect(useAudioStore.getState().placeKey).toBe('gym');

    walkTo(middleOf('arena'));
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SETTLE_MS));
    await settle();
    expect(useAudioStore.getState().placeKey).toBe('arena');
    expect(musicNow()).toEqual([url('quest')]);
  });

  test('une pièce éteinte ne l\'est que pour elle : la pièce d\'à côté joue sa musique', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterAt(middleOf('gym'), { game: OFF });
    await settle();
    expect(musicNow()).toEqual([url('quest')]);
  });

  test('l\'ambiance choisie dans le panneau Son (son casque) passe avant la pièce, même éteinte ; « Musique » coupée la fait taire', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    act(() => useAudioStore.getState().setPrefs({ scene: 'sunny' }));
    enterAt(middleOf('game'), { game: OFF });
    await settle();
    expect(musicNow()).toEqual([url('sunny')]);

    act(() => useAudioStore.getState().setPrefs({ musicOn: false }));
    expect(musicNow()).toEqual([]);
  });

  test('un endroit sans enceinte (la rue) joue toujours son ambiance par défaut : un état qui traîne n\'y change rien', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    enterAt(middleOf('street'), { street: OFF });
    await settle();
    expect(musicNow()).toEqual([url('lobby')]);
    expect(useAudioStore.getState().placeKey).toBeNull();
  });

  test('la pièce dont on règle la musique est celle de nos pieds : dans un bureau, celle du bureau', async () => {
    render(<AudioDirector engine={engine} />);
    await startSound();
    const desk = map.zones.find((zone) => zone.type === 'desk')!;
    enterAt({ x: desk.x + desk.width / 2, y: desk.y + desk.height / 2 });
    await settle();
    expect(useAudioStore.getState()).toMatchObject({ place: 'focus', placeKey: `desk:${desk.name}` });
    setMusic(`desk:${desk.name}`, OFF);
    expect(musicNow()).toEqual([]);
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
