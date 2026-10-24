import { CHECKIN_XP, GAME_DAILY_XP, MAX_OPEN_TASKS, TODO_DAILY_XP, TODO_XP, ecusBetween, missionXp } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { progress, task, user, xpEvent } from '../src/db/schema';
import { ProgressService, outcomeOf } from '../src/progress/progress-service';
import { createTestDb } from './helpers/test-db';

// Un jeudi après-midi, à Paris.
const THURSDAY = Date.parse('2026-10-22T14:00:00Z');
const DAY = 24 * 3600_000;
// Une boutique de test : la banque d'éléments n'a pas forcément d'éléments à vendre.
const PRICES: Record<string, number> = { 'statue-or': 800, 'tapis-rare': 300 };

// Un service sur une base neuve, avec trois comptes (Zoé est désactivée) et une horloge que le test fait avancer.
async function setup(timeZones: Record<string, string> = {}) {
  const db = await createTestDb();
  for (const id of ['ana', 'bob', 'zoe']) await db.insert(user).values({ id, name: id[0]!.toUpperCase() + id.slice(1), email: `${id}@example.test` });
  await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, 'zoe'));
  const clock = { t: THURSDAY };
  const service = new ProgressService(db, {
    clock: () => clock.t,
    timeZoneOf: async (id) => timeZones[id] ?? 'Europe/Paris',
    priceOf: (id) => PRICES[id],
  });
  return { db, clock, service };
}

// Donne de l'XP et des écus à quelqu'un, d'un coup, comme s'il les avait gagnés.
async function grant(db: Awaited<ReturnType<typeof setup>>['db'], userId: string, xp: number, ecus: number) {
  await db.insert(progress).values({ userId, xp, ecus }).onConflictDoUpdate({ target: progress.userId, set: { xp, ecus } });
}

describe('les missions', () => {
  test('Ana confie une mission à Bob : elle arrive dans sa liste, nouvelle, avec l\'XP de sa difficulté', async () => {
    const { service } = await setup();
    const given = await service.give('ana', { to: 'bob', title: 'Refaire le logo', notes: 'Le K en violet', tier: 5 });
    expect(given).toMatchObject({ ok: true, task: { kind: 'mission', title: 'Refaire le logo', notes: 'Le K en violet', tier: 5, xp: 500, status: 'open', seen: false } });
    if (!given.ok) return;
    expect(given.task.owner).toEqual({ id: 'bob', name: 'Bob' });
    expect(given.task.giver).toEqual({ id: 'ana', name: 'Ana' });
    expect((await service.tasksOf('bob')).map((t) => t.id)).toEqual([given.task.id]);
    expect((await service.givenBy('ana')).map((t) => t.id)).toEqual([given.task.id]);
    expect(await service.tasksOf('ana')).toEqual([]);
  });

  test('refusée à soi-même, à un membre désactivé ou inconnu, et à une liste pleine', async () => {
    const { db, service } = await setup();
    expect(await service.give('ana', { to: 'ana', title: 'x', tier: 1 })).toEqual({ ok: false, error: 'self' });
    expect(await service.give('ana', { to: 'zoe', title: 'x', tier: 1 })).toEqual({ ok: false, error: 'unknown_member' });
    expect(await service.give('ana', { to: 'personne', title: 'x', tier: 1 })).toEqual({ ok: false, error: 'unknown_member' });
    await db.insert(task).values(Array.from({ length: MAX_OPEN_TASKS }, (_, i) => ({ ownerId: 'bob', kind: 'todo' as const, title: `t${i}`, xp: TODO_XP })));
    expect(await service.give('ana', { to: 'bob', title: 'x', tier: 1 })).toEqual({ ok: false, error: 'limit' });
  });

  test('Bob la fait : son XP monte de celle de la mission, son niveau suit, et il gagne les écus des niveaux passés', async () => {
    const { service } = await setup();
    await service.give('ana', { to: 'bob', title: 'Petit audit', tier: 3 });
    const big = await service.give('ana', { to: 'bob', title: 'Le grand projet', tier: 10 });
    if (!big.ok) throw new Error('mission refusée');
    const done = await service.complete('bob', big.task.id);
    expect(done!.task).toMatchObject({ status: 'done', xp: missionXp(10) });
    expect(done!.task.doneAt).toBe(new Date(THURSDAY).toISOString());
    expect(done!.progress).toMatchObject({ xp: 5000, ecus: ecusBetween(0, 5), gain: { amount: 5000, source: 'mission', label: 'Le grand projet', levelBefore: 0, levelAfter: 5, ecus: ecusBetween(0, 5) } });
    // Faite une fois : on ne la refait pas.
    expect(await service.complete('bob', big.task.id)).toBeNull();
    // Ana ne la coche pas pour lui.
    const small = (await service.tasksOf('bob')).find((t) => t.status === 'open')!;
    expect(await service.complete('ana', small.id)).toBeNull();
  });

  test('Bob la rend : elle sort de sa liste ouverte, Ana le voit, et elle ne rapporte rien', async () => {
    const { service } = await setup();
    const given = await service.give('ana', { to: 'bob', title: 'Ranger la cave', tier: 2 });
    if (!given.ok) throw new Error('mission refusée');
    expect(await service.decline('bob', given.task.id)).toMatchObject({ status: 'declined' });
    expect(await service.complete('bob', given.task.id)).toBeNull();
    expect((await service.givenBy('ana'))[0]).toMatchObject({ status: 'declined' });
    expect((await service.mine('bob')).xp).toBe(0);
  });

  test('Ana la retire avant qu\'elle soit faite ; Bob ne peut pas la retirer, ni elle une mission faite', async () => {
    const { service } = await setup();
    const given = await service.give('ana', { to: 'bob', title: 'Appeler le client', tier: 4 });
    if (!given.ok) throw new Error('mission refusée');
    expect(await service.cancel('bob', given.task.id)).toBeNull();
    expect(await service.cancel('ana', given.task.id)).toMatchObject({ status: 'cancelled' });
    const other = await service.give('ana', { to: 'bob', title: 'Autre', tier: 4 });
    if (!other.ok) throw new Error('mission refusée');
    await service.complete('bob', other.task.id);
    expect(await service.cancel('ana', other.task.id)).toBeNull();
  });

  test('« nouvelle » jusqu\'à ce que Bob ouvre sa liste', async () => {
    const { service } = await setup();
    await service.give('ana', { to: 'bob', title: 'Un', tier: 1 });
    expect((await service.tasksOf('bob'))[0]!.seen).toBe(false);
    await service.markSeen('bob');
    expect((await service.tasksOf('bob'))[0]!.seen).toBe(true);
  });

  test('une mission se rend mais ne se supprime pas ; son intitulé ne se modifie pas', async () => {
    const { service } = await setup();
    const given = await service.give('ana', { to: 'bob', title: 'Mission', tier: 1 });
    if (!given.ok) throw new Error('mission refusée');
    expect(await service.deleteTodo('bob', given.task.id)).toBe(false);
    expect(await service.updateTodo('bob', given.task.id, { title: 'Autre chose' })).toBeNull();
  });
});

describe('sa propre liste', () => {
  test('créer, modifier, cocher : TODO_XP par tâche, jusqu\'au plafond du jour, puis plus rien jusqu\'au lendemain', async () => {
    const { clock, service } = await setup();
    const created = await service.createTodo('ana', { title: 'Répondre à Léa', notes: '' });
    if (!created.ok) throw new Error('refusée');
    expect(created.task).toMatchObject({ kind: 'todo', giver: null, notes: null, seen: true, xp: TODO_XP });
    expect(await service.updateTodo('ana', created.task.id, { title: 'Répondre à Léa et Max', notes: 'avant midi' })).toMatchObject({ title: 'Répondre à Léa et Max', notes: 'avant midi' });

    const gains: number[] = [];
    for (let i = 0; i < TODO_DAILY_XP / TODO_XP + 1; i++) {
      const todo = await service.createTodo('ana', { title: `Tâche ${i}` });
      if (!todo.ok) throw new Error('refusée');
      gains.push((await service.complete('ana', todo.task.id))!.progress.gain!.amount);
    }
    expect(gains).toEqual([...Array.from({ length: TODO_DAILY_XP / TODO_XP }, () => TODO_XP), 0]);
    // Une tâche cochée au-delà du plafond est faite, sans XP, et le journal ne la compte pas.
    expect((await service.tasksOf('ana')).find((t) => t.title === `Tâche ${TODO_DAILY_XP / TODO_XP}`)).toMatchObject({ status: 'done', xp: 0 });
    clock.t += DAY;
    const tomorrow = await service.createTodo('ana', { title: 'Demain' });
    if (!tomorrow.ok) throw new Error('refusée');
    expect((await service.complete('ana', tomorrow.task.id))!.progress.gain!.amount).toBe(TODO_XP);
  });

  test('supprimer une tâche, ouverte ou faite : l\'XP gagnée reste', async () => {
    const { service } = await setup();
    const created = await service.createTodo('ana', { title: 'À faire' });
    if (!created.ok) throw new Error('refusée');
    await service.complete('ana', created.task.id);
    expect(await service.deleteTodo('bob', created.task.id)).toBe(false);
    expect(await service.deleteTodo('ana', created.task.id)).toBe(true);
    expect((await service.mine('ana')).xp).toBe(TODO_XP);
  });

  test('deux tâches cochées en même temps comptent l\'une après l\'autre', async () => {
    const { service } = await setup();
    const ids = [];
    for (const title of ['a', 'b', 'c']) {
      const todo = await service.createTodo('ana', { title });
      if (todo.ok) ids.push(todo.task.id);
    }
    await Promise.all(ids.map((id) => service.complete('ana', id)));
    expect((await service.mine('ana')).xp).toBe(3 * TODO_XP);
  });
});

describe('le pointage', () => {
  test('la première arrivée du jour : CHECKIN_XP, une seule fois par jour ; la série monte de jour ouvré en jour ouvré, week-end compris', async () => {
    const { clock, service } = await setup();
    expect((await service.checkIn('ana'))!.gain).toMatchObject({ amount: CHECKIN_XP, source: 'checkin', label: 'Pointage du jour' });
    expect(await service.checkIn('ana')).toBeNull();
    clock.t += DAY;   // vendredi
    expect((await service.checkIn('ana'))!.gain).toMatchObject({ amount: CHECKIN_XP + 5, label: 'Pointage, 2 jours de suite' });
    clock.t += 3 * DAY;   // lundi, sans venir le week-end
    expect((await service.checkIn('ana'))!).toMatchObject({ streak: 3, gain: { amount: CHECKIN_XP + 10 } });
    clock.t += 2 * DAY;   // mercredi : mardi manqué
    expect((await service.checkIn('ana'))!).toMatchObject({ streak: 1, gain: { amount: CHECKIN_XP } });
  });

  test('le jour se compte dans le fuseau de la personne : à 1 h 30 à Paris, c\'est encore la veille à Montréal', async () => {
    const { clock, service } = await setup({ bob: 'America/Montreal' });
    clock.t = Date.parse('2026-10-22T21:00:00Z');   // jeudi 23 h à Paris, 17 h à Montréal
    await service.checkIn('ana');
    await service.checkIn('bob');
    clock.t = Date.parse('2026-10-22T23:30:00Z');   // vendredi 1 h 30 à Paris, jeudi 19 h 30 à Montréal
    expect(await service.checkIn('ana')).not.toBeNull();
    expect(await service.checkIn('bob')).toBeNull();
  });
});

describe('les parties de jeu', () => {
  test('victoire, nulle, défaite ; jusqu\'au plafond du jour', async () => {
    const { service } = await setup();
    expect((await service.gamePlayed('ana', 'chess', 'win'))!.gain).toMatchObject({ amount: 60, label: 'Échecs : victoire' });
    expect((await service.gamePlayed('ana', 'connect4', 'draw'))!.gain).toMatchObject({ amount: 30, label: 'Puissance 4 : nulle' });
    expect((await service.gamePlayed('ana', 'ludo', 'loss'))!.gain).toMatchObject({ amount: 15, label: 'Petits chevaux : défaite' });
    expect((await service.gamePlayed('ana', 'chess', 'win'))!.gain!.amount).toBe(GAME_DAILY_XP - 105);
    expect(await service.gamePlayed('ana', 'chess', 'win')).toBeNull();
  });

  test('l\'issue d\'après le classement : premier groupe gagnant, tous ex æquo : nulle', () => {
    expect(outcomeOf([[0], [1]], 0, 2)).toBe('win');
    expect(outcomeOf([[0], [1]], 1, 2)).toBe('loss');
    expect(outcomeOf([[0, 1]], 1, 2)).toBe('draw');
    expect(outcomeOf([[2], [0, 1], [3]], 0, 4)).toBe('loss');
  });
});

describe('la boutique', () => {
  test('acheter un élément : ses écus baissent du prix, il le possède, une fois pour toutes', async () => {
    const { db, service } = await setup();
    await grant(db, 'ana', 12_000, 1000);
    expect(await service.buy('ana', 'statue-or')).toEqual({ ok: true, progress: { xp: 12_000, ecus: 200, streak: 0, owned: ['statue-or'] } });
    expect(await service.buy('ana', 'statue-or')).toEqual({ ok: false, error: 'owned' });
    expect(await service.buy('ana', 'tapis-rare')).toEqual({ ok: false, error: 'too_poor' });
    expect(await service.buy('ana', 'chaise-libre')).toEqual({ ok: false, error: 'unknown_item' });
    expect(await service.ownedAmong('ana', ['statue-or', 'tapis-rare'])).toEqual(new Set(['statue-or']));
  });

  test('deux achats en même temps ne dépensent pas deux fois les mêmes écus', async () => {
    const { db, service } = await setup();
    await grant(db, 'ana', 0, 900);
    const results = await Promise.all([service.buy('ana', 'statue-or'), service.buy('ana', 'tapis-rare')]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect((await service.mine('ana')).ecus).toBe(100);
  });
});

describe('les caractéristiques', () => {
  test('ce que tout le monde voit, et ce qui ne regarde que soi (écus, journal)', async () => {
    const { clock, service } = await setup();
    // Une minute entre deux gestes : le journal se lit du plus récent au plus ancien.
    for (const tier of [5, 5, 10] as const) {
      const given = await service.give('ana', { to: 'bob', title: `Mission ${tier}`, tier });
      if (given.ok) await service.complete('bob', given.task.id);
      clock.t += 60_000;
    }
    await service.give('bob', { to: 'ana', title: 'Retour', tier: 1 });
    const todo = await service.createTodo('bob', { title: 'Perso' });
    if (todo.ok) await service.complete('bob', todo.task.id);
    clock.t += 60_000;
    await service.checkIn('bob');

    const seenByAna = await service.stats('bob', 'ana');
    expect(seenByAna).toMatchObject({ id: 'bob', name: 'Bob', xp: 6000 + TODO_XP + CHECKIN_XP, missionsDone: 3, missionsGiven: 1, todosDone: 1, streak: 1, gamesPlayed: 0, gamesWon: 0 });
    expect(seenByAna!.missionsByTier).toEqual([0, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
    expect(seenByAna).not.toHaveProperty('ecus');
    expect(seenByAna).not.toHaveProperty('history');

    const mine = await service.stats('bob', 'bob');
    expect(mine!.ecus).toBe(ecusBetween(0, 6));
    expect(mine!.history!.map((entry) => entry.source)).toEqual(['checkin', 'todo', 'mission', 'mission', 'mission']);
    expect(await service.stats('zoe', 'ana')).toBeNull();
  });

  test('les niveaux de plusieurs personnes d\'un coup (0 sans ligne)', async () => {
    const { db, service } = await setup();
    await grant(db, 'ana', 12_340, 0);
    expect(await service.levels(['ana', 'bob'])).toEqual(new Map([['ana', 12], ['bob', 0]]));
  });

  test('le journal ne garde que les gains réels', async () => {
    const { db, service } = await setup();
    await service.checkIn('ana');
    expect(await db.select({ amount: xpEvent.amount }).from(xpEvent)).toEqual([{ amount: CHECKIN_XP }]);
  });
});
