import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Chaque commande de src/cli/ (admin-invite, map-check…) devient dist/cli/<nom>.js. Ce dossier n'existe pas
// encore : un motif qui ne trouve rien ne doit pas faire échouer le build.
const cliDir = 'src/cli';
const cliEntries = Object.fromEntries(
  (existsSync(cliDir) ? readdirSync(cliDir) : [])
    .filter((file) => file.endsWith('.ts'))
    .map((file) => [`cli/${file.slice(0, -'.ts'.length)}`, `${cliDir}/${file}`]),
);

export default defineConfig({
  // dist/index.js démarre le serveur ; dist/migrate.js applique les migrations (lancé avant le serveur en production).
  entry: { index: 'src/index.ts', migrate: 'src/db/migrate.ts', ...cliEntries },
  format: 'esm',
  target: 'node22',
  clean: true,
  // Le paquet partagé est livré en TypeScript : il doit être compilé dans le bundle plutôt que chargé à l'exécution.
  noExternal: ['@bureau/shared'],
});
