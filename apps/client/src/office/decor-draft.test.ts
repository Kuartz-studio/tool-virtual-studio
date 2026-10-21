import { DEFAULT_DESK_DECOR, DESK_ROOM, checkDecor, type DeskDecor } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { anchorFor, planPlace, removeAt, sameDecor, tryPlace } from './decor-draft';

const empty: DeskDecor = { floor: 'sable', wall: 'creme', items: [] };

describe('anchorFor : le pointeur est au milieu du bas de l\'empreinte', () => {
  test('un élément de 3 cases de large : la case du pointeur est celle du milieu', () => {
    expect(anchorFor('of-7-28', { x: 4, y: 3 })).toEqual({ x: 3, y: 2 });   // bureau 3 × 2 : le pointeur à sa rangée du bas
  });

  test('un élément qu\'on ne peut pas tenir dehors : il est ramené dans la pièce', () => {
    expect(anchorFor('of-7-28', { x: 0, y: 3 })).toEqual({ x: 0, y: 2 });
    expect(anchorFor('of-7-28', { x: DESK_ROOM.width - 1, y: 3 })).toEqual({ x: DESK_ROOM.width - 3, y: 2 });
  });

  test('un élément mural suit la colonne du pointeur, collé au mur', () => {
    expect(anchorFor('of-9-12', { x: 4, y: 5 })).toEqual({ x: 4, y: 0 });
  });

  test('un élément inconnu : rien', () => {
    expect(anchorFor('nope', { x: 1, y: 1 })).toBeNull();
  });
});

describe('tryPlace / removeAt', () => {
  test('poser un élément valable l\'ajoute, sans toucher au reste', () => {
    const result = tryPlace(empty, 'of-7-28', { x: 2, y: 1 });
    expect(result).toEqual({ ok: true, decor: { ...empty, items: [{ id: 'of-7-28', x: 2, y: 1 }] } });
    expect(empty.items).toEqual([]);
  });

  test('un geste qui rendrait la pièce invalide est refusé, avec la raison de checkDecor', () => {
    const desk = tryPlace(empty, 'of-7-28', { x: 2, y: 1 });
    if (!desk.ok) throw new Error('attendu : valable');
    expect(tryPlace(desk.decor, 'of-7-28', { x: 3, y: 2 })).toEqual({ ok: false, error: 'overlap' });
    expect(tryPlace(empty, 'of-7-28', { x: 8, y: 1 })).toEqual({ ok: false, error: 'out_of_room' });
    expect(tryPlace(empty, 'of-7-28', { x: DESK_ROOM.doorX - 1, y: DESK_ROOM.height - 2 })).toMatchObject({ ok: false });
  });

  test('ce que l\'éditeur accepte, le serveur l\'accepte : tout résultat de tryPlace passe checkDecor', () => {
    const result = tryPlace(DEFAULT_DESK_DECOR, 'of-0-8', { x: 1, y: 5 });
    if (!result.ok) throw new Error('attendu : valable');
    expect(checkDecor(result.decor)).toEqual({ ok: true });
  });

  test('removeAt retire l\'élément n° i', () => {
    expect(removeAt(DEFAULT_DESK_DECOR, 0).items).toEqual(DEFAULT_DESK_DECOR.items.slice(1));
  });
});

test('sameDecor : mêmes thèmes et mêmes éléments, dans le même ordre', () => {
  expect(sameDecor(DEFAULT_DESK_DECOR, { ...DEFAULT_DESK_DECOR, items: [...DEFAULT_DESK_DECOR.items] })).toBe(true);
  expect(sameDecor(DEFAULT_DESK_DECOR, { ...DEFAULT_DESK_DECOR, floor: 'sable' })).toBe(false);
  expect(sameDecor(DEFAULT_DESK_DECOR, removeAt(DEFAULT_DESK_DECOR, 2))).toBe(false);
});

describe('planPlace : poser, remplacer ou refuser', () => {
  const withDesk: DeskDecor = { ...empty, items: [{ id: 'of-7-28', x: 2, y: 1 }, { id: 'of-14-12', x: 3, y: 1 }] };

  test('sur du vide : on pose', () => {
    expect(planPlace(empty, 'of-7-28', { x: 2, y: 1 })).toEqual({ kind: 'place', decor: { ...empty, items: [{ id: 'of-7-28', x: 2, y: 1 }] } });
  });

  test('sur un élément de la même sorte : remplacer, avec le rang de ce qui part et la pièce qu\'on aurait', () => {
    const plan = planPlace(withDesk, 'of-6-10', { x: 3, y: 2 });
    expect(plan).toEqual({ kind: 'replace', replacing: [0], decor: { ...empty, items: [{ id: 'of-14-12', x: 3, y: 1 }, { id: 'of-6-10', x: 3, y: 2 }] } });
    // La pièce qu'on aurait est valable pour le serveur aussi.
    if (plan.kind !== 'replace') throw new Error('attendu : remplacer');
    expect(checkDecor(plan.decor)).toEqual({ ok: true });
  });

  test('un objet posé sur un meuble : on pose, on ne remplace pas (autre sorte)', () => {
    expect(planPlace({ ...empty, items: [{ id: 'of-7-28', x: 2, y: 1 }] }, 'of-14-12', { x: 3, y: 1 })).toMatchObject({ kind: 'place' });
  });

  test('un remplacement qui rendrait la pièce invalide est refusé, avec la raison', () => {
    const door = { x: DESK_ROOM.doorX, y: DESK_ROOM.height - 1 };
    expect(planPlace({ ...empty, items: [{ id: 'of-6-10', ...door }] }, 'of-7-28', { x: door.x - 1, y: door.y - 1 })).toEqual({ kind: 'refused', error: 'blocks_door' });
  });

  test('hors de la pièce : refusé, même sans rien à remplacer', () => {
    expect(planPlace(empty, 'of-7-28', { x: 8, y: 1 })).toEqual({ kind: 'refused', error: 'out_of_room' });
  });

  test('remplacer plusieurs éléments à la fois : tous ceux que l\'empreinte touche partent', () => {
    const two: DeskDecor = { ...empty, items: [{ id: 'of-6-10', x: 2, y: 2 }, { id: 'of-6-10', x: 4, y: 2 }, { id: 'of-6-10', x: 6, y: 4 }] };
    const plan = planPlace(two, 'of-7-28', { x: 2, y: 1 });
    expect(plan).toMatchObject({ kind: 'replace', replacing: [0, 1] });
  });
});
