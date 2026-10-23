import { GROUP_DEBOUNCE_MS, GROUPS_TICK_MS, placeAt, zoneAt, type ActivityInput, type ActivityState, type WorldTick } from '@bureau/shared';
import { describe, expect, test, vi } from 'vitest';
import { createActivityService } from '../src/activity/activity-service';
import { enter, nextEvent, record, sleep, startTestServer, type TestServer } from './helpers/realtime';

const focus: ActivityInput = { label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false };
const lunch: ActivityInput = { label: 'À table', color: '#f59e0b', allowEntry: true, hear: false, heard: false };

async function person(srv: TestServer, email: string) {
  return enter(srv, await srv.inviteAndLogin(email));
}

// Crée un état d'activité de cette personne, comme le fait la route REST.
async function stateOf(srv: TestServer, userId: string, input: ActivityInput): Promise<ActivityState> {
  const created = await createActivityService(srv.db).create(userId, input);
  if (!created.ok) throw new Error('création refusée');
  return created.state;
}

// Le mode par défaut de ce nom (Manger, Sport, Concentration), que le compte a reçu à sa création.
async function defaultMode(srv: TestServer, userId: string, label: string): Promise<ActivityState> {
  const mode = (await createActivityService(srv.db).list(userId)).find((state) => state.label === label);
  if (!mode) throw new Error(`pas de mode « ${label} »`);
  return mode;
}

const startOffice = () => startTestServer({ env: { MAP_KEY: 'office' } });

describe('prendre un état d\'activité', () => {
  test('state:set : à tout le bureau, émetteur compris ; le monde le retient, et un arrivant le voit dans l\'init', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const state = await stateOf(srv, a.id, focus);

    const seenByA = nextEvent(a.socket, 'activity:changed');
    const seenByB = nextEvent(b.socket, 'activity:changed');
    a.socket.emit('state:set', state.id);
    expect(await seenByA).toEqual({ id: a.id, activity: state });
    expect(await seenByB).toEqual({ id: a.id, activity: state });
    expect(srv.realtime.world.get(a.id)?.activity).toEqual(state);

    const c = await person(srv, 'c@x.fr');
    expect(c.init.players.find((p) => p.id === a.id)?.activity).toEqual(state);
  });

  test('l\'icône de l\'état est dite à tout le bureau avec lui, et un arrivant la voit dans l\'init', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const state = await stateOf(srv, a.id, { ...focus, icon: 'headphones' });
    expect(state.icon).toBe('headphones');

    const seenByB = nextEvent(b.socket, 'activity:changed');
    a.socket.emit('state:set', state.id);
    expect((await seenByB).activity?.icon).toBe('headphones');
    const c = await person(srv, 'c@x.fr');
    expect(c.init.players.find((p) => p.id === a.id)?.activity?.icon).toBe('headphones');
  });

  test('un état qui n\'est pas le sien (celui d\'un autre, ou inconnu) : ignoré, sans rien dire à personne', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const mine = await stateOf(srv, a.id, focus);
    const seen = record(a.socket);
    b.socket.emit('state:set', mine.id);
    b.socket.emit('state:set', '00000000-0000-4000-8000-000000000000');
    b.socket.emit('state:set', 'pas-un-uuid');
    (b.socket as unknown as { emit(e: string, ...a: unknown[]): void }).emit('state:set', { id: mine.id });
    await sleep(150);
    expect(seen.names()).not.toContain('activity:changed');
    expect(srv.realtime.world.get(b.id)?.activity).toBeNull();
  });

  test('state:set null, ou un statut ordinaire : on revient au statut, et tout le bureau le voit', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const state = await stateOf(srv, a.id, focus);
    a.socket.emit('state:set', state.id);
    await nextEvent(b.socket, 'activity:changed');

    const cleared = nextEvent(b.socket, 'activity:changed');
    a.socket.emit('state:set', null);
    expect(await cleared).toEqual({ id: a.id, activity: null });

    a.socket.emit('state:set', state.id);
    await nextEvent(b.socket, 'activity:changed');
    const clearedByStatus = nextEvent(b.socket, 'activity:changed');
    a.socket.emit('status:set', 'busy');
    expect(await clearedByStatus).toEqual({ id: a.id, activity: null });
    expect(srv.realtime.world.get(a.id)).toMatchObject({ status: 'busy', activity: null });
  });

  test('un statut ordinaire sans état d\'activité : rien d\'autre que le statut', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const seen = record(a.socket);
    a.socket.emit('status:set', 'away');
    await sleep(100);
    expect(seen.names()).toEqual(['status:changed']);
  });

  test('revenir après une absence : l\'état est retrouvé (le monde le retient), et le sien seulement', async () => {
    const srv = await startOffice();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    const a = await enter(srv, cookie);
    const state = await stateOf(srv, a.id, focus);
    a.socket.emit('state:set', state.id);
    await sleep(100);
    a.socket.disconnect();
    await sleep(500);   // au-delà du délai de grâce : elle a quitté le monde
    expect(srv.realtime.world.get(a.id)).toBeUndefined();
    const again = await enter(srv, cookie);
    expect(again.init.self.activity).toEqual(state);
    expect((await person(srv, 'b@x.fr')).init.self.activity).toBeNull();
  });
});

describe('modifié ou supprimé pendant qu\'on le porte', () => {
  test('modifié : tout le bureau voit le nouvel état ; les autres états ne sont pas touchés', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const state = await stateOf(srv, a.id, focus);
    const other = await stateOf(srv, a.id, lunch);
    a.socket.emit('state:set', state.id);
    await nextEvent(b.socket, 'activity:changed');

    const changed = nextEvent(b.socket, 'activity:changed');
    srv.events.emit('activity:edited', { userId: a.id, id: state.id, state: { ...state, label: 'Concentré', color: '#000000' } });
    expect(await changed).toEqual({ id: a.id, activity: { ...state, label: 'Concentré', color: '#000000' } });

    const seen = record(b.socket);
    srv.events.emit('activity:edited', { userId: a.id, id: other.id, state: { ...other, label: 'Autre' } });
    await sleep(100);
    expect(seen.names()).not.toContain('activity:changed');
  });

  test('supprimé : il retombe sur son statut', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const state = await stateOf(srv, a.id, focus);
    a.socket.emit('state:set', state.id);
    await nextEvent(b.socket, 'activity:changed');
    const gone = nextEvent(b.socket, 'activity:changed');
    srv.events.emit('activity:edited', { userId: a.id, id: state.id, state: null });
    expect(await gone).toEqual({ id: a.id, activity: null });
    expect(srv.realtime.world.get(a.id)?.activity).toBeNull();
  });
});

describe('laisser entrer', () => {
  test('un état qui ne laisse pas entrer ferme la porte du bureau, sans toucher au verrou ; en sortir la rouvre', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');   // bureau A1
    const b = await person(srv, 'b@x.fr');
    const state = await stateOf(srv, a.id, focus);

    const changed = nextEvent(b.socket, 'desk:changed');
    const access = nextEvent(b.socket, 'desk:access');
    a.socket.emit('state:set', state.id);
    expect(await changed).toMatchObject({ key: 'A1', locked: false, closedByState: true });
    expect(await access).toEqual({ closed: ['A1'] });
    expect(srv.realtime.desks.canEnter(b.id, 'A1')).toBe(false);
    expect(srv.realtime.desks.canEnter(a.id, 'A1')).toBe(true);

    const reopened = nextEvent(b.socket, 'desk:access');
    a.socket.emit('state:set', null);
    expect(await reopened).toEqual({ closed: [] });
  });

  test('un état qui laisse entrer ne ferme rien', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const open = await stateOf(srv, a.id, { ...focus, allowEntry: true });
    const seen = record(b.socket);
    a.socket.emit('state:set', open.id);
    await sleep(100);
    expect(seen.payloadsOf('desk:access')).toEqual([]);
    expect(srv.realtime.desks.canEnter(b.id, 'A1')).toBe(true);
  });
});

describe('entendre et être entendu', () => {
  // Sur la carte de développement (les tests y tiennent), deux personnes arrêtées à une case se mettent en groupe en 500 ms.
  async function pair() {
    const srv = await startTestServer({ env: { E2E: '1' } });
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    for (const [p, x] of [[a, 400], [b, 432]] as const) p.socket.emit('debug:teleport', { x, y: 240 });
    await sleep(GROUP_DEBOUNCE_MS + 4 * GROUPS_TICK_MS);
    return { srv, a, b };
  }

  test('sans entendre ni être entendu : hors de la conversation tout de suite ; l\'autre reste seul', async () => {
    const { srv, a, b } = await pair();
    expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual([a.id, b.id].sort());
    const state = await stateOf(srv, a.id, lunch);
    a.socket.emit('state:set', state.id);
    await sleep(3 * GROUPS_TICK_MS);
    expect(srv.realtime.coordinator.groupMembersOf(a.id)).toEqual([]);
    expect(srv.realtime.coordinator.groupMembersOf(b.id)).toEqual([]);
  });

  test('entendre seulement, ou être entendu seulement : toujours dans la conversation', async () => {
    const { srv, a, b } = await pair();
    const state = await stateOf(srv, a.id, focus);   // entend, n'est pas entendu
    a.socket.emit('state:set', state.id);
    await sleep(3 * GROUPS_TICK_MS);
    expect(srv.realtime.coordinator.groupMembersOf(b.id)).toEqual([a.id, b.id].sort());
  });
});

// Les modes par défaut (Concentration, Sport : en base, donnés au compte à sa création) et l'emplacement d'un mode : le prendre conduit à ce lieu, en sortir ramène au bureau.
describe('les modes par défaut et leur emplacement', () => {
  const inRoom = (srv: TestServer, key: string, at: { x: number; y: number }) => placeAt(srv.map, at.x, at.y)?.key === key;
  const inDesk = (srv: TestServer, key: string, at: { x: number; y: number }) => zoneAt(srv.map, at.x, at.y, ['desk'])?.name === key;
  const toGym: ActivityInput = { label: 'Muscu', color: '#f97316', allowEntry: true, hear: false, heard: false, place: 'gym' };

  test('« Concentration » : pris comme un mode à soi : annoncé à tout le bureau, la porte du bureau se ferme, et personne ne bouge', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const before = srv.realtime.world.get(a.id)!;
    const changed = nextEvent(b.socket, 'activity:changed');
    const door = nextEvent(b.socket, 'desk:changed');
    const seen = record(a.socket);
    const focusMode = await defaultMode(srv, a.id, 'Concentration');
    a.socket.emit('state:set', focusMode.id);
    expect(await changed).toEqual({ id: a.id, activity: focusMode });
    expect(await door).toMatchObject({ key: 'A1', closedByState: true });
    await sleep(100);
    expect(seen.names()).not.toContain('move:correct');
    expect(srv.realtime.world.get(a.id)).toMatchObject({ x: before.x, y: before.y });
  });

  test('« Sport » : on est conduit dans la salle de sport : `move:correct` avec la raison « teleport » pour la personne, un saut (`tp`) dans le tick pour les autres', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const moved = nextEvent(a.socket, 'move:correct');
    const changed = nextEvent(b.socket, 'activity:changed');
    const seenByB = record(b.socket);
    const sport = await defaultMode(srv, a.id, 'Sport');
    a.socket.emit('state:set', sport.id);
    const correct = await moved;
    expect(correct.reason).toBe('teleport');
    expect(inRoom(srv, 'gym', correct)).toBe(true);
    expect(await changed).toEqual({ id: a.id, activity: sport });
    expect(srv.realtime.world.get(a.id)).toMatchObject({ x: correct.x, y: correct.y });
    await vi.waitFor(() => {
      const jump = (seenByB.payloadsOf('world:tick') as WorldTick[]).flatMap((tick) => tick.moves).find((move) => move.id === a.id && move.tp === true);
      expect(jump).toMatchObject({ x: correct.x, y: correct.y });
    });
  });

  test('en sortir (state:set null) ramène au bureau, au centre de sa pièce ; un statut ordinaire aussi', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const desk = srv.realtime.desks.deskOf(a.id)!.key;
    a.socket.emit('state:set', (await defaultMode(srv, a.id, 'Sport')).id);
    await nextEvent(a.socket, 'move:correct');
    const home = nextEvent(a.socket, 'move:correct');
    a.socket.emit('state:set', null);
    const back = await home;
    expect(back.reason).toBe('teleport');
    expect(inDesk(srv, desk, back)).toBe(true);
    expect(srv.realtime.world.get(a.id)).toMatchObject({ x: back.x, y: back.y });

    // Un statut ordinaire prend la place du mode : il ramène de même.
    a.socket.emit('state:set', (await defaultMode(srv, a.id, 'Sport')).id);
    await nextEvent(a.socket, 'move:correct');
    const again = nextEvent(a.socket, 'move:correct');
    a.socket.emit('status:set', 'busy');
    expect(inDesk(srv, desk, await again)).toBe(true);
  });

  test('sans bureau : en sortir ramène à l\'apparition', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    a.socket.emit('desk:do', { type: 'release' }, () => undefined);
    await vi.waitFor(() => expect(srv.realtime.desks.deskOf(a.id)).toBeUndefined());
    a.socket.emit('state:set', (await defaultMode(srv, a.id, 'Sport')).id);
    await nextEvent(a.socket, 'move:correct');
    const home = nextEvent(a.socket, 'move:correct');
    a.socket.emit('state:set', null);
    expect(await home).toEqual({ x: srv.map.spawn.x, y: srv.map.spawn.y, reason: 'teleport' });
  });

  test('d\'un mode à emplacement à un autre : directement dans la nouvelle pièce, et le retour, ensuite, est le bureau', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const desk = srv.realtime.desks.deskOf(a.id)!.key;
    const toGame = await stateOf(srv, a.id, { ...toGym, label: 'Jeux', place: 'game' });
    expect(toGame.place).toBe('game');
    a.socket.emit('state:set', (await defaultMode(srv, a.id, 'Sport')).id);
    await nextEvent(a.socket, 'move:correct');
    const next = nextEvent(a.socket, 'move:correct');
    a.socket.emit('state:set', toGame.id);
    expect(inRoom(srv, 'game', await next)).toBe(true);
    const home = nextEvent(a.socket, 'move:correct');
    a.socket.emit('state:set', null);
    expect(inDesk(srv, desk, await home)).toBe(true);
  });

  test('un mode dont l\'emplacement n\'est pas une destination de la carte (le café) : pris, sans déplacer personne', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const before = srv.realtime.world.get(a.id)!;
    const toCafe = await stateOf(srv, a.id, { ...toGym, label: 'Café', place: 'cafe' });
    const changed = nextEvent(a.socket, 'activity:changed');
    const seen = record(a.socket);
    a.socket.emit('state:set', toCafe.id);
    expect((await changed).activity).toEqual(toCafe);
    await sleep(100);
    expect(seen.names()).not.toContain('move:correct');
    expect(srv.realtime.world.get(a.id)).toMatchObject({ x: before.x, y: before.y });
  });

  test('un mode à emplacement qui ne laisse pas entrer garde la porte du bureau fermée pendant que son propriétaire est ailleurs', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const closed = await stateOf(srv, a.id, { ...toGym, allowEntry: false });
    const door = nextEvent(b.socket, 'desk:changed');
    const moved = nextEvent(a.socket, 'move:correct');
    a.socket.emit('state:set', closed.id);
    expect(await door).toMatchObject({ key: 'A1', closedByState: true });
    expect(inRoom(srv, 'gym', await moved)).toBe(true);
    expect(srv.realtime.desks.canEnter(b.id, 'A1')).toBe(false);
    expect(srv.realtime.desks.canEnter(a.id, 'A1')).toBe(true);
  });

  test('on se déconnecte en sport et on revient dans le délai de grâce : toujours en mode, toujours dans la salle', async () => {
    const srv = await startOffice();
    const cookie = await srv.inviteAndLogin('a@x.fr');
    const a = await enter(srv, cookie);
    const moved = nextEvent(a.socket, 'move:correct');
    const sport = await defaultMode(srv, a.id, 'Sport');
    a.socket.emit('state:set', sport.id);
    const gone = await moved;
    a.socket.disconnect();
    const back = await enter(srv, cookie);
    expect(back.init.self.activity).toEqual(sport);
    expect(back.init.self).toMatchObject({ x: gone.x, y: gone.y });
  });

  test('un identifiant qui n\'est pas un uuid (les anciens modes tout prêts, `preset:`) : ignoré, sans rien dire à personne', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const seen = record(a.socket);
    a.socket.emit('state:set', 'preset:sport');
    a.socket.emit('state:set', 'preset:');
    await sleep(150);
    expect(seen.names()).not.toContain('activity:changed');
    expect(seen.names()).not.toContain('move:correct');
    expect(srv.realtime.world.get(a.id)?.activity).toBeNull();
  });

  test('la salle est prise : on y arrive à une place libre, loin de ceux qui y sont', async () => {
    const srv = await startOffice();
    const a = await person(srv, 'a@x.fr');
    const b = await person(srv, 'b@x.fr');
    const first = nextEvent(a.socket, 'move:correct');
    a.socket.emit('state:set', (await defaultMode(srv, a.id, 'Sport')).id);
    const spotA = await first;
    const second = nextEvent(b.socket, 'move:correct');
    b.socket.emit('state:set', (await defaultMode(srv, b.id, 'Sport')).id);
    const spotB = await second;
    expect(inRoom(srv, 'gym', spotB)).toBe(true);
    expect(Math.hypot(spotA.x - spotB.x, spotA.y - spotB.y)).toBeGreaterThanOrEqual(2 * srv.map.tileSize);
  });
});
