// Les éléments de la carte du bureau qui ne viennent pas des planches de la banque : le jardin, dessiné en pixel art (garden-art.ts), des objets des
// packs pris un à un (les « Singles » : jardinières du musée, canapé et fauteuils coques du bureau moderne, comptoirs de l'hôpital…) et trois meubles
// faits de leurs morceaux mis bout à bout (la grande table de la conférence, le comptoir de l'accueil, le bar de la cafétéria). Ils ont leur atlas à
// eux (public/assets/decor/plan.png) et leur liste (packages/shared/src/decor/generated-plan.ts) : la banque les connaît, mais ils sont réservés à la
// carte (`mapOnly`) : le sélecteur de déco ne les propose pas, et la déco d'un bureau ne peut pas les poser.
//
// Chaque image est rangée dans un cadre d'un nombre entier de cases, centrée en largeur et posée sur le bas : un objet se pose par sa case, comme ceux
// de la banque, et la carte l'ajuste au pixel près si besoin (offsetX, offsetY).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DECOR_ITEMS, TILE_SIZE, type DecorCategoryId, type DecorItem, type DecorKind } from '@bureau/shared';
import { FLOWER_COLORS, bigBush, bush, doormat, flowerBed, hedge, hedgeSide, pond, rug, tree } from './garden-art';
import { Img, readImage } from './image';
import { packImages } from './pack';

export const PLAN_ATLAS = 'plan';

// Les dossiers des « Singles » dans les ressources : un fichier par objet, dont le nom finit par son numéro (`…_205.png`).
const SINGLES_DIR = 'moderninteriors-win/1_Interiors/32x32/Theme_Sorter_Singles_32x32';
const SINGLES: Readonly<Record<string, string>> = {
  of: 'Modern_Office_Revamped_v1.2/4_Modern_Office_singles/32x32',
  lv: `${SINGLES_DIR}/2_Living_Room_Singles_32x32`,
  ki: `${SINGLES_DIR}/12_Kitchen_Singles_32x32`,
  cf: `${SINGLES_DIR}/13_Conference_Hall_Singles_32x32`,
  ho: `${SINGLES_DIR}/19_Hospital_SIngles_32x32`,
  mu: `${SINGLES_DIR}/22_Museum_Singles_32x32`,
  co: `${SINGLES_DIR}/26_Condominium_Singles_32x32`,
};

// Les objets des packs, lus une fois et rognés de leurs bords transparents (les Singles du bureau moderne sont dans des cadres de 64 × 96).
export class Singles {
  private readonly files = new Map<string, string[]>();
  private readonly images = new Map<string, Img>();

  constructor(private readonly source: string) {}

  // « mu:203 » : l'objet n° 203 du musée ; « ~ki:287 » : le même, retourné.
  get(code: string): Img {
    if (code.startsWith('~')) return this.get(code.slice(1)).mirrorX();
    let image = this.images.get(code);
    if (!image) {
      const [pack, n] = code.split(':');
      const dir = SINGLES[pack!];
      if (!dir) throw new Error(`Pack inconnu : « ${code} ».`);
      const path = join(this.source, dir);
      if (!this.files.has(path)) this.files.set(path, readdirSync(path).filter((f) => f.endsWith('.png')));
      const file = this.files.get(path)!.find((name) => name.endsWith(`_${n}.png`));
      if (!file) throw new Error(`Objet introuvable : « ${code} » (${path}).`);
      const raw = readImage(join(path, file));
      const box = raw.contentBox();
      image = box ? raw.crop(box.left, box.top, box.right - box.left, box.bottom - box.top) : raw;
      this.images.set(code, image);
    }
    return image;
  }
}

// Des images côte à côte, alignées par le bas (un comptoir fait de ses modules, une table de ses morceaux).
function row(parts: readonly Img[]): Img {
  const out = new Img(parts.reduce((sum, p) => sum + p.width, 0), Math.max(...parts.map((p) => p.height)));
  let x = 0;
  for (const part of parts) {
    out.paste(part, x, out.height - part.height);
    x += part.width;
  }
  return out;
}

// Une image collée sur une autre, à (x, y).
function over(base: Img, ...layers: ReadonlyArray<readonly [Img, number, number]>): Img {
  const out = new Img(base.width, base.height);
  out.paste(base, 0, 0, false);
  for (const [image, x, y] of layers) out.paste(image, x, y);
  return out;
}

export interface PlanSpec {
  id: string;
  name: string;
  cat: DecorCategoryId;
  kind?: DecorKind;   // object par défaut
  // Les rangées du bas qu'il occupe au sol : 1 par défaut, toute l'image pour ce qui est à même le sol.
  claim?: number;
  solid: boolean;
  draw: (singles: Singles) => Img;
}

const pink = [FLOWER_COLORS.white, FLOWER_COLORS.pink];
const yellow = [FLOWER_COLORS.yellow];
const lilac = [FLOWER_COLORS.lilac, FLOWER_COLORS.white];

// Ce que la carte pose : le jardin d'abord, puis les objets des packs, puis les meubles composés.
export const PLAN_SPECS: readonly PlanSpec[] = [
  // Le jardin. Les buissons et la haie arrêtent l'avatar (ce ne sont pas des plantes en pot), comme le bassin et les massifs de fleurs. Un arbre, lui,
  // n'arrête qu'au pied de son tronc : sa couronne de trois cases passe au-dessus du chemin, et la carte bloque la case du tronc.
  ...[1, 2, 3, 4].map((n): PlanSpec => ({ id: `arbre-${n}`, name: 'Arbre', cat: 'plantes', solid: false, draw: () => tree(100 + n) })),
  { id: 'gros-buisson-1', name: 'Gros buisson', cat: 'plantes', solid: true, draw: () => bigBush(11) },
  { id: 'gros-buisson-2', name: 'Gros buisson', cat: 'plantes', solid: true, draw: () => bigBush(12) },
  { id: 'gros-buisson-rose', name: 'Gros buisson fleuri, rose', cat: 'plantes', solid: true, draw: () => bigBush(13, pink) },
  { id: 'gros-buisson-jaune', name: 'Gros buisson fleuri, jaune', cat: 'plantes', solid: true, draw: () => bigBush(14, yellow) },
  { id: 'gros-buisson-lilas', name: 'Gros buisson fleuri, lilas', cat: 'plantes', solid: true, draw: () => bigBush(15, lilac) },
  ...[1, 2, 3].map((n): PlanSpec => ({ id: `buisson-${n}`, name: 'Buisson', cat: 'plantes', solid: true, draw: () => bush(20 + n) })),
  ...[1, 2].map((n): PlanSpec => ({ id: `buisson-rose-${n}`, name: 'Buisson fleuri, rose', cat: 'plantes', solid: true, draw: () => bush(30 + n, pink) })),
  ...[1, 2].map((n): PlanSpec => ({ id: `buisson-jaune-${n}`, name: 'Buisson fleuri, jaune', cat: 'plantes', solid: true, draw: () => bush(40 + n, yellow) })),
  ...[1, 2].map((n): PlanSpec => ({ id: `buisson-lilas-${n}`, name: 'Buisson fleuri, lilas', cat: 'plantes', solid: true, draw: () => bush(50 + n, lilac) })),
  // Le buisson taillé posé au milieu d'un massif (qui, lui, arrête déjà l'avatar).
  { id: 'buisson-taille', name: 'Buisson taillé', cat: 'plantes', solid: false, draw: () => bush(77) },
  ...[1, 2, 3].map((n): PlanSpec => ({ id: `haie-${n}`, name: 'Haie', cat: 'plantes', solid: true, draw: () => hedge(60 + n) })),
  ...[1, 2, 3].map((n): PlanSpec => ({ id: `haie-cote-${n}`, name: 'Haie (côté)', cat: 'plantes', solid: true, draw: () => hedgeSide(70 + n) })),
  // Le bassin, ses nénuphars et la fleur de l'un d'eux dessinés dedans (posés sur l'eau, ils ne passent jamais devant personne).
  {
    id: 'bassin',
    name: 'Bassin',
    cat: 'deco',
    kind: 'floor',
    solid: true,
    draw: (s) => over(pond(4, 3, 11), [s.get('mu:247'), 14, 44], [s.get('mu:247'), 74, 18], [s.get('mu:247'), 66, 68], [s.get('mu:251'), 76, 20]),
  },
  { id: 'massif-1', name: 'Massif de fleurs', cat: 'plantes', kind: 'floor', solid: true, draw: () => flowerBed(4, 3, 21) },
  { id: 'massif-jaune', name: 'Massif de fleurs jaunes', cat: 'plantes', kind: 'floor', solid: true, draw: () => flowerBed(4, 3, 22, false, [FLOWER_COLORS.yellow, FLOWER_COLORS.white]) },
  { id: 'massif-rond-lilas', name: 'Massif rond, lilas', cat: 'plantes', kind: 'floor', solid: true, draw: () => flowerBed(3, 3, 23, true, [FLOWER_COLORS.lilac, FLOWER_COLORS.pink]) },
  {
    id: 'massif-rond-rouge',
    name: 'Massif rond, rouge',
    cat: 'plantes',
    kind: 'floor',
    solid: true,
    draw: () => flowerBed(3, 3, 41, true, [FLOWER_COLORS.red, FLOWER_COLORS.pink, FLOWER_COLORS.white]),
  },
  ...[1, 2].map((n): PlanSpec => ({ id: `massif-rose-${n}`, name: 'Massif de fleurs roses', cat: 'plantes', kind: 'floor', solid: true, draw: () => flowerBed(3, 3, 41 + n, false, pink) })),
  ...[1, 2].map((n): PlanSpec => ({ id: `massif-or-${n}`, name: 'Massif de fleurs dorées', cat: 'plantes', kind: 'floor', solid: true, draw: () => flowerBed(3, 3, 43 + n, false, [FLOWER_COLORS.yellow, FLOWER_COLORS.lilac]) })),
  { id: 'paillasson-entree', name: "Paillasson de l'entrée", cat: 'deco', kind: 'floor', solid: false, draw: () => doormat() },
  { id: 'tapis-beige', name: 'Tapis beige', cat: 'deco', kind: 'floor', solid: false, draw: () => rug(6, 4, false) },
  { id: 'tapis-rond-beige', name: 'Tapis rond beige', cat: 'deco', kind: 'floor', solid: false, draw: () => rug(8, 5, true) },
  { id: 'tapis-rond-greige', name: 'Tapis rond grège', cat: 'deco', kind: 'floor', solid: false, draw: () => rug(5, 4, true, 'greige') },

  // Les objets des packs.
  { id: 'plante-bureau', name: 'Plante verte en pot', cat: 'plantes', solid: false, draw: (s) => s.get('of:98') },
  { id: 'plante-grande', name: 'Grande plante en pot', cat: 'plantes', solid: false, draw: (s) => s.get('lv:18') },
  { id: 'plante-haute', name: 'Plante haute', cat: 'plantes', solid: false, draw: (s) => s.get('lv:17') },
  { id: 'palmier-pot', name: 'Palmier en pot', cat: 'plantes', solid: false, draw: (s) => s.get('lv:14') },
  { id: 'plante-musee', name: 'Plante en vasque', cat: 'plantes', solid: false, draw: (s) => s.get('mu:196') },
  { id: 'grande-plante', name: 'Très grande plante', cat: 'plantes', solid: false, draw: (s) => s.get('mu:197') },
  // Les jardinières : de grands bacs, qui arrêtent l'avatar comme un meuble.
  ...[203, 204, 205, 206, 207, 208].map((n, i): PlanSpec => ({ id: `jardiniere-${i + 1}`, name: 'Jardinière', cat: 'plantes', solid: true, draw: (s) => s.get(`mu:${n}`) })),
  { id: 'roseaux', name: 'Roseaux', cat: 'plantes', solid: false, draw: (s) => s.get('mu:245') },
  { id: 'fleur-1', name: 'Fleurs', cat: 'plantes', solid: false, draw: (s) => s.get('mu:250') },
  { id: 'fleur-2', name: 'Fleurs', cat: 'plantes', solid: false, draw: (s) => s.get('mu:251') },
  { id: 'fleur-3', name: 'Fleurs', cat: 'plantes', solid: false, draw: (s) => s.get('mu:252') },
  { id: 'banc-jardin', name: 'Banc de jardin', cat: 'sieges', solid: false, draw: (s) => s.get('mu:36') },
  { id: 'chaise-conference-face', name: 'Fauteuil de conférence (de face)', cat: 'sieges', solid: false, draw: (s) => s.get('of:112') },
  { id: 'chaise-conference-dos', name: 'Fauteuil de conférence (de dos)', cat: 'sieges', solid: false, draw: (s) => s.get('of:108') },
  { id: 'chaise-conference-gauche', name: 'Fauteuil de conférence (vers la gauche)', cat: 'sieges', solid: false, draw: (s) => s.get('of:109') },
  { id: 'chaise-conference-droite', name: 'Fauteuil de conférence (vers la droite)', cat: 'sieges', solid: false, draw: (s) => s.get('of:110') },
  { id: 'canape-salon', name: 'Canapé', cat: 'sieges', solid: false, draw: (s) => s.get('of:205') },
  { id: 'fauteuil-coque-1', name: 'Fauteuil coque', cat: 'sieges', solid: false, draw: (s) => s.get('of:198') },
  { id: 'fauteuil-coque-2', name: 'Fauteuil coque', cat: 'sieges', solid: false, draw: (s) => s.get('of:196') },
  { id: 'chaise-bistrot', name: 'Chaise de bistrot', cat: 'sieges', solid: false, draw: (s) => s.get('ki:287') },
  { id: 'chaise-bistrot-m', name: 'Chaise de bistrot', cat: 'sieges', solid: false, draw: (s) => s.get('~ki:287') },
  { id: 'tabouret-bar', name: 'Tabouret de bar', cat: 'sieges', solid: false, draw: (s) => s.get('ki:288') },
  { id: 'table-basse-salon', name: 'Table basse', cat: 'detente', solid: true, draw: (s) => s.get('of:188') },
  { id: 'table-ronde-blanche', name: 'Table ronde blanche', cat: 'detente', solid: true, draw: (s) => s.get('ho:421') },
  { id: 'lampadaire-1', name: 'Lampadaire', cat: 'deco', solid: false, draw: (s) => s.get('lv:87') },
  { id: 'lampadaire-2', name: 'Lampadaire', cat: 'deco', solid: false, draw: (s) => s.get('lv:88') },
  { id: 'plante-comptoir', name: 'Petite plante', cat: 'plantes', kind: 'onTop', solid: false, draw: (s) => s.get('lv:15') },
  { id: 'coupe-fruits', name: 'Coupe de fruits', cat: 'cafe', kind: 'onTop', solid: false, draw: (s) => s.get('lv:48') },
  { id: 'paillasson', name: 'Paillasson', cat: 'deco', kind: 'floor', solid: false, draw: (s) => s.get('co:63') },

  // Les meubles composés. La table de la conférence : ses deux bouts arrondis et six morceaux du milieu ; deux rangées au sol, sous le plateau.
  {
    id: 'table-conference',
    name: 'Grande table de conférence',
    cat: 'bureaux',
    claim: 2,
    solid: true,
    draw: (s) => row([s.get('cf:1'), ...Array.from({ length: 6 }, () => s.get('cf:2')), s.get('~cf:1')]),
  },
  // Le comptoir de l'accueil, en U : ses deux retours et sept modules en bois clair ; celui de la cafétéria, blanc, en cinq modules.
  {
    id: 'comptoir-accueil',
    name: "Comptoir de l'accueil",
    cat: 'bureaux',
    claim: 2,
    solid: true,
    draw: (s) => row(['ho:8', 'ho:9', 'ho:10', 'ho:9', 'ho:10', 'ho:9', 'ho:10', 'ho:9', 'ho:11'].map((code) => s.get(code))),
  },
  {
    id: 'bar-cafeteria',
    name: 'Bar de la cafétéria',
    cat: 'cafe',
    claim: 2,
    solid: true,
    draw: (s) => row(['ho:29', 'ho:30', 'ho:31', 'ho:30', 'ho:31', 'ho:30', 'ho:32'].map((code) => s.get(code))),
  },
];

// L'image dans son cadre : un nombre entier de cases, l'image centrée en largeur et posée sur le bas.
export function framed(image: Img): Img {
  const [w, h] = [Math.max(1, Math.ceil(image.width / TILE_SIZE)), Math.max(1, Math.ceil(image.height / TILE_SIZE))];
  const out = new Img(w * TILE_SIZE, h * TILE_SIZE);
  out.paste(image, Math.floor((out.width - image.width) / 2), out.height - image.height, false);
  return out;
}

export interface BuiltPlanDecor {
  items: DecorItem[];
  atlas: Img;
}

export function buildPlanDecor(source: string, specs: readonly PlanSpec[] = PLAN_SPECS): BuiltPlanDecor {
  const singles = new Singles(source);
  const taken = new Set(DECOR_ITEMS.map((item) => item.id));
  const images = new Map<string, Img>();
  for (const spec of specs) {
    if (taken.has(spec.id) || images.has(spec.id)) throw new Error(`Deux éléments portent l'identifiant « ${spec.id} ».`);
    images.set(spec.id, framed(spec.draw(singles)));
  }
  const packed = packImages(specs.map((spec) => ({ key: spec.id, image: images.get(spec.id)! })));
  const items = specs.map((spec): DecorItem => {
    const frame = packed.frames.get(spec.id)!;
    const [w, h] = [frame.w / TILE_SIZE, frame.h / TILE_SIZE];
    const kind = spec.kind ?? 'object';
    const claim = Math.min(spec.claim ?? (kind === 'floor' ? h : 1), h);
    return { id: spec.id, cat: spec.cat, name: spec.name, kind, w, h, claim, solid: spec.solid, fx: frame.x, fy: frame.y, atlas: PLAN_ATLAS, mapOnly: true };
  });
  return { items, atlas: packed.atlas };
}

// Le fichier TypeScript généré : une ligne par élément, dans l'ordre de PLAN_SPECS.
export function renderPlanSource(items: readonly DecorItem[]): string {
  const lines = items.map(
    (i) =>
      `  { id: ${JSON.stringify(i.id)}, cat: ${JSON.stringify(i.cat)}, name: ${JSON.stringify(i.name)}, kind: ${JSON.stringify(i.kind)}, w: ${i.w}, h: ${i.h}, claim: ${i.claim}, solid: ${i.solid}, fx: ${i.fx}, fy: ${i.fy}, atlas: ${JSON.stringify(i.atlas)}, mapOnly: true },`,
  );
  return `// Généré par \`pnpm --filter @bureau/client gen:assets\` (apps/client/scripts/assets/plan-decor.ts) : ne pas modifier à la main.
import type { DecorItem } from './types';

// Les éléments de la carte du bureau dessinés à part (le jardin) ou pris un à un dans les packs : leur atlas (public/assets/decor/plan.png), réservés
// à la carte.
export const PLAN_ITEMS: readonly DecorItem[] = [
${lines.join('\n')}
];
`;
}
