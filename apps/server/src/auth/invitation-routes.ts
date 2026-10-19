import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, displayNameSchema } from '@bureau/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Auth } from './auth';
import { invitationContext } from './invitation-context';
import type { InvitationService } from './invitations';

const acceptSchema = z.object({
  token: z.string().min(1),
  name: displayNameSchema,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

// Exécute l'une après l'autre les tâches d'une même clé ; celles de clés différentes restent simultanées.
function oneAtATimePerKey() {
  const queues = new Map<string, Promise<void>>();
  return async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const result = (queues.get(key) ?? Promise.resolve()).then(task);
    const queue = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, queue);
    try {
      return await result;
    } finally {
      if (queues.get(key) === queue) queues.delete(key);
    }
  };
}

// Montées sous /api/invitations, après express.json().
export function invitationRoutes({ auth, invitations }: { auth: Auth; invitations: InvitationService }): Router {
  const router = Router();
  // Deux acceptations du même jeton (un double clic) passent l'une après l'autre : la seconde trouve l'invitation déjà
  // utilisée au lieu de tenter une seconde inscription. Il n'y a qu'une instance du serveur ; en dernier recours,
  // l'unicité de l'adresse dans la table user empêche de toute façon un second compte.
  const oneAtATime = oneAtATimePerKey();

  // La page « Rejoindre » affiche l'adresse invitée, sans permettre de la changer.
  router.get('/:token', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const result = await invitations.check(req.params.token);
    if (result.status === 'valid') res.json({ email: result.invitation.email });
    else if (result.status === 'unknown') res.status(404).json({ error: 'unknown' });
    else res.status(410).json({ error: result.status });
  });

  // Crée le compte de l'invitation et ouvre sa session. L'adresse et le rôle viennent de l'invitation, jamais du client.
  router.post('/accept', async (req, res) => {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const { token, name, password } = parsed.data;

    await oneAtATime(token, async () => {
      const result = await invitations.check(token);
      if (result.status === 'unknown') {
        res.status(404).json({ error: 'unknown' });
        return;
      }
      if (result.status !== 'valid') {
        res.status(410).json({ error: result.status });
        return;
      }
      const { id, email, role } = result.invitation;

      // Le crochet user.create.before de auth.ts n'accepte la création que dans ce contexte, pour cette adresse.
      const response = await invitationContext.run({ email, role }, () =>
        auth.api.signUpEmail({ body: { email, password, name }, asResponse: true }),
      );
      if (!response.ok) {
        const { code } = ((await response.json().catch(() => null)) ?? {}) as { code?: string };
        if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
          res.status(409).json({ error: 'already_member' });
          return;
        }
        if (response.status === 400) {
          res.status(400).json({ error: 'invalid' });
          return;
        }
        throw new Error(`Better Auth a refusé l'inscription liée à l'invitation ${id} (${response.status}${code ? ` ${code}` : ''}).`);
      }

      await invitations.markAccepted(id);
      res.append('Set-Cookie', response.headers.getSetCookie());
      res.status(201).json({ ok: true });
    });
  });

  return router;
}
