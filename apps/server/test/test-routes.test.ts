import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/app';
import type { Mailer } from '../src/mail/mailer';
import { resetPasswordSubject } from '../src/mail/templates/reset-password-email';
import { createTestApp, findUserByEmail } from './helpers/test-app';

// Les routes réservées aux tests de bout en bout (E2E=1).
const e2eApp = () => createTestApp({ env: { E2E: '1' } });

// Le jeton d'un lien d'invitation (…/rejoindre?token=…).
const tokenOf = (link: string) => new URL(link).searchParams.get('token') ?? '';

test('sans E2E=1, les routes de test n\'existent pas', async () => {
  const { app } = await createTestApp();
  const invite = await request(app).post('/api/test/invitations').send({ email: 'lea@x.fr' });
  expect(invite.status).toBe(404);
  expect(invite.body).toEqual({ error: 'not_found' });
  expect((await request(app).get('/api/test/mails/last').query({ to: 'lea@x.fr' })).status).toBe(404);
});

describe('POST /api/test/invitations', () => {
  test('→ 201 { link } : le lien de l\'e-mail, qui ouvre la page « Rejoindre »', async () => {
    const t = await e2eApp();
    const res = await request(t.app).post('/api/test/invitations').send({ email: 'Lea@X.fr' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ link: expect.stringMatching(/^http:\/\/localhost:4000\/rejoindre\?token=[\w-]+$/) });

    const check = await request(t.app).get(`/api/invitations/${tokenOf(res.body.link)}`);
    expect(check.body).toEqual({ email: 'lea@x.fr' });
  });

  test('rôle membre par défaut, admin sur demande', async () => {
    const t = await e2eApp();
    for (const [email, role] of [['lea@x.fr', undefined], ['max@x.fr', 'admin']] as const) {
      const { body } = await request(t.app).post('/api/test/invitations').send({ email, role });
      const accepted = await request(t.app).post('/api/invitations/accept').send({ token: tokenOf(body.link), name: 'Quelqu\'un', password: 'motdepasse1' });
      expect(accepted.status).toBe(201);
      expect((await findUserByEmail(t.db, email))?.role).toBe(role ?? 'member');
    }
  });

  test.each([{}, { email: 'pas-une-adresse' }, { email: 'lea@x.fr', role: 'chef' }])('corps invalide %j → 400', async (body) => {
    const t = await e2eApp();
    const res = await request(t.app).post('/api/test/invitations').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid' });
  });
});

describe('GET /api/test/mails/last', () => {
  test('→ { subject, link } du dernier e-mail envoyé à cette adresse', async () => {
    const t = await e2eApp();
    await t.inviteAndAccept('lea@x.fr');
    const reset = await request(t.app)
      .post('/api/auth/request-password-reset')
      .send({ email: 'lea@x.fr', redirectTo: `${t.env.APP_URL}/reinitialiser` });
    expect(reset.status).toBe(200);

    // L'e-mail de réinitialisation part en arrière-plan : on attend qu'il soit là.
    const mail = await vi.waitFor(
      async () => {
        const res = await request(t.app).get('/api/test/mails/last').query({ to: 'LEA@x.fr' });
        expect(res.status).toBe(200);
        return res.body as { subject: string; link: string };
      },
      { timeout: 4000 },
    );
    expect(mail).toEqual({ subject: resetPasswordSubject, link: expect.stringMatching(/^http:\/\/localhost:4000\/api\/auth\/reset-password\//) });
  });

  test('aucun e-mail pour cette adresse → 404', async () => {
    const t = await e2eApp();
    const res = await request(t.app).get('/api/test/mails/last').query({ to: 'personne@x.fr' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });
});

test('E2E=1 sans le mailer en mémoire → l\'application refuse de démarrer', async () => {
  const t = await e2eApp();
  const resend: Mailer = { sendInvitation: async () => {}, sendPasswordReset: async () => {} };
  expect(() => createApp({ ...t, mailer: resend })).toThrow(/MAILER=memory/);
});
