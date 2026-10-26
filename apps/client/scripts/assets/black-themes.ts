// Les sols et les murs noirs. Le pack n'en a pas (son sol le plus sombre est le noyer, son mur le plus sombre l'anthracite) : chacun est tiré d'une de ses
// matières, dont il garde le dessin pixel pour pixel (les lames d'un parquet, le grain d'une moquette, les joints d'un carrelage, les briques), ses couleurs
// portées vers le noir. La couleur la plus présente de la matière devient `body` ; les autres gardent leur écart de luminosité avec elle, multiplié par
// `contrast`, dans la même teinte : le grain reste lisible, et un noir mat reste à peine texturé, comme les autres aplats. Sur un mur, les trois tuiles (le
// haut et le bas de la face, le pan) passent par la même règle, et sa construction (le trait des bords, le liseré blanc du haut) ne change pas : un mur noir
// se raccorde aux autres. Ils sont libres et ne bougent pas, comme les autres sols et murs libres ; leurs tuiles viennent à la fin du jeu de tuiles
// (tileset.ts), pour que celles d'avant gardent leur numéro.
import type { Img, Rgba } from './image';
import { copyOf, rgb, sameColor } from './pixel-art';
import { CAP, OUTLINE } from './shop-walls';

// Le noir d'une matière : la couleur que prend sa couleur la plus présente, et la part des écarts de luminosité qu'on garde autour d'elle (1 : tous).
export interface BlackTone {
  body: Rgba;
  contrast: number;
}

// Un sol noir : la tuile du pack d'où il part (colonne et rangée, comme FLOOR_PICKS), et son noir. Un mur noir : son bloc du pack (comme WALL_PICKS).
export interface BlackPick {
  id: string;
  label: string;
  column: number;
  row: number;
  tone: BlackTone;
}

// Le bois tire un peu sur le brun ; le reste, un peu sur le bleu, comme le trait des murs.
export const BLACK_FLOOR_PICKS: readonly BlackPick[] = [
  // Les lames du parquet clair et leurs joints.
  { id: 'bois-noir', label: 'Bois noir', column: 0, row: 11, tone: { body: rgb(40, 34, 32), contrast: 0.6 } },
  // Une moquette grise mouchetée du pack (aucun sol libre ne la prend) : son grain, accentué (en noir, il s'efface vite).
  { id: 'moquette-noire', label: 'Moquette noire', column: 3, row: 7, tone: { body: rgb(31, 31, 35), contrast: 1.3 } },
  // Les petits carreaux du graphite et leurs joints clairs.
  { id: 'carrelage-noir', label: 'Carrelage noir', column: 2, row: 13, tone: { body: rgb(26, 26, 30), contrast: 0.6 } },
  // Le grain fin du béton, à peine.
  { id: 'noir-mat', label: 'Noir mat', column: 1, row: 15, tone: { body: rgb(31, 31, 35), contrast: 0.4 } },
];

export const BLACK_WALL_PICKS: readonly BlackPick[] = [
  // L'anthracite et son grain vertical.
  { id: 'noir-mat', label: 'Noir mat', column: 0, row: 17, tone: { body: rgb(30, 30, 34), contrast: 1 } },
  // Les planches du bois sombre.
  { id: 'lambris-noir', label: 'Lambris noir', column: 1, row: 9, tone: { body: rgb(37, 32, 30), contrast: 0.5 } },
  // La brique claire : les briques sombres, les joints plus sombres encore (comme le mur Néon de la boutique).
  { id: 'brique-noire', label: 'Brique noire', column: 0, row: 8, tone: { body: rgb(33, 33, 37), contrast: 0.5 } },
  // Les carreaux bleus, leur biseau et leurs joints.
  { id: 'carrelage-noir', label: 'Carrelage noir', column: 2, row: 7, tone: { body: rgb(36, 36, 41), contrast: 0.35 } },
];

// Plus sombre, un pixel serait du noir pur : on garde de quoi voir un joint, une ombre.
export const DARKEST = 8;

export const luminance = ({ r, g, b }: Rgba): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Ce qui ne change pas sur un mur noir : sa construction, la même pour tous les murs du pack.
export const isWallFrame = (color: Rgba): boolean => sameColor(color, OUTLINE) || sameColor(color, CAP);

// Les tuiles d'une matière, portées vers le noir ensemble : la couleur la plus présente de toutes (hors `keep`) prend le noir du ton, les autres le suivent.
// `keep` : les pixels qui restent tels quels (la construction d'un mur) ; les pixels transparents aussi.
export function blacken(tiles: readonly Img[], tone: BlackTone, keep: (color: Rgba) => boolean = () => false): Img[] {
  const counts = new Map<string, { color: Rgba; count: number }>();
  for (const tile of tiles) {
    for (let y = 0; y < tile.height; y++) {
      for (let x = 0; x < tile.width; x++) {
        const color = tile.get(x, y);
        if (color.a === 0 || keep(color)) continue;
        const key = `${color.r},${color.g},${color.b},${color.a}`;
        const seen = counts.get(key);
        if (seen) seen.count++;
        else counts.set(key, { color, count: 1 });
      }
    }
  }
  // À égalité, la première vue : le résultat ne dépend que des images.
  let main: { color: Rgba; count: number } | undefined;
  for (const entry of counts.values()) if (!main || entry.count > main.count) main = entry;
  if (!main) return tiles.map(copyOf);
  const [reference, target] = [luminance(main.color), luminance(tone.body)];
  return tiles.map((tile) => {
    const out = copyOf(tile);
    for (let y = 0; y < tile.height; y++) {
      for (let x = 0; x < tile.width; x++) {
        const color = tile.get(x, y);
        if (color.a === 0 || keep(color)) continue;
        const k = Math.max(DARKEST, target + (luminance(color) - reference) * tone.contrast) / target;
        const channel = (value: number) => Math.min(255, Math.round(value * k));
        out.set(x, y, { r: channel(tone.body.r), g: channel(tone.body.g), b: channel(tone.body.b), a: color.a });
      }
    }
    return out;
  });
}
