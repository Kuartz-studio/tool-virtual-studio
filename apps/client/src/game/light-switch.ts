import { withinSwitchReach } from '@bureau/shared';
import type { GameObjects, Scene, Textures } from 'phaser';
import { fr } from '../i18n/fr';
import { DECOR_DEPTH } from './decor-layout';
import { bindUseKey } from './input';
import { DEPTH } from './map-layers';
import { TAG_BACKGROUND, TAG_PAD_X, TAG_PAD_Y, TAG_TEXT_STYLE } from './objects/NameTag';
import { snapToPixels } from './pixel-snap';

// L'interrupteur de la lumière : une plaque au mur du couloir, que tout le monde actionne de près (3 cases au plus : withinSwitchReach, la
// règle du serveur aussi), par la touche E ou d'un clic sur la plaque. Actionné, il ne change rien lui-même : il demande (onUse), et la
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
// L'étiquette est une pastille comme celle des noms, juste au-dessus de la plaque.
const LABEL_GAP = 2;
const LABEL_BACKGROUND = `rgba(${(TAG_BACKGROUND.color >> 16) & 255}, ${(TAG_BACKGROUND.color >> 8) & 255}, ${TAG_BACKGROUND.color & 255}, ${TAG_BACKGROUND.alpha})`;
const LABEL_STYLE = { ...TAG_TEXT_STYLE, backgroundColor: LABEL_BACKGROUND, padding: { x: TAG_PAD_X, y: TAG_PAD_Y } };

export class LightSwitch {
  private readonly plate: GameObjects.Image;
  private readonly beacon: GameObjects.Rectangle;
  private readonly label: GameObjects.Text;
  private readonly unbindKey: () => void;
  private on = true;
  private inReach = false;

  // `pos` : le centre de l'interrupteur, en pixels (OfficeMap.switches). `onUse` : la personne l'actionne, de près. `feet` (facultatif) : où
  // sont ses pieds à cet instant ; sans lui, la portée est celle de la dernière image (updateReach).
  constructor(
    scene: Scene,
    private readonly pos: { x: number; y: number },
    private readonly onUse: () => void,
    private readonly feet?: () => { x: number; y: number },
  ) {
    this.plate = snapToPixels(scene.add.image(pos.x, pos.y + PLATE.offsetY, SWITCH_TEXTURES.on)).setDepth(PLATE_DEPTH);
    this.plate.setInteractive({ useHandCursor: true });
    this.plate.on('pointerdown', () => this.use());
    this.beacon = snapToPixels(scene.add.rectangle(pos.x, pos.y + BEACON_OFFSET_Y, BEACON_SIZE, BEACON_SIZE, BEACON_COLOR)).setDepth(BEACON_DEPTH).setVisible(false);
    this.label = snapToPixels(scene.add.text(pos.x, pos.y + PLATE.offsetY - PLATE.height / 2 - LABEL_GAP, this.labelText(), { ...LABEL_STYLE, resolution: 1 }).setOrigin(0.5, 1))
      .setDepth(DEPTH.nameTags)
      .setVisible(false);
    this.unbindKey = bindUseKey(() => this.use());
  }

  // L'état de la lumière tel que le serveur l'annonce : la plaque bascule, le témoin ambré brille dans le noir, l'étiquette dit ce que la
  // touche fera.
  setOn(on: boolean): void {
    this.on = on;
    this.plate.setTexture(on ? SWITCH_TEXTURES.on : SWITCH_TEXTURES.off);
    this.beacon.setVisible(!on);
    this.label.setText(this.labelText());
  }

  // Là où sont les pieds de l'avatar local, à chaque image : l'étiquette ne se montre qu'à portée. Dit si l'on y est.
  updateReach(player: { x: number; y: number }): boolean {
    const near = withinSwitchReach(player, [this.pos]);
    if (near !== this.inReach) {
      this.inReach = near;
      this.label.setVisible(near);
    }
    return near;
  }

  // La touche E, ou un clic sur la plaque : à portée seulement. Rend vrai si la demande est partie. La portée est relue à cet instant (un pas
  // ou une téléportation depuis la dernière image comptent) quand on sait où sont les pieds.
  private use(): boolean {
    if (this.feet) this.updateReach(this.feet());
    if (!this.inReach) return false;
    this.onUse();
    return true;
  }

  // Le zoom de la caméra a changé : le texte est redessiné à la nouvelle taille (jamais en dessous de 1, comme celui des noms).
  setZoom(zoom: number): void {
    this.label.setResolution(Math.max(1, zoom));
  }

  destroy(): void {
    this.unbindKey();
    this.plate.destroy();
    this.beacon.destroy();
    this.label.destroy();
  }

  private labelText(): string {
    return `[E] ${this.on ? fr.lights.use : fr.lights.useOn}`;
  }
}
