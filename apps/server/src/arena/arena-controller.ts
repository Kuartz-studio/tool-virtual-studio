import { randomUUID } from 'node:crypto';
import {
  ARENA_COUNTDOWN_MS,
  ARENA_MAX_HP,
  ARENA_OVER_MS,
  ARENA_WEAPONS,
  EMPTY_ARENA,
  OFFICE_ROOM,
  insideRing,
  arrowStep,
  isWalkablePoint,
  placeAt,
  resolveMelee,
  ringStarts,
  type ArenaAck,
  type ArenaCommand,
  type ArenaPhase,
  type ArenaState,
  type ArenaWeaponId,
  type Direction,
  type OfficeMap,
  type Point,
} from '@bureau/shared';
import type { Logger } from 'pino';
import { logServerError } from '../logger';
import type { TypedServer } from '../realtime/io';
import type { World } from '../realtime/world';
import type { Teleport } from '../teleport';

// Toutes les ARENA_SWEEP_MS, ceux qui ont un rôle et ne sont plus dans la salle (sortis, partis) le perdent.
export const ARENA_SWEEP_MS = 400;
// La période du vol des flèches : assez courte pour qu'une flèche ne traverse pas quelqu'un entre deux pas.
export const ARROW_STEP_MS = 30;

export interface ArenaControllerDeps {
  io: TypedServer;
  world: Pick<World, 'get' | 'list' | 'addEntryGuard'>;
  map: OfficeMap;
  teleport: Teleport;
  /** L'horloge du temps réel (ms) : celle du monde, monotone. */
  now: () => number;
  /** La période du balayage : ARENA_SWEEP_MS par défaut. */
  sweepMs?: number;
  logger: Logger;
}

interface Fighter {
  id: string;
  hp: number;
  weapon: ArenaWeaponId | null;
  // L'heure (horloge `now`) avant laquelle son prochain coup est refusé.
  readyAt: number;
}

// Une flèche en vol : qui l'a tirée, où elle est, vers où, ce qu'elle a parcouru et jusqu'où elle va.
interface Arrow {
  id: string;
  owner: string;
  x: number;
  y: number;
  dir: Direction;
  traveled: number;
  rangePx: number;
  speedPx: number;
}

// L'octogone (arena/arena.ts dans le paquet partagé), en mémoire : rien n'en est gardé en base, un redémarrage le remet à l'attente. Chaque
// changement part à tout le bureau en entier (`arena:state`, quelques personnes au plus) ; chaque attaque, touchée ou non, part aussi (`arena:action`),
// pour que chacun la voie. Les flèches volent ici, toutes les ARROW_STEP_MS, contre les positions que le monde connaît : chaque client les dessine de
// son côté, et apprend leur impact par `arena:action`. Rien ici ne lève : une erreur imprévue est journalisée.
export function createArenaController(d: ArenaControllerDeps) {
  const ring = d.map.arena;
  // La salle de l'octogone : le plus petit lieu qui contient le milieu du ring.
  const room = ring ? placeAt(d.map, ring.x + ring.width / 2, ring.y + ring.height / 2) : null;

  let phase: ArenaPhase = 'idle';
  let fighters: Fighter[] = [];
  let spectators: string[] = [];
  let winnerId: string | null = null;
  // L'heure de la fin du compte à rebours (horloge `now`), et le minuteur de la phase en cours (compte à rebours, ou retour à l'attente).
  let countdownEndsAt = 0;
  let arrows: Arrow[] = [];
  let arrowsAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const nameOf = (id: string): string => d.world.get(id)?.name ?? '…';
  const isFighter = (id: string): boolean => fighters.some((f) => f.id === id);

  // La cage : on ne la traverse jamais à pied. N'entre dans le ring qu'un combattant, pendant le compte à rebours et le combat (le serveur l'y pose,
  // teleport, qui ne passe pas par ce garde) ; un combattant n'en sort pas avant la fin du combat (le serveur l'en sort alors). Les autres restent dehors,
  // tout le temps : quelqu'un qui s'y trouve (une ancienne position) peut en sortir, pas y revenir.
  if (ring) {
    d.world.addEntryGuard((id, from, to) => {
      const before = insideRing(ring, from.x, from.y);
      const after = insideRing(ring, to.x, to.y);
      if (before === after) return true;
      if (after) return isFighter(id) && (phase === 'countdown' || phase === 'fight');
      return !(isFighter(id) && (phase === 'countdown' || phase === 'fight' || phase === 'over'));
    });
  }

  // Les places du public, autour du ring, dans la salle : les cases praticables hors de la cage, la rangée juste au sud d'abord (face au combat, devant les
  // fauteuils), puis les plus proches du ring.
  const benchSpots: Point[] = (() => {
    if (!ring || !room) return [];
    const tile = d.map.tileSize;
    const south = Math.floor((ring.y + ring.height) / tile);
    const centre = { x: ring.x + ring.width / 2, y: ring.y + ring.height / 2 };
    const spots: Array<Point & { rank: number }> = [];
    for (const rect of room.rects) {
      for (let ty = Math.floor(rect.y / tile); ty < Math.ceil((rect.y + rect.height) / tile); ty++) {
        for (let tx = Math.floor(rect.x / tile); tx < Math.ceil((rect.x + rect.width) / tile); tx++) {
          const spot = { x: tx * tile + tile / 2, y: ty * tile + tile / 2 };
          if (!isWalkablePoint(d.map, spot.x, spot.y) || insideRing(ring, spot.x, spot.y, -12)) continue;
          spots.push({ ...spot, rank: (ty === south ? 0 : 10_000) + Math.hypot(spot.x - centre.x, spot.y - centre.y) });
        }
      }
    }
    return spots.sort((a, b) => a.rank - b.rank).map(({ x, y }) => ({ x, y }));
  })();

  // Les places du public où personne d'autre (que `except`) ne se tient, la mieux placée d'abord.
  function freeBenchSpots(except: string | null = null): Point[] {
    const others = d.world.list().filter((p) => p.id !== except);
    return benchSpots.filter((spot) => !others.some((o) => Math.hypot(o.x - spot.x, o.y - spot.y) < 30));
  }

  // Pose cette personne hors de la cage, à une place du public. Faux si aucune ne convient.
  function placeOutside(userId: string): boolean {
    return freeBenchSpots(userId).some((spot) => d.teleport(userId, spot));
  }

  // Ceux qui sont dans la cage alors qu'ils n'ont rien à y faire en sortent (la fin d'un combat, un combattant qui abandonne).
  function evictFromRing(ids: Iterable<string>): void {
    if (!ring) return;
    for (const id of ids) {
      const p = d.world.get(id);
      if (p && insideRing(ring, p.x, p.y)) placeOutside(id);
    }
  }

  function view(): ArenaState {
    if (!ring) return { ...EMPTY_ARENA };
    return {
      phase,
      fighters: fighters.map((f) => ({ id: f.id, name: nameOf(f.id), hp: f.hp, weapon: f.weapon })),
      spectators: spectators.map((id) => ({ id, name: nameOf(id) })),
      countdownMs: phase === 'countdown' ? Math.max(0, Math.round(countdownEndsAt - d.now())) : 0,
      winnerId,
    };
  }

  const broadcast = (): void => {
    d.io.to(OFFICE_ROOM).emit('arena:state', view());
  };

  // Est-on dans la salle de l'octogone, là où le monde nous voit ?
  function inRoom(userId: string): boolean {
    const me = d.world.get(userId);
    if (!me || !room) return false;
    return placeAt(d.map, me.x, me.y)?.key === room.key;
  }

  function schedule(ms: number, fn: () => void): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      try {
        fn();
      } catch (err) {
        logServerError(d.logger, { err }, 'Octogone : minuteur impossible');
      }
    }, ms);
    timer.unref();
  }

  // Le ring revient à l'attente : les combattants gardent leur place, leurs points de vie repartent du maximum.
  function backToIdle(): void {
    clearTimeout(timer);
    timer = undefined;
    phase = 'idle';
    winnerId = null;
    arrows = [];
    for (const f of fighters) Object.assign(f, { hp: ARENA_MAX_HP, readyAt: 0 });
    // Le combat est fini (ou n'a pas eu lieu) : les combattants sortent de la cage, chez le public.
    evictFromRing(fighters.map((f) => f.id));
  }

  // Le combat est fini : `winner` l'emporte (null : personne, le combat est annulé), et ARENA_OVER_MS plus tard on revient à l'attente.
  function finish(winner: string | null): void {
    phase = 'over';
    winnerId = winner;
    arrows = [];
    schedule(ARENA_OVER_MS, () => {
      backToIdle();
      broadcast();
    });
  }

  // Les deux combattants face à face dans le ring ; ceux qui y sont sans y combattre en sont sortis, sur la rangée juste au sud.
  function placeFighters(): void {
    if (!ring) return;
    const starts = ringStarts(ring);
    fighters.forEach((f, index) => d.teleport(f.id, starts[index]!));
    evictFromRing(spectatorsInRing());
  }

  // Ceux du bureau (spectateurs ou non) qui ont les pieds dans le ring sans y combattre.
  function spectatorsInRing(): string[] {
    if (!ring) return [];
    const ids = new Set(fighters.map((f) => f.id));
    return d.world
      .list()
      .filter((p) => !ids.has(p.id) && insideRing(ring, p.x, p.y))
      .map((p) => p.id);
  }

  function start(): void {
    phase = 'countdown';
    winnerId = null;
    arrows = [];
    for (const f of fighters) Object.assign(f, { hp: ARENA_MAX_HP, readyAt: 0 });
    countdownEndsAt = d.now() + ARENA_COUNTDOWN_MS;
    placeFighters();
    schedule(ARENA_COUNTDOWN_MS, () => {
      if (phase !== 'countdown' || fighters.length < 2) return;
      phase = 'fight';
      broadcast();
    });
  }

  // Quitter son rôle. Un combattant qui part pendant le compte à rebours l'annule ; pendant le combat, il le perd.
  function drop(userId: string): boolean {
    const wasFighter = fighters.some((f) => f.id === userId);
    const wasSpectator = spectators.includes(userId);
    if (!wasFighter && !wasSpectator) return false;
    spectators = spectators.filter((id) => id !== userId);
    if (wasFighter) {
      fighters = fighters.filter((f) => f.id !== userId);
      evictFromRing([userId]);
      if (phase === 'countdown') backToIdle();
      else if (phase === 'fight') finish(fighters[0]?.id ?? null);
    }
    return true;
  }

  function run(userId: string, command: ArenaCommand): ArenaAck {
    if (!ring || !room) return { ok: false, error: 'no_arena' };
    const fighter = fighters.find((f) => f.id === userId);

    switch (command.type) {
      case 'join': {
        if (!inRoom(userId)) return { ok: false, error: 'not_here' };
        if (command.role === 'fighter') {
          if (fighter) return { ok: true };
          if (phase === 'countdown' || phase === 'fight') return { ok: false, error: 'busy' };
          if (fighters.length >= 2) return { ok: false, error: 'full' };
          spectators = spectators.filter((id) => id !== userId);
          fighters.push({ id: userId, hp: ARENA_MAX_HP, weapon: null, readyAt: 0 });
          if (phase === 'over') backToIdle();
        } else {
          if (spectators.includes(userId)) {
            placeOutside(userId);
            return { ok: true };
          }
          if (fighter) drop(userId);
          spectators.push(userId);
          // Le public regarde du bord de la cage : il y est posé.
          placeOutside(userId);
        }
        broadcast();
        return { ok: true };
      }
      case 'leave': {
        if (drop(userId)) broadcast();
        return { ok: true };
      }
      case 'start': {
        if (!fighter) return { ok: false, error: 'not_fighter' };
        if (phase === 'countdown' || phase === 'fight') return { ok: false, error: 'busy' };
        if (fighters.length < 2) return { ok: false, error: 'need_two' };
        if (fighters.some((f) => f.weapon === null)) return { ok: false, error: 'no_weapon' };
        start();
        broadcast();
        return { ok: true };
      }
      case 'weapon': {
        if (!fighter) return { ok: false, error: 'not_fighter' };
        if (phase === 'countdown' || phase === 'fight') return { ok: false, error: 'busy' };
        if (fighter.weapon !== command.weapon) {
          fighter.weapon = command.weapon;
          broadcast();
        }
        return { ok: true };
      }
      case 'attack': {
        if (!fighter || !fighter.weapon) return { ok: false, error: 'not_fighter' };
        if (phase !== 'fight') return { ok: false, error: 'busy' };
        const at = d.now();
        if (at < fighter.readyAt) return { ok: false, error: 'cooldown' };
        const weapon = ARENA_WEAPONS[fighter.weapon];
        fighter.readyAt = at + weapon.cooldownMs;
        const me = d.world.get(userId);
        if (!me) return { ok: true };
        // L'arc : une flèche part des pieds de l'archer, et vole (flyArrows).
        if (weapon.style === 'shoot') {
          const arrow: Arrow = { id: randomUUID().slice(0, 8), owner: userId, x: me.x, y: me.y, dir: command.dir, traveled: 0, rangePx: weapon.rangePx, speedPx: weapon.arrowSpeedPx ?? 400 };
          if (arrows.length === 0) arrowsAt = at;
          arrows.push(arrow);
          d.io.to(OFFICE_ROOM).emit('arena:action', {
            id: userId,
            weapon: fighter.weapon,
            dir: command.dir,
            arrow: { id: arrow.id, x: arrow.x, y: arrow.y, dir: arrow.dir, speedPx: arrow.speedPx, rangePx: arrow.rangePx },
          });
          return { ok: true };
        }
        const foe = fighters.find((f) => f.id !== userId);
        const them = foe ? d.world.get(foe.id) : undefined;
        const damage = foe && them ? resolveMelee(fighter.weapon, { x: me.x, y: me.y, dir: command.dir }, them) : null;
        if (damage === null || !foe) {
          d.io.to(OFFICE_ROOM).emit('arena:action', { id: userId, weapon: fighter.weapon, dir: command.dir });
          return { ok: true };
        }
        hurt(userId, foe, damage, { weapon: fighter.weapon, dir: command.dir });
        return { ok: true };
      }
    }
  }

  // `foe` perd `damage` points de vie, du fait de `attackerId` : tout le monde voit le coup, et un K.O. finit le combat.
  function hurt(attackerId: string, foe: Fighter, damage: number, action: { weapon: ArenaWeaponId; dir: Direction; arrowId?: string }): void {
    foe.hp = Math.max(0, foe.hp - damage);
    const ko = foe.hp === 0;
    d.io.to(OFFICE_ROOM).emit('arena:action', { id: attackerId, ...action, hit: { target: foe.id, damage, ko } });
    if (ko) finish(attackerId);
    broadcast();
  }

  // Les flèches avancent de ce que leur vitesse permet depuis le pas précédent ; celle qui passe sur l'adversaire de son archer le touche.
  function flyArrows(): void {
    if (arrows.length === 0) return;
    const at = d.now();
    const dt = Math.min(at - arrowsAt, 200);
    arrowsAt = at;
    if (phase !== 'fight') {
      arrows = [];
      return;
    }
    const flying: Arrow[] = [];
    for (const arrow of arrows) {
      const foe = fighters.find((f) => f.id !== arrow.owner);
      const them = foe ? d.world.get(foe.id) : undefined;
      const step = arrowStep(arrow, (arrow.speedPx * dt) / 1000, them ?? null, ring);
      Object.assign(arrow, { x: step.x, y: step.y, traveled: step.traveled });
      if (step.hit && foe && phase === 'fight') {
        hurt(arrow.owner, foe, ARENA_WEAPONS.bow.damage, { weapon: 'bow', dir: arrow.dir, arrowId: arrow.id });
        continue;
      }
      if (!step.done) flying.push(arrow);
    }
    if (phase === 'fight') arrows = flying;
  }

  const flight = setInterval(() => {
    try {
      flyArrows();
    } catch (err) {
      logServerError(d.logger, { err }, 'Octogone : vol des flèches impossible');
    }
  }, ARROW_STEP_MS);
  flight.unref();

  // Le balayage : qui n'est plus dans la salle perd son rôle.
  const sweep = setInterval(() => {
    try {
      let changed = false;
      for (const id of [...fighters.map((f) => f.id), ...spectators]) {
        if (!inRoom(id)) changed = drop(id) || changed;
      }
      if (changed) broadcast();
    } catch (err) {
      logServerError(d.logger, { err }, 'Octogone : balayage impossible');
    }
  }, d.sweepMs ?? ARENA_SWEEP_MS);
  sweep.unref();

  return {
    run(userId: string, command: ArenaCommand): ArenaAck {
      try {
        return run(userId, command);
      } catch (err) {
        logServerError(d.logger, { err, userId }, 'Commande de l\'octogone impossible');
        return { ok: false, error: 'invalid' };
      }
    },
    /** L'octogone tel que tout le bureau le voit (le sparring du faux live le lit pour se battre). */
    state: view,
    /** La place du public la mieux placée où personne ne se tient (le sparring du faux live y apparaît). */
    freeBenchSpot: (): Point | null => freeBenchSpots()[0] ?? null,
    /** Le ring, en pixels ; null si la carte n'en a pas. */
    ring,
    /** Ce que chaque init dit de l'octogone ; rien si la carte n'en a pas. */
    initFor(): { arena?: ArenaState } {
      return ring ? { arena: view() } : {};
    },
    /** La personne quitte le bureau (fin du délai de grâce, retrait) : elle perd son rôle. */
    onDepart(userId: string): void {
      if (drop(userId)) broadcast();
    },
    /** Un nom change : la liste de l'octogone le suit. */
    profileChanged(userId: string): void {
      if (fighters.some((f) => f.id === userId) || spectators.includes(userId)) broadcast();
    },
    stop(): void {
      clearInterval(sweep);
      clearInterval(flight);
      clearTimeout(timer);
    },
  };
}

export type ArenaController = ReturnType<typeof createArenaController>;
