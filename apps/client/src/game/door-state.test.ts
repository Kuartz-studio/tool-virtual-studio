import { AUDIO_FULL_DISTANCE_PX, AUDIO_SILENT_DISTANCE_PX, TILE_SIZE, type Zone } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { DOOR_CLOSE_DELAY_MS, DOOR_REACH_TILES, doorSoundLevel, doorTarget, nearDoor, nextPhase, watchDoor, type DoorWatch } from './door-state';

describe('doorTarget : ce que la porte veut être', () => {
  test('ouverte (place libre, porte non verrouillée), elle reste ouverte, de près comme de loin', () => {
    for (const selfNear of [true, false]) for (const ownerNear of [true, false]) expect(doorTarget({ view: 'open', selfNear, ownerNear })).toBe('open');
  });

  test('fermée pour soi : elle reste fermée, même de près', () => {
    expect(doorTarget({ view: 'closed', selfNear: true, ownerNear: false })).toBe('closed');
    expect(doorTarget({ view: 'closed', selfNear: false, ownerNear: false })).toBe('closed');
  });

  test('verrouillée mais autorisée : elle s\'ouvre de près et se ferme de loin', () => {
    expect(doorTarget({ view: 'locked-mine', selfNear: true, ownerNear: false })).toBe('open');
    expect(doorTarget({ view: 'locked-mine', selfNear: false, ownerNear: false })).toBe('closed');
  });

  test('la vue d\'un autre : une porte verrouillée s\'ouvre quand le propriétaire est près', () => {
    expect(doorTarget({ view: 'closed', selfNear: false, ownerNear: true })).toBe('open');
    expect(doorTarget({ view: 'locked-mine', selfNear: false, ownerNear: true })).toBe('open');
  });
});

describe('nextPhase : les phases se suivent, sans saut', () => {
  test('ouverte → se ferme → fermée', () => {
    expect(nextPhase('open', 'closed')).toBe('closing');
    expect(nextPhase('closing', 'closed')).toBe('closed');
  });

  test('fermée → s\'ouvre → ouverte', () => {
    expect(nextPhase('closed', 'open')).toBe('opening');
    expect(nextPhase('opening', 'open')).toBe('open');
  });

  test('ce qu\'elle veut déjà : rien ne change', () => {
    expect(nextPhase('open', 'open')).toBe('open');
    expect(nextPhase('closed', 'closed')).toBe('closed');
  });

  test('un mouvement en cours se finit avant que l\'autre ne commence : il n\'y a pas de demi-tour', () => {
    // La porte qui se ferme et qu'on veut rouvrir finit de se fermer ; celle qui s'ouvre et qu'on veut refermer finit de s'ouvrir.
    expect(nextPhase('closing', 'open')).toBe('closed');
    expect(nextPhase('opening', 'closed')).toBe('open');
  });
});

describe('nearDoor : à 1,5 case du centre de la porte', () => {
  const door = { x: 4 * TILE_SIZE, y: 9 * TILE_SIZE, width: 2 * TILE_SIZE, height: 2 * TILE_SIZE } as Zone;
  const centre = { x: 5 * TILE_SIZE, y: 10 * TILE_SIZE };

  test('la portée est de 1,5 case, le délai de fermeture de 600 ms', () => {
    expect(DOOR_REACH_TILES).toBe(1.5);
    expect(DOOR_CLOSE_DELAY_MS).toBe(600);
  });

  test('dans la portée oui, au-delà non, et le bord compte comme dedans', () => {
    expect(nearDoor(centre, door)).toBe(true);
    expect(nearDoor({ x: centre.x + 1.5 * TILE_SIZE, y: centre.y }, door)).toBe(true);
    expect(nearDoor({ x: centre.x + 1.5 * TILE_SIZE + 1, y: centre.y }, door)).toBe(false);
    expect(nearDoor({ x: centre.x, y: centre.y + 3 * TILE_SIZE }, door)).toBe(false);
  });

  test('sans position connue (le propriétaire est parti), on n\'est pas près', () => {
    expect(nearDoor(null, door)).toBe(false);
  });
});

describe('doorSoundLevel : le bruit d\'une porte, plus faible avec la distance', () => {
  test('plein volume de près, le silence au-delà de la portée d\'écoute (14 cases), entre les deux un volume qui baisse', () => {
    expect(doorSoundLevel(0)).toBe(1);
    expect(doorSoundLevel(AUDIO_FULL_DISTANCE_PX)).toBe(1);
    expect(doorSoundLevel(AUDIO_SILENT_DISTANCE_PX)).toBe(0);
    expect(AUDIO_SILENT_DISTANCE_PX).toBe(14 * TILE_SIZE);
    const middle = doorSoundLevel((AUDIO_FULL_DISTANCE_PX + AUDIO_SILENT_DISTANCE_PX) / 2);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    expect(doorSoundLevel(AUDIO_SILENT_DISTANCE_PX + 100)).toBe(0);
  });
});

describe('watchDoor : une porte qui s\'est ouverte pour quelqu\'un se referme 600 ms après son départ', () => {
  const START: DoorWatch = { near: false, closeAt: null };
  const near = { view: 'locked-mine', selfNear: true, ownerNear: false } as const;
  const far = { view: 'locked-mine', selfNear: false, ownerNear: false } as const;

  test('quelqu\'un s\'approche : elle s\'ouvre tout de suite', () => {
    expect(watchDoor(START, near, 1000)).toEqual({ target: 'open', watch: { near: true, closeAt: null } });
  });

  test('il s\'éloigne : elle reste ouverte DOOR_CLOSE_DELAY_MS, puis se ferme', () => {
    const arrived = watchDoor(START, near, 1000).watch;
    const left = watchDoor(arrived, far, 2000);
    expect(left).toEqual({ target: 'open', watch: { near: false, closeAt: 2000 + DOOR_CLOSE_DELAY_MS } });
    expect(watchDoor(left.watch, far, 2000 + DOOR_CLOSE_DELAY_MS - 1).target).toBe('open');
    const later = watchDoor(left.watch, far, 2000 + DOOR_CLOSE_DELAY_MS);
    expect(later.target).toBe('closed');
    expect(later.watch.closeAt).toBeNull();
    // Et elle le reste.
    expect(watchDoor(later.watch, far, 10_000).target).toBe('closed');
  });

  test('il revient avant la fin du délai : elle ne se ferme pas, et le délai repart de zéro à son prochain départ', () => {
    const left = watchDoor(watchDoor(START, near, 0).watch, far, 100);
    const back = watchDoor(left.watch, near, 300);
    expect(back).toEqual({ target: 'open', watch: { near: true, closeAt: null } });
    expect(watchDoor(back.watch, far, 1000).watch.closeAt).toBe(1000 + DOOR_CLOSE_DELAY_MS);
  });

  test('une porte que personne n\'a ouverte est fermée sans attendre', () => {
    expect(watchDoor(START, far, 500)).toEqual({ target: 'closed', watch: { near: false, closeAt: null } });
    // Même chose quand un bureau vient d\'être verrouillé et que personne n\'est près.
    expect(watchDoor(START, { view: 'closed', selfNear: true, ownerNear: false }, 500).target).toBe('closed');
  });

  test('ouverte pour tous : jamais de délai, jamais de fermeture', () => {
    const free = { view: 'open', selfNear: false, ownerNear: false } as const;
    expect(watchDoor({ near: true, closeAt: null }, free, 0)).toEqual({ target: 'open', watch: { near: false, closeAt: null } });
  });

  test('le propriétaire qu\'on voit entrer ouvre la porte, et la porte se ferme derrière lui', () => {
    const owner = { view: 'closed', selfNear: false, ownerNear: true } as const;
    const inside = watchDoor(START, owner, 0);
    expect(inside.target).toBe('open');
    const gone = watchDoor(inside.watch, { ...owner, ownerNear: false }, 400);
    expect(gone.watch.closeAt).toBe(400 + DOOR_CLOSE_DELAY_MS);
    expect(watchDoor(gone.watch, { ...owner, ownerNear: false }, 400 + DOOR_CLOSE_DELAY_MS).target).toBe('closed');
  });
});
