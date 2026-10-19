import { TILE_SIZE, type TiledMapJson, type Zone } from '@bureau/shared';
import { snapToPixels } from './pixel-snap';

// Les profondeurs d'affichage. Les calques de tuiles ont les leurs ; un avatar ou un objet a pour profondeur le y de ses pieds
// (plus il est bas dans la carte, plus il est devant), donc toujours entre `meublesBas` et `dessus`. Le calque `dessus` et les
// noms passent devant tout le monde.
export const DEPTH = { sol: 0, murs: 1, meublesBas: 2, dessus: 1_000_000, nameTags: 1_000_001 } as const;

// La clé de texture de l'image d'un tileset. Le Preloader charge l'image sous cette clé, et buildMapLayers retrouve la texture
// par le nom du tileset dans la carte.
export function tilesetTextureKey(tilesetName: string): string {
  return `tileset:${tilesetName}`;
}

// Les images à charger pour cette carte : celles de ses tilesets intégrés, avec leur adresse. Tiled écrit l'image d'un tileset
// relativement au fichier de la carte (../dev/tiles.png pour maps/dev-office.json), et c'est ainsi qu'on la résout. Un tileset
// sans image (une collection d'images) ou externe n'a rien à charger : Phaser ne les sait pas lire, et parseOfficeMap refuse
// déjà les externes.
export function tilesetImages(json: TiledMapJson, mapUrl: string): Array<{ key: string; url: string }> {
  const mapFile = new URL(mapUrl, window.location.href);
  const images: Array<{ key: string; url: string }> = [];
  // Un fichier JSON qui n'est pas une carte n'a pas de tilesets : parseOfficeMap le refusera, avec un message qui le dit.
  for (const tileset of Array.isArray(json.tilesets) ? json.tilesets : []) {
    if ('source' in tileset || !tileset.image) continue;
    images.push({ key: tilesetTextureKey(tileset.name), url: new URL(tileset.image, mapFile).href });
  }
  return images;
}

// Construit ce que la carte montre et ce qui bloque : les calques de tuiles (sol, murs, meubles-bas, dessus) à leur profondeur,
// et le calque `collisions`, invisible, dont toute tuile est un obstacle pour la physique Arcade. Le monde physique prend la
// taille de la carte. Les images des tilesets doivent déjà être chargées (Preloader). Le calque `objets` (des objets-tuiles, triés
// par profondeur) n'est pas encore dessiné ; les étiquettes se posent avec addZoneLabels.
export function buildMapLayers(scene: Phaser.Scene, map: Phaser.Tilemaps.Tilemap): { collisions: Phaser.Tilemaps.TilemapLayer } {
  // Tout le jeu (vitesse, distances de conversation) compte en cases de TILE_SIZE : une carte à une autre échelle serait fausse.
  if (map.tileWidth !== TILE_SIZE || map.tileHeight !== TILE_SIZE) {
    throw new Error(`Les tuiles de la carte font ${map.tileWidth} × ${map.tileHeight} px, le jeu attend des tuiles de ${TILE_SIZE} px.`);
  }

  const tilesets = map.tilesets.map((tileset) => {
    const added = map.addTilesetImage(tileset.name, tilesetTextureKey(tileset.name));
    if (!added) throw new Error(`L'image du tileset « ${tileset.name} » n'est pas chargée.`);
    return added;
  });

  // Sans 5e argument, createLayer crée un TilemapLayer (et non un TilemapGPULayer) ; il renvoie null, en le signalant dans la
  // console, si la carte n'a pas ce calque.
  const createLayer = (name: string): Phaser.Tilemaps.TilemapLayer | null => {
    const layer = map.createLayer(name, tilesets, 0, 0) as Phaser.Tilemaps.TilemapLayer | null;
    return layer && snapToPixels(layer);
  };

  // Un calque visible absent n'empêche pas de jouer : la carte n'a simplement rien à cet étage.
  createLayer('sol')?.setDepth(DEPTH.sol);
  createLayer('murs')?.setDepth(DEPTH.murs);
  createLayer('meubles-bas')?.setDepth(DEPTH.meublesBas);
  createLayer('dessus')?.setDepth(DEPTH.dessus);

  const collisions = createLayer('collisions');
  if (!collisions) throw new Error('Le calque « collisions » est absent de la carte.');
  collisions.setVisible(false);
  // Toute tuile, quel que soit son numéro, est un obstacle ; -1 est la case vide.
  collisions.setCollisionByExclusion([-1]);

  scene.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
  return { collisions };
}

// Le texte d'une étiquette : en gras, de la couleur d'une inscription peinte au sol.
const LABEL_STYLE = { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#3b4256' };
// Au-dessus du sol et des meubles bas, sous tous les avatars.
const LABEL_DEPTH = DEPTH.meublesBas + 0.5;

// Les étiquettes de la carte (zones `label` ayant un texte) deviennent des textes Phaser, centrés dans leur zone.
export function addZoneLabels(scene: Phaser.Scene, zones: readonly Zone[]): void {
  for (const zone of zones) {
    if (zone.type !== 'label' || zone.text === null) continue;
    const label = scene.add.text(zone.x + zone.width / 2, zone.y + zone.height / 2, zone.text, LABEL_STYLE).setOrigin(0.5);
    snapToPixels(label).setDepth(LABEL_DEPTH);
  }
}
