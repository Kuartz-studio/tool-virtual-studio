import { shopBuySchema, todoInputSchema, todoPatchSchema } from '@bureau/shared';
import { Router } from 'express';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/require-session';
import type { ServerEvents } from '../server-events';
import type { ProgressService } from './progress-service';

// La progression de la personne connectée, ses tâches et la boutique, montées sous /api :
// - GET /me/progress : son XP, ses kuartzons, sa série de pointage, ce qu'elle possède ;
// - GET /me/tasks : sa liste (les tâches ouvertes, puis celles fermées depuis une semaine) ; POST /me/tasks : une tâche à soi (409 `limit` : liste pleine) ;
//   PATCH et DELETE /me/tasks/:id : la modifier, la supprimer (une tâche à soi seulement) ; POST /me/tasks/:id/done : la cocher ; POST /me/tasks/:id/decline :
//   rendre une mission ; POST /me/tasks/seen : ses missions nouvelles sont vues ;
// - GET /me/missions : les missions qu'elle a confiées ; POST /me/missions/:id/cancel : en retirer une qui n'est pas faite ;
// - GET /people/:id/stats : les caractéristiques de quelqu'un (ses kuartzons et son journal, seulement pour soi) ;
// - POST /shop/buy : acheter un élément de la boutique (404 `unknown_item`, 409 `owned` ou `too_poor`).
// On ne touche jamais aux tâches d'un autre : un identifiant étranger répond 404, comme un inconnu. On confie une mission auprès d'une administratrice, par le temps
// réel (`mission:give`), pas ici : il faut être à l'accueil. Ce qui change l'XP, les kuartzons ou une mission confiée est dit au temps réel (progress:changed,
// task:changed), qui l'annonce à qui de droit.
export function progressRoutes({ auth, progress, events }: { auth: Auth; progress: ProgressService; events: ServerEvents }): Router {
  const router = Router();
  const needSession = requireSession(auth);

  router.get('/me/progress', needSession, async (_req, res) => {
    res.json(await progress.mine(res.locals.user!.id));
  });

  router.get('/me/tasks', needSession, async (_req, res) => {
    res.json(await progress.tasksOf(res.locals.user!.id));
  });

  router.post('/me/tasks', needSession, async (req, res) => {
    const parsed = todoInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const created = await progress.createTodo(res.locals.user!.id, parsed.data);
    if (!created.ok) {
      res.status(409).json({ error: created.error });
      return;
    }
    res.status(201).json(created.task);
  });

  // Avant /me/tasks/:id : « seen » n'est pas l'identifiant d'une tâche.
  router.post('/me/tasks/seen', needSession, async (_req, res) => {
    await progress.markSeen(res.locals.user!.id);
    res.status(204).end();
  });

  router.patch('/me/tasks/:id', needSession, async (req, res) => {
    const parsed = todoPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const updated = await progress.updateTodo(res.locals.user!.id, String(req.params.id), parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(updated);
  });

  router.delete('/me/tasks/:id', needSession, async (req, res) => {
    if (!(await progress.deleteTodo(res.locals.user!.id, String(req.params.id)))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  });

  router.post('/me/tasks/:id/done', needSession, async (req, res) => {
    const userId = res.locals.user!.id;
    const done = await progress.complete(userId, String(req.params.id));
    if (!done) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    events.emit('progress:changed', { userId, progress: done.progress });
    // Celle qui l'a confiée apprend qu'elle est faite.
    if (done.task.giver) events.emit('task:changed', { task: done.task, notify: [done.task.giver.id] });
    res.json(done);
  });

  router.post('/me/tasks/:id/decline', needSession, async (req, res) => {
    const declined = await progress.decline(res.locals.user!.id, String(req.params.id));
    if (!declined) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (declined.giver) events.emit('task:changed', { task: declined, notify: [declined.giver.id] });
    res.json(declined);
  });

  router.get('/me/missions', needSession, async (_req, res) => {
    res.json(await progress.givenBy(res.locals.user!.id));
  });

  router.post('/me/missions/:id/cancel', needSession, async (req, res) => {
    const cancelled = await progress.cancel(res.locals.user!.id, String(req.params.id));
    if (!cancelled) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // Celle qui l'avait reçue la voit sortir de sa liste.
    events.emit('task:changed', { task: cancelled, notify: [cancelled.owner.id] });
    res.json(cancelled);
  });

  router.get('/people/:id/stats', needSession, async (req, res) => {
    const stats = await progress.stats(String(req.params.id), res.locals.user!.id);
    if (!stats) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(stats);
  });

  router.post('/shop/buy', needSession, async (req, res) => {
    const parsed = shopBuySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    const userId = res.locals.user!.id;
    const bought = await progress.buy(userId, parsed.data.itemId);
    if (!bought.ok) {
      res.status(bought.error === 'unknown_item' ? 404 : 409).json({ error: bought.error });
      return;
    }
    events.emit('progress:changed', { userId, progress: bought.progress });
    res.json(bought.progress);
  });

  return router;
}
