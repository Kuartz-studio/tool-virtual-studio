import type { MusicScene } from '../audio/scenes';
import { TILE_SIZE } from '../constants';
import { decorItem } from '../decor/catalog';
import { footprintOf } from '../decor/placement';
import { FLOOR_THEMES, POOL_TILES, TILESET, WALL_THEMES } from '../decor/generated-themes';
import { propByKey } from '../props/catalog';
import { zoneObject, type ZoneInput } from './build-tiled';
import type { GameId } from './parse-map';
import type { TiledMapJson, TiledObject, TiledObjectLayer, TiledTileLayer } from './tiled-types';

// Le dessin d'une carte, case par case : des primitives (sol, mur, ouverture, meuble, objet animé, piscine, lieux, tables) qui remplissent les
// calques de tuiles, les collisions et les calques d'objets d'un JSON Tiled. Les murs suivent la convention du pack : un mur horizontal fait
// deux cases de haut (le haut avec son liseré, puis le bas avec sa plinthe), un mur vertical une case de large (un pan).

export interface DecorObject {
  id: string;
  x: number;   // les cases du coin haut-gauche de l'empreinte du meuble
  y: number;
  // De combien de pixels on abaisse son image, sans toucher à son empreinte ni à sa profondeur (une chaise rentrée sous sa table).
  offsetY?: number;
}

// Un objet animé posé : sa clé (props/catalog.ts) et la case du coin haut-gauche de son empreinte ; `depth`, quand il est posé sur un meuble : la
// profondeur d'affichage qui le met devant celui-ci, et `offsetY` de combien de pixels on abaisse son image (pour qu'il pose sur le plateau du meuble).
export interface PropObject {
  key: string;
  x: number;
  y: number;
  depth?: number;
  offsetY?: number;
}

// Un rectangle de la carte, en cases.
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlaceOptions {
  kind?: 'room' | 'open' | 'street';
  scene?: MusicScene;
  music?: boolean;
  destination?: boolean;
}

const floorGid = (id: string): number => {
  const theme = FLOOR_THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`Sol inconnu : « ${id} ».`);
  return theme.gid;
};

const wallTiles = (id: string) => {
  const theme = WALL_THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`Mur inconnu : « ${id} ».`);
  return theme;
};

export class MapCanvas {
  readonly floors: number[];
  readonly walls: number[];
  readonly blocked: Uint8Array;
  readonly solidDecor: Uint8Array;
  readonly decor: DecorObject[] = [];
  readonly props: PropObject[] = [];
  readonly zones: ZoneInput[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    defaultFloor: string,
  ) {
    this.floors = new Array<number>(width * height).fill(floorGid(defaultFloor));
    this.walls = new Array<number>(width * height).fill(0);
    this.blocked = new Uint8Array(width * height);
    this.solidDecor = new Uint8Array(width * height);
  }

  private index(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) throw new Error(`Case hors de la carte : ${x}, ${y}.`);
    return y * this.width + x;
  }

  floor(x: number, y: number, w: number, h: number, id: string): void {
    const gid = floorGid(id);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.floors[this.index(xx, yy)] = gid;
  }

  // Un mur horizontal de x0 à x1 compris : deux rangées, y et y + 1.
  hWall(x0: number, x1: number, y: number, theme: string): void {
    const tiles = wallTiles(theme);
    for (let x = x0; x <= x1; x++) {
      this.walls[this.index(x, y)] = tiles.top;
      this.walls[this.index(x, y + 1)] = tiles.bottom;
      this.blocked[this.index(x, y)] = 1;
      this.blocked[this.index(x, y + 1)] = 1;
    }
  }

  // Un mur vertical de y0 à y1 compris : une colonne.
  vWall(x: number, y0: number, y1: number, theme: string): void {
    const tiles = wallTiles(theme);
    for (let y = y0; y <= y1; y++) {
      this.walls[this.index(x, y)] = tiles.stem;
      this.blocked[this.index(x, y)] = 1;
    }
  }

  // Une ouverture dans un mur (une porte, une arche) : plus de mur, plus d'obstacle.
  open(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        this.walls[this.index(xx, yy)] = 0;
        this.blocked[this.index(xx, yy)] = 0;
      }
    }
  }

  // Un obstacle sans image (le bord d'un bassin).
  block(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.blocked[this.index(xx, yy)] = 1;
  }

  // Un meuble de la banque, posé là : ses cases bloquent s'il est solide. Un meuble posé sur un mur ou sur un autre meuble solide est une
  // erreur de dessin : elle se voit tout de suite, à la construction.
  // `offsetY` : de combien de pixels on abaisse l'image, pour qu'elle passe sous le bord de la table qui la cache à moitié.
  put(id: string, x: number, y: number, options: { offsetY?: number } = {}): void {
    const item = decorItem(id);
    if (!item) throw new Error(`Élément inconnu : « ${id} ».`);
    const f = footprintOf(item, { x, y });
    if (item.kind !== 'wall' && item.solid) {
      for (let yy = f.y; yy < f.y + f.h; yy++) {
        for (let xx = f.x; xx < f.x + f.w; xx++) {
          const i = this.index(xx, yy);
          if (this.blocked[i]) throw new Error(`« ${item.name} » en ${x}, ${y} est posé sur un obstacle (case ${xx}, ${yy}).`);
          this.blocked[i] = 1;
          this.solidDecor[i] = 1;
        }
      }
    } else if (item.kind !== 'wall') {
      for (let xx = f.x; xx < f.x + f.w; xx++) this.index(xx, f.y);   // au moins dans la carte
    }
    this.decor.push({ id, x, y, ...(options.offsetY ? { offsetY: options.offsetY } : {}) });
  }

  // Un objet animé (props/catalog.ts), posé par la case du coin haut-gauche de son empreinte : les `claim` rangées du bas de son image, dont le haut
  // dépasse au-dessus. Ses cases bloquent s'il est solide ; posé sur un mur ou sur un meuble solide, ou hors de la carte, c'est une erreur de dessin.
  // `onTop` : l'objet est posé sur un meuble solide (la machine à café sur son comptoir) : il ne bloque rien de plus, et se dessine devant ce meuble ;
  // `offsetY` : de combien de pixels on abaisse son image (le plateau d'un comptoir est plus bas que le bord haut de sa case).
  prop(key: string, x: number, y: number, options: { onTop?: boolean; offsetY?: number } = {}): void {
    const prop = propByKey(key);
    if (!prop) throw new Error(`Objet animé inconnu : « ${key} ».`);
    for (let xx = x; xx < x + prop.w; xx++) this.index(xx, y);   // au moins dans la carte
    if (options.onTop) {
      const bottom = this.supportBottom(x, y);
      if (bottom === null) throw new Error(`« ${key} » en ${x}, ${y} n'est posé sur aucun meuble solide.`);
      this.props.push({ key, x, y, depth: bottom * TILE_SIZE + 0.5, ...(options.offsetY ? { offsetY: options.offsetY } : {}) });
      return;
    }
    if (prop.solid) {
      for (let yy = y; yy < y + prop.claim; yy++) {
        for (let xx = x; xx < x + prop.w; xx++) {
          const i = this.index(xx, yy);
          if (this.blocked[i]) throw new Error(`« ${key} » en ${x}, ${y} est posé sur un obstacle (case ${xx}, ${yy}).`);
          this.blocked[i] = 1;
          this.solidDecor[i] = 1;
        }
      }
    }
    this.props.push({ key, x, y });
  }

  // La rangée sous laquelle finit le meuble solide qui occupe cette case (le plus bas, s'il y en a plusieurs), ou null.
  private supportBottom(x: number, y: number): number | null {
    let bottom: number | null = null;
    for (const placed of this.decor) {
      const item = decorItem(placed.id)!;
      if (item.kind !== 'object' || !item.solid) continue;
      const f = footprintOf(item, placed);
      if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) bottom = Math.max(bottom ?? 0, f.y + f.h);
    }
    return bottom;
  }

  // Un lieu (zone `place`) : sa clé, son nom affiché, son rectangle et ses réglages (genre `room` par défaut, ambiance `lobby`, sans musique ni
  // destination). La lecture de la carte (parse-map) refuse deux lieux de même clé.
  place(key: string, label: string, area: Area, options: PlaceOptions = {}): void {
    const props: Record<string, string | number | boolean> = { label };
    if (options.kind !== undefined) props.kind = options.kind;
    if (options.scene !== undefined) props.scene = options.scene;
    if (options.music) props.music = true;
    if (options.destination) props.destination = true;
    this.zones.push({ type: 'place', name: key, ...area, props });
  }

  // La case, devant la machine à café, où l'on se tient pour en prendre un.
  coffee(x: number, y: number): void {
    this.zones.push({ type: 'coffee', x, y, w: 1, h: 1 });
  }

  // L'enceinte d'un lieu qui a de la musique : la case où elle se tient.
  speaker(placeKey: string, x: number, y: number): void {
    this.zones.push({ type: 'speaker', name: placeKey, x, y, w: 1, h: 1 });
  }

  // Une administratrice de l'accueil, à qui l'on parle : la case où elle se tient (derrière le comptoir), et sa clé.
  clerk(name: string, x: number, y: number): void {
    this.zones.push({ type: 'clerk', name, x, y, w: 1, h: 1 });
  }

  // La table d'un jeu (une seule par jeu) et ses sièges, numérotés à partir de 1 : une case chacun.
  table(game: GameId, area: Area): void {
    this.zones.push({ type: 'game', name: game, ...area });
  }

  seat(game: GameId, n: number, x: number, y: number): void {
    this.zones.push({ type: 'seat', name: `${game}:${n}`, x, y, w: 1, h: 1 });
  }

  // Un panneau, que le client trace dans son rectangle.
  sign(text: string, x: number, y: number, w = 1, h = 1): void {
    this.zones.push({ type: 'sign', text, x, y, w, h });
  }

  // Le ring de l'octogone, que le client trace dans son rectangle (une cage à huit pans).
  arena(area: Area): void {
    this.zones.push({ type: 'arena', ...area });
  }

  // Un bassin : de l'eau avec sa margelle, les cases du bord sont des obstacles (on ne marche pas dans l'eau).
  pool(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const n = yy === y;
        const s = yy === y + h - 1;
        const west = xx === x;
        const east = xx === x + w - 1;
        const name = n && west ? 'nw' : n && east ? 'ne' : s && west ? 'sw' : s && east ? 'se' : n ? 'n' : s ? 's' : west ? 'w' : east ? 'e' : 'fill';
        this.floors[this.index(xx, yy)] = POOL_TILES[name];
      }
    }
    this.block(x, y, w, h);
  }

  zone(zone: ZoneInput): void {
    this.zones.push(zone);
  }

  // Le plan en caractères : `#` un mur ou un obstacle sans meuble, `T` un meuble solide, `.` libre.
  ascii(): string[] {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let row = '';
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x;
        row += this.solidDecor[i] ? 'T' : this.blocked[i] ? '#' : '.';
      }
      rows.push(row);
    }
    return rows;
  }

  toTiled(): TiledMapJson {
    const { width, height } = this;
    const tileLayer = (id: number, name: string, data: number[], visible = true): TiledTileLayer => ({
      data,
      height,
      id,
      name,
      opacity: 1,
      type: 'tilelayer',
      visible,
      width,
      x: 0,
      y: 0,
    });
    const objectLayer = (id: number, name: string, objects: TiledObject[]): TiledObjectLayer => ({
      draworder: 'topdown',
      id,
      name,
      objects,
      opacity: 1,
      type: 'objectgroup',
      visible: true,
      x: 0,
      y: 0,
    });
    // Les objets du décor : le nom est la clé de l'élément, la position le coin haut-gauche de son empreinte (en pixels).
    const objects: TiledObject[] = this.decor.map((placed, index) => {
      const item = decorItem(placed.id)!;
      const f = footprintOf(item, placed);
      return {
        height: f.h * TILE_SIZE,
        id: index + 1,
        name: placed.id,
        ...(placed.offsetY ? { properties: [{ name: 'offsetY', type: 'int', value: placed.offsetY }] } : {}),
        rotation: 0,
        type: 'decor',
        visible: true,
        width: f.w * TILE_SIZE,
        x: f.x * TILE_SIZE,
        y: f.y * TILE_SIZE,
      };
    });
    // Les objets animés : le nom est la clé du prop, la position et la taille celles de son empreinte (en pixels). Le client les anime.
    const propObjects: TiledObject[] = this.props.map((placed, index) => {
      const prop = propByKey(placed.key)!;
      return {
        height: prop.claim * TILE_SIZE,
        id: index + 1,
        name: placed.key,
        ...(placed.depth === undefined
          ? {}
          : {
              properties: [
                { name: 'depth', type: 'float', value: placed.depth },
                ...(placed.offsetY ? [{ name: 'offsetY', type: 'int', value: placed.offsetY }] : []),
              ],
            }),
        rotation: 0,
        type: 'prop',
        visible: true,
        width: prop.w * TILE_SIZE,
        x: placed.x * TILE_SIZE,
        y: placed.y * TILE_SIZE,
      };
    });
    const empty = new Array<number>(width * height).fill(0);
    const collisions = Array.from(this.blocked, (b) => (b ? 1 : 0));
    const layers = [
      tileLayer(1, 'sol', this.floors),
      tileLayer(2, 'murs', this.walls),
      tileLayer(3, 'meubles-bas', empty),
      objectLayer(4, 'objets', objects),
      objectLayer(5, 'props', propObjects),
      tileLayer(6, 'dessus', empty),
      tileLayer(7, 'collisions', collisions, false),
      objectLayer(8, 'zones', this.zones.map(zoneObject)),
    ];
    return {
      compressionlevel: -1,
      height,
      infinite: false,
      layers,
      nextlayerid: layers.length + 1,
      nextobjectid: Math.max(objects.length, propObjects.length, this.zones.length) + 1,
      orientation: 'orthogonal',
      renderorder: 'right-down',
      tiledversion: '1.12.2',
      tileheight: TILE_SIZE,
      tilesets: [
        {
          columns: TILESET.columns,
          firstgid: 1,
          image: TILESET.image,
          imageheight: Math.ceil(TILESET.tileCount / TILESET.columns) * TILE_SIZE,
          imagewidth: TILESET.columns * TILE_SIZE,
          margin: 0,
          name: TILESET.name,
          spacing: 0,
          tilecount: TILESET.tileCount,
          tileheight: TILE_SIZE,
          tilewidth: TILE_SIZE,
        },
      ],
      tilewidth: TILE_SIZE,
      type: 'map',
      version: '1.10',
      width,
    };
  }
}

