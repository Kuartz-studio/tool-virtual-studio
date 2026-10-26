import { DEFAULT_DESK_DECOR, DESK_ROOMS, buildOfficeTiledMap, buildTiledMap, checkDecor, defaultDeskDecor, parseOfficeMap, type DeskDecor, type DeskRoomSpec } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { anchorFor, handleOf, planPlace, removeAt, roomOfDesk, sameDecor, tryPlace } from './decor-draft';

const empty: DeskDecor = { floor: 'sable', wall: 'creme', items: [] };
const standard = DESK_ROOMS.standard;
const compact = DESK_ROOMS.compact;
const compactNorth: DeskRoomSpec = { ...compact, door: { ...compact.door, side: 'north' } };

// Une carte à deux places compactes : A5, sa porte au sud ; A6, sa porte au nord de la pièce.
const ROWS = Array.from({ length: 24 }, (_, y) => (y === 0 || y === 23 ? '#'.repeat(30) : `#${'.'.repeat(28)}#`));
const MAP = parseOfficeMap(
  buildTiledMap({
    ascii: ROWS,
    zones: [
      { type: 'desk', name: 'A5', x: 12, y: 2, w: 6, h: 7 },
      { type: 'door', name: 'A5', x: 14, y: 9, w: 2, h: 2 },
      { type: 'desk', name: 'A6', x: 12, y: 15, w: 6, h: 7 },
      { type: 'door', name: 'A6', x: 14, y: 13, w: 2, h: 2 },
      { type: 'desk', name: 'B1', x: 1, y: 2, w: 4, h: 3 },
      { type: 'spawn', x: 25, y: 12, w: 1, h: 1 },
    ],
    tileset: { name: 'dev', image: 'tiles.png' },
  }),
);

describe('roomOfDesk : la pièce de la place, lue sur la carte', () => {
  test('une place de la carte : sa taille et le côté de sa porte', () => {
    expect(roomOfDesk(MAP, 'A5')).toEqual(compact);
    expect(roomOfDesk(MAP, 'A6')).toEqual(compactNorth);
  });

  test('sans carte, une place inconnue ou sans porte : la pièce standard', () => {
    expect(roomOfDesk(null, 'A5')).toEqual(standard);
    expect(roomOfDesk(MAP, 'Z9')).toEqual(standard);
    expect(roomOfDesk(MAP, 'B1')).toEqual(standard);
  });
});

// Les points sont ceux du pointeur, en cases de la pièce : { x: 4.5, y: 3.5 } est le milieu de la case 4, 3.
describe('anchorFor : le pointeur tient le milieu du bas de l\'empreinte', () => {
  test('à la case près, un élément de 3 cases de large : la case du pointeur est celle du milieu', () => {
    expect(anchorFor('of-7-28', { x: 4.5, y: 3.5 }, standard, 'cell')).toEqual({ x: 3, y: 2 });   // bureau 3 × 2 : le pointeur à sa rangée du bas
    expect(anchorFor('of-7-28', { x: 4.1, y: 3.9 }, standard, 'cell')).toEqual({ x: 3, y: 2 });   // n'importe où dans la case
  });

  test('au dixième de case, l\'élément suit le pointeur, arrondi au dixième le plus proche', () => {
    expect(anchorFor('of-7-28', { x: 4.5, y: 3.5 }, standard, 'free')).toEqual({ x: 3, y: 2 });
    expect(anchorFor('of-7-28', { x: 4.83, y: 3.14 }, standard, 'free')).toEqual({ x: 3.3, y: 1.6 });
    expect(anchorFor('of-6-10', { x: 2.26, y: 4.5 }, standard, 'free')).toEqual({ x: 1.8, y: 4 });   // plante 1 × 1 au sol
  });

  test('un élément qu\'on ne peut pas tenir dehors : il est ramené dans la pièce, dans les deux sens', () => {
    for (const snap of ['cell', 'free'] as const) {
      expect(anchorFor('of-7-28', { x: 0.5, y: 3.5 }, standard, snap)).toEqual({ x: 0, y: 2 });
      expect(anchorFor('of-7-28', { x: standard.width - 0.5, y: 3.5 }, standard, snap)).toEqual({ x: standard.width - 3, y: 2 });
      expect(anchorFor('of-7-28', { x: 4.5, y: 0.2 }, standard, snap)).toEqual({ x: 3, y: 0 });
      expect(anchorFor('of-7-28', { x: 4.5, y: standard.height + 3 }, standard, snap)).toEqual({ x: 3, y: standard.height - 2 });
    }
  });

  test('dans une pièce compacte, c\'est la largeur de la pièce compacte qui ramène l\'élément', () => {
    expect(anchorFor('of-7-28', { x: compact.width - 0.5, y: 3.5 }, compact, 'cell')).toEqual({ x: compact.width - 3, y: 2 });
    expect(anchorFor('of-7-28', { x: compact.width - 0.5, y: 3.5 }, standard, 'cell')).toEqual({ x: compact.width - 2, y: 2 });
  });

  test('un élément mural suit le pointeur, collé au mur', () => {
    expect(anchorFor('of-9-12', { x: 5.2, y: 5.5 }, standard, 'cell')).toEqual({ x: 4, y: 0 });   // 2 cases de large : à cheval sur le pointeur
    expect(anchorFor('of-9-12', { x: 5.27, y: -1 }, standard, 'free')).toEqual({ x: 4.3, y: 0 });
  });

  test('un élément inconnu : rien', () => {
    expect(anchorFor('nope', { x: 1, y: 1 }, standard, 'cell')).toBeNull();
  });

  test('handleOf donne le point que anchorFor ramène à la même place : reprendre un élément ne le déplace pas', () => {
    for (const at of [{ x: 2.3, y: 1.7 }, { x: 0, y: 0 }, { x: 5.9, y: 4.1 }]) expect(anchorFor('of-7-28', handleOf('of-7-28', at)!, standard, 'free')).toEqual(at);
    expect(handleOf('nope', { x: 0, y: 0 })).toBeNull();
  });
});

describe('placement libre : au dixième de case, mêmes règles', () => {
  test('un élément se pose au dixième près, tout contre un autre ; un chevauchement d\'un dixième se remplace', () => {
    const desk = tryPlace(empty, 'of-7-28', { x: 0.4, y: 1.3 }, standard);
    if (!desk.ok) throw new Error('attendu : valable');
    expect(planPlace(desk.decor, 'of-6-10', { x: 3.4, y: 2.3 }, standard)).toMatchObject({ kind: 'place' });
    expect(planPlace(desk.decor, 'of-6-10', { x: 3.3, y: 2.3 }, standard)).toMatchObject({ kind: 'replace', replacing: [0] });
  });

  test('ce que l\'éditeur accepte au dixième, le serveur l\'accepte aussi', () => {
    const plan = planPlace(DEFAULT_DESK_DECOR, 'of-6-10', anchorFor('of-6-10', { x: 1.37, y: 5.62 }, standard, 'free')!, standard);
    if (plan.kind !== 'place') throw new Error('attendu : poser');
    expect(checkDecor(plan.decor, standard)).toEqual({ ok: true });
  });
});

describe('tryPlace / removeAt', () => {
  test('poser un élément valable l\'ajoute, sans toucher au reste', () => {
    const result = tryPlace(empty, 'of-7-28', { x: 2, y: 1 }, standard);
    expect(result).toEqual({ ok: true, decor: { ...empty, items: [{ id: 'of-7-28', x: 2, y: 1 }] } });
    expect(empty.items).toEqual([]);
  });

  test('un geste qui rendrait la pièce invalide est refusé, avec la raison de checkDecor', () => {
    const desk = tryPlace(empty, 'of-7-28', { x: 2, y: 1 }, standard);
    if (!desk.ok) throw new Error('attendu : valable');
    expect(tryPlace(desk.decor, 'of-7-28', { x: 3, y: 2 }, standard)).toEqual({ ok: false, error: 'overlap' });
    expect(tryPlace(empty, 'of-7-28', { x: 8, y: 1 }, standard)).toEqual({ ok: false, error: 'out_of_room' });
    expect(tryPlace(empty, 'of-7-28', { x: standard.door.x - 1, y: standard.height - 2 }, standard)).toMatchObject({ ok: false });
  });

  test('une pièce compacte refuse ce qui dépasse sa largeur, et ce qui mure sa porte', () => {
    expect(tryPlace(empty, 'of-7-28', { x: 4, y: 1 }, compact)).toEqual({ ok: false, error: 'out_of_room' });
    expect(tryPlace(empty, 'of-7-28', { x: 4, y: 1 }, standard)).toMatchObject({ ok: true });
    expect(tryPlace(empty, 'of-7-28', { x: compact.door.x - 1, y: compact.height - 2 }, compact)).toEqual({ ok: false, error: 'blocks_door' });
  });

  test('une porte au nord : un élément mural au-dessus d\'elle est refusé, à côté il est permis', () => {
    expect(tryPlace(empty, 'of-15-0', { x: compactNorth.door.x, y: 0 }, compactNorth)).toEqual({ ok: false, error: 'blocks_door' });
    expect(tryPlace(empty, 'of-15-0', { x: compactNorth.door.x + compactNorth.door.width, y: 0 }, compactNorth)).toMatchObject({ ok: true });
  });

  test('ce que l\'éditeur accepte, le serveur l\'accepte : tout résultat de tryPlace passe checkDecor', () => {
    const result = tryPlace(DEFAULT_DESK_DECOR, 'of-0-8', { x: 1, y: 5 }, standard);
    if (!result.ok) throw new Error('attendu : valable');
    expect(checkDecor(result.decor, standard)).toEqual({ ok: true });
    const small = tryPlace(empty, 'of-7-28', { x: 1, y: 1 }, compact);
    if (!small.ok) throw new Error('attendu : valable');
    expect(checkDecor(small.decor, compact)).toEqual({ ok: true });
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
    expect(planPlace(empty, 'of-7-28', { x: 2, y: 1 }, standard)).toEqual({ kind: 'place', decor: { ...empty, items: [{ id: 'of-7-28', x: 2, y: 1 }] } });
  });

  test('sur un élément de la même sorte : remplacer, avec le rang de ce qui part et la pièce qu\'on aurait', () => {
    const plan = planPlace(withDesk, 'of-6-10', { x: 3, y: 2 }, standard);
    expect(plan).toEqual({ kind: 'replace', replacing: [0], decor: { ...empty, items: [{ id: 'of-14-12', x: 3, y: 1 }, { id: 'of-6-10', x: 3, y: 2 }] } });
    // La pièce qu'on aurait est valable pour le serveur aussi.
    if (plan.kind !== 'replace') throw new Error('attendu : remplacer');
    expect(checkDecor(plan.decor, standard)).toEqual({ ok: true });
  });

  test('un objet posé sur un meuble : on pose, on ne remplace pas (autre sorte)', () => {
    expect(planPlace({ ...empty, items: [{ id: 'of-7-28', x: 2, y: 1 }] }, 'of-14-12', { x: 3, y: 1 }, standard)).toMatchObject({ kind: 'place' });
  });

  test('un remplacement qui rendrait la pièce invalide est refusé, avec la raison', () => {
    const door = { x: standard.door.x, y: standard.height - 1 };
    expect(planPlace({ ...empty, items: [{ id: 'of-6-10', ...door }] }, 'of-7-28', { x: door.x - 1, y: door.y - 1 }, standard)).toEqual({ kind: 'refused', error: 'blocks_door' });
  });

  test('hors de la pièce : refusé, même sans rien à remplacer', () => {
    expect(planPlace(empty, 'of-7-28', { x: 8, y: 1 }, standard)).toEqual({ kind: 'refused', error: 'out_of_room' });
    expect(planPlace(empty, 'of-7-28', { x: 4, y: 1 }, compact)).toEqual({ kind: 'refused', error: 'out_of_room' });
  });

  test('remplacer plusieurs éléments à la fois : tous ceux que l\'empreinte touche partent', () => {
    const two: DeskDecor = { ...empty, items: [{ id: 'of-6-10', x: 2, y: 2 }, { id: 'of-6-10', x: 4, y: 2 }, { id: 'of-6-10', x: 6, y: 4 }] };
    const plan = planPlace(two, 'of-7-28', { x: 2, y: 1 }, standard);
    expect(plan).toMatchObject({ kind: 'replace', replacing: [0, 1] });
  });
});

test('le poste par défaut de chaque pièce passe son propre contrôle', () => {
  for (const room of [standard, compact, compactNorth]) expect(checkDecor(defaultDeskDecor(room), room), JSON.stringify(room)).toEqual({ ok: true });
});

// ---- Devant la pièce : le mur et la rangée du dehors ---------------------------------------------------------------------------

// La grande carte : A1 (porte au sud, en haut), A2 (l'interrupteur sur son mur du dehors), A3 (porte au nord, en bas). Leur rangée du dehors est la 9.
const OFFICE = parseOfficeMap(buildOfficeTiledMap());
const a1 = roomOfDesk(OFFICE, 'A1');
const a2 = roomOfDesk(OFFICE, 'A2');
const a3 = roomOfDesk(OFFICE, 'A3');

describe('poser devant sa pièce', () => {
  test('roomOfDesk lit le dehors sur la carte ; les pièces sans carte n\'en ont pas', () => {
    expect(a1.outside).toEqual({ fixtures: [] });
    expect(a2.outside?.fixtures).toEqual([{ x: 8, y: 8, w: 1, h: 1 }]);
    expect(roomOfDesk(null, 'A1').outside).toBeUndefined();
  });

  test('un élément mural visé sous la pièce (sur son mur sud ou dans la rue) va sur la face du mur du dehors ; visé dedans, sur le mur du nord', () => {
    for (const y of [7.2, 8.6, 9.5]) expect(anchorFor('horloge-ronde', { x: 6.5, y }, a1, 'cell'), `y = ${y}`).toEqual({ x: 6, y: 9 });
    expect(anchorFor('horloge-ronde', { x: 6.5, y: 6.5 }, a1, 'cell')).toEqual({ x: 6, y: 0 });
    // Le long du mur, ramené à la largeur de la pièce, au dixième près.
    expect(anchorFor('of-9-12', { x: 8.9, y: 8 }, a1, 'free')).toEqual({ x: 7, y: 9 });
    expect(anchorFor('of-9-12', { x: 3.37, y: 8 }, a1, 'free')).toEqual({ x: 2.4, y: 9 });
  });

  test('un objet visé dans la moitié basse du mur sud ou dans la rue va sur la rangée du dehors ; plus haut, il reste dans la pièce, contre le mur', () => {
    for (const y of [8, 8.9, 9.1, 9.9]) expect(anchorFor('of-6-10', { x: 6.5, y }, a1, 'cell'), `y = ${y}`).toEqual({ x: 6, y: 9 });
    expect(anchorFor('of-6-10', { x: 6.5, y: 7.5 }, a1, 'cell')).toEqual({ x: 6, y: 6 });
    // Sans dehors (pas de carte), rien ne sort de la pièce.
    expect(anchorFor('of-6-10', { x: 6.5, y: 9.5 }, standard, 'cell')).toEqual({ x: 6, y: 6 });
    expect(anchorFor('horloge-ronde', { x: 6.5, y: 9.5 }, standard, 'cell')).toEqual({ x: 6, y: 0 });
  });

  test('reprendre un élément du dehors ne le déplace pas : handleOf et anchorFor le ramènent à sa place', () => {
    for (const id of ['of-6-10', 'jp-5-2', 'horloge-gare']) expect(anchorFor(id, handleOf(id, { x: 2.3, y: 9 })!, a3, 'free'), id).toEqual({ x: 2.3, y: 9 });
  });

  test('ce que l\'éditeur pose dehors, le serveur l\'accepte ; ce qu\'il refuse, l\'éditeur le refuse (même règle, checkDecor)', () => {
    const outside = planPlace(empty, 'of-6-10', anchorFor('of-6-10', { x: 6.5, y: 9.5 }, a1, 'cell')!, a1);
    if (outside.kind !== 'place') throw new Error('attendu : poser');
    expect(outside.decor.items).toEqual([{ id: 'of-6-10', x: 6, y: 9 }]);
    expect(checkDecor(outside.decor, a1)).toEqual({ ok: true });
    // Une fontaine (solide) dans la rue devant la porte de A1 ; une horloge sur l'interrupteur de A2 ; un bureau trop profond pour la rangée.
    expect(planPlace(empty, 'of-12-15', { x: a1.door.x, y: 9 }, a1)).toEqual({ kind: 'refused', error: 'blocks_door' });
    expect(planPlace(empty, 'horloge-ronde', { x: 8, y: 9 }, a2)).toEqual({ kind: 'refused', error: 'overlap' });
    expect(planPlace(empty, 'of-7-28', { x: 4, y: 9 }, a3)).toEqual({ kind: 'refused', error: 'out_of_room' });
    // Devant un bureau du bas, la fontaine passe : sa porte est de l'autre côté.
    expect(planPlace(empty, 'of-12-15', { x: a3.door.x, y: 9 }, a3)).toMatchObject({ kind: 'place' });
  });

  test('un pot posé sur un autre pot du dehors le remplace, après confirmation ; un pot dehors ne remplace rien dedans', () => {
    const withPot: DeskDecor = { ...empty, items: [{ id: 'of-6-10', x: 6, y: 9 }, { id: 'of-6-10', x: 6, y: 6 }] };
    expect(planPlace(withPot, 'of-6-12', { x: 6, y: 9 }, a1)).toMatchObject({ kind: 'replace', replacing: [0] });
  });
});
