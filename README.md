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

## Cartes

La carte du bureau est un fichier Tiled exporté en JSON (tilesets intégrés, calques en CSV) : `MAPS_DIR/<MAP_KEY>.json`. Tant que la carte définitive n'est pas dessinée, `MAP_KEY` vaut `dev-office` : 24 × 16 cases, trois pièces dont une salle de réunion (zone privée), un open space avec trois bureaux (zones de bureau), une étiquette et le point d'apparition. Cette carte n'est pas dessinée dans Tiled : son plan est du code, `DEV_OFFICE` (`packages/shared/src/map/dev-office.ts`), un dessin en ASCII et des zones, que `buildTiledMap` convertit en JSON Tiled.

```sh
pnpm --filter @bureau/client gen:dev-assets
```

écrit ce JSON (`apps/client/public/assets/maps/dev-office.json`), les 5 tuiles (`public/assets/dev/tiles.png`) et les 4 avatars de développement (`public/assets/dev/avatars/`). Le résultat est commité, et le script est déterministe : relancé sans rien changer, il ne modifie aucun fichier. Un test (`apps/client/scripts/gen-dev-assets.test.ts`) échoue quand les fichiers commités ne correspondent plus au plan ou au script : après une modification, relancer la commande et commiter le résultat.

Pour vérifier qu'une carte (la carte définitive, plus tard) est lisible par le serveur :

```sh
pnpm --filter @bureau/server map:check ../client/public/assets/maps/dev-office.json
```

Le chemin est relatif à `apps/server`. La commande affiche la taille de la carte, ses cases bloquantes, le nombre de zones par type et le point d'apparition. Sinon elle sort avec le code 1 et le code de l'erreur : calque `collisions` ou `zones` absent (`missing_layer`), tileset externe (`external_tileset`), calque compressé ou pas en CSV (`compressed_layer`), aucune zone `spawn` (`missing_spawn`), zone inutilisable, deux apparitions ou apparition sur une case bloquante (`bad_zone`). Compilée (`pnpm build`), elle se lance avec `node apps/server/dist/cli/map-check.js <fichier>`.

## Base de données

Le schéma est dans `apps/server/src/db/schema.ts`. Les tables de Better Auth (`src/db/auth-schema.ts`) sont générées par sa CLI à partir de `src/auth/auth.cli.ts` : ce fichier ne se modifie pas à la main. Après un changement de schéma, depuis `apps/server` :

```sh
npx auth@1.7.11 generate --config src/auth/auth.cli.ts --output src/db/auth-schema.ts --yes   # si la configuration de Better Auth a changé (même version que better-auth)
pnpm db:generate                                                                              # nouvelle migration dans drizzle/
```

Avec PGlite (`memory://`, `pglite://`), le serveur applique les migrations au démarrage. Avec PostgreSQL, `node dist/migrate.js` les applique avant le lancement du serveur, et échoue si le dossier `drizzle/` manque.

## Déployer

L'appli tourne sur Railway : un service construit depuis le `Dockerfile` de la racine (l'API, le temps réel et le client compilé dans un seul processus, comme avec `pnpm build`), et une base PostgreSQL. Railway construit l'image lui-même : Docker n'est nécessaire nulle part en local.

- **Image (`Dockerfile`).** Une première étape installe les dépendances (`pnpm install --frozen-lockfile`, avec le pnpm du champ `packageManager`), lance `pnpm build`, puis `pnpm deploy --legacy --prod` réunit les dépendances de production du serveur : tsup les laisse hors de `dist/`, le serveur les charge à l'exécution. Une seconde étape, sur `node:24-slim`, ne garde que `apps/server/dist`, `apps/server/drizzle`, `apps/client/dist` et ces `node_modules`, dans la même disposition que le dépôt. L'image fixe `NODE_ENV=production`, `CLIENT_DIST_DIR` et `MAPS_DIR`.
- **Démarrage (`railway.json`).** `node apps/server/dist/migrate.js` applique les migrations en attente (et échoue si `drizzle/` manque, ce qui arrête le démarrage), puis `node apps/server/dist/index.js` lance le serveur. Railway attend que `/api/health` réponde avant de mettre la nouvelle version en service. La commande est enveloppée dans `/bin/sh -c` : pour une image Docker, Railway exécute la commande de démarrage sans shell, et `&&` n'y serait qu'un argument de plus.
- **Derrière le proxy de Railway.** Express fait confiance à un seul saut de proxy (`trust proxy` vaut 1). Pour limiter les tentatives de connexion par adresse, Better Auth lit l'adresse du client dans `X-Real-IP` (`src/auth/auth.ts`), l'en-tête que Railway documente pour cela et que son proxy réécrit à chaque requête (d'après le support de Railway). `X-Forwarded-For` n'est pas lu : l'appelant peut y mettre l'adresse de son choix. Si un autre service (un CDN, Cloudflare) venait se placer devant Railway, vérifier que `X-Real-IP` porte toujours l'adresse du visiteur.

### Première mise en ligne

1. Pousser `main` sur un dépôt GitHub privé, que Railway est autorisé à lire.
2. Dans Railway, créer un service à partir de ce dépôt (il trouve le `Dockerfile` et `railway.json`), puis ajouter une base PostgreSQL au même projet.
3. Renseigner les variables du service :

   | Variable | Valeur |
   | --- | --- |
   | `APP_URL` | l'adresse publique de l'appli, `https://<domaine>`, sans barre finale : c'est l'origine des cookies et des liens des e-mails |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`, la référence à la base du projet (remplacer « Postgres » par le nom du service de la base) |
   | `BETTER_AUTH_SECRET` | une valeur propre à la production : `openssl rand -base64 32` |
   | `MAILER` | `resend`, le seul mode d'envoi accepté en production |
   | `RESEND_API_KEY`, `MAIL_FROM` | la clé d'API de Resend, et l'expéditeur (`Bureau virtuel <bureau@…>`) sur un domaine d'envoi vérifié dans Resend |
   | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | facultatives pour l'instant : sans elles, l'audio et la vidéo restent désactivés |

   `PORT` vient de Railway ; `NODE_ENV`, `CLIENT_DIST_DIR` et `MAPS_DIR` ont déjà leur valeur de production dans l'image (les définir sur Railway n'est utile que pour en changer). `E2E` ne doit pas être définie : le serveur la refuse en production. Une configuration invalide arrête le démarrage, et le journal du déploiement nomme les variables fautives.
4. Ajouter le domaine personnalisé (réseau public du service, puis l'enregistrement DNS que Railway indique ; le certificat HTTPS vient de Railway), et mettre `APP_URL` à jour avec ce domaine : Better Auth n'accepte que cette origine.
5. Vérifier : le journal de build se termine sans erreur, et `curl https://<domaine>/api/health` répond `{"ok":true}`.
6. Créer le premier admin, avec la CLI de Railway liée au projet : `railway run pnpm --filter @bureau/server admin:invite <adresse e-mail>` (voir « Premier admin »). Tant que son adresse est en `….railway.internal`, la base n'est joignable que depuis le réseau privé de Railway : si la commande ne l'atteint pas depuis le poste, la lancer dans le conteneur du service (`railway ssh -- node /app/apps/server/dist/cli/admin-invite.js <adresse e-mail>`), ou lui donner l'adresse publique de la base (`DATABASE_PUBLIC_URL`, variable du service PostgreSQL).

Ensuite, chaque `git push` sur `main` redéploie : l'image est reconstruite et les migrations passent avant le serveur. Une version dont le démarrage échoue (configuration invalide, migration en erreur) ne répond pas à `/api/health` et n'est pas mise en service.
