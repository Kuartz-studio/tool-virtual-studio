import { CLIENT_MOVE_MAX_HZ, type Direction, type MovePayload } from '@bureau/shared';
import { expect, test } from 'vitest';
import { feetPayload, MoveSender, STOP_RESEND_MS } from './move-sender';

const m = (x: number, moving = true, dir: Direction = 'right'): MovePayload => ({ x, y: 0, dir, moving });

test('MoveSender', () => {
  const s = new MoveSender(10), m = (x: number, moving = true, dir: Direction = 'right') => ({ x, y: 0, dir, moving });
  expect(s.next(0, m(0))).toEqual(m(0));
  expect(s.next(50, m(5))).toBeNull();                       // < 100 ms
  expect(s.next(100, m(10))).toEqual(m(10));
  expect(s.next(120, m(12, true, 'up'))).toEqual(m(12, true, 'up'));     // changement de direction : immédiat
  expect(s.next(130, m(12, false, 'up'))).toEqual(m(12, false, 'up'));   // arrêt : immédiat
  expect(s.next(400, m(12, false, 'up'))).toBeNull();        // identique
});

test('un arrêt est renvoyé une seule fois, 500 ms après, si aucun nouvel état n\'a été produit entre-temps', () => {
  const s = new MoveSender(10);
  expect(STOP_RESEND_MS).toBe(500);
  expect(s.next(0, m(0))).toEqual(m(0));
  expect(s.next(130, m(12, false))).toEqual(m(12, false));
  expect(s.next(400, m(12, false))).toBeNull();
  expect(s.next(629, m(12, false))).toBeNull();
  // La seule exception à « jamais deux charges utiles identiques à la suite » : le même arrêt, une deuxième fois.
  expect(s.next(630, m(12, false))).toEqual(m(12, false));
  expect(s.next(1130, m(12, false))).toBeNull();
  expect(s.next(60_000, m(12, false))).toBeNull();
});

test('le renvoi de l\'arrêt attend le premier appel après les 500 ms (onglet en arrière-plan : pas d\'image entre-temps)', () => {
  const s = new MoveSender(10);
  s.next(0, m(0, false));
  expect(s.next(5000, m(0, false))).toEqual(m(0, false));
  expect(s.next(5600, m(0, false))).toBeNull();
});

test('un nouvel état envoyé avant les 500 ms annule le renvoi ; le prochain arrêt a le sien', () => {
  const s = new MoveSender(10);
  s.next(0, m(0, false));
  expect(s.next(300, m(0, true))).toEqual(m(0, true));       // repart : immédiat
  expect(s.next(600, m(0, true))).toBeNull();                // contre un mur : la position ne change pas
  expect(s.next(700, m(0, true))).toBeNull();
  expect(s.next(800, m(0, false))).toEqual(m(0, false));     // nouvel arrêt
  expect(s.next(1299, m(0, false))).toBeNull();
  expect(s.next(1300, m(0, false))).toEqual(m(0, false));    // son renvoi
});

test('en marche, une position qui ne change pas (un mur) n\'envoie rien, même longtemps', () => {
  const s = new MoveSender(10);
  s.next(0, m(40));
  for (let now = 100; now <= 5000; now += 16) expect(s.next(now, m(40))).toBeNull();
});

test('en marche, au plus un envoi par 1000 / maxHz ms, mesurés depuis le dernier envoi', () => {
  const s = new MoveSender(10);
  const sent: number[] = [];
  // 60 images par seconde pendant 2 s, en marche vers la droite à 160 px/s.
  for (let frame = 0; frame <= 120; frame++) {
    const now = (frame * 1000) / 60;
    if (s.next(now, m(Math.floor((160 * now) / 1000)))) sent.push(now);
  }
  for (let i = 1; i < sent.length; i++) expect(sent[i]! - sent[i - 1]!).toBeGreaterThanOrEqual(100 - 1e-9);
  expect(sent.length).toBeGreaterThanOrEqual(16);
  expect(sent.length).toBeLessThanOrEqual(21);
});

test('par défaut, la cadence est CLIENT_MOVE_MAX_HZ', () => {
  const s = new MoveSender();
  const period = 1000 / CLIENT_MOVE_MAX_HZ;
  s.next(0, m(0));
  expect(s.next(period - 1, m(5))).toBeNull();
  expect(s.next(period, m(6))).toEqual(m(6));
});

test('reset() : le prochain état part tout de suite, même identique au dernier envoyé (après un move:correct ou un init)', () => {
  const s = new MoveSender(10);
  s.next(0, m(12, false));
  expect(s.next(10, m(12, false))).toBeNull();
  s.reset();
  expect(s.next(20, m(12, false))).toEqual(m(12, false));
  // Puis les règles habituelles : identique, il ne repart pas (sauf le renvoi de l'arrêt, 500 ms plus tard).
  expect(s.next(30, m(12, false))).toBeNull();
  // Après reset, un état en marche part aussi sans attendre la cadence.
  s.next(40, m(12, true));
  s.reset();
  expect(s.next(41, m(13, true))).toEqual(m(13, true));
});

test('feetPayload : les pieds arrondis vers le bas, jamais au plus proche (le serveur les place dans la case floor(v / 32))', () => {
  expect(feetPayload(479.6, 287.99, 'down', false)).toEqual({ x: 479, y: 287, dir: 'down', moving: false });
  expect(feetPayload(42, 203, 'left', true)).toEqual({ x: 42, y: 203, dir: 'left', moving: true });
  expect(feetPayload(95.5, 0.4, 'up', true)).toEqual({ x: 95, y: 0, dir: 'up', moving: true });
});

test('la charge utile rendue est une copie : la modifier ne change pas la mémoire de l\'envoyeur', () => {
  const s = new MoveSender(10);
  const state = m(0, false);
  const sent = s.next(0, state)!;
  expect(sent).not.toBe(state);
  sent.x = 99;
  state.x = 77;
  expect(s.next(10, m(0, false))).toBeNull();
});
