import { ACTIVITY_MAX_PER_USER, type ActivityInput, type ActivityState } from '@bureau/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { activityState } from '../db/schema';

export interface ActivityService {
  /** Les états d'activité de cette personne, dans l'ordre où elle les a créés. */
  list(userId: string): Promise<ActivityState[]>;
  /** Un de ses états, ou undefined (il n'existe pas, ou il est à quelqu'un d'autre : jamais le même résultat qu'un autre compte). */
  get(userId: string, id: string): Promise<ActivityState | undefined>;
  /** Crée un état ; `limit` si elle en a déjà ACTIVITY_MAX_PER_USER. */
  create(userId: string, input: ActivityInput): Promise<{ ok: true; state: ActivityState } | { ok: false; error: 'limit' }>;
  /** Remplace un de ses états ; undefined s'il n'est pas à elle. */
  update(userId: string, id: string, input: ActivityInput): Promise<ActivityState | undefined>;
  /** Supprime un de ses états ; faux s'il n'est pas à elle. */
  remove(userId: string, id: string): Promise<boolean>;
}

// Une ligne de la table, telle qu'on la montre : sans le compte ni la date.
const stateOf = (row: typeof activityState.$inferSelect): ActivityState => ({
  id: row.id,
  label: row.label,
  color: row.color,
  allowEntry: row.allowEntry,
  hear: row.hear,
  heard: row.heard,
});

// Les états d'activité qu'une personne se crée (table activity_state). Chaque lecture et chaque écriture est bornée à son compte : un
// identifiant qui est à quelqu'un d'autre ne se lit, ne se change ni ne se supprime.
export function createActivityService(db: Db): ActivityService {
  return {
    async list(userId) {
      const rows = await db
        .select()
        .from(activityState)
        .where(eq(activityState.userId, userId))
        .orderBy(asc(activityState.createdAt), asc(activityState.id));
      return rows.map(stateOf);
    },

    async get(userId, id) {
      // Un identifiant qui n'est pas un uuid ferait échouer la requête : il n'est à personne.
      if (!isUuid(id)) return undefined;
      const [row] = await db.select().from(activityState).where(and(eq(activityState.userId, userId), eq(activityState.id, id)));
      return row && stateOf(row);
    },

    // Le plafond se vérifie dans l'instruction même (une seule requête) : deux créations en même temps ne le dépassent pas de plus d'une.
    async create(userId, input) {
      const [row] = await db
        .insert(activityState)
        .select(
          db
            .select({
              id: sql<string>`gen_random_uuid()`.as('id'),
              userId: sql<string>`${userId}`.as('user_id'),
              label: sql<string>`${input.label}`.as('label'),
              color: sql<string>`${input.color}`.as('color'),
              allowEntry: sql<boolean>`${input.allowEntry}`.as('allow_entry'),
              hear: sql<boolean>`${input.hear}`.as('hear'),
              heard: sql<boolean>`${input.heard}`.as('heard'),
              createdAt: sql<Date>`now()`.as('created_at'),
            })
            .from(sql`(select 1) as one`)
            .where(sql`(select count(*) from ${activityState} where ${activityState.userId} = ${userId}) < ${ACTIVITY_MAX_PER_USER}`),
        )
        .returning();
      return row ? { ok: true, state: stateOf(row) } : { ok: false, error: 'limit' };
    },

    async update(userId, id, input) {
      if (!isUuid(id)) return undefined;
      const [row] = await db
        .update(activityState)
        .set({ label: input.label, color: input.color, allowEntry: input.allowEntry, hear: input.hear, heard: input.heard })
        .where(and(eq(activityState.userId, userId), eq(activityState.id, id)))
        .returning();
      return row && stateOf(row);
    },

    async remove(userId, id) {
      if (!isUuid(id)) return false;
      const rows = await db
        .delete(activityState)
        .where(and(eq(activityState.userId, userId), eq(activityState.id, id)))
        .returning({ id: activityState.id });
      return rows.length > 0;
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID.test(value);
