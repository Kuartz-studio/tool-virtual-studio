import {
  CHARACTER_PARTS,
  CLOSE_RANGE_GROUPING,
  DEV_OFFICE,
  EMPTY_GROUPING,
  OFFICE_ROOM,
  SIM_BOT_PREFIX,
  SIM_BOT_SPEED_PX_PER_S,
  buildTiledMap,
  computeGroups,
  isAvatarKey,
  isWalkablePoint,
  parseOfficeMap,
  type GroupingState,
  type SimRoomPayload,
} from '@bureau/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TypedServer, TypedSocket } from '../src/realtime/io';
import { World } from '../src/realtime/world';
import type { AudioLibrary } from '../src/sim/audio-library';
import { SIM_STEP_MS, SimBots, SimError } from '../src/sim/bots';
import { captureLogs } from './helpers/logs';

// La carte de développement : 24 × 16 cases de 32 px. L'apparition est en (80, 240), dans l'open space ; la salle de réunion (zone
// privée) va des cases 8 à 13 sur les lignes 1 à 4 ; les portes du mur de la ligne 5 sont aux colonnes 3, 10 et 18.
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const SPAWN = { x: 80, y: 240 };
const IN_ROOM = { x: 336, y: 80 };

interface Emitted {
  room: string;
  event: string;
  payload: unknown;
}

// Un monde, une horloge à la main (avancée avec les minuteurs factices), un « io » qui retient ce qu'il diffuse, et des sockets
// factices pour les personnes réelles (id → sockets).
function setup() {
  const clock = { t: 0 };
  const world = new World(map, () => clock.t);
  const emitted: Emitted[] = [];
  const io = { to: (room: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }) }) } as unknown as TypedServer;
  const sockets = new Map<string, TypedSocket[]>();
  const files = new Set(['voix.mp3', 'autre.wav']);
  const audio: AudioLibrary = {
    dir: '/inutile',
    list: async () => [],
    has: async (file) => files.has(file),
    save: async () => {
      throw new Error('non utilisé');
    },
  };
  const { logger } = captureLogs();
  const bots = new SimBots({
    world,
    io,
    map,
    now: () => clock.t,
    logger,
    audio,
    roomFor: (groupId) => `boot-${groupId}`,
    enteredSockets: (userId) => sockets.get(userId) ?? [],
  });

  // Une personne réelle, au monde, avec une socket factice qui retient ses `sim:room`.
  function addUser(id: string, at = SPAWN) {
    world.join({ id, name: `Nom de ${id}`, avatarKey: 'p.01', x: at.x, y: at.y, dir: 'down', status: 'available' });
    const received: SimRoomPayload[] = [];
    const socket = { emit: vi.fn((event: string, payload: SimRoomPayload) => event === 'sim:room' && received.push(payload)) } as unknown as TypedSocket;
    sockets.set(id, [socket]);
    return { socket, received };
  }

  // Fait avancer le temps de `ms`, un pas à la fois (le minuteur des pas est factice, l'horloge du monde aussi).
  function advance(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += SIM_STEP_MS) {
      clock.t += SIM_STEP_MS;
      vi.advanceTimersByTime(SIM_STEP_MS);
    }
  }

  // Les groupes recalculés à l'heure donnée, et annoncés comme le fait startGroupTicks.
  let grouping: GroupingState = EMPTY_GROUPING;
  function regroup() {
    grouping = computeGroups(world.proximityPlayers(), map, grouping, clock.t, CLOSE_RANGE_GROUPING);
    bots.onGroups(grouping);
    return grouping;
  }

  return { clock, world, emitted, bots, addUser, advance, regroup, sockets };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('apparition', () => {
  test('une personne fictive entre au monde comme une vraie : player:joined à tout le bureau, avatar, nom numéroté', async () => {
    const { bots, world, emitted } = setup();
    const bot = await bots.spawn();
    expect(bot.id.startsWith(SIM_BOT_PREFIX)).toBe(true);
    expect(bot.name).toBe('Fictif 1');
    expect(bot.avatarKey).toBe('p.01');
    expect(bot.audio).toBeNull();
    expect(world.get(bot.id)).toMatchObject({ name: 'Fictif 1', status: 'available', moving: false, media: { mic: false, cam: false, screen: false } });
    expect(isWalkablePoint(map, bot.x, bot.y)).toBe(true);
    expect(emitted).toEqual([{ room: OFFICE_ROOM, event: 'player:joined', payload: expect.objectContaining({ id: bot.id, name: 'Fictif 1' }) }]);

    const second = await bots.spawn();
    expect(second.name).toBe('Fictif 2');
    expect(second.avatarKey).toBe('p.02');
    expect(second.id).not.toBe(bot.id);
  });

  test('leurs avatars sont les personnages prêts à l\'emploi du pack, l\'un après l\'autre, puis ça recommence', async () => {
    const { bots } = setup();
    const keys: string[] = [];
    for (let i = 0; i < CHARACTER_PARTS.premade + 1; i++) keys.push((await bots.spawn()).avatarKey);
    expect(keys.every(isAvatarKey)).toBe(true);
    expect(keys.slice(0, 3)).toEqual(['p.01', 'p.02', 'p.03']);
    expect(new Set(keys.slice(0, CHARACTER_PARTS.premade)).size).toBe(CHARACTER_PARTS.premade);
    expect(keys.at(-1)).toBe('p.01');
  });

  test('chacune apparaît sur une case libre, près de l\'apparition, jamais sur quelqu\'un', async () => {
    const { bots, addUser } = setup();
    addUser('moi', SPAWN);
    const spots: Array<[number, number]> = [[SPAWN.x, SPAWN.y]];
    for (let i = 0; i < 6; i++) {
      const bot = await bots.spawn();
      expect(isWalkablePoint(map, bot.x, bot.y)).toBe(true);
      expect(Math.hypot(bot.x - SPAWN.x, bot.y - SPAWN.y)).toBeLessThanOrEqual(3 * 32);
      // Pas sur une case voisine : un personnage fait deux cases de haut, et cacherait celui d'à côté.
      for (const [x, y] of spots) expect(Math.hypot(bot.x - x, bot.y - y)).toBeGreaterThanOrEqual(44);
      spots.push([bot.x, bot.y]);
    }
  });

  test('un nom donné est gardé ; un fichier audio doit exister, et allume le micro', async () => {
    const { bots, world, emitted } = setup();
    const bot = await bots.spawn({ name: 'Léa', audio: 'voix.mp3' });
    expect(bot).toMatchObject({ name: 'Léa', audio: 'voix.mp3' });
    expect(world.get(bot.id)!.media).toEqual({ mic: true, cam: false, screen: false });
    expect(emitted[0]!.payload).toMatchObject({ media: { mic: true, cam: false, screen: false } });
    await expect(bots.spawn({ audio: 'absent.mp3' })).rejects.toMatchObject({ code: 'unknown_audio' });
    expect(world.list()).toHaveLength(1);
  });
});

describe('retrait et fichier audio', () => {
  test('retirer : elle sort du monde, player:left à tout le bureau ; un identifiant inconnu → unknown_bot', async () => {
    const { bots, world, emitted } = setup();
    const bot = await bots.spawn();
    emitted.length = 0;
    bots.remove(bot.id);
    expect(world.get(bot.id)).toBeUndefined();
    expect(bots.list()).toEqual([]);
    expect(emitted).toEqual([{ room: OFFICE_ROOM, event: 'player:left', payload: { id: bot.id } }]);
    expect(() => bots.remove(bot.id)).toThrow(SimError);
    expect(() => bots.remove('quelquun')).toThrow(expect.objectContaining({ code: 'unknown_bot' }));
  });

  test('changer de fichier : le micro suit, media:changed à tout le bureau ; null → silence', async () => {
    const { bots, world, emitted } = setup();
    const bot = await bots.spawn();
    emitted.length = 0;
    expect((await bots.setAudio(bot.id, 'voix.mp3')).audio).toBe('voix.mp3');
    expect(world.get(bot.id)!.media.mic).toBe(true);
    expect(emitted).toEqual([{ room: OFFICE_ROOM, event: 'media:changed', payload: { id: bot.id, media: { mic: true, cam: false, screen: false } } }]);
    expect((await bots.setAudio(bot.id, null)).audio).toBeNull();
    expect(world.get(bot.id)!.media.mic).toBe(false);
    await expect(bots.setAudio(bot.id, 'absent.mp3')).rejects.toMatchObject({ code: 'unknown_audio' });
    await expect(bots.setAudio('quelquun', null)).rejects.toMatchObject({ code: 'unknown_bot' });
  });
});

describe('marche', () => {
  test('elle marche vers sa cible, sans se téléporter, à sa vitesse, et s\'arrête (moving false) au point visé', async () => {
    const { bots, world, advance } = setup();
    const bot = await bots.spawn();
    const from = { x: bot.x, y: bot.y };
    bots.start();
    const target = bots.moveTo(bot.id, 400, 250);
    expect(target).toEqual({ x: 400, y: 250 });
    expect(bots.list()[0]!.target).toEqual({ x: 400, y: 250 });

    let previous = from;
    let steps = 0;
    const distance = Math.hypot(400 - from.x, 250 - from.y);
    while (world.get(bot.id)!.moving || steps === 0) {
      advance(SIM_STEP_MS);
      const now = world.get(bot.id)!;
      // Jamais plus loin en un pas que sa vitesse ne le permet (à l'arrondi près), jamais dans un mur.
      expect(Math.hypot(now.x - previous.x, now.y - previous.y)).toBeLessThanOrEqual((SIM_BOT_SPEED_PX_PER_S * SIM_STEP_MS) / 1000 + 1.5);
      expect(isWalkablePoint(map, now.x, now.y)).toBe(true);
      previous = { x: now.x, y: now.y };
      steps++;
      expect(steps).toBeLessThan(400);
    }
    const arrived = world.get(bot.id)!;
    expect(arrived).toMatchObject({ x: 400, y: 250, moving: false });
    // Le temps de marche est celui de la distance à la vitesse de marche (au pas près), et non un saut.
    expect(steps * SIM_STEP_MS).toBeGreaterThanOrEqual((distance / SIM_BOT_SPEED_PX_PER_S) * 1000 - SIM_STEP_MS);
    expect(steps).toBeGreaterThan(10);
    expect(bots.list()[0]!.target).toBeNull();
    bots.stop();
  });

  test('d\'une pièce à l\'autre : par la porte, chaque pas accepté par le monde', async () => {
    const { bots, world, advance } = setup();
    const bot = await bots.spawn();
    bots.start();
    bots.moveTo(bot.id, IN_ROOM.x, IN_ROOM.y);
    const crossed = new Set<number>();
    for (let i = 0; i < 600 && (world.get(bot.id)!.moving || i === 0); i++) {
      advance(SIM_STEP_MS);
      const { x, y } = world.get(bot.id)!;
      expect(isWalkablePoint(map, x, y)).toBe(true);
      if (Math.floor(y / 32) === 5) crossed.add(Math.floor(x / 32));
    }
    expect(world.get(bot.id)).toMatchObject({ x: IN_ROOM.x, y: IN_ROOM.y, moving: false });
    expect([...crossed].every((column) => [3, 10, 18].includes(column))).toBe(true);
    expect(crossed.size).toBeGreaterThan(0);
    bots.stop();
  });

  test('elle regarde où elle va (direction du pas)', async () => {
    const { bots, world, advance } = setup();
    const bot = await bots.spawn();
    bots.start();
    bots.moveTo(bot.id, 400, 240);
    advance(SIM_STEP_MS * 2);
    expect(world.get(bot.id)!.dir).toBe('right');
    bots.moveTo(bot.id, 80, 240);
    advance(SIM_STEP_MS * 2);
    expect(world.get(bot.id)!.dir).toBe('left');
    bots.stop();
  });

  test('une nouvelle cible en chemin remplace la première, depuis l\'endroit où elle est', async () => {
    const { bots, world, advance } = setup();
    const bot = await bots.spawn();
    bots.start();
    bots.moveTo(bot.id, 600, 240);
    advance(1000);
    const mid = world.get(bot.id)!;
    expect(mid.moving).toBe(true);
    expect(mid.x).toBeGreaterThan(120);
    bots.moveTo(bot.id, 200, 400);
    expect(bots.list()[0]!.target).toEqual({ x: 200, y: 400 });
    advance(8000);
    expect(world.get(bot.id)).toMatchObject({ x: 200, y: 400, moving: false });
    bots.stop();
  });

  test('un point dans un mur : elle va au plus près, et le point d\'arrêt le dit', async () => {
    const { bots } = setup();
    const bot = await bots.spawn();
    const stop = bots.moveTo(bot.id, 400, 170);   // dans le mur de la ligne 5
    expect(isWalkablePoint(map, stop.x, stop.y)).toBe(true);
    expect(bots.list()[0]!.target).toEqual(stop);
    expect(() => bots.moveTo('quelquun', 1, 1)).toThrow(expect.objectContaining({ code: 'unknown_bot' }));
  });

  test('un long retard du serveur : elle reprend sa marche sans sauter', async () => {
    const { bots, world, clock } = setup();
    const bot = await bots.spawn();
    bots.start();
    bots.moveTo(bot.id, 600, 240);
    // Le serveur est resté bloqué 5 s : un seul pas, qui ne compte que 250 ms de marche au plus.
    clock.t += 5000;
    vi.advanceTimersByTime(SIM_STEP_MS);
    const { x } = world.get(bot.id)!;
    expect(x - bot.x).toBeLessThanOrEqual(SIM_BOT_SPEED_PX_PER_S * 0.25 + 1.5);
    bots.stop();
  });

  test('arrêter le faux live fait partir les personnes fictives', async () => {
    const { bots, world, emitted } = setup();
    const a = await bots.spawn();
    const b = await bots.spawn();
    bots.start();
    emitted.length = 0;
    bots.stop();
    expect(world.list()).toEqual([]);
    expect(emitted.map((e) => e.payload)).toEqual([{ id: a.id }, { id: b.id }]);
  });
});

describe('le son : ce que chaque personne réelle entend', () => {
  // Deux personnes arrêtées à moins de 3 cases se parlent au bout de 500 ms : le vrai calcul des groupes, sur le vrai monde.
  async function talking() {
    const s = setup();
    const user = s.addUser('moi');
    const bot = await s.bots.spawn({ audio: 'voix.mp3' });
    s.regroup();
    s.clock.t += 600;
    const state = s.regroup();
    return { ...s, user, bot, state };
  }

  test('dans un groupe avec une personne fictive : sa room, qui est dedans, et l\'adresse de son fichier', async () => {
    const { user, bot, state } = await talking();
    const group = Object.values(state.groups)[0]!;
    expect(group.members).toEqual(['moi', bot.id].sort());
    expect(user.received).toEqual([
      {
        room: `boot-${group.id}`,
        members: group.members.map((id) =>
          id === 'moi' ? { id: 'moi', name: 'Nom de moi', audio: null } : { id: bot.id, name: 'Fictif 1', audio: '/api/sim/audio/voix.mp3' },
        ),
      },
    ]);
  });

  test('le même message n\'est pas redit ; un changement de fichier, si', async () => {
    const { user, bot, bots, regroup } = await talking();
    regroup();
    regroup();
    expect(user.received).toHaveLength(1);
    await bots.setAudio(bot.id, 'autre.wav');
    expect(user.received).toHaveLength(2);
    expect(user.received[1]!.members.find((m) => m.id === bot.id)!.audio).toBe('/api/sim/audio/autre.wav');
    await bots.setAudio(bot.id, null);
    expect(user.received[2]!.members.find((m) => m.id === bot.id)!.audio).toBeNull();
    expect(user.received).toHaveLength(3);
  });

  test('une personne fictive retirée n\'est plus dans la room, tout de suite', async () => {
    const { user, bot, bots } = await talking();
    bots.remove(bot.id);
    expect(user.received.at(-1)!.members.map((m) => m.id)).toEqual(['moi']);
  });

  test('hors groupe : rien ; et de retour dans un groupe, le message est redit même identique', async () => {
    const { user, bot, bots, world, clock, regroup, advance } = await talking();
    expect(user.received).toHaveLength(1);
    // Elle s'éloigne de plus de 4 cases : le groupe se défait au bout de 500 ms.
    bots.start();
    bots.moveTo(bot.id, 80 + 6 * 32, 240);
    advance(3000);
    regroup();
    clock.t += 600;
    const apart = regroup();
    expect(apart.assignment['moi']).toBeNull();
    expect(user.received).toHaveLength(1);
    // Elle revient dans la minute : le calcul leur rend l'id de leur groupe (sa mémoire), donc la même room, et le même message, redit quand même :
    // la socket, sortie du groupe, l'avait oublié.
    bots.moveTo(bot.id, 80 + 32, 240);
    advance(3000);
    regroup();
    clock.t += 600;
    regroup();
    expect(user.received).toHaveLength(2);
    expect(user.received[1]).toEqual(user.received[0]);
    expect(world.get(bot.id)).toMatchObject({ moving: false });
    bots.stop();
  });

  test('deux personnes fictives dans la salle de réunion : elles s\'entendent sans distance, et la personne dedans les entend toutes', async () => {
    const s = setup();
    const user = s.addUser('moi', IN_ROOM);
    const a = await s.bots.spawn({ name: 'A', audio: 'voix.mp3' });
    const b = await s.bots.spawn({ name: 'B', audio: 'autre.wav' });
    s.bots.start();
    s.bots.moveTo(a.id, 288, 64);   // à l'autre bout de la salle (6 cases de large)
    s.bots.moveTo(b.id, 416, 128);
    s.advance(30_000);
    s.regroup();
    s.clock.t += 600;
    s.regroup();
    const last = user.received.at(-1)!;
    expect(last.members.map((m) => m.name).sort()).toEqual(['A', 'B', 'Nom de moi']);
    expect(last.members.filter((m) => m.audio !== null)).toHaveLength(2);
    s.bots.stop();
  });

  test('une personne fictive seule avec une personne réelle dans l\'open space, mais en marche : pas de groupe tant qu\'elle ne s\'arrête pas', async () => {
    const s = setup();
    const user = s.addUser('moi');
    const bot = await s.bots.spawn({ audio: 'voix.mp3' });
    s.bots.start();
    s.bots.moveTo(bot.id, 80 + 2 * 32, 240 + 32);
    s.regroup();
    s.advance(100);
    s.clock.t += 600;
    s.regroup();
    expect(s.world.get(bot.id)!.moving).toBe(true);
    s.advance(2000);
    expect(s.world.get(bot.id)!.moving).toBe(false);
    s.regroup();
    s.clock.t += 600;
    s.regroup();
    expect(user.received).toHaveLength(1);
    s.bots.stop();
  });
});
