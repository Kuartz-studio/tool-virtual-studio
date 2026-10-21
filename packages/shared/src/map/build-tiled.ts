import { TILE_SIZE } from '../constants';
import { FLOOR_THEMES, TILESET, WALL_THEMES } from '../decor/generated-themes';
import type { ZoneType } from './parse-map';
import type { TiledMapJson, TiledObject, TiledObjectLayer, TiledTileLayer } from './tiled-types';

// Une zone en cases (et non en pixels) : buildTiledMap en fait un objet Tiled.
export interface ZoneInput {
  type: ZoneType;
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
  text?: string;   // le texte d'une étiquette (zone label)
}

export interface TiledMapInput {
  ascii: string[];
  zones: ZoneInput[];
  tileset: { name: string; image: string };
}

// Les tuiles de la petite carte de développement et des tests : des sols et un mur du jeu de tuiles de la vraie carte. Les numéros sont ceux
// de Tiled : le premier GID du tileset vaut 1, 0 est une case vide.
const floorOf = (id: string): number => FLOOR_THEMES.find((theme) => theme.id === id)!.gid;
const wallOf = (id: string) => WALL_THEMES.find((theme) => theme.id === id)!;
export const DEV_TILE = {
  floor: floorOf('beton'),
  roomFloor: floorOf('lilas'),
  deskFloor: floorOf('sauge'),
  wall: wallOf('gris-perle').stem,
  desk: wallOf('bois-sombre').bottom,
} as const;

// La légende d'un plan ASCII : `#` mur (bloquant), `.` sol, `T` bureau (bloquant).
const LEGEND = ['#', '.', 'T'];

// Fabrique un JSON Tiled (orthogonal, cases de 32 px, tileset intégré, calques en CSV) depuis un plan ASCII et des zones : la
// carte de développement et les cartes des tests. Les clés sont dans l'ordre alphabétique, comme dans un export de Tiled.
//
// Calques, dans l'ordre de la spec : sol (partout : DEV_TILE.floor, ou roomFloor dans une zone private et deskFloor dans une zone desk), murs, meubles-bas
// (les bureaux), objets (calque d'objets, vide), dessus (vide), collisions (invisible : les murs et les bureaux), zones.
export function buildTiledMap(i: TiledMapInput): TiledMapJson {
  const rows = i.ascii;
  const width = checkAscii(rows);
  const height = rows.length;

  const sol: number[] = [];
  const murs: number[] = [];
  const meublesBas: number[] = [];
  const dessus: number[] = [];
  const collisions: number[] = [];
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const ch = rows[ty]![tx];
      sol.push(floorTile(i.zones, tx, ty));
      murs.push(ch === '#' ? DEV_TILE.wall : 0);
      meublesBas.push(ch === 'T' ? DEV_TILE.desk : 0);
      dessus.push(0);
      collisions.push(ch === '#' ? DEV_TILE.wall : ch === 'T' ? DEV_TILE.desk : 0);
    }
  }

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

  const layers = [
    tileLayer(1, 'sol', sol),
    tileLayer(2, 'murs', murs),
    tileLayer(3, 'meubles-bas', meublesBas),
    objectLayer(4, 'objets', []),
    tileLayer(5, 'dessus', dessus),
    tileLayer(6, 'collisions', collisions, false),
    objectLayer(7, 'zones', i.zones.map(zoneObject)),
  ];

  return {
    compressionlevel: -1,
    height,
    infinite: false,
    layers,
    nextlayerid: layers.length + 1,
    nextobjectid: i.zones.length + 1,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.12.2',
    tileheight: TILE_SIZE,
    tilesets: [
      {
        columns: TILESET.columns,
        firstgid: 1,
        image: i.tileset.image,
        imageheight: Math.ceil(TILESET.tileCount / TILESET.columns) * TILE_SIZE,
        imagewidth: TILESET.columns * TILE_SIZE,
        margin: 0,
        name: i.tileset.name,
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

// Vérifie le plan et renvoie sa largeur. Un plan mal formé est une erreur de programmation, pas une carte à refuser : Error.
function checkAscii(rows: string[]): number {
  if (rows.length === 0) throw new Error('Plan ASCII vide.');
  const width = rows[0]!.length;
  if (width === 0) throw new Error('Plan ASCII : la ligne 1 est vide.');
  rows.forEach((row, ry) => {
    if (row.length !== width) throw new Error(`Plan ASCII : la ligne ${ry + 1} fait ${row.length} caractères, la première en fait ${width}.`);
    for (let rx = 0; rx < width; rx++) {
      if (!LEGEND.includes(row[rx]!)) {
        throw new Error(`Plan ASCII : le caractère « ${row[rx]} » est inconnu (ligne ${ry + 1}, colonne ${rx + 1}). Légende : ${LEGEND.join(' ')}`);
      }
    }
  });
  return width;
}

// Le sol de la case : celui de la dernière zone private ou desk qui la contient (une case sous un mur ou un bureau a aussi un sol).
function floorTile(zones: ZoneInput[], tx: number, ty: number): number {
  let gid: number = DEV_TILE.floor;
  for (const z of zones) {
    if (tx < z.x || tx >= z.x + z.w || ty < z.y || ty >= z.y + z.h) continue;
    if (z.type === 'private') gid = DEV_TILE.roomFloor;
    else if (z.type === 'desk') gid = DEV_TILE.deskFloor;
  }
  return gid;
}

// Un rectangle en pixels. Le type est dans `type`, le champ que Phaser lit ; le texte d'une étiquette, dans la propriété `text`.
// Les identifiants suivent l'ordre de saisie, à partir de 1 : ils ne changent pas tant que les zones ne changent pas.
function zoneObject(z: ZoneInput, index: number): TiledObject {
  return {
    height: z.h * TILE_SIZE,
    id: index + 1,
    name: z.name ?? '',
    ...(z.text === undefined ? {} : { properties: [{ name: 'text', type: 'string', value: z.text }] }),
    rotation: 0,
    type: z.type,
    visible: true,
    width: z.w * TILE_SIZE,
    x: z.x * TILE_SIZE,
    y: z.y * TILE_SIZE,
  };
}
