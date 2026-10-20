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

On ouvre l'appli sur http://localhost:5173. Le navigateur ne voit que Vite : `APP_URL` doit donc valoir `http://localhost:5173`, et non l'adresse du serveur, car c'est l'origine des cookies de session et des liens des e-mails, et la seule page d'où le temps réel accepte une connexion (`.env.example` le fait déjà). Le port 5173 est fixe : s'il est occupé, Vite s'arrête au lieu d'en prendre un autre.

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

`pnpm e2e` (ou `pnpm e2e e2e/auth.spec.ts` pour un seul fichier) compile l'appli avec `VITE_E2E=1`, lance le serveur compilé sur le port 3100 avec une base en mémoire et `E2E=1` (`e2e/playwright.config.ts`), puis joue les tests dans Chromium, avec ses faux micro et caméra (une mire qui bouge, un bip), accordés sans question : l'écran d'entrée du bureau les montre (les tests passent par « Entrer », `enterOffice` dans `e2e/helpers.ts`). `E2E=1` ouvre des routes réservées aux tests, sous `/api/test` : créer une invitation sans admin, lire le dernier e-mail envoyé à une adresse. Elle active aussi l'événement temps réel `debug:teleport`, qui pose l'avatar de la socket à une case praticable. Le serveur la refuse en production, et sans `MAILER=memory`.

Le bureau est dessiné dans un canevas, que Playwright ne sait pas interroger : avec `VITE_E2E=1`, le client expose l'état du jeu dans `window.__office` (`apps/client/src/game/debug.ts` : `ready` quand la carte est construite, `self` pour l'avatar local, ses pieds en pixels de la carte, `players` pour les autres joueurs tels qu'on les dessine, `media.room` pour la room audio/vidéo où l'on est, `media.tiles` pour le nombre de vignettes, `teleport(x, y)`, qui passe par `debug:teleport`, `avatarsOf(id)` pour compter les avatars dessinés d'un joueur, et `showOthers(false)`, qui cache les autres joueurs…), que les tests lisent. Un build normal n'expose rien.

Les tests audio/vidéo (`e2e/media.spec.ts`) ont besoin d'un serveur LiveKit, que le serveur des tests reçoit en `LIVEKIT_*` ; sans `E2E_LIVEKIT_URL`, ils sont ignorés. À lancer seuls, l'un après l'autre (ils placent des gens dans la carte) :

```sh
livekit-server --dev   # dans un autre terminal (brew install livekit) : ws://localhost:7880, clé devkey, secret secret
E2E_LIVEKIT_URL=ws://localhost:7880 E2E_LIVEKIT_API_KEY=devkey E2E_LIVEKIT_API_SECRET=secret pnpm e2e e2e/media.spec.ts
```

Tous les tests partagent le serveur et son bureau : les joueurs d'un test apparaissent chez tous les autres, au même point d'apparition. Un test ne regarde donc les autres que par leur identifiant, et ceux qui regardent l'avatar local à l'écran (`e2e/world.spec.ts`) cachent les autres joueurs.

Le reste de l'interface (barre du bas, panneaux, vignettes) est du HTML posé sur la carte, dans `.office-ui` : les tests l'interrogent par ses rôles et ses noms (`getByRole('group', { name: 'Barre du bureau' })`, `getByRole('complementary', { name: 'Personnes' })`), et ceux qui lisent des pixels la cachent (`HIDE_OVERLAY`, `e2e/world.spec.ts`). Dans le panneau Personnes, le point de chaque personne porte `data-user` (son identifiant) et, si elle est en ligne, `data-status` (`available`, `busy`, `away` ou `dnd`). Chaque vignette porte `data-participant` (l'identifiant de la personne), `data-source` (`camera` ou `screen`), et `data-local` pour la sienne.

## Premier admin

L'inscription se fait sur invitation, et les invitations se créent depuis le panneau d'administration : le premier admin naît donc d'une commande, qui crée une invitation admin et en affiche le lien.

```sh
pnpm --filter @bureau/server admin:invite <adresse e-mail>
```

Elle lit la même configuration que le serveur : les variables d'environnement, et le `.env` de la racine quand elle est lancée par `pnpm`. Avec `MAILER=resend`, l'e-mail part ; avec `MAILER=memory`, rien ne part, et le lien affiché est la seule porte d'entrée. Avec une base `pglite://`, arrêter d'abord `pnpm dev` : deux processus sur le même dossier perdent des écritures. Compilée (`pnpm build`), elle se lance avec `node apps/server/dist/cli/admin-invite.js <adresse e-mail>`, sans lire de `.env`.

## Panneau admin

Le bouton « Admin » de la barre du bas, que les admins seuls ont, ouvre le panneau d'`apps/client/src/office/AdminPanel.tsx`, à droite, entre Personnes et Chat. Le rôle vient de la session (`useCurrentSession` : seul « admin » donne les droits, tout autre rôle, ou son absence, vaut membre, comme côté serveur). Le panneau ne parle qu'aux routes `/api/admin/*`, que le serveur refuse aux membres (401 sans session, 403 pour un membre) : un membre n'a ni le bouton, ni le panneau, et aucune requête n'en part. Les adresses e-mail des membres ne sont montrées nulle part ailleurs.

- **Inviter.** Une adresse et un rôle (« Membre » par défaut) : `POST /api/admin/invitations`. Accepté, le champ se vide et le rôle revient à « Membre ». Refusé (adresse déjà invitée, déjà un compte actif ou retiré, mal formée…), le message de `fr.admin.errors` s'affiche et l'adresse reste dans le champ. Quand l'e-mail n'est pas parti (`mail_failed`), l'invitation existe quand même : elle est dans la liste, avec « Renvoyer ».
- **Invitations en attente** (`GET /api/admin/invitations`, expirées comprises, marquées « expirée »). « Renvoyer » (`POST …/:id/resend` : nouveau lien et nouvel e-mail, l'ancien lien ne marche plus) et « Annuler » (`DELETE …/:id`). Une invitation que le serveur ne trouve plus (acceptée, ou annulée par un autre admin) fait relire les deux listes : une invitation acceptée est un nouveau membre.
- **Membres** (`GET /api/admin/members`). « Retirer » (`DELETE …/:id`) demande d'abord confirmation, dans une boîte de dialogue modale (`alertdialog`) qui nomme la personne : le focus y est sur « Annuler », Tab ne sort pas de la boîte, Échap et « Annuler » renoncent (un clic sur le fond ne fait rien : un double clic sur « Retirer » fermerait la boîte à peine ouverte), et les touches de l'avatar n'y marchent pas. Le compte est désactivé, la personne est déconnectée tout de suite (sa page revient à la connexion) et son adresse ne peut plus être invitée. Soi-même n'a pas de bouton « Retirer » (le serveur refuse aussi : `self`).
- **Listes.** Lues à l'ouverture, puis relues après chaque geste, réussi ou non (un refus ne dit pas toujours que rien n'a changé : l'e-mail n'est pas parti mais l'invitation existe, la réponse s'est perdue), et quand quelqu'un que la liste ne connaît pas arrive au bureau (une invitation vient d'être acceptée), comme le panneau Personnes. Une relecture qui échoue laisse la liste déjà là.
- **Tests.** `AdminPanel.test.tsx` (le panneau, avec un faux serveur), `OfficeShell.test.tsx` (le bouton et la place du panneau), et `e2e/admin.spec.ts` : l'admin des tests de bout en bout est un compte créé par la route de test, avec l'invitation d'un admin (`joinOffice(page, nom, 'admin')`, `e2e/helpers.ts`).

## Cartes

La carte du bureau est un fichier Tiled exporté en JSON (tilesets intégrés, calques en CSV) : `MAPS_DIR/<MAP_KEY>.json`. Le serveur la lit au démarrage : absente ou illisible, il refuse de démarrer, avec son chemin dans le message. Tant que la carte définitive n'est pas dessinée, `MAP_KEY` vaut `dev-office` : 24 × 16 cases, trois pièces dont une salle de réunion (zone privée), un open space avec trois bureaux (zones de bureau), une étiquette et le point d'apparition. Cette carte n'est pas dessinée dans Tiled : son plan est du code, `DEV_OFFICE` (`packages/shared/src/map/dev-office.ts`), un dessin en ASCII et des zones, que `buildTiledMap` convertit en JSON Tiled.

```sh
pnpm --filter @bureau/client gen:dev-assets
```

écrit ce JSON (`apps/client/public/assets/maps/dev-office.json`), les 5 tuiles (`public/assets/dev/tiles.png`) et les 4 avatars de développement (`public/assets/dev/avatars/`). Le résultat est commité, et le script est déterministe : relancé sans rien changer, il ne modifie aucun fichier. Un test (`apps/client/scripts/gen-dev-assets.test.ts`) échoue quand les fichiers commités ne correspondent plus au plan ou au script : après une modification, relancer la commande et commiter le résultat.

Pour vérifier qu'une carte (la carte définitive, plus tard) est lisible par le serveur :

```sh
pnpm --filter @bureau/server map:check ../client/public/assets/maps/dev-office.json
```

Le chemin est relatif à `apps/server`. La commande affiche la taille de la carte, ses cases bloquantes, le nombre de zones par type et le point d'apparition. Sinon elle sort avec le code 1 et le code de l'erreur : calque `collisions` ou `zones` absent (`missing_layer`), tileset externe (`external_tileset`), calque compressé ou pas en CSV (`compressed_layer`), aucune zone `spawn` (`missing_spawn`), zone inutilisable, deux apparitions ou apparition sur une case bloquante (`bad_zone`). Compilée (`pnpm build`), elle se lance avec `node apps/server/dist/cli/map-check.js <fichier>`.

## Audio et vidéo

L'audio et la vidéo passent par LiveKit Cloud, avec une room par groupe de conversation. Le serveur recalcule les groupes 4 fois par seconde (`computeGroups`, `packages/shared`) et dit à chaque personne dont le groupe change de quitter sa room (`media:leave`), puis d'entrer dans celle de son nouveau groupe (`media:join`, avec l'adresse du projet, le nom de la room et un jeton). Quand des groupes fusionnent ou se séparent, la partie qui garde l'id du groupe garde sa room : seuls les autres en changent. Après chaque `init` (arrivée, retour après une coupure, nouvel onglet), le client reçoit aussi `media:join` s'il est dans un groupe, sinon `media:leave` : un client resté dans une room pendant une coupure, ou dans une room d'avant un redémarrage, en sort ainsi.

- **Rooms.** Une room s'appelle `<démarrage>-<groupe>`, par exemple `k3x9qa-g4` : 6 caractères aléatoires tirés à chaque démarrage du serveur, puis l'id du groupe. Les ids des groupes repartent de `g1` à chaque démarrage ; le préfixe évite qu'un groupe formé après un redémarrage retrouve la room d'un groupe d'avant.
- **Jetons.** Un jeton ne vaut que pour une room (rejoindre, publier, recevoir), pendant 10 minutes, au nom de la personne (identité : l'id de son compte ; nom : son nom affiché). Le serveur ne journalise jamais de jeton.
- **Sortie d'un groupe.** En plus de `media:leave`, le serveur retire la personne de la room par l'API de LiveKit (`RemoveParticipant`, sur l'adresse HTTP qui correspond à `LIVEKIT_URL`) : un client qui ignorerait `media:leave` n'entend plus la conversation. Une personne déjà sortie (« introuvable ») est ignorée ; un autre échec est journalisé.
- **Sans LiveKit.** Sans l'une des trois variables `LIVEKIT_*`, les groupes sont calculés quand même (zones occupées, chat « À proximité »), mais aucun événement `media:*` ne part ; un avertissement le dit au démarrage. Une `LIVEKIT_URL` qui n'est pas une adresse `wss://`, `ws://`, `https://` ou `http://` arrête le démarrage.
- **Client** (`apps/client/src/media/`). `useMedia(client, socket)` suit les consignes : `media:join` fait entrer dans la room (déjà dedans, rien : une socket revenue après une coupure ne coupe pas la conversation ; dans une autre, il la quitte d'abord), `media:leave` la fait quitter. Le client (`createMediaClient` : une `Room` LiveKit par room, avec `adaptiveStream` et `dynacast`, l'audio des autres dans des éléments `<audio>` cachés) ne demande rien aux périphériques avant le premier `media:join`, puis allume le micro et la caméra selon les préférences gardées dans le navigateur (`localStorage`, clé `bureau.media.v1` : périphériques choisis, micro et caméra allumés en entrant). `livekit-client` n'est téléchargé qu'à ce premier `media:join` (un fichier à part du build). Micro ou caméra refusés ou absents : il entre quand même, en réception seule (`permission_denied`), et l'accès n'est redemandé que si la personne les rallume. L'état local part au serveur (`media:state`) après chaque `init` et à chaque changement ; qui parle part au jeu par le bus (`media:speaking`), qui entoure le point de son étiquette. La logique est dans `MediaSession`, que les tests éprouvent sur un faux LiveKit (`FakeMediaClient`).
- **Interface** (`apps/client/src/office/`). La page du bureau s'ouvre sur l'écran d'entrée (`DeviceCheck`) : l'aperçu de la caméra, le niveau du micro, le choix des périphériques, micro et caméra allumés ou non en entrant. La connexion au bureau est déjà ouverte derrière lui : la dernière consigne `media:*` reçue est retenue, et suivie après « Entrer ». Ce clic est aussi le geste qui permet au navigateur de jouer le son des autres (`startAudio`) ; s'il le bloque quand même (Safari, sans micro), « Activer le son » apparaît. Micro et caméra refusés : « Entrer quand même », en réception seule. Dans le bureau, les vignettes de la conversation sont en haut (`VideoStrip` : la sienne d'abord, un clic en agrandit une, un partage d'écran s'affiche en grand), et la barre du bas (`ControlBar`) a le micro, la caméra et le partage d'écran. Une connexion audio/vidéo en échec affiche « Reconnecter », qui rouvre la connexion au bureau : le serveur redit alors la consigne, avec un jeton neuf.

## Chat

Deux canaux, un seul message du client, `chat:send` (`{ channel: 'all' | 'nearby', text }`, avec accusé de réception), et un seul du serveur, `chat:message`. Le service est dans `apps/server/src/chat/chat-service.ts`, la gestion de `chat:send` dans `apps/server/src/realtime/handlers.ts`.

- **Tout le monde (`all`).** Enregistré en base (`chat_message` : l'auteur, le texte et l'heure ; pas le nom, lu dans le compte à chaque lecture, si bien que l'historique donne le nom du moment), puis envoyé à tout le bureau, l'émetteur compris. Les 200 derniers messages, du plus ancien au plus récent, sont dans le `init` de chaque arrivée, retour après une coupure ou nouvel onglet (`chatHistory`). Un historique illisible est journalisé, et l'`init` part avec un historique vide : arriver au bureau n'en dépend pas. Aucune purge : la table grossit, seuls les 200 derniers sont lus.
- **À proximité (`nearby`).** Envoyé à chaque socket de chaque membre du groupe de conversation actuel de l'émetteur (celui des rooms LiveKit : `MediaCoordinator.groupMembersOf`), lui compris. Jamais enregistré, jamais envoyé au bureau entier. Hors de tout groupe (seul, en Ne pas déranger), l'accusé est `no_group`. Un message perdu pendant une coupure ne revient pas.
- **Accusé (`ChatAck`).** Dans l'ordre : charge utile invalide (`invalid` : canal inconnu, texte vide, ou de plus de 500 caractères une fois coupé de ses espaces) ; débit dépassé (`rate_limited` : 5 messages par fenêtre de 5 s, par compte et tous canaux confondus, si bien que se reconnecter ne remet pas la limite à zéro) ; puis les règles du canal. Une panne de la base à l'enregistrement répond `unavailable` (le message n'est pas parti ; le client peut réessayer) et se journalise sans le texte du message. Sans rappel d'accusé, le serveur n'a personne à qui répondre, sans erreur.
- **Qui écrit, qui reçoit.** Le joueur doit être au monde, et sa socket avoir reçu son `init` : sinon le message est ignoré, sans accusé (un membre retiré n'écrit plus). Une socket ne reçoit rien non plus avant son `init`, ni message ni événement média. L'auteur, le nom, l'identifiant et l'heure sont ceux du serveur, quoi que dise le client.
- **Texte.** Il part tel que le schéma le rend (espaces autour coupés), sans traitement HTML côté serveur : c'est le client qui l'affiche comme du texte.
- **Client** (`apps/client/src/office/ChatPanel.tsx`, `linkify.tsx`, `state/office-store.ts`). Les messages sont au magasin : l'historique de chaque `init` remplace « Tout le monde » (`chatAll`), `chat:message` s'y ajoute sans doublon d'`id` (les 200 derniers, comme le serveur), et « À proximité » (`chatNearby`, que le serveur ne redit jamais) reste le temps de la page. Le panneau Chat, ouvert par le bouton « Chat » de la barre (il reste monté fermé, pour garder brouillons et onglet), a deux onglets. « À proximité » ne se choisit qu'en conversation (`MediaSnapshot.room` : sans LiveKit, aucune room n'est rejointe, et il reste inactif) ; choisi, il reste ouvert quand elle finit, lisible mais sans envoi, et chaque onglet a son brouillon. Entrée envoie (`socket.timeout(5000).emit('chat:send', …)`) : le champ ne se vide qu'à `{ ok: true }`, sinon le texte reste, avec le message de la réponse (`fr.chat.rateLimited`, `invalid`, `noGroup`, `unavailable`) ou du délai écoulé ; rien ne part tant que la connexion n'est pas prête. L'émetteur reçoit son message par `chat:message`, comme les autres. Le texte n'est jamais du HTML : `linkify` le rend en nœuds de texte React, et seules les adresses `http:` et `https:` deviennent des liens (`target="_blank" rel="noopener noreferrer"`). Un badge sur le bouton fermé compte les nouveaux messages « Tout le monde » des autres depuis la dernière fois que l'onglet a été affiché (« 99+ » au-delà de 99).

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
- **Arrêt.** Sur SIGTERM (Railway, à chaque déploiement) ou SIGINT (Ctrl+C), le serveur enregistre la position de chaque personne présente, ferme les connexions temps réel, le serveur HTTP et la base, puis sort avec le code 0. Les navigateurs se reconnectent seuls à la nouvelle version ; les positions passent avant la fermeture des connexions, si bien que chacun y retrouve sa place du moment, pas celle d'il y a une minute. Les positions sont aussi enregistrées toutes les 60 secondes et à chaque départ.
- **Derrière le proxy de Railway.** Express fait confiance à un seul saut de proxy (`trust proxy` vaut 1). Pour limiter les tentatives de connexion par adresse, Better Auth lit l'adresse du client dans `X-Real-IP` (`src/auth/auth.ts`), l'en-tête que Railway documente pour cela et que son proxy réécrit à chaque requête (d'après le support de Railway). `X-Forwarded-For` n'est pas lu : l'appelant peut y mettre l'adresse de son choix. Si un autre service (un CDN, Cloudflare) venait se placer devant Railway, vérifier que `X-Real-IP` porte toujours l'adresse du visiteur.

### Première mise en ligne

1. Pousser `main` sur un dépôt GitHub privé, que Railway est autorisé à lire.
2. Dans Railway, créer un service à partir de ce dépôt (il trouve le `Dockerfile` et `railway.json`), puis ajouter une base PostgreSQL au même projet.
3. Renseigner les variables du service :

   | Variable | Valeur |
   | --- | --- |
   | `APP_URL` | l'adresse publique de l'appli, `https://<domaine>`, sans barre finale : c'est l'origine des cookies et des liens des e-mails, et la seule page d'où le temps réel accepte une connexion (en-tête `Origin`) |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`, la référence à la base du projet (remplacer « Postgres » par le nom du service de la base) |
   | `BETTER_AUTH_SECRET` | une valeur propre à la production : `openssl rand -base64 32` |
   | `MAILER` | `resend`, le seul mode d'envoi accepté en production |
   | `RESEND_API_KEY`, `MAIL_FROM` | la clé d'API de Resend, et l'expéditeur (`Bureau virtuel <bureau@…>`) sur un domaine d'envoi vérifié dans Resend |
   | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | le projet LiveKit Cloud : son adresse (`wss://<projet>.livekit.cloud`) et une clé d'API avec son secret (voir « Audio et vidéo »). Facultatives : sans l'une d'elles, l'audio et la vidéo sont désactivés, et le journal le dit au démarrage |

   `PORT` vient de Railway ; `NODE_ENV`, `CLIENT_DIST_DIR` et `MAPS_DIR` ont déjà leur valeur de production dans l'image (les définir sur Railway n'est utile que pour en changer). `E2E` ne doit pas être définie : le serveur la refuse en production. Une configuration invalide arrête le démarrage, et le journal du déploiement nomme les variables fautives.
4. Ajouter le domaine personnalisé (réseau public du service, puis l'enregistrement DNS que Railway indique ; le certificat HTTPS vient de Railway), et mettre `APP_URL` à jour avec ce domaine : Better Auth n'accepte que cette origine.
5. Vérifier : le journal de build se termine sans erreur, et `curl https://<domaine>/api/health` répond `{"ok":true}`.
6. Créer le premier admin, avec la CLI de Railway liée au projet : `railway run pnpm --filter @bureau/server admin:invite <adresse e-mail>` (voir « Premier admin »). Tant que son adresse est en `….railway.internal`, la base n'est joignable que depuis le réseau privé de Railway : si la commande ne l'atteint pas depuis le poste, la lancer dans le conteneur du service (`railway ssh -- node /app/apps/server/dist/cli/admin-invite.js <adresse e-mail>`), ou lui donner l'adresse publique de la base (`DATABASE_PUBLIC_URL`, variable du service PostgreSQL).

Ensuite, chaque `git push` sur `main` redéploie : l'image est reconstruite et les migrations passent avant le serveur. Une version dont le démarrage échoue (configuration invalide, migration en erreur) ne répond pas à `/api/health` et n'est pas mise en service.

## Exploitation

Les gestes de tous les jours, une fois le bureau en ligne. Le détail technique est dans « Panneau admin », « Premier admin », « Déployer » et « Audio et vidéo » ; ici, ce qu'il y a à faire.

### Inviter

1. Connecte-toi avec un compte admin et ouvre « Admin » dans la barre du bas (le tout premier admin vient de la commande de « Premier admin »).
2. Saisis l'adresse e-mail, choisis le rôle (« Membre » par défaut, « Admin » pour qui doit aussi administrer), puis clique sur « Envoyer l'invitation ».
3. La personne reçoit un e-mail avec un lien d'inscription, **valable 7 jours** (`INVITATION_TTL_MS`, `packages/shared/src/constants.ts`).
4. Au-delà, le lien ne marche plus mais l'invitation reste dans « Invitations en attente », marquée « expirée ». « Renvoyer » envoie un nouveau lien, valable 7 jours à son tour ; l'ancien ne marche plus.
5. Si l'e-mail n'est pas parti (`mail_failed`), l'invitation est gardée : elle est dans la liste, et « Renvoyer » refait l'envoi. Une adresse déjà invitée ne peut pas l'être une seconde fois (`already_invited`) : renvoie ou annule l'invitation existante.

### Retirer

1. Dans « Membres », clique sur « Retirer » à côté de la personne. Une boîte de dialogue demande confirmation, en nommant la personne.
2. Une fois confirmé, le compte est désactivé (pas supprimé) et la personne est déconnectée tout de suite : sa page revient à la connexion.
3. Limite connue de la V1 : **un retrait est définitif**. Il n'y a pas de réactivation dans l'appli, et l'adresse retirée ne peut plus être invitée (`already_member`, « Cette adresse a déjà un compte (actif ou retiré) »). Avant de retirer, vérifie donc que c'est bien voulu.
4. Le serveur refuse aussi qu'on se retire soi-même (`self`) ou qu'on retire le dernier admin actif (`last_admin`) : il en faut toujours un.

### Suivre la consommation LiveKit

- L'audio et la vidéo tournent sur l'offre gratuite de LiveKit Cloud (offre Build) : **5 000 minutes par mois**. Une minute compte pour chaque personne connectée à une conversation (`docs/conception.md`, §8.5).
- Les minutes se lisent dans le tableau de bord de LiveKit Cloud, sur le projet dont les clés sont dans les variables `LIVEKIT_*`. Rien ne les compte dans l'appli.
- Une semaine environ après le lancement, relève les minutes consommées et ramène-les à un mois entier.
- Si l'équipe approche de 5 000 minutes, passe à l'offre **Ship** (environ 50 $ par mois : 150 000 minutes, puis 0,0005 $ la minute ; tarifs vérifiés le 19/10/2026 dans la conception). N'attends pas la limite : la page de tarifs de LiveKit ne dit pas ce qui arrive quand l'offre gratuite l'atteint.

### Redéployer

- Un `git push` sur `main` redéploie sur Railway : l'image est reconstruite, les migrations passent, puis la nouvelle version remplace l'ancienne dès que `/api/health` répond (détails dans « Déployer » et « Première mise en ligne »). Après un déploiement, `curl https://<domaine>/api/health` doit répondre `{"ok":true}`.
- Pendant un redéploiement, **tout le monde est déconnecté**, puis les navigateurs se reconnectent seuls à la nouvelle version. À l'arrêt, le serveur enregistre la position de chaque personne présente avant de fermer les connexions : chacun retrouve sa place. Les conversations audio et vidéo se reforment ensuite d'après les positions retrouvées.
- À vérifier dans Railway : le délai laissé entre SIGTERM et SIGKILL, qui se règle dans « Settings » du service (réglage « draining »), ou par la variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (documentation de Railway sur l'arrêt d'un déploiement). Il doit couvrir l'enregistrement des positions, la fermeture des connexions, du serveur HTTP et de la base. Le serveur n'a pas de délai global : seule l'attente de la fermeture du serveur HTTP s'arrête d'elle-même, au bout de 5 s (`HTTP_CLOSE_WAIT_MS`, `apps/server/src/realtime/io.ts`) ; l'enregistrement des positions et la fermeture de la base n'ont pas de limite. Si Railway tue le processus avant la fin, les gens retrouvent leur dernière position enregistrée, qui date de 60 secondes au plus (c'est l'intervalle de l'enregistrement périodique). Aucune valeur n'est vérifiée à ce jour : lis-la dans Railway avant le premier lancement.

### Checklist du premier vrai lancement

Production (variables du service Railway, voir « Première mise en ligne ») :

- [ ] `MAILER=resend`, avec `RESEND_API_KEY` et `MAIL_FROM` (un domaine d'envoi vérifié dans Resend).
- [ ] `LIVEKIT_URL`, `LIVEKIT_API_KEY` et `LIVEKIT_API_SECRET` en place : le journal de démarrage ne contient pas « LiveKit non configuré : audio et vidéo désactivés ».
- [ ] `MAP_KEY=office`, **seulement quand la carte définitive (`apps/client/public/assets/maps/office.json`, dessinée dans Tiled) est dans le dépôt** et que `pnpm --filter @bureau/server map:check ../client/public/assets/maps/office.json` sort avec le code 0. Commite et pousse `office.json` avant de mettre `MAP_KEY=office` : Railway construit l'image depuis le dépôt, et une carte absente empêche le serveur de démarrer. Tant que cette carte n'y est pas, `MAP_KEY` reste à `dev-office`.
- [ ] Une invitation réelle arrive dans la boîte de réception, pas dans les spams.

Essais à plusieurs, en vrai : deux personnes, puis trois, sur Chrome, Firefox et Safari, dont une sur le partage de connexion d'un téléphone.

- [ ] La conversation démarre en s'arrêtant à côté de quelqu'un.
- [ ] Passer dans une allée ne connecte personne.
- [ ] La salle de réunion est privée.
- [ ] Le partage d'écran fonctionne.
- [ ] Après un redéploiement, tout le monde revient seul.
- [ ] Le statut « Ne pas déranger » est respecté.
- [ ] L'avatar passe devant et derrière les meubles.
- [ ] Environ 60 images par seconde pendant une visio, mesurées avec l'onglet Performance du navigateur, sur un portable milieu de gamme (`docs/conception.md`, §14).

Lancement :

- [ ] Envoyer les invitations à l'équipe depuis le panneau admin.
- [ ] Poser à LimeZu la question de la licence par personne.
- [ ] Une semaine après : relever les minutes LiveKit et décider du passage à l'offre Ship (voir « Suivre la consommation LiveKit »).
