import { DESK_NAME_MAX_LENGTH, deskKey, type DeskBan, type DeskInfo, type OfficeMap, type Zone } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { desk, user } from '../db/schema';
import { oneAtATimePerKey } from '../one-at-a-time';

// Une place de bureau de la carte : sa zone desk, sa porte (la zone door qui porte la même clé, s'il y en a une) et le point, juste
// devant la porte et hors de la pièce, où l'on dépose quelqu'un qu'on exclut.
export interface DeskSlot {
  key: string;
  zone: Zone;
  door: Zone | null;
  exit: { x: number; y: number };
}

// Les places de la carte, dans l'ordre des zones. Sans porte, le point de sortie est sous la pièce.
export function deskSlots(map: OfficeMap): DeskSlot[] {
  const doors = new Map(map.zones.filter((zone) => zone.type === 'door').map((door) => [door.name, door] as const));
  return map.zones
    .filter((zone) => zone.type === 'desk')
    .map((zone) => {
      const key = deskKey(zone);
      const door = doors.get(key) ?? null;
      return { key, zone, door, exit: exitPoint(zone, door, map.tileSize) };
    });
}

// Un pas de plus hors de la pièce, par le centre de la porte : vers le haut si la porte est au-dessus de la pièce, vers le bas si elle est
// en dessous, de côté sinon.
function exitPoint(room: Zone, door: Zone | null, tile: number): { x: number; y: number } {
  if (door === null) return { x: room.x + room.width / 2, y: room.y + room.height + tile / 2 };
  const center = { x: door.x + door.width / 2, y: door.y + door.height / 2 };
  if (door.y + door.height <= room.y) return { x: center.x, y: center.y - tile };
  if (door.y >= room.y + room.height) return { x: center.x, y: center.y + tile };
  return { x: center.x + (door.x + door.width <= room.x ? -tile : tile), y: center.y };
}

interface DeskState {
  key: string;
  ownerId: string | null;
  ownerName: string | null;
  name: string | null;
  locked: boolean;
  // Exclus (id → nom) et admis : pour la durée du serveur seulement.
  banned: Map<string, string>;
  admitted: Set<string>;
}

export type DeskError = 'unknown_desk' | 'taken' | 'no_desk' | 'not_locked' | 'unavailable' | 'self';

// Ce que fait un changement : les places à rediffuser à tout le bureau, et si les accès de quelqu'un ont pu changer (les portes
// fermées pour chacun sont alors à relire).
export type DeskResult = { ok: true; changed: DeskInfo[]; access: boolean } | { ok: false; error: DeskError };

export interface DeskServiceOptions {
  /** Le propriétaire laisse-t-il entrer d'après son état d'activité du moment ? Faux : sa porte est fermée, comme verrouillée. */
  ownerAllowsEntry?: (ownerId: string) => boolean;
}

// Les bureaux du bureau virtuel : 20 places sur la carte, chacune libre ou à quelqu'un (une place par personne), avec son nom, sa porte
// ouverte ou fermée, ceux qu'on en a exclus et ceux qu'on y a admis. L'état vit en mémoire (une seule instance de serveur) et la table
// `desk` le garde d'un redémarrage à l'autre. Les changements passent l'un après l'autre : un « vérifier puis écrire » ne se croise jamais.
//
// Qui peut entrer dans une place (canEnter) : son propriétaire toujours ; une place libre, tout le monde ; sinon, pas les exclus, et si la
// porte est fermée (verrou, ou état d'activité qui ne laisse pas entrer), seulement ceux qu'on a admis. Cela ne vaut qu'à l'entrée :
// ceux qui sont déjà dedans quand on ferme la porte y restent, jusqu'à ce qu'on les exclue.
export class DeskService {
  private readonly states = new Map<string, DeskState>();
  private readonly byOwner = new Map<string, string>();
  private readonly serial = oneAtATimePerKey();
  private readonly ownerAllowsEntry: (ownerId: string) => boolean;

  /** Résolue quand les bureaux occupés sont lus en base ; rejetée si elle est illisible. Les commandes l'attendent. */
  readonly ready: Promise<void>;
  readonly slots: DeskSlot[];

  constructor(
    private readonly db: Db,
    map: OfficeMap,
    options: DeskServiceOptions = {},
  ) {
    this.slots = deskSlots(map);
    this.ownerAllowsEntry = options.ownerAllowsEntry ?? (() => true);
    for (const slot of this.slots) {
      this.states.set(slot.key, { key: slot.key, ownerId: null, ownerName: null, name: null, locked: false, banned: new Map(), admitted: new Set() });
    }
    this.ready = this.load();
    // L'échec est pour ceux qui attendent `ready` ; sans eux, il ne doit pas rester une promesse rejetée que personne n'attrape.
    this.ready.catch(() => {});
  }

  static async create(db: Db, map: OfficeMap, options: DeskServiceOptions = {}): Promise<DeskService> {
    const service = new DeskService(db, map, options);
    await service.ready;
    return service;
  }

  // Charge les bureaux occupés. Une ligne dont la place n'est plus sur la carte (la carte a changé) est ignorée, et reste en base.
  private async load(): Promise<void> {
    const rows = await this.db
      .select({ key: desk.key, ownerId: desk.ownerId, name: desk.name, locked: desk.locked, ownerName: user.name, disabledAt: user.disabledAt })
      .from(desk)
      .innerJoin(user, eq(user.id, desk.ownerId));
    for (const row of rows) {
      const state = this.states.get(row.key);
      if (!state || row.disabledAt !== null) continue;
      Object.assign(state, { ownerId: row.ownerId, ownerName: row.ownerName, name: row.name, locked: row.locked });
      this.byOwner.set(row.ownerId, row.key);
    }
  }

  list(): DeskInfo[] {
    return this.slots.map((slot) => this.info(this.states.get(slot.key)!));
  }

  get(key: string): DeskInfo | undefined {
    const state = this.states.get(key);
    return state && this.info(state);
  }

  slot(key: string): DeskSlot | undefined {
    return this.slots.find((slot) => slot.key === key);
  }

  deskOf(userId: string): DeskInfo | undefined {
    const key = this.byOwner.get(userId);
    return key === undefined ? undefined : this.get(key);
  }

  // Les clés des places où cette personne ne peut pas entrer : celles dont la porte lui est fermée, ou dont elle est exclue.
  closedFor(userId: string): string[] {
    return this.slots.filter((slot) => !this.canEnter(userId, slot.key)).map((slot) => slot.key);
  }

  canEnter(userId: string, key: string): boolean {
    const state = this.states.get(key);
    if (!state || state.ownerId === null || state.ownerId === userId) return true;
    if (state.banned.has(userId)) return false;
    return this.isClosed(state) ? state.admitted.has(userId) : true;
  }

  bansOf(ownerId: string): DeskBan[] {
    const state = this.stateOf(ownerId);
    return state ? [...state.banned].map(([id, name]) => ({ id, name })) : [];
  }

  // Prendre cette place. Une personne qui a déjà un bureau le déménage (nom et verrou suivent ; exclus et admis restent dans l'ancienne
  // pièce). Prendre la sienne ne change rien.
  claim(userId: string, userName: string, key: string): Promise<DeskResult> {
    return this.serial('desks', async () => {
      await this.ready;
      const target = this.states.get(key);
      if (!target) return fail('unknown_desk');
      if (target.ownerId === userId) return this.ok([], false);
      if (target.ownerId !== null) return fail('taken');
      const previous = this.stateOf(userId);
      try {
        if (previous) await this.db.update(desk).set({ key, updatedAt: new Date() }).where(eq(desk.ownerId, userId));
        else await this.db.insert(desk).values({ key, ownerId: userId }).onConflictDoNothing();
      } catch {
        return fail('unavailable');
      }
      const changed: DeskState[] = [target];
      Object.assign(target, { ownerId: userId, ownerName: userName, name: previous?.name ?? null, locked: previous?.locked ?? false });
      target.banned.clear();
      target.admitted.clear();
      this.byOwner.set(userId, key);
      if (previous) {
        this.vacate(previous);
        changed.unshift(previous);
      }
      return this.ok(changed, true);
    });
  }

  // Rendre son bureau : la place est libre pour tout le monde.
  release(userId: string): Promise<DeskResult> {
    return this.serial('desks', async () => {
      await this.ready;
      const state = this.stateOf(userId);
      if (!state) return fail('no_desk');
      try {
        await this.db.delete(desk).where(eq(desk.ownerId, userId));
      } catch {
        return fail('unavailable');
      }
      this.vacate(state);
      this.byOwner.delete(userId);
      return this.ok([state], true);
    });
  }

  // Le nom du bureau ; vide : le nom par défaut.
  rename(userId: string, name: string): Promise<DeskResult> {
    return this.serial('desks', async () => {
      await this.ready;
      const state = this.stateOf(userId);
      if (!state) return fail('no_desk');
      const next = name.trim().slice(0, DESK_NAME_MAX_LENGTH) || null;
      try {
        await this.db.update(desk).set({ name: next, updatedAt: new Date() }).where(eq(desk.ownerId, userId));
      } catch {
        return fail('unavailable');
      }
      state.name = next;
      return this.ok([state], false);
    });
  }

  // Fermer ou rouvrir la porte. Refermer efface la liste de ceux qu'on avait admis.
  setLocked(userId: string, locked: boolean): Promise<DeskResult> {
    return this.serial('desks', async () => {
      await this.ready;
      const state = this.stateOf(userId);
      if (!state) return fail('no_desk');
      try {
        await this.db.update(desk).set({ locked, updatedAt: new Date() }).where(eq(desk.ownerId, userId));
      } catch {
        return fail('unavailable');
      }
      state.locked = locked;
      if (locked) state.admitted.clear();
      return this.ok([state], true);
    });
  }

  // Exclure quelqu'un : il n'entre plus tant qu'on ne l'a pas réadmis. C'est à l'appelant de le sortir de la pièce.
  kick(ownerId: string, targetId: string, targetName: string): DeskResult {
    const state = this.stateOf(ownerId);
    if (!state) return fail('no_desk');
    if (targetId === ownerId) return fail('self');
    state.banned.set(targetId, targetName);
    state.admitted.delete(targetId);
    return this.ok([state], true);
  }

  unban(ownerId: string, targetId: string): DeskResult {
    const state = this.stateOf(ownerId);
    if (!state) return fail('no_desk');
    state.banned.delete(targetId);
    return this.ok([state], true);
  }

  // Laisser entrer quelqu'un (qui a toqué) : il est admis jusqu'à ce que la porte soit refermée, et n'est plus exclu.
  admit(ownerId: string, targetId: string): DeskResult {
    const state = this.stateOf(ownerId);
    if (!state) return fail('no_desk');
    if (targetId === ownerId) return fail('self');
    state.banned.delete(targetId);
    state.admitted.add(targetId);
    return this.ok([state], true);
  }

  // Le nom affiché du propriétaire a changé.
  renameOwner(userId: string, userName: string): DeskResult {
    const state = this.stateOf(userId);
    if (!state) return this.ok([], false);
    state.ownerName = userName;
    return this.ok([state], false);
  }

  // L'état d'activité du propriétaire a changé : sa porte s'ouvre ou se ferme d'elle-même (ownerAllowsEntry).
  refreshOwner(userId: string): DeskResult {
    const state = this.stateOf(userId);
    return state ? this.ok([state], true) : this.ok([], false);
  }

  // Une personne a un bureau ? Sinon, la première place libre, si une l'est.
  autoAssign(userId: string, userName: string): Promise<DeskResult> {
    const free = this.slots.find((slot) => this.states.get(slot.key)!.ownerId === null);
    if (this.byOwner.has(userId) || !free) return Promise.resolve(this.ok([], false));
    return this.claim(userId, userName, free.key);
  }

  private stateOf(userId: string): DeskState | undefined {
    const key = this.byOwner.get(userId);
    return key === undefined ? undefined : this.states.get(key);
  }

  private vacate(state: DeskState): void {
    Object.assign(state, { ownerId: null, ownerName: null, name: null, locked: false });
    state.banned.clear();
    state.admitted.clear();
  }

  private ok(states: DeskState[], access: boolean): DeskResult {
    return { ok: true, changed: states.map((state) => this.info(state)), access };
  }

  private isClosed(state: DeskState): boolean {
    return state.ownerId !== null && (state.locked || !this.ownerAllowsEntry(state.ownerId));
  }

  private info(state: DeskState): DeskInfo {
    return {
      key: state.key,
      ownerId: state.ownerId,
      ownerName: state.ownerName,
      name: state.name,
      locked: state.locked,
      closedByState: state.ownerId !== null && !state.locked && !this.ownerAllowsEntry(state.ownerId),
    };
  }
}

function fail(error: DeskError): { ok: false; error: DeskError } {
  return { ok: false, error };
}
