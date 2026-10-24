import type { LightLevel, LightsState } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { officeLights, user } from '../db/schema';
import { oneAtATimePerKey } from '../one-at-a-time';

// La lumière que personne n'a touchée : allumée, jamais changée.
const UNTOUCHED: LightsState = { level: 'on', by: null, at: 0 };

// L'état d'une ligne de `office_lights` : `on` faux, éteinte ; allumée, `dim` dit si elle est tamisée.
const levelOf = (row: { on: boolean; dim: boolean }): LightLevel => (!row.on ? 'off' : row.dim ? 'dim' : 'on');

export interface LightsServiceOptions {
  /** L'heure d'un changement, en ms depuis 1970 : Date.now par défaut (les tests en passent une réglée à leur main). */
  clock?: () => number;
}

// La lumière du bureau virtuel : une seule, pour tout le monde. L'état vit en mémoire (une seule instance de serveur) et la table
// `office_lights` le garde d'un redémarrage à l'autre. Les changements passent l'un après l'autre : deux personnes qui éteignent en même
// temps ne le font qu'une fois, le second trouve la lumière déjà éteinte et ne change rien. Elle a trois états : allumée, tamisée, éteinte.
export class LightsService {
  private state: LightsState = { ...UNTOUCHED };
  private readonly serial = oneAtATimePerKey();
  private readonly clock: () => number;

  /** Résolue quand la lumière est lue en base ; rejetée si elle est illisible. Les changements l'attendent. */
  readonly ready: Promise<void>;

  constructor(
    private readonly db: Db,
    options: LightsServiceOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.ready = this.load();
    // L'échec est pour ceux qui attendent `ready` ; sans eux, il ne doit pas rester une promesse rejetée que personne n'attrape.
    this.ready.catch(() => {});
  }

  static async create(db: Db, options: LightsServiceOptions = {}): Promise<LightsService> {
    const service = new LightsService(db, options);
    await service.ready;
    return service;
  }

  // Lit l'état enregistré, et le nom actuel de celui qui l'a changé (null si son compte n'existe plus). Sans ligne : la lumière est allumée.
  private async load(): Promise<void> {
    const [row] = await this.db
      .select({ on: officeLights.on, dim: officeLights.dim, changedBy: officeLights.changedBy, changedAt: officeLights.changedAt, name: user.name })
      .from(officeLights)
      .leftJoin(user, eq(user.id, officeLights.changedBy))
      .where(eq(officeLights.id, 1));
    if (!row) return;
    const by = row.changedBy !== null && row.name !== null ? { id: row.changedBy, name: row.name } : null;
    this.state = { level: levelOf(row), by, at: row.changedAt.getTime() };
  }

  /** L'état de la lumière : une copie, qu'on peut garder. */
  get(): LightsState {
    return { ...this.state, by: this.state.by && { ...this.state.by } };
  }

  /**
   * Allume, tamise ou éteint : l'état voulu, non une bascule. Rend le nouvel état, ou null s'il n'y a rien à changer (la lumière est déjà ainsi).
   * L'état n'est changé qu'une fois la base à jour : une écriture qui échoue rejette la promesse, et la lumière reste comme elle était.
   */
  set(level: LightLevel, by: { id: string; name: string }): Promise<LightsState | null> {
    return this.serial('lights', async () => {
      await this.ready;
      if (this.state.level === level) return null;
      const at = this.clock();
      const change = { on: level !== 'off', dim: level === 'dim', changedBy: by.id, changedAt: new Date(at) };
      await this.db.insert(officeLights).values({ id: 1, ...change }).onConflictDoUpdate({ target: officeLights.id, set: change });
      this.state = { level, by: { id: by.id, name: by.name }, at };
      return this.get();
    });
  }
}
