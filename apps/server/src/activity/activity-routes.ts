import { activityInputSchema } from '@bureau/shared';
import { Router } from 'express';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/require-session';
import type { ServerEvents } from '../server-events';
import type { ActivityService } from './activity-service';

// Les états d'activité de la personne connectée, sous /api/me/states : GET (la liste), POST (en créer un), PUT /:id (le remplacer) et
// DELETE /:id. Ils ne sont jamais ceux de quelqu'un d'autre : un identifiant étranger répond 404, comme un inconnu. Le corps passe par
// activityInputSchema (nom de 1 à 24 caractères, couleur #rrggbb, trois interrupteurs) ; au plus 12 états par personne (409 `limit`).
// Un état modifié ou supprimé est dit au temps réel (activity:edited) : s'il est celui que la personne a pris, tout le bureau le voit changer.
export function activityRoutes({ auth, activities, events }: { auth: Auth; activities: ActivityService; events: ServerEvents }): Router {
  const router = Router();
  const needSession = requireSession(auth);

  router.get('/me/states', needSession, async (_req, res) => {
    res.json(await activities.list(res.locals.user!.id));
  });

  router.post('/me/states', needSession, async (req, res) => {
    const parsed = activityInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const created = await activities.create(res.locals.user!.id, parsed.data);
    if (!created.ok) {
      res.status(409).json({ error: created.error });
      return;
    }
    res.status(201).json(created.state);
  });

  router.put('/me/states/:id', needSession, async (req, res) => {
    const parsed = activityInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const userId = res.locals.user!.id;
    const state = await activities.update(userId, String(req.params.id), parsed.data);
    if (!state) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    events.emit('activity:edited', { userId, id: state.id, state });
    res.json(state);
  });

  router.delete('/me/states/:id', needSession, async (req, res) => {
    const userId = res.locals.user!.id;
    const id = String(req.params.id);
    if (!(await activities.remove(userId, id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    events.emit('activity:edited', { userId, id, state: null });
    res.status(204).end();
  });

  return router;
}
