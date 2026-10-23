import { ARENA_WEAPONS, ARENA_WEAPON_IDS, insideRing, type ArenaWeaponId, type Direction, type Point } from '@bureau/shared';
import type { Logger } from 'pino';
import type { ArenaController } from '../arena/arena-controller';
import type { World } from '../realtime/world';
import { SimError, type SimBots } from './bots';

// Le rythme auquel le sparring réfléchit : assez vite pour suivre son adversaire, sans refaire son chemin à chaque pas.
const THINK_MS = 120;
// Sa vitesse de marche (px/s) : plus vif que les autres personnes fictives, moins que quelqu'un qui marche (320 px/s).
const SPARRING_SPEED_PX_PER_S = 190;
// Archer, il garde au moins cette distance (px) entre lui et son adversaire, et tire quand il est aligné avec lui (à cette tolérance près).
const ARCHER_DISTANCE_PX = 130;
const ALIGNED_PX = 12;

const directionOf = (dx: number, dy: number): Direction => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');

export interface SparringDeps {
  bots: SimBots;
  arena: Pick<ArenaController, 'run' | 'state' | 'ring' | 'freeBenchSpot'>;
  world: Pick<World, 'get' | 'list'>;
  now: () => number;
  logger: Logger;
  /** Le hasard (entre 0 et 1) : Math.random par défaut ; les tests le fixent. */
  random?: () => number;
}

// Le sparring de l'octogone (faux live seulement, SIM=1) : une personne fictive qui prend un coin libre, choisit une arme au hasard et se bat pour de
// vrai, par les mêmes commandes qu'un client (ArenaController.run) : le serveur vérifie ses attaques comme celles de n'importe qui. À l'arme de mêlée,
// il marche vers son adversaire, se tourne vers lui et frappe, un peu moins vite que son arme ne le permet ; à l'arc, il garde ses distances, s'aligne
// avec lui (même rangée ou même colonne) et tire. Assez pour s'entraîner, pas assez pour gagner souvent.
export class Sparring {
  private readonly ids = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  // Par sparring : l'heure de sa prochaine attaque, et celle où il refait son chemin.
  private readonly plans = new Map<string, { strikeAt: number; pathAt: number }>();
  private readonly random: () => number;

  constructor(private readonly d: SparringDeps) {
    this.random = d.random ?? Math.random;
  }

  start(): void {
    this.timer = setInterval(() => {
      try {
        this.think();
      } catch (err) {
        this.d.logger.error({ err }, 'Sparring de l\'octogone : tour impossible');
      }
    }, THINK_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // Un sparring de plus : il apparaît à une place libre du public, au bord de la cage (le serveur le pose dans le ring au Start), et prend un coin. Refusé si les deux coins sont pris (`full`) ou si
  // la carte n'a pas d'octogone (`no_arena`).
  async add(): Promise<{ id: string; name: string }> {
    const ring = this.d.arena.ring;
    if (!ring) throw new SparringError('no_arena');
    const state = this.d.arena.state();
    if (state.fighters.length >= 2) throw new SparringError('full');
    if (state.phase === 'countdown' || state.phase === 'fight') throw new SparringError('busy');
    const n = this.ids.size + 1;
    const spot = this.d.arena.freeBenchSpot();
    if (!spot) throw new SparringError('full');
    const bot = await this.d.bots.spawn({ name: n === 1 ? 'Sparring' : `Sparring ${n}`, at: spot, speed: SPARRING_SPEED_PX_PER_S });
    const joined = this.d.arena.run(bot.id, { type: 'join', role: 'fighter' });
    if (!joined.ok) {
      this.d.bots.remove(bot.id);
      throw new SparringError(joined.error === 'full' ? 'full' : 'busy');
    }
    const weapon = ARENA_WEAPON_IDS[Math.floor(this.random() * ARENA_WEAPON_IDS.length)]!;
    this.d.arena.run(bot.id, { type: 'weapon', weapon });
    this.ids.add(bot.id);
    return { id: bot.id, name: bot.name };
  }

  private think(): void {
    const state = this.d.arena.state();
    const at = this.d.now();
    for (const id of [...this.ids]) {
      // Retiré (le panneau du bac à sable) : il n'est plus au monde, l'octogone l'a déjà oublié.
      if (!this.d.world.get(id)) {
        this.ids.delete(id);
        this.plans.delete(id);
        continue;
      }
      const me = state.fighters.find((f) => f.id === id);
      if (state.phase !== 'fight' || !me) {
        this.plans.delete(id);
        continue;
      }
      const foe = state.fighters.find((f) => f.id !== id);
      const self = this.d.world.get(id);
      const them = foe ? this.d.world.get(foe.id) : undefined;
      if (!self || !them) continue;
      const plan = this.plans.get(id) ?? { strikeAt: at + 700, pathAt: 0 };
      this.plans.set(id, plan);
      if (me.weapon) this.fight(id, me.weapon, self, them, plan, at);
    }
  }

  private fight(id: string, weapon: ArenaWeaponId, self: Point, them: Point, plan: { strikeAt: number; pathAt: number }, at: number): void {
    const spec = ARENA_WEAPONS[weapon];
    const dx = them.x - self.x;
    const dy = them.y - self.y;
    const distance = Math.hypot(dx, dy);
    const walk = (to: Point) => {
      if (at < plan.pathAt) return;
      plan.pathAt = at + 300;
      try {
        this.d.bots.moveTo(id, to.x, to.y);
      } catch (err) {
        if (!(err instanceof SimError)) throw err;
      }
    };

    if (spec.style === 'shoot') {
      const ring = this.d.arena.ring;
      // Trop près : il recule, à l'opposé de son adversaire (sans sortir du ring).
      if (distance < ARCHER_DISTANCE_PX && ring) {
        const away = { x: self.x - Math.sign(dx || 1) * 80, y: self.y };
        if (insideRing(ring, away.x, away.y, 16)) {
          walk(away);
          return;
        }
      }
      // Pas aligné : il se met sur la même rangée (ou la même colonne, si c'est plus court).
      if (Math.abs(dx) > ALIGNED_PX && Math.abs(dy) > ALIGNED_PX) {
        walk(Math.abs(dy) < Math.abs(dx) ? { x: self.x, y: them.y } : { x: them.x, y: self.y });
        return;
      }
    } else if (distance > spec.rangePx * 0.75) {
      // À l'arme de mêlée : il marche vers son adversaire, en refaisant son chemin quand celui-ci a bougé.
      walk({ x: them.x - Math.sign(dx) * spec.rangePx * 0.5, y: them.y });
      return;
    }

    // En position : il s'arrête face à lui, et attaque quand son arme est prête.
    const dir = directionOf(dx, dy);
    this.d.bots.stopFacing(id, dir);
    if (at < plan.strikeAt) return;
    this.d.arena.run(id, { type: 'attack', dir });
    plan.strikeAt = at + spec.cooldownMs + 250 + this.random() * 500;
  }
}

export type SparringErrorCode = 'no_arena' | 'full' | 'busy';

export class SparringError extends Error {
  constructor(readonly code: SparringErrorCode) {
    super(code);
    this.name = 'SparringError';
  }
}
