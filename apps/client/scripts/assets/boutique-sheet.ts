// L'aperçu de la collection à part : `pnpm --filter @bureau/client gen:boutique` écrit docs/boutique.png, chaque pièce sur un fond neutre avec son
// nom, son prix et comment elle se pose, rangée par rareté (RARITIES, curation/boutique.ts). C'est ce qu'on regarde pour juger la sélection et les prix :
// la liste générée (decor/generated.ts) et l'atlas (public/assets/decor/boutique.png) suffisent, le pack n'est pas nécessaire. Un test compare
// l'image écrite à ce que ce module produit, pour qu'un prix changé sans relancer le script se voie.
import { resolve } from 'node:path';
import { DECOR_ITEMS, type DecorItem, type DecorKind } from '@bureau/shared';
import { RARITIES, rarityOf, type Rarity } from './curation/boutique';
import { Img, readImage, writeImage, type Rgba } from './image';
import { TEXT_ROWS, drawText, wrapText } from './pixel-font';

export const SHEET_PATH = resolve(import.meta.dirname, '../../../../docs/boutique.png');
const ATLAS_PATH = resolve(import.meta.dirname, '../../public/assets/decor/boutique.png');

const PAGE_WIDTH = 1960;
const MARGIN = 16;
const GAP = 10;
const PADDING = 10;
const SPRITE_SCALE = 2;
const TEXT_SCALE = 2;
const SMALL_SCALE = 1;
const MIN_CARD_WIDTH = 190;
const TEXT_LINE = TEXT_ROWS * TEXT_SCALE;
const SMALL_LINE = TEXT_ROWS * SMALL_SCALE + 4;

const rgb = (r: number, g: number, b: number): Rgba => ({ r, g, b, a: 255 });
const COLORS = {
  page: rgb(58, 62, 72),
  card: rgb(108, 113, 125),
  edge: rgb(136, 141, 153),
  text: rgb(255, 255, 255),
  price: rgb(255, 214, 122),
  small: rgb(205, 210, 219),
  // Un liseré de la couleur de la rareté en haut de chaque carte, et devant son titre.
  rarity: { commun: rgb(176, 184, 196), rare: rgb(92, 168, 255), epique: rgb(190, 124, 255), legendaire: rgb(255, 178, 64) } satisfies Record<Rarity['id'], Rgba>,
};

// Comment se pose un élément, dans les mots du panneau Décorer.
const KIND_LABELS: Record<DecorKind, string> = { object: 'au sol', floor: 'tapis', onTop: 'sur un meuble', wall: 'au mur' };

// 9000 devient « 9 000 » : une espace ordinaire, celle de la police.
export const formatPrice = (price: number): string => String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// Chaque point devient un carré de `scale` pixels.
function upscale(source: Img, scale: number): Img {
  const out = new Img(source.width * scale, source.height * scale);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const pixel = source.get(x, y);
      if (pixel.a > 0) out.fillRect(x * scale, y * scale, scale, scale, pixel);
    }
  }
  return out;
}

interface Card {
  item: DecorItem;
  rarity: Rarity;
  sprite: Img;
  width: number;
  lines: string[];
  meta: string;
}

function makeCard(item: DecorItem, rarity: Rarity, atlas: Img): Card {
  const sprite = upscale(atlas.crop(item.fx, item.fy, item.w * 32, item.h * 32), SPRITE_SCALE);
  const width = Math.max(sprite.width, MIN_CARD_WIDTH) + 2 * PADDING;
  const lines = wrapText(item.name, width - 2 * PADDING, TEXT_SCALE);
  const meta = `${KIND_LABELS[item.kind]} · ${item.w} × ${item.h}${item.solid ? ' · bloque' : ''}`;
  return { item, rarity, sprite, width, lines, meta };
}

// Une ligne de la page : un titre, ou des cartes côte à côte (leur hauteur est celle de la plus haute image et du nom le plus long).
type Row =
  | { kind: 'title'; text: string; color: Rgba; height: number }
  | { kind: 'cards'; cards: Card[]; spriteHeight: number; nameLines: number; height: number };

function titleRow(text: string, color: Rgba): Row {
  return { kind: 'title', text, color, height: TEXT_LINE + 2 * GAP };
}

function cardsRow(cards: Card[]): Row {
  const spriteHeight = Math.max(...cards.map((card) => card.sprite.height));
  const nameLines = Math.max(...cards.map((card) => card.lines.length));
  return { kind: 'cards', cards, spriteHeight, nameLines, height: PADDING + spriteHeight + GAP + nameLines * TEXT_LINE + TEXT_LINE + SMALL_LINE + PADDING };
}

// Les cartes d'une rareté, rangées en lignes de la largeur de la page, sous un titre qui dit ses prix et ce qu'elle coûte en tout.
function rowsFor(rarity: Rarity, cards: Card[]): Row[] {
  const total = cards.reduce((sum, card) => sum + card.item.price!, 0);
  const title = `${rarity.label.toUpperCase()} · ${formatPrice(rarity.min)} à ${formatPrice(rarity.max)} kuartzons · ${cards.length} éléments · ${formatPrice(total)} kuartzons en tout`;
  const rows: Row[] = [titleRow(title, COLORS.rarity[rarity.id])];
  let line: Card[] = [];
  let used = 0;
  for (const card of cards) {
    if (line.length > 0 && used + card.width > PAGE_WIDTH - 2 * MARGIN) {
      rows.push(cardsRow(line));
      line = [];
      used = 0;
    }
    line.push(card);
    used += card.width + GAP;
  }
  if (line.length > 0) rows.push(cardsRow(line));
  return rows;
}

function drawCard(page: Img, card: Card, x: number, y: number, row: Extract<Row, { kind: 'cards' }>): void {
  page.fillRect(x, y, card.width, row.height, COLORS.edge);
  page.fillRect(x + 1, y + 1, card.width - 2, row.height - 2, COLORS.card);
  page.fillRect(x + 1, y + 1, card.width - 2, 3, COLORS.rarity[card.rarity.id]);
  // Les images reposent sur une même ligne : les petites ne flottent pas au-dessus des grandes.
  page.paste(card.sprite, x + Math.floor((card.width - card.sprite.width) / 2), y + PADDING + row.spriteHeight - card.sprite.height, true);
  let textY = y + PADDING + row.spriteHeight + GAP;
  for (const line of card.lines) {
    drawText(page, x + PADDING, textY, line, COLORS.text, TEXT_SCALE);
    textY += TEXT_LINE;
  }
  drawText(page, x + PADDING, textY, `${formatPrice(card.item.price!)} kuartzons`, COLORS.price, TEXT_SCALE);
  drawText(page, x + PADDING, textY + TEXT_LINE + 2, card.meta, COLORS.small, SMALL_SCALE);
}

// La planche-contact : les éléments de la catégorie `boutique` qui ont un prix, du Commun au Légendaire.
export function renderSheet(items: readonly DecorItem[] = DECOR_ITEMS, atlas: Img = readImage(ATLAS_PATH)): Img {
  const shop = items.filter((item) => item.cat === 'boutique' && item.price !== undefined);
  const everything = shop.reduce((sum, item) => sum + item.price!, 0);

  const rows: Row[] = [titleRow(`BOUTIQUE · ${shop.length} éléments · ${formatPrice(everything)} kuartzons pour tout avoir`, COLORS.text)];
  for (const rarity of RARITIES) {
    const cards = shop.filter((item) => rarityOf(item.price!)?.id === rarity.id).map((item) => makeCard(item, rarity, atlas));
    if (cards.length > 0) rows.push(...rowsFor(rarity, cards));
  }

  const page = new Img(PAGE_WIDTH, MARGIN * 2 + rows.reduce((sum, row) => sum + row.height + GAP, 0));
  page.fillRect(0, 0, page.width, page.height, COLORS.page);
  let y = MARGIN;
  for (const row of rows) {
    if (row.kind === 'title') {
      drawText(page, MARGIN, y + GAP, row.text, row.color, TEXT_SCALE);
    } else {
      let x = MARGIN;
      for (const card of row.cards) {
        drawCard(page, card, x, y, row);
        x += card.width + GAP;
      }
    }
    y += row.height + GAP;
  }
  return page;
}

// `tsx scripts/assets/boutique-sheet.ts` s'exécute directement ; importé par un test, ce module n'écrit rien.
if (/[\\/]boutique-sheet\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  writeImage(SHEET_PATH, renderSheet());
  console.log(`Écrit dans ${SHEET_PATH}.`);
}
