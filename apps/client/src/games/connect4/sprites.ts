// Les jetons et les trous du Puissance 4, dessinés en code : des lignes de lettres (une lettre, un pixel) et une palette par couleur, comme les pochettes du juke-box
// (office/ambiance-covers.ts). Aucun fichier d'image : le plateau en fait des SVG aux bords nets (`shape-rendering="crispEdges"`), posés à l'échelle entière. Ce sont des illustrations, pas
// des jetons de la feuille de style : leurs couleurs sont les leurs, le jour comme la nuit.

export const SPRITE_SIZE = 13;

export type Palette = Readonly<Record<string, string>>;

// Un disque de 13 × 13 pixels, le même pour un jeton et pour un trou. `.` : transparent ; `o` : le contour ; `b` : le fond ; `l` : la lumière, en haut à gauche, et `w` son reflet ; `s` :
// l'ombre, en bas à droite.
export const DISC_ROWS: readonly string[] = [
  '....ooooo....',
  '..ooolbbooo..',
  '.oolwlbbbboo.',
  '.olwbbbbbbbo.',
  'oolbbbbbbbboo',
  'olbbbbbbbbbso',
  'olbbbbbbbbbso',
  'obbbbbbbbbbso',
  'oobbbbbbbssoo',
  '.obbbbbbbsso.',
  '.oobbbssssoo.',
  '..ooosssooo..',
  '....ooooo....',
];

// Le contour du dernier jeton posé : blanc, qui se détache du plateau bleu comme des deux couleurs (§ 15.6 : « dernier jeton cerclé »).
export const MARKER_OUTLINE = '#ffffff';

const RED: Palette = { o: '#7a1414', b: '#d63030', l: '#f26b60', w: '#ffd0c8', s: '#a31f1f' };
const YELLOW: Palette = { o: '#8a5f00', b: '#ffcf24', l: '#ffe680', w: '#fff7cf', s: '#e0a400' };

// Le rouge est celui du siège 0, le jaune celui du siège 1 ; `…Last` : le même jeton, au contour blanc. Le rouge et le jaune se distinguent l'un de l'autre et d'un trou vide de 3 contre 1 au
// moins (contrast.ts les mesure dans les tests).
export const TOKEN_PALETTES: Record<'red' | 'yellow' | 'redLast' | 'yellowLast', Palette> = {
  red: RED,
  yellow: YELLOW,
  redLast: { ...RED, o: MARKER_OUTLINE },
  yellowLast: { ...YELLOW, o: MARKER_OUTLINE },
};

// Un trou vide : un fond très sombre, cerclé d'un bleu un peu plus clair que lui, plus ombré en haut à gauche qu'en bas à droite.
export const SLOT_PALETTE: Palette = { o: '#142f86', b: '#0a1a4d', l: '#071238', w: '#071238', s: '#10266b' };

// Une couleur et le chemin SVG de tous les pixels qu'elle peint.
export interface PathLayer {
  color: string;
  d: string;
}

// Les couches d'un dessin : une par couleur, dont le chemin est fait de rectangles d'un pixel de haut (`M x y h largeur v 1 h -largeur z`), un par suite de pixels de même lettre dans une
// ligne. Les rectangles ne se chevauchent pas, et deux couleurs ne se mêlent jamais. Une lettre sans couleur dans la palette, comme le point, n'est pas peinte.
export function spriteLayers(rows: readonly string[], palette: Palette): PathLayer[] {
  const byColor = new Map<string, string>();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const letter = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === letter) end++;
      const color = palette[letter];
      if (color !== undefined) byColor.set(color, `${byColor.get(color) ?? ''}M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return [...byColor].map(([color, d]) => ({ color, d }));
}
