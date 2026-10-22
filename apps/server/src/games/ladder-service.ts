import { ELO_START, GAME_LADDER_TOP, eloChanges, type GameId, type GameResult, type LadderRow, type MatchLogEntry } from '@bureau/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { gameMatch, gameRating, user } from '../db/schema';
import { oneAtATimePerKey } from '../one-at-a-time';

// Une partie finie, telle que le service des tables la remet à la base.
export interface LadderEntry {
  // L'identifiant de la partie, fixé à son début : l'écrire deux fois ne la compte qu'une.
  id: string;
  game: GameId;
  // Début et fin, en ms depuis 1970.
  startedAt: number;
  endedAt: number;
  // Les joueurs, par siège (le siège `i` est à l'indice `i`).
  players: Array<{ seat: number; userId: string; name: string }>;
  result: GameResult;
  // Le journal de la partie, de quoi la rejouer.
  moves: MatchLogEntry[];
  // Les coups comptés à la fin.
  moveCount: number;
  // Elle compte pour le classement (assez de coups).
  ranked: boolean;
}

// Les notes d'avant et d'après, par joueur dans l'ordre des sièges ; null quand la partie n'est pas classée.
export interface LadderRecord {
  ratings: Array<{ userId: string; before: number; after: number }> | null;
}

export interface LadderServiceOptions {
  /** L'heure d'une écriture, en ms depuis 1970 : Date.now par défaut (les tests en passent une réglée à leur main). */
  clock?: () => number;
}

// Le classement des jeux : une ligne `game_match` par partie finie, une ligne `game_rating` par personne et par jeu. Les écritures passent l'une après l'autre
// (une file unique) : deux parties du même joueur qui finissent en même temps se comptent à la suite, la seconde partant de la note que laisse la première.
export class LadderService {
  private readonly serial = oneAtATimePerKey();
  private readonly clock: () => number;

  constructor(
    private readonly db: Db,
    options: LadderServiceOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
  }

  // Écrit une partie finie, en une transaction : la partie (une seule fois : un même identifiant ne s'écrit pas deux fois), et, si elle est classée, la note de chaque
  // joueur. Rend les notes d'avant et d'après (null : partie non classée), ou null si cette partie était déjà écrite. Une erreur de la base annule tout et rejette.
  record(entry: LadderEntry): Promise<LadderRecord | null> {
    return this.serial('ladder', () =>
      this.db.transaction(async (tx) => {
        const ids = entry.players.map((player) => player.userId);
        entry.players.forEach((player, index) => {
          if (player.seat !== index) throw new Error(`Les joueurs doivent être rangés par siège : le siège ${player.seat} est à l'indice ${index}.`);
        });

        // Les notes d'avant, lues avec un verrou : personne ne les change avant la fin de cette écriture.
        let changes: Array<{ userId: string; before: number; after: number }> | null = null;
        if (entry.ranked) {
          const rows = await tx
            .select()
            .from(gameRating)
            .where(and(eq(gameRating.game, entry.game), inArray(gameRating.userId, ids)))
            .for('update');
          const before = new Map(rows.map((row) => [row.userId, row]));
          changes = eloChanges(
            entry.players.map((player) => ({ userId: player.userId, rating: before.get(player.userId)?.rating ?? ELO_START, games: before.get(player.userId)?.games ?? 0 })),
            entry.result.ranking,
          );
        }

        const inserted = await tx
          .insert(gameMatch)
          .values({
            id: entry.id,
            game: entry.game,
            startedAt: new Date(entry.startedAt),
            endedAt: new Date(entry.endedAt),
            players: entry.players.map((player, index) => ({
              seat: player.seat,
              userId: player.userId,
              name: player.name,
              before: changes?.[index]?.before ?? null,
              after: changes?.[index]?.after ?? null,
            })),
            result: entry.result,
            moves: entry.moves,
            moveCount: entry.moveCount,
            ranked: entry.ranked,
          })
          .onConflictDoNothing({ target: gameMatch.id })
          .returning({ id: gameMatch.id });
        // Déjà écrite : rien d'autre à faire, et surtout pas de nouvelle note.
        if (inserted.length === 0) return null;
        if (changes === null) return { ratings: null };

        // Chacun a gagné, fait nulle ou perdu : seul dans le premier groupe, il gagne ; dans un premier groupe partagé, c'est une nulle ; sinon, une défaite.
        const [best = []] = entry.result.ranking;
        const at = new Date(this.clock());
        for (const [index, change] of changes.entries()) {
          const won = best.length === 1 && best[0] === index;
          const drew = best.length > 1 && best.includes(index);
          await tx
            .insert(gameRating)
            .values({
              userId: change.userId,
              game: entry.game,
              rating: change.after,
              games: 1,
              wins: won ? 1 : 0,
              draws: drew ? 1 : 0,
              losses: won || drew ? 0 : 1,
              updatedAt: at,
            })
            .onConflictDoUpdate({
              target: [gameRating.userId, gameRating.game],
              set: {
                rating: change.after,
                games: sql`${gameRating.games} + 1`,
                wins: sql`${gameRating.wins} + ${won ? 1 : 0}`,
                draws: sql`${gameRating.draws} + ${drew ? 1 : 0}`,
                losses: sql`${gameRating.losses} + ${won || drew ? 0 : 1}`,
                updatedAt: at,
              },
            });
        }
        return { ratings: changes };
      }),
    );
  }

  // Le classement d'un jeu : les GAME_LADDER_TOP premiers (note décroissante, puis plus de parties, puis le nom), et la ligne de cette personne avec son vrai
  // rang, ou null si elle n'a aucune partie classée à ce jeu. Seuls comptent ceux qui ont joué et dont le compte est actif ; le rang est 1 + le nombre de lignes de
  // note strictement plus haute (des ex æquo ont le même : 1, 2, 2, 4). Le nom est celui du compte au moment de la lecture.
  async ladder(game: GameId, userId: string): Promise<{ top: LadderRow[]; me: LadderRow | null }> {
    const rows = await this.db
      .select({
        userId: gameRating.userId,
        name: user.name,
        rating: gameRating.rating,
        games: gameRating.games,
        wins: gameRating.wins,
        losses: gameRating.losses,
        draws: gameRating.draws,
      })
      .from(gameRating)
      .innerJoin(user, eq(user.id, gameRating.userId))
      .where(and(eq(gameRating.game, game), sql`${gameRating.games} > 0`, isNull(user.disabledAt)))
      .orderBy(desc(gameRating.rating), desc(gameRating.games), user.name);
    const ranked: LadderRow[] = rows.map((row) => ({ ...row, rank: 1 + rows.filter((other) => other.rating > row.rating).length }));
    return { top: ranked.slice(0, GAME_LADDER_TOP), me: ranked.find((row) => row.userId === userId) ?? null };
  }
}
