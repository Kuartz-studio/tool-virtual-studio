import { DEV_OFFICE, MAX_SPEED_PX_PER_S, MOVE_JITTER_MS, NORMAL_MAX_SPEED_PX_PER_S, SPEAKING_TTL_MS, buildTiledMap, parseOfficeMap } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { World } from '../src/realtime/world';

// La carte de développement : 24 × 16 cases de 32 px. L'apparition est en (80, 240), sur la ligne 7 (du sol de bout en bout) ;
// le mur de la ligne 5 (y de 160 à 191) sépare les pièces du haut de l'open space ; les bureaux sont sur la ligne 9.
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));

type JoinArgs = Parameters<World['join']>[0];

// Un monde dont on fait avancer l'horloge à la main (l'heure de réception côté serveur). `join` y fait entrer un joueur, par
// défaut à l'apparition.
function setup() {
  const clock = { t: 0 };
  const world = new World(map, () => clock.t);
  const join = (id: string, over: Partial<JoinArgs> = {}) =>
    world.join({ id, name: `Nom de ${id}`, avatarKey: 'p.01', x: 80, y: 240, dir: 'down', status: 'available', ...over });
  return { clock, world, join };
}

// ---- Les tests de la brief ------------------------------------------------------------------------------------------

test('applyMove accepté puis drainMoves une seule fois', () => {
  const { clock, world, join } = setup();
  join('a');
  clock.t = 100;
  expect(world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true })).toEqual({ ok: true });   // 80 px en 100 ms
  expect(world.drainMoves()).toEqual([{ id: 'a', x: 160, y: 240, dir: 'right', moving: true }]);
  expect(world.drainMoves()).toEqual([]);
});

test('deux mouvements → seul le dernier sort', () => {
  const { clock, world, join } = setup();
  join('a');
  clock.t = 100;
  expect(world.applyMove('a', { x: 120, y: 240, dir: 'right', moving: true })).toEqual({ ok: true });
  clock.t = 200;
  expect(world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true })).toEqual({ ok: true });
  expect(world.drainMoves()).toEqual([{ id: 'a', x: 160, y: 240, dir: 'right', moving: true }]);
  expect(world.drainMoves()).toEqual([]);
});

test('mouvement refusé → correct = dernière position acceptée', () => {
  const { clock, world, join } = setup();
  join('a');
  clock.t = 100;
  // 253 px en 100 ms : trop rapide, même en courant. Le joueur n'a jamais bougé : sa dernière position acceptée est son arrivée.
  expect(world.applyMove('a', { x: 333, y: 240, dir: 'right', moving: true })).toEqual({ ok: false, correct: { x: 80, y: 240 } });
  // Après un mouvement accepté, c'est celui-là.
  expect(world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true })).toEqual({ ok: true });
  clock.t = 200;
  expect(world.applyMove('a', { x: 413, y: 240, dir: 'right', moving: true })).toEqual({ ok: false, correct: { x: 160, y: 240 } });
});

test('statut retenu après leave puis join', () => {
  const { world, join } = setup();
  join('a');
  world.setStatus('a', 'dnd');
  expect(world.leave('a')).toMatchObject({ id: 'a', status: 'dnd' });
  expect(world.get('a')).toBeUndefined();
  expect(world.rememberedStatus('a')).toBe('dnd');
  expect(join('a', { status: world.rememberedStatus('a') }).status).toBe('dnd');
  expect(world.get('a')?.status).toBe('dnd');
});

// ---- Arrivée, départ, lecture ---------------------------------------------------------------------------------------------

describe('join, leave, get, list', () => {
  test('join : le joueur arrive à l\'arrêt, sans micro, sans caméra et sans partage d\'écran', () => {
    const { join } = setup();
    expect(join('a', { x: 336, y: 80, dir: 'up', status: 'busy' })).toEqual({
      id: 'a',
      name: 'Nom de a',
      avatarKey: 'p.01',
      x: 336,
      y: 80,
      dir: 'up',
      moving: false,
      status: 'busy',
      media: { mic: false, cam: false, screen: false },
      activity: null,
      timezone: 'Europe/Paris',
    });
  });

  test('join : le fuseau horaire donné, sinon celui de Paris', () => {
    const { join } = setup();
    expect(join('a', { timezone: 'Asia/Tokyo' }).timezone).toBe('Asia/Tokyo');
    expect(join('b').timezone).toBe('Europe/Paris');
  });

  test('join accepte un joueur sans avatar choisi (avatarKey: null)', () => {
    const { join } = setup();
    expect(join('a', { avatarKey: null }).avatarKey).toBeNull();
  });

  test('get et list : le joueur, ou undefined ; tous les joueurs dans l\'ordre d\'arrivée', () => {
    const { world, join } = setup();
    expect(world.list()).toEqual([]);
    expect(world.get('a')).toBeUndefined();
    const a = join('a');
    const b = join('b', { x: 400, y: 400 });
    const c = join('c', { x: 600, y: 240 });
    expect(world.get('b')).toEqual(b);
    expect(world.list()).toEqual([a, b, c]);
    world.leave('b');
    expect(world.list().map((p) => p.id)).toEqual(['a', 'c']);
    join('b');
    expect(world.list().map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });

  test('join, get et list renvoient des copies : les modifier ne change pas le monde, et le monde ne change pas ce qu\'on tient', () => {
    const { clock, world, join } = setup();
    const joined = join('a');
    joined.x = 999;
    joined.media.mic = true;
    world.get('a')!.name = 'Autre';
    world.list()[0]!.media.cam = true;
    expect(world.get('a')).toMatchObject({ x: 80, name: 'Nom de a', media: { mic: false, cam: false, screen: false } });

    const before = world.get('a')!;
    clock.t = 100;
    world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true });
    world.setStatus('a', 'away');
    world.setMedia('a', { mic: true, cam: true, screen: true });
    expect(before).toMatchObject({ x: 80, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } });
  });

  test('leave : renvoie le joueur parti, tel qu\'il était, et le retire ; un inconnu → undefined', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true });
    expect(world.leave('a')).toMatchObject({ id: 'a', x: 160, y: 240, dir: 'right', moving: true });
    expect(world.get('a')).toBeUndefined();
    expect(world.list()).toEqual([]);
    expect(world.leave('a')).toBeUndefined();
    expect(world.leave('inconnu')).toBeUndefined();
  });

  test('un second join du même identifiant remplace le joueur (et son mouvement en attente)', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true });
    join('a', { x: 400, y: 400, dir: 'up' });
    expect(world.list()).toHaveLength(1);
    expect(world.get('a')).toMatchObject({ x: 400, y: 400, dir: 'up', moving: false });
    expect(world.drainMoves()).toEqual([]);
  });
});

// ---- applyMove ------------------------------------------------------------------------------------------------------------

describe('applyMove', () => {
  test('un mouvement accepté met à jour la position, la direction et l\'état « en marche » du joueur', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.applyMove('a', { x: 120, y: 240, dir: 'right', moving: true });
    expect(world.get('a')).toMatchObject({ x: 120, y: 240, dir: 'right', moving: true });
    clock.t = 200;
    world.applyMove('a', { x: 120, y: 240, dir: 'right', moving: false });   // l'arrêt
    expect(world.get('a')).toMatchObject({ x: 120, y: 240, dir: 'right', moving: false });
  });

  test('l\'heure de départ est celle de join, lue sur l\'horloge du serveur', () => {
    const { clock, world, join } = setup();
    clock.t = 5_000;
    join('a');
    clock.t = 5_100;
    // 100 ms après join : 252 px permis. Si l'heure de départ était 0, plus de 3 600 px le seraient.
    expect(world.applyMove('a', { x: 333, y: 240, dir: 'right', moving: true })).toEqual({ ok: false, correct: { x: 80, y: 240 } });
    expect(world.applyMove('a', { x: 332, y: 240, dir: 'right', moving: true })).toEqual({ ok: true });
  });

  test('un mouvement accepté remet l\'heure de référence à jour : le suivant, au même instant, n\'a que la marge de gigue (180 px)', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    expect(world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true })).toEqual({ ok: true });
    // Même instant : dt = 0, donc 180 px au plus. Si l'heure de référence était restée celle de join (0), 252 px passeraient.
    expect(world.applyMove('a', { x: 341, y: 240, dir: 'right', moving: true })).toEqual({ ok: false, correct: { x: 160, y: 240 } });
    expect(world.applyMove('a', { x: 340, y: 240, dir: 'right', moving: true })).toEqual({ ok: true });
  });

  test('un mouvement refusé ne change ni la position, ni la direction, ni l\'heure de référence', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    expect(world.applyMove('a', { x: 333, y: 240, dir: 'right', moving: true })).toEqual({ ok: false, correct: { x: 80, y: 240 } });   // 253 px
    expect(world.get('a')).toMatchObject({ x: 80, y: 240, dir: 'down', moving: false });
    expect(world.drainMoves()).toEqual([]);
    // La même position, 100 ms plus tard : 200 ms depuis join, donc 324 px permis. Elle ne passerait pas si le refus avait
    // remis l'heure de référence à 100.
    clock.t = 200;
    expect(world.applyMove('a', { x: 333, y: 240, dir: 'right', moving: true })).toEqual({ ok: true });
  });

  test('un mouvement refusé n\'efface pas le mouvement accepté de la même fenêtre', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true });
    clock.t = 150;
    expect(world.applyMove('a', { x: 500, y: 240, dir: 'right', moving: true })).toEqual({ ok: false, correct: { x: 160, y: 240 } });
    expect(world.drainMoves()).toEqual([{ id: 'a', x: 160, y: 240, dir: 'right', moving: true }]);
  });

  test('un mur sur le trajet : refusé, correct = dernière position acceptée', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 400;   // 156 px permis ; (80, 100) est à 140 px mais de l'autre côté du mur de la ligne 5
    expect(world.applyMove('a', { x: 80, y: 100, dir: 'up', moving: true })).toEqual({ ok: false, correct: { x: 80, y: 240 } });
  });

  test('hors carte : refusé', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 10_000;
    expect(world.applyMove('a', { x: -10, y: 240, dir: 'left', moving: true })).toEqual({ ok: false, correct: { x: 80, y: 240 } });
  });

  test('un joueur inconnu : refusé sans erreur, avec le point d\'apparition pour « correct », et rien n\'est enregistré', () => {
    const { world } = setup();
    expect(world.applyMove('fantome', { x: 90, y: 240, dir: 'right', moving: true })).toEqual({ ok: false, correct: { x: 80, y: 240 } });
    expect(world.get('fantome')).toBeUndefined();
    expect(world.drainMoves()).toEqual([]);
  });

  test('« correct » est un objet neuf : le modifier ne change pas le monde', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    const refused = world.applyMove('a', { x: 333, y: 240, dir: 'right', moving: true });
    if (refused.ok) throw new Error('le mouvement aurait dû être refusé');
    refused.correct.x = 1;
    expect(world.get('a')?.x).toBe(80);
    const unknown = world.applyMove('fantome', { x: 90, y: 240, dir: 'right', moving: true });
    if (unknown.ok) throw new Error('le mouvement aurait dû être refusé');
    unknown.correct.x = 1;
    expect(map.spawn).toEqual({ x: 80, y: 240 });
  });
});

// ---- teleport -------------------------------------------------------------------------------------------------------------

describe('teleport', () => {
  test('une case praticable : le joueur y est, à l\'arrêt, et le prochain drainMoves le dit', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.applyMove('a', { x: 120, y: 240, dir: 'right', moving: true });
    world.drainMoves();
    expect(world.teleport('a', 400, 400)).toBe(true);
    expect(world.get('a')).toMatchObject({ x: 400, y: 400, dir: 'right', moving: false });
    expect(world.drainMoves()).toEqual([{ id: 'a', x: 400, y: 400, dir: 'right', moving: false, tp: true }]);
    expect(world.drainMoves()).toEqual([]);
  });

  test('après un mouvement accepté dans la même fenêtre, seule la téléportation sort', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.applyMove('a', { x: 120, y: 240, dir: 'right', moving: true });
    world.teleport('a', 400, 400);
    expect(world.drainMoves()).toEqual([{ id: 'a', x: 400, y: 400, dir: 'right', moving: false, tp: true }]);
  });

  test.each([
    ['un mur', 16, 16],
    ['un bureau', 144, 304],
    ['hors de la carte', -10, 240],
    ['au-delà du bord droit', 768, 240],
    ['x = NaN', Number.NaN, 240],
  ])('%s : false, et rien ne change', (_name, x, y) => {
    const { world, join } = setup();
    join('a');
    expect(world.teleport('a', x, y)).toBe(false);
    expect(world.get('a')).toMatchObject({ x: 80, y: 240 });
    expect(world.drainMoves()).toEqual([]);
  });

  test('un joueur inconnu : false', () => {
    const { world } = setup();
    expect(world.teleport('fantome', 400, 400)).toBe(false);
    expect(world.drainMoves()).toEqual([]);
  });

  test('la nouvelle position et l\'heure deviennent la référence des mouvements suivants', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 1_000;
    expect(world.teleport('a', 400, 400)).toBe(true);
    // Au même instant que la téléportation, dt = 0 : 180 px au plus depuis (400, 400). Si l'heure de référence était restée celle
    // de join (1 000 ms plus tôt), 900 px seraient permis, et (581, 400) n'est qu'à 181 px.
    expect(world.applyMove('a', { x: 581, y: 400, dir: 'right', moving: true })).toEqual({ ok: false, correct: { x: 400, y: 400 } });
    expect(world.applyMove('a', { x: 580, y: 400, dir: 'right', moving: true })).toEqual({ ok: true });
  });
});

describe('teleport : le mouvement est marqué `tp` pour que les autres sautent au lieu de glisser', () => {
  test('un mouvement ordinaire ne porte pas de `tp`', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true });
    expect(world.drainMoves()[0]).not.toHaveProperty('tp');
  });

  test('un mouvement accepté après la téléportation, dans la même fenêtre, la garde : les autres la voient toujours comme une téléportation', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.teleport('a', 400, 400);
    clock.t = 200;
    expect(world.applyMove('a', { x: 420, y: 400, dir: 'right', moving: true })).toEqual({ ok: true });
    expect(world.drainMoves()).toEqual([{ id: 'a', x: 420, y: 400, dir: 'right', moving: true, tp: true }]);
    // La fenêtre suivante repart de zéro : le mouvement d'après est ordinaire.
    clock.t = 300;
    world.applyMove('a', { x: 440, y: 400, dir: 'right', moving: true });
    expect(world.drainMoves()[0]).not.toHaveProperty('tp');
  });
});

// ---- Le café -----------------------------------------------------------------------------------------------------------------

describe('le café : la limite de vitesse du joueur passe de 480 à 960 px/s', () => {
  test('sans café, 500 px en 100 ms sont refusés ; sous café, ils passent (504 px au plus)', () => {
    const { clock, world, join } = setup();
    join('a');
    join('b');
    world.setBoost('a', 30_000);
    clock.t = 100;
    expect(world.applyMove('b', { x: 580, y: 240, dir: 'right', moving: true })).toEqual({ ok: false, correct: { x: 80, y: 240 } });
    expect(world.applyMove('a', { x: 580, y: 240, dir: 'right', moving: true })).toEqual({ ok: true });
  });

  test('maxSpeedOf : 960 sous café, 480 sinon, et un inconnu n\'a pas de café', () => {
    const { world, join } = setup();
    join('a');
    expect(world.maxSpeedOf('a')).toBe(NORMAL_MAX_SPEED_PX_PER_S);
    world.setBoost('a', 30_000);
    expect(world.maxSpeedOf('a')).toBe(MAX_SPEED_PX_PER_S);
    expect(world.maxSpeedOf('fantome')).toBe(NORMAL_MAX_SPEED_PX_PER_S);
  });

  test('la limite normale revient MOVE_JITTER_MS après la fin du café : les derniers paquets en retard passent encore', () => {
    const { clock, world, join } = setup();
    join('a');
    world.setBoost('a', 1_000);   // jusqu'à t = 1 000
    clock.t = 1_000 + MOVE_JITTER_MS;
    expect(world.maxSpeedOf('a')).toBe(MAX_SPEED_PX_PER_S);
    clock.t = 1_000 + MOVE_JITTER_MS + 1;
    expect(world.maxSpeedOf('a')).toBe(NORMAL_MAX_SPEED_PX_PER_S);
  });

  test('un nouveau café remet le compte à zéro ; setBoost(id, null) l\'éteint tout de suite', () => {
    const { clock, world, join } = setup();
    join('a');
    world.setBoost('a', 1_000);
    clock.t = 900;
    world.setBoost('a', 1_000);   // jusqu'à t = 1 900
    clock.t = 1_500;
    expect(world.maxSpeedOf('a')).toBe(MAX_SPEED_PX_PER_S);
    world.setBoost('a', null);
    expect(world.maxSpeedOf('a')).toBe(NORMAL_MAX_SPEED_PX_PER_S);
  });

  test('un joueur qui part perd son café, il ne le retrouve pas en revenant', () => {
    const { world, join } = setup();
    join('a');
    world.setBoost('a', 30_000);
    world.leave('a');
    join('a');
    expect(world.maxSpeedOf('a')).toBe(NORMAL_MAX_SPEED_PX_PER_S);
  });

  test('boostRemaining : ce qu\'il reste de café en ms, 0 sans café, une fois fini, ou pour un inconnu', () => {
    const { clock, world, join } = setup();
    join('a');
    expect(world.boostRemaining('a')).toBe(0);
    world.setBoost('a', 30_000);
    expect(world.boostRemaining('a')).toBe(30_000);
    clock.t = 12_500;
    expect(world.boostRemaining('a')).toBe(17_500);
    clock.t = 30_000;
    expect(world.boostRemaining('a')).toBe(0);
    clock.t = 45_000;
    expect(world.boostRemaining('a')).toBe(0);
    expect(world.boostRemaining('fantome')).toBe(0);
  });

  test('expireBoosts rend ceux dont le café vient de finir, une seule fois, et garde la limite du café MOVE_JITTER_MS de plus', () => {
    const { clock, world, join } = setup();
    join('a');
    join('b');
    world.setBoost('a', 1_000);
    world.setBoost('b', 5_000);
    clock.t = 999;
    expect(world.expireBoosts()).toEqual([]);
    clock.t = 1_000;
    expect(world.expireBoosts()).toEqual(['a']);
    expect(world.expireBoosts()).toEqual([]);   // une seule fois
    // Fini pour tout le monde, mais les derniers paquets arrivent en retard : la limite du café tient encore.
    expect(world.maxSpeedOf('a')).toBe(MAX_SPEED_PX_PER_S);
    clock.t = 1_000 + MOVE_JITTER_MS + 1;
    expect(world.maxSpeedOf('a')).toBe(NORMAL_MAX_SPEED_PX_PER_S);
    expect(world.expireBoosts()).toEqual([]);
    expect(world.maxSpeedOf('b')).toBe(MAX_SPEED_PX_PER_S);
    clock.t = 5_000;
    expect(world.expireBoosts()).toEqual(['b']);
  });

  test('un nouveau café après la fin s\'éteindra à son tour, et celui qu\'on retire avec null ne se redit pas', () => {
    const { clock, world, join } = setup();
    join('a');
    join('b');
    world.setBoost('a', 1_000);
    clock.t = 1_000;
    expect(world.expireBoosts()).toEqual(['a']);
    world.setBoost('a', 1_000);   // un autre café : jusqu'à t = 2 000
    clock.t = 1_999;
    expect(world.expireBoosts()).toEqual([]);
    clock.t = 2_000;
    expect(world.expireBoosts()).toEqual(['a']);
    world.setBoost('b', 10_000);
    world.setBoost('b', null);   // retiré à la main : l'appelant le dit lui-même, expireBoosts n'a rien à ajouter
    clock.t = 20_000;
    expect(world.expireBoosts()).toEqual([]);
  });

  test('get et list disent le café en cours (boost, ce qu\'il en reste en ms) et rien pour les autres', () => {
    const { clock, world, join } = setup();
    join('a');
    join('b');
    world.setBoost('a', 30_000);
    clock.t = 10_000;
    expect(world.get('a')?.boost).toBe(20_000);
    expect(world.get('b')).not.toHaveProperty('boost');
    expect(world.list().map((p) => [p.id, p.boost])).toEqual([['a', 20_000], ['b', undefined]]);
    clock.t = 30_000;
    expect(world.get('a')).not.toHaveProperty('boost');
    // join rend le joueur tel qu'il arrive : jamais avec un café, même si l'identifiant en avait un avant de partir.
    world.setBoost('b', 30_000);
    world.leave('b');
    expect(join('b')).not.toHaveProperty('boost');
  });
});

// ---- Statut, médias, profil ------------------------------------------------------------------------------------------------

describe('statut, médias, profil', () => {
  test('setStatus change le statut du joueur', () => {
    const { world, join } = setup();
    join('a');
    world.setStatus('a', 'busy');
    expect(world.get('a')?.status).toBe('busy');
    world.setStatus('a', 'away');
    expect(world.get('a')?.status).toBe('away');
    expect(world.rememberedStatus('a')).toBe('away');
  });

  test('rememberedStatus : « available » pour un identifiant jamais vu', () => {
    const { world } = setup();
    expect(world.rememberedStatus('jamais-vu')).toBe('available');
  });

  test('le statut donné à join est aussi celui dont le monde se souvient, après leave comme avant', () => {
    const { world, join } = setup();
    join('a', { status: 'busy' });
    expect(world.rememberedStatus('a')).toBe('busy');
    world.leave('a');
    expect(world.rememberedStatus('a')).toBe('busy');
  });

  test('le statut survit à plusieurs départs et retours, et chacun garde le sien', () => {
    const { world, join } = setup();
    join('a');
    join('b');
    world.setStatus('a', 'dnd');
    world.setStatus('b', 'away');
    world.leave('a');
    world.leave('b');
    join('a', { status: world.rememberedStatus('a') });
    expect(world.get('a')?.status).toBe('dnd');
    expect(world.rememberedStatus('b')).toBe('away');
  });

  test('setMedia remplace l\'état du micro, de la caméra et du partage d\'écran', () => {
    const { world, join } = setup();
    join('a');
    world.setMedia('a', { mic: true, cam: false, screen: true });
    expect(world.get('a')?.media).toEqual({ mic: true, cam: false, screen: true });
    world.setMedia('a', { mic: false, cam: false, screen: false });
    expect(world.get('a')?.media).toEqual({ mic: false, cam: false, screen: false });
  });

  test('setMedia garde sa propre copie : modifier l\'objet passé ne change pas le monde', () => {
    const { world, join } = setup();
    join('a');
    const media = { mic: true, cam: true, screen: false };
    world.setMedia('a', media);
    media.mic = false;
    expect(world.get('a')?.media.mic).toBe(true);
  });

  test('setProfile change le nom, l\'avatar et le fuseau horaire (sans fuseau, il garde le sien)', () => {
    const { world, join } = setup();
    join('a');
    world.setProfile('a', { name: 'Alice', avatarKey: 'p.02', timezone: 'America/Montreal' });
    expect(world.get('a')).toMatchObject({ name: 'Alice', avatarKey: 'p.02', timezone: 'America/Montreal' });
    world.setProfile('a', { name: 'Alice B.', avatarKey: null });
    expect(world.get('a')).toMatchObject({ name: 'Alice B.', avatarKey: null, timezone: 'America/Montreal' });
  });

  test('un identifiant inconnu est ignoré sans erreur, et ne crée pas de souvenir', () => {
    const { world } = setup();
    expect(() => {
      world.setStatus('fantome', 'busy');
      world.setMedia('fantome', { mic: true, cam: true, screen: true });
      world.setProfile('fantome', { name: 'X', avatarKey: null });
    }).not.toThrow();
    expect(world.get('fantome')).toBeUndefined();
    expect(world.rememberedStatus('fantome')).toBe('available');
  });
});

// ---- drainMoves et proximityPlayers -----------------------------------------------------------------------------------------

describe('drainMoves', () => {
  test('sans mouvement : []', () => {
    const { world, join } = setup();
    expect(world.drainMoves()).toEqual([]);
    join('a');
    expect(world.drainMoves()).toEqual([]);
  });

  test('un mouvement par joueur : le dernier, dans l\'ordre du premier mouvement accepté de chacun depuis l\'appel précédent', () => {
    const { clock, world, join } = setup();
    join('a');
    join('b');
    join('c');
    clock.t = 100;
    world.applyMove('b', { x: 120, y: 240, dir: 'right', moving: true });
    world.applyMove('a', { x: 80, y: 280, dir: 'down', moving: true });
    clock.t = 200;
    world.applyMove('b', { x: 160, y: 240, dir: 'right', moving: true });
    expect(world.drainMoves()).toEqual([
      { id: 'b', x: 160, y: 240, dir: 'right', moving: true },
      { id: 'a', x: 80, y: 280, dir: 'down', moving: true },
    ]);
    // Une nouvelle fenêtre : seuls ceux qui ont bougé depuis.
    clock.t = 300;
    world.applyMove('c', { x: 100, y: 240, dir: 'right', moving: false });
    expect(world.drainMoves()).toEqual([{ id: 'c', x: 100, y: 240, dir: 'right', moving: false }]);
    expect(world.drainMoves()).toEqual([]);
  });

  test('un joueur parti avant l\'appel n\'y figure plus', () => {
    const { clock, world, join } = setup();
    join('a');
    join('b');
    clock.t = 100;
    world.applyMove('a', { x: 120, y: 240, dir: 'right', moving: true });
    world.applyMove('b', { x: 120, y: 240, dir: 'right', moving: true });
    world.leave('a');
    expect(world.drainMoves()).toEqual([{ id: 'b', x: 120, y: 240, dir: 'right', moving: true }]);
  });

  test('un joueur revenu après son départ n\'a pas le mouvement de sa visite précédente', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.applyMove('a', { x: 120, y: 240, dir: 'right', moving: true });
    world.leave('a');
    join('a');
    expect(world.drainMoves()).toEqual([]);
  });

  test('les objets renvoyés ne sont plus ceux du monde : un appel suivant ne les change pas', () => {
    const { clock, world, join } = setup();
    join('a');
    clock.t = 100;
    world.applyMove('a', { x: 120, y: 240, dir: 'right', moving: true });
    const first = world.drainMoves();
    clock.t = 200;
    world.applyMove('a', { x: 160, y: 240, dir: 'right', moving: true });
    expect(first).toEqual([{ id: 'a', x: 120, y: 240, dir: 'right', moving: true }]);
  });
});

describe('proximityPlayers', () => {
  test('l\'identifiant, la position, l\'état « en marche » et le statut de chacun, dans l\'ordre d\'arrivée, et rien d\'autre', () => {
    const { clock, world, join } = setup();
    expect(world.proximityPlayers()).toEqual([]);
    join('a');
    join('b', { x: 400, y: 400, status: 'busy' });
    clock.t = 100;
    world.applyMove('a', { x: 120, y: 240, dir: 'right', moving: true });
    world.setStatus('a', 'dnd');
    world.setMedia('a', { mic: true, cam: true, screen: false });
    expect(world.proximityPlayers()).toEqual([
      { id: 'a', x: 120, y: 240, moving: true, status: 'dnd', excluded: false },
      { id: 'b', x: 400, y: 400, moving: false, status: 'busy', excluded: false },
    ]);
    // Un état d'activité sans entendre ni être entendu met hors de la conversation ; l'un des deux suffit à y rester.
    const state = { id: 's', label: 'À table', color: '#f59e0b', allowEntry: true, hear: false, heard: false };
    world.setActivity('b', state);
    expect(world.proximityPlayers().find((p) => p.id === 'b')?.excluded).toBe(true);
    world.setActivity('b', { ...state, hear: true });
    expect(world.proximityPlayers().find((p) => p.id === 'b')?.excluded).toBe(false);
    world.leave('a');
    expect(world.proximityPlayers().map((p) => p.id)).toEqual(['b']);
  });
});

describe('état d\'activité', () => {
  const state = { id: 's1', label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false };

  test('setActivity : le joueur le porte (une copie), il le retrouve en revenant, et null l\'efface', () => {
    const { world, join } = setup();
    join('a');
    world.setActivity('a', state);
    expect(world.get('a')?.activity).toEqual(state);
    // Une copie : modifier l'objet donné, ou lu, ne change pas le monde.
    state.label = 'modifié ?';
    expect(world.get('a')?.activity?.label).toBe('En focus');
    state.label = 'En focus';
    world.get('a')!.activity!.label = 'autre';
    expect(world.get('a')?.activity?.label).toBe('En focus');

    world.leave('a');
    expect(world.rememberedActivity('a')).toEqual(state);
    expect(join('a').activity).toEqual(state);
    world.setActivity('a', null);
    expect(world.get('a')?.activity).toBeNull();
    expect(world.rememberedActivity('a')).toBeNull();
  });

  test('un identifiant absent du monde : ignoré', () => {
    const { world } = setup();
    world.setActivity('inconnu', state);
    expect(world.rememberedActivity('inconnu')).toBeNull();
  });

  test('editActivity : remplace l\'état porté (ou retenu) s\'il est le même, l\'efface s\'il est supprimé, sinon ne change rien', () => {
    const { world, join } = setup();
    join('a');
    world.setActivity('a', state);
    expect(world.editActivity('a', 'autre-id', { ...state, id: 'autre-id' })).toBeUndefined();
    expect(world.get('a')?.activity).toEqual(state);

    expect(world.editActivity('a', 's1', { ...state, label: 'Concentré' })).toEqual({ activity: { ...state, label: 'Concentré' } });
    expect(world.get('a')?.activity?.label).toBe('Concentré');

    // Parti : l'état retenu suit aussi.
    world.leave('a');
    expect(world.editActivity('a', 's1', null)).toEqual({ activity: null });
    expect(world.rememberedActivity('a')).toBeNull();
    expect(world.editActivity('a', 's1', null)).toBeUndefined();
  });
});

describe('la parole', () => {
  test('setSpeaking : la personne parle, le monde le dit dans sa copie ; elle se tait, la clé disparaît', () => {
    const { world, join } = setup();
    join('a');
    expect(world.get('a')).not.toHaveProperty('speaking');
    expect(world.setSpeaking('a', true)).toBe(true);
    expect(world.get('a')?.speaking).toBe(true);
    expect(world.list()[0]?.speaking).toBe(true);
    expect(world.setSpeaking('a', false)).toBe(true);
    expect(world.get('a')).not.toHaveProperty('speaking');
  });

  test('setSpeaking rend vrai quand l\'état change, faux quand il est déjà celui-là : le « je parle » répété ne se rediffuse pas', () => {
    const { world, join } = setup();
    join('a');
    expect(world.setSpeaking('a', false)).toBe(false);
    expect(world.setSpeaking('a', true)).toBe(true);
    expect(world.setSpeaking('a', true)).toBe(false);
    expect(world.setSpeaking('a', false)).toBe(true);
  });

  test('un identifiant absent du monde : ignoré', () => {
    const { world } = setup();
    expect(world.setSpeaking('inconnu', true)).toBe(false);
    expect(world.expireSpeaking()).toEqual([]);
  });

  test('expireSpeaking éteint, et rend, ceux qui n\'ont pas redit « je parle » depuis SPEAKING_TTL_MS', () => {
    const { clock, world, join } = setup();
    join('a');
    join('b');
    world.setSpeaking('a', true);
    clock.t = 1000;
    world.setSpeaking('b', true);
    clock.t = SPEAKING_TTL_MS - 1;
    expect(world.expireSpeaking()).toEqual([]);
    // a a parlé il y a SPEAKING_TTL_MS : éteint ; b, il y a un peu moins : encore là.
    clock.t = SPEAKING_TTL_MS;
    expect(world.expireSpeaking()).toEqual(['a']);
    expect(world.get('a')).not.toHaveProperty('speaking');
    expect(world.get('b')?.speaking).toBe(true);
    clock.t = 1000 + SPEAKING_TTL_MS;
    expect(world.expireSpeaking()).toEqual(['b']);
    expect(world.expireSpeaking()).toEqual([]);
  });

  test('chaque « je parle » remet le délai à zéro : celui qui le redit toutes les 3 s ne s\'éteint pas', () => {
    const { clock, world, join } = setup();
    join('a');
    world.setSpeaking('a', true);
    for (let t = 3000; t <= 30_000; t += 3000) {
      clock.t = t;
      expect(world.setSpeaking('a', true)).toBe(false);
      expect(world.expireSpeaking()).toEqual([]);
    }
    expect(world.get('a')?.speaking).toBe(true);
    clock.t = 30_000 + SPEAKING_TTL_MS;
    expect(world.expireSpeaking()).toEqual(['a']);
  });

  test('quitter le monde, ou y revenir, ne laisse pas parler : la parole ne survit pas à la personne', () => {
    const { world, join } = setup();
    join('a');
    world.setSpeaking('a', true);
    expect(world.leave('a')?.speaking).toBe(true);
    expect(join('a')).not.toHaveProperty('speaking');
    expect(world.get('a')).not.toHaveProperty('speaking');
    expect(world.expireSpeaking()).toEqual([]);
  });

  test('un second join du même identifiant remplace le joueur : il ne parle plus', () => {
    const { world, join } = setup();
    join('a');
    world.setSpeaking('a', true);
    join('a');
    expect(world.get('a')).not.toHaveProperty('speaking');
  });
});
