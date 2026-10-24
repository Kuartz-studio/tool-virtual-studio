// Dessine les horloges murales de la banque : `pnpm --filter @bureau/client gen:clocks`.
//   public/assets/decor/horloges.png   l'atlas des quatre horloges : leurs images de la banque (aiguilles sur 10 h 10), et dessous leurs cadrans nus,
//                                      sur lesquels le jeu peint l'heure de l'occupant du bureau (src/game/wall-clocks.ts)
//   docs/horloges.png                  l'aperçu, à 1× puis à 3× (à 10 h 10, puis à une autre heure, comme le jeu les peint)
// Elles ne viennent pas du pack LimeZu : tout est dessiné ici, pixel par pixel, et le résultat est commité. `gen:assets` ne les touche pas.
// Le dessin des cadrans est dans faces.ts ; celui de l'heure (aiguilles, chiffres, balancier), partagé avec le jeu, dans src/game/clock-faces.ts.
import { resolve, relative } from 'node:path';
import { CLOCK_ATLAS, CLOCK_ITEMS, TILE_SIZE, type DecorItem } from '@bureau/shared';
import { CLOCK_FACES, SHOWCASE_TIME, paintClock, type ClockTime } from '../../src/game/clock-faces';
import { Img, writeImage } from '../assets/image';
import { BARE_FACES, plotOn, rgba } from './faces';

export const CLOCK_ATLAS_PATH = resolve(import.meta.dirname, '../../public/assets/decor', `${CLOCK_ATLAS.name}.png`);
export const CLOCK_PREVIEW_PATH = resolve(import.meta.dirname, '../../../../docs/horloges.png');

// Une horloge à cette heure : son cadran nu, et l'heure peinte dessus (sans heure : le cadran nu).
export function drawClock(item: DecorItem, time: ClockTime | null): Img {
  const img = BARE_FACES[item.id]!();
  if (time) paintClock(CLOCK_FACES[item.id]!, time, plotOn(img));
  return img;
}

// L'atlas : la rangée des images de la banque (aiguilles sur 10 h 10) en (fx, fy), celle des cadrans nus CLOCK_ATLAS.bareRowOffset pixels plus bas.
export function buildClockAtlas(): Img {
  const atlas = new Img(CLOCK_ATLAS.width, CLOCK_ATLAS.height);
  for (const item of CLOCK_ITEMS) {
    atlas.paste(drawClock(item, SHOWCASE_TIME), item.fx, item.fy, false);
    atlas.paste(drawClock(item, null), item.fx, item.fy + CLOCK_ATLAS.bareRowOffset, false);
  }
  return atlas;
}

// Une image agrandie `scale` fois, sans lissage.
function scaled(img: Img, scale: number): Img {
  const out = new Img(img.width * scale, img.height * scale);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) out.set(x, y, img.get(Math.floor(x / scale), Math.floor(y / scale)));
  return out;
}

// Une autre heure que celle de la vitrine, pour montrer ce que le jeu peint : 18 h 42 et 51 s (les deux points éteints, la seconde finissante).
const EVENING: ClockTime = { hours: 18, minutes: 42, seconds: 51, ms: 700 };

// L'aperçu : un pan de mur (beige, sa plinthe), les quatre horloges posées dessus côte à côte, à 1×, puis à 3× à 10 h 10, puis à 3× à 18 h 42.
export function buildPreview(): Img {
  const gap = 8;
  const rows: Array<{ scale: number; time: ClockTime }> = [
    { scale: 1, time: SHOWCASE_TIME },
    { scale: 3, time: SHOWCASE_TIME },
    { scale: 3, time: EVENING },
  ];
  const widthAt = (scale: number) => CLOCK_ITEMS.reduce((sum, item) => sum + item.w * TILE_SIZE * scale, 0) + gap * scale * (CLOCK_ITEMS.length - 1);
  const width = Math.max(...rows.map(({ scale }) => widthAt(scale))) + 2 * 24;
  const bandOf = (scale: number) => 2 * TILE_SIZE * scale + 2 * 8 * scale;
  const height = rows.reduce((sum, { scale }) => sum + bandOf(scale), 0) + 24 * (rows.length + 1);
  const out = new Img(width, height);
  out.fillRect(0, 0, width, height, rgba('#2b2d3a'));
  let top = 24;
  for (const { scale, time } of rows) {
    const band = bandOf(scale);
    out.fillRect(0, top, width, band, rgba('#e6d8c3'));
    out.fillRect(0, top + band - 3 * scale, width, 3 * scale, rgba('#b99c7c'));
    let left = 24;
    const bottom = top + band - 6 * scale;
    for (const item of CLOCK_ITEMS) {
      const img = scaled(drawClock(item, time), scale);
      out.paste(img, left, bottom - img.height);
      left += img.width + gap * scale;
    }
    top += band + 24;
  }
  return out;
}

// `tsx scripts/clocks/build-clocks.ts` s'exécute directement ; importé par un test, ce module n'écrit rien.
if (/[\\/]build-clocks\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  writeImage(CLOCK_ATLAS_PATH, buildClockAtlas());
  writeImage(CLOCK_PREVIEW_PATH, buildPreview());
  console.log(`Écrit : ${relative(process.cwd(), CLOCK_ATLAS_PATH)} et ${relative(process.cwd(), CLOCK_PREVIEW_PATH)}.`);
}
