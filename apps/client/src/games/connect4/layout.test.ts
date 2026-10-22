import { describe, expect, test } from 'vitest';
import { DEFAULT_WIDTH, MAX_CELL, MIN_CELL, SPRITE_MARGIN, cellSize, digitColumn, nextColumn, screenRow, spriteScale } from './layout';
import { SPRITE_SIZE } from './sprites';

// Les mesures du plateau : la taille d'une case d'après la largeur du conteneur, l'échelle entière des jetons, le passage de la rangée de l'état à celle de l'écran, et les touches
// qui choisissent une colonne.

describe('la taille d\'une case se mesure sur le conteneur', () => {
  test('le panneau d\'un ordinateur (408 px de contenu) donne des cases de 58 px, un téléphone de 375 px (311 px de contenu) des cases de 44 px', () => {
    expect(cellSize(408)).toBe(58);
    expect(cellSize(311)).toBe(44);
  });

  test('la largeur de départ, avant la première mesure, est celle du panneau d\'un ordinateur', () => {
    expect(DEFAULT_WIDTH).toBe(408);
    expect(cellSize(DEFAULT_WIDTH)).toBe(MAX_CELL);
  });

  test('sept colonnes tiennent toujours dans la largeur donnée : jamais de défilement horizontal', () => {
    for (let width = 7 * MIN_CELL; width <= 1_200; width++) expect(cellSize(width) * 7, `largeur ${width}`).toBeLessThanOrEqual(width);
  });

  test('une case grandit avec le conteneur sans jamais reculer, ne dépasse pas 58 px, et ne tombe pas sous 24 px (la cible d\'une colonne)', () => {
    expect([MIN_CELL, MAX_CELL]).toEqual([24, 58]);
    let previous = 0;
    for (let width = 0; width <= 1_200; width++) {
      const cell = cellSize(width);
      expect(cell, `largeur ${width}`).toBeGreaterThanOrEqual(previous);
      expect(cell, `largeur ${width}`).toBeGreaterThanOrEqual(MIN_CELL);
      expect(cell, `largeur ${width}`).toBeLessThanOrEqual(MAX_CELL);
      expect(Number.isInteger(cell), `largeur ${width}`).toBe(true);
      previous = cell;
    }
  });

  test('une largeur qui n\'en est pas une (zéro, négative, NaN, infinie) donne une case valable', () => {
    expect(cellSize(0)).toBe(MIN_CELL);
    expect(cellSize(-50)).toBe(MIN_CELL);
    expect(cellSize(Number.NaN)).toBe(MIN_CELL);
    expect(cellSize(Infinity)).toBe(MAX_CELL);
  });
});

describe('les jetons sont dessinés à l\'échelle entière', () => {
  test('58 px de case : ×4 (52 px) ; 44 px : ×3 (39 px)', () => {
    expect(SPRITE_SIZE).toBe(13);
    expect(spriteScale(58)).toBe(4);
    expect(spriteScale(44)).toBe(3);
  });

  test('pour toute case de 24 à 58 px, l\'échelle est un entier d\'au moins 1, et le jeton tient dans la case avec sa marge', () => {
    for (let cell = MIN_CELL; cell <= MAX_CELL; cell++) {
      const scale = spriteScale(cell);
      expect(Number.isInteger(scale), `case ${cell}`).toBe(true);
      expect(scale, `case ${cell}`).toBeGreaterThanOrEqual(1);
      expect(SPRITE_SIZE * scale + 2 * SPRITE_MARGIN, `case ${cell}`).toBeLessThanOrEqual(cell);
    }
  });

  test('l\'échelle ne baisse jamais quand la case grandit, et le plus gros jeton possible est choisi', () => {
    let previous = 0;
    for (let cell = MIN_CELL; cell <= MAX_CELL; cell++) {
      const scale = spriteScale(cell);
      expect(scale, `case ${cell}`).toBeGreaterThanOrEqual(previous);
      // Un cran de plus ne tiendrait plus.
      expect(SPRITE_SIZE * (scale + 1) + 2 * SPRITE_MARGIN, `case ${cell}`).toBeGreaterThan(cell);
      previous = scale;
    }
  });
});

describe('le passage de la rangée de l\'état à celle de l\'écran', () => {
  test('la rangée 0 de l\'état est en bas, la rangée 5 en haut de l\'écran : une seule fonction, qui est sa propre réciproque', () => {
    expect(screenRow(0)).toBe(5);
    expect(screenRow(5)).toBe(0);
    for (let row = 0; row < 6; row++) {
      expect(screenRow(screenRow(row)), `rangée ${row}`).toBe(row);
      expect(screenRow(row)).toBe(5 - row);
    }
  });
});

describe('les touches qui choisissent une colonne', () => {
  test('flèche gauche et droite : la colonne d\'à côté, sans passer de l\'autre côté du bord', () => {
    expect(nextColumn(3, 'ArrowLeft')).toBe(2);
    expect(nextColumn(3, 'ArrowRight')).toBe(4);
    expect(nextColumn(0, 'ArrowLeft')).toBe(0);
    expect(nextColumn(6, 'ArrowRight')).toBe(6);
  });

  test('Début et Fin vont aux bouts', () => {
    expect(nextColumn(3, 'Home')).toBe(0);
    expect(nextColumn(3, 'End')).toBe(6);
  });

  test('toute autre touche n\'est pas à elles : le plateau la laisse passer (null)', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'Escape', 'Tab', 'e', 'a', 'd', '+', '-', '0', '4', 'PageUp', 'Shift']) {
      expect(nextColumn(3, key), key).toBeNull();
    }
  });

  test('les chiffres de 1 à 7 sont les colonnes 0 à 6, lus à la position de la touche : un clavier AZERTY, où le chiffre demande Maj, joue sans lui', () => {
    for (let n = 1; n <= 7; n++) {
      expect(digitColumn({ key: String(n), code: `Digit${n}` }), `chiffre ${n}`).toBe(n - 1);
      expect(digitColumn({ key: String(n), code: `Numpad${n}` }), `pavé ${n}`).toBe(n - 1);
    }
    // AZERTY, sans Maj : la touche du 4 envoie « ' », celle du 1 envoie « & ».
    expect(digitColumn({ key: '\'', code: 'Digit4' })).toBe(3);
    expect(digitColumn({ key: '&', code: 'Digit1' })).toBe(0);
    // Un événement sans position (un test, un clavier virtuel) : le caractère.
    expect(digitColumn({ key: '5', code: '' })).toBe(4);
  });

  test('sur le pavé numérique, seul le chiffre compte : verrouillage éteint, les touches 1 à 9 sont des flèches, de Début et de Fin, pas des colonnes', () => {
    expect(digitColumn({ key: 'ArrowDown', code: 'Numpad2' })).toBeNull();
    expect(digitColumn({ key: 'ArrowLeft', code: 'Numpad4' })).toBeNull();
    expect(digitColumn({ key: 'End', code: 'Numpad1' })).toBeNull();
    expect(digitColumn({ key: 'Home', code: 'Numpad7' })).toBeNull();
    // Les flèches du pavé, elles, naviguent : c'est `nextColumn` qui les prend.
    expect(nextColumn(3, 'ArrowLeft')).toBe(2);
  });

  test('0, 8 et 9 ne sont pas des colonnes (0 reste au zoom), ni aucune autre touche', () => {
    for (const [key, code] of [['0', 'Digit0'], ['8', 'Digit8'], ['9', 'Digit9'], ['0', 'Numpad0'], ['a', 'KeyA'], ['e', 'KeyE'], ['+', 'Equal'], ['-', 'Minus'], ['Enter', 'Enter']] as const) {
      expect(digitColumn({ key, code }), `${key} (${code})`).toBeNull();
    }
    expect(digitColumn({ key: '0', code: '' })).toBeNull();
  });
});
