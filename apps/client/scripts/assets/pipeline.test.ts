import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CHARACTER_PARTS, DECOR_CATEGORIES, DECOR_ITEMS, FLOOR_THEMES, POOL_TILES, TILESET, WALL_THEMES, type DecorItem } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { Img, readImage } from './image';
import { ATLAS_MARGIN, packImages } from './pack';
import { extract, segmentSheet } from './segment';
import { ASSETS_DIR } from './build-assets';
import { mapFiles, MAPS_DIR } from './build-map';
import { BOUTIQUE_ENTRIES, RARITIES, rarityOf } from './curation/boutique';
import {
  BIG_FOOTPRINT_CELLS,
  BIG_ITEM_TILES,
  ENTRIES,
  MIN_FLOAT_PX,
  SOLID_CATEGORIES,
  Sheets,
  buildDecor,
  checkPrice,
  defaultsOf,
  fitOnFootprint,
  renderCatalogSource,
  type ResolvedEntry,
} from './decor';
import { readFileSync } from 'node:fs';

const solid = (w: number, h: number, a = 255): Img => {
  const img = new Img(w, h);
  img.fillRect(0, 0, w, h, { r: 200, g: 50, b: 50, a });
  return img;
};

describe('la découpe d\'une planche (segment.ts)', () => {
  test('deux objets séparés par du vide sont deux objets, rangés de haut en bas puis de gauche à droite', () => {
    const sheet = new Img(128, 96);
    sheet.paste(solid(20, 40), 70, 4);
    sheet.paste(solid(20, 20), 5, 5);
    const found = segmentSheet(sheet);
    expect(found.map(({ tx, ty, tw, th }) => ({ tx, ty, tw, th }))).toEqual([
      { tx: 0, ty: 0, tw: 1, th: 1 },
      { tx: 2, ty: 0, tw: 1, th: 2 },
    ]);
  });

  test('l\'image d\'un objet ne garde que ses pixels : un voisin qui déborde dans son rectangle n\'y est pas', () => {
    const sheet = new Img(96, 64);
    sheet.paste(solid(20, 20), 4, 4);
    sheet.paste(solid(10, 10), 40, 4);   // un autre objet, dans la case voisine
    const [first, second] = segmentSheet(sheet);
    expect(extract(sheet, first!).get(5, 5).a).toBe(255);
    expect(extract(sheet, first!).isEmpty()).toBe(false);
    expect(extract(sheet, second!).get(5, 5).a).toBe(0);   // la case 1 n'est pas le coin de l'objet de gauche
  });

  test('un objet de plusieurs pixels disjoints en diagonale reste un seul objet (8 voisins)', () => {
    const sheet = new Img(64, 64);
    sheet.set(1, 1, { r: 1, g: 1, b: 1, a: 255 });
    sheet.set(2, 2, { r: 1, g: 1, b: 1, a: 255 });
    expect(segmentSheet(sheet)).toHaveLength(1);
  });
});

describe('l\'atlas (pack.ts)', () => {
  test('les images tiennent dans la largeur, ne se touchent pas, et chacune se retrouve à sa place', () => {
    const inputs = [solid(64, 96), solid(32, 32), solid(96, 64), solid(32, 64), solid(160, 96)].map((image, i) => ({ key: `k${i}`, image }));
    const { atlas, frames } = packImages(inputs, 256);
    expect(atlas.width).toBe(256);
    const rects = [...frames.values()];
    for (const [i, a] of rects.entries()) {
      expect(a.x + a.w + ATLAS_MARGIN).toBeLessThanOrEqual(256);
      for (const b of rects.slice(i + 1)) {
        const apart = a.x + a.w + ATLAS_MARGIN <= b.x || b.x + b.w + ATLAS_MARGIN <= a.x || a.y + a.h + ATLAS_MARGIN <= b.y || b.y + b.h + ATLAS_MARGIN <= a.y;
        expect(apart).toBe(true);
      }
    }
    const f = frames.get('k2')!;
    expect(atlas.get(f.x + 1, f.y + 1).a).toBe(255);
  });

  test('une image plus large que l\'atlas : refusée', () => {
    expect(() => packImages([{ key: 'big', image: solid(300, 10) }], 256)).toThrow(/ne tient pas/);
  });
});

// Ce que les images du pack sont devenues dans l'appli : le dépôt garde les fichiers produits (le pack lui-même n'y est pas), on vérifie qu'ils
// sont complets et cohérents avec les listes générées.
describe('les assets rangés dans l\'appli', () => {
  test('un atlas par catégorie, et chaque élément est dans le sien', () => {
    expect(DECOR_CATEGORIES.length).toBeLessThanOrEqual(11);
    for (const { id } of DECOR_CATEGORIES) {
      const path = join(ASSETS_DIR, 'decor', `${id}.png`);
      expect(existsSync(path), id).toBe(true);
      const atlas = readImage(path);
      for (const item of DECOR_ITEMS.filter((i) => i.cat === id)) {
        expect(item.fx + item.w * 32, item.id).toBeLessThanOrEqual(atlas.width);
        expect(item.fy + item.h * 32, item.id).toBeLessThanOrEqual(atlas.height);
        expect(atlas.crop(item.fx, item.fy, item.w * 32, item.h * 32).isEmpty(), item.id).toBe(false);
      }
    }
  });

  test('le jeu de tuiles contient tous les sols, les murs et la piscine cités', () => {
    const tiles = readImage(join(ASSETS_DIR, 'tiles/office.png'));
    expect(tiles.width).toBe(TILESET.columns * 32);
    expect(tiles.height).toBe(Math.ceil(TILESET.tileCount / TILESET.columns) * 32);
    const gids = [
      ...FLOOR_THEMES.map((f) => f.gid),
      ...WALL_THEMES.flatMap((w) => [w.top, w.bottom, w.stem]),
      ...Object.values(POOL_TILES),
    ];
    for (const gid of gids) {
      expect(gid).toBeGreaterThanOrEqual(1);
      expect(gid).toBeLessThanOrEqual(TILESET.tileCount);
      const index = gid - 1;
      expect(tiles.crop((index % TILESET.columns) * 32, Math.floor(index / TILESET.columns) * 32, 32, 32).isEmpty(), `tuile ${gid}`).toBe(false);
    }
  });

  test('chaque pièce du personnage a son fichier, à la bonne hauteur (128 px par variante), et ses imagettes', () => {
    const dir = join(ASSETS_DIR, 'characters');
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(readImage(join(dir, 'bodies.png')).height).toBe(128 * CHARACTER_PARTS.bodies);
    expect(readImage(join(dir, 'eyes.png')).height).toBe(128 * CHARACTER_PARTS.eyes);
    expect(readImage(join(dir, 'premade.png')).height).toBe(128 * CHARACTER_PARTS.premade);
    const thumbs = readImage(join(dir, 'thumbs.png'));
    const thumbOk = (index: number) => {
      const { columns } = CHARACTER_PARTS.thumbs;
      return !thumbs.crop((index % columns) * 32, Math.floor(index / columns) * 64, 32, 64).isEmpty();
    };
    expect(thumbOk(CHARACTER_PARTS.thumbs.bodies)).toBe(true);
    expect(thumbOk(CHARACTER_PARTS.thumbs.premade + CHARACTER_PARTS.premade - 1)).toBe(true);
    for (const [folder, families] of [['outfits', CHARACTER_PARTS.outfits], ['hair', CHARACTER_PARTS.hair], ['accessories', CHARACTER_PARTS.accessories]] as const) {
      for (const family of families) {
        expect(readImage(join(dir, folder, `${pad(family.number)}.png`)).height, `${folder} ${family.number}`).toBe(128 * family.variants);
        expect(thumbOk(family.thumb + family.variants - 1), `${folder} ${family.number}`).toBe(true);
      }
    }
  });

  test('les cartes écrites sont celles que la définition partagée produit (relancer gen:map ne change rien)', () => {
    for (const { path, content } of mapFiles()) {
      expect(readFileSync(join(MAPS_DIR, path), 'utf8'), path).toBe(content);
    }
  });
});

describe('les planches Gym et Basement', () => {
  const inCategory = (cat: string) => DECOR_ITEMS.filter((item) => item.cat === cat);
  const named = (id: string) => DECOR_ITEMS.find((item) => item.id === id);

  test('une catégorie « Sport & jeux », après les neuf premières (la collection à part vient encore après)', () => {
    expect(DECOR_CATEGORIES.map((c) => c.id)).toContain('sport');
    expect(DECOR_CATEGORIES.at(-2)).toEqual({ id: 'sport', label: 'Sport & jeux' });
    expect(DECOR_CATEGORIES.at(-1)).toEqual({ id: 'boutique', label: 'Boutique' });
    expect(inCategory('sport').length).toBeGreaterThanOrEqual(20);
  });

  test('de quoi équiper une salle de sport : tapis, ballons, haltères, bancs, miroirs', () => {
    const names = inCategory('sport').map((item) => item.name);
    for (const wanted of [/Tapis de yoga/, /Ballon de gym/, /Râtelier d'haltères/, /Banc de musculation/, /Miroir de salle de sport/]) {
      expect(names.some((n) => wanted.test(n)), String(wanted)).toBe(true);
    }
  });

  test('de quoi équiper une salle de jeu : ping-pong, billard, arcade, canapés, fauteuils, tabourets, télé', () => {
    const names = DECOR_ITEMS.filter((item) => item.id.startsWith('ba-')).map((item) => item.name);
    for (const wanted of [/Table de ping-pong/, /Billard/, /Borne d'arcade/, /Canapé/, /Fauteuil/, /Tabouret/, /Meuble télé/, /Table ronde/, /Coussin/]) {
      expect(names.some((n) => wanted.test(n)), String(wanted)).toBe(true);
    }
  });

  test('les tables de jeu bloquent le passage sur toute leur surface, les sièges jamais', () => {
    for (const id of ['ba-0-12', 'ba-4-25']) {
      const table = named(id)!;
      expect(table.solid, table.name).toBe(true);
      expect(table.claim, table.name).toBe(table.h);
    }
    for (const item of DECOR_ITEMS.filter((i) => i.id.startsWith('ba-') && i.cat === 'sieges')) expect(item.solid, item.name).toBe(false);
  });

  test('les tapis se posent à même le sol, les miroirs et les tableaux au mur', () => {
    expect(named('gy-3-1')!.kind).toBe('floor');
    expect(named('ba-0-16')!.kind).toBe('floor');
    for (const item of DECOR_ITEMS.filter((i) => /Miroir de salle de sport/.test(i.name))) expect(item.kind, item.name).toBe('wall');
  });

  test('aucun nom ne se répète dans une catégorie', () => {
    for (const { id } of DECOR_CATEGORIES) {
      const names = inCategory(id).map((item) => item.name);
      expect(new Set(names).size, id).toBe(names.length);
    }
  });
});

describe('qui arrête l\'avatar : les tables, les rangements, les gros appareils, jamais un siège ni une plante', () => {
  const entry = (cat: ResolvedEntry['cat'], rect: ResolvedEntry['rect'], more: Partial<ResolvedEntry> = {}): ResolvedEntry => ({ sheet: 'of', name: 'x', cat, rect, ...more });

  test('un petit meuble se traverse, un gros l\'arrête', () => {
    expect([BIG_ITEM_TILES, BIG_FOOTPRINT_CELLS]).toEqual([3, 2]);
    // Un bureau, une bibliothèque, un frigo (1 case au sol mais 3 d'image), un comptoir : gros.
    expect(defaultsOf(entry('bureaux', [7, 28, 3, 2])).solid).toBe(true);
    expect(defaultsOf(entry('rangement', [3, 13, 2, 2])).solid).toBe(true);
    expect(defaultsOf(entry('cafe', [9, 23, 1, 3])).solid).toBe(true);
    expect(defaultsOf(entry('sport', [10, 30, 2, 3], { claim: 2 })).solid).toBe(true);
    // Une petite table (1 × 2 cases d'image, 1 au sol) : traversable.
    expect(defaultsOf(entry('rangement', [0, 0, 1, 2], { claim: 1 })).solid).toBe(false);
  });

  test('les sièges, les plantes, les objets posés sur un meuble et les tapis ne bloquent jamais, même grands', () => {
    expect(defaultsOf(entry('sieges', [1, 28, 3, 2])).solid).toBe(false);
    expect(defaultsOf(entry('ecrans', [14, 12, 3, 3])).solid).toBe(false);
    expect(defaultsOf(entry('deco', [0, 0, 4, 3], { kind: 'floor' })).solid).toBe(false);
    // Une plante, petite, haute ou grande comme un palmier : on passe à travers.
    for (const rect of [[6, 10, 1, 2], [6, 7, 1, 3], [13, 0, 2, 2], [10, 0, 2, 3]] as const) expect(defaultsOf(entry('plantes', rect)).solid, String(rect)).toBe(false);
  });

  test('la curation peut dire solid elle-même, dans un sens comme dans l\'autre', () => {
    expect(defaultsOf(entry('plantes', [6, 10, 1, 2], { solid: true })).solid).toBe(true);
    expect(defaultsOf(entry('bureaux', [7, 28, 3, 2], { solid: false })).solid).toBe(false);
  });

  test('dans la banque : aucun siège, aucune plante, aucun banc ne bloque, et les grandes tables et les gros meubles bloquent tous', () => {
    for (const item of DECOR_ITEMS.filter((i) => i.cat === 'sieges' || i.cat === 'plantes')) expect(item.solid, item.name).toBe(false);
    for (const item of DECOR_ITEMS.filter((i) => /^Banc (de bois|de cantine|en bois)/.test(i.name))) expect(item.solid, item.name).toBe(false);
    const bigDesks = DECOR_ITEMS.filter((item) => item.cat === 'bureaux' && item.kind === 'object' && item.w * item.h >= 6 && !/^Banc /.test(item.name));
    expect(bigDesks.length).toBeGreaterThan(10);
    for (const desk of bigDesks) expect(desk.solid, desk.name).toBe(true);
  });

  test('dans la banque : ce qui bloque est une table, un rangement, un appareil de cuisine, du sport, une cheminée, un piano, un jeu, une cloison — rien d\'autre', () => {
    // Les exceptions de la curation, posées une à une : des appareils de bureau (les imprimantes sur meuble et la copieuse), une borne, deux cloisons.
    const named = (item: { name: string }) => /^(Imprimante|Borne tactile|Cloison vitrée)/.test(item.name);
    const stray = DECOR_ITEMS.filter((item) => item.solid && !SOLID_CATEGORIES.has(item.cat) && !named(item)).map((item) => `${item.id} ${item.name}`);
    expect(stray).toEqual([]);
  });
});

describe('les sièges disent de quel côté ils regardent', () => {
  const seats = DECOR_ITEMS.filter((item) => item.cat === 'sieges');
  // Sans sens : un tabouret, un pouf, un banc se prennent de n'importe quel côté.
  const anySide = (name: string) => /^(Tabouret|Pouf|Banc)/.test(name);
  const facing = (name: string) => /\((.*, )?(de face|de dos|vers la gauche|vers la droite)\)/.exec(name)?.[2];
  const atlas = readImage(join(ASSETS_DIR, 'decor', 'sieges.png'));
  const pixels = (id: string) => {
    const item = DECOR_ITEMS.find((i) => i.id === id)!;
    return atlas.crop(item.fx, item.fy, item.w * 32, item.h * 32);
  };

  test('chaque chaise, fauteuil et canapé a son sens dans son nom : de face, de dos, vers la gauche ou vers la droite', () => {
    const silent = seats.filter((item) => !anySide(item.name) && !facing(item.name)).map((item) => `${item.id} ${item.name}`);
    expect(silent).toEqual([]);
  });

  test('un fauteuil de bureau a ses quatre vues, pour la couleur grise comme pour l\'orange ; une chaise de cuisine aussi', () => {
    const views = (pattern: RegExp) => new Set(seats.filter((item) => pattern.test(item.name)).map((item) => facing(item.name)));
    for (const pattern of [/^Fauteuil gris/, /^Fauteuil orange/]) expect([...views(pattern)].sort(), String(pattern)).toEqual(['de dos', 'de face']);
    const all = ['de dos', 'de face', 'vers la droite', 'vers la gauche'];
    expect([...views(/^Chaise de cuisine/)].sort()).toEqual(all);
    // Avec les chaises de profil (grises, orange, de bureau), un fauteuil de bureau regarde de tous les côtés.
    expect([...views(/^(Fauteuil (gris|orange)|Chaise (grise|orange|de bureau (grise|orange)))/)].sort()).toEqual(all);
  });

  test('un fauteuil de profil existe dans les deux sens : la version « vers la droite » est l\'image de la planche retournée', () => {
    const mirrored = seats.filter((item) => item.id.endsWith('-m'));
    expect(mirrored.length).toBeGreaterThanOrEqual(4);
    for (const item of mirrored) {
      expect(facing(item.name), item.id).toBe('vers la droite');
      const original = pixels(item.id.slice(0, -2));
      const flipped = pixels(item.id);
      for (let y = 0; y < original.height; y += 3) {
        for (let x = 0; x < original.width; x++) expect(flipped.get(x, y), `${item.id} ${x},${y}`).toEqual(original.get(original.width - 1 - x, y));
      }
    }
  });

  test('un fauteuil de bureau vu de face montre ses accoudoirs, vu de dos non : le nom dit vrai', () => {
    // Les accoudoirs sont les pixels clairs sur les flancs : seuls les fauteuils « de face » en ont, à hauteur de l'assise.
    const armrests = (id: string) => {
      const img = pixels(id);
      let count = 0;
      for (let y = 36; y < 56; y++) for (const x of [0, 1, 2, 3, 4, 27, 28, 29, 30, 31]) if (img.get(x, y).a === 255 && img.get(x, y).b > 150) count++;
      return count;
    };
    for (const id of ['of-2-8', 'of-3-8']) expect(armrests(id), id).toBeGreaterThan(0);
    for (const id of ['of-0-8', 'of-1-8']) expect(armrests(id), id).toBe(0);
  });
});

describe('les panneaux de sortie', () => {
  const signs = DECOR_ITEMS.filter((item) => /^Panneau de sortie/.test(item.name));

  test('quatre panneaux d\'un carreau, faits pour le mur : vert vif et citron, vers la droite et vers la gauche', () => {
    expect(signs.map((item) => item.name).sort()).toEqual([
      'Panneau de sortie citron (vers la droite)',
      'Panneau de sortie citron (vers la gauche)',
      'Panneau de sortie vert (vers la droite)',
      'Panneau de sortie vert (vers la gauche)',
    ]);
    for (const item of signs) expect([item.kind, item.w, item.h, item.cat, item.solid], item.name).toEqual(['wall', 1, 1, 'deco', false]);
  });
});

// Une planche d'un seul tenant, donnée en mémoire : de quoi faire tourner buildDecor sans le pack.
class OnePicture extends Sheets {
  constructor(private readonly picture: Img) {
    super('/aucun/dossier');
  }
  override image(): Img {
    return this.picture;
  }
}

describe('une copie retournée (flip) : buildDecor', () => {
  test('son identifiant prend « -m » et son image est celle de l\'original retournée de gauche à droite ; l\'original reste tel quel', () => {
    const picture = new Img(64, 32);
    picture.fillRect(0, 0, 32, 32, { r: 200, g: 0, b: 0, a: 255 });    // à gauche, du rouge
    picture.fillRect(32, 0, 32, 32, { r: 0, g: 0, b: 200, a: 255 });   // à droite, du bleu
    const base = { sheet: 'of', rect: [0, 0, 2, 1] as const, cat: 'sieges' as const };
    const built = buildDecor(new OnePicture(picture), [{ ...base, name: 'Original' }, { ...base, name: 'Retourné', flip: true }]);
    expect([...built.sprites.keys()].sort()).toEqual(['of-0-0', 'of-0-0-m']);
    const [original, mirrored] = [built.sprites.get('of-0-0')!, built.sprites.get('of-0-0-m')!];
    expect(original.get(0, 0)).toMatchObject({ r: 200, b: 0 });
    expect(original.get(63, 0)).toMatchObject({ r: 0, b: 200 });
    expect(mirrored.get(0, 0), 'le bleu est passé à gauche').toMatchObject({ r: 0, b: 200 });
    expect(mirrored.get(63, 0), 'le rouge est passé à droite').toMatchObject({ r: 200, b: 0 });
  });
});

describe('les meubles sont ramenés sur leur case', () => {
  const entry = (cat: ResolvedEntry['cat'], rect: ResolvedEntry['rect'], more: Partial<ResolvedEntry> = {}): ResolvedEntry => ({ sheet: 'of', name: 'x', cat, rect, ...more });
  // Une image de w × h cases dont seul le rectangle (x, y, largeur, hauteur) est dessiné.
  const drawn = (w: number, h: number, box: [number, number, number, number]): Img => {
    const image = new Img(w * 32, h * 32);
    image.fillRect(box[0], box[1], box[2], box[3], { r: 200, g: 100, b: 50, a: 255 });
    return image;
  };

  test('un meuble qui flotte au-dessus de sa case descend jusqu\'au bas de son empreinte', () => {
    // Une chaise de 1 × 2 cases dont le dessin s'arrête 20 px au-dessus du bas.
    const fit = fitOnFootprint(drawn(1, 2, [2, 2, 26, 42]), entry('sieges', [0, 0, 1, 2]), 'object');
    expect(fit.image.contentBox()).toEqual({ left: 2, top: 22, right: 28, bottom: 64 });
    expect([fit.w, fit.h]).toEqual([1, 2]);
  });

  test('un petit écart (une ombre) ne bouge pas le dessin, ni ce qui n\'est pas un meuble au sol', () => {
    expect(MIN_FLOAT_PX).toBe(4);
    const near = drawn(1, 2, [0, 0, 32, 62]);
    expect(fitOnFootprint(near, entry('sieges', [0, 0, 1, 2]), 'object').image.contentBox()).toEqual({ left: 0, top: 0, right: 32, bottom: 62 });
    const lamp = drawn(1, 2, [0, 0, 32, 40]);
    for (const kind of ['onTop', 'wall', 'floor'] as const) {
      expect(fitOnFootprint(lamp, entry('deco', [0, 0, 1, 2]), kind).image.contentBox()?.bottom, kind).toBe(40);
    }
  });

  test('une table n\'occupe que les colonnes qu\'elle couvre, le dessin recentré ; son rectangle de 5 cases passe à 4', () => {
    // 120 px de large (3,75 cases) dans 5 cases (160 px), 22 px de vide à gauche, 18 à droite.
    const fit = fitOnFootprint(drawn(5, 3, [22, 22, 120, 68]), entry('bureaux', [0, 1, 5, 3]), 'object');
    expect([fit.w, fit.h]).toEqual([4, 3]);
    const box = fit.image.contentBox()!;
    expect(fit.image.width).toBe(128);
    expect(box.left + (128 - box.right)).toBe(8);
    expect(Math.abs(box.left - (128 - box.right))).toBeLessThanOrEqual(1);
  });

  test('la profondeur au sol (claim) n\'est jamais changée : elle fixe où le dessin se pose, et une déco enregistrée y est accrochée', () => {
    const fit = fitOnFootprint(drawn(5, 3, [22, 22, 120, 68]), entry('bureaux', [0, 1, 5, 3], { claim: 2 }), 'object');
    expect(defaultsOf(entry('bureaux', [0, 1, 5, 3], { claim: 2 }), fit).claim).toBe(2);
    expect(defaultsOf(entry('bureaux', [0, 1, 5, 3]), fit).claim).toBe(3);
  });

  test('une table qui remplit sa largeur n\'est pas rétrécie ; un autre meuble garde sa largeur', () => {
    expect(fitOnFootprint(drawn(3, 2, [0, 0, 96, 64]), entry('bureaux', [0, 0, 3, 2]), 'object').w).toBe(3);
    expect(fitOnFootprint(drawn(4, 2, [30, 0, 70, 64]), entry('rangement', [0, 0, 4, 2]), 'object').w).toBe(4);
  });

  test('dans la banque : aucun meuble au sol ne flotte (le bas du dessin touche le bas de l\'image, à une ombre près)', () => {
    const atlases = new Map<string, Img>();
    const floating: string[] = [];
    for (const item of DECOR_ITEMS) {
      if (item.kind !== 'object') continue;
      if (!atlases.has(item.cat)) atlases.set(item.cat, readImage(join(ASSETS_DIR, 'decor', `${item.cat}.png`)));
      const box = atlases.get(item.cat)!.crop(item.fx, item.fy, item.w * 32, item.h * 32).contentBox();
      if (box && item.h * 32 - box.bottom >= MIN_FLOAT_PX) floating.push(`${item.id} (${item.name}) : ${item.h * 32 - box.bottom} px`);
    }
    expect(floating).toEqual([]);
  });

  test('la table de conférence : 4 cases de large, 2 au sol, le dessin au milieu', () => {
    const table = DECOR_ITEMS.find((item) => item.id === 'cf-0-1')!;
    expect([table.w, table.h, table.claim]).toEqual([4, 3, 2]);
    const box = readImage(join(ASSETS_DIR, 'decor', 'bureaux.png')).crop(table.fx, table.fy, table.w * 32, table.h * 32).contentBox()!;
    expect(Math.abs(box.left - (table.w * 32 - box.right))).toBeLessThanOrEqual(8);
  });
});

describe('le prix d\'un élément (checkPrice, buildDecor, renderCatalogSource)', () => {
  const entry = (cat: ResolvedEntry['cat'], more: Partial<ResolvedEntry> = {}): ResolvedEntry => ({ sheet: 'of', name: 'x', cat, rect: [0, 0, 1, 1], ...more });

  test('un élément de la boutique a un prix entier d\'au moins 1, et lui seul', () => {
    expect(() => checkPrice(entry('boutique', { price: 150 }), 'of-0-0')).not.toThrow();
    for (const price of [undefined, 0, -5, 12.5, Number.NaN]) {
      expect(() => checkPrice(entry('boutique', { price }), 'of-0-0'), String(price)).toThrow(/a un prix/);
    }
    expect(() => checkPrice(entry('sieges'), 'of-0-0')).not.toThrow();
    expect(() => checkPrice(entry('sieges', { price: 100 }), 'of-0-0')).toThrow(/seuls les éléments de la boutique/);
  });

  test('buildDecor recopie le prix des éléments qui en ont un et laisse les autres comme avant, sans même une clé « price »', () => {
    const picture = new Img(64, 32);
    picture.fillRect(0, 0, 64, 32, { r: 200, g: 0, b: 0, a: 255 });
    const base = { sheet: 'of', cat: 'sieges' as const };
    const built = buildDecor(new OnePicture(picture), [
      { ...base, name: 'Libre', rect: [0, 0, 1, 1] },
      { ...base, cat: 'boutique', name: 'Payant', rect: [1, 0, 1, 1], price: 150 },
    ]);
    const [libre, payant] = built.items;
    expect('price' in libre!).toBe(false);
    expect(payant!.price).toBe(150);
    expect(() => buildDecor(new OnePicture(picture), [{ ...base, cat: 'boutique', name: 'Sans prix', rect: [0, 0, 1, 1] }])).toThrow(/a un prix/);
  });

  test('la liste générée écrit le prix en fin de ligne, pour les éléments payants seulement', () => {
    const libre: DecorItem = { id: 'of-0-0', cat: 'sieges', name: 'A', kind: 'object', w: 1, h: 1, claim: 1, solid: false, fx: 2, fy: 2 };
    const source = renderCatalogSource([libre, { ...libre, id: 'mu-0-0', cat: 'boutique', name: 'B', price: 1500 }]);
    expect(source).toContain('fx: 2, fy: 2 },');
    expect(source).toContain('fx: 2, fy: 2, price: 1500 },');
  });
});

describe('la collection à part (catégorie « boutique »)', () => {
  const shop = DECOR_ITEMS.filter((item) => item.cat === 'boutique');
  const free = DECOR_ITEMS.filter((item) => item.cat !== 'boutique');

  test('45 à 60 éléments, tous après les éléments libres : les identifiants et l\'ordre des anciens ne bougent pas', () => {
    expect(shop.length).toBeGreaterThanOrEqual(45);
    expect(shop.length).toBeLessThanOrEqual(60);
    expect(DECOR_ITEMS.slice(free.length).map((item) => item.cat)).toEqual(shop.map(() => 'boutique'));
  });

  test('chaque élément de la collection a un prix entier d\'au moins 1, aucun autre n\'en a', () => {
    for (const item of shop) expect(Number.isInteger(item.price) && item.price! >= 1, item.name).toBe(true);
    for (const item of free) expect('price' in item, item.name).toBe(false);
  });

  test('les prix suivent quatre raretés, du Commun au Légendaire dans l\'ordre du catalogue, dans la proportion de la grille (40, 30, 20 et 10 %)', () => {
    expect(RARITIES.map((rarity) => [rarity.min, rarity.max])).toEqual([[100, 250], [300, 900], [1200, 3500], [5000, 15000]]);
    const ranks = shop.map((item) => {
      const rarity = rarityOf(item.price!);
      expect(rarity, `${item.name} : ${item.price} kuartzons tombe entre deux raretés`).toBeDefined();
      return RARITIES.indexOf(rarity!);
    });
    expect(ranks, 'rangés du plus commun au plus rare').toEqual([...ranks].sort((a, b) => a - b));
    [0.4, 0.3, 0.2, 0.1].forEach((target, rank) => {
      const share = ranks.filter((r) => r === rank).length / shop.length;
      expect(Math.abs(share - target), `${RARITIES[rank]!.label} : ${Math.round(share * 100)} %`).toBeLessThanOrEqual(0.08);
    });
  });

  test('un mélange de sortes : des meubles, des éléments muraux, des tapis et des objets à poser sur un meuble', () => {
    for (const kind of ['object', 'wall', 'floor', 'onTop'] as const) expect(shop.filter((item) => item.kind === kind).length, kind).toBeGreaterThanOrEqual(5);
  });

  test('tout tient dans une pièce de bureau : 6 cases de large au plus (la compacte), 3 rangées au sol au plus pour un meuble, 2 cases de haut au mur', () => {
    for (const item of shop) {
      expect(item.w, item.name).toBeLessThanOrEqual(6);
      if (item.kind === 'object') expect(item.claim, item.name).toBeLessThanOrEqual(3);
      if (item.kind === 'wall') expect(item.h, item.name).toBeLessThanOrEqual(2);
    }
  });

  test('les sièges, les plantes et les pieds fins ne bloquent jamais ; ce qui bloque est un gros meuble', () => {
    const traversable = /^(Tabouret|Pouf|Banc|Chaise|Fauteuil|Canapé|Plante|Palmier|Bonsaï|Cordon|Psyché|Projecteurs|Caméra)/;
    for (const item of shop.filter((i) => traversable.test(i.name))) expect(item.solid, item.name).toBe(false);
    for (const item of shop.filter((i) => i.solid)) {
      expect(item.kind, item.name).toBe('object');
      expect(item.w * item.claim >= BIG_FOOTPRINT_CELLS || item.w * item.h >= BIG_ITEM_TILES, item.name).toBe(true);
    }
  });

  test('aucun élément n\'est la copie d\'un élément libre ni d\'un autre de la collection : image identique, ou retournée', () => {
    const atlases = new Map<string, Img>();
    // Ce que l'élément dessine, rogné de son vide : deux copies posées différemment dans leur rectangle se reconnaissent quand même.
    const drawn = (item: DecorItem): Img => {
      if (!atlases.has(item.cat)) atlases.set(item.cat, readImage(join(ASSETS_DIR, 'decor', `${item.cat}.png`)));
      const sprite = atlases.get(item.cat)!.crop(item.fx, item.fy, item.w * 32, item.h * 32);
      const box = sprite.contentBox()!;
      return sprite.crop(box.left, box.top, box.right - box.left, box.bottom - box.top);
    };
    const digest = (image: Img): string => createHash('sha1').update(`${image.width}x${image.height}`).update(image.data).digest('hex');
    const taken = new Map<string, string>(free.map((item) => [digest(drawn(item)), item.name]));
    const copies: string[] = [];
    for (const item of shop) {
      const image = drawn(item);
      for (const key of [digest(image), digest(image.mirrorX())]) {
        if (taken.has(key)) copies.push(`« ${item.name} » (${item.id}) copie « ${taken.get(key)} »`);
      }
      taken.set(digest(image), item.name);
    }
    expect(copies).toEqual([]);
  });

  test('aucun nom n\'est celui d\'un élément libre', () => {
    const names = new Set(free.map((item) => item.name));
    expect(shop.filter((item) => names.has(item.name)).map((item) => item.name)).toEqual([]);
  });

  test('la liste générée suit la curation : mêmes éléments, même ordre, mêmes prix (sinon relancer gen:assets)', () => {
    expect(shop.map((item) => [item.name, item.price])).toEqual(BOUTIQUE_ENTRIES.map((e) => [e.name, e.price]));
    expect(ENTRIES.slice(-BOUTIQUE_ENTRIES.length)).toEqual(BOUTIQUE_ENTRIES);
  });
});
