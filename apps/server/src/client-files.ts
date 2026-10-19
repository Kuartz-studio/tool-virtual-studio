import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import express, { Router } from 'express';

// Les adresses du serveur : jamais une page du client.
const SERVER_PATH = /^\/(api|socket\.io)(\/|$)/;

// Le client compilé (`vite build`) : ses fichiers tels quels, et index.html pour toute autre page (le routeur du client prend
// le relais : /connexion, /rejoindre?token=…). Monté après l'API.
//
// Une adresse avec une extension (/assets/x.js, /favicon.ico) désigne un fichier : absente, elle répond 404 au lieu
// d'index.html, que le navigateur lirait sinon comme du JavaScript ou du JSON.
//
// `distDir` est relatif au dossier de lancement. Sans index.html (client pas compilé, mauvais chemin), le démarrage échoue tout
// de suite, au lieu que chaque page réponde une erreur.
export function clientFiles(distDir: string): Router {
  const root = resolve(distDir);
  const indexHtml = join(root, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`CLIENT_DIST_DIR : ${indexHtml} introuvable. Compiler le client (pnpm build) ou corriger le chemin.`);
  }

  const router = Router();
  // `redirect: false` : un dossier (/assets) n'est pas redirigé vers /assets/, il est traité comme une page.
  router.use(express.static(root, { index: false, redirect: false }));
  router.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || SERVER_PATH.test(req.path) || extname(req.path) !== '') {
      next();
      return;
    }
    // Revalidée à chaque visite : après un déploiement, la page pointe vers les nouveaux fichiers.
    res.set('Cache-Control', 'no-cache');
    // Chemin relatif à `root`, comme express.static : send n'applique sa règle des fichiers cachés (dotfiles: 'ignore') qu'au
    // chemin sous `root`. Avec le chemin absolu, un dossier parent caché (.worktrees/…) ferait répondre 404 à chaque page.
    res.sendFile('index.html', { root });
  });
  return router;
}
