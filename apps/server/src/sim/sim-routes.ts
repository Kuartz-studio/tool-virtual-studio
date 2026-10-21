import { SIM_AUDIO_MAX_BYTES, displayNameSchema, isSimAudioFile } from '@bureau/shared';
import express, { Router, type Response } from 'express';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/require-session';
import { SimError } from './bots';
import type { SimHost } from './sim-host';

const createSchema = z.object({ name: displayNameSchema.optional(), audio: z.string().nullable().optional() });
const patchSchema = z.object({ audio: z.string().nullable() });
const moveSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

// Ce que chaque erreur de commande répond : l'identifiant inconnu est un 404 ; le reste, une demande qu'on ne peut pas satisfaire.
const STATUS: Record<SimError['code'], number> = { unknown_bot: 404, unknown_audio: 400, unreachable: 400 };

// Les routes du faux live, montées sous /api/sim (seulement avec SIM=1), pour tout compte connecté :
// - GET    /api/sim                 → { bots, audio } : les personnes fictives et les fichiers audio disponibles ;
// - POST   /api/sim/bots            → { name?, audio? } : en fait apparaître une ;
// - PATCH  /api/sim/bots/:id        → { audio } : change son fichier audio (null : silence) ;
// - DELETE /api/sim/bots/:id        → la retire ;
// - POST   /api/sim/bots/:id/move   → { x, y } : la fait marcher vers ce point (pixels) ; répond { target }, où elle s'arrêtera ;
// - GET    /api/sim/audio/:file     → le fichier, que les navigateurs lisent en boucle ;
// - POST   /api/sim/audio?name=…    → le corps est le fichier : l'écrit dans le dossier.
export function simRoutes({ auth, sim }: { auth: Auth; sim: SimHost }): Router {
  const router = Router();
  router.use(requireSession(auth));

  // Le temps réel s'attache juste après le montage des routes : avant, il n'y a pas encore de monde où faire entrer quelqu'un.
  const bots = (res: Response) => {
    if (sim.bots) return sim.bots;
    res.status(503).json({ error: 'unavailable' });
    return null;
  };
  // Une SimError devient sa réponse ; toute autre erreur suit son chemin (le gestionnaire d'erreurs du serveur).
  const fail = (res: Response, err: unknown) => {
    if (!(err instanceof SimError)) throw err;
    res.status(STATUS[err.code]).json({ error: err.code });
  };

  router.get('/', async (_req, res) => {
    const list = bots(res);
    if (list) res.json({ bots: list.list(), audio: await sim.audio.list() });
  });

  router.post('/bots', async (req, res) => {
    const list = bots(res);
    if (!list) return;
    const body = createSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    try {
      res.status(201).json(await list.spawn(body.data));
    } catch (err) {
      fail(res, err);
    }
  });

  router.patch('/bots/:id', async (req, res) => {
    const list = bots(res);
    if (!list) return;
    const body = patchSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    try {
      res.json(await list.setAudio(req.params.id, body.data.audio));
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/bots/:id', (req, res) => {
    const list = bots(res);
    if (!list) return;
    try {
      list.remove(req.params.id);
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/bots/:id/move', (req, res) => {
    const list = bots(res);
    if (!list) return;
    const body = moveSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    try {
      res.json({ target: list.moveTo(req.params.id, body.data.x, body.data.y) });
    } catch (err) {
      fail(res, err);
    }
  });

  // Le fichier est lu par un <audio> : sendFile répond aux demandes de portion (Range) que les navigateurs font pour lire et boucler.
  router.get('/audio/:file', async (req, res) => {
    const file = req.params.file;
    if (!(await sim.audio.has(file))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.sendFile(file, { root: sim.audio.dir, headers: { 'Cache-Control': 'no-cache' } });
  });

  router.post('/audio', express.raw({ type: () => true, limit: SIM_AUDIO_MAX_BYTES }), async (req, res) => {
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    const body: unknown = req.body;
    if (!isSimAudioFile(name) || !Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: 'invalid' });
      return;
    }
    res.status(201).json(await sim.audio.save(name, body));
  });

  return router;
}
