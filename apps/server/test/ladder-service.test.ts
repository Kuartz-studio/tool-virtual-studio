import type { GameResult, MatchLogEntry } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { gameMatch, gameRating, user } from '../src/db/schema';
import { LadderService, type LadderEntry } from '../src/games/ladder-service';
import { createTestDb } from './helpers/test-db';

const NAMES = ['ana', 'bob', 'cleo', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jon', 'kim', 'lou'];

// Un service sur une base neuve, avec ces comptes.
async function setup(accounts: string[] = NAMES) {
  const db = await createTestDb();
  for (const id of accounts) await db.insert(user).values({ id, name: id[0]!.toUpperCase() + id.slice(1), email: `${id}@example.test` });
  return { db, ladder: new LadderService(db, { clock: () => 1_800_000_000_000 }) };
}

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const LOG: MatchLogEntry[] = [{ kind: 'create', setup: { seats: 2, first: 0 }, rng: [] }];

// Une partie finie entre ces joueurs (dans l'ordre des sièges), dont le classement est donné en sièges.
function match(userIds: string[], ranking: number[][], options: Partial<LadderEntry> = {}): LadderEntry {
  const result: GameResult = { ranking, reason: 'test' };
  return {
    id: uuid(),
    game: 'chess',
    startedAt: 1_800_000_000_000 - 60_000,
    endedAt: 1_800_000_000_000,
    players: userIds.map((userId, seat) => ({ seat, userId, name: userId[0]!.toUpperCase() + userId.slice(1) })),
    result,
    moves: LOG,
    moveCount: 12,
    ranked: true,
    ...options,
  };
}

async function ratingOf(db: Awaited<ReturnType<typeof setup>>['db'], userId: string, game = 'chess') {
  const rows = (await db.select().from(gameRating).where(eq(gameRating.userId, userId))).filter((row) => row.game === game);
  return rows[0];
}

describe('LadderService.record : écrire une partie finie', () => {
  test('classée à égalité : 1216 et 1184, la partie et les deux notes sont écrites', async () => {
    const { db, ladder } = await setup();
    const entry = match(['ana', 'bob'], [[0], [1]]);
    const written = await ladder.record(entry);
    expect(written).toEqual({
      ratings: [
        { userId: 'ana', before: 1200, after: 1216 },
        { userId: 'bob', before: 1200, after: 1184 },
      ],
    });
    const [row] = await db.select().from(gameMatch);
    expect(row).toMatchObject({ id: entry.id, game: 'chess', ranked: true, moveCount: 12, result: { ranking: [[0], [1]], reason: 'test' }, moves: LOG });
    expect(row!.startedAt.getTime()).toBe(entry.startedAt);
    expect(row!.endedAt.getTime()).toBe(entry.endedAt);
    expect(row!.players).toEqual([
      { seat: 0, userId: 'ana', name: 'Ana', before: 1200, after: 1216 },
      { seat: 1, userId: 'bob', name: 'Bob', before: 1200, after: 1184 },
    ]);
    expect(await ratingOf(db, 'ana')).toMatchObject({ rating: 1216, games: 1, wins: 1, losses: 0, draws: 0 });
    expect(await ratingOf(db, 'bob')).toMatchObject({ rating: 1184, games: 1, wins: 0, losses: 1, draws: 0 });
  });

  test('une nulle : les notes de départ ne bougent pas, une nulle chacun', async () => {
    const { db, ladder } = await setup();
    const written = await ladder.record(match(['ana', 'bob'], [[0, 1]]));
    expect(written!.ratings!.map((change) => change.after)).toEqual([1200, 1200]);
    expect(await ratingOf(db, 'ana')).toMatchObject({ rating: 1200, games: 1, wins: 0, losses: 0, draws: 1 });
    expect(await ratingOf(db, 'bob')).toMatchObject({ rating: 1200, games: 1, wins: 0, losses: 0, draws: 1 });
  });

  test('part des notes et du nombre de parties déjà écrits : K 20 après 30 parties, K 32 avant', async () => {
    const { db, ladder } = await setup();
    await db.insert(gameRating).values([
      { userId: 'ana', game: 'chess', rating: 1400, games: 40, wins: 25, losses: 10, draws: 5 },
      { userId: 'bob', game: 'chess', rating: 1200, games: 3, wins: 1, losses: 2, draws: 0 },
    ]);
    const written = await ladder.record(match(['ana', 'bob'], [[1], [0]]));
    // Bob (1200, K 32) bat Ana (1400, K 20) : +24 pour lui, −15 pour elle (20 × 0,7597).
    expect(written!.ratings).toEqual([
      { userId: 'ana', before: 1400, after: 1385 },
      { userId: 'bob', before: 1200, after: 1224 },
    ]);
    expect(await ratingOf(db, 'ana')).toMatchObject({ rating: 1385, games: 41, wins: 25, losses: 11, draws: 5 });
    expect(await ratingOf(db, 'bob')).toMatchObject({ rating: 1224, games: 4, wins: 2, losses: 2, draws: 0 });
  });

  test('chaque jeu a ses notes : une partie d\'échecs ne touche pas la note du Puissance 4', async () => {
    const { db, ladder } = await setup();
    await ladder.record(match(['ana', 'bob'], [[0], [1]], { game: 'connect4' }));
    await ladder.record(match(['ana', 'bob'], [[1], [0]], { game: 'chess' }));
    expect(await ratingOf(db, 'ana', 'connect4')).toMatchObject({ rating: 1216 });
    expect(await ratingOf(db, 'ana', 'chess')).toMatchObject({ rating: 1184 });
  });

  test('non classée (moins de deux coups) : la partie est écrite, avec ses notes à null ; aucune note ne change, aucune ligne de note n\'est créée', async () => {
    const { db, ladder } = await setup();
    const entry = match(['ana', 'bob'], [[0], [1]], { ranked: false, moveCount: 1 });
    expect(await ladder.record(entry)).toEqual({ ratings: null });
    const [row] = await db.select().from(gameMatch);
    expect(row).toMatchObject({ ranked: false, moveCount: 1 });
    expect(row!.players).toEqual([
      { seat: 0, userId: 'ana', name: 'Ana', before: null, after: null },
      { seat: 1, userId: 'bob', name: 'Bob', before: null, after: null },
    ]);
    expect(await db.select().from(gameRating)).toEqual([]);
  });

  test('la même partie écrite deux fois (même identifiant) : une seule ligne, une seule fois comptée', async () => {
    const { db, ladder } = await setup();
    const entry = match(['ana', 'bob'], [[0], [1]]);
    expect(await ladder.record(entry)).not.toBeNull();
    expect(await ladder.record(entry)).toBeNull();
    expect(await db.select().from(gameMatch)).toHaveLength(1);
    expect(await ratingOf(db, 'ana')).toMatchObject({ rating: 1216, games: 1, wins: 1 });
    expect(await ratingOf(db, 'bob')).toMatchObject({ rating: 1184, games: 1, losses: 1 });
  });

  test('la même partie écrite deux fois en même temps : une seule fois comptée', async () => {
    const { db, ladder } = await setup();
    const entry = match(['ana', 'bob'], [[0], [1]]);
    const results = await Promise.all([ladder.record(entry), ladder.record(entry), ladder.record(entry)]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(await ratingOf(db, 'ana')).toMatchObject({ rating: 1216, games: 1 });
  });

  test('deux parties du même joueur en même temps : la seconde part de la note que laisse la première', async () => {
    const { db, ladder } = await setup();
    const [first, second] = await Promise.all([ladder.record(match(['ana', 'bob'], [[0], [1]])), ladder.record(match(['ana', 'cleo'], [[0], [1]]))]);
    expect(first!.ratings![0]).toEqual({ userId: 'ana', before: 1200, after: 1216 });
    // Ana (1216) bat Cléo (1200) : +15 (32 × (1 − 0,5230) = 15,26), pas +16.
    expect(second!.ratings![0]).toEqual({ userId: 'ana', before: 1216, after: 1231 });
    expect(await ratingOf(db, 'ana')).toMatchObject({ rating: 1231, games: 2, wins: 2 });
  });

  test('à quatre : le premier seul gagne, un premier groupe partagé est une nulle, les autres perdent', async () => {
    const { db, ladder } = await setup();
    const four = ['ana', 'bob', 'cleo', 'dan'];
    await ladder.record(match(four, [[2], [0, 1], [3]]));
    expect(await ratingOf(db, 'cleo')).toMatchObject({ wins: 1, draws: 0, losses: 0 });
    expect(await ratingOf(db, 'ana')).toMatchObject({ wins: 0, draws: 0, losses: 1 });
    expect(await ratingOf(db, 'bob')).toMatchObject({ wins: 0, draws: 0, losses: 1 });
    expect(await ratingOf(db, 'dan')).toMatchObject({ wins: 0, draws: 0, losses: 1 });
    await ladder.record(match(four, [[0, 3], [1], [2]]));
    expect(await ratingOf(db, 'ana')).toMatchObject({ wins: 0, draws: 1, losses: 1 });
    expect(await ratingOf(db, 'dan')).toMatchObject({ wins: 0, draws: 1, losses: 1 });
    expect(await ratingOf(db, 'bob')).toMatchObject({ losses: 2 });
  });

  test('une base qui refuse (un compte qui n\'existe plus) : la partie ne s\'écrit pas du tout, ni la partie ni les notes', async () => {
    const { db, ladder } = await setup(['ana']);
    await expect(ladder.record(match(['ana', 'fantome'], [[0], [1]]))).rejects.toThrow();
    expect(await db.select().from(gameMatch)).toEqual([]);
    expect(await db.select().from(gameRating)).toEqual([]);
    // Et la file n'est pas bloquée : la suivante passe.
    expect(await ladder.record(match(['ana'], [[0]], { ranked: false }))).toEqual({ ratings: null });
  });

  test('le classement doit nommer chaque siège : sinon rien n\'est écrit', async () => {
    const { db, ladder } = await setup();
    await expect(ladder.record(match(['ana', 'bob'], [[0]]))).rejects.toThrow();
    expect(await db.select().from(gameMatch)).toEqual([]);
  });
});

describe('LadderService.ladder : le classement d\'un jeu', () => {
  // Joue des parties pour que ces comptes aient ces notes et ces nombres de parties : on les écrit directement.
  async function withRatings(rows: Array<{ userId: string; rating: number; games?: number }>, game = 'chess') {
    const context = await setup();
    await context.db.insert(gameRating).values(rows.map((row) => ({ userId: row.userId, game: game as 'chess', rating: row.rating, games: row.games ?? 5, wins: 2, losses: 2, draws: 1 })));
    return context;
  }

  test('les meilleurs d\'abord : note décroissante, puis plus de parties, puis le nom ; rang, nom du compte, parties, victoires, nulles, défaites', async () => {
    const { ladder } = await withRatings([
      { userId: 'ana', rating: 1300, games: 5 },
      { userId: 'bob', rating: 1300, games: 9 },
      { userId: 'cleo', rating: 1500 },
      { userId: 'dan', rating: 1300, games: 5 },
    ]);
    const { top, me } = await ladder.ladder('chess', 'cleo');
    // À note égale, celui qui a le plus de parties passe devant (Bob, avant Ana, qui vient avant dans l'alphabet), puis le nom (Ana avant Dan).
    expect(top.map((row) => [row.rank, row.name, row.rating, row.games])).toEqual([
      [1, 'Cleo', 1500, 5],
      [2, 'Bob', 1300, 9],
      [2, 'Ana', 1300, 5],
      [2, 'Dan', 1300, 5],
    ]);
    expect(top[0]).toEqual({ rank: 1, userId: 'cleo', name: 'Cleo', rating: 1500, games: 5, wins: 2, losses: 2, draws: 1 });
    expect(me).toEqual(top[0]);
  });

  test('les ex æquo ont le même rang : 1, 2, 2, 4', async () => {
    const { ladder } = await withRatings([
      { userId: 'ana', rating: 1400 },
      { userId: 'bob', rating: 1300 },
      { userId: 'cleo', rating: 1300 },
      { userId: 'dan', rating: 1100 },
    ]);
    expect((await ladder.ladder('chess', 'ana')).top.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
  });

  test('les dix premiers seulement, et sa propre ligne (avec son vrai rang) quand elle est au-delà', async () => {
    const rows = NAMES.map((userId, index) => ({ userId, rating: 1500 - index * 10 }));
    const { ladder } = await withRatings(rows);
    const { top, me } = await ladder.ladder('chess', 'lou');
    expect(top).toHaveLength(10);
    expect(top.map((row) => row.userId)).toEqual(NAMES.slice(0, 10));
    expect(me).toMatchObject({ userId: 'lou', rank: 12, rating: 1390 });
    expect((await ladder.ladder('chess', 'ana')).me).toMatchObject({ userId: 'ana', rank: 1 });
  });

  test('sans partie classée dans ce jeu : sa ligne est null, et ceux qui n\'ont joué à rien n\'y figurent pas', async () => {
    const { ladder } = await withRatings([
      { userId: 'ana', rating: 1300 },
      { userId: 'bob', rating: 1200, games: 0 },
    ]);
    const { top, me } = await ladder.ladder('chess', 'bob');
    expect(top.map((row) => row.userId)).toEqual(['ana']);
    expect(me).toBeNull();
    expect((await ladder.ladder('chess', 'inconnu')).me).toBeNull();
  });

  test('les notes d\'un autre jeu ne se mélangent pas', async () => {
    const { ladder } = await withRatings([{ userId: 'ana', rating: 1300 }], 'connect4');
    expect((await ladder.ladder('chess', 'ana')).top).toEqual([]);
    expect((await ladder.ladder('connect4', 'ana')).top).toHaveLength(1);
  });

  test('un compte retiré (désactivé) n\'est plus au classement ; les rangs se comptent sans lui', async () => {
    const { db, ladder } = await withRatings([
      { userId: 'ana', rating: 1500 },
      { userId: 'bob', rating: 1400 },
      { userId: 'cleo', rating: 1300 },
    ]);
    await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, 'ana'));
    const { top, me } = await ladder.ladder('chess', 'cleo');
    expect(top.map((row) => [row.userId, row.rank])).toEqual([['bob', 1], ['cleo', 2]]);
    expect(me).toMatchObject({ userId: 'cleo', rank: 2 });
  });

  test('le nom est celui du compte au moment de la lecture', async () => {
    const { db, ladder } = await withRatings([{ userId: 'ana', rating: 1300 }]);
    await db.update(user).set({ name: 'Anaïs' }).where(eq(user.id, 'ana'));
    expect((await ladder.ladder('chess', 'ana')).top[0]!.name).toBe('Anaïs');
  });
});
