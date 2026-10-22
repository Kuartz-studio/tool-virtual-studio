import { activityInputSchema } from '@bureau/shared';
import { Router } from 'express';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/require-session';
import type { ServerEvents } from '../server-events';
import type { ActivityService } from './activity-service';

// Les états d'activité de la personne connectée, sous /api/me/states : GET (la liste), POST (en créer un), PUT /:id (le remplacer) et
// DELETE /:id. Ils ne sont jamais ceux de quelqu'un d'autre : un identifiant étranger répond 404, comme un inconnu. Le corps passe par
// activityInputSchema (nom de 1 à 24 caractères, couleur #rrggbb, icône facultative parmi ACTIVITY_ICONS, trois interrupteurs) ; au plus 12 états
// par personne (409 `limit`). PUT remplace l'état en entier : sans `icon`, il n'a plus d'icône, et sans `place`, plus d'emplacement. Un `place` qui n'est pas une destination
// de la carte (la salle de sport, la salle de jeu) répond 400 `invalid`. Les modes tout prêts (`preset:`) ne sont pas dans la base : PUT et DELETE sur leur identifiant répondent 404.
// Un état modifié ou supprimé est dit au temps réel (activity:edited) : s'il est celui que la personne a pris, tout le bureau le voit changer.
export function activityRoutes({
  auth,
  activities,
  events,
  destinations,
}: {
  auth: Auth;
  activities: ActivityService;
  events: ServerEvents;
  /** Les clés des destinations de la carte (la salle de sport…) : un mode ne peut conduire qu'à l'une d'elles. */
  destinations: ReadonlySet<string>;
}): Router {
  const router = Router();
  const needSession = requireSession(auth);
  // Un emplacement, quand il y en a un, est une destination de la carte : la salle de sport, la salle de jeu. Le café, un bureau ou une clé qui n'existe pas sont refusés.
  const validPlace = (place: string | undefined): boolean => place === undefined || destinations.has(place);

  router.get('/me/states', needSession, async (_req, res) => {
    res.json(await activities.list(res.locals.user!.id));
  });

  router.post('/me/states', needSession, async (req, res) => {
    const parsed = activityInputSchema.safeParse(req.body);
    if (!parsed.success || !validPlace(parsed.data.place)) {
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
    if (!parsed.success || !validPlace(parsed.data.place)) {
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
