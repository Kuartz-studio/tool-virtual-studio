import { MAX_SPEED_PX_PER_S, REMOTE_RENDER_DELAY_MS, TELEPORT_SNAP_PX } from '@bureau/shared';
import { expect, test } from 'vitest';
import { SnapshotBuffer, type Snapshot } from './snapshot-buffer';

test('SnapshotBuffer : interpolation, bornes, téléportation, capacité', () => {
  const b = new SnapshotBuffer(); const s = (x: number): Snapshot => ({ x, y: 0, dir: 'right', moving: true });
  b.push(0, s(0)); b.push(100, s(100));
  expect(b.sample(50)!.x).toBe(50); expect(b.sample(-10)!.x).toBe(0); expect(b.sample(500)!.x).toBe(100);
  b.snapToLatest(); expect(b.sample(50)!.x).toBe(100);       // retour sur l'onglet
  const t = new SnapshotBuffer(); t.push(0, s(0)); t.push(100, s(200)); expect(t.sample(50)!.x).toBe(200);
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

// La règle du saut : distance(a, b) > TELEPORT_SNAP_PX + MAX_SPEED_PX_PER_S × (b.at − a.at) / 1000. Ce que la marche peut expliquer
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

test('les valeurs de la limite : 104 px en 50 ms, 112 px en 100 ms (le test du brief : 100 px glissent, 200 px sautent)', () => {
  expect(TELEPORT_SNAP_PX).toBe(96);
  expect([jumpLimit(50), jumpLimit(100)]).toEqual([104, 112]);
});

test('la distance du saut est celle du segment, en diagonale aussi', () => {
  const diagonal = new SnapshotBuffer();
  diagonal.push(0, at(0, 0));
  diagonal.push(100, at(80, 80));                             // 113 px en diagonale : plus que 112
  expect(diagonal.sample(50)).toMatchObject({ x: 80, y: 80 });

  const glide = new SnapshotBuffer();
  glide.push(0, at(0, 0));
  glide.push(100, at(78, 78));                                // 110 px : il glisse
  expect(glide.sample(50)).toMatchObject({ x: 39, y: 39 });
});

test('après une attente, le segment dure REMOTE_RENDER_DELAY_MS : la limite du saut est celle de cette durée, pas de toute l\'attente', () => {
  const limit = jumpLimit(REMOTE_RENDER_DELAY_MS);
  const glide = new SnapshotBuffer();
  glide.push(0, at(0, 0));
  glide.push(5000, at(limit, 0));
  expect(glide.sample(5000 - REMOTE_RENDER_DELAY_MS / 2)!.x).toBe(limit / 2);

  // Comptée sur toute l'attente (5 s), la marche expliquerait 800 px : la personne était immobile, puis a sauté.
  const jump = new SnapshotBuffer();
  jump.push(0, at(0, 0));
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
  for (let i = 0; i < 10; i++) b.push(i * 100, at(i, 0));
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
  b.push(0, at(0, 0));
  b.push(100, at(16, 0));
  b.push(200, at(32, 0));
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
