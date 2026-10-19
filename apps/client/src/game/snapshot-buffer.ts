import { MAX_SPEED_PX_PER_S, REMOTE_RENDER_DELAY_MS, TELEPORT_SNAP_PX, type Direction } from '@bureau/shared';

// Où était un autre joueur, à une heure donnée : ses pieds, en pixels de la carte, sa direction et s'il marchait.
export interface Snapshot {
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

interface Timed {
  at: number;
  s: Snapshot;
}

const copy = (s: Snapshot): Snapshot => ({ x: s.x, y: s.y, dir: s.dir, moving: s.moving });

// Un saut : la part du déplacement de `a` à `b` que la marche n'explique pas dépasse TELEPORT_SNAP_PX, soit
//
//   distance(a, b) > TELEPORT_SNAP_PX + MAX_SPEED_PX_PER_S × (b.at − a.at) / 1000
//
// (distance en ligne droite, en pixels ; b.at − a.at en ms). À la limite exacte, l'avatar glisse encore ; un pixel de plus, il saute.
// Entre deux ticks (100 ms), la marche fait 16 px : 112 px glissent, 113 px sautent (le test du brief : 100 px glissent, 200 px
// sautent ; TELEPORT_SNAP_PX seul, 96 px, ferait sauter les 100 px). push() ne crée jamais de segment plus long que
// REMOTE_RENDER_DELAY_MS : une longue attente n'élargit pas la limite (24 px de marche au plus à 150 ms).
function isJump(a: Timed, b: Timed): boolean {
  const walkable = (MAX_SPEED_PX_PER_S * (b.at - a.at)) / 1000;
  return Math.hypot(b.s.x - a.s.x, b.s.y - a.s.y) > TELEPORT_SNAP_PX + walkable;
}

// Les dernières positions reçues d'un autre joueur, datées à leur réception (horloge du client, en ms), et ce qu'il faut dessiner à
// une heure donnée. Les autres avatars sont dessinés avec REMOTE_RENDER_DELAY_MS de retard (renderAt = now − ce délai) : on a
// alors presque toujours une position reçue de chaque côté de l'heure de rendu, et l'avatar glisse de l'une à l'autre.
//
// - Entre deux instantanés, interpolation linéaire. La direction est celle du second (où il va), et il marche s'il marchait à
//   l'un ou à l'autre : on le voit marcher jusqu'au point où il s'est arrêté.
// - Avant le premier, le premier ; après le dernier, le dernier : pas d'extrapolation.
// - Un saut de plus de TELEPORT_SNAP_PX entre deux instantanés consécutifs (une téléportation, un retour au point d'apparition) ne
//   se fait pas en glissant : on passe directement au second. Le saut est ce que la marche n'explique pas (isJump).
// - Au plus `capacity` instantanés sont gardés, les plus récents : un onglet en arrière-plan pendant des heures, qui reçoit les
//   ticks sans rien dessiner, ne fait pas enfler la mémoire.
//
// Le serveur n'envoie une position que quand elle change. Un instantané qui arrive alors que l'heure de rendu a déjà dépassé le
// précédent (la personne était immobile, ou un tick n'avait rien pour elle) ne doit pas faire sauter l'avatar à mi-chemin : on le dessinait
// au précédent jusqu'ici. push() date donc une copie du précédent à l'heure de rendu de l'arrivée, et l'avatar glisse de là
// jusqu'au nouveau en REMOTE_RENDER_DELAY_MS.
export class SnapshotBuffer {
  private items: Timed[] = [];

  constructor(private readonly capacity: number = 20) {}

  push(at: number, s: Snapshot): void {
    const last = this.items.at(-1);
    // Le temps ne recule pas : un instantané daté d'avant le dernier est rangé à son heure.
    const when = last ? Math.max(at, last.at) : at;
    const renderAtArrival = when - REMOTE_RENDER_DELAY_MS;
    if (last && renderAtArrival > last.at) this.items.push({ at: renderAtArrival, s: copy(last.s) });
    this.items.push({ at: when, s: copy(s) });
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }

  sample(renderAt: number): Snapshot | null {
    const items = this.items;
    if (items.length === 0) return null;
    // Le dernier instantané daté de renderAt ou avant (à heure égale, le plus récent reçu), et celui qui le suit, strictement après.
    let i = items.length - 1;
    while (i >= 0 && items[i]!.at > renderAt) i--;
    if (i < 0) return copy(items[0]!.s);
    if (i === items.length - 1) return copy(items[i]!.s);
    const a = items[i]!;
    const b = items[i + 1]!;
    if (isJump(a, b)) return copy(b.s);
    const t = (renderAt - a.at) / (b.at - a.at);
    return {
      x: a.s.x + (b.s.x - a.s.x) * t,
      y: a.s.y + (b.s.y - a.s.y) * t,
      dir: b.s.dir,
      moving: a.s.moving || b.s.moving,
    };
  }

  // Ne garde que le dernier instantané : l'avatar y est tout de suite (retour sur l'onglet, après des heures sans dessin).
  snapToLatest(): void {
    if (this.items.length > 1) this.items = this.items.slice(-1);
  }

  size(): number {
    return this.items.length;
  }
}
