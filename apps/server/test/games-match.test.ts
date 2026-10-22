import { GAME_RECONNECT_MS, GAME_TURN_TIMEOUT_MS, rngFromDice, rollDie, type GameDefinition, type GameResult } from '@bureau/shared';
import { replayMatch } from '@bureau/shared/games/testing';
import { z } from 'zod';
import { describe, expect, test } from 'vitest';
import { ALICE, BASTIEN, CLAIRE, gamesSetup, tictactoe } from './helpers/games';

// Les parties : les coups et leurs refus, la fin et le classement, l'abandon, les délais, la reconnexion, la nulle, le journal. Le jeu est le morpion jetable (une partie
// de cinq coups : Alice 0, 1, 2 contre Bastien 3, 4) ; Alice a le siège 0 et commence quand le tirage vaut 0,1.

// Joue la partie en cinq coups : Alice gagne la ligne du haut.
async function aliceWins(context: ReturnType<typeof gamesSetup>, game: 'connect4' | 'chess' = 'connect4') {
  await context.startMatch(game);
  for (const [who, cell] of [[ALICE, 0], [BASTIEN, 3], [ALICE, 1], [BASTIEN, 4], [ALICE, 2]] as const) {
    expect(await context.play(who, cell, game)).toEqual({ ok: true });
  }
}

describe('jouer un coup', () => {
  test('avant le début de la partie : no_match', async () => {
    const { play } = gamesSetup();
    expect(await play(ALICE, 4, 'connect4', 0)).toEqual({ ok: false, error: 'no_match' });
  });

  test('un spectateur, ou quelqu\'un qui n\'est pas à la table : not_seated', async () => {
    const { startMatch, service, play } = gamesSetup();
    await startMatch();
    await service.run(CLAIRE, { type: 'watch', game: 'connect4' });
    expect(await play(CLAIRE, 4)).toEqual({ ok: false, error: 'not_seated' });
  });

  test('une version périmée : stale, rien ne change', async () => {
    const { startMatch, play, view } = gamesSetup();
    const table = await startMatch();
    expect(await play(ALICE, 4, 'connect4', table.version - 1)).toEqual({ ok: false, error: 'stale' });
    expect(await play(ALICE, 4, 'connect4', table.version + 1)).toEqual({ ok: false, error: 'stale' });
    expect(view().version).toBe(table.version);
  });

  test('un coup de la mauvaise forme : invalid', async () => {
    const { startMatch, service, view } = gamesSetup();
    await startMatch();
    for (const move of [{ cell: 'quatre' }, { cell: 99 }, {}, null, 'x', { cell: 1.5 }]) {
      expect(await service.run(ALICE, { type: 'move', game: 'connect4', version: view().version, move }), JSON.stringify(move)).toEqual({ ok: false, error: 'invalid' });
    }
  });

  test('hors tour : not_your_turn, rien ne change (P9)', async () => {
    const { startMatch, play, view, sent } = gamesSetup();
    const table = await startMatch();
    const before = sent.tables.length;
    expect(await play(BASTIEN, 4)).toEqual({ ok: false, error: 'not_your_turn' });
    expect(view().version).toBe(table.version);
    expect(sent.tables).toHaveLength(before);
  });

  test('un coup illégal : illegal, la version ne bouge pas, rien n\'est diffusé (P11)', async () => {
    const { startMatch, play, view, sent } = gamesSetup();
    await startMatch();
    await play(ALICE, 4);
    const version = view().version;
    const before = sent.tables.length;
    expect(await play(BASTIEN, 4)).toEqual({ ok: false, error: 'illegal' });
    expect(view().version).toBe(version);
    expect(sent.tables).toHaveLength(before);
  });

  test('un coup accepté : la version avance de un, les événements partent avec la table, le délai repart de zéro', async () => {
    const { startMatch, play, view, sent, advance } = gamesSetup();
    const table = await startMatch();
    advance(120_000);
    expect(view().match?.turnMs).toBe(GAME_TURN_TIMEOUT_MS - 120_000);
    expect(await play(ALICE, 4)).toEqual({ ok: true });
    expect(view().version).toBe(table.version + 1);
    expect(sent.tables.at(-1)?.match?.events).toEqual([{ type: 'placed', seat: 0, cell: 4 }]);
    expect(view().match?.turnMs).toBe(GAME_TURN_TIMEOUT_MS);
    // L'état est celui du jeu, et c'est maintenant à Bastien.
    expect(view().match?.state).toMatchObject({ next: 1, moves: 1 });
  });

  test('les événements ne sont dits qu\'une fois : le changement suivant (un spectateur qui arrive) n\'en porte plus', async () => {
    const { startMatch, play, service, sent } = gamesSetup();
    await startMatch();
    await play(ALICE, 4);
    await service.run(CLAIRE, { type: 'watch', game: 'connect4' });
    expect(sent.tables.at(-1)?.match?.events).toEqual([]);
  });

  test('le même coup envoyé deux fois avec la même version : le second est périmé, et une seule diffusion part (P10)', async () => {
    const { startMatch, service, view, sent } = gamesSetup();
    await startMatch();
    const version = view().version;
    const before = sent.tables.length;
    const [first, second] = await Promise.all([
      service.run(ALICE, { type: 'move', game: 'connect4', version, move: { cell: 4 } }),
      service.run(ALICE, { type: 'move', game: 'connect4', version, move: { cell: 4 } }),
    ]);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, error: 'stale' });
    expect(sent.tables).toHaveLength(before + 1);
  });

  test('deux joueurs qui jouent en même temps sur la même version : jugés à la suite, le second sur l\'état du premier', async () => {
    const { startMatch, service, view } = gamesSetup();
    await startMatch();
    const version = view().version;
    const [alice, bastien] = await Promise.all([
      service.run(ALICE, { type: 'move', game: 'connect4', version, move: { cell: 0 } }),
      service.run(BASTIEN, { type: 'move', game: 'connect4', version, move: { cell: 3 } }),
    ]);
    expect(alice).toEqual({ ok: true });
    expect(bastien).toEqual({ ok: false, error: 'stale' });
    expect(view().match?.state).toMatchObject({ moves: 1 });
  });
});

describe('la fin d\'une partie et le classement', () => {
  test('une victoire : le résultat, la partie classée, les notes d\'avant et d\'après, et tout le bureau reçoit la table finie avec les événements du dernier coup', async () => {
    const context = gamesSetup();
    await aliceWins(context);
    const { view, sent, records } = context;
    const match = view().match!;
    expect(match).toMatchObject({
      status: 'ended',
      result: { ranking: [[0], [1]], reason: 'line', detail: { cells: [0, 1, 2] } },
      ranked: true,
      turnMs: null,
      drawOffer: null,
      ratings: [
        { userId: ALICE, before: 1200, after: 1216 },
        { userId: BASTIEN, before: 1200, after: 1184 },
      ],
    });
    expect(sent.tables.at(-1)).toEqual(JSON.parse(JSON.stringify(view())));
    expect(sent.tables.at(-1)?.match?.events).toEqual([{ type: 'placed', seat: 0, cell: 2 }]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'partie-1',
      game: 'connect4',
      players: [{ seat: 0, userId: ALICE, name: 'Alice' }, { seat: 1, userId: BASTIEN, name: 'Bastien' }],
      moveCount: 5,
      ranked: true,
    });
    expect(records[0]!.endedAt).toBeGreaterThanOrEqual(records[0]!.startedAt);
  });

  test('les joueurs restent assis, pas prêts ; la partie finie reste dans la vue jusqu\'à la suivante', async () => {
    const context = gamesSetup();
    await aliceWins(context);
    expect(context.view().chairs.map((chair) => [chair?.userId, chair?.ready])).toEqual([[ALICE, false], [BASTIEN, false]]);
    expect(context.view().match?.status).toBe('ended');
  });

  test('plus aucun coup ni abandon une fois la partie finie', async () => {
    const context = gamesSetup();
    await aliceWins(context);
    expect(await context.play(BASTIEN, 8)).toEqual({ ok: false, error: 'no_match' });
    expect(await context.service.run(BASTIEN, { type: 'resign', game: 'connect4' })).toEqual({ ok: false, error: 'no_match' });
  });

  test('le journal de la partie, rejoué, redonne l\'état final (le journal écrit en base est exact)', async () => {
    const context = gamesSetup();
    await aliceWins(context);
    const state = replayMatch(tictactoe as never, context.records[0]!.moves);
    expect(state).toEqual(context.view().match?.state);
  });

  test('moins de deux coups comptés : la partie est finie mais non classée, et les notes ne bougent pas (P13)', async () => {
    const context = gamesSetup();
    await context.startMatch();
    await context.service.run(ALICE, { type: 'resign', game: 'connect4' });
    expect(context.view().match).toMatchObject({ status: 'ended', ranked: false, ratings: null, result: { reason: 'resign', ranking: [[1], [0]] } });
    expect(context.records[0]).toMatchObject({ ranked: false, moveCount: 0 });
  });

  test('exactement deux coups comptés : classée', async () => {
    const context = gamesSetup();
    await context.startMatch();
    await context.play(ALICE, 0);
    await context.play(BASTIEN, 3);
    await context.service.run(ALICE, { type: 'resign', game: 'connect4' });
    expect(context.view().match).toMatchObject({ ranked: true, result: { reason: 'resign', ranking: [[1], [0]] } });
    expect(context.records[0]).toMatchObject({ ranked: true, moveCount: 2 });
  });

  test('chaque partie n\'est écrite qu\'une fois (P16)', async () => {
    const context = gamesSetup();
    await aliceWins(context);
    await context.service.sweep();
    await context.service.onSocketsGone(BASTIEN);
    expect(context.ladder.record).toHaveBeenCalledTimes(1);
  });

  test('une base en panne : la partie finit quand même, sans notes, l\'erreur est journalisée, et la table n\'est pas bloquée', async () => {
    const context = gamesSetup();
    context.ladder.fail = true;
    await aliceWins(context);
    expect(context.view().match).toMatchObject({ status: 'ended', ratings: null, ranked: true });
    expect(context.logs.errors).toHaveLength(1);
    // La revanche part : la file de la table n'est pas coincée.
    context.ladder.fail = false;
    await context.ready(ALICE);
    await context.ready(BASTIEN);
    expect(context.view().match).toMatchObject({ status: 'playing', id: 'partie-2' });
  });

  test('une partie de dés : les valeurs que le générateur a tirées sont au journal, et le rejeu redonne l\'état final', async () => {
    type Dice = { rolls: number[]; next: number; result: GameResult | null };
    const dice: GameDefinition<Dice, { roll: true }, { type: string; value: number }> = {
      id: 'ludo',
      label: 'Dés',
      minPlayers: 2,
      maxPlayers: 2,
      drawOffers: false,
      moveSchema: z.object({ roll: z.literal(true) }),
      create: (setup) => ({ state: { rolls: [], next: setup.first, result: null }, events: [] }),
      turn: (state) => (state.result === null ? state.next : null),
      legalMoves: (state, seat) => (state.result === null && state.next === seat ? [{ roll: true }] : []),
      apply(state, seat, _move, rng) {
        if (state.result !== null || seat !== state.next) return { ok: false, error: 'not_your_turn' };
        const rolls = [...state.rolls, rollDie(rng)];
        const result: GameResult | null = rolls.length >= 3 ? { ranking: [[0], [1]], reason: 'dés' } : null;
        return { ok: true, state: { rolls, next: 1 - seat, result }, events: [{ type: 'rolled', value: rolls.at(-1)! }] };
      },
      forfeit: (state, seat, reason) => ({ state: { ...state, result: { ranking: [[1 - seat], [seat]], reason } }, events: [] }),
      result: (state) => state.result,
      countedMoves: (state) => state.rolls.length,
      invariants: () => [],
    };
    const context = gamesSetup({ games: { ludo: dice as never } });
    await context.sit(ALICE, 'ludo');
    await context.sit(BASTIEN, 'ludo');
    await context.ready(ALICE, 'ludo');
    await context.ready(BASTIEN, 'ludo');
    // Des dés imposés (débogage de bout en bout) : 6 puis 1, puis le hasard du service.
    await context.service.debugSet('ludo', context.view('ludo').match!.state, [6, 1]);
    for (const who of [ALICE, BASTIEN, ALICE]) {
      await context.service.run(who, { type: 'move', game: 'ludo', version: context.view('ludo').version, move: { roll: true } });
    }
    const final = context.view('ludo').match!;
    expect((final.state as Dice).rolls.slice(0, 2)).toEqual([6, 1]);
    expect(final.status).toBe('ended');
    const entries = context.records[0]!.moves;
    expect(entries.filter((entry) => entry.kind === 'move').map((entry) => (entry.kind === 'move' ? entry.rng : []))[0]).toEqual(rngFromDice([6]));
    expect(replayMatch(dice as never, entries)).toEqual(final.state);
  });
});

describe('revanche : qui commence', () => {
  test('les mêmes joueurs aux mêmes sièges : celui qui commence passe au suivant, à chaque revanche (P8)', async () => {
    const context = gamesSetup();
    const firsts: number[] = [];
    await context.startMatch();
    firsts.push(context.view().match!.first);
    for (let round = 0; round < 3; round++) {
      await context.service.run(ALICE, { type: 'resign', game: 'connect4' });
      await context.ready(ALICE);
      await context.ready(BASTIEN);
      firsts.push(context.view().match!.first);
    }
    expect(firsts).toEqual([0, 1, 0, 1]);
  });

  test('d\'autres joueurs, ou d\'autres sièges : le sort décide de nouveau', async () => {
    const context = gamesSetup();
    await context.startMatch();
    expect(context.view().match!.first).toBe(0);
    await context.service.run(ALICE, { type: 'resign', game: 'connect4' });
    await context.service.run(BASTIEN, { type: 'stand', game: 'connect4' });
    await context.sit(CLAIRE, 'connect4', 1);
    await context.ready(ALICE);
    await context.ready(CLAIRE);
    expect(context.view().match!.players.map((player) => player.userId)).toEqual([ALICE, CLAIRE]);
    // Le tirage (0,1) donne le premier siège : l'alternance, elle, aurait donné le second (celui qui avait commencé la partie d'avant, c'était le premier).
    expect(context.view().match!.first).toBe(0);
  });
});

describe('les délais', () => {
  test('cinq minutes sans jouer : défaite de celui qui a le trait, et pas avant (P14)', async () => {
    const { startMatch, service, advance, view } = gamesSetup();
    await startMatch();
    advance(GAME_TURN_TIMEOUT_MS - 1);
    await service.sweep();
    expect(view().match?.status).toBe('playing');
    advance(1);
    await service.sweep();
    expect(view().match).toMatchObject({ status: 'ended', result: { reason: 'timeout', ranking: [[1], [0]] } });
  });

  test('une action remet le délai à zéro : c\'est alors à l\'autre, et 5 minutes courent de nouveau', async () => {
    const { startMatch, service, advance, view, play } = gamesSetup();
    await startMatch();
    advance(200_000);
    await play(ALICE, 0);
    advance(GAME_TURN_TIMEOUT_MS - 1_000);
    await service.sweep();
    expect(view().match?.status).toBe('playing');
    advance(1_000);
    await service.sweep();
    // C'était à Bastien : il perd.
    expect(view().match).toMatchObject({ status: 'ended', result: { reason: 'timeout', ranking: [[0], [1]] } });
  });

  test('le compte à rebours se lit dans la vue, en ms restantes', async () => {
    const { startMatch, advance, service } = gamesSetup();
    await startMatch();
    advance(100_000);
    expect(service.views().find((table) => table.game === 'connect4')?.match?.turnMs).toBe(GAME_TURN_TIMEOUT_MS - 100_000);
  });
});

describe('la connexion qui tombe, et revient', () => {
  test('la chaise reste, le joueur est déconnecté, et le temps qu\'il lui reste pour revenir diminue (P15)', async () => {
    const { startMatch, service, advance, view } = gamesSetup();
    await startMatch();
    await service.onSocketsGone(ALICE);
    expect(view().chairs[0]).toMatchObject({ userId: ALICE, connected: false });
    expect(view().match?.players[0]).toMatchObject({ connected: false, reconnectMs: GAME_RECONNECT_MS });
    advance(60_000);
    expect(view().match?.players[0]).toMatchObject({ connected: false, reconnectMs: GAME_RECONNECT_MS - 60_000 });
    expect(view().match?.players[1]).toMatchObject({ connected: true, reconnectMs: null });
  });

  test('revenu avant 90 s : la partie continue, sans défaite, et reçoit tout ce qu\'elle avait', async () => {
    const { startMatch, service, advance, view } = gamesSetup();
    await startMatch();
    await service.onSocketsGone(ALICE);
    advance(GAME_RECONNECT_MS - 1);
    await service.onWelcome(ALICE);
    advance(10_000);
    await service.sweep();
    expect(view().match).toMatchObject({ status: 'playing' });
    expect(view().match?.players[0]).toMatchObject({ connected: true, reconnectMs: null });
    expect(view().chairs[0]).toMatchObject({ connected: true });
  });

  test('90 s sans connexion : il sort de la partie (défaite), et sa chaise est libre ensuite', async () => {
    const { startMatch, service, advance, view } = gamesSetup();
    await startMatch();
    await service.onSocketsGone(ALICE);
    advance(GAME_RECONNECT_MS);
    await service.sweep();
    expect(view().match).toMatchObject({ status: 'ended', result: { reason: 'disconnect', ranking: [[1], [0]] } });
    expect(view().chairs[0]).toBeNull();
    expect(view().chairs[1]?.userId).toBe(BASTIEN);
  });

  test('il a quitté le bureau (fin du délai de grâce du monde) : il garde son siège jusqu\'à la fin des 90 s', async () => {
    const { startMatch, service, advance, view } = gamesSetup();
    await startMatch();
    await service.onSocketsGone(ALICE);
    await service.onDepart(ALICE);
    expect(view().chairs[0]?.userId).toBe(ALICE);
    advance(GAME_RECONNECT_MS);
    await service.sweep();
    expect(view().match?.result?.reason).toBe('disconnect');
  });

  test('le délai de 5 minutes ne s\'arrête pas pendant la coupure', async () => {
    const { startMatch, service, advance, view } = gamesSetup();
    await startMatch();
    advance(50_000);
    await service.onSocketsGone(BASTIEN);
    advance(30_000);
    await service.onWelcome(BASTIEN);
    expect(view().match?.turnMs).toBe(GAME_TURN_TIMEOUT_MS - 80_000);
  });

  test('la connexion et le délai du coup tombent ensemble : une seule sortie, la première échue', async () => {
    const { startMatch, service, advance, view } = gamesSetup();
    await startMatch();
    advance(100_000);
    await service.onSocketsGone(BASTIEN);
    // Bastien : 90 s après sa coupure (à 190 s) ; Alice, qui a le trait : 300 s après le début. À 400 s, les deux sont échus, Bastien le premier.
    advance(300_000);
    await service.sweep();
    expect(view().match).toMatchObject({ status: 'ended', result: { reason: 'disconnect', ranking: [[0], [1]] } });
  });

  test('un membre retiré : défaite tout de suite, chaise libre (P25)', async () => {
    const { startMatch, service, view } = gamesSetup();
    await startMatch();
    await service.onRemoved(ALICE);
    expect(view().match).toMatchObject({ status: 'ended', result: { reason: 'disconnect', ranking: [[1], [0]] } });
    expect(view().chairs[0]).toBeNull();
  });
});

describe('la nulle par accord', () => {
  // Les échecs ont la nulle ; ici le morpion qui l'offre, à leur table. Alice (siège 0) commence.
  async function twoMoves(context: ReturnType<typeof gamesSetup>) {
    await context.startMatch('chess');
    await context.play(ALICE, 0, 'chess');
    await context.play(BASTIEN, 3, 'chess');
  }
  const draw = (context: ReturnType<typeof gamesSetup>, who: string, action: 'offer' | 'accept' | 'decline') => context.service.run(who, { type: 'draw', game: 'chess', action });

  test('un jeu qui ne l\'offre pas : invalid', async () => {
    const context = gamesSetup();
    await context.startMatch('connect4');
    expect(await context.service.run(ALICE, { type: 'draw', game: 'connect4', action: 'offer' })).toEqual({ ok: false, error: 'invalid' });
  });

  test('sans partie : no_match ; un spectateur : not_seated', async () => {
    const context = gamesSetup();
    expect(await draw(context, ALICE, 'offer')).toEqual({ ok: false, error: 'no_match' });
    await context.startMatch('chess');
    await context.service.run(CLAIRE, { type: 'watch', game: 'chess' });
    expect(await draw(context, CLAIRE, 'offer')).toEqual({ ok: false, error: 'not_seated' });
  });

  test('avant deux coups comptés : too_early (P23)', async () => {
    const context = gamesSetup();
    await context.startMatch('chess');
    expect(await draw(context, ALICE, 'offer')).toEqual({ ok: false, error: 'too_early' });
    await context.play(ALICE, 0, 'chess');
    expect(await draw(context, BASTIEN, 'offer')).toEqual({ ok: false, error: 'too_early' });
  });

  test('une offre : la vue dit qui la fait ; une seconde offre pendant la première : already_offered', async () => {
    const context = gamesSetup();
    await twoMoves(context);
    expect(await draw(context, ALICE, 'offer')).toEqual({ ok: true });
    expect(context.view('chess').match?.drawOffer).toBe(0);
    expect(await draw(context, ALICE, 'offer')).toEqual({ ok: false, error: 'already_offered' });
    expect(await draw(context, BASTIEN, 'offer')).toEqual({ ok: false, error: 'already_offered' });
  });

  test('accepter : la partie finit à égalité, raison « agreement », classée ; le journal garde la nulle', async () => {
    const context = gamesSetup();
    await twoMoves(context);
    await draw(context, ALICE, 'offer');
    expect(await draw(context, BASTIEN, 'accept')).toEqual({ ok: true });
    expect(context.view('chess').match).toMatchObject({ status: 'ended', result: { ranking: [[0, 1]], reason: 'agreement' }, ranked: true, drawOffer: null });
    expect(context.records[0]!.moves.at(-1)).toMatchObject({ kind: 'draw' });
  });

  test('accepter sans offre, ou sa propre offre : no_offer', async () => {
    const context = gamesSetup();
    await twoMoves(context);
    expect(await draw(context, BASTIEN, 'accept')).toEqual({ ok: false, error: 'no_offer' });
    await draw(context, ALICE, 'offer');
    expect(await draw(context, ALICE, 'accept')).toEqual({ ok: false, error: 'no_offer' });
    expect(await draw(context, ALICE, 'decline')).toEqual({ ok: false, error: 'no_offer' });
  });

  test('refuser : l\'offre tombe ; et on ne la refait pas avant d\'avoir joué un coup', async () => {
    const context = gamesSetup();
    await twoMoves(context);
    await draw(context, ALICE, 'offer');
    expect(await draw(context, BASTIEN, 'decline')).toEqual({ ok: true });
    expect(context.view('chess').match?.drawOffer).toBeNull();
    expect(await draw(context, ALICE, 'offer')).toEqual({ ok: false, error: 'too_early' });
    // Alice joue, Bastien joue : elle peut proposer de nouveau.
    await context.play(ALICE, 1, 'chess');
    await context.play(BASTIEN, 4, 'chess');
    expect(await draw(context, ALICE, 'offer')).toEqual({ ok: true });
  });

  test('un coup de l\'adversaire retire l\'offre', async () => {
    const context = gamesSetup();
    await twoMoves(context);
    await draw(context, ALICE, 'offer');
    // Son propre coup ne la retire pas ; celui de l\'autre, si.
    await context.play(ALICE, 1, 'chess');
    expect(context.view('chess').match?.drawOffer).toBe(0);
    await context.play(BASTIEN, 4, 'chess');
    expect(context.view('chess').match?.drawOffer).toBeNull();
  });

  test('l\'offre tombe aussi quand celui qui l\'a faite quitte la partie', async () => {
    const context = gamesSetup();
    await twoMoves(context);
    await draw(context, ALICE, 'offer');
    await context.service.run(ALICE, { type: 'resign', game: 'chess' });
    expect(context.view('chess').match?.drawOffer).toBeNull();
  });
});

describe('le débogage des tests de bout en bout', () => {
  test('un état fabriqué remplace celui de la partie, et la version avance ; le journal le garde', async () => {
    const { startMatch, service, view, records } = gamesSetup();
    const table = await startMatch();
    const state = { cells: [0, 0, null, 1, 1, null, null, null, null], next: 0, moves: 4, result: null };
    await service.debugSet('connect4', state);
    expect(view().match?.state).toEqual(state);
    expect(view().version).toBe(table.version + 1);
    // Alice joue le coup qui lui donne la partie : classée, puisque l'état fabriqué compte quatre coups.
    await service.run(ALICE, { type: 'move', game: 'connect4', version: view().version, move: { cell: 2 } });
    expect(view().match).toMatchObject({ status: 'ended', ranked: true });
    expect(records[0]!.moves.some((entry) => entry.kind === 'debug')).toBe(true);
  });

  test('un état qui ne passe pas les invariants, ou sans personne au trait, est ignoré', async () => {
    const { startMatch, service, view } = gamesSetup();
    const table = await startMatch();
    await service.debugSet('connect4', { cells: [], next: 0, moves: 0, result: null });
    await service.debugSet('connect4', { cells: [0, 1, 0, 1, 0, 1, 1, 0, 1], next: 0, moves: 9, result: { ranking: [[0, 1]], reason: 'full' } });
    expect(view().version).toBe(table.version);
  });

  test('sans partie en cours : ignoré', async () => {
    const { service, view } = gamesSetup();
    await service.debugSet('connect4', { cells: [], next: 0, moves: 0, result: null });
    expect(view().version).toBe(0);
  });
});
