import { MAX_SPEED_PX_PER_S, type Direction, type MovePayload } from '@bureau/shared';
import { GameObjects, Physics, Scenes, type Scene } from 'phaser';
import { animKey, AVATARS, feetBody } from '../avatars';
import { snapToPixels } from '../pixel-snap';
import { addShadow, placeShadow } from './shadow';

// Le sens de chaque direction à l'écran : y augmente vers le bas.
const HEADING: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const STILL = { x: 0, y: 0 };

// L'avatar de la personne qui joue : un sprite physique (Arcade), dont les pieds sont le point de référence.
//
// - L'origine du sprite est aux pieds (0.5, 1) : x et y sont ceux de ses pieds, les coordonnées que le serveur connaît.
// - Seuls les pieds butent contre les murs et les meubles : la zone de collision fait 20 × 12 px, au bas de l'image (feetBody).
// - Il marche à MAX_SPEED_PX_PER_S dans une seule des 4 directions, ou il est immobile : step() est appelé à chaque image avec la
//   direction demandée.
// - Sa profondeur est le y de ses pieds : plus il est bas dans la carte, plus il est devant. Son ombre est juste derrière.
export class LocalPlayer extends Physics.Arcade.Sprite {
  private readonly avatarKey: string;
  private readonly shadow: GameObjects.Ellipse;
  // Vers où il regarde : la dernière direction prise, gardée à l'arrêt. Il apparaît de face.
  private facing: Direction = 'down';
  // Une touche de déplacement est enfoncée. Contre un mur, l'avatar marche donc sur place : sa demande est de marcher.
  private moving = false;

  constructor(scene: Scene, x: number, y: number, avatarKey: string) {
    super(scene, x, y, avatarKey, AVATARS[avatarKey]!.idle.down[0]);
    this.avatarKey = avatarKey;
    this.setOrigin(0.5, 1);
    snapToPixels(this);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    const feet = feetBody(AVATARS[avatarKey]!);
    const body = this.arcadeBody();
    body.setSize(feet.width, feet.height);
    body.setOffset(feet.offsetX, feet.offsetY);
    // La carte est entourée de murs, mais un trou dans ses bords ne doit pas laisser sortir l'avatar.
    body.setCollideWorldBounds(true);

    this.shadow = addShadow(scene, x, y);
    this.setDepth(y);
    this.play(animKey(avatarKey, 'idle', 'down'));

    // La physique déplace le sprite après la mise à jour de la scène (POST_UPDATE, où elle est abonnée avant nous) : l'ombre et la
    // profondeur suivent alors la position de cette image, et non de la précédente.
    const { events } = scene;
    events.on(Scenes.Events.POST_UPDATE, this.followFeet, this);
    this.once(GameObjects.Events.DESTROY, () => {
      events.off(Scenes.Events.POST_UPDATE, this.followFeet, this);
      this.shadow.destroy();
    });
  }

  // Une image du jeu : la direction demandée par le clavier (null : aucune touche), appliquée à la vitesse et à l'animation.
  step(dir: Direction | null): void {
    if (dir !== null) this.facing = dir;
    this.moving = dir !== null;
    const heading = dir === null ? STILL : HEADING[dir];
    this.arcadeBody().setVelocity(heading.x * MAX_SPEED_PX_PER_S, heading.y * MAX_SPEED_PX_PER_S);
    // `true` : une animation déjà en cours n'est pas relancée à chaque image.
    this.play(animKey(this.avatarKey, this.moving ? 'walk' : 'idle', this.facing), true);
  }

  // Ce que le serveur doit savoir : les pieds, en pixels entiers, la direction et la marche. (Pas `state()` : tout objet de Phaser
  // a déjà une propriété `state`, que son constructeur met à 0 et qui masquerait la méthode.)
  movePayload(): MovePayload {
    return { x: Math.round(this.x), y: Math.round(this.y), dir: this.facing, moving: this.moving };
  }

  private arcadeBody(): Physics.Arcade.Body {
    return this.body as Physics.Arcade.Body;
  }

  private followFeet(): void {
    this.setDepth(this.y);
    placeShadow(this.shadow, this.x, this.y);
  }
}
