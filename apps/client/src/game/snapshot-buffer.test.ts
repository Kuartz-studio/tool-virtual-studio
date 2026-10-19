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

test('un saut de plus de TELEPORT_SNAP_PX, au-delà de ce que la marche explique, fait sauter directement au second', () => {
  // En 100 ms, la marche (MAX_SPEED_PX_PER_S) fait 16 px : le saut est ce qui dépasse.
  const walked = (MAX_SPEED_PX_PER_S * 100) / 1000;
  const far = new SnapshotBuffer();
  far.push(0, at(0, 0));
  far.push(100, at(TELEPORT_SNAP_PX + walked + 1, 0));
  expect(far.sample(1)!.x).toBe(TELEPORT_SNAP_PX + walked + 1);

  const diagonal = new SnapshotBuffer();
  diagonal.push(0, at(0, 0));
  diagonal.push(100, at(80, 80));                             // 113 px en diagonale
  expect(diagonal.sample(50)).toMatchObject({ x: 80, y: 80 });

  const near = new SnapshotBuffer();
  near.push(0, at(0, 0));
  near.push(100, at(TELEPORT_SNAP_PX + walked, 0));
  expect(near.sample(50)!.x).toBe((TELEPORT_SNAP_PX + walked) / 2);

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
