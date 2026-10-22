// Les pions en pixel art, dessinés en code (§ 9.5.6 du document des jeux : aucun fichier d'image). Un disque est une grille de lettres : `.` transparent, `o` le liseré,
// `f` le remplissage, `h` la lumière (en haut à gauche), `s` l'ombre (en bas à droite, et l'anneau du milieu). La palette est celle de l'illustration : la même le jour
// et la nuit (le cadre autour, lui, suit les jetons de la feuille de style).

export type DiscLetter = '.' | 'o' | 'f' | 'h' | 's';

export interface DiscPalette {
  o: string;
  f: string;
  h: string;
  s: string;
}

// Les Blancs (ivoire) et les Rouges (rouge brique) : le liseré est le même, brun très foncé, qui détache chaque pion de n'importe quel point.
export const PALETTE: { white: DiscPalette; red: DiscPalette } = {
  white: { o: '#2a1d14', f: '#f2ead8', h: '#fffaf0', s: '#c9bb97' },
  red: { o: '#2a1d14', f: '#b8432d', h: '#dc6a4f', s: '#86291a' },
};

// Le disque de ce diamètre, en pixels d'art : un pixel est dans le disque si son centre l'est ; le liseré est ce qui touche le dehors ; la lumière et l'ombre sont deux arcs
// en retrait du liseré ; un anneau, plus au centre, donne au pion son air de pion de backgammon.
export function discPixels(diameter: number): string[] {
  const radius = diameter / 2;
  const centre = (index: number): number => index + 0.5 - radius;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < diameter && y < diameter && centre(x) ** 2 + centre(y) ** 2 <= radius ** 2;
  const rows: string[] = [];
  for (let y = 0; y < diameter; y++) {
    let row = '';
    for (let x = 0; x < diameter; x++) {
      if (!inside(x, y)) {
        row += '.';
        continue;
      }
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const dx = centre(x);
      const dy = centre(y);
      const distance = Math.hypot(dx, dy);
      const lean = dx + dy;
      if (edge) row += 'o';
      else if (lean <= -radius * 0.7 && distance < radius - 1) row += 'h';
      else if (lean >= radius * 0.7 && distance < radius - 1) row += 's';
      else if (distance >= radius * 0.55 && distance <= radius * 0.68) row += 's';
      else row += 'f';
    }
    rows.push(row);
  }
  return rows;
}

export interface Run {
  x: number;
  y: number;
  width: number;
  letter: Exclude<DiscLetter, '.'>;
}

// Les rectangles qui dessinent ces rangées : les pixels voisins de même lettre sur une rangée n'en font qu'un (un disque de 13 pixels passe de 137 rectangles à une soixantaine).
export function spriteRuns(rows: readonly string[]): Run[] {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const letter = row[x] as DiscLetter;
      if (letter === '.') {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === letter) end++;
      runs.push({ x, y, width: end - x, letter });
      x = end;
    }
  });
  return runs;
}

// Un dé : un carré de 14 pixels d'art de côté (le liseré, deux pixels de marge, des points de 2 × 2 pixels posés sur une grille de 3 × 3 aux colonnes 3, 6 et 9), et
// l'emplacement des points de chaque face (colonne, rangée) sur cette grille.
export const DIE_ART = 14;
const PIP_ROWS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

// Les points d'une face (colonne, rangée) sur la grille de 3 × 3, pour une valeur de 1 à 6 ; rien pour une autre valeur.
export function pipsOf(value: number): ReadonlyArray<readonly [number, number]> {
  return PIP_ROWS[value] ?? [];
}

// La palette des dés : ivoire à points sombres (un dé ne prend pas la couleur d'un camp).
export const DIE_PALETTE = { body: '#f7f1e1', edge: '#2a1d14', shade: '#cdbf9b', pip: '#2a1d14' } as const;
