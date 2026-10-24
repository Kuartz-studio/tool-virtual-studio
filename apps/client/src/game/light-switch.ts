import { LIGHT_LEVELS, LIGHT_SWITCH_REACH_TILES, type LightLevel } from '@bureau/shared';
import type { GameObjects, Scene, Textures } from 'phaser';
import { fr } from '../i18n/fr';
import { DECOR_DEPTH } from './decor-layout';
import type { Interactable, Interactions, Point } from './interactions';
import { snapToPixels } from './pixel-snap';

// L'interrupteur de la lumière : une plaque au mur du couloir, que tout le monde actionne de près (3 cases au plus : LIGHT_SWITCH_REACH_TILES,
// la règle du serveur aussi), par la touche E ou d'un clic sur la plaque. C'est une cible du gestionnaire de la touche E (interactions.ts) :
// c'est lui qui retient la plus proche, et l'étiquette « [E] … » est la sienne. Actionné, il ne change rien lui-même : il demande (onUse), et la
// plaque ne bascule qu'à l'annonce du serveur (setLevel), comme pour tout le monde. Ce fichier n'importe de Phaser que des types : la scène
// lui donne de quoi dessiner.
//
// Un variateur à trois positions : chaque appui passe à l'état suivant, allumée → tamisée → éteinte → allumée (nextLightLevel).

// L'état où passe la lumière quand on actionne l'interrupteur : le suivant de LIGHT_LEVELS, puis le premier.
export function nextLightLevel(level: LightLevel): LightLevel {
  return LIGHT_LEVELS[(LIGHT_LEVELS.indexOf(level) + 1) % LIGHT_LEVELS.length]!;
}

// Les textures de la plaque, créées une fois au chargement (addSwitchTextures), une par état de la lumière.
export const SWITCH_TEXTURES: Readonly<Record<LightLevel, string>> = { on: 'switch:on', dim: 'switch:dim', off: 'switch:off' };

// La plaque fait 10 × 14 px du monde. Elle est dessinée au pixel, comme les meubles du pack : un contour sombre, un biseau clair en haut
// à gauche et plus sombre en bas à droite, et au milieu un basculeur de 2 × 6 px dont une moitié est claire et l'autre dans l'ombre.
// L'interrupteur de la carte est le centre de la case du mur, dont la plinthe occupe le bas : la plaque est posée 4 px plus haut (`offsetY`),
// sur la face claire du mur, au-dessus de la plinthe. La portée, elle, se compte depuis le centre de la case.
export const PLATE = { width: 10, height: 14, offsetY: -4 } as const;

// Chaque lettre est une couleur de la palette, le point est transparent. `T` et `B` sont les moitiés haute et basse du basculeur : allumée,
// c'est la haute qui est claire (basculeur levé) ; éteinte, la basse ; tamisée, les deux rangées du milieu (le basculeur à mi-course).
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

// Les rangées du milieu du basculeur : la première de sa moitié basse, et celle juste au-dessus (la dernière de sa moitié haute).
const FIRST_BOTTOM_ROW = PLATE_ART.findIndex((row) => row.includes('B'));
const MIDDLE_ROWS = [FIRST_BOTTOM_ROW - 1, FIRST_BOTTOM_ROW];

// Les pixels de la plaque, rangée par rangée, pour cet état de la lumière.
export function plateRows(level: LightLevel): string[] {
  return PLATE_ART.map((row, y) => {
    const lit = (half: 'T' | 'B') => (level === 'dim' ? MIDDLE_ROWS.includes(y) : (half === 'T') === (level === 'on'));
    return row.replaceAll('T', lit('T') ? 'k' : 'd').replaceAll('B', lit('B') ? 'k' : 'd');
  });
}

type MakeCanvas = () => HTMLCanvasElement;

// Crée les trois textures de la plaque, sauf celles qui existent déjà (le jeu relance la scène à chaque connexion à une autre carte).
export function addSwitchTextures(textures: Textures.TextureManager, makeCanvas: MakeCanvas = () => document.createElement('canvas')): void {
  for (const level of LIGHT_LEVELS) {
    const key = SWITCH_TEXTURES[level];
    if (textures.exists(key)) continue;
    const canvas = makeCanvas();
    canvas.width = PLATE.width;
    canvas.height = PLATE.height;
    const context = canvas.getContext('2d');
    if (context) {
      plateRows(level).forEach((row, y) => {
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
  private level: LightLevel = 'on';

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
      prompt: () => `[E] ${fr.lights.action[nextLightLevel(this.level)]}`,
      use: onUse,
    };
    this.unregister = interactions.register(target);
    // Un clic sur la plaque : elle seule, même si une autre cible est plus proche, et à portée seulement.
    this.plate.on('pointerdown', () => interactions.useTarget(target));
  }

  // L'état de la lumière tel que le serveur l'annonce : la plaque bascule, le témoin ambré brille dans le noir (la nuit seulement : tamisée, on y voit
  // encore). L'étiquette, elle, relit le texte de la cible à chaque image : elle dit ce que la touche fera.
  setLevel(level: LightLevel): void {
    this.level = level;
    this.plate.setTexture(SWITCH_TEXTURES[level]);
    this.beacon.setVisible(level === 'off');
  }

  destroy(): void {
    this.unregister();
    this.plate.destroy();
    this.beacon.destroy();
  }
}
