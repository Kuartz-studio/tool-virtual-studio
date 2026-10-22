import { LIGHT_SWITCH_REACH_TILES } from '@bureau/shared';
import type { GameObjects, Scene, Textures } from 'phaser';
import { fr } from '../i18n/fr';
import { DECOR_DEPTH } from './decor-layout';
import type { Interactable, Interactions, Point } from './interactions';
import { snapToPixels } from './pixel-snap';

// L'interrupteur de la lumière : une plaque au mur du couloir, que tout le monde actionne de près (3 cases au plus : LIGHT_SWITCH_REACH_TILES,
// la règle du serveur aussi), par la touche E ou d'un clic sur la plaque. C'est une cible du gestionnaire de la touche E (interactions.ts) :
// c'est lui qui retient la plus proche, et l'étiquette « [E] … » est la sienne. Actionné, il ne change rien lui-même : il demande (onUse), et la
// plaque ne bascule qu'à l'annonce du serveur (setOn), comme pour tout le monde. Ce fichier n'importe de Phaser que des types : la scène
// lui donne de quoi dessiner.

// Les textures de la plaque, créées une fois au chargement (addSwitchTextures) : `on` quand la lumière est allumée, `off` quand elle est éteinte.
export const SWITCH_TEXTURES = { on: 'switch:on', off: 'switch:off' } as const;

// La plaque fait 10 × 14 px du monde. Elle est dessinée au pixel, comme les meubles du pack : un contour sombre, un biseau clair en haut
// à gauche et plus sombre en bas à droite, et au milieu un basculeur de 2 × 6 px dont une moitié est claire et l'autre dans l'ombre.
// L'interrupteur de la carte est le centre de la case du mur, dont la plinthe occupe le bas : la plaque est posée 4 px plus haut (`offsetY`),
// sur la face claire du mur, au-dessus de la plinthe. La portée, elle, se compte depuis le centre de la case.
export const PLATE = { width: 10, height: 14, offsetY: -4 } as const;

// Chaque lettre est une couleur de la palette, le point est transparent. `T` et `B` sont les moitiés haute et basse du basculeur : allumée,
// c'est la haute qui est claire (basculeur levé) ; éteinte, la basse.
const PLATE_ART: readonly string[] = [
  '..oooooo..',
  '.ohhhhhho.',
  'ohppppppso',
  'ohpoooopso',
  'ohpoTTopso',
  'ohpoTTopso',
  'ohpoTTopso',
  'ohpoBBopso',
  'ohpoBBopso',
  'ohpoBBopso',
  'ohpoooopso',
  'ohppppppso',
  '.osssssso.',
  '..oooooo..',
];
const PALETTE: Readonly<Record<string, string>> = {
  o: '#2b2433',   // le contour
  h: '#fbf9f2',   // le biseau éclairé
  p: '#e6e1d4',   // la plaque
  s: '#b9b2a3',   // le biseau dans l'ombre
  k: '#ffffff',   // la moitié claire du basculeur
  d: '#8c8577',   // sa moitié dans l'ombre
};

// Les pixels de la plaque, rangée par rangée, allumée ou éteinte.
export function plateRows(on: boolean): string[] {
  return PLATE_ART.map((row) => row.replaceAll('T', on ? 'k' : 'd').replaceAll('B', on ? 'd' : 'k'));
}

type MakeCanvas = () => HTMLCanvasElement;

// Crée les deux textures de la plaque, sauf celles qui existent déjà (le jeu relance la scène à chaque connexion à une autre carte).
export function addSwitchTextures(textures: Textures.TextureManager, makeCanvas: MakeCanvas = () => document.createElement('canvas')): void {
  for (const on of [true, false]) {
    const key = on ? SWITCH_TEXTURES.on : SWITCH_TEXTURES.off;
    if (textures.exists(key)) continue;
    const canvas = makeCanvas();
    canvas.width = PLATE.width;
    canvas.height = PLATE.height;
    const context = canvas.getContext('2d');
    if (context) {
      plateRows(on).forEach((row, y) => {
        [...row].forEach((pixel, x) => {
          const color = PALETTE[pixel];
          if (color === undefined) return;
          context.fillStyle = color;
          context.fillRect(x, y, 1, 1);
        });
      });
    }
    textures.addCanvas(key, canvas);
  }
}

// La plaque est devant les murs et ce qu'on y accroche (DECOR_DEPTH.wall), derrière les meubles et les avatars (dont la profondeur est le y).
const PLATE_DEPTH = DECOR_DEPTH.wall + 0.1;
// Le témoin ambré, de 2 × 2 px, brille en haut de la plaque quand la lumière est éteinte, pour qu'on la trouve dans le noir : il passe devant la
// couche de nuit (profondeur 1 000 000,5), qui assombrit tout le reste, la plaque comprise.
const BEACON_DEPTH = 1_000_000.6;
const BEACON_COLOR = 0xf59e0b;
const BEACON_SIZE = 2;
// Son centre : au milieu de la plaque, sur ses 2e et 3e rangées de pixels (le biseau du haut et la rangée dessous).
const BEACON_OFFSET_Y = PLATE.offsetY - PLATE.height / 2 + 1 + BEACON_SIZE / 2;
// L'étiquette « [E] … » (InteractionPrompt) se pose juste au-dessus de la plaque : cet espace, en pixels.
const LABEL_GAP = 2;

export class LightSwitch {
  private readonly plate: GameObjects.Image;
  private readonly beacon: GameObjects.Rectangle;
  private readonly unregister: () => void;
  private on = true;

  // `pos` : le centre de l'interrupteur, en pixels (OfficeMap.switches). `interactions` : le gestionnaire de la touche E, qui sait où sont les
  // pieds de l'avatar ; l'interrupteur s'y inscrit. `onUse` : la personne l'actionne, de près.
  constructor(
    scene: Scene,
    pos: Point,
    interactions: Interactions,
    onUse: () => void,
  ) {
    this.plate = snapToPixels(scene.add.image(pos.x, pos.y + PLATE.offsetY, SWITCH_TEXTURES.on)).setDepth(PLATE_DEPTH);
    this.plate.setInteractive({ useHandCursor: true });
    this.beacon = snapToPixels(scene.add.rectangle(pos.x, pos.y + BEACON_OFFSET_Y, BEACON_SIZE, BEACON_SIZE, BEACON_COLOR)).setDepth(BEACON_DEPTH).setVisible(false);
    const target: Interactable = {
      id: `switch:${pos.x},${pos.y}`,
      pos,
      reachTiles: LIGHT_SWITCH_REACH_TILES,
      labelAt: { x: pos.x, y: pos.y + PLATE.offsetY - PLATE.height / 2 - LABEL_GAP },
      prompt: () => `[E] ${this.on ? fr.lights.use : fr.lights.useOn}`,
      use: onUse,
    };
    this.unregister = interactions.register(target);
    // Un clic sur la plaque : elle seule, même si une autre cible est plus proche, et à portée seulement.
    this.plate.on('pointerdown', () => interactions.useTarget(target));
  }

  // L'état de la lumière tel que le serveur l'annonce : la plaque bascule, le témoin ambré brille dans le noir. L'étiquette, elle, relit
  // le texte de la cible à chaque image : elle dit ce que la touche fera.
  setOn(on: boolean): void {
    this.on = on;
    this.plate.setTexture(on ? SWITCH_TEXTURES.on : SWITCH_TEXTURES.off);
    this.beacon.setVisible(!on);
  }

  destroy(): void {
    this.unregister();
    this.plate.destroy();
    this.beacon.destroy();
  }
}
