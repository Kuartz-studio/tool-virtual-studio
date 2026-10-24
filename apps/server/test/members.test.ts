import { CHARACTER_PARTS, SESSION_TTL_S, formatCharacter, formatPremade } from '@bureau/shared';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { progress, session, user } from '../src/db/schema';
import { createTestApp } from './helpers/test-app';

const DAY_MS = 24 * 3600 * 1000;

// Des clés d'avatar valides : deux personnages prêts à l'emploi, et un personnage assemblé (corps, yeux, tenue, coiffure, sans accessoire)
// avec les premières pièces du pack plutôt qu'une clé écrite en dur.
const PREMADE = [formatPremade(2), formatPremade(3)] as const;
const BUILT = formatCharacter({
  body: 1,
  eyes: 1,
  outfit: { style: CHARACTER_PARTS.outfits[0]!.number, color: 1 },
  hair: { style: CHARACTER_PARTS.hair[0]!.number, color: 1 },
  accessory: null,
});

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

// Ce que la base garde d'un compte, pour vérifier qu'une requête a (ou n'a pas) changé quelque chose.
async function accountOf(t: TestApp, userId: string) {
  const [found] = await t.db.select({ name: user.name, email: user.email, role: user.role, avatarKey: user.avatarKey }).from(user).where(eq(user.id, userId));
  return found;
}

async function timezoneOf(t: TestApp, userId: string): Promise<string | undefined> {
  const [found] = await t.db.select({ timezone: user.timezone }).from(user).where(eq(user.id, userId));
  return found?.timezone;
}

function patchMe(t: TestApp, cookie: string, body: unknown) {
  return request(t.app).patch('/api/me').set('Cookie', cookie).send(body as object);
}

describe('GET /api/members', () => {
  test('sans session → 401', async () => {
    const t = await createTestApp();
    const res = await request(t.app).get('/api/members');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(res.get('Cache-Control')).toBe('no-store');
  });

  test('id, nom, avatar, dernière présence, fuseau horaire et niveau des membres, et rien d\'autre (ni e-mail ni rôle)', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const tom = await t.inviteAndAccept('tom@x.fr', { name: 'Tom', role: 'admin' });
    const seenAt = new Date('2026-10-23T08:15:00.000Z');
    await t.db.update(user).set({ avatarKey: PREMADE[0], lastSeenAt: seenAt, timezone: 'America/Montreal' }).where(eq(user.id, tom.userId));
    // Tom a 12 340 XP : niveau 12. Léa n'a pas de progression : niveau 0.
    await t.db.insert(progress).values({ userId: tom.userId, xp: 12_340 });

    // Un membre et un admin voient la même liste, dans l'ordre d'arrivée.
    for (const { cookie } of [lea, tom]) {
      const res = await request(t.app).get('/api/members').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.get('Cache-Control')).toBe('no-store');   // des données privées : pas de copie gardée par le navigateur
      // Léa n'est jamais venue au bureau : pas de dernière présence. Celle de Tom part en ISO 8601. Léa n'a pas choisi de fuseau : l'heure de Paris.
      expect(res.body).toEqual([
        { id: lea.userId, name: 'Léa', avatarKey: null, lastSeenAt: null, timezone: 'Europe/Paris', level: 0 },
        { id: tom.userId, name: 'Tom', avatarKey: PREMADE[0], lastSeenAt: seenAt.toISOString(), timezone: 'America/Montreal', level: 12 },
      ]);
    }
  });

  test('GET /api/members exclut les comptes désactivés', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const tom = await t.inviteAndAccept('tom@x.fr', { name: 'Tom' });
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, tom.userId));

    const res = await request(t.app).get('/api/members').set('Cookie', lea.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: lea.userId, name: 'Léa', avatarKey: null, lastSeenAt: null, timezone: 'Europe/Paris', level: 0 }]);
  });

  test('un compte désactivé dont la session a survécu est refusé quand même', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    expect((await request(t.app).get('/api/members').set('Cookie', lea.cookie)).status).toBe(200);

    // On désactive le compte sans toucher à ses sessions (une connexion en cours pendant le retrait, par exemple).
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, lea.userId));
    const members = await request(t.app).get('/api/members').set('Cookie', lea.cookie);
    expect(members.status).toBe(401);
    const patch = await patchMe(t, lea.cookie, { name: 'Pirate' });
    expect(patch.status).toBe(401);
    expect((await accountOf(t, lea.userId))?.name).toBe('Léa');
  });
});

describe('PATCH /api/me', () => {
  test('sans session → 401, rien ne change', async () => {
    const t = await createTestApp();
    const { userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const changed = vi.fn();
    t.events.on('profile:changed', changed);

    const res = await request(t.app).patch('/api/me').send({ name: 'Pirate' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect((await accountOf(t, userId))?.name).toBe('Léa');
    expect(changed).not.toHaveBeenCalled();
  });

  test('PATCH /api/me', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const changed = vi.fn();
    t.events.on('profile:changed', changed);

    // Un avatar inconnu est refusé : rien ne change, aucun événement.
    const refused = await patchMe(t, cookie, { avatarKey: 'nope' });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({ error: 'invalid' });
    expect(await accountOf(t, userId)).toMatchObject({ name: 'Léa', avatarKey: null });
    expect(changed).not.toHaveBeenCalled();

    // Le nom : 200, enregistré, et profile:changed part avec le profil complet.
    const renamed = await patchMe(t, cookie, { name: 'Léa B.' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual({ id: userId, name: 'Léa B.', avatarKey: null, timezone: 'Europe/Paris' });
    expect(await accountOf(t, userId)).toMatchObject({ name: 'Léa B.', avatarKey: null });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith({ id: userId, name: 'Léa B.', avatarKey: null, timezone: 'Europe/Paris' });

    // L'avatar : le profil envoyé aux autres porte aussi le nom actuel.
    const avatarKey = PREMADE[1];
    const withAvatar = await patchMe(t, cookie, { avatarKey });
    expect(withAvatar.status).toBe(200);
    expect(withAvatar.body).toEqual({ id: userId, name: 'Léa B.', avatarKey, timezone: 'Europe/Paris' });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith({ id: userId, name: 'Léa B.', avatarKey, timezone: 'Europe/Paris' });

    // Les deux ensemble, dans une seule requête et un seul événement ; une clé de personnage assemblé vaut une clé de personnage prêt à l'emploi.
    const both = await patchMe(t, cookie, { name: 'Léa', avatarKey: BUILT });
    expect(both.status).toBe(200);
    expect(changed).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenLastCalledWith({ id: userId, name: 'Léa', avatarKey: BUILT, timezone: 'Europe/Paris' });

    // Le fuseau horaire, seul : le profil entier repart, avec le nom et l'avatar du moment.
    const moved = await patchMe(t, cookie, { timezone: 'America/Montreal' });
    expect(moved.status).toBe(200);
    expect(moved.body).toEqual({ id: userId, name: 'Léa', avatarKey: BUILT, timezone: 'America/Montreal' });
    expect(changed).toHaveBeenCalledTimes(4);
    expect(changed).toHaveBeenLastCalledWith({ id: userId, name: 'Léa', avatarKey: BUILT, timezone: 'America/Montreal' });

    // Better Auth relit la même base : la session voit le nouveau profil.
    const me = await request(t.app).get('/api/auth/get-session').set('Cookie', cookie);
    expect(me.body.user).toMatchObject({ id: userId, name: 'Léa', avatarKey: BUILT, timezone: 'America/Montreal' });
  });

  test('un compte neuf est à l\'heure de Paris ; le fuseau doit être un nom IANA réel, gardé tel qu\'il est écrit', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr');
    expect(await timezoneOf(t, userId)).toBe('Europe/Paris');

    // Un décalage fixe, un nom inventé, une ville seule, un autre type : refusés, rien ne change.
    const refused = ['', '   ', 'Paris', 'Europe/Pariss', 'Mars/Olympus_Mons', '+01:00', 'UTC+2', 'GMT+0100', 'Europe/../Paris', 'Europe Paris', 'x'.repeat(65), null, 2, ['Europe/Paris']];
    for (const timezone of refused) {
      const res = await patchMe(t, cookie, { timezone });
      expect(res.status, JSON.stringify(timezone)).toBe(400);
      expect(res.body).toEqual({ error: 'invalid' });
    }
    expect(await timezoneOf(t, userId)).toBe('Europe/Paris');

    // Les noms IANA, anciens compris (un navigateur peut encore donner « Asia/Calcutta ») ; les espaces autour sont retirés, le nom n'est pas réécrit.
    for (const timezone of ['Asia/Tokyo', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata', 'Asia/Calcutta', 'UTC', 'Etc/GMT+5', 'Pacific/Chatham']) {
      const res = await patchMe(t, cookie, { timezone });
      expect(res.status, timezone).toBe(200);
      expect(await timezoneOf(t, userId)).toBe(timezone);
    }
    expect((await patchMe(t, cookie, { timezone: '  Europe/Paris  ' })).body.timezone).toBe('Europe/Paris');
  });

  test('le nom suit displayNameSchema : espaces retirés, vide ou trop long refusé', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });

    const trimmed = await patchMe(t, cookie, { name: '  Léa B.  ' });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.name).toBe('Léa B.');
    expect((await accountOf(t, userId))?.name).toBe('Léa B.');

    for (const name of ['', '   ', 'x'.repeat(41), 42, null, ['Léa']]) {
      const res = await patchMe(t, cookie, { name });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(res.body).toEqual({ error: 'invalid' });
    }
    expect((await patchMe(t, cookie, { name: 'x'.repeat(40) })).status).toBe(200);   // 40 caractères : la limite
  });

  test('avatarKey doit être une clé d\'avatar connue', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr');
    // Les anciennes clés (dev-red…) ne sont plus valables ; pas plus qu'un numéro hors du pack, une pièce qui n'existe pas ou une clé mal écrite.
    const refused = ['', 'dev-red', 'DEV-RED', ' dev-red', 'P.01', ' p.01', 'p.01 ', 'p.1', 'p.00', 'p.21', 'c.1.1.1-99.0.0', 'c.1.1.1-1.0', null, 3, {}];
    for (const avatarKey of refused) {
      const res = await patchMe(t, cookie, { avatarKey });
      expect(res.status, JSON.stringify(avatarKey)).toBe(400);
    }
    expect((await accountOf(t, userId))?.avatarKey).toBeNull();
    expect((await patchMe(t, cookie, { avatarKey: PREMADE[0] })).status).toBe(200);
    expect((await patchMe(t, cookie, { avatarKey: BUILT })).status).toBe(200);
    expect((await accountOf(t, userId))?.avatarKey).toBe(BUILT);
  });

  test('un corps sans nom, ni avatar, ni fuseau → 400, pas d\'événement', async () => {
    const t = await createTestApp();
    const { cookie } = await t.inviteAndAccept('lea@x.fr');
    const changed = vi.fn();
    t.events.on('profile:changed', changed);

    for (const body of [{}, { role: 'admin' }, [], 'Léa']) {
      const res = await patchMe(t, cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toEqual({ error: 'invalid' });
    }
    expect((await request(t.app).patch('/api/me').set('Cookie', cookie)).status).toBe(400);   // sans corps
    expect(changed).not.toHaveBeenCalled();
  });

  test('seuls le nom, l\'avatar et le fuseau se changent : le client ne choisit ni son rôle, ni son adresse, ni son identifiant', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const tom = await t.inviteAndAccept('tom@x.fr', { name: 'Tom' });

    const res = await patchMe(t, lea.cookie, {
      name: 'Léa B.', role: 'admin', email: 'pirate@x.fr', id: tom.userId, disabledAt: new Date().toISOString(), emailVerified: false,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: lea.userId, name: 'Léa B.', avatarKey: null, timezone: 'Europe/Paris' });
    expect(await accountOf(t, lea.userId)).toEqual({ name: 'Léa B.', email: 'lea@x.fr', role: 'member', avatarKey: null });
    expect(await accountOf(t, tom.userId)).toEqual({ name: 'Tom', email: 'tom@x.fr', role: 'member', avatarKey: null });
    const [stored] = await t.db.select({ disabledAt: user.disabledAt, emailVerified: user.emailVerified }).from(user).where(eq(user.id, lea.userId));
    expect(stored).toEqual({ disabledAt: null, emailVerified: true });
  });
});

// Better Auth sait modifier le profil sans passer par PATCH /api/me, et sans appliquer les règles de displayNameSchema (un nom
// de 41 caractères passe). Ces routes sont fermées : PATCH /api/me est le seul chemin.
describe('routes de profil de Better Auth fermées', () => {
  test('POST /api/auth/update-user : { role: "admin" } ou un nom de 41 caractères sont rejetés, rien ne change', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });

    for (const body of [{ role: 'admin' }, { name: 'x'.repeat(41) }, { name: 'Pirate' }, { avatarKey: 'nope' }, { image: 'https://x.fr/a.png' }, { timezone: 'Mars/Olympus_Mons' }]) {
      const res = await request(t.app).post('/api/auth/update-user').set('Cookie', cookie).send(body);
      expect(res.status, JSON.stringify(body)).toBe(404);
    }
    expect(await accountOf(t, userId)).toEqual({ name: 'Léa', email: 'lea@x.fr', role: 'member', avatarKey: null });
    const [stored] = await t.db.select({ image: user.image }).from(user).where(eq(user.id, userId));
    expect(stored?.image).toBeNull();
  });

  test('changement d\'adresse et suppression de compte : fermés aussi, y compris avec une barre finale', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });

    const attempts: Array<[string, object]> = [
      ['/api/auth/change-email', { newEmail: 'pirate@x.fr' }],
      ['/api/auth/change-email/', { newEmail: 'pirate@x.fr' }],
      ['/api/auth/delete-user', {}],
      ['/api/auth/delete-user/', {}],
      ['/api/auth/update-user/', { role: 'admin' }],
    ];
    for (const [path, body] of attempts) {
      const res = await request(t.app).post(path).set('Cookie', cookie).send(body);
      expect(res.status, path).toBe(404);
    }
    expect(await accountOf(t, userId)).toEqual({ name: 'Léa', email: 'lea@x.fr', role: 'member', avatarKey: null });
  });
});

// Better Auth prolonge une session de 30 jours quand elle a au moins un jour (updateAge) : getSession écrit la nouvelle échéance en
// base, et le cookie qui la porte n'existe que dans les en-têtes de sa réponse. Si requireSession les jetait, la base serait
// prolongée et pas le cookie : le navigateur le supprimerait au 30e jour alors que la session vit encore, et la personne qui
// utilise le bureau chaque jour serait déconnectée. /api/auth/get-session ne rattraperait rien : la session n'y serait plus due.
describe('prolongation de la session', () => {
  // Il reste 29 jours sur 30 : la session est due pour sa prolongation.
  function ageSession(t: TestApp, userId: string) {
    return t.db.update(session).set({ expiresAt: new Date(Date.now() + 29 * DAY_MS) }).where(eq(session.userId, userId));
  }

  async function expiryOf(t: TestApp, userId: string): Promise<Date> {
    const [found] = await t.db.select({ expiresAt: session.expiresAt }).from(session).where(eq(session.userId, userId));
    return found!.expiresAt;
  }

  test.each([
    ['développement', false],
    ['production', true],
  ])('une session qui a plus d\'un jour est prolongée en base, et la réponse renvoie le cookie prolongé (%s)', async (_label, production) => {
    const t = await createTestApp({ env: production ? { NODE_ENV: 'production' } : {} });
    const cookieName = production ? '__Secure-better-auth.session_token' : 'better-auth.session_token';
    const lea = await t.inviteAndAccept('lea@x.fr');
    const boss = await t.inviteAndAccept('chef@x.fr', { role: 'admin' });

    // Une session neuve n'a rien à prolonger : aucun cookie n'est renvoyé.
    const fresh = await request(t.app).get('/api/members').set('Cookie', lea.cookie);
    expect(fresh.status).toBe(200);
    expect(fresh.get('Set-Cookie')).toBeUndefined();

    // requireSession puis requireAdmin : la première requête de la journée porte le cookie prolongé.
    for (const [who, path] of [[lea, '/api/members'], [boss, '/api/admin/members']] as const) {
      await ageSession(t, who.userId);
      const res = await request(t.app).get(path).set('Cookie', who.cookie);
      expect(res.status, path).toBe(200);

      const cookies = res.get('Set-Cookie') ?? [];
      expect(cookies, path).toHaveLength(1);
      const refreshed = cookies[0]!;
      expect(refreshed.split(';')[0], path).toBe(who.cookie);   // la même session, signée : le navigateur remplace son cookie
      expect(refreshed.startsWith(`${cookieName}=`), path).toBe(true);
      expect(refreshed).toMatch(new RegExp(`;\\s*Max-Age=${SESSION_TTL_S}(;|$)`, 'i'));   // 30 jours de plus, à partir de maintenant
      expect(refreshed).toMatch(/;\s*HttpOnly/i);
      expect(refreshed).toMatch(/;\s*SameSite=Lax/i);
      expect(/;\s*Secure(;|$)/i.test(refreshed), path).toBe(production);
      // En base aussi : l'échéance repart de maintenant.
      expect((await expiryOf(t, who.userId)).getTime(), path).toBeGreaterThan(Date.now() + SESSION_TTL_S * 1000 - 60_000);

      // La requête suivante n'a plus rien à prolonger, pas plus que get-session de Better Auth : notre réponse était la seule
      // occasion de livrer le cookie.
      const again = await request(t.app).get(path).set('Cookie', who.cookie);
      expect(again.status, path).toBe(200);
      expect(again.get('Set-Cookie'), path).toBeUndefined();
      const viaBetterAuth = await request(t.app).get('/api/auth/get-session').set('Cookie', who.cookie);
      expect(viaBetterAuth.get('Set-Cookie'), path).toBeUndefined();
    }
  });

  test('session supprimée entre la lecture et la prolongation → 401 { error: "unauthorized" }, pas la page d\'erreur d\'Express', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    const boss = await t.inviteAndAccept('chef@x.fr', { role: 'admin' });
    const { internalAdapter } = await t.auth.$context;

    for (const [who, path] of [[lea, '/api/members'], [boss, '/api/admin/members']] as const) {
      await ageSession(t, who.userId);
      // Better Auth ne retrouve plus la session au moment de la prolonger (un retrait vient de la supprimer) : il lève une 401
      // au lieu de répondre « aucune session ».
      const update = vi.spyOn(internalAdapter, 'updateSession').mockResolvedValueOnce(null as never);
      const res = await request(t.app).get(path).set('Cookie', who.cookie);
      expect(update, path).toHaveBeenCalledTimes(1);
      expect(res.status, path).toBe(401);
      expect(res.type, path).toBe('application/json');
      expect(res.body, path).toEqual({ error: 'unauthorized' });
      update.mockRestore();
    }
  });

  test('une autre erreur de Better Auth n\'est pas prise pour une session absente : 500', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    // Une panne de la base ne doit pas déconnecter tout le monde : le client ne doit pas lire 401.
    vi.spyOn(t.auth.api, 'getSession').mockRejectedValueOnce(new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to get session' }));
    // L'erreur 500 s'écrit sur la sortie d'erreur quand le journal est muet (errors.test.ts) : on la tait ici.
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => stderr.mockRestore());

    const res = await request(t.app).get('/api/members').set('Cookie', lea.cookie);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal' });
    expect(stderr).toHaveBeenCalledOnce();
  });

  test('le cookie d\'une session supprimée : 401, et la réponse efface le cookie du navigateur', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    await t.db.delete(session).where(eq(session.userId, lea.userId));

    const res = await request(t.app).get('/api/members').set('Cookie', lea.cookie);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(res.get('Set-Cookie')?.join(';')).toMatch(/session_token=;\s*Max-Age=0/);
  });

  test('un compte désactivé est refusé sans que son cookie soit prolongé', async () => {
    const t = await createTestApp();
    const lea = await t.inviteAndAccept('lea@x.fr');
    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, lea.userId));
    await ageSession(t, lea.userId);

    const res = await request(t.app).get('/api/members').set('Cookie', lea.cookie);
    expect(res.status).toBe(401);
    expect(res.get('Set-Cookie')).toBeUndefined();
  });
});
