import { AVATAR_BODY, CHARACTER_SHEET, DIRECTIONS, defaultAvatarKey, isAvatarKey, type Direction } from '@bureau/shared';
import type { Animations, Textures } from 'phaser';
import { composeAvatar, loadImage, SHEET_HEIGHT, SHEET_WIDTH, type ImageLoader } from './avatar-compose';

// Un avatar : sa planche (une texture, dont les images sont celles de CHARACTER_SHEET) et les images de ses animations, pour chacune des 4
// directions. Tous les avatars ont la même disposition : seule la clé de leur texture change.
export interface AvatarSpec {
  // La clé de la texture de la planche dans Phaser : celle de l'avatar (`p.07`, `c.3.2.5-1.12-4.0.6-2`), ou FALLBACK_KEY.
  key: string;
  frameWidth: number;
  frameHeight: number;
  // La hauteur du personnage au-dessus de ses pieds : l'étiquette se pose au-dessus (le haut de l'image est vide).
  height: number;
  // Les images (numéros de la planche, ligne après ligne) de l'avatar immobile et de l'avatar qui marche, par direction.
  idle: Record<Direction, number[]>;
  walk: Record<Direction, number[]>;
  idleFrameRate: number;
  walkFrameRate: number;
}

// Tant qu'un avatar n'est pas assemblé (ses pièces se chargent), une silhouette grise prend sa place : les animations sont les mêmes.
export const FALLBACK_KEY = 'avatar:loading';

// L'ordre des directions dans la planche : droite, haut, gauche, bas ; chacune a framesPerDirection images consécutives.
function framesOf(row: number, direction: Direction): number[] {
  const index = CHARACTER_SHEET.directions.indexOf(direction);
  const first = row * CHARACTER_SHEET.columns + index * CHARACTER_SHEET.framesPerDirection;
  return Array.from({ length: CHARACTER_SHEET.framesPerDirection }, (_, i) => first + i);
}

function perDirection<T>(valueOf: (dir: Direction) => T): Record<Direction, T> {
  return { up: valueOf('up'), down: valueOf('down'), left: valueOf('left'), right: valueOf('right') };
}

export function specOf(key: string): AvatarSpec {
  return {
    key,
    frameWidth: CHARACTER_SHEET.frameWidth,
    frameHeight: CHARACTER_SHEET.frameHeight,
    height: CHARACTER_SHEET.frameHeight - CHARACTER_SHEET.headTop,
    idle: perDirection((dir) => framesOf(0, dir)),
    walk: perDirection((dir) => framesOf(1, dir)),
    idleFrameRate: CHARACTER_SHEET.idleFrameRate,
    walkFrameRate: CHARACTER_SHEET.walkFrameRate,
  };
}

// Le nom des objets d'avatar dans la scène (local ou distant) : `player:<identifiant>`. Les tests de bout en bout comptent ainsi les
// avatars dessinés pour un joueur (window.__office.avatarsOf).
export const avatarObjectName = (id: string): string => `player:${id}`;

// La clé de l'animation d'un avatar : `p.07-walk-left`.
export function animKey(avatarKey: string, kind: 'idle' | 'walk', dir: Direction): string {
  return `${avatarKey}-${kind}-${dir}`;
}

// L'avatar à afficher pour cette personne : le sien s'il est valable (le serveur ne garde que des clés valables, mais un build plus ancien ou
// une ancienne clé `dev-red` peut en rester), sinon un personnage prêt à l'emploi qui ne dépend que d'elle.
export function resolveAvatarKey(id: string, avatarKey: string | null | undefined): string {
  return avatarKey != null && isAvatarKey(avatarKey) ? avatarKey : defaultAvatarKey(id);
}

// Crée les 8 animations de cet avatar (immobile et marche, dans les 4 directions), qui bouclent. Le gestionnaire d'animations est celui du
// jeu, partagé par les scènes : une animation déjà créée est laissée telle quelle.
export function createAvatarAnimations(anims: Animations.AnimationManager, spec: AvatarSpec): void {
  for (const kind of ['idle', 'walk'] as const) {
    for (const dir of DIRECTIONS) {
      const key = animKey(spec.key, kind, dir);
      if (anims.exists(key)) continue;
      const frames = anims.generateFrameNumbers(spec.key, { frames: spec[kind][dir] });
      anims.create({ key, frames, frameRate: kind === 'idle' ? spec.idleFrameRate : spec.walkFrameRate, repeat: -1 });
    }
  }
}

// Les avatars du jeu : ils s'assemblent (avatar-compose.ts) à la demande, la première fois qu'on en a besoin, et deviennent des textures du jeu,
// avec leurs animations. Une même instance sert toutes les scènes (elle est dans le registre du jeu).
export class AvatarLibrary {
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly failed = new Set<string>();

  constructor(
    private readonly textures: Textures.TextureManager,
    private readonly anims: Animations.AnimationManager,
    private readonly load: ImageLoader = loadImage,
    private readonly makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
  ) {
    this.addFallback();
  }

  has(key: string): boolean {
    return this.textures.exists(key);
  }

  // La clé de texture à dessiner pour cet avatar maintenant : le sien s'il est prêt, la silhouette sinon.
  textureFor(key: string): string {
    return this.has(key) ? key : FALLBACK_KEY;
  }

  specFor(key: string): AvatarSpec {
    return specOf(this.textureFor(key));
  }

  // Assemble cet avatar si ce n'est pas déjà fait. Vrai quand il est prêt ; faux si ses pièces n'ont pu être chargées (une silhouette reste).
  ensure(key: string): Promise<boolean> {
    if (this.has(key)) return Promise.resolve(true);
    let found = this.pending.get(key);
    if (!found) {
      found = this.assemble(key).finally(() => this.pending.delete(key));
      this.pending.set(key, found);
    }
    return found;
  }

  // Tous ceux-là, sans attendre au-delà de `timeoutMs` : l'écran de chargement ne reste pas bloqué par une pièce qui ne vient pas.
  async ensureAll(keys: Iterable<string>, timeoutMs = 4000): Promise<void> {
    const all = Promise.all([...new Set(keys)].map((key) => this.ensure(key)));
    await Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  private async assemble(key: string): Promise<boolean> {
    if (this.failed.has(key)) return false;
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await composeAvatar(key, this.load, this.makeCanvas);
    } catch {
      canvas = null;
    }
    if (!canvas) {
      this.failed.add(key);
      return false;
    }
    if (!this.has(key)) {
      const texture = this.textures.addCanvas(key, canvas);
      if (!texture) return false;
      this.addFrames(texture);
      createAvatarAnimations(this.anims, specOf(key));
    }
    return true;
  }

  private addFrames(texture: Textures.Texture): void {
    const { frameWidth, frameHeight, columns, rows } = CHARACTER_SHEET;
    for (let index = 0; index < columns * rows; index++) {
      texture.add(index, 0, (index % columns) * frameWidth, Math.floor(index / columns) * frameHeight, frameWidth, frameHeight);
    }
  }

  // La silhouette : le même personnage grisé (une tête, un corps, des pieds) dans chacune des images de la planche.
  private addFallback(): void {
    if (this.has(FALLBACK_KEY)) return;
    const canvas = this.makeCanvas();
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_HEIGHT;
    const context = canvas.getContext('2d');
    if (context) {
      const { frameWidth, frameHeight, columns, rows } = CHARACTER_SHEET;
      context.fillStyle = 'rgba(190, 196, 214, 0.75)';
      for (let index = 0; index < columns * rows; index++) {
        const x = (index % columns) * frameWidth;
        const y = Math.floor(index / columns) * frameHeight;
        context.fillRect(x + 11, y + 22, 10, 9);   // la tête
        context.fillRect(x + 9, y + 31, 14, 18);   // le buste
        context.fillRect(x + 11, y + 49, 4, 13);   // les jambes
        context.fillRect(x + 17, y + 49, 4, 13);
      }
    }
    const texture = this.textures.addCanvas(FALLBACK_KEY, canvas);
    if (texture) this.addFrames(texture);
    createAvatarAnimations(this.anims, specOf(FALLBACK_KEY));
  }
}

// La zone de collision de l'avatar, aux pieds : 20 × 12 px. Le reste du personnage (la tête, le corps) passe devant les murs et les
// meubles ; seuls les pieds butent.
// Ses dimensions sont celles du paquet partagé (AVATAR_BODY), que l'extrapolation des autres avatars applique aussi.
//
// Le bas de la zone dépasse d'un pixel sous les pieds (le bas de l'image, où est l'origine du sprite). Arrêtés contre un obstacle
// au sud, le bas de la zone touche son bord : y = 480, par exemple, pour le mur de la dernière ligne. Les pieds sont alors en
// y = 479, dans leur case. Sans ce pixel, ils seraient en y = 480 : le serveur, qui place des pieds dans la case floor(y / 32),
// les verrait déjà dans le mur et refuserait la position.
const { width: BODY_WIDTH, height: BODY_HEIGHT, belowFeet: BODY_BELOW_FEET } = AVATAR_BODY;

// La zone de collision d'un avatar dont l'image est de cette taille, et son décalage dans l'image (celui de Body.setOffset).
export function feetBody({ frameWidth, frameHeight }: Pick<AvatarSpec, 'frameWidth' | 'frameHeight'>): {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
} {
  return {
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
    offsetX: (frameWidth - BODY_WIDTH) / 2,
    offsetY: frameHeight + BODY_BELOW_FEET - BODY_HEIGHT,
  };
}
