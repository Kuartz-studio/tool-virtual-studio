import request, { type Response } from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/app';
import { createMemoryMailer } from '../src/mail/mailer';
import { captureLogs } from './helpers/logs';
import { createNoneTestApp, createTestApp, findUserByEmail, TEST_PASSWORD } from './helpers/test-app';

// Les routes admin sans e-mail (MAILER=none) : l'admin reçoit les liens et les transmet lui-même.

type NoneApp = Awaited<ReturnType<typeof createNoneTestApp>>;
type AnyApp = NoneApp | Awaited<ReturnType<typeof createTestApp>>;

const asAdmin = (t: AnyApp, email = 'admin@x.fr', name = 'Camille') => t.inviteAndAccept(email, { role: 'admin', name });

function invite(t: AnyApp, cookie: string, body: object) {
  return request(t.app).post('/api/admin/invitations').set('Cookie', cookie).send(body);
}

function resend(t: AnyApp, cookie: string, id: string) {
  return request(t.app).post(`/api/admin/invitations/${id}/resend`).set('Cookie', cookie);
}

function accept(t: AnyApp, token: string, name = 'Nouvelle') {
  return request(t.app).post('/api/invitations/accept').send({ token, name, password: TEST_PASSWORD });
}

// Le jeton d'un lien d'invitation.
function tokenOf(link: unknown): string {
  expect(typeof link).toBe('string');
  const token = new URL(link as string).searchParams.get('token');
  if (!token) throw new Error('aucun jeton dans le lien');
  return token;
}

const bodyOf = (res: Response) => res.body as Record<string, unknown>;

describe('invitations sans e-mail', () => {
  test('inviter répond 201 avec le lien, et rien n\'est envoyé', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const send = vi.spyOn(t.mailer, 'sendInvitation');

    const res = await invite(t, admin.cookie, { email: 'new@x.fr' });
    expect(res.status).toBe(201);
    // Le corps d'avant, plus le lien.
    expect(res.body).toMatchObject({ email: 'new@x.fr', role: 'member', invitedBy: admin.userId, expired: false });
    expect(Object.keys(bodyOf(res)).sort()).toEqual(['createdAt', 'email', 'expired', 'expiresAt', 'id', 'invitedBy', 'link', 'role']);
    const link = bodyOf(res).link as string;
    expect(link.startsWith(`${t.env.APP_URL}/rejoindre?token=`)).toBe(true);
    expect(res.get('Cache-Control')).toBe('no-store');
    expect(send).not.toHaveBeenCalled();

    // Le lien est celui de l'invitation créée, et il ouvre un compte pour cette adresse.
    expect(await t.invitations.check(tokenOf(link))).toMatchObject({
      status: 'valid',
      invitation: { id: res.body.id, email: 'new@x.fr', role: 'member', invitedBy: admin.userId },
    });
    expect((await accept(t, tokenOf(link), 'Nina')).status).toBe(201);
    expect(await findUserByEmail(t.db, 'new@x.fr')).toMatchObject({ role: 'member', emailVerified: true });
  });

  test('mail_failed ne peut pas arriver : même un mailer qui échouerait n\'est pas appelé', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    vi.spyOn(t.mailer, 'sendInvitation').mockRejectedValue(new Error('ne devrait pas être appelé'));

    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    expect(created.status).toBe(201);
    const resent = await resend(t, admin.cookie, created.body.id as string);
    expect(resent.status).toBe(200);
    expect(JSON.stringify([created.body, resent.body])).not.toContain('mail_failed');
  });

  test('relancer répond { ok, link } avec un jeton neuf : l\'ancien lien ne marche plus', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    const oldToken = tokenOf(created.body.link);

    const res = await resend(t, admin.cookie, created.body.id as string);
    expect(res.status).toBe(200);
    expect(Object.keys(bodyOf(res)).sort()).toEqual(['link', 'ok']);
    expect(res.body.ok).toBe(true);
    expect(res.get('Cache-Control')).toBe('no-store');
    const newToken = tokenOf(res.body.link);
    expect((res.body.link as string).startsWith(`${t.env.APP_URL}/rejoindre?token=`)).toBe(true);
    expect(newToken).not.toBe(oldToken);

    expect((await t.invitations.check(oldToken)).status).toBe('unknown');
    expect((await accept(t, oldToken)).status).toBe(404);
    expect((await t.invitations.check(newToken)).status).toBe('valid');
    expect((await accept(t, newToken)).status).toBe(201);
  });

  test('relancer une invitation inconnue répond toujours 404 not_found, sans lien', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const res = await resend(t, admin.cookie, '00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  test('avec Resend ou en mémoire, les réponses n\'ont pas de lien', async () => {
    const t = await createTestApp();
    const admin = await asAdmin(t);
    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('link');
    const resent = await resend(t, admin.cookie, created.body.id as string);
    expect(resent.body).toEqual({ ok: true });
  });

  test('le lien ne se relit nulle part : ni dans la liste des invitations, ni dans celle des membres', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    const token = tokenOf(created.body.link);
    const resent = await resend(t, admin.cookie, created.body.id as string);
    const newToken = tokenOf(resent.body.link);

    const invitations = await request(t.app).get('/api/admin/invitations').set('Cookie', admin.cookie);
    const members = await request(t.app).get('/api/admin/members').set('Cookie', admin.cookie);
    const publicMembers = await request(t.app).get('/api/members').set('Cookie', admin.cookie);
    const publicInvitation = await request(t.app).get(`/api/invitations/${newToken}`);
    for (const res of [invitations, members, publicMembers, publicInvitation]) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/link|rejoindre|token/i);
      expect(text).not.toContain(token);
      expect(text).not.toContain(newToken);
    }
    expect(invitations.body).toHaveLength(1);
  });

  test('le journal ne reçoit jamais le lien ni son jeton', async () => {
    const { logger, lines } = captureLogs();
    const t = await createNoneTestApp({ logger });
    const admin = await asAdmin(t);
    const created = await invite(t, admin.cookie, { email: 'new@x.fr' });
    const resent = await resend(t, admin.cookie, created.body.id as string);
    const tokens = [tokenOf(created.body.link), tokenOf(resent.body.link)];
    // Une relance sur une invitation disparue, et une invitation en double : les refus ne journalisent pas non plus.
    await resend(t, admin.cookie, '00000000-0000-4000-8000-000000000000');
    await invite(t, admin.cookie, { email: 'new@x.fr' });

    const journal = JSON.stringify(lines);
    for (const token of tokens) expect(journal).not.toContain(token);
    expect(journal).not.toContain('rejoindre');
  });
});

// ---- Mot de passe sans e-mail -------------------------------------------------------------------------------------------------------

const NEW_PASSWORD = 'nouveaumdp1';

function resetLink(t: AnyApp, cookie: string | undefined, memberId: string) {
  const req = request(t.app).post(`/api/admin/members/${memberId}/reset-link`);
  return cookie ? req.set('Cookie', cookie) : req;
}

function signIn(t: AnyApp, email: string, password: string) {
  return request(t.app).post('/api/auth/sign-in/email').send({ email, password });
}

// Ouvre le lien comme le ferait la personne : Better Auth vérifie le jeton puis renvoie vers la page de l'appli, avec le jeton.
async function resetTokenOf(t: AnyApp, link: string): Promise<string> {
  const { pathname, search } = new URL(link);
  const clicked = await request(t.app).get(pathname + search);
  expect(clicked.status).toBe(302);
  const location = clicked.get('Location') ?? '';
  expect(location.startsWith(`${t.env.APP_URL}/reinitialiser?token=`)).toBe(true);
  return new URL(location).searchParams.get('token')!;
}

function sessionEmail(t: AnyApp, cookie: string) {
  return request(t.app)
    .get('/api/auth/get-session')
    .set('Cookie', cookie)
    .then((res) => (res.body?.user?.email as string | undefined) ?? null);
}

describe('POST /api/admin/members/:id/reset-link', () => {
  test('un admin obtient le lien d\'un membre, et ce lien change vraiment son mot de passe de bout en bout', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });
    const other = await t.inviteAndAccept('tom@x.fr');
    const revoked: string[] = [];
    t.events.on('sessions:revoked', (userId) => revoked.push(userId));

    const res = await resetLink(t, admin.cookie, lea.userId);
    expect(res.status).toBe(200);
    expect(Object.keys(bodyOf(res))).toEqual(['link']);
    expect(res.get('Cache-Control')).toBe('no-store');
    const link = res.body.link as string;
    // Le lien de Better Auth, vers notre serveur, qui renvoie vers la page de l'appli.
    expect(new URL(link).origin).toBe(new URL(t.env.APP_URL).origin);
    expect(new URL(link).pathname).toMatch(/^\/api\/auth\/reset-password\/[^/]+$/);
    // Rien ne reste dans la réserve du mailer : le lien a été rendu.
    expect(t.mailer.resetLinks.size).toBe(0);

    const token = await resetTokenOf(t, link);
    const reset = await request(t.app).post('/api/auth/reset-password').send({ token, newPassword: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    // Le nouveau mot de passe ouvre une session, l'ancien non ; le lien ne sert qu'une fois.
    expect((await signIn(t, 'lea@x.fr', NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(t, 'lea@x.fr', TEST_PASSWORD)).status).toBe(401);
    expect((await request(t.app).post('/api/auth/reset-password').send({ token, newPassword: 'encoreunautre1' })).status).toBe(400);

    // Comme avec l'e-mail : les sessions du compte sont fermées, celles des autres restent, et le temps réel coupe ses connexions.
    expect(await sessionEmail(t, lea.cookie)).toBeNull();
    expect(await sessionEmail(t, other.cookie)).toBe('tom@x.fr');
    expect(await sessionEmail(t, admin.cookie)).toBe('admin@x.fr');
    expect(revoked).toEqual([lea.userId]);
  });

  test('chaque demande donne un lien neuf, même deux à la fois pour le même membre', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr');

    const [first, second] = await Promise.all([resetLink(t, admin.cookie, lea.userId), resetLink(t, admin.cookie, lea.userId)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const links = [first.body.link, second.body.link] as string[];
    expect(links[0]).not.toBe(links[1]);
    // Chaque lien ouvre sa propre demande : les deux sont utilisables.
    for (const link of links) expect(await resetTokenOf(t, link)).toBeTruthy();
    expect(t.mailer.resetLinks.size).toBe(0);
  });

  // auth.ts détache l'envoi (`void mailer.sendPasswordReset(…)`) : la requête à Better Auth peut finir avant que le mailer ait le lien.
  // La route l'attend (2 s au plus), et ne prend pas pour le sien un lien resté là d'une demande dont personne n'a repris le résultat.
  test('le lien arrive en arrière-plan : la route l\'attend, et ignore un lien resté dans la réserve', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr');
    t.mailer.resetLinks.put('lea@x.fr', 'https://autre.exemple/ancien-lien');
    const deliver = t.mailer.sendPasswordReset;
    const send = vi.spyOn(t.mailer, 'sendPasswordReset').mockImplementation(async (mail) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await deliver(mail);
    });

    const res = await resetLink(t, admin.cookie, lea.userId);
    expect(send).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.body.link).not.toBe('https://autre.exemple/ancien-lien');
    expect((res.body.link as string).startsWith(`${t.env.APP_URL}/api/auth/reset-password/`)).toBe(true);
    expect(await resetTokenOf(t, res.body.link as string)).toBeTruthy();
  });

  test('en dehors de MAILER=none, la route répond 404 not_found à un admin, sans créer de jeton', async () => {
    const t = await createTestApp();   // MAILER=memory
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr');
    const res = await resetLink(t, admin.cookie, lea.userId);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(t.mailer.sent).toHaveLength(0);

    const resend = await createTestApp({ env: { MAILER: 'resend' } });
    const resendAdmin = await asAdmin(resend);
    const resendLea = await resend.inviteAndAccept('lea@x.fr');
    expect((await resetLink(resend, resendAdmin.cookie, resendLea.userId)).status).toBe(404);
    expect(resend.mailer.sent).toHaveLength(0);
  });

  test('anonyme → 401, membre → 403, en mode none comme sans', async () => {
    for (const make of [createNoneTestApp, createTestApp]) {
      const t = await make();
      const lea = await t.inviteAndAccept('lea@x.fr');
      const tom = await t.inviteAndAccept('tom@x.fr');
      const anonymous = await resetLink(t, undefined, tom.userId);
      expect(anonymous.status).toBe(401);
      expect(anonymous.body).toEqual({ error: 'unauthorized' });
      const member = await resetLink(t, lea.cookie, tom.userId);
      expect(member.status).toBe(403);
      expect(member.body).toEqual({ error: 'forbidden' });
      expect(JSON.stringify([anonymous.body, member.body])).not.toMatch(/link/);
    }
  });

  test('membre inconnu ou retiré → 404 not_found, sans jeton ni lien', async () => {
    const { logger, lines } = captureLogs();
    const t = await createNoneTestApp({ logger });
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr');
    await request(t.app).delete(`/api/admin/members/${lea.userId}`).set('Cookie', admin.cookie);   // le retrait désactive le compte

    for (const id of [lea.userId, 'inconnu', '00000000-0000-4000-8000-000000000000', '%2e%2e']) {
      const res = await resetLink(t, admin.cookie, id);
      expect(res.status, id).toBe(404);
      expect(res.body, id).toEqual({ error: 'not_found' });
    }
    expect(t.mailer.resetLinks.size).toBe(0);
    expect(await t.db.$count((await import('../src/db/schema')).verification)).toBe(0);   // aucun jeton créé
    expect(JSON.stringify(lines)).not.toContain('lea@x.fr');
  });

  test('un admin peut demander le lien d\'un autre admin, et le sien', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const cleo = await asAdmin(t, 'cleo@x.fr', 'Cléo');
    expect((await resetLink(t, admin.cookie, cleo.userId)).status).toBe(200);
    expect((await resetLink(t, admin.cookie, admin.userId)).status).toBe(200);
  });

  test('aucun lien dans les 2 secondes → 502 reset_failed', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr');
    // Le mailer n'enregistre rien : la route attend le lien, puis renonce.
    vi.spyOn(t.mailer, 'sendPasswordReset').mockResolvedValue(undefined);

    const started = performance.now();
    const res = await resetLink(t, admin.cookie, lea.userId);
    const elapsed = performance.now() - started;
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'reset_failed' });
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(5000);
  }, 15_000);

  test('Better Auth qui échoue → 502 reset_failed, journalisé sans adresse ni lien', async () => {
    const { logger, lines } = captureLogs();
    const t = await createNoneTestApp({ logger });
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr');
    vi.spyOn(t.auth.api, 'requestPasswordReset').mockRejectedValue(new Error('La base est tombée'));

    const res = await resetLink(t, admin.cookie, lea.userId);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'reset_failed' });
    const failure = lines.find((line) => line.msg === 'Création du lien de mot de passe impossible');
    expect(failure).toMatchObject({ level: 50, userId: lea.userId, err: { message: 'La base est tombée' } });
    expect(JSON.stringify(lines)).not.toContain('lea@x.fr');
  });

  test('le lien et son jeton ne sont jamais journalisés', async () => {
    const { logger, lines } = captureLogs();
    const t = await createNoneTestApp({ logger });
    const admin = await asAdmin(t);
    const lea = await t.inviteAndAccept('lea@x.fr');

    const res = await resetLink(t, admin.cookie, lea.userId);
    const link = res.body.link as string;
    const journal = JSON.stringify(lines);
    expect(journal).not.toContain(link);
    expect(journal).not.toContain(new URL(link).pathname.split('/').at(-1)!);
    expect(journal).not.toContain('lea@x.fr');
  });
});

describe('mot de passe oublié, demandé par n\'importe qui, sans e-mail', () => {
  const requestReset = (t: AnyApp, email: string) =>
    request(t.app).post('/api/auth/request-password-reset').send({ email, redirectTo: `${t.env.APP_URL}/reinitialiser` });

  test('la réponse est la même pour une adresse inconnue et pour un compte, et rien n\'est envoyé ni gardé', async () => {
    const t = await createNoneTestApp();
    const admin = await asAdmin(t);
    await t.inviteAndAccept('lea@x.fr');
    const deliver = vi.spyOn(t.mailer, 'sendPasswordReset');

    const unknown = await requestReset(t, 'inconnu@x.fr');
    const known = await requestReset(t, 'lea@x.fr');
    const adminAddress = await requestReset(t, 'admin@x.fr');
    for (const res of [unknown, known, adminAddress]) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual(unknown.body);
    }
    expect(unknown.body).toEqual({ status: true, message: 'If this email exists in our system, check your email for the reset link' });

    // Aucun lien n'est parti vers la réserve du mailer : ni lui, ni la route de l'admin ne montrent qu'un compte existe.
    expect(deliver).not.toHaveBeenCalled();
    expect(t.mailer.resetLinks.size).toBe(0);
    // La route de l'admin donne un lien neuf, que la demande publique n'a pas fourni.
    const lea = await request(t.app).get('/api/admin/members').set('Cookie', admin.cookie);
    const leaId = (lea.body as Array<{ id: string; email: string }>).find((m) => m.email === 'lea@x.fr')!.id;
    expect((await resetLink(t, admin.cookie, leaId)).status).toBe(200);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  test('même réponse qu\'avec Resend : la demande publique garde son comportement hors du mode none', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept('lea@x.fr');
    const unknown = await requestReset(t, 'inconnu@x.fr');
    expect(unknown.status).toBe(200);
    const known = await requestReset(t, 'lea@x.fr');
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    await vi.waitFor(() => expect(t.mailer.last('lea@x.fr')).toBeDefined(), { timeout: 4000 });
  });

  test('la demande publique ne journalise ni lien, ni adresse', async () => {
    const { logger, lines } = captureLogs();
    const t = await createNoneTestApp({ logger });
    await t.inviteAndAccept('lea@x.fr');
    await requestReset(t, 'lea@x.fr');
    await requestReset(t, 'inconnu@x.fr');
    const journal = JSON.stringify(lines);
    expect(journal).not.toContain('reset-password/');
    expect(journal).not.toContain('lea@x.fr');
    expect(journal).not.toContain('inconnu@x.fr');
  });
});

test('MAILER=none avec un autre mailer → l\'application refuse de démarrer', async () => {
  const t = await createNoneTestApp();
  expect(() => createApp({ ...t, mailer: createMemoryMailer() })).toThrow(/MAILER=none/);
});
