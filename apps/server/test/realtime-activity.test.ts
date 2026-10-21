import { GROUP_DEBOUNCE_MS, GROUPS_TICK_MS, type ActivityInput, type ActivityState } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
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
