import { MUSIC_SCENES, type MusicScene } from '../audio/scenes';
import { decorItem } from '../decor/catalog';
import type { Point } from './find-path';
import type { GameTable, Place, Rect } from './places';
import { isWalkablePoint } from './queries';
import type { TiledLayer, TiledMapJson, TiledObject, TiledObjectLayer, TiledTileLayer } from './tiled-types';

// Les types de zones du calque `zones` :
// - spawn : l'apparition ; private : une pièce isolée (salle de réunion) ; desk et door : un bureau et sa porte (même nom) ; label : un texte
//   écrit au sol ; switch : l'interrupteur de la lumière ;
// - place : un lieu (nom = sa clé ; propriétés label, kind `room` `open` ou `street`, scene, music, destination) ;
// - coffee : la case, 1 × 1, devant la machine à café ; speaker : l'enceinte, 1 × 1 (nom = la clé du lieu qu'elle règle, qui a de la musique) ;
// - game : la table d'un jeu (nom = chess, backgammon, connect4 ou ludo) ; seat : une chaise, 1 × 1 (nom = `<jeu>:<n>`, n à partir de 1) ;
// - sign : un panneau (propriété text) ;
// - arena : le ring de l'octogone (une seule zone : arena/arena.ts) ;
// - clerk : une administratrice de l'accueil, 1 × 1, la case où elle se tient (nom = sa clé : margot, ines…), à qui l'on parle (touche E).
export const ZONE_TYPES = ['spawn', 'private', 'desk', 'door', 'label', 'switch', 'place', 'coffee', 'speaker', 'game', 'seat', 'sign', 'arena', 'clerk'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

// Les zones dont les propriétés Tiled sont gardées (`Zone.properties`) : celles qui en portent.
const ZONES_WITH_PROPERTIES: readonly ZoneType[] = ['place', 'sign'];

// Les quatre jeux de la salle de jeu : les noms des zones `game` de la carte. Une seule liste, que la plateforme des jeux réexporte.
export const GAME_IDS = ['chess', 'backgammon', 'connect4', 'ludo'] as const;
export type GameId = (typeof GAME_IDS)[number];
const PLACE_KINDS = ['room', 'open', 'street'] as const;

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
  // Les propriétés Tiled de la zone (label, kind, scene… d'une place ; text d'un panneau), pour les types qui en portent.
  properties?: Readonly<Record<string, string | number | boolean>>;
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
  // Les lieux déclarés par la carte (zones `place`), dans son ordre ; les bureaux sont ajoutés par placeAt et placeByKey (places.ts).
  places: Place[];
  // Le centre de la case devant chaque machine à café, en pixels.
  coffees: Point[];
  // Le centre de chaque enceinte, en pixels, et la clé du lieu dont elle règle la musique.
  speakers: Array<Point & { place: string }>;
  // Les tables de jeu, avec leurs sièges.
  tables: GameTable[];
  // Les panneaux : leur rectangle, en pixels, et leur texte.
  signs: Array<Rect & { text: string }>;
  // Le ring de l'octogone, en pixels ; null si la carte n'en a pas.
  arena: Rect | null;
  // Les administratrices de l'accueil : le centre de la case où chacune se tient, en pixels, et sa clé (son prénom, sans accent : margot, ines…).
  clerks: Array<Point & { name: string }>;
  // Ce que le calque `objets` accroche aux murs (ses éléments muraux : les panneaux de sortie…) : le rectangle de chaque image sur la face du mur, en
  // pixels. La déco du dehors d'un bureau ne les recouvre pas (deskRoomSpecOf). Absent : la carte n'en accroche aucun (celles des tests, écrites à la main).
  wallItems?: Rect[];
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
  const tileSize = json.tilewidth;
  const places = readPlaces(zones);
  const map: OfficeMap = {
    widthTiles: json.width,
    heightTiles: json.height,
    tileSize: json.tilewidth,
    blocked,
    zones,
    spawn: { x: spawnZone.x + spawnZone.width / 2, y: spawnZone.y + spawnZone.height / 2 },
    switches: zones.filter((zone) => zone.type === 'switch').map((zone) => ({ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 })),
    places,
    coffees: readCoffees(zones, tileSize),
    speakers: readSpeakers(zones, places, tileSize),
    tables: readTables(zones, tileSize),
    signs: readSigns(zones),
    arena: readArena(zones),
    clerks: readClerks(zones, tileSize),
    wallItems: readWallItems(layers, tileSize),
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

  const properties = ZONES_WITH_PROPERTIES.includes(type) ? readProperties(obj) : undefined;
  return { id: String(obj.id), type, name, text: readText(propertyValue(obj, 'text')), x, y, width, height, ...(properties ? { properties } : {}) };
}

// Les propriétés de l'objet qui sont du texte, un nombre ou un booléen ; undefined s'il n'en a aucune.
function readProperties(obj: TiledObject): Record<string, string | number | boolean> | undefined {
  if (!Array.isArray(obj.properties)) return undefined;
  const found: Record<string, string | number | boolean> = {};
  for (const property of obj.properties) {
    const value: unknown = property?.value;
    if (typeof property?.name === 'string' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) found[property.name] = value;
  }
  return Object.keys(found).length > 0 ? found : undefined;
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

// « Zone n° 3 (« gym »)» : de quoi retrouver la zone dans Tiled.
const labelOf = (zone: Zone): string => `Zone n° ${zone.id}${zone.name ? ` (« ${zone.name} »)` : ''}`;

// Un drapeau de Tiled : une case cochée (booléen), 1, ou le texte « 1 » ou « true ».
const isFlag = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true';

// Les lieux : une zone `place` par lieu, avec son nom (la clé, unique), son label, son genre (`room` par défaut), sa scène musicale (`lobby` par
// défaut), et ses drapeaux music et destination.
function readPlaces(zones: Zone[]): Place[] {
  const places: Place[] = [];
  const keys = new Set<string>();
  for (const zone of zones.filter((z) => z.type === 'place')) {
    const where = labelOf(zone);
    if (zone.name === null) throw new MapError('bad_zone', `${where} : un lieu (zone place) doit avoir un nom : c'est sa clé.`);
    if (zone.name.startsWith('desk:')) throw new MapError('bad_zone', `${where} : la clé « ${zone.name} » est réservée aux bureaux (« desk: » au début).`);
    if (keys.has(zone.name)) throw new MapError('bad_zone', `${where} : deux lieux portent la clé « ${zone.name} ». Elle doit être unique.`);
    keys.add(zone.name);
    const label = readText(zone.properties?.label);
    if (label === null) throw new MapError('bad_zone', `${where} : ce lieu n'a pas de propriété « label » (son nom affiché).`);
    const kind = readText(zone.properties?.kind) ?? 'room';
    if (!(PLACE_KINDS as readonly string[]).includes(kind)) {
      throw new MapError('bad_zone', `${where} : le genre « ${kind} » est inconnu. Genres possibles : ${PLACE_KINDS.join(', ')}.`);
    }
    const scene = readText(zone.properties?.scene) ?? 'lobby';
    if (!(MUSIC_SCENES as readonly string[]).includes(scene)) {
      throw new MapError('bad_zone', `${where} : la scène « ${scene} » est inconnue. Scènes possibles : ${MUSIC_SCENES.join(', ')}.`);
    }
    places.push({
      key: zone.name,
      label,
      kind: kind as Place['kind'],
      rects: [{ x: zone.x, y: zone.y, width: zone.width, height: zone.height }],
      scene: scene as MusicScene,
      music: isFlag(zone.properties?.music),
      destination: isFlag(zone.properties?.destination),
    });
  }
  return places;
}

// Une zone d'une case sur une case (une enceinte, la case de la machine à café, un siège) : son centre, en pixels.
function oneTile(zone: Zone, tileSize: number, what: string): Point {
  if (zone.width !== tileSize || zone.height !== tileSize) {
    throw new MapError('bad_zone', `${labelOf(zone)} : ${what} fait 1 × 1 case (${tileSize} × ${tileSize} px), pas ${zone.width} × ${zone.height}.`);
  }
  return { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
}

function readCoffees(zones: Zone[], tileSize: number): Point[] {
  return zones.filter((z) => z.type === 'coffee').map((zone) => oneTile(zone, tileSize, 'la case devant la machine à café (zone coffee)'));
}

// Les enceintes : chacune règle la musique d'un lieu qui en a (propriété music).
function readSpeakers(zones: Zone[], places: Place[], tileSize: number): Array<Point & { place: string }> {
  return zones
    .filter((z) => z.type === 'speaker')
    .map((zone) => {
      const centre = oneTile(zone, tileSize, 'une enceinte (zone speaker)');
      const target = places.find((place) => place.key === zone.name);
      if (!target) {
        throw new MapError('bad_zone', `${labelOf(zone)} : cette enceinte (zone speaker) ne règle aucun lieu. Son nom doit être la clé d'une zone place${zone.name ? ` (« ${zone.name} » n'existe pas)` : ''}.`);
      }
      if (!target.music) {
        throw new MapError('bad_zone', `${labelOf(zone)} : l'enceinte (zone speaker) règle « ${target.key} », qui n'a pas de musique : lui donner la propriété music.`);
      }
      return { ...centre, place: target.key };
    });
}

// Les administratrices (zones `clerk`) : chacune a un nom, qui la désigne (deux ne peuvent pas porter le même).
function readClerks(zones: Zone[], tileSize: number): Array<Point & { name: string }> {
  const clerks: Array<Point & { name: string }> = [];
  for (const zone of zones.filter((z) => z.type === 'clerk')) {
    const centre = oneTile(zone, tileSize, 'une administratrice (zone clerk)');
    if (!zone.name) throw new MapError('bad_zone', `${labelOf(zone)} : une administratrice (zone clerk) a un nom, sa clé (margot, ines…).`);
    if (clerks.some((clerk) => clerk.name === zone.name)) throw new MapError('bad_zone', `${labelOf(zone)} : deux administratrices s'appellent « ${zone.name} ».`);
    clerks.push({ ...centre, name: zone.name });
  }
  return clerks;
}

// Les tables de jeu (une zone `game` par jeu) et leurs sièges (zones `seat`, nommées `<jeu>:<n>`), dans l'ordre de leur numéro.
function readTables(zones: Zone[], tileSize: number): GameTable[] {
  const tables: GameTable[] = [];
  for (const zone of zones.filter((z) => z.type === 'game')) {
    const game = GAME_IDS.find((id) => id === zone.name);
    if (!game) {
      throw new MapError('bad_zone', `${labelOf(zone)} : le jeu « ${zone.name ?? ''} » est inconnu (zone game). Jeux possibles : ${GAME_IDS.join(', ')}.`);
    }
    if (tables.some((table) => table.game === game)) throw new MapError('bad_zone', `${labelOf(zone)} : deux tables pour le jeu « ${game} » : une seule est permise.`);
    tables.push({ game, rect: { x: zone.x, y: zone.y, width: zone.width, height: zone.height }, seats: [] });
  }
  const seats = new Map<GameId, Map<number, Point>>();
  for (const zone of zones.filter((z) => z.type === 'seat')) {
    const match = /^([^:]+):([1-9][0-9]*)$/.exec(zone.name ?? '');
    if (!match) throw new MapError('bad_zone', `${labelOf(zone)} : le nom d'un siège (zone seat) est « <jeu>:<numéro> » avec un numéro à partir de 1, par exemple « chess:1 » (reçu : « ${zone.name ?? ''} »).`);
    const game = GAME_IDS.find((id) => id === match[1]);
    if (!game || !tables.some((table) => table.game === game)) {
      throw new MapError('bad_zone', `${labelOf(zone)} : ce siège (zone seat) est pour le jeu « ${match[1]} », qui n'a pas de table (zone game du même nom).`);
    }
    const number = Number(match[2]);
    const taken = seats.get(game) ?? new Map<number, Point>();
    if (taken.has(number)) throw new MapError('bad_zone', `${labelOf(zone)} : deux sièges portent le nom « ${zone.name} ».`);
    taken.set(number, oneTile(zone, tileSize, 'un siège (zone seat)'));
    seats.set(game, taken);
  }
  for (const table of tables) {
    table.seats = [...(seats.get(table.game) ?? new Map<number, Point>()).entries()].sort((a, b) => a[0] - b[0]).map(([, point]) => point);
  }
  return tables;
}

// Les panneaux : un rectangle et un texte (propriété text).
function readSigns(zones: Zone[]): Array<Rect & { text: string }> {
  return zones
    .filter((z) => z.type === 'sign')
    .map((zone) => {
      const text = readText(zone.properties?.text);
      if (text === null) throw new MapError('bad_zone', `${labelOf(zone)} : ce panneau (zone sign) n'a pas de propriété « text ».`);
      return { x: zone.x, y: zone.y, width: zone.width, height: zone.height, text };
    });
}

// Les éléments muraux du calque d'objets `objets` (le nom d'un objet est la clé de l'élément de la banque), là où leur image recouvre le mur : un élément
// mural est posé à la case qu'il surplombe (la rangée sous le mur, en haut de l'objet), et son image monte de sa hauteur au-dessus. Une carte sans ce
// calque n'en a pas ; ce que la banque ne connaît pas est laissé de côté.
function readWallItems(layers: TiledLayer[], tileSize: number): Rect[] {
  const layer = layers.find((l) => l.name === 'objets');
  if (!layer || layer.type !== 'objectgroup' || !Array.isArray(layer.objects)) return [];
  return layer.objects.flatMap((object) => {
    const item = typeof object.name === 'string' ? decorItem(object.name) : undefined;
    if (item?.kind !== 'wall' || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return [];
    return [{ x: object.x, y: object.y - item.h * tileSize, width: item.w * tileSize, height: item.h * tileSize }];
  });
}

// Le ring de l'octogone : au plus une zone `arena`.
function readArena(zones: Zone[]): Rect | null {
  const arenas = zones.filter((z) => z.type === 'arena');
  if (arenas.length > 1) throw new MapError('bad_zone', `La carte a ${arenas.length} zones arena (n° ${arenas.map((zone) => zone.id).join(', ')}) : une seule est permise.`);
  const zone = arenas[0];
  return zone ? { x: zone.x, y: zone.y, width: zone.width, height: zone.height } : null;
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
