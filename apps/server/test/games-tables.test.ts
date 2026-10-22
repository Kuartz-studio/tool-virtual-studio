import { DEV_OFFICE, buildTiledMap, parseOfficeMap, type GameTableView } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { ALICE, BASTIEN, CLAIRE, DAN, OUTSIDE, gamesSetup, tictactoe } from './helpers/games';

// Les tables, les chaises, les spectateurs et le « prêt » : tout ce qui précède la première partie. Le service n'a ni socket ni base : un faux monde, une horloge
// qu'on fait avancer, et ce qu'il dit noté dans l'ordre (voir helpers/games.ts).

const lastTable = (sent: GameTableView[], game: string) => [...sent].reverse().find((view) => view.game === game)!;

describe('les tables de la carte', () => {
  test('une table par jeu de la carte, avec autant de chaises que la carte en donne, toutes libres, sans partie', () => {
    const { service } = gamesSetup();
    const views = service.views();
    expect(views.map((view) => [view.game, view.chairs.length])).toEqual([['chess', 2], ['backgammon', 2], ['connect4', 2], ['ludo', 4]]);
    for (const view of views) {
      expect(view.version).toBe(0);
      expect(view.chairs.every((chair) => chair === null)).toBe(true);
      expect(view.spectators).toEqual([]);
      expect(view.match).toBeNull();
    }
  });

  test('une carte sans table (la petite carte de développement) : aucune vue, et toute commande répond unknown_game', async () => {
    const map = parseOfficeMap(buildTiledMap({ ascii: DEV_OFFICE.ascii, zones: DEV_OFFICE.zones, tileset: { name: 'dev', image: '../dev/tiles.png' } }));
    const { service } = gamesSetup({ map });
    expect(service.views()).toEqual([]);
    expect(await service.run(ALICE, { type: 'sit', game: 'chess' })).toEqual({ ok: false, error: 'unknown_game' });
    expect(await service.run(ALICE, { type: 'watch', game: 'chess' })).toEqual({ ok: false, error: 'unknown_game' });
  });
});

describe('regarder une table', () => {
  test('hors de la salle qui contient la table : too_far, rien ne change', async () => {
    const { service, player, sent } = gamesSetup();
    Object.assign(player(ALICE), OUTSIDE);
    expect(await service.run(ALICE, { type: 'watch', game: 'connect4' })).toEqual({ ok: false, error: 'too_far' });
    expect(sent.tables).toEqual([]);
  });

  test('dans la salle : spectatrice de la table, et tout le bureau reçoit la table avec sa version + 1', async () => {
    const { service, sent } = gamesSetup();
    expect(await service.run(ALICE, { type: 'watch', game: 'connect4' })).toEqual({ ok: true });
    expect(sent.tables).toHaveLength(1);
    expect(sent.tables[0]).toMatchObject({ game: 'connect4', version: 1, spectators: [{ id: ALICE, name: 'Alice' }] });
  });

  test('regarder deux fois la même table ne diffuse rien de plus', async () => {
    const { service, sent } = gamesSetup();
    await service.run(ALICE, { type: 'watch', game: 'connect4' });
    await service.run(ALICE, { type: 'watch', game: 'connect4' });
    expect(sent.tables).toHaveLength(1);
  });

  test('une personne ne regarde qu\'une table : en regarder une autre quitte la première (les deux sont rediffusées)', async () => {
    const { service, sent } = gamesSetup();
    await service.run(ALICE, { type: 'watch', game: 'connect4' });
    await service.run(ALICE, { type: 'watch', game: 'chess' });
    expect(lastTable(sent.tables, 'connect4').spectators).toEqual([]);
    expect(lastTable(sent.tables, 'chess').spectators).toEqual([{ id: ALICE, name: 'Alice' }]);
  });

  test('« unwatch » la retire ; sans effet, ni diffusion, si elle ne regardait pas', async () => {
    const { service, sent } = gamesSetup();
    await service.run(ALICE, { type: 'unwatch', game: 'connect4' });
    expect(sent.tables).toEqual([]);
    await service.run(ALICE, { type: 'watch', game: 'connect4' });
    await service.run(ALICE, { type: 'unwatch', game: 'connect4' });
    expect(lastTable(sent.tables, 'connect4').spectators).toEqual([]);
  });

  test('plusieurs spectateurs, dans l\'ordre où ils sont arrivés', async () => {
    const { service, view } = gamesSetup();
    await service.run(CLAIRE, { type: 'watch', game: 'connect4' });
    await service.run(ALICE, { type: 'watch', game: 'connect4' });
    expect(view().spectators.map((spectator) => spectator.id)).toEqual([CLAIRE, ALICE]);
  });

  test('quelqu\'un d\'assis y reste libre de regarder même quand il s\'est éloigné de la salle (il joue, ou attend)', async () => {
    const { service, player, sit } = gamesSetup();
    await sit(ALICE);
    Object.assign(player(ALICE), OUTSIDE);
    expect(await service.run(ALICE, { type: 'watch', game: 'connect4' })).toEqual({ ok: true });
  });
});

describe('s\'asseoir', () => {
  test('hors de la salle : too_far', async () => {
    const { sit, player } = gamesSetup();
    Object.assign(player(ALICE), OUTSIDE);
    expect(await sit(ALICE)).toEqual({ ok: false, error: 'too_far' });
  });

  test('à la première chaise libre, pas prête, connectée ; avec son nom et son avatar', async () => {
    const { sit, view, player } = gamesSetup();
    player(ALICE).avatarKey = 'fox';
    expect(await sit(ALICE)).toEqual({ ok: true });
    expect(await sit(BASTIEN)).toEqual({ ok: true });
    expect(view().chairs).toEqual([
      { userId: ALICE, name: 'Alice', avatarKey: 'fox', ready: false, connected: true },
      { userId: BASTIEN, name: 'Bastien', avatarKey: null, ready: false, connected: true },
    ]);
    expect(view().version).toBe(2);
  });

  test('à la chaise demandée, et chair_taken si elle est prise', async () => {
    const { sit, view } = gamesSetup();
    expect(await sit(ALICE, 'connect4', 1)).toEqual({ ok: true });
    expect(view().chairs[0]).toBeNull();
    expect(view().chairs[1]?.userId).toBe(ALICE);
    expect(await sit(BASTIEN, 'connect4', 1)).toEqual({ ok: false, error: 'chair_taken' });
  });

  test('une chaise qui n\'existe pas : invalid', async () => {
    const { sit } = gamesSetup();
    expect(await sit(ALICE, 'connect4', 3)).toEqual({ ok: false, error: 'invalid' });
  });

  test('table pleine : table_full ; déjà assis ici : already_here', async () => {
    const { sit } = gamesSetup();
    await sit(ALICE);
    expect(await sit(ALICE)).toEqual({ ok: false, error: 'already_here' });
    await sit(BASTIEN);
    expect(await sit(CLAIRE)).toEqual({ ok: false, error: 'table_full' });
  });

  test('s\'asseoir retire des spectateurs de toutes les tables', async () => {
    const { service, sit, view } = gamesSetup();
    await service.run(ALICE, { type: 'watch', game: 'chess' });
    await sit(ALICE, 'connect4');
    expect(view('chess').spectators).toEqual([]);
    expect(view('connect4').spectators).toEqual([]);
  });

  test('quelqu\'un qui regardait cette table et s\'y assoit n\'est plus spectateur', async () => {
    const { service, sit, view } = gamesSetup();
    await service.run(ALICE, { type: 'watch', game: 'connect4' });
    await sit(ALICE);
    expect(view().spectators).toEqual([]);
    expect(view().chairs[0]?.userId).toBe(ALICE);
  });

  test('une personne qui attendait à une table la quitte en s\'asseyant à une autre (les deux tables sont rediffusées)', async () => {
    const { sit, view, sent } = gamesSetup();
    await sit(ALICE, 'chess');
    expect(await sit(ALICE, 'connect4')).toEqual({ ok: true });
    expect(view('chess').chairs).toEqual([null, null]);
    expect(view('connect4').chairs[0]?.userId).toBe(ALICE);
    expect(lastTable(sent.tables, 'chess').chairs).toEqual([null, null]);
  });

  test('pendant une partie à cette table : in_progress ; joueuse d\'une partie ailleurs : busy', async () => {
    const { sit, startMatch } = gamesSetup();
    await startMatch('connect4');
    expect(await sit(CLAIRE, 'connect4')).toEqual({ ok: false, error: 'in_progress' });
    expect(await sit(ALICE, 'chess')).toEqual({ ok: false, error: 'busy' });
  });

  test('on peut s\'asseoir à une table dont la partie est finie (la suivante)', async () => {
    const { sit, startMatch, service, seatOf } = gamesSetup();
    await startMatch('connect4');
    await service.run(ALICE, { type: 'resign', game: 'connect4' });
    expect(seatOf(ALICE)).toBe(0);
    await service.run(ALICE, { type: 'stand', game: 'connect4' });
    expect(await sit(CLAIRE, 'connect4', 0)).toEqual({ ok: true });
  });
});

describe('se lever', () => {
  test('pas assis : not_seated', async () => {
    const { service } = gamesSetup();
    expect(await service.run(ALICE, { type: 'stand', game: 'connect4' })).toEqual({ ok: false, error: 'not_seated' });
  });

  test('la chaise est libre, et la personne reste spectatrice', async () => {
    const { service, sit, view } = gamesSetup();
    await sit(ALICE);
    expect(await service.run(ALICE, { type: 'stand', game: 'connect4' })).toEqual({ ok: true });
    expect(view().chairs).toEqual([null, null]);
    expect(view().spectators).toEqual([{ id: ALICE, name: 'Alice' }]);
  });

  test('joueuse d\'une partie en cours : in_progress, il faut abandonner', async () => {
    const { service, startMatch } = gamesSetup();
    await startMatch();
    expect(await service.run(ALICE, { type: 'stand', game: 'connect4' })).toEqual({ ok: false, error: 'in_progress' });
  });

  test('une partie finie : on peut se lever', async () => {
    const { service, startMatch, view } = gamesSetup();
    await startMatch();
    await service.run(BASTIEN, { type: 'resign', game: 'connect4' });
    expect(await service.run(BASTIEN, { type: 'stand', game: 'connect4' })).toEqual({ ok: true });
    expect(view().chairs[1]).toBeNull();
    // La partie finie reste dans la vue, jusqu'à la suivante.
    expect(view().match?.status).toBe('ended');
  });
});

describe('« prêt » et le début de la partie', () => {
  test('pas assis : not_seated', async () => {
    const { ready } = gamesSetup();
    expect(await ready(ALICE)).toEqual({ ok: false, error: 'not_seated' });
  });

  test('prêt, puis plus prêt : la chaise le dit, la partie ne commence pas avec une seule personne', async () => {
    const { sit, ready, view } = gamesSetup();
    await sit(ALICE);
    // Une seule personne, prête : la partie ne commence pas (le morpion se joue à deux), sans erreur.
    expect(await ready(ALICE)).toEqual({ ok: true });
    expect(view().chairs[0]?.ready).toBe(true);
    expect(view().match).toBeNull();
    await ready(ALICE, 'connect4', false);
    expect(view().chairs[0]?.ready).toBe(false);
  });

  test('deux assis, prêts : la partie commence (P8)', async () => {
    const { startMatch } = gamesSetup();
    const table = await startMatch();
    expect(table.match).toMatchObject({ id: 'partie-1', status: 'playing', first: 0, drawOffer: null, ranked: null, ratings: null, result: null, events: [] });
    expect(table.match?.players.map((player) => player.userId)).toEqual([ALICE, BASTIEN]);
    expect(table.match?.turnMs).toBe(300_000);
    // Les chaises ne sont plus « prêtes » : le drapeau est remis à zéro.
    expect(table.chairs.map((chair) => chair?.ready)).toEqual([false, false]);
  });

  test('un seul des deux prêt : pas de partie ; le second le devient : elle commence', async () => {
    const { sit, ready, view } = gamesSetup();
    await sit(ALICE);
    await sit(BASTIEN);
    await ready(ALICE);
    expect(view().match).toBeNull();
    await ready(BASTIEN);
    expect(view().match?.status).toBe('playing');
  });

  test('quelqu\'un de déconnecté retarde le début : il faut tous les assis, prêts et connectés', async () => {
    const { sit, ready, view, service } = gamesSetup();
    await sit(ALICE);
    await sit(BASTIEN);
    await ready(ALICE);
    await service.onSocketsGone(BASTIEN);
    // Il revient, se dit prêt : la partie peut commencer.
    await service.onWelcome(BASTIEN);
    await ready(BASTIEN);
    expect(view().match?.status).toBe('playing');
  });

  test('« prêt » pendant une partie : in_progress', async () => {
    const { ready, startMatch } = gamesSetup();
    await startMatch();
    expect(await ready(ALICE)).toEqual({ ok: false, error: 'in_progress' });
  });

  test('le siège qui commence est tiré au sort : 0,1 donne le premier siège, 0,9 le second', async () => {
    for (const [random, first] of [[0.1, 0], [0.9, 1]] as const) {
      const context = gamesSetup();
      context.random.value = random;
      const table = await context.startMatch();
      expect(table.match?.first, `tirage ${random}`).toBe(first);
    }
  });

  test('un jeu que le registre ne connaît pas (« Bientôt ») : on s\'assoit et on se dit prêt, mais la partie ne commence pas', async () => {
    const { sit, ready, view } = gamesSetup({ games: {} });
    await sit(ALICE);
    await sit(BASTIEN);
    expect(await ready(ALICE)).toEqual({ ok: true });
    expect(await ready(BASTIEN)).toEqual({ ok: true });
    expect(view().match).toBeNull();
    expect(view().chairs.map((chair) => chair?.ready)).toEqual([true, true]);
  });

  test('plus de personnes assises que le jeu n\'a de joueurs au plus : la partie ne commence pas, sans erreur', async () => {
    // La table des petits chevaux a quatre chaises ; le morpion, mis à sa place, ne se joue qu'à deux.
    const { sit, ready, view, logs } = gamesSetup({ games: { ludo: tictactoe as never } });
    await sit(ALICE, 'ludo');
    await sit(BASTIEN, 'ludo');
    await sit(CLAIRE, 'ludo');
    await ready(ALICE, 'ludo');
    await ready(BASTIEN, 'ludo');
    expect(await ready(CLAIRE, 'ludo')).toEqual({ ok: true });
    expect(view('ludo').match).toBeNull();
    expect(logs.errors).toEqual([]);
  });
});

describe('quand tout le bureau le voit', () => {
  test('chaque changement diffuse la table entière : le même objet pour tous, sans le générateur ni le journal (P17)', async () => {
    const { startMatch, sent, play, service } = gamesSetup();
    await startMatch();
    await play(ALICE, 4);
    const lastView = sent.tables.at(-1)!;
    // Les seules clés d'une table et d'une partie : ni générateur, ni graine, ni journal. (Les clés de l'état du jeu lui sont propres.)
    expect(Object.keys(lastView).sort()).toEqual(['chairs', 'game', 'match', 'spectators', 'version']);
    expect(Object.keys(lastView.match!).sort()).toEqual(['drawOffer', 'events', 'first', 'id', 'players', 'ranked', 'ratings', 'result', 'startedAt', 'state', 'status', 'turnMs']);
    expect(JSON.stringify(lastView)).not.toMatch(/"(rng|seed|log)"/);
    // Un spectateur, un joueur ou une personne qui arrive lisent la même vue.
    expect(JSON.parse(JSON.stringify(service.views().find((table) => table.game === 'connect4')))).toEqual(lastView);
  });

  test('la version ne fait que croître, et jamais deux changements sous la même version', async () => {
    const { startMatch, sent, play, service } = gamesSetup();
    await startMatch();
    await play(ALICE, 0);
    await play(BASTIEN, 3);
    await service.run(CLAIRE, { type: 'watch', game: 'connect4' });
    const versions = sent.tables.filter((table) => table.game === 'connect4').map((table) => table.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  test('le nom d\'une chaise est celui de la personne au moment de s\'asseoir, et un profil changé met toutes les tables à jour (P8)', async () => {
    const { service, view, sent, startMatch } = gamesSetup();
    await startMatch('connect4');
    await service.run(CLAIRE, { type: 'watch', game: 'connect4' });
    sent.tables.length = 0;
    await service.profileChanged(ALICE, 'Alix', 'owl');
    await service.profileChanged(CLAIRE, 'Clairette', null);
    expect(view().chairs[0]).toMatchObject({ name: 'Alix', avatarKey: 'owl' });
    expect(view().match?.players[0]).toMatchObject({ name: 'Alix', avatarKey: 'owl' });
    expect(view().spectators).toEqual([{ id: CLAIRE, name: 'Clairette' }]);
    expect(sent.tables.length).toBeGreaterThan(0);
    // Quelqu'un qui n'est ni assis ni spectateur : rien à rediffuser.
    sent.tables.length = 0;
    await service.profileChanged(DAN, 'Daniel', null);
    expect(sent.tables).toEqual([]);
  });
});

describe('les chaises que personne n\'occupe plus vraiment', () => {
  test('une chaise occupée sans partie se libère au bout de 10 minutes, depuis le dernier geste : s\'asseoir, ou « prêt »', async () => {
    const { sit, ready, service, advance, view } = gamesSetup();
    await sit(ALICE);
    advance(9 * 60_000);
    await service.sweep();
    expect(view().chairs[0]?.userId).toBe(ALICE);
    // Un geste remet le délai à zéro.
    await ready(ALICE);
    advance(9 * 60_000);
    await service.sweep();
    expect(view().chairs[0]?.userId).toBe(ALICE);
    // Dix minutes pile depuis le dernier geste : la chaise est libre.
    advance(60_000);
    await service.sweep();
    expect(view().chairs[0]).toBeNull();
    // Elle reste spectatrice, comme quand on se lève.
    expect(view().spectators.map((spectator) => spectator.id)).toEqual([ALICE]);
  });

  test('pas pendant une partie : ceux qui jouent gardent leur chaise', async () => {
    const { startMatch, service, advance, view } = gamesSetup();
    await startMatch();
    advance(11 * 60_000);
    // Le délai du coup (5 minutes) est déjà passé : l'un des deux a perdu, mais personne ne se lève.
    await service.sweep();
    expect(view().chairs.map((chair) => chair?.userId)).toEqual([ALICE, BASTIEN]);
  });
});

describe('quand quelqu\'un s\'éloigne ou part', () => {
  test('sa connexion tombe : assis sans partie, pas prêt et déconnecté ; spectateur, retiré', async () => {
    const { sit, service, view } = gamesSetup();
    await sit(ALICE);
    await service.run(ALICE, { type: 'ready', game: 'connect4', ready: true });
    await service.run(BASTIEN, { type: 'watch', game: 'connect4' });
    await service.onSocketsGone(ALICE);
    await service.onSocketsGone(BASTIEN);
    expect(view().chairs[0]).toMatchObject({ userId: ALICE, ready: false, connected: false });
    expect(view().spectators).toEqual([]);
  });

  test('elle revient : la chaise est connectée de nouveau', async () => {
    const { sit, service, view } = gamesSetup();
    await sit(ALICE);
    await service.onSocketsGone(ALICE);
    await service.onWelcome(ALICE);
    expect(view().chairs[0]).toMatchObject({ userId: ALICE, connected: true });
  });

  test('elle quitte le bureau (fin du délai de grâce) : la chaise où elle attendait est libre', async () => {
    const { sit, service, view } = gamesSetup();
    await sit(ALICE);
    await service.onSocketsGone(ALICE);
    await service.onDepart(ALICE);
    expect(view().chairs).toEqual([null, null]);
  });

  test('un membre retiré : sa chaise est libre tout de suite, et il n\'est plus spectateur', async () => {
    const { sit, service, view } = gamesSetup();
    await sit(ALICE);
    await service.run(BASTIEN, { type: 'watch', game: 'chess' });
    await service.onRemoved(ALICE);
    await service.onRemoved(BASTIEN);
    expect(view().chairs).toEqual([null, null]);
    expect(view('chess').spectators).toEqual([]);
  });

  test('arrêté, le service ne fait plus rien : plus de balayage, plus de partie écrite (P26)', async () => {
    const { startMatch, service, advance, records, view } = gamesSetup();
    await startMatch();
    service.stop();
    advance(600_000);
    await service.sweep();
    expect(records).toEqual([]);
    expect(view().match?.status).toBe('playing');
    // Plus aucune commande ne passe, ni aucun avis de présence.
    expect(await service.run(CLAIRE, { type: 'watch', game: 'chess' })).toEqual({ ok: false, error: 'unavailable' });
    await service.onRemoved(ALICE);
    expect(view().match?.status).toBe('playing');
  });
});
