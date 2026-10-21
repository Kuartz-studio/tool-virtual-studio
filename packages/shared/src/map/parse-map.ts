import { isWalkablePoint } from './queries';
import type { TiledLayer, TiledMapJson, TiledObject, TiledObjectLayer, TiledTileLayer } from './tiled-types';

export const ZONE_TYPES = ['spawn', 'private', 'desk', 'door', 'label', 'switch'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

// Un rectangle du calque `zones`, en pixels.
export interface Zone {
  id: string;
  type: ZoneType;
  name: string | null;
  text: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

// La clé d'une place de bureau : le nom de sa zone `desk`, ou à défaut son numéro. C'est ce qui désigne la place dans la base de données
// et dans les messages ; une zone `door` porte la clé de la place qu'elle ferme.
export function deskKey(zone: Pick<Zone, 'name' | 'id'>): string {
  return zone.name ?? zone.id;
}

// Ce que le serveur et le client savent de la carte : la taille, les cases bloquantes, les zones, le point d'apparition et les
// interrupteurs de lumière.
export interface OfficeMap {
  widthTiles: number;
  heightTiles: number;
  tileSize: number;
  blocked: Uint8Array;   // une case par octet, ligne après ligne : 1 = bloquée
  zones: Zone[];
  spawn: { x: number; y: number };   // en pixels
  // Le centre de chaque zone `switch` (une case, posée sur un mur : la plaque), en pixels, dans l'ordre de la carte.
  switches: Array<{ x: number; y: number }>;
}

// Pourquoi une carte est refusée :
// - missing_layer : le calque `collisions` ou `zones` est absent (ou n'est pas du bon type) ;
// - external_tileset : un tileset n'est pas intégré à la carte ;
// - compressed_layer : un calque de tuiles n'est pas du CSV lisible (compressé, en base64, en morceaux dans une carte infinie,
//   de la mauvaise taille…) ;
// - missing_spawn : aucune zone `spawn` ;
// - bad_zone : une zone inutilisable (type inconnu, pas un rectangle droit, taille nulle), deux apparitions, une apparition
//   sur une case bloquante, deux bureaux de même nom, ou une porte (zone `door`) qui ne ferme aucun bureau.
export type MapErrorCode = 'missing_layer' | 'external_tileset' | 'compressed_layer' | 'missing_spawn' | 'bad_zone';

// Le message est en français et dit quoi corriger dans Tiled : la commande map:check l'affiche tel quel.
export class MapError extends Error {
  readonly code: MapErrorCode;

  constructor(code: MapErrorCode, message: string) {
    super(message);
    this.name = 'MapError';
    this.code = code;
  }
}

// Un numéro de tuile de Tiled porte dans ses trois bits de poids fort le retournement de la tuile (horizontal, vertical,
// diagonal). Phaser les ignore pour savoir si une case est vide : le serveur fait pareil, pour bloquer les mêmes cases.
const TILE_ID_MASK = 0x1fffffff;
const MAX_GID = 0xffffffff;

// Lit la carte exportée de Tiled (JSON, tilesets intégrés, calques en CSV) : les cases bloquantes viennent du calque
// `collisions` (n'importe quelle tuile bloque), les zones du calque `zones`, l'apparition est le centre de la zone `spawn`, et chaque
// interrupteur de lumière le centre d'une zone `switch`.
export function parseOfficeMap(json: TiledMapJson): OfficeMap {
  const layers: TiledLayer[] = Array.isArray(json.layers) ? json.layers : [];

  assertEmbeddedTilesets(json);
  assertCsvTileLayers(json, layers);

  const collisions = requireTileLayer(layers, 'collisions');
  const zonesLayer = requireObjectLayer(layers, 'zones');
  const blocked = readBlocked(collisions, json.width, json.height);
  const zones = (Array.isArray(zonesLayer.objects) ? zonesLayer.objects : []).map(readZone);

  const spawnZone = pickSpawnZone(zones);
  checkDesks(zones);
  const map: OfficeMap = {
    widthTiles: json.width,
    heightTiles: json.height,
    tileSize: json.tilewidth,
    blocked,
    zones,
    spawn: { x: spawnZone.x + spawnZone.width / 2, y: spawnZone.y + spawnZone.height / 2 },
    switches: zones.filter((zone) => zone.type === 'switch').map((zone) => ({ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 })),
  };
  if (!isWalkablePoint(map, map.spawn.x, map.spawn.y)) {
    throw new MapError(
      'bad_zone',
      `Le point d'apparition (centre de la zone spawn n° ${spawnZone.id} : x = ${map.spawn.x}, y = ${map.spawn.y}) est sur une case bloquante ou hors de la carte. Déplacer la zone spawn sur une case libre.`,
    );
  }
  return map;
}

function assertEmbeddedTilesets(json: TiledMapJson): void {
  for (const tileset of Array.isArray(json.tilesets) ? json.tilesets : []) {
    if ('source' in tileset) {
      throw new MapError(
        'external_tileset',
        `Le tileset « ${tileset.source} » n'est pas intégré à la carte : Phaser ne charge pas les tilesets externes. Dans Tiled, l'intégrer (Embed Tileset), puis exporter de nouveau.`,
      );
    }
  }
}

const TILE_LAYER_FORMAT_HINT = 'Dans Tiled, mettre « Tile Layer Format » sur CSV dans les propriétés de la carte, puis exporter de nouveau.';

// Phaser ignore un calque compressé (il le signale seulement dans la console) : la carte s'afficherait à moitié vide. Tous les
// calques de tuiles doivent donc être du CSV, pas seulement `collisions` que lit le serveur.
function assertCsvTileLayers(json: TiledMapJson, layers: TiledLayer[]): void {
  if (json.infinite === true) {
    throw new MapError(
      'compressed_layer',
      'La carte est infinie : ses calques sont découpés en morceaux que le jeu ne lit pas. Dans Tiled, décocher « Infinie » dans les propriétés de la carte, puis exporter de nouveau.',
    );
  }
  for (const layer of layers) {
    if (layer.type !== 'tilelayer') continue;
    if (layer.compression) {
      throw new MapError('compressed_layer', `Le calque « ${layer.name} » est compressé (${layer.compression}) : Phaser l'ignore. ${TILE_LAYER_FORMAT_HINT}`);
    }
    if (layer.encoding === 'base64') {
      throw new MapError('compressed_layer', `Le calque « ${layer.name} » est encodé en base64 : le jeu attend du CSV. ${TILE_LAYER_FORMAT_HINT}`);
    }
    if (!Array.isArray(layer.data)) {
      throw new MapError('compressed_layer', `Le calque « ${layer.name} » n'a pas de données CSV. ${TILE_LAYER_FORMAT_HINT}`);
    }
  }
}

function requireTileLayer(layers: TiledLayer[], name: string): TiledTileLayer {
  const layer = layers.find((l) => l.name === name);
  if (!layer) throw new MapError('missing_layer', `Le calque « ${name} » est absent de la carte : il faut un calque de tuiles de ce nom.`);
  if (layer.type !== 'tilelayer') {
    throw new MapError('missing_layer', `Le calque « ${name} » n'est pas un calque de tuiles (c'est un calque « ${layer.type} »).`);
  }
  return layer;
}

function requireObjectLayer(layers: TiledLayer[], name: string): TiledObjectLayer {
  const layer = layers.find((l) => l.name === name);
  if (!layer) throw new MapError('missing_layer', `Le calque « ${name} » est absent de la carte : il faut un calque d'objets de ce nom.`);
  if (layer.type !== 'objectgroup') {
    throw new MapError('missing_layer', `Le calque « ${name} » n'est pas un calque d'objets (c'est un calque « ${layer.type} »).`);
  }
  return layer;
}

function readBlocked(collisions: TiledTileLayer, width: number, height: number): Uint8Array {
  const data = collisions.data as number[];   // assertCsvTileLayers a vérifié que c'est un tableau
  if (data.length !== width * height) {
    throw new MapError('compressed_layer', `Le calque « ${collisions.name} » contient ${data.length} cases, la carte en attend ${width * height} (${width} × ${height}).`);
  }
  const blocked = new Uint8Array(data.length);
  data.forEach((gid, index) => {
    if (!Number.isInteger(gid) || gid < 0 || gid > MAX_GID) {
      throw new MapError(
        'compressed_layer',
        `Le calque « ${collisions.name} » contient la valeur ${String(gid)} à la case ${index % width}, ${Math.floor(index / width)} : ce n'est pas un numéro de tuile.`,
      );
    }
    if ((gid & TILE_ID_MASK) !== 0) blocked[index] = 1;
  });
  return blocked;
}

// Le texte d'une valeur de Tiled, sans les espaces de bord ; null si ce n'est pas du texte ou s'il est vide.
function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function propertyValue(obj: TiledObject, name: string): unknown {
  if (!Array.isArray(obj.properties)) return undefined;
  return obj.properties.find((property) => property?.name === name)?.value;
}

function isZoneType(value: string): value is ZoneType {
  return (ZONE_TYPES as readonly string[]).includes(value);
}

// Ce que l'objet est s'il n'est pas un rectangle (même ordre de test que Phaser).
function nonRectangle(obj: TiledObject): string | null {
  if (obj.gid !== undefined) return 'un objet-tuile';
  if (obj.polyline) return 'une polyligne';
  if (obj.polygon) return 'un polygone';
  if (obj.ellipse) return 'une ellipse';
  if (obj.text !== undefined) return 'un texte';
  if (obj.point) return 'un point';
  return null;
}

function readZone(obj: TiledObject): Zone {
  const name = readText(obj.name);
  const label = `Zone n° ${obj.id}${name ? ` (« ${name} »)` : ''}`;

  // Tiled écrit la classe dans `type` (vide si l'objet n'en a pas), ou dans `class` ; à défaut, une propriété `type`.
  const type = readText(obj.type) ?? readText(obj.class) ?? readText(propertyValue(obj, 'type'));
  if (type === null) {
    throw new MapError('bad_zone', `${label} : aucun type. Lui donner une classe parmi : ${ZONE_TYPES.join(', ')}.`);
  }
  if (!isZoneType(type)) {
    throw new MapError('bad_zone', `${label} : le type « ${type} » est inconnu. Types possibles : ${ZONE_TYPES.join(', ')}.`);
  }

  const shape = nonRectangle(obj);
  if (shape) throw new MapError('bad_zone', `${label} : ce n'est pas un rectangle (c'est ${shape}).`);
  if (obj.rotation) throw new MapError('bad_zone', `${label} : sa rotation (${obj.rotation}°) n'est pas permise, une zone est un rectangle droit.`);

  const { x, y, width, height } = obj;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new MapError('bad_zone', `${label} : position ou taille invalide (x = ${x}, y = ${y}, largeur = ${width}, hauteur = ${height}). La largeur et la hauteur doivent être positives.`);
  }

  return { id: String(obj.id), type, name, text: readText(propertyValue(obj, 'text')), x, y, width, height };
}

// Les clés des places sont uniques, et chaque porte (zone `door`, dont le nom est la clé d'une place) ferme un bureau qui existe.
function checkDesks(zones: Zone[]): void {
  const desks = zones.filter((zone) => zone.type === 'desk');
  const keys = new Set<string>();
  for (const desk of desks) {
    const key = deskKey(desk);
    if (keys.has(key)) {
      throw new MapError('bad_zone', `Zone n° ${desk.id} : deux bureaux portent le nom « ${key} ». Le nom d'un bureau (zone desk) est sa clé : il doit être unique.`);
    }
    keys.add(key);
  }
  for (const door of zones.filter((zone) => zone.type === 'door')) {
    if (door.name === null || !keys.has(door.name)) {
      throw new MapError(
        'bad_zone',
        `Zone n° ${door.id} : cette porte (zone door) ne ferme aucun bureau. Son nom doit être celui d'une zone desk${door.name ? ` (« ${door.name} » n'existe pas)` : ''}.`,
      );
    }
  }
}

function pickSpawnZone(zones: Zone[]): Zone {
  const spawns = zones.filter((zone) => zone.type === 'spawn');
  if (spawns.length === 0) {
    throw new MapError('missing_spawn', 'La carte n\'a aucune zone « spawn » : dessiner un rectangle de classe spawn dans le calque « zones ».');
  }
  if (spawns.length > 1) {
    throw new MapError('bad_zone', `La carte a ${spawns.length} zones spawn (n° ${spawns.map((zone) => zone.id).join(', ')}) : une seule est permise.`);
  }
  return spawns[0]!;
}
