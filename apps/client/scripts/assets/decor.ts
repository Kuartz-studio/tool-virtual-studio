// La banque d'éléments : découpe les entrées retenues (curation/) dans les planches du pack, range chaque catégorie dans un atlas
// (public/assets/decor/<catégorie>.png) et écrit la liste (packages/shared/src/decor/generated.ts) que lisent le client et le serveur.
import { join } from 'node:path';
import { DECOR_CATEGORIES, type DecorCategoryId, type DecorItem, type DecorKind } from '@bureau/shared';
import { INTERIOR_ENTRIES } from './curation/interiors';
import { OFFICE_ENTRIES } from './curation/office';
import { SHEETS, type Entry } from './curation/types';
import { readImage, type Img } from './image';
import { packImages } from './pack';
import { segmentSheet, type Component } from './segment';

export const ENTRIES: Entry[] = [...OFFICE_ENTRIES, ...INTERIOR_ENTRIES];

type Rect = readonly [number, number, number, number];
export type ResolvedEntry = Entry & { rect: Rect };

export function defaultsOf(entry: ResolvedEntry): { kind: DecorKind; claim: number; solid: boolean } {
  const h = entry.rect[3];
  const kind: DecorKind = entry.kind ?? (entry.cat === 'ecrans' || entry.cat === 'papeterie' ? 'onTop' : 'object');
  const claim = entry.claim ?? (kind === 'wall' ? 0 : kind === 'floor' ? h : entry.cat === 'bureaux' ? h : 1);
  const solid = entry.solid ?? (kind === 'object' && entry.cat !== 'sieges');
  return { kind, claim: Math.min(claim, h), solid };
}

export function itemId(entry: ResolvedEntry): string {
  return `${entry.sheet}-${entry.rect[0]}-${entry.rect[1]}`;
}

export interface BuiltDecor {
  items: DecorItem[];
  atlases: Map<DecorCategoryId, Img>;
  sprites: Map<string, Img>;
}

// Les planches lues et découpées une fois.
export class Sheets {
  private readonly images = new Map<string, Img>();
  private readonly components = new Map<string, Component[]>();

  constructor(private readonly source: string) {}

  image(key: string): Img {
    let img = this.images.get(key);
    if (!img) {
      const rel = SHEETS[key];
      if (!rel) throw new Error(`Planche inconnue : « ${key} ».`);
      img = readImage(join(this.source, rel));
      this.images.set(key, img);
    }
    return img;
  }

  private componentsOf(key: string): Component[] {
    let found = this.components.get(key);
    if (!found) {
      found = segmentSheet(this.image(key));
      this.components.set(key, found);
    }
    return found;
  }

  // Le rectangle de l'entrée : le sien, ou celui de l'objet dont le coin haut-gauche est à `at` (le plus grand, s'il y en a plusieurs).
  resolve(entry: Entry): ResolvedEntry {
    if (entry.rect) return entry as ResolvedEntry;
    if (!entry.at) throw new Error(`« ${entry.name} » n'a ni rectangle ni case de départ.`);
    const [tx, ty] = entry.at;
    const found = this.componentsOf(entry.sheet)
      .filter((c) => c.tx === tx && c.ty === ty)
      .sort((a, b) => b.tw * b.th - a.tw * a.th)[0];
    if (!found) throw new Error(`« ${entry.name} » : aucun objet ne commence à la case ${tx}, ${ty} de la planche ${entry.sheet}.`);
    return { ...entry, rect: [found.tx, found.ty, found.tw, found.th] };
  }
}

export function buildDecor(sheets: Sheets, entries: Entry[] = ENTRIES): BuiltDecor {
  const resolved = entries.map((entry) => sheets.resolve(entry));
  const sprites = new Map<string, Img>();
  for (const entry of resolved) {
    const id = itemId(entry);
    if (sprites.has(id)) throw new Error(`Deux éléments portent l'identifiant ${id} (« ${entry.name} »).`);
    const [tx, ty, tw, th] = entry.rect;
    const image = sheets.image(entry.sheet).crop(tx * 32, ty * 32, tw * 32, th * 32);
    if (image.isEmpty()) throw new Error(`« ${entry.name} » (${id}) : le rectangle est vide.`);
    sprites.set(id, image);
  }

  const items: DecorItem[] = [];
  const atlases = new Map<DecorCategoryId, Img>();
  for (const { id: cat } of DECOR_CATEGORIES) {
    const inCat = resolved.filter((entry) => entry.cat === cat);
    if (inCat.length === 0) continue;
    const packed = packImages(inCat.map((entry) => ({ key: itemId(entry), image: sprites.get(itemId(entry))! })));
    atlases.set(cat, packed.atlas);
    for (const entry of inCat) {
      const frame = packed.frames.get(itemId(entry))!;
      const { kind, claim, solid } = defaultsOf(entry);
      items.push({ id: itemId(entry), cat, name: entry.name, kind, w: entry.rect[2], h: entry.rect[3], claim, solid, fx: frame.x, fy: frame.y });
    }
  }
  return { items, atlases, sprites };
}

// Le fichier TypeScript généré : une ligne par élément, dans l'ordre des catégories puis des planches.
export function renderCatalogSource(items: DecorItem[]): string {
  const lines = items.map(
    (i) =>
      `  { id: ${JSON.stringify(i.id)}, cat: ${JSON.stringify(i.cat)}, name: ${JSON.stringify(i.name)}, kind: ${JSON.stringify(i.kind)}, w: ${i.w}, h: ${i.h}, claim: ${i.claim}, solid: ${i.solid}, fx: ${i.fx}, fy: ${i.fy} },`,
  );
  return `// Généré par \`pnpm --filter @bureau/client gen:assets\` (apps/client/scripts/assets) : ne pas modifier à la main.
import type { DecorItem } from './types';

export const DECOR_ITEMS: readonly DecorItem[] = [
${lines.join('\n')}
];
`;
}
