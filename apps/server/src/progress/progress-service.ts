import {
  GAME_DAILY_XP,
  GAME_DRAW_XP,
  GAME_LOSS_XP,
  GAME_WIN_XP,
  MAX_OPEN_TASKS,
  TODO_DAILY_XP,
  TODO_XP,
  checkInXp,
  dayIn,
  gainOf,
  levelOf,
  missionXp,
  nextStreak,
  previousWorkday,
  shopPriceOf,
  timezoneOrDefault,
  type CharacterStats,
  type MissionGivePayload,
  type MissionTier,
  type MyProgress,
  type TaskView,
  type TodoInput,
  type TodoPatch,
  type XpEntry,
  type XpGain,
  type XpSource,
} from '@bureau/shared';
import { and, count, desc, eq, gte, inArray, isNull, ne, sql, sum, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client';
import { gameRating, progress, shopPurchase, task, user, xpEvent } from '../db/schema';
import { oneAtATimePerKey } from '../one-at-a-time';
import { isUuid } from '../uuid';

// Les tâches fermées (faites, rendues, retirées) restent dans les listes une semaine : de quoi voir ce qu'on vient de faire, sans traîner tout l'historique.
const CLOSED_KEPT_MS = 7 * 24 * 3600_000;
// Au plus tant de tâches fermées dans une liste, et tant de lignes dans le journal d'XP des caractéristiques.
const CLOSED_LISTED = 40;
const HISTORY_LISTED = 30;

export interface ProgressServiceOptions {
  /** L'heure du mur, en ms depuis 1970 : Date.now par défaut (les tests en passent une réglée à leur main). */
  clock?: () => number;
  /** Le fuseau de chaque personne : ses plafonds du jour et sa série de pointage s'y comptent. Par défaut, celui de son compte (`user.timezone`, Paris tant
   * qu'elle n'en a pas choisi d'autre). */
  timeZoneOf?: (userId: string) => Promise<string>;
  /** Le prix d'un élément de la boutique, en kuartzons (undefined : il n'y est pas). Par défaut, celui de la boutique (shopPriceOf : un élément de décor de
   * la collection à part, ou un mur). */
  priceOf?: (itemId: string) => number | undefined;
}

// Ce qu'une tâche faite a donné : la tâche, et la progression de la personne avec le gain (`gain`) qui vient de l'y amener.
export interface Completed {
  task: TaskView;
  progress: MyProgress;
}

export type GiveResult = { ok: true; task: TaskView } | { ok: false; error: 'unknown_member' | 'self' | 'limit' };
export type BuyResult = { ok: true; progress: MyProgress } | { ok: false; error: 'unknown_item' | 'owned' | 'too_poor' };

// L'issue d'une partie classée pour un joueur, et le nom du jeu tel qu'on l'écrit dans le journal.
export type GameOutcome = 'win' | 'draw' | 'loss';
const GAME_LABELS: Record<string, string> = { chess: 'Échecs', backgammon: 'Backgammon', connect4: 'Puissance 4', ludo: 'Petits chevaux' };
const OUTCOME_LABELS: Record<GameOutcome, string> = { win: 'victoire', draw: 'nulle', loss: 'défaite' };
const OUTCOME_XP: Record<GameOutcome, number> = { win: GAME_WIN_XP, draw: GAME_DRAW_XP, loss: GAME_LOSS_XP };

const owner = alias(user, 'owner');
const giver = alias(user, 'giver');

type TaskRow = typeof task.$inferSelect;

// Une tâche telle que les listes la montrent, avec le nom du moment de celle qui la porte et de celle qui l'a confiée.
function toView(row: { t: TaskRow; ownerName: string; giverName: string | null }): TaskView {
  const { t } = row;
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    notes: t.notes,
    tier: t.tier as MissionTier | null,
    xp: t.xp,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    doneAt: t.doneAt?.toISOString() ?? null,
    owner: { id: t.ownerId, name: row.ownerName },
    giver: t.giverId === null ? null : { id: t.giverId, name: row.giverName ?? '' },
    seen: t.kind === 'todo' || t.seenAt !== null,
  };
}

// Des notes vides n'en sont pas.
const notesOf = (notes: string | undefined): string | null => (notes === undefined || notes === '' ? null : notes);

// La progression de chacun : sa liste de tâches, les missions qu'on lui confie, l'XP qu'il en tire (et ce qu'elle rapporte en montant de niveau : des kuartzons), son
// pointage du jour, ses parties de jeu, ses caractéristiques, et ce qu'il achète à la boutique.
//
// Tout ce qui change l'XP ou les kuartzons d'une personne passe l'un après l'autre (une file par personne), dans une transaction qui verrouille sa ligne : deux tâches
// cochées en même temps comptent l'une après l'autre, le plafond du jour aussi, et un achat ne dépense jamais deux fois les mêmes kuartzons. Les règles (niveaux, paliers,
// plafonds) sont celles de @bureau/shared (progress/rules.ts), les mêmes que le client affiche.
export class ProgressService {
  private readonly serial = oneAtATimePerKey();
  private readonly clock: () => number;
  private readonly timeZoneOf: (userId: string) => Promise<string>;
  readonly priceOf: (itemId: string) => number | undefined;

  constructor(
    private readonly db: Db,
    options: ProgressServiceOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.timeZoneOf =
      options.timeZoneOf ??
      (async (userId) => {
        const [row] = await db.select({ timezone: user.timezone }).from(user).where(eq(user.id, userId));
        return timezoneOrDefault(row?.timezone);
      });
    this.priceOf = options.priceOf ?? shopPriceOf;
  }

  // Sa progression : XP, kuartzons, série de pointage (celle qui court encore : une série qu'un jour ouvré manqué a cassée vaut 0) et ce qu'elle possède.
  async mine(userId: string): Promise<MyProgress> {
    const today = await this.today(userId);
    const [[row], owned, todoEarned] = await Promise.all([
      this.db.select().from(progress).where(eq(progress.userId, userId)),
      this.db.select({ itemId: shopPurchase.itemId }).from(shopPurchase).where(eq(shopPurchase.userId, userId)).orderBy(shopPurchase.boughtAt),
      earnedOn(this.db, userId, 'todo', today),
    ]);
    return {
      xp: row?.xp ?? 0,
      kuartzons: row?.kuartzons ?? 0,
      streak: currentStreak(row, today),
      todoXpLeft: Math.max(0, TODO_DAILY_XP - todoEarned),
      owned: owned.map((o) => o.itemId),
    };
  }

  // Le niveau de chacune de ces personnes (0 pour qui n'a pas de ligne) : pour le monde, et la liste des membres.
  async levels(userIds: readonly string[]): Promise<Map<string, number>> {
    const levels = new Map(userIds.map((id) => [id, 0]));
    if (userIds.length === 0) return levels;
    const rows = await this.db.select({ userId: progress.userId, xp: progress.xp }).from(progress).where(inArray(progress.userId, [...userIds]));
    for (const row of rows) levels.set(row.userId, levelOf(row.xp));
    return levels;
  }

  // Ce qu'elle possède de la boutique, parmi ces éléments.
  async ownedAmong(userId: string, itemIds: readonly string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const rows = await this.db
      .select({ itemId: shopPurchase.itemId })
      .from(shopPurchase)
      .where(and(eq(shopPurchase.userId, userId), inArray(shopPurchase.itemId, [...itemIds])));
    return new Set(rows.map((row) => row.itemId));
  }

  // Parmi ces éléments de décor, ceux de la boutique qu'elle n'a pas achetés (qu'elle ne peut donc pas poser), sans doublon.
  async unowned(userId: string, itemIds: readonly string[]): Promise<string[]> {
    const priced = [...new Set(itemIds)].filter((id) => this.priceOf(id) !== undefined);
    if (priced.length === 0) return [];
    const owned = await this.ownedAmong(userId, priced);
    return priced.filter((id) => !owned.has(id));
  }

  // Sa liste : ses tâches ouvertes (les missions d'abord, puis les siennes ; les plus récentes d'abord), puis celles fermées depuis une semaine.
  async tasksOf(userId: string): Promise<TaskView[]> {
    const since = new Date(this.clock() - CLOSED_KEPT_MS);
    const [open, closed] = await Promise.all([
      this.select(and(eq(task.ownerId, userId), eq(task.status, 'open'))!, [desc(sql`${task.kind} = 'mission'`), desc(task.createdAt)], MAX_OPEN_TASKS),
      this.select(and(eq(task.ownerId, userId), ne(task.status, 'open'), gte(task.doneAt, since))!, [desc(task.doneAt)], CLOSED_LISTED),
    ]);
    return [...open, ...closed];
  }

  // Les missions qu'elle a confiées : celles en cours, puis celles fermées depuis une semaine.
  async givenBy(userId: string): Promise<TaskView[]> {
    const since = new Date(this.clock() - CLOSED_KEPT_MS);
    const [open, closed] = await Promise.all([
      this.select(and(eq(task.giverId, userId), eq(task.status, 'open'))!, [desc(task.createdAt)], MAX_OPEN_TASKS),
      this.select(and(eq(task.giverId, userId), ne(task.status, 'open'), gte(task.doneAt, since))!, [desc(task.doneAt)], CLOSED_LISTED),
    ]);
    return [...open, ...closed];
  }

  // Une tâche à soi. `limit` : sa liste a déjà MAX_OPEN_TASKS tâches ouvertes (compté dans sa file : deux ajouts en même temps ne la dépassent pas).
  createTodo(userId: string, input: TodoInput): Promise<{ ok: true; task: TaskView } | { ok: false; error: 'limit' }> {
    return this.serial(userId, async () => {
      if ((await this.openCount(userId)) >= MAX_OPEN_TASKS) return { ok: false, error: 'limit' } as const;
      const now = new Date(this.clock());
      const [row] = await this.db
        .insert(task)
        .values({ ownerId: userId, kind: 'todo', title: input.title, notes: notesOf(input.notes), xp: TODO_XP, seenAt: now, createdAt: now })
        .returning({ id: task.id });
      return { ok: true, task: (await this.view(row!.id))! } as const;
    });
  }

  // Modifier une de ses tâches ouvertes (pas une mission : son intitulé est celui de qui l'a confiée). null : aucune tâche de ce genre.
  async updateTodo(userId: string, id: string, patch: TodoPatch): Promise<TaskView | null> {
    if (!isUuid(id)) return null;
    const set: Partial<TaskRow> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.notes !== undefined) set.notes = notesOf(patch.notes);
    const updated = await this.db
      .update(task)
      .set(set)
      .where(and(eq(task.id, id), eq(task.ownerId, userId), eq(task.kind, 'todo'), eq(task.status, 'open')))
      .returning({ id: task.id });
    return updated.length === 0 ? null : this.view(id);
  }

  // Supprimer une de ses tâches (ouverte ou faite : l'XP qu'elle a rapportée reste au journal). Une mission ne se supprime pas : elle se rend.
  async deleteTodo(userId: string, id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const deleted = await this.db.delete(task).where(and(eq(task.id, id), eq(task.ownerId, userId), eq(task.kind, 'todo'))).returning({ id: task.id });
    return deleted.length > 0;
  }

  // Cocher une de ses tâches ouvertes : elle est faite, et rapporte son XP (une mission : celle de sa difficulté ; une tâche à soi : TODO_XP, dans la limite du
  // plafond du jour). null : aucune tâche ouverte de ce nom dans sa liste.
  complete(userId: string, id: string): Promise<Completed | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    return this.serial(userId, async () => {
      const day = await this.today(userId);
      const done = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(task)
          .where(and(eq(task.id, id), eq(task.ownerId, userId), eq(task.status, 'open')))
          .for('update');
        if (!row) return null;
        const amount = row.kind === 'mission' ? row.xp : Math.min(TODO_XP, Math.max(0, TODO_DAILY_XP - (await earnedOn(tx, userId, 'todo', day))));
        await tx.update(task).set({ status: 'done', doneAt: new Date(this.clock()), xp: amount }).where(eq(task.id, id));
        const gain = await this.award(tx, userId, { amount, source: row.kind === 'mission' ? 'mission' : 'todo', label: row.title, day, taskId: id });
        return { gain };
      });
      if (!done) return null;
      const [view, mine] = await Promise.all([this.view(id), this.mine(userId)]);
      return { task: view!, progress: { ...mine, gain: done.gain } };
    });
  }

  // Rendre une mission qu'on ne fera pas : elle sort de sa liste, et celle qui l'a confiée le saura. null : aucune mission ouverte de ce nom dans sa liste.
  async decline(userId: string, id: string): Promise<TaskView | null> {
    if (!isUuid(id)) return null;
    const closed = await this.db
      .update(task)
      .set({ status: 'declined', doneAt: new Date(this.clock()) })
      .where(and(eq(task.id, id), eq(task.ownerId, userId), eq(task.kind, 'mission'), eq(task.status, 'open')))
      .returning({ id: task.id });
    return closed.length === 0 ? null : this.view(id);
  }

  // Ses missions nouvelles sont vues (elle a ouvert sa liste) : elles ne sont plus « nouvelles ».
  async markSeen(userId: string): Promise<void> {
    await this.db
      .update(task)
      .set({ seenAt: new Date(this.clock()) })
      .where(and(eq(task.ownerId, userId), eq(task.kind, 'mission'), isNull(task.seenAt)));
  }

  // Confier une mission à quelqu'un : elle arrive dans sa liste, nouvelle, avec l'XP de sa difficulté. Refusée à soi-même (`self`), à qui n'est pas un membre actif
  // (`unknown_member`), ou à qui a déjà MAX_OPEN_TASKS tâches ouvertes (`limit`).
  async give(giverId: string, mission: MissionGivePayload): Promise<GiveResult> {
    if (mission.to === giverId) return { ok: false, error: 'self' };
    const [target] = await this.db.select({ id: user.id }).from(user).where(and(eq(user.id, mission.to), isNull(user.disabledAt)));
    if (!target) return { ok: false, error: 'unknown_member' };
    // Compter puis ajouter dans la file de qui la reçoit : deux missions confiées en même temps ne dépassent pas sa limite.
    return this.serial(mission.to, async () => {
      if ((await this.openCount(mission.to)) >= MAX_OPEN_TASKS) return { ok: false, error: 'limit' } as const;
      const [row] = await this.db
        .insert(task)
        .values({
          ownerId: mission.to,
          giverId,
          kind: 'mission',
          title: mission.title,
          notes: notesOf(mission.notes),
          tier: mission.tier,
          xp: missionXp(mission.tier),
          createdAt: new Date(this.clock()),
        })
        .returning({ id: task.id });
      return { ok: true, task: (await this.view(row!.id))! } as const;
    });
  }

  // Retirer une mission qu'on a confiée et qui n'est pas encore faite. null : aucune mission ouverte de ce nom confiée par elle.
  async cancel(giverId: string, id: string): Promise<TaskView | null> {
    if (!isUuid(id)) return null;
    const closed = await this.db
      .update(task)
      .set({ status: 'cancelled', doneAt: new Date(this.clock()) })
      .where(and(eq(task.id, id), eq(task.giverId, giverId), eq(task.kind, 'mission'), eq(task.status, 'open')))
      .returning({ id: task.id });
    return closed.length === 0 ? null : this.view(id);
  }

  // Le pointage : la première arrivée du jour (dans son fuseau) rapporte checkInXp de sa série de jours ouvrés. null : déjà pointé ce jour-là (ou un jour plus
  // tard, sous un autre fuseau).
  checkIn(userId: string): Promise<MyProgress | null> {
    return this.serial(userId, async () => {
      const day = await this.today(userId);
      const gain = await this.db.transaction(async (tx) => {
        const row = await lockProgress(tx, userId);
        // Le jour doit avancer, et non seulement changer : changer de fuseau horaire ne refait pas pointer (vers l'ouest, on attend le lendemain ; vers
        // l'est, on pointe un peu plus tôt, une seule fois). Les dates « AAAA-MM-JJ » se comparent comme du texte.
        if (row.checkInDay !== null && day <= row.checkInDay) return null;
        const streak = nextStreak(row.checkInDay, row.streak, day);
        await tx.update(progress).set({ checkInDay: day, streak }).where(eq(progress.userId, userId));
        return this.award(tx, userId, { amount: checkInXp(streak), source: 'checkin', label: streak > 1 ? `Pointage, ${streak} jours de suite` : 'Pointage du jour', day });
      });
      return gain === null ? null : { ...(await this.mine(userId)), gain };
    });
  }

  // Une partie classée finie, pour un joueur : GAME_WIN_XP, GAME_DRAW_XP ou GAME_LOSS_XP selon l'issue, dans la limite du plafond du jour. null : le plafond est
  // atteint, rien n'est gagné.
  gamePlayed(userId: string, game: string, outcome: GameOutcome): Promise<MyProgress | null> {
    return this.serial(userId, async () => {
      const day = await this.today(userId);
      const gain = await this.db.transaction(async (tx) => {
        await lockProgress(tx, userId);
        const amount = Math.min(OUTCOME_XP[outcome], Math.max(0, GAME_DAILY_XP - (await earnedOn(tx, userId, 'game', day))));
        if (amount === 0) return null;
        return this.award(tx, userId, { amount, source: 'game', label: `${GAME_LABELS[game] ?? game} : ${OUTCOME_LABELS[outcome]}`, day });
      });
      return gain === null ? null : { ...(await this.mine(userId)), gain };
    });
  }

  // Acheter un élément de la boutique (un élément de décor qui a un prix) : une fois pour toutes. `unknown_item` : pas un élément de la boutique ; `owned` : déjà à
  // elle ; `too_poor` : pas assez de kuartzons.
  buy(userId: string, itemId: string): Promise<BuyResult> {
    const price = this.priceOf(itemId);
    if (price === undefined) return Promise.resolve({ ok: false, error: 'unknown_item' });
    return this.serial(userId, async () => {
      const refused = await this.db.transaction(async (tx) => {
        const row = await lockProgress(tx, userId);
        const [owned] = await tx.select({ itemId: shopPurchase.itemId }).from(shopPurchase).where(and(eq(shopPurchase.userId, userId), eq(shopPurchase.itemId, itemId)));
        if (owned) return 'owned' as const;
        if (row.kuartzons < price) return 'too_poor' as const;
        await tx.insert(shopPurchase).values({ userId, itemId, price, boughtAt: new Date(this.clock()) });
        await tx.update(progress).set({ kuartzons: sql`${progress.kuartzons} - ${price}`, updatedAt: new Date(this.clock()) }).where(eq(progress.userId, userId));
        return null;
      });
      return refused === null ? { ok: true, progress: await this.mine(userId) } : { ok: false, error: refused };
    });
  }

  // Réservé aux tests de bout en bout (`debug:xp`) : `xp` d'expérience d'un coup, comme une mission (ses niveaux rapportent leurs kuartzons), plus `kuartzons` kuartzons.
  debugGrant(userId: string, xp: number, kuartzons: number): Promise<MyProgress> {
    return this.serial(userId, async () => {
      const day = await this.today(userId);
      const gain = await this.db.transaction(async (tx) => {
        const gained = await this.award(tx, userId, { amount: xp, source: 'mission', label: 'Coup de pouce (test)', day });
        if (kuartzons > 0) await tx.update(progress).set({ kuartzons: sql`${progress.kuartzons} + ${kuartzons}` }).where(eq(progress.userId, userId));
        return gained;
      });
      return { ...(await this.mine(userId)), gain };
    });
  }

  // Les caractéristiques de quelqu'un (un membre actif), telles que `viewerId` les voit : ses kuartzons et son journal ne sont montrés qu'à elle. null : pas de tel
  // membre.
  async stats(userId: string, viewerId: string): Promise<CharacterStats | null> {
    const [who] = await this.db
      .select({ id: user.id, name: user.name, avatarKey: user.avatarKey, createdAt: user.createdAt, timezone: user.timezone })
      .from(user)
      .where(and(eq(user.id, userId), isNull(user.disabledAt)));
    if (!who) return null;
    const [[row], byTier, [given], [todos], [games], today] = await Promise.all([
      this.db.select().from(progress).where(eq(progress.userId, userId)),
      this.db
        .select({ tier: task.tier, done: count() })
        .from(task)
        .where(and(eq(task.ownerId, userId), eq(task.kind, 'mission'), eq(task.status, 'done')))
        .groupBy(task.tier),
      this.db.select({ n: count() }).from(task).where(and(eq(task.giverId, userId), eq(task.kind, 'mission'))),
      this.db.select({ n: count() }).from(task).where(and(eq(task.ownerId, userId), eq(task.kind, 'todo'), eq(task.status, 'done'))),
      this.db.select({ played: sum(gameRating.games), won: sum(gameRating.wins) }).from(gameRating).where(eq(gameRating.userId, userId)),
      this.today(userId),
    ]);
    const missionsByTier = Array.from({ length: 10 }, () => 0);
    for (const { tier, done } of byTier) if (tier !== null && tier >= 1 && tier <= 10) missionsByTier[tier - 1] = done;
    const stats: CharacterStats = {
      id: who.id,
      name: who.name,
      avatarKey: who.avatarKey,
      memberSince: who.createdAt.toISOString(),
      timezone: timezoneOrDefault(who.timezone),
      xp: row?.xp ?? 0,
      missionsDone: missionsByTier.reduce((a, b) => a + b, 0),
      missionsByTier,
      missionsGiven: given?.n ?? 0,
      todosDone: todos?.n ?? 0,
      streak: currentStreak(row, today),
      gamesPlayed: Number(games?.played ?? 0),
      gamesWon: Number(games?.won ?? 0),
    };
    if (userId !== viewerId) return stats;
    const history = await this.db
      .select({ at: xpEvent.createdAt, amount: xpEvent.amount, source: xpEvent.source, label: xpEvent.label })
      .from(xpEvent)
      .where(eq(xpEvent.userId, userId))
      .orderBy(desc(xpEvent.createdAt))
      .limit(HISTORY_LISTED);
    return { ...stats, kuartzons: row?.kuartzons ?? 0, history: history.map((entry): XpEntry => ({ ...entry, at: entry.at.toISOString() })) };
  }

  // Ajoute l'XP à la personne (dans la transaction, sa ligne verrouillée par lockProgress), avec les kuartzons des niveaux passés, et l'inscrit au journal. Rend le gain,
  // même nul (une tâche à soi au-delà du plafond : rien au journal, le niveau ne bouge pas).
  private async award(tx: Db, userId: string, g: { amount: number; source: XpSource; label: string; day: string; taskId?: string }): Promise<XpGain> {
    const row = await lockProgress(tx, userId);
    const { levelBefore, levelAfter, kuartzons } = gainOf(row.xp, g.amount);
    if (g.amount > 0) {
      const now = new Date(this.clock());
      await tx
        .update(progress)
        .set({ xp: sql`${progress.xp} + ${g.amount}`, kuartzons: sql`${progress.kuartzons} + ${kuartzons}`, updatedAt: now })
        .where(eq(progress.userId, userId));
      await tx.insert(xpEvent).values({ userId, amount: g.amount, source: g.source, label: g.label, day: g.day, taskId: g.taskId ?? null, createdAt: now });
    }
    return { amount: g.amount, source: g.source, label: g.label, levelBefore, levelAfter, kuartzons };
  }

  private async today(userId: string): Promise<string> {
    return dayIn(await this.timeZoneOf(userId), new Date(this.clock()));
  }

  private async openCount(userId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(task).where(and(eq(task.ownerId, userId), eq(task.status, 'open')));
    return row?.n ?? 0;
  }

  private async view(id: string): Promise<TaskView | null> {
    const [view] = await this.select(eq(task.id, id), [], 1);
    return view ?? null;
  }

  private async select(where: SQL, order: SQL[], limit: number): Promise<TaskView[]> {
    const rows = await this.db
      .select({ t: task, ownerName: owner.name, giverName: giver.name })
      .from(task)
      .innerJoin(owner, eq(owner.id, task.ownerId))
      .leftJoin(giver, eq(giver.id, task.giverId))
      .where(where)
      .orderBy(...order)
      .limit(limit);
    return rows.map(toView);
  }
}

// La ligne de progression de la personne, créée au besoin, verrouillée jusqu'à la fin de la transaction.
async function lockProgress(tx: Db, userId: string): Promise<typeof progress.$inferSelect> {
  await tx.insert(progress).values({ userId }).onConflictDoNothing();
  const [row] = await tx.select().from(progress).where(eq(progress.userId, userId)).for('update');
  return row!;
}

// L'XP déjà gagnée ce jour-là de cette source (pour les plafonds du jour).
async function earnedOn(tx: Db, userId: string, source: XpSource, day: string): Promise<number> {
  const [row] = await tx
    .select({ total: sum(xpEvent.amount) })
    .from(xpEvent)
    .where(and(eq(xpEvent.userId, userId), eq(xpEvent.source, source), eq(xpEvent.day, day)));
  return Number(row?.total ?? 0);
}

// La série de pointage qui court encore aujourd'hui : celle de la ligne si le dernier pointage est d'aujourd'hui ou du dernier jour ouvré (ou d'après), sinon 0.
function currentStreak(row: { checkInDay: string | null; streak: number } | undefined, today: string): number {
  if (!row || row.checkInDay === null) return 0;
  return row.checkInDay >= previousWorkday(today) ? row.streak : 0;
}

// L'issue d'une partie pour le joueur de ce siège, d'après le classement (les sièges du meilleur au moins bon, des groupes d'ex æquo) : tous ex æquo, une nulle ;
// dans le premier groupe, une victoire ; sinon une défaite.
export function outcomeOf(ranking: readonly (readonly number[])[], seat: number, players: number): GameOutcome {
  const first = ranking[0] ?? [];
  if (first.length >= players) return 'draw';
  return first.includes(seat) ? 'win' : 'loss';
}
