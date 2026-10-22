import type { PieceType } from '@bureau/shared/games/chess';

// Les six pièces, dessinées en pixel art 16 × 16 (comme les pochettes du juke-box, office/ambiance-covers.ts) : des lignes de lettres, un pixel par lettre. Ce sont des
// illustrations, pas des jetons : leurs couleurs sont celles de la feuille du jeu (`--chess-*`), jour comme nuit. On ne dessine que ce qui est plein ; le contour est ajouté
// autour, ce qui donne à toutes les pièces le même trait et les rend lisibles sur les deux couleurs de case.
//
//   `o` le corps, `s` l'ombre (côté droit des pièces symétriques), `#` un détail au trait (l'œil du cavalier, la fente du fou), `.` rien.
//
// Les pièces symétriques (pion, tour, fou, dame, roi) ne donnent que leur moitié gauche, du bord à l'axe : la moitié droite est son reflet, ombré sur le bord. Le cavalier,
// qui regarde à gauche, est dessiné en entier. Toutes posent leur socle sur la quinzième ligne ; le contour ajouté en prend une de plus au-dessus et en dessous.
export const SPRITE_SIZE = 16;
// La dernière ligne pleine : le socle de toutes les pièces s'y arrête (la ligne suivante est son contour).
const BASELINE = 13;

export type Tone = '#' | 'o' | 's';

// Les moitiés gauches (8 lettres par ligne : de la colonne 0 à la colonne 7, la plus proche de l'axe), de haut en bas.
const HALVES: Record<Exclude<PieceType, 'n'>, readonly string[]> = {
  p: [
    '......oo',
    '.....ooo',
    '.....ooo',
    '.....ooo',
    '......oo',
    '.....ooo',
    '......oo',
    '.....ooo',
    '....oooo',
    '...ooooo',
  ],
  r: [
    '...oo..o',
    '...oo..o',
    '...ooooo',
    '....oooo',
    '....oooo',
    '....oooo',
    '....oooo',
    '...ooooo',
    '..oooooo',
    '..oooooo',
  ],
  b: [
    '.......o',
    '......oo',
    '......oo',
    '.....ooo',
    '.....ooo',
    '....oooo',
    '....oooo',
    '....oooo',
    '.....ooo',
    '......oo',
    '.....ooo',
    '....oooo',
    '...ooooo',
  ],
  q: [
    '.o..o..o',
    '.oo.oo.o',
    '..oooooo',
    '..oooooo',
    '...ooooo',
    '....oooo',
    '.....ooo',
    '.....ooo',
    '......oo',
    '.....ooo',
    '....oooo',
    '...ooooo',
  ],
  k: [
    '.......o',
    '.....ooo',
    '.....ooo',
    '.......o',
    '....oooo',
    '...ooooo',
    '..oooooo',
    '..oooooo',
    '...ooooo',
    '....oooo',
    '.....ooo',
    '....oooo',
    '...ooooo',
  ],
};

// Le cavalier, en entier (16 lettres par ligne), tourné vers la gauche.
const KNIGHT: readonly string[] = [
  '.......oo.......',
  '......oooo......',
  '.....ooooooo....',
  '....oooooooooo..',
  '...oooooooooooo.',
  '..ooo#ooooooooo.',
  '..ooooooooooooo.',
  '.oooooooooooooo.',
  '.oooo..ooooooo..',
  '......oooooooo..',
  '.....ooooooooo..',
  '....ooooooooooo.',
  '...oooooooooooo.',
];

// Une moitié gauche devient une ligne entière : son reflet à droite, dont les lettres `o` collées au bord (la lettre suivante n'est pas pleine) passent à l'ombre `s`.
function mirrored(half: string): string {
  const right = [...half].reverse();
  const shaded = right.map((letter, index) => (letter === 'o' && (index === right.length - 1 || right[index + 1] === '.') ? 's' : letter));
  return half + shaded.join('');
}

const solid = (letter: string | undefined): boolean => letter !== undefined && letter !== '.';

// Pose le dessin (sans contour) sur seize lignes de seize lettres, son socle sur BASELINE, et lui ajoute le contour : tout pixel vide à côté d'un pixel plein (haut, bas,
// gauche, droite) devient `#`.
function framed(art: readonly string[]): string[] {
  const grid = Array.from({ length: SPRITE_SIZE }, () => Array.from({ length: SPRITE_SIZE }, () => '.'));
  const top = BASELINE - art.length + 1;
  art.forEach((line, index) => {
    for (let x = 0; x < SPRITE_SIZE; x++) grid[top + index]![x] = line[x] ?? '.';
  });
  const out = grid.map((line) => [...line]);
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x++) {
      if (grid[y]![x] !== '.') continue;
      if (solid(grid[y - 1]?.[x]) || solid(grid[y + 1]?.[x]) || solid(grid[y]?.[x - 1]) || solid(grid[y]?.[x + 1])) out[y]![x] = '#';
    }
  }
  return out.map((line) => line.join(''));
}

// Des pixels au trait posés après coup, hors de l'axe de symétrie : la fente en diagonale de la mitre du fou. [colonne, ligne] du dessin fini.
const SLIT_OF_BISHOP: ReadonlyArray<readonly [number, number]> = [
  [9, 4],
  [8, 5],
  [7, 6],
];

function withDetails(rows: readonly string[], points: ReadonlyArray<readonly [number, number]>): string[] {
  return rows.map((line, y) => [...line].map((tone, x) => (points.some(([px, py]) => px === x && py === y) ? '#' : tone)).join(''));
}

// Les seize lignes de chaque pièce, contour compris.
export const SPRITES: Record<PieceType, readonly string[]> = {
  p: framed(HALVES.p.map(mirrored)),
  n: framed(KNIGHT),
  b: withDetails(framed(HALVES.b.map(mirrored)), SLIT_OF_BISHOP),
  r: framed(HALVES.r.map(mirrored)),
  q: framed(HALVES.q.map(mirrored)),
  k: framed(HALVES.k.map(mirrored)),
};

// Le tracé SVG de chaque ton d'une pièce : une suite de petits rectangles (`M x y h 1 v 1 h -1 z`), les pixels voisins d'une ligne réunis en une barre. Trois tracés par pièce,
// plutôt que des dizaines de rectangles : le plateau en porte jusqu'à trente-deux.
export function toneLayers(type: PieceType): Record<Tone, string> {
  const layers: Record<Tone, string[]> = { '#': [], o: [], s: [] };
  SPRITES[type].forEach((line, y) => {
    for (let x = 0; x < SPRITE_SIZE; ) {
      const tone = line[x]!;
      if (tone === '.') {
        x++;
        continue;
      }
      let end = x;
      while (line[end + 1] === tone) end++;
      layers[tone as Tone].push(`M${x} ${y}h${end - x + 1}v1h${x - end - 1}z`);
      x = end + 1;
    }
  });
  return { '#': layers['#'].join(''), o: layers.o.join(''), s: layers.s.join('') };
}
