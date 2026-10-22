import { GAME_INVITE_TTL_MS } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { ALICE, BASTIEN, CLAIRE, DAN, OUTSIDE, gamesSetup, tictactoe } from './helpers/games';

// Les invitations à une table : qui peut inviter qui, la réponse (accepter téléporte et assoit, ou fait regarder), le délai de 60 s, et ce qui les fait tomber.

const EVE = 'eve';
const FAY = 'fay';

// Alice est assise à la table du Puissance 4 ; les autres sont dans la salle.
async function aliceSeated(options: Parameters<typeof gamesSetup>[0] = {}) {
  const context = gamesSetup({ ids: [ALICE, BASTIEN, CLAIRE, DAN, EVE, FAY], ...options });
  await context.sit(ALICE);
  const invite = (userId: string, who: string = ALICE) => context.service.run(who, { type: 'invite', game: 'connect4', userId });
  const answer = (userId: string, id: string, accept: boolean) => context.service.run(userId, { type: 'answer', invite: id, accept });
  const lastInvite = () => context.sent.invites.at(-1)!;
  return { ...context, invite, answer, lastInvite };
}

describe('inviter', () => {
  test('trop d\'invitations par minute (la limite du compte) : rate_limited, avant toute autre règle', async () => {
    const { invite, inviteAllowed } = await aliceSeated();
    inviteAllowed.value = false;
    expect(await invite(BASTIEN)).toEqual({ ok: false, error: 'rate_limited' });
    expect(await invite(ALICE)).toEqual({ ok: false, error: 'rate_limited' });
  });

  test('il faut être assis à cette table : not_seated', async () => {
    const { invite } = await aliceSeated();
    expect(await invite(DAN, BASTIEN)).toEqual({ ok: false, error: 'not_seated' });
    expect(await invite(BASTIEN, BASTIEN)).toEqual({ ok: false, error: 'not_seated' });
  });

  test('soi-même : self', async () => {
    const { invite } = await aliceSeated();
    expect(await invite(ALICE)).toEqual({ ok: false, error: 'self' });
  });

  test('quelqu\'un qui n\'est pas au bureau (pas de connexion, ou inconnu) : offline', async () => {
    const { invite, player } = await aliceSeated();
    player(BASTIEN).online = false;
    expect(await invite(BASTIEN)).toEqual({ ok: false, error: 'offline' });
    expect(await invite('personne')).toEqual({ ok: false, error: 'offline' });
  });

  test('quelqu\'un en « Ne pas déranger », ou dans un mode qui ferme la porte ou qui conduit ailleurs : dnd (P20)', async () => {
    const { invite, player, sent } = await aliceSeated();
    player(BASTIEN).status = 'dnd';
    expect(await invite(BASTIEN)).toEqual({ ok: false, error: 'dnd' });
    player(CLAIRE).activity = { id: 'a', label: 'Concentration', color: '#6d28d9', allowEntry: false, hear: true, heard: true };
    expect(await invite(CLAIRE)).toEqual({ ok: false, error: 'dnd' });
    player(DAN).activity = { id: 'b', label: 'Sport', color: '#f97316', allowEntry: true, hear: false, heard: false, place: 'gym' };
    expect(await invite(DAN)).toEqual({ ok: false, error: 'dnd' });
    expect(sent.invites).toEqual([]);
  });

  test('un mode qui laisse entrer et ne conduit nulle part ne gêne pas : l\'invitation part', async () => {
    const { invite, player, sent } = await aliceSeated();
    player(BASTIEN).activity = { id: 'a', label: 'Pause', color: '#22c55e', allowEntry: true, hear: true, heard: true };
    expect(await invite(BASTIEN)).toEqual({ ok: true });
    expect(sent.invites).toHaveLength(1);
  });

  test('quelqu\'un qui joue une partie en cours : busy', async () => {
    const { invite, sit, ready, service } = await aliceSeated();
    await sit(BASTIEN, 'chess');
    await sit(CLAIRE, 'chess');
    await ready(BASTIEN, 'chess');
    await ready(CLAIRE, 'chess');
    expect(await invite(BASTIEN)).toEqual({ ok: false, error: 'busy' });
    // Qui a abandonné n'est plus dans la partie : on peut l'inviter.
    await service.run(BASTIEN, { type: 'resign', game: 'chess' });
    expect(await invite(BASTIEN)).toEqual({ ok: true });
  });

  test('quelqu\'un déjà assis à cette table : already_here', async () => {
    const { invite, sit } = await aliceSeated();
    await sit(BASTIEN);
    expect(await invite(BASTIEN)).toEqual({ ok: false, error: 'already_here' });
  });

  test('au plus trois invitations en attente par personne : too_many', async () => {
    const { invite } = await aliceSeated();
    expect(await invite(BASTIEN)).toEqual({ ok: true });
    expect(await invite(CLAIRE)).toEqual({ ok: true });
    expect(await invite(DAN)).toEqual({ ok: true });
    expect(await invite(EVE)).toEqual({ ok: false, error: 'too_many' });
  });

  test('une invitation part à l\'invitée avec son nom, son avatar et ses 60 s ; elle la retrouve dans son init', async () => {
    const { invite, lastInvite, player, service, advance } = await aliceSeated();
    player(ALICE).avatarKey = 'fox';
    expect(await invite(BASTIEN)).toEqual({ ok: true });
    expect(lastInvite()).toEqual({ to: BASTIEN, invite: { id: 'partie-1', game: 'connect4', from: { id: ALICE, name: 'Alice', avatarKey: null }, ttlMs: GAME_INVITE_TTL_MS } });
    advance(25_000);
    expect(service.invitesFor(BASTIEN)).toEqual([{ id: 'partie-1', game: 'connect4', from: { id: ALICE, name: 'Alice', avatarKey: null }, ttlMs: GAME_INVITE_TTL_MS - 25_000 }]);
    expect(service.invitesFor(CLAIRE)).toEqual([]);
  });

  test('inviter de nouveau la même personne à la même table remplace l\'ancienne invitation et remet le délai à 60 s, sans compter deux fois', async () => {
    const { invite, sent, service, advance } = await aliceSeated();
    await invite(BASTIEN);
    advance(40_000);
    expect(await invite(BASTIEN)).toEqual({ ok: true });
    expect(sent.gone).toEqual([{ to: BASTIEN, id: 'partie-1', reason: 'cancelled' }]);
    expect(sent.invites.at(-1)?.invite).toMatchObject({ id: 'partie-2', ttlMs: GAME_INVITE_TTL_MS });
    expect(service.invitesFor(BASTIEN).map((entry) => entry.id)).toEqual(['partie-2']);
    // Trois autres invitations passent encore : l'ancienne ne comptait plus.
    expect(await invite(CLAIRE)).toEqual({ ok: true });
    expect(await invite(DAN)).toEqual({ ok: true });
  });
});

describe('répondre à une invitation', () => {
  test('refuser : l\'invitation tombe, l\'invitante est prévenue', async () => {
    const { invite, answer, sent, service } = await aliceSeated();
    await invite(BASTIEN);
    expect(await answer(BASTIEN, 'partie-1', false)).toEqual({ ok: true });
    expect(sent.gone).toEqual([{ to: BASTIEN, id: 'partie-1', reason: 'answered' }]);
    expect(sent.notices).toEqual([{ to: ALICE, notice: { kind: 'declined', game: 'connect4', user: { id: BASTIEN, name: 'Bastien' } } }]);
    expect(service.invitesFor(BASTIEN)).toEqual([]);
    expect(await answer(BASTIEN, 'partie-1', true)).toEqual({ ok: false, error: 'expired' });
  });

  test('accepter : elle est téléportée à la table et assise à la première chaise libre ; l\'invitante est prévenue (P18)', async () => {
    const { invite, answer, sent, arrivals, view } = await aliceSeated();
    await invite(BASTIEN);
    expect(await answer(BASTIEN, 'partie-1', true)).toEqual({ ok: true });
    expect(arrivals).toEqual([{ userId: BASTIEN, game: 'connect4', chair: 1 }]);
    expect(view().chairs.map((chair) => chair?.userId)).toEqual([ALICE, BASTIEN]);
    expect(view().chairs[1]).toMatchObject({ ready: false, connected: true });
    expect(sent.gone).toEqual([{ to: BASTIEN, id: 'partie-1', reason: 'answered' }]);
    expect(sent.notices).toEqual([{ to: ALICE, notice: { kind: 'accepted', game: 'connect4', user: { id: BASTIEN, name: 'Bastien' } } }]);
  });

  test('on peut accepter de loin : l\'invitée n\'avait pas à être dans la salle', async () => {
    const { invite, answer, player, view } = await aliceSeated();
    Object.assign(player(BASTIEN), OUTSIDE);
    await invite(BASTIEN);
    expect(await answer(BASTIEN, 'partie-1', true)).toEqual({ ok: true });
    expect(view().chairs[1]?.userId).toBe(BASTIEN);
  });

  test('la table est pleine : elle est téléportée et regarde', async () => {
    const { invite, sit, answer, arrivals, view } = await aliceSeated();
    await sit(BASTIEN);
    await invite(CLAIRE);
    expect(await answer(CLAIRE, 'partie-1', true)).toEqual({ ok: true });
    expect(arrivals).toEqual([{ userId: CLAIRE, game: 'connect4', chair: null }]);
    expect(view().chairs.map((chair) => chair?.userId)).toEqual([ALICE, BASTIEN]);
    expect(view().spectators).toEqual([{ id: CLAIRE, name: 'Claire' }]);
  });

  test('une partie est en cours : elle est téléportée et regarde, même si une chaise est libre', async () => {
    // La table des petits chevaux a quatre chaises ; on y joue ici le morpion, à deux : deux chaises restent libres pendant la partie.
    const context = gamesSetup({ games: { ludo: tictactoe as never }, ids: [ALICE, BASTIEN, CLAIRE] });
    const { service, sit, ready, sent, arrivals, view } = context;
    await sit(ALICE, 'ludo');
    await sit(BASTIEN, 'ludo');
    await ready(ALICE, 'ludo');
    await ready(BASTIEN, 'ludo');
    expect(view('ludo').match?.status).toBe('playing');
    expect(await service.run(ALICE, { type: 'invite', game: 'ludo', userId: CLAIRE })).toEqual({ ok: true });
    const id = sent.invites.at(-1)!.invite.id;
    expect(await service.run(CLAIRE, { type: 'answer', invite: id, accept: true })).toEqual({ ok: true });
    expect(arrivals).toEqual([{ userId: CLAIRE, game: 'ludo', chair: null }]);
    expect(view('ludo').chairs.filter((chair) => chair !== null)).toHaveLength(2);
    expect(view('ludo').spectators).toEqual([{ id: CLAIRE, name: 'Claire' }]);
  });

  test('une partie finie : la chaise libre est prise, la revanche peut commencer avec l\'invitée', async () => {
    const { invite, sit, ready, answer, arrivals, view, service, sent } = await aliceSeated();
    await sit(BASTIEN);
    await ready(ALICE);
    await ready(BASTIEN);
    await invite(CLAIRE);
    await service.run(BASTIEN, { type: 'resign', game: 'connect4' });
    await service.run(BASTIEN, { type: 'stand', game: 'connect4' });
    expect(await answer(CLAIRE, sent.invites.at(-1)!.invite.id, true)).toEqual({ ok: true });
    expect(arrivals).toEqual([{ userId: CLAIRE, game: 'connect4', chair: 1 }]);
    await ready(ALICE);
    await ready(CLAIRE);
    expect(view().match).toMatchObject({ status: 'playing' });
    expect(view().match?.players.map((player) => player.userId)).toEqual([ALICE, CLAIRE]);
  });

  test('elle attendait à une autre table : elle la quitte en acceptant', async () => {
    const { invite, sit, answer, view, sent } = await aliceSeated();
    await sit(BASTIEN, 'chess');
    // Assis aux échecs, il n'est pas assis ici : on peut l'inviter, et accepter le fait changer de table.
    expect(await invite(BASTIEN)).toEqual({ ok: true });
    expect(await answer(BASTIEN, sent.invites.at(-1)!.invite.id, true)).toEqual({ ok: true });
    expect(view('chess').chairs).toEqual([null, null]);
    expect(view().chairs.map((chair) => chair?.userId)).toEqual([ALICE, BASTIEN]);
  });

  test('elle regardait une autre table : elle ne la regarde plus', async () => {
    const { invite, answer, service, view } = await aliceSeated();
    await service.run(BASTIEN, { type: 'watch', game: 'chess' });
    await invite(BASTIEN);
    await answer(BASTIEN, 'partie-1', true);
    expect(view('chess').spectators).toEqual([]);
  });

  test('l\'invitante s\'est levée depuis : l\'invitation est tombée, accepter répond expired', async () => {
    const { invite, answer, sent, service } = await aliceSeated();
    await invite(BASTIEN);
    await service.run(ALICE, { type: 'stand', game: 'connect4' });
    expect(sent.gone).toEqual([{ to: BASTIEN, id: 'partie-1', reason: 'cancelled' }]);
    expect(await answer(BASTIEN, 'partie-1', true)).toEqual({ ok: false, error: 'expired' });
  });

  test('« Ne pas déranger » après l\'invitation : elle peut encore accepter, c\'est elle qui décide', async () => {
    const { invite, answer, player, view } = await aliceSeated();
    await invite(BASTIEN);
    player(BASTIEN).status = 'dnd';
    expect(await answer(BASTIEN, 'partie-1', true)).toEqual({ ok: true });
    expect(view().chairs[1]?.userId).toBe(BASTIEN);
  });

  test('une invitation qui n\'existe pas, ou qui est à quelqu\'un d\'autre : expired', async () => {
    const { invite, answer, view } = await aliceSeated();
    await invite(BASTIEN);
    expect(await answer(BASTIEN, 'inconnue', true)).toEqual({ ok: false, error: 'expired' });
    expect(await answer(CLAIRE, 'partie-1', true)).toEqual({ ok: false, error: 'expired' });
    expect(view().chairs[1]).toBeNull();
  });

  test('elle joue une partie ailleurs entre-temps : busy, et rien ne bouge', async () => {
    const { invite, sit, ready, answer, arrivals, view } = await aliceSeated();
    await invite(BASTIEN);
    await sit(BASTIEN, 'chess');
    await sit(CLAIRE, 'chess');
    await ready(BASTIEN, 'chess');
    await ready(CLAIRE, 'chess');
    expect(await answer(BASTIEN, 'partie-1', true)).toEqual({ ok: false, error: 'busy' });
    expect(arrivals).toEqual([]);
    expect(view().chairs[1]).toBeNull();
  });
});

describe('une invitation sans réponse', () => {
  test('elle expire à 60 s : l\'invitée n\'a plus à la montrer, l\'invitante l\'apprend, et une réponse tardive vaut expired (P19)', async () => {
    const { invite, answer, sent, service, advance } = await aliceSeated();
    await invite(BASTIEN);
    advance(GAME_INVITE_TTL_MS - 1);
    await service.sweep();
    expect(sent.gone).toEqual([]);
    advance(1);
    await service.sweep();
    expect(sent.gone).toEqual([{ to: BASTIEN, id: 'partie-1', reason: 'expired' }]);
    expect(sent.notices).toEqual([{ to: ALICE, notice: { kind: 'expired', game: 'connect4', user: { id: BASTIEN, name: 'Bastien' } } }]);
    expect(await answer(BASTIEN, 'partie-1', true)).toEqual({ ok: false, error: 'expired' });
    expect(service.invitesFor(BASTIEN)).toEqual([]);
  });

  test('une réponse juste avant le délai passe', async () => {
    const { invite, answer, advance, view } = await aliceSeated();
    await invite(BASTIEN);
    advance(GAME_INVITE_TTL_MS - 1);
    expect(await answer(BASTIEN, 'partie-1', true)).toEqual({ ok: true });
    expect(view().chairs[1]?.userId).toBe(BASTIEN);
  });

  test('une réponse tardive, avant que le balayage ne soit passé : expired, et l\'invitation est retirée avec son avis', async () => {
    const { invite, answer, sent, advance } = await aliceSeated();
    await invite(BASTIEN);
    advance(GAME_INVITE_TTL_MS);
    expect(await answer(BASTIEN, 'partie-1', true)).toEqual({ ok: false, error: 'expired' });
    expect(sent.gone).toEqual([{ to: BASTIEN, id: 'partie-1', reason: 'expired' }]);
    expect(sent.notices.map((entry) => entry.notice.kind)).toEqual(['expired']);
  });
});

describe('ce qui fait tomber une invitation', () => {
  test('l\'invitante quitte le bureau (sa connexion tombe) : ses invitations sont annulées', async () => {
    const { invite, sent, service } = await aliceSeated();
    await invite(BASTIEN);
    await invite(CLAIRE);
    await service.onSocketsGone(ALICE);
    expect(sent.gone.map((entry) => [entry.to, entry.reason]).sort()).toEqual([[BASTIEN, 'cancelled'], [CLAIRE, 'cancelled']]);
    expect(service.invitesFor(BASTIEN)).toEqual([]);
  });

  test('l\'invitante est retirée du bureau : de même', async () => {
    const { invite, sent, service } = await aliceSeated();
    await invite(BASTIEN);
    await service.onRemoved(ALICE);
    expect(sent.gone).toEqual([{ to: BASTIEN, id: 'partie-1', reason: 'cancelled' }]);
  });

  test('l\'invitée quitte le bureau : l\'invitation tombe et l\'invitante en est avertie (gone)', async () => {
    const { invite, sent, service } = await aliceSeated();
    await invite(BASTIEN);
    await service.onSocketsGone(BASTIEN);
    expect(sent.notices).toEqual([{ to: ALICE, notice: { kind: 'gone', game: 'connect4', user: { id: BASTIEN, name: 'Bastien' } } }]);
    expect(service.invitesFor(BASTIEN)).toEqual([]);
  });

  test('la chaise de l\'invitante est libérée (oubliée 10 minutes) : ses invitations tombent', async () => {
    const { invite, sent, service, advance } = await aliceSeated();
    await invite(BASTIEN);
    advance(10 * 60_000);
    await service.sweep();
    // L'invitation avait déjà expiré à 60 s ; ici elle est tombée d'elle-même, et rien n'est dit deux fois.
    expect(sent.gone.filter((entry) => entry.id === 'partie-1')).toHaveLength(1);
    expect(service.invitesFor(BASTIEN)).toEqual([]);
  });
});
