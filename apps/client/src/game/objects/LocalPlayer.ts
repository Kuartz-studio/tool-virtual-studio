import { SPRINT_FACTOR, WALK_SPEED_PX_PER_S, type ActivityState, type Direction, type MovePayload, type PublicPlayer, type Status } from '@bureau/shared';
import { GameObjects, Physics, Scenes, type Scene } from 'phaser';
import { animKey, avatarObjectName, feetBody, resolveAvatarKey, type AvatarSpec } from '../avatars';
import { feetPayload } from '../move-sender';
import { snapToPixels } from '../pixel-snap';
import { AvatarSkin, avatarLibraryOf } from './avatar-skin';
import { NameTag } from './NameTag';
import { addShadow, placeShadow } from './shadow';

// Le sens de chaque direction à l'écran : y augmente vers le bas.
const HEADING: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const STILL = { x: 0, y: 0 };
// En courant, les pas s'enchaînent plus vite, sans aller à trois fois la cadence : le dessin garde ses six images par direction.
const RUN_ANIMATION_SCALE = 1.7;

// L'avatar de la personne qui joue : un sprite physique (Arcade), dont les pieds sont le point de référence.
//
// - L'origine du sprite est aux pieds (0.5, 1) : x et y sont ceux de ses pieds, les coordonnées que le serveur connaît.
// - Seuls les pieds butent contre les murs et les meubles : la zone de collision fait 20 × 12 px, au bas de l'image (feetBody).
// - Il marche à WALK_SPEED_PX_PER_S dans une seule des 4 directions, ou il est immobile ; en courant (Maj), il va SPRINT_FACTOR fois plus
//   vite, et son animation de marche aussi : step() est appelé à chaque image avec la direction demandée.
// - Sa profondeur est le y de ses pieds : plus il est bas dans la carte, plus il est devant. Son ombre est juste derrière, son
//   étiquette (nom et statut) au-dessus de sa tête.
export class LocalPlayer extends Physics.Arcade.Sprite {
  private spec: AvatarSpec;
  private readonly skin: AvatarSkin;
  private readonly shadow: GameObjects.Ellipse;
  private readonly tag: NameTag;
  // Vers où il regarde : la dernière direction prise, gardée à l'arrêt.
  private facing: Direction;
  // Une touche de déplacement est enfoncée. Contre un mur, l'avatar marche donc sur place : sa demande est de marcher.
  private moving = false;

  // `p` : soi-même, tel que le serveur l'a placé (init) ; `zoom` : celui de la caméra, pour l'étiquette.
  constructor(scene: Scene, p: Pick<PublicPlayer, 'id' | 'x' | 'y' | 'dir' | 'avatarKey' | 'name' | 'status' | 'activity'>, zoom: number) {
    const library = avatarLibraryOf(scene);
    const spec = library.specFor(resolveAvatarKey(p.id, p.avatarKey));
    super(scene, p.x, p.y, spec.key, spec.idle[p.dir][0]);
    this.skin = new AvatarSkin(library, p.id, p.avatarKey, (next) => this.takeSpec(next));
    this.spec = spec;
    this.facing = p.dir;
    this.setOrigin(0.5, 1).setName(avatarObjectName(p.id));
    snapToPixels(this);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.fitBody();
    // La carte est entourée de murs, mais un trou dans ses bords ne doit pas laisser sortir l'avatar.
    this.arcadeBody().setCollideWorldBounds(true);

    this.shadow = addShadow(scene, p.x, p.y);
    this.tag = new NameTag(scene, p.name, p.status, zoom, p.activity ?? null);
    this.play(animKey(spec.key, 'idle', this.facing));
    this.followFeet();

    // La physique déplace le sprite après la mise à jour de la scène (POST_UPDATE, où elle est abonnée avant nous) : l'ombre, la
    // profondeur et l'étiquette suivent alors la position de cette image, et non de la précédente.
    const { events } = scene;
    events.on(Scenes.Events.POST_UPDATE, this.followFeet, this);
    this.once(GameObjects.Events.DESTROY, () => {
      events.off(Scenes.Events.POST_UPDATE, this.followFeet, this);
      this.skin.destroy();
      this.shadow.destroy();
      this.tag.destroy();
    });
  }

  // Une image du jeu : la direction demandée par le clavier (null : aucune touche) et si on court, appliquées à la vitesse et à
  // l'animation.
  step(dir: Direction | null, sprint = false): void {
    if (dir !== null) this.facing = dir;
    this.moving = dir !== null;
    const heading = dir === null ? STILL : HEADING[dir];
    const speed = WALK_SPEED_PX_PER_S * (sprint ? SPRINT_FACTOR : 1);
    this.arcadeBody().setVelocity(heading.x * speed, heading.y * speed);
    // `true` : une animation déjà en cours n'est pas relancée à chaque image.
    this.play(animKey(this.spec.key, this.moving ? 'walk' : 'idle', this.facing), true);
    this.anims.timeScale = this.moving && sprint ? RUN_ANIMATION_SCALE : 1;
  }

  // Ce que le serveur doit savoir : les pieds, en pixels entiers arrondis vers le bas (feetPayload), la direction et la marche. (Pas
  // `state()` : tout objet de Phaser a déjà une propriété `state`, que son constructeur met à 0 et qui masquerait la méthode.)
  movePayload(): MovePayload {
    return feetPayload(this.x, this.y, this.facing, this.moving);
  }

  // Pose l'avatar ailleurs (la position que donne le serveur : init, move:correct, ou une téléportation de test). La direction
  // regardée change si on la donne. La demande de marche reste celle du clavier : une touche toujours enfoncée le fait repartir de
  // là à l'image suivante.
  placeAt(x: number, y: number, dir?: Direction): void {
    // reset() arrête le corps et le replace avec le sprite (la physique le recale sur ses pieds à l'image suivante).
    this.arcadeBody().reset(x, y);
    if (dir) this.facing = dir;
    this.play(animKey(this.spec.key, this.moving ? 'walk' : 'idle', this.facing), true);
    this.followFeet();
  }

  // Un autre avatar (le profil a changé) : l'image, les animations et la zone de collision, qui suit la taille de son image.
  setAvatar(avatarKey: string | null): void {
    this.skin.set(avatarKey);
  }

  private takeSpec(spec: AvatarSpec): void {
    this.spec = spec;
    this.stop();
    this.setTexture(spec.key, spec.idle[this.facing][0]);
    this.fitBody();
    this.play(animKey(spec.key, this.moving ? 'walk' : 'idle', this.facing), true);
    this.followFeet();
  }

  // L'avatar voulu (sa clé), et la texture montrée maintenant : elles sont les mêmes une fois le personnage assemblé.
  get avatarWanted(): string {
    return this.skin.key;
  }

  get avatarShown(): string {
    return this.spec.key;
  }

  setDisplayedName(name: string): void {
    this.tag.setName(name);
  }

  setStatus(status: Status): void {
    this.tag.setStatus(status);
  }

  setActivity(activity: ActivityState | null): void {
    this.tag.setActivity(activity);
  }

  setSpeaking(speaking: boolean): void {
    this.tag.setSpeaking(speaking);
  }

  setZoom(zoom: number): void {
    this.tag.setZoom(zoom);
  }

  private fitBody(): void {
    const feet = feetBody(this.spec);
    const body = this.arcadeBody();
    body.setSize(feet.width, feet.height);
    body.setOffset(feet.offsetX, feet.offsetY);
  }

  private arcadeBody(): Physics.Arcade.Body {
    return this.body as Physics.Arcade.Body;
  }

  private followFeet(): void {
    this.setDepth(this.y);
    placeShadow(this.shadow, this.x, this.y);
    this.tag.placeAbove(this.x, this.y - this.spec.height);
  }
}
