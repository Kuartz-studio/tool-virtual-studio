import { describe, expect, test } from 'vitest';
import { DEV_OFFICE, buildTiledMap, parseOfficeMap, validateMove } from '../src';

// La carte de développement : 24 × 16 cases de 32 px, soit 768 × 512 px. Les lignes qui servent ici :
//  - ligne 5 (y de 160 à 191) : un mur, percé de portes aux colonnes 3, 10 et 18 ;
//  - ligne 7 (y de 224 à 255) : du sol de bout en bout (l'apparition est en (80, 240)) ;
//  - ligne 9 (y de 288 à 319) : des bureaux aux colonnes 4-5, 11-12 et 18-19 ;
//  - ligne 15 (y de 480 à 511) : le mur du bas ; colonne 23 (x de 736 à 767) : le mur de droite.
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const pt = (x: number, y: number, at: number) => ({ x, y, at });

// ---- Les tests de la brief ------------------------------------------------------------------------------------------

test('80 px en 100 ms : accepté', () => expect(validateMove(map, { x: 80, y: 240, at: 0 }, { x: 160, y: 240, at: 100 })).toEqual({ ok: true }));
test('104 px en 100 ms : trop rapide', () => expect(validateMove(map, { x: 80, y: 240, at: 0 }, { x: 184, y: 240, at: 100 })).toEqual({ ok: false, reason: 'too_fast' }));
test('sur un bureau : bloqué', () => expect(validateMove(map, { x: 144, y: 272, at: 0 }, { x: 144, y: 304, at: 100 })).toEqual({ ok: false, reason: 'blocked' }));
test('à travers un mur : bloqué', () => expect(validateMove(map, { x: 48, y: 208, at: 0 }, { x: 48, y: 144, at: 300 })).toEqual({ ok: false, reason: 'blocked' }));
test('hors carte', () => expect(validateMove(map, { x: 80, y: 240, at: 0 }, { x: -10, y: 240, at: 100 }).ok).toBe(false));

// ---- La vitesse : 160 × (dt + 250) / 1000 × 1,5 ---------------------------------------------------------------------------

describe('vitesse : distance autorisée = 160 × (dt + 250 ms) / 1000 × 1,5', () => {
  // De (80, 240) vers la droite, tout est du sol jusqu'à x = 735 : seule la vitesse décide. L'heure de départ n'est pas 0 : seule
  // la différence compte.
  test.each([
    ['dt = 0 : 60 px (la marge de gigue seule)', 0, 60, true],
    ['dt = 0 : 61 px', 0, 61, false],
    ['dt = 100 ms : 84 px, la limite est permise', 100, 84, true],
    ['dt = 100 ms : 85 px', 100, 85, false],
    ['dt = 1 s : 300 px', 1_000, 300, true],
    ['dt = 1 s : 301 px', 1_000, 301, false],
  ])('%s', (_name, dt, distance, accepted) => {
    expect(validateMove(map, pt(80, 240, 1_000), pt(80 + distance, 240, 1_000 + dt))).toEqual(accepted ? { ok: true } : { ok: false, reason: 'too_fast' });
  });

  test('la distance est celle du segment, en diagonale aussi : 59 × 59 px (83,4) passe en 100 ms, 60 × 60 px (84,85) non', () => {
    // Lignes 10 à 12, colonnes 2 à 4 : du sol.
    expect(validateMove(map, pt(80, 330, 0), pt(139, 389, 100))).toEqual({ ok: true });
    expect(validateMove(map, pt(80, 330, 0), pt(140, 390, 100))).toEqual({ ok: false, reason: 'too_fast' });
  });

  test('sur place : accepté', () => expect(validateMove(map, pt(80, 240, 0), pt(80, 240, 0))).toEqual({ ok: true }));

  test('une horloge qui recule (dt < 0) ne fige pas le joueur : dt est ramené à 0', () => {
    // Sans ce plancher, dt + 250 deviendrait négatif et même un arrêt sur place serait refusé.
    expect(validateMove(map, pt(80, 240, 5_000), pt(80, 240, 4_000))).toEqual({ ok: true });
    expect(validateMove(map, pt(80, 240, 5_000), pt(140, 240, 4_000))).toEqual({ ok: true });
    expect(validateMove(map, pt(80, 240, 5_000), pt(141, 240, 4_000))).toEqual({ ok: false, reason: 'too_fast' });
    // Un petit recul n'est pas plus sévère qu'un arrêt : 50 px passent (avec dt = -100, la formule n'en permettrait que 36).
    expect(validateMove(map, pt(80, 240, 1_000), pt(130, 240, 900))).toEqual({ ok: true });
  });

  test('une heure illisible (NaN) refuse le mouvement au lieu de le laisser passer', () => {
    expect(validateMove(map, pt(80, 240, Number.NaN), pt(90, 240, 100))).toEqual({ ok: false, reason: 'too_fast' });
    expect(validateMove(map, pt(80, 240, 0), pt(90, 240, Number.NaN))).toEqual({ ok: false, reason: 'too_fast' });
  });
});

// ---- Hors carte -----------------------------------------------------------------------------------------------------------

describe('hors carte', () => {
  test.each([
    ['à gauche (x = -1)', -1, 240],
    ['au-dessus (y = -1)', 80, -1],
    ['à droite (x = 768 = 24 × 32)', 768, 240],
    ['en dessous (y = 512 = 16 × 32)', 80, 512],
    ['x = NaN', Number.NaN, 240],
    ['y = Infinity', 80, Number.POSITIVE_INFINITY],
  ])('%s : out_of_bounds', (_name, x, y) => {
    // Une heure d'écart : la vitesse n'est pas en cause (et hors carte passe avant « trop rapide »).
    expect(validateMove(map, pt(80, 240, 0), pt(x, y, 3_600_000))).toEqual({ ok: false, reason: 'out_of_bounds' });
  });

  test('les derniers pixels de la carte (767 et 511) sont dans le mur d\'enceinte : bloqué, pas hors carte', () => {
    expect(validateMove(map, pt(700, 240, 0), pt(767, 240, 1_000))).toEqual({ ok: false, reason: 'blocked' });
    expect(validateMove(map, pt(80, 470, 0), pt(80, 511, 1_000))).toEqual({ ok: false, reason: 'blocked' });
  });
});

// ---- L'ordre des contrôles ------------------------------------------------------------------------------------------------

test('ordre des contrôles : hors carte avant trop rapide, trop rapide avant bloqué', () => {
  // x = -10 est hors carte, et 90 px en 100 ms, c'est aussi trop rapide.
  expect(validateMove(map, pt(80, 240, 0), pt(-10, 240, 100))).toEqual({ ok: false, reason: 'out_of_bounds' });
  // (80, 500) est dans le mur du bas, et 260 px en 100 ms, c'est aussi trop rapide.
  expect(validateMove(map, pt(80, 240, 0), pt(80, 500, 100))).toEqual({ ok: false, reason: 'too_fast' });
});

// ---- Le segment entier est praticable ---------------------------------------------------------------------------------------

describe('le segment entier, échantillonné tous les 8 px, est praticable', () => {
  test('l\'arrivée compte même après un seul petit pas : 4 px, de la ligne 8 (y = 286) à la ligne 9 (y = 290), sur un bureau', () => {
    // Un échantillon tous les 8 px à partir du départ ne verrait que (144, 286) : il faut aussi tester l'arrivée.
    expect(validateMove(map, pt(144, 286, 0), pt(144, 290, 100))).toEqual({ ok: false, reason: 'blocked' });
  });

  test('l\'arrivée compte aussi quand la longueur n\'est pas un multiple de 8 : 21 px vers un bureau', () => {
    // De (144, 270) à (144, 291) : trois pas de 7 px, donc des échantillons à 270, 277, 284 et 291 ; seul le dernier est dans le bureau.
    expect(validateMove(map, pt(144, 270, 0), pt(144, 291, 100))).toEqual({ ok: false, reason: 'blocked' });
  });

  test('le départ compte : parti d\'une case bloquante, le segment n\'est pas entièrement praticable', () => {
    // De (144, 319), le dernier pixel du bureau, à (144, 343) : trois pas de 8 px, des échantillons à 319, 327, 335 et 343 ; seul le
    // départ est dans le bureau.
    expect(validateMove(map, pt(144, 319, 0), pt(144, 343, 100))).toEqual({ ok: false, reason: 'blocked' });
  });

  // Le cadre de la porte de la colonne 3 : le mur de la colonne 2 (x de 64 à 95, y de 160 à 191) touche la porte à x = 96.
  test('un coin de mur effleuré en biais juste avant l\'arrivée : bloqué, le dernier échantillon avant l\'arrivée compte', () => {
    // De (110, 220) à (94, 154), 67,9 px en neuf pas de 7,5 px : les échantillons 0 à 7 passent dans la porte (x >= 96), le 8 est en
    // (95,8 ; 161,3), dans le mur, et l'arrivée (le 9) est dans la pièce du haut, au-dessus du mur.
    expect(validateMove(map, pt(110, 220, 0), pt(94, 154, 300))).toEqual({ ok: false, reason: 'blocked' });
    // Même départ, arrivée en (100, 154) : on reste dans la porte, rien n'est touché.
    expect(validateMove(map, pt(110, 220, 0), pt(100, 154, 300))).toEqual({ ok: true });
  });

  test('à travers un mur, de biais, départ et arrivée libres : bloqué', () => {
    // De (40, 200) à (60, 140) : la ligne 5, colonne 1, est un mur.
    expect(validateMove(map, pt(40, 200, 0), pt(60, 140, 300))).toEqual({ ok: false, reason: 'blocked' });
  });

  test('à travers un mur, sur 200 px permis par le temps (1 s) : bloqué', () => {
    expect(validateMove(map, pt(48, 300, 0), pt(48, 100, 1_000))).toEqual({ ok: false, reason: 'blocked' });
  });

  test('à travers des bureaux, départ et arrivée libres : bloqué', () => {
    // Ligne 9 (y = 304), de la colonne 3 à la colonne 7 ; les bureaux sont aux colonnes 4 et 5.
    expect(validateMove(map, pt(100, 304, 0), pt(240, 304, 1_000))).toEqual({ ok: false, reason: 'blocked' });
  });

  test('par une porte : accepté', () => {
    // La porte de la colonne 3 (x de 96 à 127) dans le mur de la ligne 5 : 70 px vers le haut en 400 ms.
    expect(validateMove(map, pt(112, 200, 0), pt(112, 130, 400))).toEqual({ ok: true });
  });

  test('un long trajet libre (plusieurs dizaines d\'échantillons) : accepté', () => {
    // 640 px le long de la ligne 7 en 3 s (780 px permis).
    expect(validateMove(map, pt(40, 240, 0), pt(680, 240, 3_000))).toEqual({ ok: true });
  });

  // Les pieds d'un client honnête restent dans leur case (l'avatar s'arrête 1 px avant le mur) : y = 479 est la dernière ligne
  // praticable en bas, et la case d'un point est floor(y / 32), si bien que y = 480 est déjà dans le mur.
  test('le long du mur du bas, y = 479 : accepté ; un pixel plus bas (y = 480), c\'est le mur', () => {
    expect(validateMove(map, pt(100, 479, 0), pt(180, 479, 100))).toEqual({ ok: true });
    expect(validateMove(map, pt(100, 479, 0), pt(100, 480, 100))).toEqual({ ok: false, reason: 'blocked' });
  });

  test('le long du mur de droite, x = 735 : accepté ; x = 736, c\'est le mur', () => {
    expect(validateMove(map, pt(700, 240, 0), pt(735, 240, 100))).toEqual({ ok: true });
    expect(validateMove(map, pt(700, 240, 0), pt(736, 240, 100))).toEqual({ ok: false, reason: 'blocked' });
  });

  test('un bord de case est dans la case de droite ou du bas : y = 288 est déjà la ligne des bureaux', () => {
    expect(validateMove(map, pt(144, 280, 0), pt(144, 287, 100))).toEqual({ ok: true });
    expect(validateMove(map, pt(144, 280, 0), pt(144, 288, 100))).toEqual({ ok: false, reason: 'blocked' });
  });
});
