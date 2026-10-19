import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import request, { type Response } from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { rateLimit, session, user, verification } from '../src/db/schema';
import { resetPasswordSubject } from '../src/mail/templates/reset-password-email';
import { createTestApp, TEST_PASSWORD } from './helpers/test-app';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const WRONG_PASSWORD = 'pas-le-bon-mot-de-passe';
const NEW_PASSWORD = 'nouveaumdp1';
const HOUR_MS = 3600 * 1000;

function signIn(t: TestApp, email: string, password: string) {
  return request(t.app).post('/api/auth/sign-in/email').send({ email, password });
}

// `redirectTo` : la page de l'appli qui reçoit le jeton une fois le lien de l'e-mail ouvert.
function requestReset(t: TestApp, email: string) {
  return request(t.app).post('/api/auth/request-password-reset').send({ email, redirectTo: `${t.env.APP_URL}/reinitialiser` });
}

function resetPassword(t: TestApp, token: string | null | undefined, newPassword: string) {
  return request(t.app).post('/api/auth/reset-password').send({ token, newPassword });
}

// Le lien de l'e-mail est une adresse complète, et supertest veut le chemin.
function openLink(t: TestApp, link: string) {
  const { pathname, search } = new URL(link);
  return request(t.app).get(pathname + search);
}

// L'e-mail envoyé à cette adresse. On l'attend au lieu de le supposer déjà posé : le rendu du modèle est asynchrone,
// et rien ne dit que Better Auth attendra toujours la fin de l'envoi avant de répondre.
function mailTo(t: TestApp, email: string) {
  return vi.waitFor(() => {
    const mail = t.mailer.last(email);
    expect(mail).toBeDefined();
    return mail!;
  });
}

// Le cookie d'une réponse de connexion, prêt pour `.set('Cookie', …)`.
function cookieOf(res: Response): string {
  return (res.get('Set-Cookie') ?? []).map((setCookie) => setCookie.split(';')[0]).join('; ');
}

// Un journal pino dont on garde les lignes (objets JSON), pour vérifier ce que le serveur journalise.
function captureLogs() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { logger: pino({ level: 'info' }, stream), lines };
}

describe('connexion', () => {
  test('connexion après invitation, session avec rôle', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept('lea@x.fr', { name: 'Léa' });

    const res = await signIn(t, 'lea@x.fr', TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'lea@x.fr', name: 'Léa', role: 'member' });
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/session_token=/);

    const me = await request(t.app).get('/api/auth/get-session').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'lea@x.fr', role: 'member' });
  });

  test('mauvais mot de passe → 401', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept('lea@x.fr');
    const sessionsBefore = await t.db.$count(session);

    const wrong = await signIn(t, 'lea@x.fr', WRONG_PASSWORD);
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(wrong.get('Set-Cookie')).toBeUndefined();
    expect(await t.db.$count(session)).toBe(sessionsBefore);   // aucune session ouverte

    // Une adresse sans compte reçoit exactement la même réponse : rien ne dit quelles adresses ont un compte.
    const unknown = await signIn(t, 'inconnu@x.fr', WRONG_PASSWORD);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  test('déconnexion : la session est supprimée et son cookie ne vaut plus rien', async () => {
    const t = await createTestApp();
    const { cookie, userId } = await t.inviteAndAccept('lea@x.fr');
    const before = await request(t.app).get('/api/auth/get-session').set('Cookie', cookie);
    expect(before.body.user.id).toBe(userId);

    const out = await request(t.app).post('/api/auth/sign-out').set('Cookie', cookie);
    expect(out.status).toBe(200);
    expect(out.get('Set-Cookie')?.join(';')).toMatch(/session_token=;\s*Max-Age=0/);   // le navigateur efface le cookie
    expect(await t.db.$count(session)).toBe(0);

    // L'ancien cookie, rejoué à la main, n'ouvre plus rien.
    const after = await request(t.app).get('/api/auth/get-session').set('Cookie', cookie);
    expect(after.status).toBe(200);
    expect(after.body).toBeNull();
  });
});

// Ces tests sont les seuls à activer la limitation des tentatives (AUTH_RATE_LIMIT=on). Elle compte par adresse IP et par
// route, dans la base de chaque application de test : les autres tests, où elle est coupée, n'en sont pas touchés.
describe('limitation des tentatives', () => {
  test('4e tentative en 10 s → 429', async () => {
    const t = await createTestApp({ env: { AUTH_RATE_LIMIT: 'on' } });
    await t.inviteAndAccept('lea@x.fr');   // l'acceptation de l'invitation ne passe pas par la route de connexion
    expect(await t.db.$count(rateLimit)).toBe(0);

    for (let attempt = 1; attempt <= 3; attempt++) {
      expect((await signIn(t, 'lea@x.fr', WRONG_PASSWORD)).status).toBe(401);
    }
    // La 4e est refusée avant même qu'on regarde le mot de passe : le bon ne passe pas non plus.
    const blocked = await signIn(t, 'lea@x.fr', TEST_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.get('Set-Cookie')).toBeUndefined();
    // Le compteur est en base (et non dans la mémoire du processus), comme l'exige la spécification.
    expect(await t.db.$count(rateLimit)).toBeGreaterThan(0);
  });

  test('4e demande de réinitialisation en 60 s → 429', async () => {
    const t = await createTestApp({ env: { AUTH_RATE_LIMIT: 'on' } });
    await t.inviteAndAccept('lea@x.fr');

    for (let attempt = 1; attempt <= 3; attempt++) {
      expect((await requestReset(t, 'lea@x.fr')).status).toBe(200);
    }
    expect((await requestReset(t, 'lea@x.fr')).status).toBe(429);
    await vi.waitFor(() => expect(t.mailer.sent).toHaveLength(3));   // la 4e n'a rien envoyé
  });

  test('limitation coupée (réglage par défaut des tests) : plus de 3 tentatives de suite restent des 401', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept('lea@x.fr');
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await signIn(t, 'lea@x.fr', WRONG_PASSWORD)).status).toBe(401);
    }
    expect(await t.db.$count(rateLimit)).toBe(0);
  });
});

describe('mot de passe oublié', () => {
  test('mot de passe oublié de bout en bout', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept('lea@x.fr');

    // 1. La demande, avec l'adresse telle qu'on la tape (majuscules comprises) : 200, et un e-mail part vers celle du compte.
    const asked = await requestReset(t, 'Lea@X.fr');
    expect(asked.status).toBe(200);
    const mail = await mailTo(t, 'lea@x.fr');
    expect(mail.to).toBe('lea@x.fr');
    expect(mail.subject).toBe(resetPasswordSubject);
    const link = new URL(mail.link);
    expect(link.origin).toBe(new URL(t.env.APP_URL).origin);   // le lien mène à notre serveur
    expect(link.pathname).toMatch(/^\/api\/auth\/reset-password\/[^/]+$/);

    // 2. Le lien : Better Auth vérifie le jeton, puis renvoie vers la page de l'appli avec le jeton en paramètre.
    const clicked = await openLink(t, mail.link);
    expect(clicked.status).toBe(302);
    const location = clicked.get('Location') ?? '';
    expect(location).toContain('/reinitialiser?token=');
    expect(location.startsWith(`${t.env.APP_URL}/reinitialiser?token=`)).toBe(true);
    const token = new URL(location).searchParams.get('token');
    expect(token).toBeTruthy();

    // 3. Le nouveau mot de passe.
    expect((await resetPassword(t, token, NEW_PASSWORD)).status).toBe(200);

    // 4. Il ouvre une session, l'ancien non.
    expect((await signIn(t, 'lea@x.fr', NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(t, 'lea@x.fr', TEST_PASSWORD)).status).toBe(401);

    // 5. Le jeton ne sert qu'une fois : le rejouer ne change plus le mot de passe.
    const replay = await resetPassword(t, token, 'encoreunautre1');
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('INVALID_TOKEN');
    expect((await signIn(t, 'lea@x.fr', NEW_PASSWORD)).status).toBe(200);
  });

  test('e-mail inconnu → 200 et aucun e-mail envoyé', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept('lea@x.fr');

    const unknown = await requestReset(t, 'inconnu@x.fr');
    expect(unknown.status).toBe(200);
    expect(t.mailer.sent.length).toBe(0);
    expect(await t.db.$count(verification)).toBe(0);   // pas de jeton non plus

    // La réponse ne laisse rien deviner : c'est la même pour une adresse qui a un compte.
    const known = await requestReset(t, 'lea@x.fr');
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    await mailTo(t, 'lea@x.fr');
  });

  test('le lien expire au bout d\'une heure', async () => {
    const t = await createTestApp();
    await t.inviteAndAccept('lea@x.fr');
    expect((await requestReset(t, 'lea@x.fr')).status).toBe(200);
    const mail = await mailTo(t, 'lea@x.fr');

    // Le jeton est enregistré avec une échéance d'une heure.
    const [stored] = await t.db.select().from(verification);
    expect(stored?.identifier).toMatch(/^reset-password:/);
    const remainingMs = stored!.expiresAt.getTime() - Date.now();
    expect(remainingMs).toBeGreaterThan(HOUR_MS - 60_000);
    expect(remainingMs).toBeLessThanOrEqual(HOUR_MS);

    // Échéance dépassée : le lien renvoie vers l'appli avec une erreur et sans jeton, et le jeton ne change plus rien.
    await t.db.update(verification).set({ expiresAt: new Date(Date.now() - 1000) });
    const clicked = await openLink(t, mail.link);
    expect(clicked.status).toBe(302);
    const location = new URL(clicked.get('Location') ?? '');
    expect(location.pathname).toBe('/reinitialiser');
    expect(location.searchParams.get('error')).toBe('INVALID_TOKEN');
    expect(location.searchParams.has('token')).toBe(false);

    const token = new URL(mail.link).pathname.split('/').at(-1);
    const late = await resetPassword(t, token, NEW_PASSWORD);
    expect(late.status).toBe(400);
    expect(late.body.code).toBe('INVALID_TOKEN');
    expect((await signIn(t, 'lea@x.fr', TEST_PASSWORD)).status).toBe(200);   // l'ancien mot de passe n'a pas changé
  });

  test('échec de l\'envoi : même réponse qu\'une adresse inconnue, erreur journalisée sans adresse ni lien', async () => {
    const { logger, lines } = captureLogs();
    const t = await createTestApp({ logger });
    const { userId } = await t.inviteAndAccept('lea@x.fr');
    const unknown = await requestReset(t, 'inconnu@x.fr');
    const send = vi.spyOn(t.mailer, 'sendPasswordReset').mockRejectedValue(new Error('Resend est indisponible'));

    const res = await requestReset(t, 'lea@x.fr');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(unknown.body);
    expect(send).toHaveBeenCalledTimes(1);

    const message = 'Envoi de l\'e-mail de réinitialisation impossible';
    await vi.waitFor(() => expect(lines.some((line) => line.msg === message)).toBe(true));
    expect(lines.find((line) => line.msg === message)).toMatchObject({ level: 50, userId, err: { message: 'Resend est indisponible' } });
    // Le lien contient un jeton qui ouvre le compte, et l'adresse est une donnée personnelle : ni l'un ni l'autre dans le journal.
    const { link } = send.mock.calls[0]![0];
    const journal = JSON.stringify(lines);
    expect(journal).not.toContain(link);
    expect(journal).not.toContain(new URL(link).pathname.split('/').at(-1)!);
    expect(journal).not.toContain('lea@x.fr');
    expect(t.mailer.sent).toHaveLength(0);
  });
});

describe('comptes désactivés', () => {
  test('compte désactivé → connexion refusée', async () => {
    const t = await createTestApp();
    const { userId } = await t.inviteAndAccept('lea@x.fr');
    const sessionsBefore = await t.db.$count(session);

    await t.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, userId));
    const refused = await signIn(t, 'lea@x.fr', TEST_PASSWORD);   // le bon mot de passe
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ACCOUNT_DISABLED');
    expect(refused.get('Set-Cookie')).toBeUndefined();
    expect(await t.db.$count(session)).toBe(sessionsBefore);   // aucune session créée

    // Sans le bon mot de passe, rien n'indique que le compte est désactivé.
    const wrong = await signIn(t, 'lea@x.fr', WRONG_PASSWORD);
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');

    // Réactivé (disabledAt vidé), le même mot de passe rouvre l'accès : le refus ne tenait qu'à disabledAt.
    await t.db.update(user).set({ disabledAt: null }).where(eq(user.id, userId));
    expect((await signIn(t, 'lea@x.fr', TEST_PASSWORD)).status).toBe(200);
  });
});
