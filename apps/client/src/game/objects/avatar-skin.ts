import type { Scene } from 'phaser';
import { AvatarLibrary, resolveAvatarKey, specOf, type AvatarSpec } from '../avatars';

// Où les scènes trouvent les avatars du jeu : le Boot les crée dans le registre du jeu.
export const AVATARS_REGISTRY_KEY = 'avatars';

export function avatarLibraryOf(scene: Scene): AvatarLibrary {
  return scene.game.registry.get(AVATARS_REGISTRY_KEY) as AvatarLibrary;
}

// L'apparence d'un joueur : sa clé d'avatar, et la fiche (texture, animations) à dessiner maintenant. Un avatar s'assemble à la demande : tant
// que ses pièces se chargent, c'est la silhouette ; dès qu'il est prêt, `onChange` donne sa fiche, et le joueur la prend. Un changement de
// profil (le builder) passe par `set`.
export class AvatarSkin {
  private wanted: string;
  private shown: AvatarSpec;
  private destroyed = false;

  constructor(
    private readonly library: AvatarLibrary,
    private readonly playerId: string,
    avatarKey: string | null,
    private readonly onChange: (spec: AvatarSpec) => void,
  ) {
    this.wanted = resolveAvatarKey(playerId, avatarKey);
    this.shown = library.specFor(this.wanted);
    this.request();
  }

  get spec(): AvatarSpec {
    return this.shown;
  }

  // La clé de l'avatar voulu (pas forcément prêt).
  get key(): string {
    return this.wanted;
  }

  set(avatarKey: string | null): void {
    const wanted = resolveAvatarKey(this.playerId, avatarKey);
    if (wanted === this.wanted && this.shown.key === this.library.textureFor(wanted)) return;
    this.wanted = wanted;
    this.apply();
    this.request();
  }

  destroy(): void {
    this.destroyed = true;
  }

  private apply(): void {
    const spec = specOf(this.library.textureFor(this.wanted));
    if (spec.key === this.shown.key) return;
    this.shown = spec;
    this.onChange(spec);
  }

  private request(): void {
    const wanted = this.wanted;
    if (this.library.has(wanted)) return;
    void this.library.ensure(wanted).then((ready) => {
      if (ready && !this.destroyed && this.wanted === wanted) this.apply();
    });
  }
}
