import { ARENA_MAX_HP, ARENA_WEAPONS, arrowStep, headingOf, ringPoints, type ArenaAction, type ArenaArrow, type ArenaState, type ArenaWeaponId, type Direction, type Rect } from '@bureau/shared';
import type { GameObjects, Math as PhaserMath, Scene } from 'phaser';
import { avatarObjectName } from './avatars';
import { DEPTH } from './map-layers';

// L'octogone, dessiné en code (aucun fichier à charger) : le tapis de toile au sol, avec son liseré et le logo au centre, les coins rouge et bleu, puis la
// cage, huit pans de grillage noir tendus entre des poteaux matelassés. Chaque pan est à la profondeur de son bord le plus bas : ceux du nord passent
// derrière les combattants, celui du sud devant eux (on les voit à travers le grillage).
//
// Par-dessus, ce que l'état de l'octogone (le magasin) et ses attaques (`arena:action`) racontent : l'arme de chaque combattant, dans sa main, tournée
// vers où il regarde (une icône de la planche des armes), sa barre de vie au-dessus de son nom (la part perdue s'efface en traînant), le compte à rebours
// et « COMBAT ! » au milieu du ring, chaque attaque (l'arme qui balaie, frappe d'estoc ou s'abat ; la flèche qui vole), son impact (une étoile, les dégâts
// qui montent, l'avatar qui rougit), et « K.O. » puis le nom du vainqueur.

// La clé de la planche des armes (le Preloader la charge).
export const WEAPONS_TEXTURE = 'weapons';
// La taille d'une arme en main, par rapport à son icône de 32 px.
const WEAPON_SCALE = 1;
// Les icônes ont la lame vers le haut à droite (-45°) : l'angle à leur ajouter pour qu'elles pointent dans une direction.
const POINT: Readonly<Record<Direction, number>> = { right: Math.PI / 4, down: (3 * Math.PI) / 4, left: (-3 * Math.PI) / 4, up: -Math.PI / 4 };
// Où l'arme est tenue, par rapport aux pieds, selon la direction regardée.
const HAND: Readonly<Record<Direction, { x: number; y: number }>> = { right: { x: 11, y: -22 }, left: { x: -11, y: -22 }, down: { x: 9, y: -18 }, up: { x: -9, y: -30 } };

const MAT = 0xd8d2c4;
const MAT_EDGE = 0x22242b;
const LOGO = 0xc8102e;
const RED_CORNER = 0xc8102e;
const BLUE_CORNER = 0x1f5fbf;
const FENCE = 0x15161a;
const PAD = 0x2a2c33;
const PAD_TOP = 0xc8102e;

// La hauteur de la cage au-dessus du tapis, en pixels.
const FENCE_HEIGHT = 26;
// La barre de vie : sa taille, et son écart au-dessus de la tête (au-dessus du nom).
const BAR = { width: 46, height: 6, aboveHead: 30 } as const;

const TEXT_DEPTH = DEPTH.nameTags + 1;

interface Bar {
  frame: GameObjects.Graphics;
  // La part de vie affichée, et celle qui traîne derrière (le blanc qui s'efface après un coup), entre 0 et 1.
  shown: number;
  trail: number;
}

// Les sommets d'un polygone, tels que Graphics.fillPoints les veut (il ne lit que x et y).
const asPoints = (points: ReadonlyArray<{ x: number; y: number }>) => points as unknown as PhaserMath.Vector2[];

// Une arme en main : son image, l'arme qu'elle montre, et jusqu'à quand une attaque l'anime (elle ne suit plus la main tant que l'animation dure).
interface Held {
  image: GameObjects.Image;
  weapon: ArenaWeaponId;
  busyUntil: number;
}

// Une flèche que l'on voit voler : son image, et ce qu'il lui reste à parcourir (le serveur dit où elle touche ; sinon, elle finit sa course).
interface Flying {
  image: GameObjects.Graphics;
  arrow: ArenaArrow & { traveled: number };
}

export class ArenaLayer {
  private readonly drawn: GameObjects.GameObject[] = [];
  private readonly bars = new Map<string, Bar>();
  private readonly held = new Map<string, Held>();
  private readonly arrows = new Map<string, Flying>();
  private state: ArenaState | null = null;
  private countdownEndsAt = 0;
  private readonly banner: GameObjects.Text;
  private bannerKey = '';
  // Le combat vient de commencer : « COMBAT ! » reste affiché jusqu'à cette heure (ms, horloge de la page).
  private fightShownUntil = 0;

  constructor(
    private readonly scene: Scene,
    private readonly ring: Rect,
  ) {
    this.drawMat();
    this.drawCage();
    this.banner = scene.add
      .text(ring.x + ring.width / 2, ring.y + ring.height / 2 - 6, '', {
        fontFamily: 'monospace',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#15161a',
        strokeThickness: 6,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(TEXT_DEPTH)
      .setResolution(2)
      .setVisible(false);
  }

  // ---- Le décor -------------------------------------------------------------------------------------------------------------------------------

  private drawMat(): void {
    const { scene, ring } = this;
    const points = ringPoints(ring);
    const g = scene.add.graphics().setDepth(DEPTH.meublesBas + 0.2);
    // Le tapis, et son liseré sombre (là où la toile rejoint la cage).
    g.fillStyle(MAT_EDGE, 1).fillPoints(asPoints(points), true);
    const inner = ringPoints({ x: ring.x + 6, y: ring.y + 6, width: ring.width - 12, height: ring.height - 12 });
    g.fillStyle(MAT, 1).fillPoints(asPoints(inner), true);
    // Une trame légère dans la toile.
    g.lineStyle(1, 0x000000, 0.05);
    for (let x = ring.x + 16; x < ring.x + ring.width; x += 16) g.lineBetween(x, ring.y + 8, x, ring.y + ring.height - 8);
    // Le logo : un cercle rouge au centre, et le nom de la salle dedans.
    const cx = ring.x + ring.width / 2;
    const cy = ring.y + ring.height / 2;
    g.lineStyle(3, LOGO, 0.85).strokeCircle(cx, cy, 34);
    g.fillStyle(LOGO, 0.12).fillCircle(cx, cy, 34);
    // Les coins des deux combattants : un carré rouge à l'ouest, bleu à l'est, là où ils commencent.
    g.fillStyle(RED_CORNER, 0.55).fillRect(ring.x + 8, ring.y + ring.height / 2 - 10, 10, 20);
    g.fillStyle(BLUE_CORNER, 0.55).fillRect(ring.x + ring.width - 18, ring.y + ring.height / 2 - 10, 10, 20);
    const logo = scene.add
      .text(cx, cy, 'OCTOGONE', { fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#c8102e' })
      .setOrigin(0.5)
      .setAlpha(0.7)
      .setDepth(DEPTH.meublesBas + 0.25)
      .setResolution(2);
    this.drawn.push(g, logo);
  }

  // Les huit pans de grillage, chacun avec ses deux poteaux.
  private drawCage(): void {
    const points = ringPoints(this.ring);
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const front = Math.max(a.y, b.y);
      const g = this.scene.add.graphics().setDepth(front);
      // Le grillage : un voile sombre et ses mailles en losange. Celui du sud est plus clair : on regarde le combat à travers.
      const south = a.y === b.y && a.y > this.ring.y;
      const alpha = south ? 0.18 : 0.32;
      g.fillStyle(FENCE, alpha);
      g.fillPoints(asPoints([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.x, y: b.y - FENCE_HEIGHT }, { x: a.x, y: a.y - FENCE_HEIGHT }]), true);
      g.lineStyle(1, FENCE, south ? 0.35 : 0.55);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.round(length / 8));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        g.lineBetween(x, y, x + 4, y - FENCE_HEIGHT);
        g.lineBetween(x + 4, y, x, y - FENCE_HEIGHT);
      }
      // La lisse du haut, et celle du bas.
      g.lineStyle(2, FENCE, 0.9).lineBetween(a.x, a.y - FENCE_HEIGHT, b.x, b.y - FENCE_HEIGHT);
      g.lineStyle(2, FENCE, 0.6).lineBetween(a.x, a.y, b.x, b.y);
      // Le poteau du début du pan, matelassé, avec son embout rouge.
      g.fillStyle(PAD, 1).fillRect(a.x - 3, a.y - FENCE_HEIGHT - 4, 6, FENCE_HEIGHT + 4);
      g.fillStyle(PAD_TOP, 1).fillRect(a.x - 3, a.y - FENCE_HEIGHT - 6, 6, 5);
      this.drawn.push(g);
    }
  }

  // ---- L'état -----------------------------------------------------------------------------------------------------------------------------------

  // L'octogone a changé (le magasin) : les barres de vie et les armes suivent les combattants, et le bandeau la phase.
  setState(state: ArenaState, countdownEndsAt: number, now: number): void {
    const previous = this.state;
    this.state = state;
    this.countdownEndsAt = countdownEndsAt;
    if (state.phase === 'fight' && previous?.phase === 'countdown') this.fightShownUntil = now + 900;
    if (state.phase !== 'fight') this.clearArrows();
    const ids = new Set(state.fighters.map((f) => f.id));
    for (const [id, bar] of this.bars) {
      if (ids.has(id)) continue;
      bar.frame.destroy();
      this.bars.delete(id);
    }
    for (const [id, held] of this.held) {
      if (state.fighters.some((f) => f.id === id && f.weapon === held.weapon)) continue;
      held.image.destroy();
      this.held.delete(id);
    }
    for (const fighter of state.fighters) {
      if (!this.bars.has(fighter.id)) {
        const part = fighter.hp / ARENA_MAX_HP;
        this.bars.set(fighter.id, { frame: this.scene.add.graphics().setDepth(TEXT_DEPTH), shown: part, trail: part });
      }
      if (fighter.weapon && !this.held.has(fighter.id)) {
        const image = this.scene.add.image(0, 0, WEAPONS_TEXTURE, ARENA_WEAPONS[fighter.weapon].frame).setScale(WEAPON_SCALE);
        this.held.set(fighter.id, { image, weapon: fighter.weapon, busyUntil: 0 });
      }
    }
  }

  // À chaque image : les armes dans les mains, les barres au-dessus des combattants, les flèches en vol, le bandeau du milieu.
  tick(now: number, delta: number): void {
    const state = this.state;
    if (!state) return;
    state.fighters.forEach((fighter, index) => {
      const bar = this.bars.get(fighter.id);
      const avatar = this.avatar(fighter.id);
      const held = this.held.get(fighter.id);
      if (!avatar || !avatar.visible) {
        bar?.frame.setVisible(false);
        held?.image.setVisible(false);
        return;
      }
      if (held && now >= held.busyUntil) this.holdWeapon(held, avatar, this.facingOf(avatar));
      if (!bar) return;
      const part = Math.max(0, fighter.hp / ARENA_MAX_HP);
      bar.shown = part;
      bar.trail = bar.trail > part ? Math.max(part, bar.trail - delta / 900) : part;
      this.drawBar(bar, avatar.x, avatar.y - avatar.displayHeight - BAR.aboveHead, index === 0 ? RED_CORNER : BLUE_CORNER);
    });
    this.flyArrows(delta);
    this.showBanner(state, now);
  }

  // L'arme dans la main de l'avatar, pointée vers où il regarde ; derrière lui quand il nous tourne le dos.
  private holdWeapon(held: Held, avatar: GameObjects.Sprite, dir: Direction): void {
    const hand = HAND[dir];
    const bow = ARENA_WEAPONS[held.weapon].style === 'shoot';
    held.image
      .setVisible(true)
      .setPosition(avatar.x + hand.x, avatar.y + hand.y)
      // Un arc se tient droit, la corde vers soi ; une arme pointe vers l'avant, un peu relevée.
      .setRotation(bow ? POINT[dir] - Math.PI / 4 : POINT[dir] - (dir === 'left' ? -0.5 : 0.5))
      .setDepth(dir === 'up' ? avatar.depth - 0.1 : avatar.depth + 0.1);
  }

  // Vers où regarde un avatar : le nom de son animation finit par sa direction (`…:walk:left`).
  private facingOf(avatar: GameObjects.Sprite): Direction {
    const key = avatar.anims?.currentAnim?.key ?? '';
    const match = /(up|down|left|right)$/.exec(key);
    return (match?.[1] as Direction | undefined) ?? 'down';
  }

  // `corner` : la couleur de son coin (rouge pour le premier combattant, bleu pour le second), en liseré autour de la barre.
  private drawBar(bar: Bar, cx: number, top: number, corner: number): void {
    const g = bar.frame.clear().setVisible(true);
    const x = Math.round(cx - BAR.width / 2);
    const y = Math.round(top);
    g.fillStyle(corner, 1).fillRect(x - 2, y - 2, BAR.width + 4, BAR.height + 4);
    g.fillStyle(0x15161a, 0.9).fillRect(x - 1, y - 1, BAR.width + 2, BAR.height + 2);
    g.fillStyle(0xffffff, 0.85).fillRect(x, y, Math.round(BAR.width * bar.trail), BAR.height);
    const color = bar.shown > 0.5 ? 0x3ccf6b : bar.shown > 0.25 ? 0xf2c230 : 0xe5383b;
    g.fillStyle(color, 1).fillRect(x, y, Math.round(BAR.width * bar.shown), BAR.height);
    g.fillStyle(0xffffff, 0.35).fillRect(x, y, Math.round(BAR.width * bar.shown), 2);
  }

  private showBanner(state: ArenaState, now: number): void {
    let text = '';
    let color = '#ffffff';
    if (state.phase === 'countdown') {
      text = String(Math.max(1, Math.ceil((this.countdownEndsAt - now) / 1000)));
    } else if (state.phase === 'fight' && now < this.fightShownUntil) {
      text = 'COMBAT !';
      color = '#f2c230';
    } else if (state.phase === 'over') {
      const winner = state.fighters.find((f) => f.id === state.winnerId);
      text = winner ? `K.O. !\n${winner.name} gagne` : 'Combat annulé';
      color = '#ff5a5f';
    }
    if (text !== this.bannerKey) {
      this.bannerKey = text;
      this.banner.setText(text).setColor(color).setVisible(text !== '');
      if (text !== '') {
        this.scene.tweens.killTweensOf(this.banner);
        this.banner.setScale(1.6).setAlpha(0);
        this.scene.tweens.add({ targets: this.banner, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
      }
    }
  }

  // ---- Les attaques -----------------------------------------------------------------------------------------------------------------------------

  // Une attaque : l'arme s'anime dans la main de celui qui attaque, une flèche part de l'arc ; si elle touche, une étoile sur l'autre, les dégâts qui
  // montent et l'avatar qui rougit. L'écran tremble un peu quand on frappe ou qu'on est touché soi-même, plus fort au K.O.
  play(action: ArenaAction, selfId: string, now: number): void {
    const attacker = this.avatar(action.id);
    if (action.arrow) this.shoot(action.arrow);
    if (attacker && action.arrowId === undefined) this.animate(action, attacker, now);
    if (action.arrowId !== undefined) this.dropArrow(action.arrowId);
    if (!action.hit) return;
    const target = this.avatar(action.hit.target);
    if (!target) return;
    const heavy = ARENA_WEAPONS[action.weapon].damage >= 17;
    this.impact(target, action.hit.damage, heavy);
    if (action.hit.ko) this.scene.cameras.main.shake(260, 0.006);
    else if (action.id === selfId || action.hit.target === selfId) this.scene.cameras.main.shake(110, heavy ? 0.004 : 0.0025);
  }

  // L'arme en main s'anime selon son style : elle balaie un arc de cercle devant soi, frappe d'estoc (la lance), s'abat de haut en bas (le marteau), ou
  // recule d'un coup sec quand l'arc tire.
  private animate(action: ArenaAction, attacker: GameObjects.Sprite, now: number): void {
    const held = this.held.get(action.id);
    if (!held) return;
    const spec = ARENA_WEAPONS[action.weapon];
    const dir = action.dir;
    this.holdWeapon(held, attacker, dir);
    const image = held.image;
    const h = headingOf(dir);
    const duration = Math.min(220, Math.max(110, spec.cooldownMs * 0.45));
    held.busyUntil = now + duration;
    this.scene.tweens.killTweensOf(image);
    const base = POINT[dir];
    // La main tourne dans le sens qui balaie vers l'avant : l'arc va du haut vers le bas de la direction regardée.
    const sweep = dir === 'left' ? -1 : 1;
    if (spec.style === 'slash') {
      image.setRotation(base - sweep * 1.3);
      this.scene.tweens.add({ targets: image, rotation: base + sweep * 1.1, duration, ease: 'Cubic.easeOut' });
      this.trail(attacker, dir, spec.rangePx * 0.55, 0xffffff);
    } else if (spec.style === 'smash') {
      image.setRotation(base - sweep * 2).setScale(WEAPON_SCALE * 1.15);
      this.scene.tweens.add({ targets: image, rotation: base + sweep * 0.6, scale: WEAPON_SCALE, duration, ease: 'Quad.easeIn' });
      this.trail(attacker, dir, spec.rangePx * 0.5, 0xffd27a);
    } else if (spec.style === 'thrust') {
      image.setRotation(base);
      this.scene.tweens.add({ targets: image, x: image.x + h.x * 22, y: image.y + h.y * 22, duration: duration / 2, yoyo: true, ease: 'Quad.easeOut' });
    } else {
      this.scene.tweens.add({ targets: image, x: image.x - h.x * 5, y: image.y - h.y * 5, duration: 70, yoyo: true });
    }
  }

  // Le souffle d'une arme qui balaie : un arc de cercle blanc qui s'efface devant soi.
  private trail(attacker: GameObjects.Sprite, dir: Direction, reach: number, color: number): void {
    const h = headingOf(dir);
    const g = this.scene.add.graphics().setDepth(attacker.depth + 0.5);
    const x = attacker.x + h.x * reach * 0.6;
    const y = attacker.y - 22 + h.y * reach * 0.4;
    const angle = Math.atan2(h.y, h.x);
    g.lineStyle(3, color, 0.85);
    g.beginPath();
    g.arc(x, y, Math.max(12, reach * 0.45), angle - 1, angle + 1);
    g.strokePath();
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
  }

  // Une flèche part : un trait de bois, sa pointe et son empennage, qui vole tout droit à hauteur de poitrine.
  private shoot(arrow: ArenaArrow): void {
    const g = this.scene.add.graphics();
    const h = headingOf(arrow.dir);
    const length = 18;
    const tip = { x: h.x * length / 2, y: h.y * length / 2 };
    const tail = { x: -tip.x, y: -tip.y };
    const side = { x: -h.y, y: h.x };
    g.lineStyle(2, 0x8a5a2b, 1).lineBetween(tail.x, tail.y, tip.x, tip.y);
    g.fillStyle(0xd9dde6, 1).fillTriangle(tip.x + h.x * 5, tip.y + h.y * 5, tip.x + side.x * 3, tip.y + side.y * 3, tip.x - side.x * 3, tip.y - side.y * 3);
    g.lineStyle(2, 0xe5383b, 1).lineBetween(tail.x, tail.y, tail.x - h.x * 3 + side.x * 3, tail.y - h.y * 3 + side.y * 3);
    g.lineBetween(tail.x, tail.y, tail.x - h.x * 3 - side.x * 3, tail.y - h.y * 3 - side.y * 3);
    // À la profondeur de ses pieds, comme un avatar : elle passe devant ou derrière les autres et la cage comme eux.
    g.setPosition(arrow.x, arrow.y - 24).setDepth(arrow.y + 1);
    this.arrows.set(arrow.id, { image: g, arrow: { ...arrow, traveled: 0 } });
  }

  // Les flèches avancent comme sur le serveur (arrowStep, sans cible : le serveur dit lui-même où elles touchent), et s'effacent au bout de leur course.
  private flyArrows(delta: number): void {
    for (const [id, flying] of this.arrows) {
      const step = arrowStep(flying.arrow, (flying.arrow.speedPx * delta) / 1000, null, this.ring);
      Object.assign(flying.arrow, { x: step.x, y: step.y, traveled: step.traveled });
      flying.image.setPosition(step.x, step.y - 24).setDepth(step.y + 1);
      if (step.done) this.dropArrow(id);
    }
  }

  private dropArrow(id: string): void {
    this.arrows.get(id)?.image.destroy();
    this.arrows.delete(id);
  }

  private clearArrows(): void {
    for (const id of [...this.arrows.keys()]) this.dropArrow(id);
  }

  private impact(target: GameObjects.Sprite, damage: number, heavy: boolean): void {
    const x = target.x;
    const y = target.y - target.displayHeight * 0.6;
    const star = this.scene.add.graphics().setDepth(TEXT_DEPTH - 0.5);
    const points: Array<{ x: number; y: number }> = [];
    const spikes = heavy ? 10 : 8;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? (heavy ? 20 : 15) : 6;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    star.fillStyle(0xffe14d, 1).fillPoints(asPoints(points), true);
    star.fillStyle(0xffffff, 1).fillCircle(0, 0, 4);
    star.setPosition(x, y).setScale(0.4);
    this.scene.tweens.add({ targets: star, scale: 1.1, alpha: 0, duration: 260, ease: 'Quad.easeOut', onComplete: () => star.destroy() });

    const label = this.scene.add
      .text(x + 10, y - 6, `-${damage}`, {
        fontFamily: 'monospace',
        fontSize: heavy ? '16px' : '13px',
        fontStyle: 'bold',
        color: '#ffef8a',
        stroke: '#15161a',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(TEXT_DEPTH)
      .setResolution(2);
    this.scene.tweens.add({ targets: label, y: y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });

    target.setTint(0xff5050);
    this.scene.time.delayedCall(90, () => target.active && target.clearTint());
  }

  // L'image de l'avatar de cette personne (soi, ou un autre), ses pieds en bas au milieu.
  private avatar(id: string): GameObjects.Sprite | null {
    return (this.scene.children.getByName(avatarObjectName(id)) as GameObjects.Sprite | null) ?? null;
  }

  destroy(): void {
    for (const object of this.drawn.splice(0)) object.destroy();
    for (const bar of this.bars.values()) bar.frame.destroy();
    this.bars.clear();
    for (const held of this.held.values()) held.image.destroy();
    this.held.clear();
    this.clearArrows();
    this.banner.destroy();
  }
}
