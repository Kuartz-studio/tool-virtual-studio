// Types minimaux du JSON que Tiled exporte (format 1.10, celui de Tiled 1.12) : seulement ce que lisent parseOfficeMap et
// buildTiledMap. Rien de Phaser ni de Node : ces types servent au client comme au serveur.
// Les champs que Tiled écrit toujours mais qu'un fichier écrit à la main peut omettre sont facultatifs.

export interface TiledProperty {
  name: string;
  type?: string;   // 'string', 'int', 'float', 'bool', 'color', 'file', 'object', 'class'
  propertytype?: string;
  value: unknown;
}

export interface TiledObject {
  id: number;
  name: string;
  type?: string;    // la classe de l'objet : le champ que Tiled écrit dans l'export JSON, et que Phaser lit
  class?: string;   // la même chose, sous le nom que lui donne Tiled depuis la version 1.9
  x: number;        // en pixels
  y: number;
  width: number;
  height: number;
  rotation?: number;
  visible?: boolean;
  // Un objet sans aucun de ces champs est un rectangle. Les autres formes ne sont pas des zones.
  point?: boolean;
  ellipse?: boolean;
  polygon?: Array<{ x: number; y: number }>;
  polyline?: Array<{ x: number; y: number }>;
  text?: unknown;
  gid?: number;     // objet-tuile
  properties?: TiledProperty[];
}

export interface TiledTileLayer {
  type: 'tilelayer';
  id?: number;
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  opacity?: number;
  visible?: boolean;
  // CSV : un tableau de numéros de tuiles (GID), 0 pour une case vide. Une chaîne, c'est du base64.
  data?: number[] | string;
  encoding?: 'csv' | 'base64';
  compression?: '' | 'zlib' | 'gzip' | 'zstd';
  chunks?: unknown[];   // à la place de data dans une carte infinie
  properties?: TiledProperty[];
}

export interface TiledObjectLayer {
  type: 'objectgroup';
  id?: number;
  name: string;
  objects: TiledObject[];
  draworder?: 'topdown' | 'index';
  x?: number;
  y?: number;
  opacity?: number;
  visible?: boolean;
  properties?: TiledProperty[];
}

// Les autres calques (image, groupe) ne servent ni au serveur ni à ce paquet.
export interface TiledOtherLayer {
  type: 'imagelayer' | 'group';
  id?: number;
  name: string;
  opacity?: number;
  visible?: boolean;
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer | TiledOtherLayer;

export interface TiledEmbeddedTileset {
  firstgid: number;
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  margin: number;
  spacing: number;
  // Un tileset « collection d'images » n'a pas d'image à lui : chaque tuile a la sienne.
  image?: string;       // relatif au fichier de la carte
  imagewidth?: number;
  imageheight?: number;
  tiles?: unknown[];
}

// Un tileset qui n'est pas intégré à la carte : Phaser ne sait pas le charger.
export interface TiledExternalTileset {
  firstgid: number;
  source: string;
}

export type TiledTileset = TiledEmbeddedTileset | TiledExternalTileset;

export interface TiledMapJson {
  type?: 'map';
  version?: string;
  tiledversion?: string;
  orientation: string;
  renderorder?: string;
  infinite?: boolean;
  width: number;       // en cases
  height: number;
  tilewidth: number;   // en pixels
  tileheight: number;
  compressionlevel?: number;
  nextlayerid?: number;
  nextobjectid?: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
  properties?: TiledProperty[];
}
