# Bureau virtuel

Un bureau virtuel en vue de dessus, dans l'esprit de Gather : chaque personne a un avatar qui se promène dans les locaux, voit les autres bouger, et parle en audio et en vidéo avec celles qui sont à proximité. Statuts, chat et salles privées complètent l'ensemble. L'inscription se fait uniquement sur invitation, et l'interface est en français.

C'est un monorepo pnpm. Le paquet `@bureau/shared` (`packages/shared`) regroupe les constantes et le protocole utilisés par le client et le serveur. Le serveur (`apps/server`) réunit Express, Better Auth et l'API ; le client (`apps/client`) est une appli React et Phaser compilée par Vite. La conception est décrite dans `docs/conception.md`.

## Commandes

Prérequis : Node 22.12 ou plus récent, et pnpm 10.

```sh
pnpm install     # installer les dépendances
pnpm dev         # lancer le serveur et le client en développement
pnpm test        # lancer les tests (Vitest)
pnpm typecheck   # vérifier les types (TypeScript)
pnpm build       # compiler le client puis le serveur
pnpm e2e         # lancer les tests de bout en bout (Playwright)
```

Les tests du serveur tournent sur 2 processus Vitest au plus (`apps/server/vitest.config.ts`) : chaque base PGlite en mémoire occupe environ 1 Go de RAM, et sans cette limite une machine à beaucoup de cœurs sature la mémoire.

## Développement

Copier `.env.example` en `.env` à la racine, puis lancer `pnpm dev`. Deux serveurs démarrent :

- le serveur de l'appli sur le port 4000 (API, Better Auth) ;
- Vite sur le port 5173, qui sert le client et relaie `/api` et `/socket.io` vers le port 4000.

On ouvre l'appli sur http://localhost:5173. Le navigateur ne voit que Vite : `APP_URL` doit donc valoir `http://localhost:5173`, et non l'adresse du serveur, car c'est l'origine des cookies de session et des liens des e-mails (`.env.example` le fait déjà). Le port 5173 est fixe : s'il est occupé, Vite s'arrête au lieu d'en prendre un autre.

## Appli compilée

`pnpm build` compile le client dans `apps/client/dist` et le serveur dans `apps/server/dist`. Le serveur compilé sert alors le client lui-même, sur une seule origine, quand `CLIENT_DIST_DIR` lui indique le dossier du client (chemin relatif au dossier de lancement) :

```sh
CLIENT_DIST_DIR=apps/client/dist APP_URL=http://localhost:4000 DATABASE_URL=… BETTER_AUTH_SECRET=… node apps/server/dist/index.js
```

Toute adresse hors de `/api` et de `/socket.io` reçoit `index.html` (le routeur du client prend le relais), sauf un fichier absent, qui répond 404. Sans `index.html` dans ce dossier, le serveur refuse de démarrer.

## Tests de bout en bout

Une fois, installer le navigateur de Playwright :

```sh
pnpm exec playwright install chromium
```

`pnpm e2e` (ou `pnpm e2e e2e/auth.spec.ts` pour un seul fichier) compile l'appli avec `VITE_E2E=1`, lance le serveur compilé sur le port 3100 avec une base en mémoire et `E2E=1` (`e2e/playwright.config.ts`), puis joue les tests dans Chromium. `E2E=1` ouvre des routes réservées aux tests, sous `/api/test` : créer une invitation sans admin, lire le dernier e-mail envoyé à une adresse. Le serveur la refuse en production, et sans `MAILER=memory`.

## Premier admin

L'inscription se fait sur invitation, et les invitations se créent depuis le panneau d'administration : le premier admin naît donc d'une commande, qui crée une invitation admin et en affiche le lien.

```sh
pnpm --filter @bureau/server admin:invite <adresse e-mail>
```

Elle lit la même configuration que le serveur : les variables d'environnement, et le `.env` de la racine quand elle est lancée par `pnpm`. Avec `MAILER=resend`, l'e-mail part ; avec `MAILER=memory`, rien ne part, et le lien affiché est la seule porte d'entrée. Avec une base `pglite://`, arrêter d'abord `pnpm dev` : deux processus sur le même dossier perdent des écritures. Compilée (`pnpm build`), elle se lance avec `node apps/server/dist/cli/admin-invite.js <adresse e-mail>`, sans lire de `.env`.

## Base de données

Le schéma est dans `apps/server/src/db/schema.ts`. Les tables de Better Auth (`src/db/auth-schema.ts`) sont générées par sa CLI à partir de `src/auth/auth.cli.ts` : ce fichier ne se modifie pas à la main. Après un changement de schéma, depuis `apps/server` :

```sh
npx auth@1.7.11 generate --config src/auth/auth.cli.ts --output src/db/auth-schema.ts --yes   # si la configuration de Better Auth a changé (même version que better-auth)
pnpm db:generate                                                                              # nouvelle migration dans drizzle/
```

Avec PGlite (`memory://`, `pglite://`), le serveur applique les migrations au démarrage. Avec PostgreSQL, `node dist/migrate.js` les applique avant le lancement du serveur, et échoue si le dossier `drizzle/` manque.
