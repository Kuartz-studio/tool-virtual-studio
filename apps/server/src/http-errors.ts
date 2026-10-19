import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { logServerError } from './logger';

// Ce que personne n'a traité : 404 en JSON, comme le reste de l'API (jamais la page HTML d'Express).
export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found' });
};

// Le statut 4xx d'une erreur d'http-errors (`expose` vaut true pour un 4xx) : corps mal formé (400) ou trop gros (413) pour
// express.json(), fichier disparu (404) pour res.sendFile(). Toute autre erreur est imprévue.
function clientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  return expose === true && typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

// Le motif de la route qui a échoué (`/:token`), jamais le chemin reçu : un chemin peut porter un jeton (lien d'invitation,
// de réinitialisation), qui ouvre un compte et ne doit pas finir dans le journal. Express a déjà quitté le routeur qui l'a
// montée quand l'erreur arrive ici : seul le motif de la route reste, sans son préfixe (/api/invitations).
function routeOf(req: Request): string | undefined {
  const path: unknown = req.route?.path;
  return typeof path === 'string' ? path : undefined;
}

// Le dernier middleware : toute erreur devient une réponse JSON. Une erreur imprévue répond 500 { error: 'internal' }, sans
// détail pour le client, et part dans le journal (et sur la sortie d'erreur si le journal est muet, en test).
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    // La réponse est déjà partie (en partie) : on ne peut plus que couper la connexion, ce que fait Express.
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = clientErrorStatus(err);
    if (status !== undefined) {
      res.status(status).json({ error: status === 404 ? 'not_found' : 'invalid' });
      return;
    }
    logServerError(logger, { err, method: req.method, route: routeOf(req) }, 'Erreur pendant une requête');
    res.status(500).json({ error: 'internal' });
  };
}
