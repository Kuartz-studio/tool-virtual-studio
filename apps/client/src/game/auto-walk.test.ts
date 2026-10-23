import {
  DEFAULT_DESK_ITEMS,
  DEV_OFFICE,
  TILE_SIZE,
  WALK_SPEED_PX_PER_S,
  avatarBodyFits,
  buildOfficeTiledMap,
  buildTiledMap,
  deskKey,
  isWalkablePoint,
  isWalkableTile,
  parseOfficeMap,
  type Direction,
  type OfficeMap,
  type PlacedItem,
  type Point,
  type Zone,
} from '@bureau/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AutoWalk, REACH_PX, STUCK_MS, cancelOnMoveKey, deskTarget, deskWalkMap, planDeskWalk, planWalk } from './auto-walk';
import { bindKeyboard, DirectionInput } from './input';

const cell = (tx: number, ty: number): Point => ({ x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 });
const tileOf = (p: Point) => ({ tx: Math.floor(p.x / TILE_SIZE), ty: Math.floor(p.y / TILE_SIZE) });

// Une petite carte à la main, `#` bloquant.
function grid(rows: string[]): OfficeMap {
  return {
    widthTiles: rows[0]!.length,
    heightTiles: rows.length,
    tileSize: TILE_SIZE,
    blocked: Uint8Array.from(rows.flatMap((row) => [...row].map((c) => (c === '#' ? 1 : 0)))),
    zones: [],
    spawn: { x: 16, y: 16 },
    switches: [],
    places: [],
    coffees: [],
    speakers: [],
    tables: [],
    signs: [],
  };
}
const open = (width: number, height: number): OfficeMap => grid(Array.from({ length: height }, () => '.'.repeat(width)));

// Toutes les cases qu'un trajet traverse, tronçon après tronçon (les points d'angle y sont).
function walkedTiles(route: Point[]): Array<{ tx: number; ty: number }> {
  const tiles = [tileOf(route[0]!)];
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [tileOf(route[i - 1]!), tileOf(route[i]!)];
    const [dx, dy] = [Math.sign(b.tx - a.tx), Math.sign(b.ty - a.ty)];
    for (let t = { tx: a.tx + dx, ty: a.ty + dy }; ; t = { tx: t.tx + dx, ty: t.ty + dy }) {
      tiles.push(t);
      if (t.tx === b.tx && t.ty === b.ty) break;
    }
  }
  return tiles;
}

// La longueur d'un trajet, en cases.
const lengthOf = (route: Point[]): number => walkedTiles(route).length - 1;

// Chaque tronçon d'un trajet suit une ligne ou une colonne de cases, et toutes celles qu'il traverse sont libres.
function expectStraightAndFree(map: OfficeMap, route: Point[]): void {
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [tileOf(route[i - 1]!), tileOf(route[i]!)];
    expect(a.tx === b.tx || a.ty === b.ty).toBe(true);
  }
  for (const { tx, ty } of walkedTiles(route)) expect(isWalkableTile(map, tx, ty)).toBe(true);
}

// Le plus petit nombre de pas droits entre deux cases : un parcours en largeur, qui ne doit rien à planWalk. Infinity : aucun chemin.
function shortestSteps(map: OfficeMap, from: Point, to: Point): number {
  const [a, b] = [tileOf(from), tileOf(to)];
  if (!isWalkableTile(map, a.tx, a.ty)) return Infinity;
  const seen = new Map<number, number>([[a.ty * map.widthTiles + a.tx, 0]]);
  const queue = [a];
  for (let head = 0; head < queue.length; head++) {
    const { tx, ty } = queue[head]!;
    const steps = seen.get(ty * map.widthTiles + tx)!;
    if (tx === b.tx && ty === b.ty) return steps;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { tx: tx + dx, ty: ty + dy };
      const key = next.ty * map.widthTiles + next.tx;
      if (!isWalkableTile(map, next.tx, next.ty) || seen.has(key)) continue;
      seen.set(key, steps + 1);
      queue.push(next);
    }
  }
  return Infinity;
}

describe('planWalk : le trajet, de case en case', () => {
  test('en ligne droite : le départ et l\'arrivée, rien entre', () => {
    expect(planWalk(open(8, 3), cell(1, 1), cell(6, 1))).toEqual([cell(1, 1), cell(6, 1)]);
  });

  test('en travers de la pièce : un seul virage, à l\'angle (horizontalement d\'abord)', () => {
    expect(planWalk(open(8, 5), cell(1, 1), cell(5, 3))).toEqual([cell(1, 1), cell(5, 1), cell(5, 3)]);
    // Même de loin : jamais en escalier.
    expect(planWalk(open(30, 30), cell(2, 3), cell(27, 26))).toEqual([cell(2, 3), cell(27, 3), cell(27, 26)]);
  });

  test('angle bloqué : l\'autre angle', () => {
    const map = grid(['...#..', '......', '......']);
    // L'angle de l'horizontale d'abord, (3, 0), est un mur : on descend d'abord.
    expect(planWalk(map, cell(0, 0), cell(3, 2))).toEqual([cell(0, 0), cell(0, 2), cell(3, 2)]);
  });

  test('autour d\'un mur : que des lignes droites sur des cases libres, par le plus court', () => {
    const map = grid(['.......', '.#####.', '.......']);
    const route = planWalk(map, cell(0, 1), cell(6, 1))!;
    expectStraightAndFree(map, route);
    expect(lengthOf(route)).toBe(shortestSteps(map, cell(0, 1), cell(6, 1)));
    expect(lengthOf(route)).toBe(8);
  });

  test('le départ n\'est pas au centre de sa case : le trajet part du centre de la case', () => {
    const route = planWalk(open(8, 3), { x: 1 * TILE_SIZE + 3, y: 1 * TILE_SIZE + 29 }, cell(6, 1))!;
    expect(route[0]).toEqual(cell(1, 1));
  });

  test('déjà dans la case d\'arrivée : un seul point, rien à parcourir', () => {
    expect(planWalk(open(4, 3), { x: 1 * TILE_SIZE + 5, y: 1 * TILE_SIZE + 25 }, cell(1, 1))).toEqual([cell(1, 1)]);
  });

  test('chemin introuvable : le départ dans un mur, l\'arrivée dans un mur ou murée, hors de la carte', () => {
    const map = grid(['..#..', '..#..', '..#..']);
    expect(planWalk(map, cell(2, 1), cell(0, 0))).toBeNull();   // départ dans un mur
    expect(planWalk(map, cell(0, 0), cell(2, 1))).toBeNull();   // arrivée dans un mur
    expect(planWalk(map, cell(0, 0), cell(4, 1))).toBeNull();   // arrivée de l'autre côté du mur : pas question d'aller à la case la plus proche
    expect(planWalk(map, cell(0, 0), { x: 900, y: 900 })).toBeNull();
    expect(planWalk(map, { x: -5, y: 10 }, cell(1, 1))).toBeNull();
  });
});

describe('AutoWalk : suivre le trajet', () => {
  const route = [cell(1, 1), cell(6, 1), cell(6, 4)];
  let states: boolean[];
  let walk: AutoWalk;
  beforeEach(() => {
    states = [];
    walk = new AutoWalk((walking) => states.push(walking));
  });

  test('au départ : le premier point de passage, et la direction de son tronçon', () => {
    walk.start(route, cell(1, 1), 0);
    expect(states).toEqual([true]);
    expect(walk.walking).toBe(true);
    expect(walk.waypoint).toEqual(cell(6, 1));
    expect(walk.update(cell(1, 1), 0)).toBe('right');
    expect(walk.update(cell(4, 1), 800)).toBe('right');
    expect(walk.waypoint).toEqual(cell(6, 1));
  });

  test('au point d\'angle (à REACH_PX près) : le point suivant, et la nouvelle direction', () => {
    walk.start(route, cell(1, 1), 0);
    // Un peu avant l'angle, hors de la fenêtre : on va toujours tout droit.
    expect(walk.update({ x: cell(6, 1).x - REACH_PX - 1, y: cell(6, 1).y }, 10)).toBe('right');
    expect(walk.update({ x: cell(6, 1).x - REACH_PX, y: cell(6, 1).y }, 20)).toBe('down');
    expect(walk.waypoint).toEqual(cell(6, 4));
  });

  test('un point dépassé compte comme atteint : jamais de demi-tour pour 3 px', () => {
    walk.start(route, cell(1, 1), 0);
    expect(walk.update({ x: cell(6, 1).x + 3, y: cell(6, 1).y }, 10)).toBe('down');
  });

  test.each<[string, Point[], Point, Direction]>([
    ['vers l\'est', [cell(1, 1), cell(6, 1)], cell(1, 1), 'right'],
    ['vers l\'ouest', [cell(6, 1), cell(1, 1)], cell(6, 1), 'left'],
    ['vers le nord', [cell(2, 5), cell(2, 1)], cell(2, 5), 'up'],
    ['vers le sud', [cell(2, 1), cell(2, 5)], cell(2, 1), 'down'],
  ])('la direction d\'un tronçon : %s', (_name, legs, feet, direction) => {
    walk.start(legs, feet, 0);
    expect(walk.update(feet, 0)).toBe(direction);
  });

  test('hors de la voie : on s\'y remet d\'abord, puis on avance', () => {
    walk.start(route, cell(1, 1), 0);
    // 10 px sous la ligne des centres : on remonte, sans avancer.
    expect(walk.update({ x: cell(1, 1).x, y: cell(1, 1).y + 10 }, 0)).toBe('up');
    // 10 px au-dessus : on redescend.
    expect(walk.update({ x: cell(1, 1).x, y: cell(1, 1).y - 10 }, 10)).toBe('down');
    // À 4 px ou moins : c'est la voie.
    expect(walk.update({ x: cell(1, 1).x, y: cell(1, 1).y + 4 }, 20)).toBe('right');
  });

  test('à l\'arrivée : plus de direction, la marche s\'arrête et le dit, une fois', () => {
    walk.start(route, cell(1, 1), 0);
    walk.update(cell(6, 1), 10);
    expect(walk.update({ x: cell(6, 4).x, y: cell(6, 4).y - REACH_PX }, 20)).toBeNull();
    expect(walk.walking).toBe(false);
    expect(walk.waypoint).toBeNull();
    expect(states).toEqual([true, false]);
    // Et après : rien.
    expect(walk.update(cell(6, 4), 30)).toBeNull();
    expect(states).toEqual([true, false]);
  });

  test('un trajet d\'un seul point (on y est) : on ne part pas, et le jeu le dit', () => {
    walk.start([cell(1, 1)], cell(1, 1), 0);
    expect(walk.walking).toBe(false);
    expect(walk.update(cell(1, 1), 10)).toBeNull();
    expect(states).toEqual([false]);
  });

  test('chemin introuvable (null) : rien ne bouge, et le jeu le dit', () => {
    walk.start(null, cell(1, 1), 0);
    expect(walk.walking).toBe(false);
    expect(walk.waypoint).toBeNull();
    expect(walk.update(cell(1, 1), 10)).toBeNull();
    expect(states).toEqual([false]);
  });

  test('un chemin introuvable arrête aussi la marche en cours, et le dit une seule fois', () => {
    walk.start(route, cell(1, 1), 0);
    walk.start(null, cell(2, 1), 10);
    expect(walk.walking).toBe(false);
    expect(states).toEqual([true, false]);
  });

  test('cancel() arrête la marche, une seule fois ; hors marche, il ne dit rien', () => {
    walk.cancel();
    expect(states).toEqual([]);
    walk.start(route, cell(1, 1), 0);
    walk.cancel();
    walk.cancel();
    expect(walk.walking).toBe(false);
    expect(walk.update(cell(2, 1), 10)).toBeNull();
    expect(states).toEqual([true, false]);
  });

  test('bloqué : les pieds n\'avancent plus depuis plus d\'une seconde, la marche s\'arrête', () => {
    const feet = cell(3, 1);
    walk.start(route, feet, 0);
    expect(walk.update(feet, 500)).toBe('right');
    expect(walk.update(feet, STUCK_MS)).toBe('right');
    expect(walk.update(feet, STUCK_MS + 1)).toBeNull();
    expect(walk.walking).toBe(false);
    expect(states).toEqual([true, false]);
  });

  test('tant que les pieds avancent, même lentement, ce n\'est pas bloqué', () => {
    walk.start(route, cell(1, 1), 0);
    for (let i = 1; i <= 10; i++) expect(walk.update({ x: cell(1, 1).x + 2 * i, y: cell(1, 1).y }, i * 400)).toBe('right');
    expect(walk.walking).toBe(true);
  });

  test('une pause du jeu de plus d\'une seconde (page figée) n\'est pas un blocage', () => {
    const feet = cell(3, 1);
    walk.start(route, feet, 0);
    expect(walk.update(feet, 100)).toBe('right');
    // Rien ne s'est passé pendant 5 s : le jeu ne tournait pas.
    expect(walk.update(feet, 5100)).toBe('right');
    // Mais s'il tourne, et que les pieds ne bougent toujours pas : bloqué, une seconde après.
    expect(walk.update(feet, 5600)).toBe('right');
    expect(walk.update(feet, 5100 + STUCK_MS + 1)).toBeNull();
  });

  test('le temps de blocage repart de zéro quand les pieds bougent', () => {
    const feet = cell(3, 1);
    walk.start(route, feet, 0);
    expect(walk.update(feet, 900)).toBe('right');
    const moved = { x: feet.x + 3, y: feet.y };
    expect(walk.update(moved, 950)).toBe('right');
    expect(walk.update(moved, 1950)).toBe('right');
    expect(walk.update(moved, 1951)).toBeNull();
  });
});

describe('cancelOnMoveKey : une touche de déplacement reprend la main', () => {
  let states: boolean[];
  let walk: AutoWalk;
  let input: DirectionInput;
  beforeEach(() => {
    states = [];
    walk = new AutoWalk((walking) => states.push(walking));
    input = new DirectionInput();
    walk.start([cell(1, 1), cell(6, 1)], cell(1, 1), 0);
  });

  test.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'])('%s arrête la marche', (code) => {
    cancelOnMoveKey(walk, input);
    input.press(code);
    expect(walk.walking).toBe(false);
    expect(states).toEqual([true, false]);
  });

  test('une autre touche, ou Maj, ne l\'arrête pas', () => {
    cancelOnMoveKey(walk, input);
    input.press('KeyP');
    input.press('KeyE');
    input.setSprint(true);
    expect(walk.walking).toBe(true);
  });

  test('on peut cesser d\'écouter', () => {
    const stop = cancelOnMoveKey(walk, input);
    stop();
    input.press('ArrowLeft');
    expect(walk.walking).toBe(true);
  });

  describe('au clavier de la page', () => {
    let unbind: () => void;
    const fire = (target: EventTarget, type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init }));
    beforeEach(() => {
      cancelOnMoveKey(walk, input);
      unbind = bindKeyboard(input);
    });
    afterEach(() => {
      unbind();
      document.body.replaceChildren();
    });

    test('une flèche enfoncée arrête la marche, même si on la relâche aussitôt', () => {
      fire(window, 'keydown', 'ArrowLeft');
      fire(window, 'keyup', 'ArrowLeft');
      expect(walk.walking).toBe(false);
    });

    test('ce qu\'on tape dans un champ, ou sous Ctrl, n\'est pas pour l\'avatar : la marche continue', () => {
      const field = document.body.appendChild(document.createElement('input'));
      field.focus();
      fire(field, 'keydown', 'KeyA');
      fire(window, 'keydown', 'ArrowUp', { ctrlKey: true });
      expect(walk.walking).toBe(true);
    });

    test('une touche qu\'un menu a déjà prise (preventDefault) n\'arrête pas la marche', () => {
      const menu = document.body.appendChild(document.createElement('div'));
      menu.addEventListener('keydown', (event) => event.preventDefault());
      fire(menu, 'keydown', 'ArrowDown');
      expect(walk.walking).toBe(true);
    });
  });
});

const office = parseOfficeMap(buildOfficeTiledMap());
const room = (key: string): Zone => office.zones.find((zone) => zone.type === 'desk' && deskKey(zone) === key)!;
// Le centre de la case (cx, cy) de la pièce, en pixels.
const inRoom = (zone: Zone, cx: number, cy: number): Point => ({ x: zone.x + cx * TILE_SIZE + TILE_SIZE / 2, y: zone.y + cy * TILE_SIZE + TILE_SIZE / 2 });
const KEYS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

describe('deskTarget : où l\'on s\'arrête dans son bureau', () => {
  test('le poste par défaut : la case devant la chaise (au sud), face au bureau', () => {
    // La chaise grise (dos) est en (4, 3), juste sous le bureau.
    expect(deskTarget(office, room('A1'), DEFAULT_DESK_ITEMS)).toEqual(inRoom(room('A1'), 4, 4));
    expect(deskTarget(office, room('A4'), DEFAULT_DESK_ITEMS)).toEqual(inRoom(room('A4'), 4, 4));
  });

  test('plusieurs sièges : celui qui est devant le bureau, pas le canapé posé avant lui', () => {
    const items: PlacedItem[] = [{ id: 'of-0-17', x: 0, y: 4 }, ...DEFAULT_DESK_ITEMS.filter((item) => item.id !== 'of-0-17' && item.id !== 'lr-13-21')];
    expect(deskTarget(office, room('A1'), items)).toEqual(inRoom(room('A1'), 4, 4));
  });

  test('au dixième de case : la chaise un peu décalée sous le bureau reste celle du poste, et l\'on s\'arrête sur la case entière devant elle', () => {
    // Le bureau en (3,2 ; 1), la chaise en (4,3 ; 3,1) : un dixième sous le bord du bureau, à cheval sur deux rangées.
    const items: PlacedItem[] = [{ id: 'of-0-17', x: 0, y: 4 }, { id: 'of-7-28', x: 3.2, y: 1 }, { id: 'of-0-8', x: 4.3, y: 3.1 }];
    expect(deskTarget(office, room('A1'), items)).toEqual(inRoom(room('A1'), 4, 5));
  });

  test('un meuble à cheval sur des cases les bloque toutes pour la marche', () => {
    const zone = room('A1');
    const map = deskWalkMap(office, zone, [{ id: 'of-7-28', x: 3.2, y: 1 }]);
    const [tx, ty] = [Math.round(zone.x / office.tileSize), Math.round(zone.y / office.tileSize)];
    const blockedAt = (x: number, y: number) => map.blocked[(ty + y) * office.widthTiles + tx + x] === 1;
    expect([2, 3, 4, 5, 6].map((x) => blockedAt(x, 1))).toEqual([false, true, true, true, true]);
    expect(blockedAt(4, 3)).toBe(false);
  });

  test('sans bureau, le premier siège venu : la case devant lui', () => {
    expect(deskTarget(office, room('A2'), [{ id: 'of-12-43', x: 2, y: 1 }])).toEqual(inRoom(room('A2'), 2, 2));
  });

  test('sans siège connu : une case libre au centre de la pièce', () => {
    expect(deskTarget(office, room('A1'), [])).toEqual(inRoom(room('A1'), 4, 3));
    // Rien que du décor qui n'est pas un siège.
    expect(deskTarget(office, room('A1'), [{ id: 'of-7-28', x: 3, y: 1 }, { id: 'of-6-10', x: 0, y: 1 }])).toEqual(inRoom(room('A1'), 4, 3));
  });

  test('la case devant la chaise est prise par un meuble solide : la case libre la plus proche, de préférence plus au sud', () => {
    const shelf: PlacedItem = { id: 'of-7-12', x: 4, y: 4 };   // une étagère de 2 cases de large, solide : (4, 4) et (5, 4)
    expect(deskTarget(office, room('A1'), [...DEFAULT_DESK_ITEMS, shelf])).toEqual(inRoom(room('A1'), 4, 5));
  });

  test('le centre est pris par un meuble solide : la case libre la plus proche', () => {
    const table: PlacedItem = { id: 'of-7-28', x: 3, y: 2 };   // un bureau de 3 × 2 cases, solide : de (3, 2) à (5, 3)
    expect(deskTarget(office, room('A1'), [table])).toEqual(inRoom(room('A1'), 4, 4));
  });

  test('une pièce d\'une autre taille que celles du jeu (carte de développement) : le centre de la pièce, sans décor', () => {
    const dev = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
    const zone = dev.zones.find((z) => z.type === 'desk')!;
    // 4 × 3 cases : le centre est la case (2, 1). Les meubles du jeu (9 × 7) n'y sont pas.
    expect(deskTarget(dev, zone, DEFAULT_DESK_ITEMS)).toEqual({ x: zone.x + 2 * TILE_SIZE + TILE_SIZE / 2, y: zone.y + 1 * TILE_SIZE + TILE_SIZE / 2 });
  });

  test('pas une seule case libre : rien', () => {
    const zone: Zone = { id: '1', type: 'desk', name: null, text: null, x: TILE_SIZE, y: TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
    expect(deskTarget(grid(['...', '.#.', '...']), zone, [])).toBeNull();
  });
});

describe('planDeskWalk : de là où l\'on est jusqu\'à son bureau', () => {
  test('de l\'accueil à chaque bureau : par la porte, jusqu\'à la case visée', () => {
    for (const key of KEYS) {
      const zone = room(key);
      const route = planDeskWalk(office, zone, DEFAULT_DESK_ITEMS, office.spawn)!;
      expect(route.at(-1)).toEqual(deskTarget(office, zone, DEFAULT_DESK_ITEMS));
      expectStraightAndFree(deskWalkMap(office, zone, DEFAULT_DESK_ITEMS), route);
      // Il faut franchir la porte : la zone `door` de la même clé.
      const door = office.zones.find((z) => z.type === 'door' && deskKey(z) === key)!;
      const inDoor = walkedTiles(route).some(({ tx, ty }) => {
        const p = cell(tx, ty);
        return p.x >= door.x && p.x < door.x + door.width && p.y >= door.y && p.y < door.y + door.height;
      });
      expect(inDoor).toBe(true);
    }
  });

  test('les meubles solides de la pièce sont des murs pour le trajet, pas pour la carte', () => {
    const zone = room('A1');
    const map = deskWalkMap(office, zone, DEFAULT_DESK_ITEMS);
    // Le bureau de la pièce occupe (3, 1) à (5, 2) ; la chaise, non solide, ne bloque rien.
    const walkable = (m: OfficeMap, p: Point) => isWalkablePoint(m, p.x, p.y);
    expect(walkable(map, inRoom(zone, 4, 1))).toBe(false);
    expect(walkable(map, inRoom(zone, 4, 3))).toBe(true);
    expect(walkable(office, inRoom(zone, 4, 1))).toBe(true);
  });

  test('l\'entrée murée par les meubles : introuvable', () => {
    // Une étagère sur les deux cases juste derrière la porte, (3, 6) et (4, 6) : on ne peut plus entrer.
    expect(planDeskWalk(office, room('A1'), [{ id: 'of-7-12', x: 3, y: 6 }], office.spawn)).toBeNull();
  });

  test('un départ dans un mur : introuvable', () => {
    expect(planDeskWalk(office, room('A1'), DEFAULT_DESK_ITEMS, { x: 10, y: 10 })).toBeNull();
  });

  test('le plus court chemin : celui d\'un parcours en largeur, d\'où qu\'on parte', () => {
    let seed = 20261021;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const free: Point[] = [];
    for (let ty = 0; ty < office.heightTiles; ty++) for (let tx = 0; tx < office.widthTiles; tx++) if (isWalkableTile(office, tx, ty)) free.push(cell(tx, ty));
    for (const key of KEYS) {
      const zone = room(key);
      const map = deskWalkMap(office, zone, DEFAULT_DESK_ITEMS);
      const target = deskTarget(office, zone, DEFAULT_DESK_ITEMS)!;
      for (let n = 0; n < 60; n++) {
        const from = free[Math.floor(random() * free.length)]!;
        const route = planDeskWalk(office, zone, DEFAULT_DESK_ITEMS, from);
        // Sans trajet : la case de départ est un meuble de la pièce, ou rien n'y mène.
        if (route === null) expect(shortestSteps(map, from, target)).toBe(Infinity);
        else expect(lengthOf(route)).toBe(shortestSteps(map, from, target));
      }
    }
  });
});

// Un avatar de poche, mené comme le jeu mène le vrai : à chaque image, la direction que donne la marche est une vitesse de
// WALK_SPEED_PX_PER_S (LocalPlayer.step). `fits` dit si son corps tient à un endroit ; sinon il ne bouge pas (il bute), comme contre un mur.
const HEADING: Record<Direction, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

function simulate(walk: AutoWalk, start: Point, fits: (p: Point) => boolean, fps = 60, maxSeconds = 120) {
  const frameMs = 1000 / fps;
  const step = WALK_SPEED_PX_PER_S / fps;
  let feet = { ...start };
  let now = 0;
  let bumps = 0;
  let firstBumpAt: number | null = null;
  while (walk.walking && now < maxSeconds * 1000) {
    const direction = walk.update(feet, now);
    if (direction !== null) {
      const next = { x: feet.x + HEADING[direction].x * step, y: feet.y + HEADING[direction].y * step };
      if (fits(next)) {
        feet = next;
      } else {
        bumps++;
        firstBumpAt ??= now;
      }
    }
    now += frameMs;
  }
  return { feet, bumps, firstBumpAt, endedAt: now, seconds: now / 1000, finished: !walk.walking };
}

describe('la marche, image après image', () => {
  // Un point de départ où le corps de l'avatar tient : au hasard dans une case libre.
  function randomStart(map: OfficeMap, random: () => number): Point {
    for (;;) {
      const [tx, ty] = [Math.floor(random() * map.widthTiles), Math.floor(random() * map.heightTiles)];
      if (!isWalkableTile(map, tx, ty)) continue;
      const feet = { x: tx * TILE_SIZE + random() * TILE_SIZE, y: ty * TILE_SIZE + random() * TILE_SIZE };
      if (avatarBodyFits(map, feet.x, feet.y)) return feet;
    }
  }

  test('de l\'accueil à son bureau : on arrive devant la chaise, sans jamais buter, à la vitesse de la marche', () => {
    for (const key of KEYS) {
      const zone = room(key);
      const map = deskWalkMap(office, zone, DEFAULT_DESK_ITEMS);
      const route = planDeskWalk(office, zone, DEFAULT_DESK_ITEMS, office.spawn)!;
      const walk = new AutoWalk(() => {});
      walk.start(route, office.spawn, 0);
      const result = simulate(walk, office.spawn, (p) => avatarBodyFits(map, p.x, p.y));
      expect(result.finished).toBe(true);
      expect(result.bumps).toBe(0);
      const target = deskTarget(office, zone, DEFAULT_DESK_ITEMS)!;
      expect(Math.abs(result.feet.x - target.x)).toBeLessThanOrEqual(REACH_PX + 3);
      expect(Math.abs(result.feet.y - target.y)).toBeLessThanOrEqual(REACH_PX + 3);
      // À la vitesse de la marche, sans détour : la longueur du trajet, à une remise sur la voie et quelques coins coupés près.
      const minimum = (lengthOf(route) * TILE_SIZE) / WALK_SPEED_PX_PER_S;
      expect(result.seconds).toBeGreaterThanOrEqual(minimum - 0.5);
      expect(result.seconds).toBeLessThanOrEqual(minimum + 0.5);
    }
  });

  test('de n\'importe où (au hasard, hors du centre des cases) : on arrive, et le corps ne bute jamais', () => {
    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (const key of KEYS) {
      const zone = room(key);
      const map = deskWalkMap(office, zone, DEFAULT_DESK_ITEMS);
      const target = deskTarget(office, zone, DEFAULT_DESK_ITEMS)!;
      for (let n = 0; n < 40; n++) {
        const start = randomStart(map, random);
        const route = planDeskWalk(office, zone, DEFAULT_DESK_ITEMS, start);
        if (route === null) continue;   // une case qu'aucun chemin ne relie à la pièce
        const walk = new AutoWalk(() => {});
        walk.start(route, start, 0);
        const result = simulate(walk, start, (p) => avatarBodyFits(map, p.x, p.y));
        expect(result.bumps).toBe(0);
        expect(result.finished).toBe(true);
        expect(tileOf(result.feet)).toEqual(tileOf(target));
      }
    }
  });

  test('à 30 images par seconde, ou 20 : on arrive aussi, sans buter', () => {
    const zone = room('A3');
    const map = deskWalkMap(office, zone, DEFAULT_DESK_ITEMS);
    for (const fps of [30, 20]) {
      const walk = new AutoWalk(() => {});
      walk.start(planDeskWalk(office, zone, DEFAULT_DESK_ITEMS, office.spawn), office.spawn, 0);
      const result = simulate(walk, office.spawn, (p) => avatarBodyFits(map, p.x, p.y), fps);
      expect(result.bumps).toBe(0);
      expect(tileOf(result.feet)).toEqual(tileOf(deskTarget(office, zone, DEFAULT_DESK_ITEMS)!));
    }
  });

  test('un obstacle que la carte ne connaît pas (une porte fermée) : on bute, et la marche s\'arrête une seconde après', () => {
    const zone = room('A2');
    const map = deskWalkMap(office, zone, DEFAULT_DESK_ITEMS);
    const door = office.zones.find((z) => z.type === 'door' && deskKey(z) === 'A2')!;
    // Le battant de la porte est un mur pour le corps de l'avatar (20 × 12 px sous ses pieds), sans que le trajet le sache.
    const hitsDoor = (p: Point) => p.x + 10 > door.x && p.x - 10 < door.x + door.width && p.y + 1 > door.y && p.y - 11 < door.y + door.height;
    const walk = new AutoWalk(() => {});
    walk.start(planDeskWalk(office, zone, DEFAULT_DESK_ITEMS, office.spawn), office.spawn, 0);
    const result = simulate(walk, office.spawn, (p) => avatarBodyFits(map, p.x, p.y) && !hitsDoor(p));
    expect(result.finished).toBe(true);
    expect(result.bumps).toBeGreaterThan(0);
    expect(result.feet.y).toBeGreaterThan(door.y + door.height);
    expect(result.endedAt - result.firstBumpAt!).toBeGreaterThan(STUCK_MS - 50);
    expect(result.endedAt - result.firstBumpAt!).toBeLessThan(STUCK_MS + 100);
  });

  test('chemin introuvable : l\'avatar ne bouge pas', () => {
    const start = { x: 10, y: 10 };   // dans un mur
    const walk = new AutoWalk(() => {});
    walk.start(planDeskWalk(office, room('A1'), DEFAULT_DESK_ITEMS, start), start, 0);
    const result = simulate(walk, start, () => true);
    expect(result.finished).toBe(true);
    expect(result.feet).toEqual(start);
    expect(result.seconds).toBe(0);
  });
});
