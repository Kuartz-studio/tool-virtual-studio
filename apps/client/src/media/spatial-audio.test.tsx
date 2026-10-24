import { OFFICE, TILE_SIZE, buildTiledMap, parseOfficeMap, type PublicPlayer } from '@bureau/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EventBus } from '../game/EventBus';
import { useOfficeStore } from '../state/office-store';
import { FakeMediaClient } from './fake-media-client';
import type { MediaSnapshot } from './media-client';
import { AUDIBLE_GAIN, SPATIAL_AUDIO_HZ, useSpatialAudio, volumesFor } from './spatial-audio';

const map = parseOfficeMap(buildTiledMap({ ...OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const tile = (n: number) => n * TILE_SIZE;
// Un point du couloir au nord (espace ouvert) : y 12, x en cases.
const corridor = (x: number) => ({ x: tile(x), y: tile(12) });

const player = (id: string, at: { x: number; y: number }): PublicPlayer => ({
  id,
  name: id,
  avatarKey: null,
  ...at,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
});

describe('volumesFor', () => {
  test('une personne par entrée ; plein volume près de soi, silence au-delà de 14 cases', () => {
    const volumes = volumesFor(map, corridor(4), [{ id: 'near' }, { id: 'mid' }, { id: 'far' }], (id) => ({ near: corridor(7), mid: corridor(14), far: corridor(30) })[id]);
    expect(volumes.near).toBe(1);
    expect(volumes.mid).toBeGreaterThan(0);
    expect(volumes.mid).toBeLessThan(1);
    expect(volumes.far).toBe(0);
  });

  test('dans un bureau, tout le monde est à plein volume, même loin', () => {
    const inRoom = { x: tile(4) + 16, y: tile(3) + 16 };
    expect(volumesFor(map, inRoom, [{ id: 'far' }], () => corridor(60))).toEqual({ far: 1 });
  });

  test('quelqu\'un dont on ignore la place : plein volume (sa position arrive avec le tick suivant)', () => {
    expect(volumesFor(map, corridor(4), [{ id: 'new' }], () => undefined)).toEqual({ new: 1 });
  });

  test('arrondi à deux décimales', () => {
    const [volume] = Object.values(volumesFor(map, corridor(4), [{ id: 'a' }], () => ({ x: tile(4) + tile(10) + 7, y: tile(12) })));
    expect(Math.round(volume! * 100) / 100).toBe(volume);
  });

  test('les membres de sa conversation verrouillée : plein volume, même à l\'autre bout du bureau', () => {
    const where = (id: string) => ({ ami: corridor(60), autre: corridor(60) })[id];
    expect(volumesFor(map, corridor(4), [{ id: 'ami' }, { id: 'autre' }], where, new Set(['ami']))).toEqual({ ami: 1, autre: 0 });
  });
});

describe('useSpatialAudio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useOfficeStore.getState().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Moi dans le couloir, Bob et Zoé dans la même room ; la carte est lue.
  async function inRoom(positions: Record<string, { x: number; y: number }>) {
    const client = new FakeMediaClient();
    act(() => {
      useOfficeStore.getState().applyInit({
        self: player('moi', corridor(4)),
        players: Object.entries(positions).map(([id, at]) => player(id, at)),
        mapKey: 'office',
        chatHistory: [],
        desks: [],
        closedDesks: [],
        deskBans: [],
      });
      useOfficeStore.getState().setOfficeMap(map);
    });
    await act(() => client.join({ url: 'wss://livekit.test', room: 'r1', token: 't' }));
    for (const id of Object.keys(positions)) act(() => client.addRemote({ id, name: id, mic: true }));
    const hook = renderHook(({ snapshot }: { snapshot: MediaSnapshot }) => useSpatialAudio(client, snapshot), {
      initialProps: { snapshot: client.getSnapshot() },
    });
    return { client, hook, refresh: () => hook.rerender({ snapshot: client.getSnapshot() }) };
  }

  test('règle le volume de chacun dès l\'entrée dans la conversation, et masque ceux qu\'on n\'entend plus', async () => {
    const { client, hook } = await inRoom({ bob: corridor(8), zoe: corridor(40) });
    expect(client.volumes).toEqual({ bob: 1, zoe: 0 });
    expect([...hook.result.current]).toEqual(['zoe']);
  });

  test('il suit celui qui marche : un pas de ma part (local:move) change les volumes dans la dixième de seconde', async () => {
    const { client, hook } = await inRoom({ bob: corridor(8) });
    expect(client.volumes).toEqual({ bob: 1 });
    // Je m'éloigne de Bob : à 12 cases, sa voix est faible mais là.
    act(() => EventBus.emit('local:move', { ...corridor(-4 + 20), dir: 'right', moving: true }));
    act(() => {
      vi.advanceTimersByTime(1000 / SPATIAL_AUDIO_HZ);
    });
    const volume = client.volumes.bob!;
    expect(volume).toBeGreaterThan(0);
    expect(volume).toBeLessThan(1);
    // Plus loin encore : inaudible, sa vignette est masquée.
    act(() => EventBus.emit('local:move', { ...corridor(30), dir: 'right', moving: true }));
    act(() => {
      vi.advanceTimersByTime(1000 / SPATIAL_AUDIO_HZ);
    });
    expect(client.volumes).toEqual({ bob: 0 });
    expect([...hook.result.current]).toEqual(['bob']);
  });

  test('mes pas comptent même hors conversation : rejoint à l\'arrêt là où j\'ai marché, le volume part de là, pas de mon arrivée', async () => {
    const client = new FakeMediaClient();
    act(() => {
      useOfficeStore.getState().applyInit({ self: player('moi', corridor(4)), players: [player('bob', corridor(40))], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] });
      useOfficeStore.getState().setOfficeMap(map);
    });
    const hook = renderHook(({ snapshot }: { snapshot: MediaSnapshot }) => useSpatialAudio(client, snapshot), { initialProps: { snapshot: client.getSnapshot() } });
    // Hors conversation, je marche jusqu'à Bob, et je m'arrête.
    act(() => EventBus.emit('local:move', { ...corridor(39), dir: 'right', moving: false }));
    await act(() => client.join({ url: 'wss://livekit.test', room: 'r1', token: 't' }));
    act(() => client.addRemote({ id: 'bob', name: 'bob', mic: true }));
    hook.rerender({ snapshot: client.getSnapshot() });
    expect(client.volumes).toEqual({ bob: 1 });
    expect(hook.result.current.size).toBe(0);
  });

  test('ses positions (le magasin) suivent aussi : Bob s\'éloigne', async () => {
    const { client } = await inRoom({ bob: corridor(8) });
    useOfficeStore.getState().positions.set('bob', { ...corridor(40), dir: 'down', moving: false });
    act(() => {
      vi.advanceTimersByTime(1000 / SPATIAL_AUDIO_HZ);
    });
    expect(client.volumes).toEqual({ bob: 0 });
  });

  test('rien ne change, rien n\'est renvoyé : pas d\'appel inutile tant que les volumes sont les mêmes', async () => {
    const { client } = await inRoom({ bob: corridor(8) });
    const calls = client.volumeCalls;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(client.volumeCalls).toBe(calls);
  });

  test('hors conversation, ou sans carte : rien, et personne n\'est masqué', async () => {
    const client = new FakeMediaClient();
    const hook = renderHook(() => useSpatialAudio(client, client.getSnapshot()));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(client.volumeCalls).toBe(0);
    expect(hook.result.current.size).toBe(0);

    // En conversation mais le jeu n'a pas encore posé la carte.
    await act(() => client.join({ url: 'wss://livekit.test', room: 'r1', token: 't' }));
    act(() => client.addRemote({ id: 'bob' }));
    hook.rerender();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(client.volumeCalls).toBe(0);
  });

  test('quitter la conversation démasque tout le monde', async () => {
    const { client, hook, refresh } = await inRoom({ zoe: corridor(40) });
    expect(hook.result.current.size).toBe(1);
    await act(() => client.leave());
    refresh();
    expect(hook.result.current.size).toBe(0);
  });

  test('un état d\'activité où l\'on n\'entend pas : tout le monde à 0, mais les vignettes proches restent', async () => {
    const { client, hook } = await inRoom({ bob: corridor(8) });
    expect(client.volumes).toEqual({ bob: 1 });
    act(() => useOfficeStore.getState().setActivity('moi', { id: 's', label: 'Sourd', color: '#000000', allowEntry: true, hear: false, heard: true }));
    act(() => {
      vi.advanceTimersByTime(1000 / SPATIAL_AUDIO_HZ);
    });
    expect(client.volumes).toEqual({ bob: 0 });
    expect(hook.result.current.size).toBe(0);   // bob est proche : on le voit, on ne l'entend pas
    act(() => useOfficeStore.getState().setActivity('moi', null));
    act(() => {
      vi.advanceTimersByTime(1000 / SPATIAL_AUDIO_HZ);
    });
    expect(client.volumes).toEqual({ bob: 1 });
  });

  test('une conversation verrouillée : ses membres à plein volume, leur vignette reste, où qu\'ils aillent ; déverrouillée, la distance reprend', async () => {
    const { client, hook } = await inRoom({ bob: corridor(40) });
    expect(client.volumes).toEqual({ bob: 0 });
    act(() => useOfficeStore.getState().setConversationLock({ id: 'g1', members: ['bob', 'moi'], by: { id: 'moi', name: 'moi' }, at: 0 }));
    act(() => {
      vi.advanceTimersByTime(1000 / SPATIAL_AUDIO_HZ);
    });
    expect(client.volumes).toEqual({ bob: 1 });
    expect(hook.result.current.size).toBe(0);
    act(() => useOfficeStore.getState().setConversationLock(null));
    act(() => {
      vi.advanceTimersByTime(1000 / SPATIAL_AUDIO_HZ);
    });
    expect(client.volumes).toEqual({ bob: 0 });
  });

  test('un seuil d\'inaudible : en dessous de AUDIBLE_GAIN', () => {
    expect(AUDIBLE_GAIN).toBeGreaterThan(0);
    expect(AUDIBLE_GAIN).toBeLessThan(0.1);
  });
});
