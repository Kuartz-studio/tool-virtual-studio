import { displayNameSchema, isAvatarKey, levelOf, timezoneSchema } from '@bureau/shared';
import { asc, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/require-session';
import type { Db } from '../db/client';
import { progress, user } from '../db/schema';
import type { ServerEvents } from '../server-events';

// Le nom suit displayNameSchema (espaces retirés, 1 à 40 caractères), l'avatar doit être une clé de la galerie, et le fuseau horaire un nom IANA
// que le serveur connaît (timezoneSchema). Les autres champs du corps sont ignorés : le client ne choisit ni son rôle, ni son adresse, ni son
// identifiant. Au moins un des trois.
const profileSchema = z
  .object({
    name: displayNameSchema.optional(),
    avatarKey: z.string().refine(isAvatarKey).optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine((profile) => profile.name !== undefined || profile.avatarKey !== undefined || profile.timezone !== undefined);

// Montées sous /api, après express.json() : GET /api/members et PATCH /api/me.
export function memberRoutes({ auth, db, events }: { auth: Auth; db: Db; events: ServerEvents }): Router {
  const router = Router();
  const needSession = requireSession(auth);

  // Les membres actifs, avec ce qu'un collègue a le droit de voir : ni adresse, ni rôle. Dans l'ordre d'arrivée. lastSeenAt : la
  // dernière présence au bureau (realtime/positions.ts), null pour qui n'y est jamais venu ; qui est en ligne, c'est le temps réel qui le dit.
  // level : son niveau (0 sans progression) ; timezone : son fuseau horaire, pour l'heure qu'il est chez lui, même hors ligne.
  router.get('/members', needSession, async (_req, res) => {
    const rows = await db
      .select({ id: user.id, name: user.name, avatarKey: user.avatarKey, lastSeenAt: user.lastSeenAt, timezone: user.timezone, xp: progress.xp })
      .from(user)
      .leftJoin(progress, eq(progress.userId, user.id))
      .where(isNull(user.disabledAt))
      .orderBy(asc(user.createdAt), asc(user.id));
    res.json(rows.map(({ xp, ...member }) => ({ ...member, level: levelOf(xp ?? 0) })));
  });

  // PATCH /api/me est le seul chemin pour changer son profil : les routes équivalentes de Better Auth sont fermées (auth.ts),
  // car elles n'appliquent ni displayNameSchema, ni la liste des avatars, ni la vérification du fuseau.
  router.patch('/me', needSession, async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const [profile] = await db
      .update(user)
      .set(parsed.data)
      .where(eq(user.id, res.locals.user!.id))
      .returning({ id: user.id, name: user.name, avatarKey: user.avatarKey, timezone: user.timezone });
    // Le profil complet, pas seulement ce qui a changé : le temps réel remplace le nom, l'avatar et le fuseau ensemble.
    events.emit('profile:changed', profile!);
    res.json(profile);
  });

  return router;
}
