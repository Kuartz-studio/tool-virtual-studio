import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { emailSchema, invitationLink } from '../admin/invite-admin';
import type { InvitationService } from '../auth/invitations';
import type { Db } from '../db/client';
import { user } from '../db/schema';
import type { Env } from '../env';
import { isMemoryMailer, type Mailer } from '../mail/mailer';

const invitationSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'member']).default('member'),
});

const releaseResetSchema = z.object({ email: emailSchema });

// Réservées aux tests de bout en bout, montées sous /api/test seulement avec E2E=1 (loadEnv refuse E2E=1 en production, et
// l'exige avec MAILER=memory). Elles court-circuitent l'admin (inviter sans session) et la boîte mail (lire les e-mails que
// le mailer en mémoire a gardés).
export function testRoutes({ env, db, invitations, mailer }: { env: Env; db: Db; invitations: InvitationService; mailer: Mailer }): Router {
  if (!isMemoryMailer(mailer)) throw new Error('Les routes de test (E2E=1) lisent les e-mails envoyés : elles exigent MAILER=memory.');
  const router = Router();

  // → 201 { link } : le lien que l'e-mail d'invitation contiendrait. Aucun e-mail ne part.
  router.post('/invitations', async (req, res) => {
    const parsed = invitationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const { token } = await invitations.create({ ...parsed.data, invitedBy: null });
    res.status(201).json({ link: invitationLink(env, token) });
  });

  // ?to=<adresse> → { subject, link } du dernier e-mail envoyé à cette adresse (la casse ne compte pas), ou 404.
  router.get('/mails/last', (req, res) => {
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const mail = mailer.last(to);
    if (!mail) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ subject: mail.subject, link: mail.link });
  });

  // { email } → 204 : ce compte n'a plus vu aucune version (lastReleaseSeen à null), comme un compte d'avant la fenêtre « Quoi de neuf ? ». Les comptes
  // des tests sont créés à jour (auth.ts) : sans cette route, aucun ne la verrait. 404 pour une adresse sans compte.
  router.post('/release-seen/reset', async (req, res) => {
    const parsed = releaseResetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const reset = await db.update(user).set({ lastReleaseSeen: null }).where(eq(user.email, parsed.data.email)).returning({ id: user.id });
    if (reset.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
