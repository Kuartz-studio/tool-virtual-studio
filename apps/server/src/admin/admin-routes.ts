import { asc, eq, isNull } from 'drizzle-orm';
import { Router, type Response } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { InvitationNotPendingError, type Invitation, type InvitationService } from '../auth/invitations';
import { requireAdmin } from '../auth/require-session';
import type { Db } from '../db/client';
import { user } from '../db/schema';
import type { Env } from '../env';
import type { Mailer } from '../mail/mailer';
import { oneAtATimePerKey } from '../one-at-a-time';
import type { ServerEvents } from '../server-events';
import { emailSchema, invitationLink } from './invite-admin';
import { removeMember } from './remove-member';

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'member']).default('member'),
});

// Une invitation en attente telle que l'admin la voit. Jamais le jeton ni son empreinte (le service ne les expose pas), et
// pas de dates d'acceptation ou de révocation : une invitation en attente n'en a pas. `expired` : le lien ne marche plus,
// mais l'invitation peut être relancée.
function listed(i: Invitation, now: number) {
  return { id: i.id, email: i.email, role: i.role, invitedBy: i.invitedBy, createdAt: i.createdAt, expiresAt: i.expiresAt, expired: i.expiresAt.getTime() <= now };
}

const notFound = (res: Response) => res.status(404).json({ error: 'not_found' });

// Montées sous /api/admin, après express.json(). Le garde d'accès est posé sur le routeur entier : une route ajoutée ici est
// réservée aux admins sans qu'on ait à y penser, et une adresse inconnue sous /api/admin répond 401 ou 403, jamais 404.
export function adminRoutes(d: {
  auth: Auth;
  db: Db;
  env: Env;
  invitations: InvitationService;
  mailer: Mailer;
  events: ServerEvents;
  logger: Logger;
}): Router {
  const { db, env, invitations, mailer, events, logger } = d;
  const router = Router();
  // Inviter une adresse, relancer ou annuler une invitation, retirer un membre : chaque action lit d'abord l'état (déjà
  // invitée ? dernier admin actif ?) puis écrit, et aucune contrainte de la base ne l'impose. Deux demandes simultanées (un
  // double clic, deux admins) passent donc l'une après l'autre, comme l'acceptation d'une invitation.
  const oneAtATime = oneAtATimePerKey();
  router.use(requireAdmin(d.auth));

  // Envoie l'e-mail d'invitation ; `false` s'il n'est pas parti. L'admin doit le savoir (la réponse est 502 : annoncer l'échec
  // à un admin ne livre rien) et l'invitation reste en attente, à relancer. Le journal ne reçoit ni le lien, dont le jeton
  // ouvre un compte, ni l'adresse.
  async function sendInvitationMail(invitation: Invitation, token: string, invitedBy: string): Promise<boolean> {
    try {
      await mailer.sendInvitation({ to: invitation.email, link: invitationLink(env, token), invitedBy });
      return true;
    } catch (err) {
      logger.error({ err, invitationId: invitation.id }, 'Envoi de l\'invitation impossible');
      return false;
    }
  }

  router.get('/members', async (_req, res) => {
    const members = await db
      .select({ id: user.id, name: user.name, email: user.email, role: user.role })
      .from(user)
      .where(isNull(user.disabledAt))
      .orderBy(asc(user.createdAt), asc(user.id));
    res.json(members);
  });

  router.get('/invitations', async (_req, res) => {
    const now = Date.now();
    res.json((await invitations.listPending()).map((invitation) => listed(invitation, now)));
  });

  router.post('/invitations', async (req, res) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const { email, role } = parsed.data;
    const admin = res.locals.user!;

    await oneAtATime(email, async () => {
      // Un compte existe déjà pour cette adresse, désactivé ou non : l'invitation ne pourrait jamais être acceptée.
      const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (account) {
        res.status(409).json({ error: 'already_member' });
        return;
      }
      // « En attente » comprend l'invitation expirée : l'admin la relance au lieu d'en créer une seconde pour la même adresse.
      if ((await invitations.listPending()).some((pending) => pending.email === email)) {
        res.status(409).json({ error: 'already_invited' });
        return;
      }

      const { invitation, token } = await invitations.create({ email, role, invitedBy: admin.id });
      if (!(await sendInvitationMail(invitation, token, admin.name))) {
        res.status(502).json({ error: 'mail_failed' });
        return;
      }
      res.status(201).json(listed(invitation, Date.now()));
    });
  });

  // Nouveau jeton et nouvel e-mail ; l'ancien lien cesse de marcher. C'est l'admin qui relance qui « invite » dans l'e-mail.
  router.post('/invitations/:id/resend', async (req, res) => {
    const { id } = req.params;
    await oneAtATime(`invitation:${id}`, async () => {
      const invitation = (await invitations.listPending()).find((pending) => pending.id === id);
      if (!invitation) {
        notFound(res);
        return;
      }
      let token: string;
      try {
        ({ token } = await invitations.renew(id));
      } catch (err) {
        // Acceptée ou annulée entre la lecture et le renouvellement.
        if (err instanceof InvitationNotPendingError) {
          notFound(res);
          return;
        }
        throw err;
      }
      if (!(await sendInvitationMail(invitation, token, res.locals.user!.name))) {
        res.status(502).json({ error: 'mail_failed' });
        return;
      }
      res.json({ ok: true });
    });
  });

  // Annuler une invitation qui n'est plus en attente (déjà acceptée, déjà annulée, inconnue) répond 404 : l'admin doit voir que
  // l'annulation n'a rien empêché, par exemple quand le compte vient d'être créé.
  router.delete('/invitations/:id', async (req, res) => {
    const { id } = req.params;
    await oneAtATime(`invitation:${id}`, async () => {
      if (!(await invitations.listPending()).some((pending) => pending.id === id)) {
        notFound(res);
        return;
      }
      await invitations.revoke(id);
      res.json({ ok: true });
    });
  });

  // Les retraits passent tous l'un après l'autre : sinon deux admins qui se retirent en même temps verraient chacun l'autre
  // encore actif, et plus aucun admin ne resterait.
  router.delete('/members/:id', async (req, res) => {
    const outcome = await oneAtATime('remove-member', () => removeMember({ db, events }, { actorId: res.locals.user!.id, targetId: req.params.id }));
    if (outcome === 'removed') res.json({ ok: true });
    else if (outcome === 'not_found') notFound(res);
    else res.status(400).json({ error: outcome });
  });

  return router;
}
