import {
  GAME_RECONNECT_MS,
  buildOfficeTiledMap,
  parseOfficeMap,
  type ActivityState,
  type AnyGameDefinition,
  type GameId,
  type GameInvite,
  type GameNotice,
  type GameTableView,
  type MatchLogEntry,
  type OfficeMap,
  type Status,
} from '@bureau/shared';
import { makeTicTacToe } from '@bureau/shared/games/testing';
import type { Logger } from 'pino';
import { vi } from 'vitest';
import { GamesService, type GamesDeps, type GamesPlayer } from '../../src/games/games-service';
import type { LadderEntry, LadderRecord } from '../../src/games/ladder-service';

// La vraie carte du bureau : ses quatre tables de jeu (échecs, backgammon, Puissance 4 : deux chaises ; petits chevaux : quatre) et sa salle de jeu.
export const officeMap = parseOfficeMap(buildOfficeTiledMap());

// Un point dans la salle de jeux, entre ses quatre tables, et un autre bien ailleurs (l'accueil).
export const IN_GAME_ROOM = { x: 74 * 32, y: 27 * 32 };
export const OUTSIDE = { x: 16 * 32 + 16, y: 41 * 32 + 16 };

// Les trois jeux de la carte que les tests essaient avec le morpion : `connect4` sans nulle par accord, `chess` avec.
export const tictactoe = makeTicTacToe('connect4');
export const tictactoeWithDraws = makeTicTacToe('chess', { drawOffers: true });
export const TEST_GAMES: Partial<Record<GameId, AnyGameDefinition>> = { connect4: tictactoe as never, chess: tictactoeWithDraws as never };

export interface FakePlayer extends GamesPlayer {
  online: boolean;
}

export const ALICE = 'alice';
export const BASTIEN = 'bastien';
export const CLAIRE = 'claire';
export const DAN = 'dan';

// Un service des jeux au-dessus d'un monde en carton : des joueurs qu'on pose où l'on veut, une horloge qu'on fait avancer, ce que le service dit (tables, invitations,
// avis) noté dans l'ordre, ceux qu'il téléporte, et les parties qu'il remet au classement (que `ladder` peut aussi faire échouer).
export function gamesSetup(options: { map?: OfficeMap; games?: Partial<Record<GameId, AnyGameDefinition>>; ids?: string[]; random?: () => number } = {}) {
  const clock = { mono: 5_000, wall: 1_800_000_000_000 };
  const advance = (ms: number) => {
    clock.mono += ms;
    clock.wall += ms;
  };

  const players = new Map<string, FakePlayer>();
  const ids = options.ids ?? [ALICE, BASTIEN, CLAIRE, DAN];
  for (const id of ids) {
    players.set(id, { name: id[0]!.toUpperCase() + id.slice(1), avatarKey: null, ...IN_GAME_ROOM, status: 'available', activity: null, online: true });
  }
  const player = (id: string) => players.get(id)!;

  const sent = {
    tables: [] as GameTableView[],
    invites: [] as Array<{ to: string; invite: GameInvite }>,
    gone: [] as Array<{ to: string; id: string; reason: string }>,
    notices: [] as Array<{ to: string; notice: GameNotice }>,
  };
  const arrivals: Array<{ userId: string; game: GameId; chair: number | null }> = [];
  const records: LadderEntry[] = [];
  const ladder = {
    fail: false,
    // Les notes que « la base » rend : 1216 pour le premier du classement, 1184 pour les autres (de quoi voir qu'elles arrivent dans la vue).
    record: vi.fn(async (entry: LadderEntry): Promise<LadderRecord | null> => {
      if (ladder.fail) throw new Error('base en panne');
      records.push(entry);
      return entry.ranked
        ? { ratings: entry.players.map((p, index) => ({ userId: p.userId, before: 1200, after: entry.result.ranking[0]?.includes(index) ? 1216 : 1184 })) }
        : { ratings: null };
    }),
  };
  const logs = { errors: [] as unknown[][], warnings: [] as unknown[][] };
  const logger = { error: (...args: unknown[]) => logs.errors.push(args), warn: (...args: unknown[]) => logs.warnings.push(args) } as unknown as Logger;

  const random = { value: 0.1 };
  const inviteAllowed = { value: true };
  let counter = 0;
  const deps: GamesDeps = {
    map: options.map ?? officeMap,
    games: options.games ?? TEST_GAMES,
    ladder,
    players: { get: (id) => players.get(id) },
    isOnline: (id) => players.get(id)?.online === true,
    arrive: (userId, game, chair) => {
      arrivals.push({ userId, game, chair });
      const me = players.get(userId);
      if (me) Object.assign(me, IN_GAME_ROOM);
    },
    inviteAllowed: () => inviteAllowed.value,
    out: {
      table: (view) => sent.tables.push(JSON.parse(JSON.stringify(view)) as GameTableView),
      invite: (to, invite) => sent.invites.push({ to, invite }),
      inviteGone: (to, gone) => sent.gone.push({ to, ...gone }),
      notice: (to, notice) => sent.notices.push({ to, notice }),
    },
    now: () => clock.mono,
    clock: () => clock.wall,
    rng: options.random ?? (() => random.value),
    newId: () => `partie-${++counter}`,
    logger,
  };
  const service = new GamesService(deps);

  // Les commandes les plus courantes, qui rendent l'accusé.
  const sit = (userId: string, game: GameId = 'connect4', chair?: number) => service.run(userId, { type: 'sit', game, ...(chair === undefined ? {} : { chair }) });
  const ready = (userId: string, game: GameId = 'connect4', isReady = true) => service.run(userId, { type: 'ready', game, ready: isReady });
  const view = (game: GameId = 'connect4'): GameTableView => service.views().find((table) => table.game === game)!;
  // Deux personnes assises et prêtes : la partie commence. Alice a la chaise 0, Bastien la 1.
  async function startMatch(game: GameId = 'connect4') {
    await sit(ALICE, game);
    await sit(BASTIEN, game);
    await ready(ALICE, game);
    await ready(BASTIEN, game);
    return view(game);
  }
  // Le siège de cette personne dans la partie en cours.
  const seatOf = (userId: string, game: GameId = 'connect4') => view(game).match!.players.findIndex((p) => p.userId === userId);
  // Joue ce coup (la case du morpion) pour ce joueur, avec la version de la table du moment (ou celle donnée).
  const play = (userId: string, cell: number, game: GameId = 'connect4', version: number = view(game).version) =>
    service.run(userId, { type: 'move', game, version, move: { cell } });

  return { service, deps, clock, advance, players, player, sent, arrivals, records, ladder, logs, random, inviteAllowed, sit, ready, view, startMatch, seatOf, play, GAME_RECONNECT_MS };
}

export type GamesContext = ReturnType<typeof gamesSetup>;
export type { MatchLogEntry, Status, ActivityState };
