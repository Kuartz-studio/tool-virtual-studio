import {
  DEV_OFFICE,
  EXTRAPOLATION_MAX_MS,
  MAX_SPEED_PX_PER_S,
  NORMAL_MAX_SPEED_PX_PER_S,
  WALK_SPEED_PX_PER_S,
  REMOTE_RENDER_DELAY_MS,
  TELEPORT_SNAP_PX,
  WORLD_TICK_MS,
  avatarBodyFits,
  buildTiledMap,
  parseOfficeMap,
  type Direction,
} from '@bureau/shared';
import { expect, test } from 'vitest';
import { SnapshotBuffer, type Snapshot } from './snapshot-buffer';

test('SnapshotBuffer : interpolation, bornes, téléportation, capacité', () => {
  const b = new SnapshotBuffer(); const s = (x: number): Snapshot => ({ x, y: 0, dir: 'right', moving: true });
  b.push(0, s(0)); b.push(100, s(100));
  expect(b.sample(50)!.x).toBe(50); expect(b.sample(-10)!.x).toBe(0);
  // Le brief disait `sample(500) === 100` (pas d'extrapolation). Décision du contrôleur (tâche 15) : au-delà du dernier instantané,
  // en marche, l'avatar continue au plus EXTRAPOLATION_MAX_MS, à MAX_SPEED_PX_PER_S au plus, puis reste là : 100 + 57,6 px (ici, 1000 px/s
  // se lisent entre les deux instantanés, plafonnés à la vitesse du café).
  expect(b.sample(500)!.x).toBeCloseTo(100 + MAX_EXTRAPOLATED_PX);
  b.snapToLatest(); expect(b.sample(50)!.x).toBe(100);       // retour sur l'onglet
  const t = new SnapshotBuffer(); t.push(0, s(0)); t.push(100, s(400)); expect(t.sample(50)!.x).toBe(400);   // 400 px en 100 ms : plus que la limite (352)
  const c = new SnapshotBuffer(20); for (let i = 0; i < 1000; i++) c.push(i * 100, s(i)); expect(c.size()).toBeLessThanOrEqual(20); // Point de vigilance 4
});

const at = (x: number, y: number, dir: Snapshot['dir'] = 'right', moving = true): Snapshot => ({ x, y, dir, moving });

test('vide : rien à dessiner', () => {
  const b = new SnapshotBuffer();
  expect(b.sample(0)).toBeNull();
  expect(b.size()).toBe(0);
  b.snapToLatest();
  expect(b.sample(0)).toBeNull();
});

test('un seul instantané : c\'est lui, à toute heure', () => {
  const b = new SnapshotBuffer();
  b.push(1000, at(80, 240, 'down', false));
  expect(b.sample(0)).toEqual(at(80, 240, 'down', false));
  expect(b.sample(99_999)).toEqual(at(80, 240, 'down', false));
});

test('les deux axes sont interpolés, entre les deux instantanés qui encadrent l\'heure demandée', () => {
  const b = new SnapshotBuffer();
  b.push(0, at(0, 0));
  b.push(100, at(10, 0));
  b.push(200, at(10, 20, 'down'));
  expect(b.sample(150)).toMatchObject({ x: 10, y: 10 });
  expect(b.sample(175)).toMatchObject({ x: 10, y: 15 });
  expect(b.sample(100)).toMatchObject({ x: 10, y: 0 });
});

test('direction et marche : celles où il va ; il marche tant qu\'il glisse d\'un point à l\'autre', () => {
  const b = new SnapshotBuffer();
  b.push(0, at(0, 0, 'right', true));
  b.push(100, at(16, 0, 'right', false));                     // il s'arrête : on le voit encore marcher jusqu'au point d'arrêt
  expect(b.sample(50)).toEqual(at(8, 0, 'right', true));
  expect(b.sample(100)).toEqual(at(16, 0, 'right', false));
  expect(b.sample(300)).toEqual(at(16, 0, 'right', false));

  const turn = new SnapshotBuffer();
  turn.push(0, at(0, 0, 'right', false));
  turn.push(100, at(0, 16, 'down', true));                    // il repart vers le bas
  expect(turn.sample(50)).toEqual(at(0, 8, 'down', true));
});

// La règle du saut : distance(a, b) > TELEPORT_SNAP_PX + MAX_SPEED_PX_PER_S × (b.at − a.at) / 1000. Ce que la course peut expliquer
// pendant le temps qui sépare deux instantanés glisse ; au-delà de TELEPORT_SNAP_PX de plus, c'est un saut.
const jumpLimit = (dt: number) => TELEPORT_SNAP_PX + (MAX_SPEED_PX_PER_S * dt) / 1000;

test.each([50, 100, REMOTE_RENDER_DELAY_MS])('saut, à la limite, pour %d ms entre deux instantanés : la limite glisse, un pixel de plus saute', (dt) => {
  const limit = jumpLimit(dt);
  const glide = new SnapshotBuffer();
  glide.push(0, at(0, 0));
  glide.push(dt, at(limit, 0));
  expect(glide.sample(dt / 2)!.x).toBe(limit / 2);

  const jump = new SnapshotBuffer();
  jump.push(0, at(0, 0));
  jump.push(dt, at(limit + 1, 0));
  expect(jump.sample(1)!.x).toBe(limit + 1);
  expect(jump.sample(dt / 2)!.x).toBe(limit + 1);
});

test('les valeurs de la limite : 304 px en 50 ms, 352 px en 100 ms (8 cases de plus que ce que le café explique : 960 px/s)', () => {
  expect(TELEPORT_SNAP_PX).toBe(256);
  expect([jumpLimit(50), jumpLimit(100)]).toEqual([304, 352]);
});

test('la distance du saut est celle du segment, en diagonale aussi', () => {
  const diagonal = new SnapshotBuffer();
  diagonal.push(0, at(0, 0));
  diagonal.push(100, at(250, 250));                           // 354 px en diagonale : plus que 352
  expect(diagonal.sample(50)).toMatchObject({ x: 250, y: 250 });

  const glide = new SnapshotBuffer();
  glide.push(0, at(0, 0));
  glide.push(100, at(240, 240));                              // 339 px : il glisse
  expect(glide.sample(50)).toMatchObject({ x: 120, y: 120 });
});

test('après une attente, le segment dure REMOTE_RENDER_DELAY_MS : la limite du saut est celle de cette durée, pas de toute l\'attente', () => {
  const limit = jumpLimit(REMOTE_RENDER_DELAY_MS);
  const glide = new SnapshotBuffer();
  glide.push(0, at(0, 0, 'right', false));
  glide.push(5000, at(limit, 0));
  expect(glide.sample(5000 - REMOTE_RENDER_DELAY_MS / 2)!.x).toBe(limit / 2);

  // Comptée sur toute l'attente (5 s), la marche expliquerait 800 px : la personne était immobile, puis a sauté.
  const jump = new SnapshotBuffer();
  jump.push(0, at(0, 0, 'right', false));
  jump.push(5000, at(limit + 1, 0));
  expect(jump.sample(5000 - REMOTE_RENDER_DELAY_MS / 2)!.x).toBe(limit + 1);
});

test('deux instantanés de la même heure (des ticks arrivés ensemble) : le plus récent compte, sans division par zéro', () => {
  const b = new SnapshotBuffer();
  b.push(0, at(0, 0));
  b.push(0, at(8, 0));
  b.push(100, at(24, 0));
  expect(b.sample(-1)!.x).toBe(0);
  expect(b.sample(0)!.x).toBe(8);
  expect(b.sample(50)!.x).toBe(16);
});

test('la capacité garde les plus récents', () => {
  const b = new SnapshotBuffer(3);
  for (let i = 0; i < 10; i++) b.push(i * 100, at(i, 0, 'right', false));
  expect(b.size()).toBe(3);
  expect(b.sample(-1)!.x).toBe(7);                            // le plus ancien gardé
  expect(b.sample(850)!.x).toBe(8.5);
  expect(b.sample(10_000)!.x).toBe(9);
});

test('après une attente (personne immobile, tick en retard ou perdu) : il repart de là où on le voit, sans sauter', () => {
  const b = new SnapshotBuffer();
  b.push(0, at(0, 0, 'right', false));
  // Le suivant arrive 2 s plus tard : depuis longtemps, on le dessine au premier point (l'heure de rendu a dépassé le dernier
  // instantané). Il glisse vers le nouveau en REMOTE_RENDER_DELAY_MS, à partir de l'heure de rendu de l'arrivée.
  b.push(2000, at(16, 0, 'right', true));
  const renderAtArrival = 2000 - REMOTE_RENDER_DELAY_MS;
  expect(b.sample(renderAtArrival - 500)!.x).toBe(0);
  expect(b.sample(renderAtArrival)!.x).toBe(0);
  expect(b.sample(renderAtArrival + REMOTE_RENDER_DELAY_MS / 2)!.x).toBe(8);
  expect(b.sample(2000)!.x).toBe(16);

  // Un instantané qui arrive à l'heure (ou en avance) ne change rien : on glisse depuis le précédent.
  const onTime = new SnapshotBuffer();
  onTime.push(0, at(0, 0));
  onTime.push(80, at(16, 0));
  expect(onTime.sample(40)!.x).toBe(8);
  expect(onTime.size()).toBe(2);
});

test('l\'arrêt sur image ne garde que le dernier instantané ; les suivants repartent de lui', () => {
  const b = new SnapshotBuffer();
  b.push(0, at(0, 0, 'right', false));
  b.push(100, at(16, 0, 'right', false));
  b.push(200, at(32, 0, 'right', false));
  b.snapToLatest();
  expect(b.size()).toBe(1);
  expect(b.sample(0)!.x).toBe(32);
  b.push(5000, at(48, 0));
  expect(b.sample(5000 - REMOTE_RENDER_DELAY_MS)!.x).toBe(32);
  expect(b.sample(5000)!.x).toBe(48);
});

test('un instantané daté d\'avant le dernier est rangé à l\'heure du dernier : le temps ne recule pas', () => {
  const b = new SnapshotBuffer();
  b.push(100, at(0, 0));
  b.push(50, at(16, 0));
  expect(b.sample(100)!.x).toBe(16);
  expect(b.sample(99)!.x).toBe(0);
});

test('l\'instantané rendu est une copie : le modifier ne change pas le tampon', () => {
  const b = new SnapshotBuffer();
  const pushed = at(5, 5);
  b.push(0, pushed);
  pushed.x = 50;
  const sampled = b.sample(0)!;
  sampled.x = 99;
  expect(b.sample(0)!.x).toBe(5);
});

// ---- Extrapolation courte (décision du contrôleur, tâche 15) -------------------------------------------------------------------

// Ce que l'avatar parcourt au plus au-delà du dernier instantané : EXTRAPOLATION_MAX_MS à la vitesse qu'on lui lit, au plus celle du café
// (MAX_SPEED_PX_PER_S, 57,6 px) ; à la marche (WALK_SPEED_PX_PER_S), 19,2 px ; à la course (NORMAL_MAX_SPEED_PX_PER_S), 28,8 px.
const EXTRAPOLATED_PX = (WALK_SPEED_PX_PER_S * EXTRAPOLATION_MAX_MS) / 1000;
const RUN_EXTRAPOLATED_PX = (NORMAL_MAX_SPEED_PX_PER_S * EXTRAPOLATION_MAX_MS) / 1000;
const MAX_EXTRAPOLATED_PX = (MAX_SPEED_PX_PER_S * EXTRAPOLATION_MAX_MS) / 1000;
// Une marche : ce que WALK_SPEED_PX_PER_S fait parcourir en 100 ms (32 px).
const WALKED_PX = (WALK_SPEED_PX_PER_S * 100) / 1000;
const walking = () => {
  const b = new SnapshotBuffer();
  b.push(0, at(0, 0));
  b.push(100, at(WALKED_PX, 0));                              // 320 px/s vers la droite
  return b;
};

test('EXTRAPOLATION_MAX_MS couvre l\'attente que laisse un tick vide (deux positions à 200 ms d\'écart, dessinées avec 150 ms de retard)', () => {
  expect(EXTRAPOLATION_MAX_MS).toBe(60);
  expect(EXTRAPOLATION_MAX_MS).toBeGreaterThanOrEqual(2 * WORLD_TICK_MS - REMOTE_RENDER_DELAY_MS);
  expect(EXTRAPOLATED_PX).toBeCloseTo(19.2);
});

test('en marche, au-delà du dernier instantané : il continue à la vitesse des deux derniers', () => {
  const b = walking();
  const s = b.sample(130)!;
  expect(s.x).toBeCloseTo(WALKED_PX + 0.32 * 30);
  expect(s).toMatchObject({ y: 0, dir: 'right', moving: true });

  // Plus lent que la marche (un rattrapage, un segment étiré) : sa vitesse à lui.
  const slow = new SnapshotBuffer();
  slow.push(0, at(0, 100, 'up'));
  slow.push(100, at(0, 92, 'up'));                            // 80 px/s vers le haut
  expect(slow.sample(150)!.y).toBeCloseTo(92 - 0.08 * 50);
});

test('au plus EXTRAPOLATION_MAX_MS, puis il reste au point extrapolé', () => {
  const b = walking();
  expect(b.sample(100 + EXTRAPOLATION_MAX_MS)!.x).toBeCloseTo(WALKED_PX + EXTRAPOLATED_PX);
  expect(b.sample(100 + EXTRAPOLATION_MAX_MS + 1)!.x).toBeCloseTo(WALKED_PX + EXTRAPOLATED_PX);
  expect(b.sample(60_000)!.x).toBeCloseTo(WALKED_PX + EXTRAPOLATED_PX);
});

test('arrêté, jamais extrapolé', () => {
  const b = new SnapshotBuffer();
  b.push(0, at(0, 0));
  b.push(100, at(16, 0, 'right', false));
  expect(b.sample(130)).toEqual(at(16, 0, 'right', false));
  expect(b.sample(60_000)).toEqual(at(16, 0, 'right', false));
});

test('en marche sans avancer (contre un mur : deux instantanés au même endroit) : pas d\'extrapolation', () => {
  const b = new SnapshotBuffer();
  b.push(0, at(16, 0));
  b.push(100, at(16, 0));
  expect(b.sample(500)!.x).toBe(16);
});

test('un avatar qui court (480 px/s) est extrapolé à sa vitesse, pas à celle de la marche', () => {
  const b = new SnapshotBuffer();
  b.push(0, at(0, 0));
  b.push(100, at(48, 0));                                     // 480 px/s vers la droite : la course
  expect(b.sample(130)!.x).toBeCloseTo(48 + 0.48 * 30);
  expect(b.sample(1000)!.x).toBeCloseTo(48 + RUN_EXTRAPOLATED_PX);
});

test.each([
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0],
] as const)('un seul instantané connu, en marche (%s) : dans sa direction, à WALK_SPEED_PX_PER_S', (dir, dx, dy) => {
  const b = new SnapshotBuffer();
  b.push(0, at(100, 100, dir));
  const s = b.sample(30)!;
  expect(s.x).toBeCloseTo(100 + dx * 0.32 * 30);
  expect(s.y).toBeCloseTo(100 + dy * 0.32 * 30);
  expect(b.sample(1000)!.x).toBeCloseTo(100 + dx * EXTRAPOLATED_PX);
  expect(b.sample(1000)!.y).toBeCloseTo(100 + dy * EXTRAPOLATED_PX);
});

test('la vitesse des deux derniers est plafonnée à MAX_SPEED_PX_PER_S (la course sous café), sans changer de direction', () => {
  const fast = new SnapshotBuffer();
  fast.push(0, at(0, 0));
  fast.push(100, at(120, 0));                                 // 1 200 px/s : un rattrapage, plus vite que le café
  expect(fast.sample(1000)!.x).toBeCloseTo(120 + MAX_EXTRAPOLATED_PX);

  const diagonal = new SnapshotBuffer();
  diagonal.push(0, at(0, 0));
  diagonal.push(100, at(72, 96));                             // 1 200 px/s en diagonale (3, 4)
  const s = diagonal.sample(1000)!;
  expect(s.x).toBeCloseTo(72 + MAX_EXTRAPOLATED_PX * 0.6);
  expect(s.y).toBeCloseTo(96 + MAX_EXTRAPOLATED_PX * 0.8);
});

test('les deux derniers à la même heure, ou un saut entre eux : pas de vitesse à lire, sa direction à WALK_SPEED_PX_PER_S', () => {
  const bunched = new SnapshotBuffer();
  bunched.push(0, at(0, 0));
  bunched.push(0, at(8, 0, 'down'));
  expect(bunched.sample(30)).toMatchObject({ x: 8, y: expect.closeTo(0.32 * 30) });

  const jumped = new SnapshotBuffer();
  jumped.push(0, at(0, 0, 'right'));
  jumped.push(100, at(600, 0, 'left'));                       // un saut (plus que la limite : 352 px en 100 ms) : sa « vitesse » ne veut rien dire
  expect(jumped.sample(130)!.x).toBeCloseTo(600 - 0.32 * 30);
});

test('le suivant arrive : il repart du point dessiné, sans retour en arrière, puis suit les vrais instantanés', () => {
  const b = walking();
  expect(b.sample(130)!.x).toBeCloseTo(41.6);                 // extrapolé
  // Le suivant arrive à 280 : l'heure de rendu de l'arrivée est 130 (avec 150 ms de retard).
  b.push(130 + REMOTE_RENDER_DELAY_MS, at(64, 0));
  expect(b.sample(130)!.x).toBeCloseTo(41.6);                 // toujours là : pas de retour à 32
  expect(b.sample(130 + REMOTE_RENDER_DELAY_MS / 2)!.x).toBeCloseTo((41.6 + 64) / 2);
  expect(b.sample(130 + REMOTE_RENDER_DELAY_MS)!.x).toBe(64);
});

test('une téléportation saute toujours, même après une extrapolation', () => {
  const b = walking();
  expect(b.sample(250)!.x).toBeCloseTo(WALKED_PX + EXTRAPOLATED_PX);  // dessiné au point extrapolé, jusqu'à l'arrivée de la suite
  // La téléportation (annoncée par le serveur) arrive : l'heure de rendu de son arrivée est 250. Dès là, l'avatar est à 300, sans glisser.
  b.push(250 + REMOTE_RENDER_DELAY_MS, at(300, 0, 'right', false), true);
  expect(b.sample(250)!.x).toBe(300);
  expect(b.sample(300)!.x).toBe(300);
  expect(b.sample(60_000)!.x).toBe(300);
});

test('un arrêt reçu en retard : l\'avatar a dépassé le point d\'arrêt de 19,2 px au plus, et y revient en glissant', () => {
  const b = walking();
  // L'arrêt, au même endroit que le dernier instantané en marche, arrive 300 ms plus tard (son tick s'est perdu).
  b.push(400, at(WALKED_PX, 0, 'right', false));
  const renderAtArrival = 400 - REMOTE_RENDER_DELAY_MS;
  expect(b.sample(renderAtArrival)!.x).toBeCloseTo(WALKED_PX + EXTRAPOLATED_PX);
  expect(b.sample(renderAtArrival + REMOTE_RENDER_DELAY_MS / 2)!.x).toBeCloseTo(WALKED_PX + EXTRAPOLATED_PX / 2);
  expect(b.sample(400)).toEqual(at(WALKED_PX, 0, 'right', false));
  expect(b.sample(60_000)).toEqual(at(WALKED_PX, 0, 'right', false));
});

// ---- L'extrapolation bornée par la carte (décision du contrôleur, tâche 15) -----------------------------------------------------
//
// Avec la carte, un point extrapolé n'est pris que si la zone de collision de l'avatar (20 × 12 px aux pieds, AVATAR_BODY) n'y
// chevauche aucune case bloquante : l'avatar s'arrête au bord du mur, jamais au-delà, ni avant.

const devMap = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const bodyFits = (x: number, y: number) => avatarBodyFits(devMap, x, y);
const STEP: Record<Direction, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// Un avatar qui marche dans cette direction, dont la dernière position reçue est (x, y), 16 px plus loin que la précédente.
function walkingTo(x: number, y: number, dir: Direction, buffer = new SnapshotBuffer(20, bodyFits)): SnapshotBuffer {
  const [dx, dy] = STEP[dir];
  buffer.push(0, at(x - 16 * dx, y - 16 * dy, dir));
  buffer.push(100, at(x, y, dir));
  return buffer;
}

test.each([
  ['à droite, contre le mur de droite (x + 10 ≤ 736)', 726, 240, 'right'],
  ['à gauche, contre le mur de gauche (x − 10 ≥ 32)', 42, 240, 'left'],
  ['en bas, contre le mur du bas (y + 1 ≤ 480)', 80, 479, 'down'],
  ['en haut, contre le mur de la ligne 5 (y − 11 ≥ 192)', 80, 203, 'up'],
  ['en bas, contre le dessus d\'un bureau (y + 1 ≤ 288)', 150, 287, 'down'],
] as const)('arrivé contre un mur en marchant %s : jamais dessiné au-delà, même longtemps après', (_wall, x, y, dir) => {
  const b = walkingTo(x, y, dir);
  for (const renderAt of [101, 130, 100 + EXTRAPOLATION_MAX_MS, 60_000]) {
    const s = b.sample(renderAt)!;
    expect(s.x).toBeCloseTo(x, 2);
    expect(s.y).toBeCloseTo(y, 2);
    expect(bodyFits(s.x, s.y)).toBe(true);
    expect(s).toMatchObject({ dir, moving: true });
  }
});

test.each([
  ['à droite, 5 px avant le mur de droite', 721, 240, 'right', 726, 240],
  ['à gauche, 3 px avant le mur de gauche', 45, 240, 'left', 42, 240],
  ['en bas, 4 px avant le mur du bas', 80, 475, 'down', 80, 479],
  ['en haut, 2 px avant le mur de la ligne 5', 80, 205, 'up', 80, 203],
] as const)('en marchant %s : l\'extrapolation s\'arrête au bord, pas avant', (_case, x, y, dir, edgeX, edgeY) => {
  const b = walkingTo(x, y, dir);
  const s = b.sample(100 + EXTRAPOLATION_MAX_MS)!;
  expect(s.x).toBeCloseTo(edgeX, 2);
  expect(s.y).toBeCloseTo(edgeY, 2);
  expect(bodyFits(s.x, s.y)).toBe(true);
  // Avant d'y arriver, elle avance comme en plein espace.
  const early = b.sample(110)!;
  expect(early.x).toBeCloseTo(x + STEP[dir][0] * 0.16 * 10);
  expect(early.y).toBeCloseTo(y + STEP[dir][1] * 0.16 * 10);
});

test('en diagonale (un rattrapage), le long d\'un montant de porte : elle ne passe pas sur son coin', () => {
  // La porte de la colonne 3, ligne 5 (x de 96 à 128) ; son montant droit est la case (4, 5), de x = 128 et jusqu'à y = 192. Les
  // pieds en (121, 203) : le corps (x de 111 à 131, y de 192 à 204) touche le bas du montant sans le chevaucher. Vers le haut à
  // gauche, il le chevaucherait tout de suite (x + 10 > 128 et y − 11 < 192), puis le dépasserait : les deux bouts du segment
  // tiennent, pas son début. Par pas de 8 px, on ne le verrait pas.
  const b = new SnapshotBuffer(20, bodyFits);
  b.push(0, at(121 + 16 / Math.SQRT2, 203 + 16 / Math.SQRT2, 'up'));
  b.push(100, at(121, 203, 'up'));
  const end = { x: 121 - 9.6 / Math.SQRT2, y: 203 - 9.6 / Math.SQRT2 };
  expect(bodyFits(end.x, end.y)).toBe(true);
  expect(bodyFits(121 - 1, 203 - 1)).toBe(false);
  const s = b.sample(1000)!;
  expect(s.x).toBeCloseTo(121, 2);
  expect(s.y).toBeCloseTo(203, 2);
});

test('en plein espace, la carte ne change rien à l\'extrapolation', () => {
  const bounded = walkingTo(316, 240, 'right');
  const free = walkingTo(316, 240, 'right', new SnapshotBuffer());
  for (const renderAt of [50, 100, 130, 160, 60_000]) expect(bounded.sample(renderAt)).toEqual(free.sample(renderAt));
});

test('un seul instantané, en marche contre un mur : pas au-delà non plus', () => {
  const b = new SnapshotBuffer(20, bodyFits);
  b.push(0, at(726, 240, 'right'));
  expect(b.sample(1000)!.x).toBeCloseTo(726, 2);
});

test('une dernière position où le corps ne tient déjà pas (une autre version de la carte) : pas d\'extrapolation, même vers la sortie', () => {
  const deeper = new SnapshotBuffer(20, bodyFits);
  deeper.push(0, at(30, 240, 'left'));
  deeper.push(100, at(20, 240, 'left'));                      // dans le mur de gauche, en s'y enfonçant
  expect(deeper.sample(1000)).toEqual(at(20, 240, 'left'));

  // Le corps chevauche le mur (x − 10 = 30 < 32) ; 2 px plus loin, il tiendrait. On ne devine pas pour autant : on attend la suite.
  const leaving = new SnapshotBuffer(20, bodyFits);
  leaving.push(0, at(24, 240));
  leaving.push(100, at(40, 240));
  expect(leaving.sample(1000)).toEqual(at(40, 240));
});

test('le suivant arrive après une extrapolation bornée : il repart du bord, sans retour en arrière', () => {
  const b = walkingTo(721, 240, 'right');
  expect(b.sample(130 + 30)!.x).toBeCloseTo(726, 2);
  // L'arrêt, contre le mur, arrive : il était dessiné au bord, il y reste.
  b.push(160 + REMOTE_RENDER_DELAY_MS, at(726, 240, 'right', false));
  expect(b.sample(160)!.x).toBeCloseTo(726, 2);
  expect(b.sample(60_000)).toEqual(at(726, 240, 'right', false));
});

// ---- La vitesse du café (jusqu'à 960 px/s) et la téléportation annoncée par le serveur ------------------------------------------

test('sous café (960 px/s), l\'avatar glisse sans saut même quand un tick n\'a rien pour lui : jamais plus de 40 px d\'une image (16 ms) à l\'autre, un saut en ferait 220', () => {
  const b = new SnapshotBuffer();
  // 240 px en 250 ms : 960 px/s, avec un tick manqué entre deux positions (les ticks sont toutes les 100 ms). Après l'attente, l'avatar rattrape
  // à plus que sa vitesse (l'extrapolation s'arrête à EXTRAPOLATION_MAX_MS) : 24 px par image, pas plus.
  for (let i = 0; i <= 8; i++) b.push(i * 250, at(i * 240, 0));
  let last = b.sample(0)!.x;
  for (let t = 16; t <= 2000; t += 16) {
    const x = b.sample(t)!.x;
    expect(x - last, `à ${t} ms`).toBeLessThanOrEqual(40);
    expect(x - last, `à ${t} ms`).toBeGreaterThanOrEqual(0);
    last = x;
  }
});

test('un instantané marqué « téléportation » saute tout de suite, même à deux cases, que la marche expliquerait', () => {
  const tp = new SnapshotBuffer();
  tp.push(0, at(0, 0, 'right', false));
  tp.push(100, at(64, 0, 'right', false), true);
  expect(tp.sample(1)!.x).toBe(64);
  expect(tp.sample(50)!.x).toBe(64);

  // Sans la marque, les mêmes 64 px se parcourent en glissant.
  const walk = new SnapshotBuffer();
  walk.push(0, at(0, 0, 'right', false));
  walk.push(100, at(64, 0, 'right', false));
  expect(walk.sample(50)!.x).toBe(32);
});

test('la vitesse n\'est pas lue à travers une téléportation : en marche après elle, l\'extrapolation repart de la marche', () => {
  const b = new SnapshotBuffer();
  b.push(0, at(0, 0, 'right', true));
  b.push(100, at(64, 0, 'right', true), true);
  // Sans la marque, 64 px en 100 ms (640 px/s) seraient lus ; avec elle, la direction du dernier, à la vitesse de la marche.
  expect(b.sample(100 + EXTRAPOLATION_MAX_MS)!.x).toBeCloseTo(64 + EXTRAPOLATED_PX);
});

test('l\'extrapolation d\'un avatar à 960 px/s s\'arrête au bord du mur, comme celle d\'un avatar qui marche', () => {
  const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
  const b = new SnapshotBuffer(20, (x, y) => avatarBodyFits(map, x, y));
  // Sur la ligne 7, du sol jusqu'au mur de droite (x = 736) : la zone de collision (20 px de large) y touche à x = 726.
  b.push(0, at(604, 240));
  b.push(100, at(700, 240));   // 960 px/s : la lancée ferait 757,6 px
  expect(b.sample(100 + EXTRAPOLATION_MAX_MS)!.x).toBeCloseTo(726, 2);
});
