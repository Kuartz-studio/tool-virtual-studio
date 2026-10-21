import type { TiledMapJson } from '@bureau/shared';
import { Scale, Scene, Scenes } from 'phaser';
import { fr } from '../../i18n/fr';
import { resolveAvatarKey } from '../avatars';
import { decorAtlasImages, decorAtlasesLoaded, registerDecorFrames } from '../decor-textures';
import { tilesetImages } from '../map-layers';
import { avatarLibraryOf } from '../objects/avatar-skin';
import { useOfficeStore } from '../../state/office-store';

// Largeur de la barre de chargement, et marge entre son contour et sa partie pleine.
const BAR_WIDTH = 468;
const BAR_PADDING = 4;

// Le message d'échec : rose clair, pour qu'on ne le prenne pas pour la barre de chargement, blanche.
const MESSAGE_STYLE = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: '16px',
  color: '#ffb4b4',
  align: 'center',
  wordWrap: { width: BAR_WIDTH },
};

// Charge la carte, puis les images de ses tilesets et les atlas de la banque d'éléments, avec une barre de progression. Assemble les
// personnages de ceux qui sont là (soi-même et les autres : ils apparaissent tout de suite avec leur apparence, pas en silhouette), puis
// lance le bureau.
export class Preloader extends Scene {
  private readonly mapUrl: string;
  private bar: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly mapKey: string) {
    super('Preloader');
    this.mapUrl = `/assets/maps/${mapKey}.json`;
  }

  init() {
    // L'origine du monde est le centre du canevas, et le reste quand le canevas change de taille : tout se dessine autour de (0, 0).
    const centerOrigin = (width: number, height: number) => this.cameras.main.setScroll(-width / 2, -height / 2);
    centerOrigin(this.scale.width, this.scale.height);
    const onResize = (size: Phaser.Structs.Size) => centerOrigin(size.width, size.height);
    this.scale.on(Scale.Events.RESIZE, onResize);
    this.events.once(Scenes.Events.SHUTDOWN, () => this.scale.off(Scale.Events.RESIZE, onResize));

    // Le contour de la barre, puis la partie pleine, qui s'allonge avec la progression du chargement.
    const outline = this.add.rectangle(0, 0, BAR_WIDTH, 32).setStrokeStyle(1, 0xffffff);
    const inner = BAR_WIDTH - 2 * BAR_PADDING;
    const fill = this.add.rectangle(-inner / 2, 0, 0, 28, 0xffffff).setOrigin(0, 0.5);
    this.bar = [outline, fill];
    this.load.on('progress', (progress: number) => {
      fill.width = inner * progress;
    });
  }

  preload() {
    this.load.tilemapTiledJSON(this.mapKey, this.mapUrl);
    // Les images des tilesets sont citées par la carte : on ne les connaît qu'une fois son JSON lu.
    this.load.once(`filecomplete-tilemapJSON-${this.mapKey}`, (_key: string, _type: string, json: TiledMapJson) => {
      for (const { key, url } of tilesetImages(json, this.mapUrl)) this.load.image(key, url);
    });
    // Les éléments de la banque (meubles, objets, déco) : ceux de la carte, et ceux que les bureaux montrent.
    for (const { key, url } of decorAtlasImages()) this.load.image(key, url);
  }

  create() {
    if (!this.mapLoaded() || !decorAtlasesLoaded(this.textures)) {
      // Sans la carte, l'une de ses images ou l'un des atlas (fichier absent, réseau coupé, JSON illisible), le bureau ne s'afficherait pas,
      // ou qu'à moitié : on le dit au lieu de laisser un écran vide.
      this.bar.forEach((part) => part.destroy());
      this.add.text(0, 0, fr.office.mapLoadFailed, MESSAGE_STYLE).setOrigin(0.5);
      return;
    }
    registerDecorFrames(this.textures);
    // Ceux qui sont là au moment d'entrer : on attend (au plus quelques secondes) que leurs personnages soient assemblés.
    const { self, players } = useOfficeStore.getState();
    const keys = [self, ...Object.values(players)].filter((p) => p != null).map((p) => resolveAvatarKey(p.id, p.avatarKey));
    void avatarLibraryOf(this)
      .ensureAll(keys)
      .then(() => {
        if (this.scene.isActive()) this.scene.start('Office');
      });
  }

  // La carte et toutes les images de ses tilesets sont chargées. Le chargeur laisse de côté un fichier qui échoue : c'est ce qui
  // manque, et non un événement d'erreur, qui le dit.
  private mapLoaded(): boolean {
    const cached = this.cache.tilemap.get(this.mapKey) as { data: TiledMapJson } | undefined;
    return cached !== undefined && tilesetImages(cached.data, this.mapUrl).every(({ key }) => this.textures.exists(key));
  }
}
