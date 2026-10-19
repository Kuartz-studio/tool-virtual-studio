# Bureau virtuel : plan d'implémentation

> **Pour les agents qui exécutent ce plan :** SOUS-SKILL REQUIS : utiliser superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** un bureau virtuel façon Gather pour l'équipe : un monde en pixel art vu de dessus, des déplacements en temps réel, l'audio/vidéo de proximité, un chat et des comptes sur invitation.

**Architecture :** un monorepo pnpm en trois paquets.
- `@bureau/shared` contient les règles communes : protocole, lecture de la carte, validation des mouvements, calcul des groupes.
- `@bureau/server` réunit Express 5, Better Auth et Socket.io. L'état du monde vit en mémoire, sur une seule instance.
- `@bureau/client` utilise React 19 pour l'interface et Phaser 4 pour le monde.

Le serveur sert le client, l'API et Socket.io depuis la même origine. L'audio/vidéo passe par LiveKit Cloud, avec une room par groupe de conversation.

**Technologies :** Node 24 LTS en production (Node ≥ 22.12 accepté en développement), TypeScript, pnpm, Vite 8, React 19, react-router 7, zustand 5, Phaser 4.2, Socket.io 4.8, Express 5, Better Auth 1.7, Drizzle ORM 0.45, PostgreSQL 18 (PGlite en mémoire pour les tests), zod, Resend avec react-email, livekit-client 2 et livekit-server-sdk 2, Tiled 1.12, Vitest, Playwright, tsup, tsx, pngjs.

**Spec :** [docs/conception.md](../../conception.md). Le plan s'appuie sur ce document ; les exécutants lisent les deux. Recherche : [docs/recherche.md](../../recherche.md).

**Dossier du projet :** un nouveau dépôt git privé, par exemple `~/Tools/bureau-virtuel`. Les noms d'événements du §7.5 de la spec étaient indicatifs : ce plan les fixe en anglais (section « Protocole », tâche 1).

## Contraintes globales

- Phaser 4 (4.2.x), Socket.io 4.8.x, Better Auth 1.7.x, PostgreSQL 18 avec Drizzle, Node 24 LTS en production (Node ≥ 22.12 accepté en développement).
- Aucun outil ne doit exiger Docker en local : la base de développement est PGlite, et Railway construit l'image en ligne.
- Vue de dessus façon Gather : tuiles de 32 px, 4 directions, `pixelArt: true`, zoom entier ×1 ou ×2.
- Cartes Tiled exportées en JSON, tilesets intégrés, calques en CSV. Calques : `sol`, `murs`, `meubles-bas`, `objets`, `dessus`, `collisions`, `zones`.
- Client, `/api` et `/socket.io` servis depuis la même origine, par une seule instance de serveur.
- Comptes :
  - inscription uniquement sur invitation, valable 7 jours ;
  - mot de passe de 10 caractères minimum ;
  - session de 30 jours, prolongée à l'usage ;
  - cookies `httpOnly`, `Secure` et `SameSite=Lax` ;
  - limitation des tentatives stockée en base.
- Mouvements :
  - le client décide de son mouvement, le serveur vérifie ;
  - `move` est envoyé 10 fois par seconde au plus, et tout de suite à l'arrêt ou au changement de direction ;
  - `world:tick` part toutes les 100 ms, en `volatile` ;
  - les autres avatars sont affichés avec environ 100 ms de retard.
- Groupes de conversation :
  - calculés 4 fois par seconde ;
  - entrée à moins de 3 cases, et seulement à l'arrêt, dans les espaces ouverts ;
  - sortie au-delà de 4 cases ;
  - délai de 500 ms avant d'appliquer un changement ;
  - zones `private` et `desk` isolées des autres ;
  - personnes en Ne pas déranger exclues.
- Délai de grâce de 10 s à la déconnexion. Dernière position enregistrée à la déconnexion et toutes les 60 s.
- Chat : 500 caractères au plus. Les 200 derniers messages « Tout le monde » sont conservés ; « À proximité » ne l'est pas.
- LiveKit Cloud, sur l'offre gratuite au départ. Une room par groupe, et un jeton valable pour une seule room.
- Statuts choisis à la main : Disponible (vert), Occupé (orange), Absent (gris), Ne pas déranger (rouge). Pas d'absence automatique.
- Interface en français, tous les textes dans `apps/client/src/i18n/fr.ts`. Navigateurs d'ordinateur : Chrome, Edge, Firefox et Safari récents.
- Dépôt privé. Les assets LimeZu ne sont jamais publiés, et le crédit LimeZu, avec un lien, est visible dans l'appli.

## Points de vigilance

Cinq situations que la spec implique sans les tester. Chacune a son test dans la tâche indiquée.

1. **Micro ou caméra refusés, ou absents.** On doit quand même pouvoir entrer, bouger, écrire et entendre les autres ; la personne apparaît sans vidéo. Test e2e : tâche 20.
2. **Brève coupure réseau (Wi-Fi qui saute).** L'avatar ne disparaît pas chez les autres et la conversation reprend toute seule. Tests : tâches 13 et 18.
3. **Redémarrage ou déploiement du serveur en journée.** Tout le monde se reconnecte seul, retrouve sa position enregistrée, et les conversations se reforment. Tests : tâches 13 et 15.
4. **Onglet en arrière-plan pendant des heures.** La mémoire n'enfle pas, les avatars se recalent au retour, l'audio continue. Test : tâche 15.
5. **Lien d'invitation déjà utilisé, expiré, ou ouvert en étant connecté avec un autre compte.** Un message clair s'affiche, sans mélange de comptes. Tests : tâches 4 et 7.

## Tâches pour toi (👤)

| Avant la tâche | Action |
|---|---|
| 8 | Créer un dépôt GitHub privé, un projet Railway avec Postgres et un compte Resend (avec le sous-domaine d'envoi vérifié), et choisir l'adresse de l'appli |
| 18 | Créer un projet LiveKit Cloud (offre gratuite) et fournir son URL et ses clés |
| 20 | Pour les tests audio/vidéo de bout en bout : installer le serveur LiveKit local (`brew install livekit`), ou utiliser les clés du projet LiveKit Cloud |
| 23 | Acheter LimeZu Modern Interiors (version complète) et Modern Office – Revamped ; exporter 12 à 16 personnages avec le Character Generator |
| 24 | Dessiner la carte définitive dans Tiled (conventions dans la tâche 24) |

## Structure des fichiers

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · vitest.config.ts
Dockerfile · railway.json · .env.example · README.md
packages/shared/src/
  constants.ts            valeurs de la spec (une seule source)
  protocol.ts             types et schémas zod des événements Socket.io
  avatars.ts              clés d'avatars valides
  map/tiled-types.ts      types minimaux du JSON Tiled
  map/build-tiled.ts      fabrique un JSON Tiled depuis un plan ASCII (carte de dev, tests)
  map/parse-map.ts        JSON Tiled → OfficeMap (cases bloquantes, zones, apparition)
  map/queries.ts          isWalkableTile, isWalkablePoint, zoneAt
  map/dev-office.ts       plan de la carte de développement
  movement/validate-move.ts
  proximity/compute-groups.ts
apps/server/src/
  index.ts · app.ts · env.ts · server-events.ts · rate-limit.ts
  db/client.ts · db/schema.ts · db/auth-schema.ts · db/migrate.ts
  mail/mailer.ts · mail/templates/*.tsx
  auth/auth.ts · auth/invitation-context.ts · auth/invitations.ts
  auth/invitation-routes.ts · auth/require-session.ts
  members/member-routes.ts · admin/admin-routes.ts · cli/admin-invite.ts · cli/map-check.ts
  realtime/io.ts · realtime/socket-auth.ts · realtime/presence.ts · realtime/handlers.ts
  realtime/world.ts · realtime/spawn.ts · realtime/positions.ts
  media/livekit.ts · media/media-coordinator.ts
  chat/chat-service.ts · testing/test-routes.ts
apps/client/src/
  main.tsx · router.tsx · i18n/fr.ts · lib/auth-client.ts · lib/api.ts
  pages/   LoginPage · JoinPage · ForgotPasswordPage · ResetPasswordPage · AvatarPage · OfficePage
  state/office-store.ts · net/socket.ts · net/office-connection.ts
  game/    config.ts · EventBus.ts · PhaserGame.tsx · zoom.ts · input.ts · avatars.ts · debug.ts
           map-layers.ts · move-sender.ts · snapshot-buffer.ts
           scenes/Preloader.ts · scenes/Office.ts · objects/LocalPlayer.ts · objects/RemotePlayer.ts · objects/NameTag.ts
  media/   media-client.ts · livekit-media-client.ts · fake-media-client.ts · prefs.ts · use-media.ts
  office/  OfficeShell · DeviceCheck · VideoStrip · ControlBar · StatusMenu · PeoplePanel · ChatPanel · linkify
           AdminPanel · CreditsDialog · ReplacedScreen
apps/client/scripts/gen-dev-assets.ts
e2e/ playwright.config.ts · helpers.ts · *.spec.ts
```

## Carte des tâches

| Phase | Tâches | À la fin, en ligne et utilisable |
|---|---|---|
| 1. Socle | 1–8 | Invitation, création de compte, connexion, mot de passe oublié, en ligne sur Railway |
| 2. Le monde en solo | 9–11 | On se promène seul dans la carte de développement |
| 3. Multijoueur | 12–16 | On se voit bouger, avec noms, statuts et panneau Personnes |
| 4. Audio/vidéo | 17–20 | Conversations de proximité, salle de réunion privée, partage d'écran |
| 5. Chat | 21–22 | Chat « Tout le monde » et « À proximité » |
| 6. Finitions | 23–26 | Avatars LimeZu, carte définitive, crédits, panneau admin, lancement |

Chaque phase se termine par un `git push` sur `main`. À partir de la tâche 8, Railway redéploie automatiquement.

---

# Phase 1 : Socle

### Tâche 1 : Monorepo et paquet partagé

**Fichiers :**
- Créer : `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`
- Créer : `packages/shared/package.json` (`"name": "@bureau/shared"`, `"type": "module"`, `"exports": { ".": "./src/index.ts" }`), `packages/shared/tsconfig.json`, `packages/shared/src/{index,constants,protocol,avatars}.ts`
- Test : `packages/shared/test/protocol.test.ts`

**Interfaces :**
- Produit : toutes les constantes et tous les types ci-dessous, réexportés par `packages/shared/src/index.ts`. Les autres paquets les importent depuis `@bureau/shared`.

```ts
// constants.ts : valeurs de la spec
export const TILE_SIZE = 32;
export const MAX_SPEED_PX_PER_S = 160;
export const MOVE_TOLERANCE = 1.5;
export const MOVE_JITTER_MS = 250;
export const MOVE_SEGMENT_STEP_PX = 8;
export const CLIENT_MOVE_MAX_HZ = 10;
export const WORLD_TICK_MS = 100;
export const REMOTE_RENDER_DELAY_MS = 150;   // 100 à l'origine ; 150 depuis la tâche 15 (marche saccadée à 100, voir constants.ts)
export const EXTRAPOLATION_MAX_MS = 60;      // ajouté à la tâche 15 : extrapolation courte d'un avatar distant en marche
export const TELEPORT_SNAP_PX = 3 * TILE_SIZE;
export const GROUPS_TICK_MS = 250;
export const JOIN_DISTANCE_PX = 3 * TILE_SIZE;   // « à moins de 3 cases » : d < JOIN
export const LEAVE_DISTANCE_PX = 4 * TILE_SIZE;  // « au-delà de 4 cases » : on reste tant que d <= LEAVE
export const GROUP_DEBOUNCE_MS = 500;
export const DISCONNECT_GRACE_MS = 10_000;
export const POSITION_SAVE_INTERVAL_MS = 60_000;
export const CHAT_MAX_LENGTH = 500;
export const CHAT_HISTORY_LIMIT = 200;
export const CHAT_RATE = { max: 5, windowMs: 5_000 };
export const SOCKET_CONNECT_RATE = { max: 10, windowMs: 60_000 };
export const MOVE_RATE = { max: 20, windowMs: 1_000 };          // au-delà, les `move` d'une socket sont ignorés
export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const SESSION_TTL_S = 30 * 24 * 3600;
export const LIVEKIT_TOKEN_TTL_S = 600;
export const OFFICE_ROOM = 'office';

// avatars.ts
export const DEV_AVATAR_KEYS = ['dev-red', 'dev-blue', 'dev-green', 'dev-yellow'] as const;
export const GALLERY_AVATAR_KEYS: readonly string[] = [];   // rempli à la tâche 23
export const DEFAULT_AVATAR_KEY = 'dev-red';
export type AvatarKey = string;
export function isAvatarKey(k: string): boolean;              // ∈ DEV_AVATAR_KEYS ∪ GALLERY_AVATAR_KEYS

// protocol.ts
export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const STATUSES = ['available', 'busy', 'away', 'dnd'] as const;
export type Status = (typeof STATUSES)[number];
export type Role = 'admin' | 'member';
export type ChatChannel = 'all' | 'nearby';
export const directionSchema = z.enum(DIRECTIONS);
export const statusSchema = z.enum(STATUSES);
export const moveSchema = z.object({ x: z.number().int(), y: z.number().int(), dir: directionSchema, moving: z.boolean() });
export const mediaStateSchema = z.object({ mic: z.boolean(), cam: z.boolean(), screen: z.boolean() });
export const chatSendSchema = z.object({ channel: z.enum(['all', 'nearby']), text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) });
export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);
export type MovePayload = z.infer<typeof moveSchema>;
export type MediaState = z.infer<typeof mediaStateSchema>;
export type ChatSendPayload = z.infer<typeof chatSendSchema>;
export interface PublicPlayer { id: string; name: string; avatarKey: AvatarKey | null; x: number; y: number; dir: Direction; moving: boolean; status: Status; media: MediaState }
export interface ProximityPlayer { id: string; x: number; y: number; moving: boolean; status: Status }   // entrée du calcul des groupes
export interface ChatMessage { id: string; channel: ChatChannel; userId: string; name: string; text: string; sentAt: string }
export interface InitPayload { self: PublicPlayer; players: PublicPlayer[]; mapKey: string; chatHistory: ChatMessage[] }
export interface WorldTick { t: number; moves: Array<{ id: string } & MovePayload> }
export interface MediaJoinPayload { url: string; room: string; token: string }
export type ChatAck = { ok: true } | { ok: false; error: 'invalid' | 'rate_limited' | 'no_group' };
export interface ServerToClientEvents {
  init: (p: InitPayload) => void;
  'world:tick': (p: WorldTick) => void;
  'move:correct': (p: { x: number; y: number }) => void;
  'player:joined': (p: PublicPlayer) => void;
  'player:left': (p: { id: string }) => void;
  'status:changed': (p: { id: string; status: Status }) => void;
  'media:changed': (p: { id: string; media: MediaState }) => void;
  'profile:changed': (p: { id: string; name: string; avatarKey: AvatarKey | null }) => void;
  'chat:message': (p: ChatMessage) => void;
  'media:join': (p: MediaJoinPayload) => void;
  'media:leave': () => void;
  'session:replaced': () => void;
}
export interface ClientToServerEvents {
  move: (p: MovePayload) => void;
  'status:set': (s: Status) => void;
  'media:state': (m: MediaState) => void;
  'chat:send': (p: ChatSendPayload, ack: (r: ChatAck) => void) => void;
  'debug:teleport': (p: { x: number; y: number }) => void;   // accepté seulement si E2E=1
}
```

- [ ] **Étape 1 : créer le dépôt et le squelette.** Lancer `git init`. Dans le `package.json` racine, définir ces scripts :
  - `test` : `vitest run` ;
  - `typecheck` : `pnpm -r typecheck` ;
  - `dev` : `pnpm -r --parallel dev` ;
  - `build` : `pnpm --filter @bureau/client build && pnpm --filter @bureau/server build` ;
  - `e2e` : `playwright test -c e2e/playwright.config.ts`.

  Dans `vitest.config.ts`, déclarer `test.projects: ['packages/*', 'apps/*']`. TypeScript en dernière version stable ; revenir à 6.x si un outil ne supporte pas 7.x.

- [ ] **Étape 2 : écrire le test qui échoue**

```ts
import { moveSchema, chatSendSchema, statusSchema, displayNameSchema, isAvatarKey } from '../src';
test('move : entiers et direction connue', () => {
  expect(moveSchema.safeParse({ x: 10, y: 20, dir: 'down', moving: true }).success).toBe(true);
  expect(moveSchema.safeParse({ x: 10.5, y: 20, dir: 'down', moving: true }).success).toBe(false);
  expect(moveSchema.safeParse({ x: 10, y: 20, dir: 'north', moving: true }).success).toBe(false);
});
test('chat : espaces coupés, 1 à 500 caractères', () => {
  expect(chatSendSchema.parse({ channel: 'all', text: '  salut ' }).text).toBe('salut');
  expect(chatSendSchema.safeParse({ channel: 'all', text: '   ' }).success).toBe(false);
  expect(chatSendSchema.safeParse({ channel: 'all', text: 'a'.repeat(501) }).success).toBe(false);
});
test('statuts', () => expect(statusSchema.options).toEqual(['available', 'busy', 'away', 'dnd']));
test('nom affiché : 1 à 40 caractères', () => {
  expect(displayNameSchema.safeParse('Léa').success).toBe(true);
  expect(displayNameSchema.safeParse('a'.repeat(41)).success).toBe(false);
});
test('avatars', () => { expect(isAvatarKey('dev-red')).toBe(true); expect(isAvatarKey('nope')).toBe(false); });
```

- [ ] **Étape 3 : vérifier l'échec.** `pnpm vitest run packages/shared/test/protocol.test.ts` → FAIL (module introuvable).
- [ ] **Étape 4 : écrire `constants.ts`, `avatars.ts`, `protocol.ts` et `index.ts`** tels que définis ci-dessus.
- [ ] **Étape 5 : vérifier le succès.** Même commande → PASS. Puis `pnpm typecheck` → aucune erreur.
- [ ] **Étape 6 : commit.** `git add -A && git commit -m "chore: monorepo et paquet partagé (constantes, protocole)"`

### Tâche 2 : Serveur : configuration, base de données, santé

**Fichiers :**
- Créer : `apps/server/package.json` (`@bureau/server` ; scripts `dev: tsx watch src/index.ts`, `build: tsup`, `typecheck`, `db:generate: drizzle-kit generate`, `admin:invite`, `map:check`), `tsconfig.json`, `tsup.config.ts`, `drizzle.config.ts`
- Créer : `apps/server/src/env.ts`, `src/logger.ts` (pino, journaux structurés), `src/db/client.ts`, `src/db/migrate.ts`, `src/app.ts`, `src/index.ts`
- Modifier : `.gitignore` (ajouter `.data/`, le dossier de la base PGlite de développement)
- Test : `apps/server/test/env.test.ts`, `apps/server/test/health.test.ts`, `apps/server/test/helpers/test-db.ts`, `apps/server/test/helpers/test-env.ts` (`testEnv(overrides?)`, un `Env` valide pour les tests)

**Interfaces :**
- Consomme : rien.
- Produit :
  - `loadEnv(src?: Record<string, string | undefined>): Env` ;
  - `createDb(url: string): Promise<{ db: Db; close(): Promise<void> }>`. L'URL `memory://` donne PGlite en mémoire, `pglite://<dossier>` donne PGlite enregistré dans ce dossier (développement local), et toute autre URL donne un pool node-postgres ;
  - `runMigrations(db: Db): Promise<void>` ;
  - `createApp(deps: AppDeps): express.Express`, où `AppDeps = { env: Env; db: Db }` est étendu par les tâches suivantes ;
  - côté tests, `createTestDb(): Promise<Db>`, une base en mémoire avec les migrations appliquées.

`Env` (schéma zod) :

| Variable | Règle |
|---|---|
| `NODE_ENV` | `development`, `test` ou `production` ; défaut `development` |
| `PORT` | défaut 4000 |
| `APP_URL` | URL, obligatoire |
| `DATABASE_URL` | obligatoire ; `memory://` et `pglite://…` refusés en production |
| `BETTER_AUTH_SECRET` | 32 caractères minimum |
| `MAILER` | `resend` ou `memory` ; `resend` obligatoire en production |
| `RESEND_API_KEY` | obligatoire si `MAILER=resend` |
| `MAIL_FROM` | obligatoire si `MAILER=resend` |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | optionnelles ; sans elles, l'audio/vidéo est désactivé |
| `MAP_KEY` | défaut `dev-office` |
| `MAPS_DIR` | défaut `<repo>/apps/client/public/assets/maps` |
| `CLIENT_DIST_DIR` | optionnelle |
| `E2E` | `1` ou absente |
| `AUTH_RATE_LIMIT` | `on` ou `off` ; défaut `on` |

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('APP_URL manquante → erreur qui la nomme', () =>
  expect(() => loadEnv({ DATABASE_URL: 'memory://', BETTER_AUTH_SECRET: 'x'.repeat(32) })).toThrow(/APP_URL/));
test('production refuse memory:// et MAILER=memory', () => {
  const base = { NODE_ENV: 'production', APP_URL: 'https://b.fr', BETTER_AUTH_SECRET: 'x'.repeat(32) };
  expect(() => loadEnv({ ...base, DATABASE_URL: 'memory://', MAILER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.fr' })).toThrow(/DATABASE_URL/);
  expect(() => loadEnv({ ...base, DATABASE_URL: 'pglite://.data/dev', MAILER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.fr' })).toThrow(/DATABASE_URL/);
  expect(() => loadEnv({ ...base, DATABASE_URL: 'postgres://x', MAILER: 'memory' })).toThrow(/MAILER/);
});
test('GET /api/health', async () => {
  const app = createApp({ env: testEnv(), db: await createTestDb() });
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200); expect(res.body).toEqual({ ok: true });
});
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/server/test/env.test.ts apps/server/test/health.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter `env.ts`, `db/client.ts`, `db/migrate.ts`, `app.ts` et `index.ts`.**
  - `index.ts` enchaîne : charger l'env, créer la base, créer l'app, créer le serveur http, `listen(PORT)`.
  - `migrate.ts` s'exécute aussi directement (`node dist/migrate.js`).
  - tsup compile `src/index.ts`, `src/db/migrate.ts` et `src/cli/*.ts`, avec `noExternal: ['@bureau/shared']`.
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS. Puis `pnpm --filter @bureau/server dev`, avec `DATABASE_URL=pglite://.data/dev` → `curl localhost:4000/api/health` doit répondre `{"ok":true}`, et `git status` ne montre pas `.data/`.
- [ ] **Étape 5 : commit.** `git commit -am "feat(server): configuration, base de données, santé"`

### Tâche 3 : E-mails

**Fichiers :**
- Créer : `apps/server/src/mail/mailer.ts`, `src/mail/templates/invitation-email.tsx`, `src/mail/templates/reset-password-email.tsx`
- Test : `apps/server/test/mailer.test.ts`

**Interfaces :**
- Produit :

```ts
export interface Mailer {
  sendInvitation(i: { to: string; link: string; invitedBy: string | null }): Promise<void>;
  sendPasswordReset(i: { to: string; link: string }): Promise<void>;
}
export interface SentMail { to: string; subject: string; html: string; text: string; link: string }
export function createMemoryMailer(): Mailer & { sent: SentMail[]; last(to?: string): SentMail | undefined };
export function createResendMailer(o: { apiKey: string; from: string }): Mailer;
```

Les textes des e-mails sont décidés ici :

| E-mail | Objet | Corps | Bouton | Pied |
|---|---|---|---|---|
| Invitation | « Invitation au bureau virtuel » | « {invitedBy} t'invite à rejoindre le bureau virtuel de l'équipe. » Si `invitedBy` vaut null : « Une invitation t'attend pour rejoindre le bureau virtuel de l'équipe. » | « Créer mon compte » | « Ce lien est valable 7 jours. » |
| Réinitialisation | « Réinitialiser ton mot de passe » | « Clique sur le bouton pour choisir un nouveau mot de passe. » | « Choisir un nouveau mot de passe » | « Si tu n'as rien demandé, ignore cet e-mail. » |

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('invitation : lien, inviteur et durée dans le HTML et le texte', async () => {
  const m = createMemoryMailer();
  await m.sendInvitation({ to: 'lea@x.fr', link: 'https://b.fr/rejoindre?token=abc', invitedBy: 'Tom' });
  const mail = m.last('lea@x.fr')!;
  expect(mail.subject).toBe('Invitation au bureau virtuel');
  expect(mail.html).toContain('https://b.fr/rejoindre?token=abc');
  expect(mail.html).toContain('Tom');
  expect(mail.text).toContain('7 jours');
  expect(mail.link).toBe('https://b.fr/rejoindre?token=abc');
});
test('réinitialisation : lien présent', async () => { /* même schéma avec sendPasswordReset */ });
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/server/test/mailer.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter.** Les modèles s'écrivent avec les composants et la fonction `render` de `react-email` 6 : vérifier le chemin d'import dans sa documentation, puisque `@react-email/components` est déprécié. `createResendMailer` appelle `resend.emails.send({ from, to, subject, html, text })`.
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(server): e-mails d'invitation et de réinitialisation"`

### Tâche 4 : Better Auth et inscription sur invitation

**Fichiers :**
- Créer : `apps/server/src/auth/auth.ts`, `src/auth/auth.cli.ts` (instance minimale, utilisée seulement pour générer le schéma), `src/auth/invitation-context.ts`, `src/auth/invitations.ts`, `src/auth/invitation-routes.ts`
- Créer : `apps/server/src/db/auth-schema.ts`, généré par `npx @better-auth/cli@latest generate --config src/auth/auth.cli.ts --output src/db/auth-schema.ts`, puis versionné
- Créer : `apps/server/src/db/schema.ts`, qui réexporte le schéma d'auth et définit `invitation` et `chatMessage` ; puis les migrations, générées avec `pnpm --filter @bureau/server db:generate`
- Modifier : `apps/server/src/app.ts`. Monter `app.all('/api/auth/{*any}', toNodeHandler(auth))` **avant** `express.json()`, puis les routes d'invitation.
- Test : `apps/server/test/invitations.test.ts`, `apps/server/test/helpers/test-app.ts`

**Interfaces :**
- Consomme : `createDb`, `runMigrations`, `Mailer`, `Env`, `INVITATION_TTL_MS`, `PASSWORD_MIN_LENGTH`, `SESSION_TTL_S`, `displayNameSchema`.
- Produit :

```ts
export function createAuth(d: { db: Db; mailer: Mailer; env: Env }): Auth;
export const invitationContext: AsyncLocalStorage<{ email: string; role: Role }>;
export interface Invitation { id: string; email: string; role: Role; invitedBy: string | null; createdAt: Date; expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null }
export function createInvitationService(db: Db, now?: () => Date): {
  create(i: { email: string; role: Role; invitedBy: string | null }): Promise<{ invitation: Invitation; token: string }>;
  check(token: string): Promise<{ status: 'valid'; invitation: Invitation } | { status: 'expired' | 'used' | 'revoked' | 'unknown' }>;
  markAccepted(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
  renew(id: string): Promise<{ token: string }>;      // nouveau jeton et nouvelle expiration
  listPending(): Promise<Invitation[]>;
};
// côté tests : createTestApp() → { app, db, auth, mailer, invitations, inviteAndAccept(email, o?) → { cookie, userId } }
```

**Tables :**
- `invitation` : `id` (uuid, clé primaire), `email` (texte, en minuscules), `token_hash` (sha256 hex, unique), `role`, `invited_by` (null si l'invitation vient de la commande), `created_at`, `expires_at`, `accepted_at`, `revoked_at`.
- `chat_message` : `id` (uuid), `user_id` (supprimé en cascade avec l'utilisateur), `body`, `created_at` (indexé).

**Le jeton** fait 32 octets aléatoires, encodés en base64url. Seul son sha256 est stocké.

**Configuration de Better Auth :**
- `emailAndPassword` : `{ enabled: true, minPasswordLength: 10, maxPasswordLength: 128, autoSignIn: true }` ;
- `session` : `{ expiresIn: SESSION_TTL_S, updateAge: 86400 }` ;
- `user.additionalFields` : `role` (défaut `'member'`), `avatarKey`, `lastX`, `lastY`, `lastDir`, `disabledAt`, tous en `input: false` ;
- `trustedOrigins: [env.APP_URL]` ;
- `advanced.useSecureCookies` vaut `env.NODE_ENV === 'production'` ;
- `rateLimit: { enabled: env.AUTH_RATE_LIMIT === 'on', storage: 'database' }`, dès cette tâche, pour que la génération du schéma crée la table `rateLimit`. `auth.cli.ts` reprend toute cette configuration.

**Mécanisme d'inscription sur invitation :** il faut l'implémenter tel quel, car il garantit le refus de toute inscription sans invitation.
- `databaseHooks.user.create.before` lève `APIError('FORBIDDEN')` sauf si `invitationContext.getStore()?.email === user.email`. Dans ce cas, il renvoie `{ data: { ...user, emailVerified: true, role: store.role } }`.
- La route d'acceptation appelle `invitationContext.run({ email, role }, () => auth.api.signUpEmail({ body: { email, password, name }, asResponse: true }))`. Elle recopie ensuite les en-têtes `set-cookie` de la réponse.
- Si la signature des crochets a changé en 1.7, renvoyer `false` pour refuser : vérifier dans la documentation de Better Auth.

**Routes :**
- `GET /api/invitations/:token` répond :
  - `200 { email }` si l'invitation est valide ;
  - `410 { error: 'expired' | 'used' | 'revoked' }` sinon ;
  - `404` si le jeton est inconnu.
- `POST /api/invitations/accept { token, name, password }` répond `201 { ok: true }` avec `Set-Cookie`, ou `400 { error: 'invalid' }`, ou `410`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('inscription directe sans invitation refusée', async () => {
  const t = await createTestApp();
  const res = await request(t.app).post('/api/auth/sign-up/email').send({ email: 'x@x.fr', password: 'motdepasse1', name: 'X' });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(await countUsers(t.db)).toBe(0);
});
test('invitation valide → compte vérifié, rôle, cookie de session', async () => {
  const t = await createTestApp();
  const { token } = await t.invitations.create({ email: 'Lea@X.fr', role: 'member', invitedBy: null });
  const res = await request(t.app).post('/api/invitations/accept').send({ token, name: 'Léa', password: 'motdepasse1' });
  expect(res.status).toBe(201);
  expect(res.headers['set-cookie'].join(';')).toMatch(/session_token/);
  const u = await findUserByEmail(t.db, 'lea@x.fr');
  expect(u).toMatchObject({ emailVerified: true, role: 'member', name: 'Léa' });
  expect((await t.invitations.check(token)).status).toBe('used');
});
test('rôle admin transmis', /* create role 'admin' → u.role === 'admin' */);
test.each([
  ['jeton réutilisé', 'used'], ['expiré après 8 jours', 'expired'], ['révoqué', 'revoked'],
])('%s → 410', /* accept → 410, body.error === statut ; aucun nouvel utilisateur */);
test('jeton inconnu → 404', /* GET /api/invitations/abc → 404 */);
test('mot de passe de 9 caractères → 400, invitation non consommée', /* check(token).status === 'valid' */);
test('nom vide ou de 41 caractères → 400', /* … */);
test('GET /api/invitations/:token renvoie l\'e-mail', /* { email: 'lea@x.fr' } */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/server/test/invitations.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter le schéma, les migrations, `createAuth`, le service d'invitations et les routes,** selon les interfaces ci-dessus.
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(server): Better Auth et inscription sur invitation"`

### Tâche 5 : Connexion, mot de passe oublié, comptes désactivés

**Fichiers :**
- Modifier : `apps/server/src/auth/auth.ts`
- Test : `apps/server/test/auth-flows.test.ts`

**Interfaces :**
- Consomme : `createTestApp().inviteAndAccept`.
- Produit : les routes Better Auth de connexion (`/sign-in/email`), de déconnexion, de demande et d'application d'une réinitialisation, et `get-session`. Vérifier leurs noms exacts en 1.7, puisque `/forget-password` est devenu `/request-password-reset`.

**À ajouter à la configuration :**
- `sendResetPassword: ({ user, url }) => mailer.sendPasswordReset({ to: user.email, link: url })`, avec `resetPasswordTokenExpiresIn: 3600`.
- `rateLimit.customRules` : `{ '/sign-in/email': { window: 10, max: 3 }, '/request-password-reset': { window: 60, max: 3 } }`.
- `databaseHooks.session.create.before` refuse la session si `user.disabledAt` est renseigné.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('connexion après invitation, session avec rôle', /* sign-in 200 ; get-session.user.role === 'member' */);
test('mauvais mot de passe → 401', /* … */);
test('4e tentative en 10 s → 429', /* 3 × 401 puis 429 */);
test('mot de passe oublié de bout en bout', async () => {
  // request-password-reset { email, redirectTo: `${APP_URL}/reinitialiser` } → 200
  // GET mailer.last(email).link → 302, Location contient '/reinitialiser?token='
  // reset-password { token, newPassword: 'nouveaumdp1' } → 200
  // connexion avec le nouveau → 200 ; avec l'ancien → 401
});
test('e-mail inconnu → 200 et aucun e-mail envoyé', /* mailer.sent.length === 0 */);
test('compte désactivé → connexion refusée', /* update disabledAt = now ; sign-in → status >= 400 */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/server/test/auth-flows.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter les trois ajouts de configuration.**
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(server): connexion, mot de passe oublié, comptes désactivés"`

### Tâche 6 : API membres, admin et profil ; commande admin:invite

**Fichiers :**
- Créer : `apps/server/src/auth/require-session.ts`, `src/server-events.ts`, `src/members/member-routes.ts`, `src/admin/admin-routes.ts`, `src/cli/admin-invite.ts`
- Test : `apps/server/test/members.test.ts`, `apps/server/test/admin.test.ts`

**Interfaces :**
- Consomme : `createAuth`, `createInvitationService`, `Mailer`, `isAvatarKey`, `displayNameSchema`.
- Produit :

```ts
export function requireSession(auth: Auth): RequestHandler;   // 401 ; met res.locals.user = { id, name, email, role, avatarKey }
export function requireAdmin(auth: Auth): RequestHandler;     // 401 ou 403
export interface ServerEvents {
  on(e: 'member:removed', cb: (userId: string) => void): void;
  on(e: 'profile:changed', cb: (p: { id: string; name: string; avatarKey: string | null }) => void): void;
  emit(...): void;
}
export function createServerEvents(): ServerEvents;
export function inviteAdmin(email: string, d: { invitations; mailer; env }): Promise<{ link: string }>;
```

**Routes :**

| Route | Accès | Réponse |
|---|---|---|
| `GET /api/members` | session | `[{ id, name, avatarKey }]`, membres actifs seulement |
| `PATCH /api/me { name?, avatarKey? }` | session | 200 et émet `profile:changed` ; 400 si `avatarKey` est invalide ou si le nom ne respecte pas `displayNameSchema` |
| `GET /api/admin/members` | admin | `[{ id, name, email, role }]` |
| `GET /api/admin/invitations` | admin | invitations en attente |
| `POST /api/admin/invitations { email, role = 'member' }` | admin | 201 et e-mail avec le lien `${APP_URL}/rejoindre?token=…` ; 409 `already_invited` si une invitation est déjà en attente ; 409 `already_member` |
| `POST /api/admin/invitations/:id/resend` | admin | nouveau jeton, nouvel e-mail ; l'ancien jeton devient invalide |
| `DELETE /api/admin/invitations/:id` | admin | révoque l'invitation |
| `DELETE /api/admin/members/:id` | admin | remplit `disabledAt`, supprime les sessions, émet `member:removed` ; 400 `self` ou `last_admin` |

**Commande :** `pnpm --filter @bureau/server admin:invite <email>` appelle `inviteAdmin` et affiche le lien.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('anonyme → 401, membre → 403 sur /api/admin/members', /* … */);
test('invitation par un admin : 201 et e-mail', /* mailer.last('new@x.fr').link contient '/rejoindre?token=' */);
test('double invitation → 409 already_invited ; membre existant → 409 already_member', /* … */);
test('relance : l\'ancien jeton ne marche plus, le nouveau oui', /* check(old).status !== 'valid' ; accept(new) → 201 */);
test('retrait d\'un membre : sessions supprimées et événement émis', async () => {
  // ancien cookie → GET /api/members → 401 ; events reçoit 'member:removed' avec son id
});
test('pas de retrait de soi-même ni du dernier admin', /* 400 self ; 400 last_admin */);
test('PATCH /api/me', /* avatarKey 'nope' → 400 ; name 'Léa B.' → 200 et 'profile:changed' émis */);
test('GET /api/members exclut les comptes désactivés', /* … */);
test('inviteAdmin renvoie un lien d\'invitation admin', /* check(token).invitation.role === 'admin' */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/server/test/members.test.ts apps/server/test/admin.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter les middlewares, les événements, les routes et la commande.**
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(server): API membres, admin, profil, commande admin:invite"`

### Tâche 7 : Client : socle, pages de compte, tests de bout en bout

**Fichiers :**
- Créer `apps/client` avec `npx degit phaserjs/template-react-ts apps/client`, puis :
  - renommer le paquet en `@bureau/client` ;
  - mettre à jour les dépendances : phaser 4.2.x, vite 8, react 19 ;
  - supprimer les scènes MainMenu et GameOver ;
  - garder `EventBus.ts` et `PhaserGame.tsx`.
- Créer :
  - `vite.config.ts`, avec un proxy de `/api` et de `/socket.io` (WebSocket) vers `http://localhost:4000`. En développement, `APP_URL` vaut l'adresse du serveur Vite, puisque c'est l'origine vue par le navigateur (cookies, liens des e-mails) ;
  - `src/router.tsx`, `src/lib/auth-client.ts` (`createAuthClient` de `better-auth/react`), `src/lib/api.ts` ;
  - `src/i18n/fr.ts`, qui exporte l'objet `fr` et un helper `t` ;
  - les pages `LoginPage` (`/connexion`), `JoinPage` (`/rejoindre?token=`), `ForgotPasswordPage` (`/mot-de-passe-oublie`), `ResetPasswordPage` (`/reinitialiser?token=`) ;
  - `RequireSession.tsx` et `OfficePage.tsx` (`/`), provisoire : « Bonjour {name} » et un bouton de déconnexion.
- Créer côté serveur : `apps/server/src/testing/test-routes.ts`, monté seulement si `E2E=1` :
  - `POST /api/test/invitations { email, role? }` → `{ link }` ;
  - `GET /api/test/mails/last?to=` → `{ subject, link }`.
- Modifier côté serveur : `apps/server/src/app.ts` sert `CLIENT_DIST_DIR` en statique, et renvoie `index.html` pour tout GET hors `/api` et `/socket.io`.
- Créer : `e2e/playwright.config.ts`, `e2e/helpers.ts`, `e2e/auth.spec.ts`.
  - Le `webServer` lance `VITE_E2E=1 pnpm build`, puis `node apps/server/dist/index.js`.
  - Son env : `E2E=1`, `NODE_ENV=test`, `DATABASE_URL=memory://`, `MAILER=memory`, `AUTH_RATE_LIMIT=off`, `BETTER_AUTH_SECRET` (32 caractères ou plus, valeur de test), `PORT=3100`, `APP_URL=http://localhost:3100`, `CLIENT_DIST_DIR=apps/client/dist`, `MAPS_DIR=apps/client/dist/assets/maps`.
- Test : `apps/client/src/pages/JoinPage.test.tsx` (Vitest, happy-dom, Testing Library), `apps/server/test/static.test.ts`.

**Interfaces :**
- Consomme : les routes des tâches 4 à 6.
- Produit :
  - `api<T>(path: string, init?: RequestInit): Promise<T>`, qui lève `ApiError { status, error }` ;
  - `authClient` ;
  - `fr` (clés utilisées par les tests : `fr.join.errors.used`, `fr.join.errors.expired`, `fr.join.signedInAs`) ;
  - côté e2e : `inviteAndJoin(page, { email, name, password }): Promise<void>`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```tsx
test('affiche l\'e-mail invité ; bouton actif à partir de 10 caractères', /* mock GET → { email: 'lea@x.fr' } */);
test('lien déjà utilisé → message fr.join.errors.used', /* mock GET → 410 { error: 'used' } */);
test('déjà connecté avec un autre compte → fr.join.signedInAs et bouton « Se déconnecter et continuer »', /* … */);
```

```ts
// apps/server/test/static.test.ts
test('SPA : /rejoindre renvoie index.html ; /api/inconnu renvoie 404 en JSON', /* CLIENT_DIST_DIR = dossier de test avec index.html */);
```

```ts
// e2e/auth.spec.ts
test('invitation → compte → bureau → déconnexion → connexion', /* … page.getByText('Bonjour Léa') */);
test('mot de passe oublié de bout en bout', /* lien lu via /api/test/mails/last */);
test('lien réutilisé → message « déjà utilisé »', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/pages/JoinPage.test.tsx apps/server/test/static.test.ts`, puis `pnpm e2e e2e/auth.spec.ts` → FAIL.
- [ ] **Étape 3 : implémenter les pages, le routeur, les routes de test, le service des fichiers statiques et la configuration Playwright.** Écrire tous les textes dans `fr.ts`.
- [ ] **Étape 4 : vérifier le succès.** Les deux commandes → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(client): pages de compte et tests de bout en bout"`

### Tâche 8 : Mise en production sur Railway

**Fichiers :**
- Créer : `Dockerfile`, multi-étapes :
  - installation avec pnpm, puis `pnpm build` ;
  - image finale `node:24-slim`, contenant `apps/server/dist`, `apps/server/drizzle` et `apps/client/dist`.
- Créer : `.dockerignore` et `railway.json`, avec `startCommand: "node apps/server/dist/migrate.js && node apps/server/dist/index.js"` et `healthcheckPath: "/api/health"`.
- Modifier : `apps/server/src/app.ts`, avec `app.set('trust proxy', 1)`.
- Modifier : `auth.ts`, avec `advanced.ipAddress.ipAddressHeaders: ['x-forwarded-for']`.
- Modifier : `README.md`, section « Déployer ».

- [ ] **Étape 1 : écrire le Dockerfile, `.dockerignore` et `railway.json`,** et appliquer les deux modifications ci-dessus.
- [ ] **Étape 2 : vérifier en local.**
  - `pnpm build` → succès ;
  - lancer le build de production sans Docker : `node apps/server/dist/migrate.js && node apps/server/dist/index.js`, avec `NODE_ENV=test`, `DATABASE_URL=pglite://.data/smoke`, `APP_URL=http://localhost:4000`, `BETTER_AUTH_SECRET` (32 caractères ou plus), `CLIENT_DIST_DIR=apps/client/dist` → `curl localhost:4000/api/health` répond `{"ok":true}`, et `/connexion` affiche la page de connexion ;
  - le Dockerfile lui-même est vérifié par le build en ligne de Railway (étape 6).
- [ ] **Étape 3 : vérifier que rien n'a cassé.** `pnpm test` → PASS.
- [ ] **Étape 4 : commit.** `git commit -am "chore: déploiement Railway"`
- [ ] **Étape 5 : 👤 déploiement**, avec toi :
  1. Pousser le code sur le dépôt GitHub privé (`git push`).
  2. Créer le service Railway depuis le dépôt et ajouter Postgres.
  3. Définir les variables d'environnement : `NODE_ENV=production`, `APP_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `MAILER=resend`, `RESEND_API_KEY`, `MAIL_FROM`, `CLIENT_DIST_DIR=apps/client/dist`, `MAPS_DIR=apps/client/dist/assets/maps`.
  4. Ajouter le domaine personnalisé.
- [ ] **Étape 6 : vérifier en ligne.**
  - le build Docker de Railway réussit (journal de build du service) ;
  - `curl https://<domaine>/api/health` → `{"ok":true}` ;
  - `railway run pnpm --filter @bureau/server admin:invite <ton e-mail>` → l'e-mail arrive et le compte se crée.

---

# Phase 2 : Le monde en solo

### Tâche 9 : Lecture de la carte et carte de développement

**Fichiers :**
- Créer : `packages/shared/src/map/{tiled-types,build-tiled,parse-map,queries,dev-office}.ts`
- Créer : `apps/client/scripts/gen-dev-assets.ts` (script `gen:dev-assets`, avec pngjs). Il écrit :
  - `apps/client/public/assets/dev/tiles.png` : 5 tuiles de 32×32 (1 sol, 2 mur, 3 bureau, 4 sol de salle, 5 sol de bureau) ;
  - `apps/client/public/assets/dev/avatars/{dev-red,dev-blue,dev-green,dev-yellow}.png` : 3 colonnes (immobile, pas 1, pas 2) sur 4 lignes (bas, gauche, droite, haut), images de 32×32 ;
  - `apps/client/public/assets/maps/dev-office.json`.
- Créer : `apps/server/src/cli/map-check.ts` (`pnpm map:check <fichier>`)
- Test : `packages/shared/test/map.test.ts`

**Interfaces :**
- Produit :

```ts
export type ZoneType = 'spawn' | 'private' | 'desk' | 'label';
export interface Zone { id: string; type: ZoneType; name: string | null; text: string | null; x: number; y: number; width: number; height: number } // pixels
export interface OfficeMap { widthTiles: number; heightTiles: number; tileSize: number; blocked: Uint8Array; zones: Zone[]; spawn: { x: number; y: number } }
export class MapError extends Error { code: 'missing_layer' | 'external_tileset' | 'compressed_layer' | 'missing_spawn' | 'bad_zone' }
export function parseOfficeMap(json: TiledMapJson): OfficeMap;
export function isWalkableTile(m: OfficeMap, tx: number, ty: number): boolean;   // hors carte → false
export function isWalkablePoint(m: OfficeMap, x: number, y: number): boolean;    // x, y = pieds de l'avatar, en px
export function zoneAt(m: OfficeMap, x: number, y: number, types?: ZoneType[]): Zone | null; // types par défaut : ['private', 'desk']
export function buildTiledMap(i: { ascii: string[]; zones: ZoneInput[]; tileset: { name: string; image: string } }): TiledMapJson;
export const DEV_OFFICE: { ascii: string[]; zones: ZoneInput[] };
```

**Lecture des zones :**
- le `type` d'une zone se lit dans `obj.type`, sinon dans `obj.class`, sinon dans la propriété personnalisée `type` ;
- `name` se lit dans `obj.name` ;
- `text` se lit dans la propriété `text` ;
- `id` vaut `String(obj.id)`.

**Le point d'apparition** est le centre de la zone `spawn`.

**La carte de développement** (24 × 16, plan exact). Légende : `#` mur bloquant, `.` sol, `T` bureau (bloquant).

```
########################
#......#......#........#
#......#......#........#
#......#......#........#
#......#......#........#
###.######.#######.#####
#......................#
#......................#
#......................#
#...TT.....TT.....TT...#
#......................#
#......................#
#......................#
#......................#
#......................#
########################
```

Ses zones, en cases (x, y, largeur, hauteur) :
- `private` « Salle de réunion » : (8, 1, 6, 4) ;
- `desk` : (3, 10, 4, 3), (10, 10, 4, 3) et (17, 10, 4, 3) ;
- `label` « DEV TEAM » : (9, 8, 6, 1) ;
- `spawn` : (2, 7, 1, 1).

Les sols des zones `private` et `desk` utilisent les tuiles 4 et 5.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
const map = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));
const c = (tx: number, ty: number) => [tx * 32 + 16, ty * 32 + 16] as const;
test('dimensions et cases bloquantes', () => {
  expect([map.widthTiles, map.heightTiles, map.tileSize]).toEqual([24, 16, 32]);
  expect(isWalkableTile(map, 0, 0)).toBe(false); expect(isWalkableTile(map, 1, 1)).toBe(true);
  expect(isWalkableTile(map, 4, 9)).toBe(false); expect(isWalkableTile(map, 10, 5)).toBe(true);
  expect(isWalkableTile(map, 11, 5)).toBe(false); expect(isWalkablePoint(map, -5, 100)).toBe(false);
});
test('apparition', () => expect(map.spawn).toEqual({ x: 80, y: 240 }));
test('zones', () => {
  const p = map.zones.find(z => z.type === 'private')!;
  expect(p).toMatchObject({ name: 'Salle de réunion', x: 256, y: 32, width: 192, height: 128 });
  expect(map.zones.filter(z => z.type === 'desk')).toHaveLength(3);
  expect(zoneAt(map, ...c(10, 2))?.type).toBe('private');
  expect(zoneAt(map, ...c(4, 11))?.type).toBe('desk');
  expect(zoneAt(map, ...c(10, 6))).toBeNull();
  expect(zoneAt(map, ...c(10, 8))).toBeNull();          // une étiquette n'isole pas
});
test.each([
  ['calque collisions absent', 'missing_layer'], ['tileset externe (source)', 'external_tileset'],
  ['calque compressé (zlib)', 'compressed_layer'], ['pas de zone spawn', 'missing_spawn'],
])('%s → MapError %s', /* variante du JSON → toThrow(expect.objectContaining({ code })) */);
test('type lu depuis class ou depuis la propriété type', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run packages/shared/test/map.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter les modules de carte, le script et `map:check`.** `map:check` affiche le nombre de zones par type et le point d'apparition ; en cas de `MapError`, il sort avec le code 1.
- [ ] **Étape 4 : vérifier le succès.** `pnpm vitest run packages/shared/test/map.test.ts` → PASS. `pnpm --filter @bureau/client gen:dev-assets && pnpm --filter @bureau/server map:check ../client/public/assets/maps/dev-office.json` → résumé, code de sortie 0.
- [ ] **Étape 5 : commit.** `git commit -am "feat(shared): lecture de la carte Tiled et carte de développement"`

### Tâche 10 : Scène Phaser : rendu de la carte et caméra

**Fichiers :**
- Créer :
  - `apps/client/src/game/config.ts` : `pixelArt: true`, `roundPixels: true`, physique Arcade sans gravité, `scale.mode: RESIZE`, scènes Boot, Preloader et Office ;
  - `apps/client/src/game/scenes/Preloader.ts` : charge `/assets/maps/${mapKey}.json`, chaque image de tileset citée par la carte, et les avatars du registre ;
  - `apps/client/src/game/scenes/Office.ts` ;
  - `apps/client/src/game/map-layers.ts` ;
  - `apps/client/src/game/zoom.ts` ;
  - `apps/client/src/game/debug.ts`.
- Modifier : `OfficePage.tsx`, qui monte `PhaserGame` avec `mapKey = 'dev-office'`.
- Test : `apps/client/src/game/zoom.test.ts`, `e2e/world.spec.ts`

**Interfaces :**
- Consomme : `TILE_SIZE`.
- Produit :

```ts
export const DEPTH = { sol: 0, murs: 1, meublesBas: 2, dessus: 1_000_000, nameTags: 1_000_001 } as const; // avatars et objets : profondeur = y des pieds
export function buildMapLayers(scene: Phaser.Scene, map: Phaser.Tilemaps.Tilemap): { collisions: Phaser.Tilemaps.TilemapLayer };
export function chooseZoom(width: number, height: number): 1 | 2;   // 2 si largeur ≥ 1280 et hauteur ≥ 720
export interface OfficeDebug { ready: boolean; self: { id: string; x: number; y: number } | null; players: Record<string, { x: number; y: number; avatarKey: string | null }>; media: { room: string | null; tiles: number }; teleport(x: number, y: number): void }
export function exposeDebug(h: OfficeDebug): void;   // window.__office, seulement si import.meta.env.VITE_E2E === '1'
```

Le calque `collisions` reste invisible et devient collidable (`setCollisionByExclusion([-1])`). Les étiquettes deviennent des textes Phaser, centrés dans leur zone. La méthode `teleport` de `OfficeDebug` est définie ici, mais ne marche qu'à partir de la tâche 14 (elle envoie `debug:teleport`).

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test.each([[1920, 1080, 2], [1280, 720, 2], [1279, 800, 1], [1440, 700, 1]])('chooseZoom(%i, %i) = %i', (w, h, z) => expect(chooseZoom(w, h)).toBe(z));
```

```ts
// e2e/world.spec.ts
test('la carte s\'affiche', /* inviteAndJoin → await page.waitForFunction(() => window.__office?.ready) ; canvas visible ; capture d'écran jointe */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/game/zoom.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter les scènes, les calques et le zoom.** La caméra est bornée à la carte, et le zoom est recalculé à chaque redimensionnement.
- [ ] **Étape 4 : vérifier le succès.** `pnpm vitest run apps/client/src/game/zoom.test.ts` et `pnpm e2e e2e/world.spec.ts` → PASS. Regarder la capture d'écran : murs, portes et bureaux en place.
- [ ] **Étape 5 : commit.** `git commit -am "feat(client): rendu de la carte dans Phaser"`

### Tâche 11 : Avatar local : clavier, collisions, animations

**Fichiers :**
- Créer : `apps/client/src/game/input.ts`, `src/game/avatars.ts`, `src/game/objects/LocalPlayer.ts`
- Modifier : `src/game/scenes/Office.ts` (collision avec `collisions`, caméra qui suit l'avatar)
- Test : `apps/client/src/game/input.test.ts`, `src/game/avatars.test.ts`, `e2e/world.spec.ts`

**Interfaces :**
- Consomme : `DEFAULT_AVATAR_KEY`, `DEV_AVATAR_KEYS`, `MAX_SPEED_PX_PER_S`, `DEPTH`.
- Produit :

```ts
export class DirectionInput {                 // touches physiques (KeyboardEvent.code) : ZQSD en AZERTY = WASD en QWERTY
  press(code: string): void; release(code: string): void; clear(): void;
  current(): Direction | null;                // la dernière touche encore enfoncée gagne
}
// up : ArrowUp, KeyW · down : ArrowDown, KeyS · left : ArrowLeft, KeyA · right : ArrowRight, KeyD
export interface AvatarSpec { key: string; url: string; frameWidth: number; frameHeight: number; idle: Record<Direction, number[]>; walk: Record<Direction, number[]>; frameRate: number }
export const AVATARS: Record<string, AvatarSpec>;
export function animKey(avatarKey: string, kind: 'idle' | 'walk', dir: Direction): string;  // `${avatarKey}-${kind}-${dir}`
export class LocalPlayer extends Phaser.Physics.Arcade.Sprite { step(dir: Direction | null): void; state(): MovePayload }
```

**Avatars de développement :**
- lignes : 0 bas, 1 gauche, 2 droite, 3 haut ;
- immobile : `[ligne*3]` ;
- marche : `[ligne*3, ligne*3+1, ligne*3, ligne*3+2]` ;
- 8 images par seconde.

**LocalPlayer :**
- origine (0.5, 1), c'est-à-dire aux pieds ;
- zone de collision de 20 × 12 px, au niveau des pieds ;
- vitesse `MAX_SPEED_PX_PER_S` dans une seule des 4 directions ;
- profondeur = `y` ;
- ombre portée : ellipse noire de 18 × 6 px à 25 % d'opacité, sous les pieds, profondeur `y − 1`. `RemotePlayer` (tâche 15) a la même ombre.

**Clavier :** quand le focus est dans un champ de saisie (`input`, `textarea`, `[contenteditable]`), il est ignoré et `clear()` est appelé.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('la dernière touche enfoncée gagne', () => {
  const i = new DirectionInput();
  i.press('ArrowRight'); i.press('KeyW'); expect(i.current()).toBe('up');
  i.release('KeyW'); expect(i.current()).toBe('right');
  i.release('ArrowRight'); expect(i.current()).toBeNull();
});
test('touches inconnues ignorées', () => { const i = new DirectionInput(); i.press('KeyP'); expect(i.current()).toBeNull(); });
test('chaque avatar a immobile et marche dans les 4 directions', () => {
  for (const k of DEV_AVATAR_KEYS) for (const d of DIRECTIONS) { expect(AVATARS[k].idle[d].length).toBeGreaterThan(0); expect(AVATARS[k].walk[d].length).toBeGreaterThan(1); }
});
```

```ts
// e2e/world.spec.ts
test('marcher à droite', /* x0 = self.x ; ArrowRight enfoncée 500 ms ; self.x - x0 > 40 */);
test('un mur arrête', /* depuis l'apparition, ArrowUp enfoncée 2 s ; self.y >= 192 (la ligne 5 est un mur en x = 2) */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/game/input.test.ts apps/client/src/game/avatars.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter `DirectionInput`, le registre `AVATARS` et `LocalPlayer`.**
- [ ] **Étape 4 : vérifier le succès.** Les tests unitaires et `pnpm e2e e2e/world.spec.ts` → PASS.
- [ ] **Étape 5 : commit et mise en ligne.** `git commit -am "feat(client): déplacement de l'avatar local" && git push`. Vérifier sur le domaine qu'on se promène dans la carte.

---

# Phase 3 : Multijoueur

### Tâche 12 : État du monde et validation des mouvements

**Fichiers :**
- Créer : `packages/shared/src/movement/validate-move.ts`, `apps/server/src/realtime/world.ts`, `apps/server/src/realtime/spawn.ts`
- Test : `packages/shared/test/validate-move.test.ts`, `apps/server/test/world.test.ts`, `apps/server/test/spawn.test.ts`

**Interfaces :**
- Consomme : `OfficeMap`, `isWalkablePoint`, `zoneAt`, les constantes de mouvement.
- Produit :

```ts
export type MoveRejection = 'out_of_bounds' | 'too_fast' | 'blocked';
export function validateMove(m: OfficeMap, from: { x: number; y: number; at: number }, to: { x: number; y: number; at: number }): { ok: true } | { ok: false; reason: MoveRejection };
export class World {                                          // ProximityPlayer vient de protocol.ts (tâche 1)
  constructor(map: OfficeMap, now: () => number);
  join(p: { id: string; name: string; avatarKey: string | null; x: number; y: number; dir: Direction; status: Status }): PublicPlayer;
  leave(id: string): PublicPlayer | undefined;
  get(id: string): PublicPlayer | undefined; list(): PublicPlayer[];
  applyMove(id: string, m: MovePayload): { ok: true } | { ok: false; correct: { x: number; y: number } };
  teleport(id: string, x: number, y: number): boolean;     // case praticable obligatoire
  setStatus(id: string, s: Status): void; rememberedStatus(id: string): Status;   // le statut survit à une déconnexion
  setMedia(id: string, m: MediaState): void; setProfile(id: string, p: { name: string; avatarKey: string | null }): void;
  drainMoves(): WorldTick['moves'];                          // dernier mouvement accepté par joueur depuis l'appel précédent
  proximityPlayers(): ProximityPlayer[];
}
export function chooseSpawn(m: OfficeMap, saved: { x: number; y: number } | null, busyZoneIds: ReadonlySet<string>): { x: number; y: number };
```

**Les règles de `validateMove` :**
- ordre des contrôles : `out_of_bounds`, puis `too_fast`, puis `blocked` ;
- `dt = to.at − from.at`, avec l'heure de réception côté serveur ;
- distance autorisée = `MAX_SPEED_PX_PER_S × (dt + MOVE_JITTER_MS) / 1000 × MOVE_TOLERANCE` ;
- le segment entier, échantillonné tous les `MOVE_SEGMENT_STEP_PX`, doit être praticable.

**La règle de `chooseSpawn` :**
- on garde `saved` s'il est praticable et qu'il n'est pas dans une zone listée dans `busyZoneIds` ;
- sinon, on prend `map.spawn`.

- [ ] **Étape 1 : écrire les tests qui échouent** (carte de développement)

```ts
test('80 px en 100 ms : accepté', () => expect(validateMove(map, { x: 80, y: 240, at: 0 }, { x: 160, y: 240, at: 100 })).toEqual({ ok: true }));
test('104 px en 100 ms : trop rapide', () => expect(validateMove(map, { x: 80, y: 240, at: 0 }, { x: 184, y: 240, at: 100 })).toEqual({ ok: false, reason: 'too_fast' }));
test('sur un bureau : bloqué', () => expect(validateMove(map, { x: 144, y: 272, at: 0 }, { x: 144, y: 304, at: 100 })).toEqual({ ok: false, reason: 'blocked' }));
test('à travers un mur : bloqué', () => expect(validateMove(map, { x: 48, y: 208, at: 0 }, { x: 48, y: 144, at: 300 })).toEqual({ ok: false, reason: 'blocked' }));
test('hors carte', () => expect(validateMove(map, { x: 80, y: 240, at: 0 }, { x: -10, y: 240, at: 100 }).ok).toBe(false));
```

```ts
test('applyMove accepté puis drainMoves une seule fois', /* drain → [{ id, x: 160, y: 240, dir: 'right', moving: true }] ; drain suivant → [] */);
test('deux mouvements → seul le dernier sort', /* … */);
test('mouvement refusé → correct = dernière position acceptée', /* { ok: false, correct: { x: 80, y: 240 } } */);
test('statut retenu après leave puis join', /* setStatus('dnd') ; leave ; rememberedStatus === 'dnd' */);
test.each([
  ['position enregistrée valide', { x: 400, y: 400 }, [], { x: 400, y: 400 }],
  ['dans la salle, salle occupée', { x: 336, y: 80 }, ['<id de la zone salle>'], { x: 80, y: 240 }],
  ['dans la salle, salle libre', { x: 336, y: 80 }, [], { x: 336, y: 80 }],
  ['aucune position', null, [], { x: 80, y: 240 }],
  ['position sur un mur', { x: 16, y: 16 }, [], { x: 80, y: 240 }],
])('chooseSpawn : %s', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run packages/shared/test/validate-move.test.ts apps/server/test/world.test.ts apps/server/test/spawn.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter `validateMove`, `World` et `chooseSpawn`.**
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat: état du monde et validation des mouvements"`

### Tâche 13 : Serveur temps réel : connexion, présence, reconnexion

**Fichiers :**
- Créer : `apps/server/src/realtime/io.ts`, `src/realtime/socket-auth.ts`, `src/realtime/presence.ts`, `src/realtime/positions.ts`, `src/rate-limit.ts`
- Modifier : `apps/server/src/index.ts`. Il charge la carte (`parseOfficeMap` sur `MAPS_DIR/MAP_KEY.json`), attache le temps réel, et appelle `stop()` sur `SIGTERM`.
- Test : `apps/server/test/realtime-presence.test.ts`, `apps/server/test/helpers/realtime.ts`

**Interfaces :**
- Consomme : `World`, `chooseSpawn`, `ServerEvents`, `createAuth`, les constantes.
- Produit :

```ts
export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export interface SocketData { userId: string; name: string; avatarKey: string | null; role: Role }
export interface RealtimeDeps { auth: Auth; db: Db; map: OfficeMap; mapKey: string; events: ServerEvents; env: Env; now?: () => number;
  graceMs?: number; tickMs?: number; groupsMs?: number; saveMs?: number; busyZones?: () => ReadonlySet<string> }
export function attachRealtime(server: http.Server, d: RealtimeDeps): { io: TypedServer; world: World; socketsOf(userId: string): string[]; stop(): Promise<void> }; // stop() enregistre toutes les positions
export function createRateLimiter(o: { max: number; windowMs: number; now?: () => number }): { take(key: string): boolean };
export function savePositions(db: Db, rows: Array<{ id: string; x: number; y: number; dir: Direction }>): Promise<void>;
export function loadPosition(db: Db, userId: string): Promise<{ x: number; y: number; dir: Direction } | null>;
// tests : startTestServer(o?) → { url, inviteAndLogin(email) → cookie, connect(cookie) → socket client typé, restart(), close() }
```

**Règles :**
- **Authentification :** `io.use` lit la session avec `auth.api.getSession({ headers: fromNodeHeaders(socket.request.headers) })`. Il refuse avec `Error('unauthorized')`, `Error('disabled')`, ou `Error('rate_limited')` (au-delà de `SOCKET_CONNECT_RATE` par utilisateur).
- **Récupération de connexion :** `connectionStateRecovery: { maxDisconnectionDuration: DISCONNECT_GRACE_MS, skipMiddlewares: false }`.
- **À la connexion :**
  - si l'utilisateur a déjà une socket, elle reçoit `session:replaced` puis `disconnect(true)`, sans retirer le joueur ;
  - si le joueur est encore dans le monde (délai de grâce), on annule le minuteur ;
  - sinon, `join` à `chooseSpawn(map, loadPosition, busyZones())` avec `rememberedStatus` ;
  - puis on envoie `init` à la socket, et `player:joined` aux autres s'il s'agit d'une vraie arrivée.
- **À la déconnexion :**
  - un minuteur de `graceMs` démarre ;
  - quand il expire : `leave`, `savePositions`, puis `player:left` à tous.
- **Positions :** `savePositions` toutes les `saveMs`.
- **`member:removed` :** déconnexion des sockets, `leave` immédiat, `player:left`.

- [ ] **Étape 1 : écrire les tests qui échouent** (`graceMs: 200`, `saveMs: 1000`)

```ts
test('sans cookie → connect_error unauthorized', /* … */);
test('arrivée : init puis player:joined chez les autres', /* A.init.self à (80, 240), players [] ; B.init.players contient A ; A reçoit player:joined(B) */);
test('2e onglet : le premier reçoit session:replaced, B ne voit aucun départ', /* … */);
test('coupure brève (< grâce) : pas de player:left, même position au retour', /* Point de vigilance 2 */);
test('coupure longue (> grâce) : player:left et position enregistrée', /* lastX et lastY en base */);
test('redémarrage du serveur : reconnexion automatique, position enregistrée restaurée', /* restart() ; A reçoit un nouvel init à sa dernière position ; Point de vigilance 3 */);
test('membre retiré : socket coupée, player:left immédiat', /* events.emit('member:removed', A) */);
test('11e connexion dans la minute → rate_limited', /* … */);
test('createRateLimiter : max par fenêtre, puis nouvelle fenêtre', /* horloge injectée */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/server/test/realtime-presence.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter l'authentification des sockets, la présence, les positions, le limiteur et l'attache dans `index.ts`.**
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(server): présence temps réel et reconnexion"`

### Tâche 14 : Serveur temps réel : mouvements, statuts, profils

**Fichiers :**
- Créer : `apps/server/src/realtime/handlers.ts`
- Modifier : `apps/server/src/realtime/io.ts` (boucle du `world:tick`, branchement de `profile:changed`)
- Test : `apps/server/test/realtime-world.test.ts`

**Interfaces :**
- Consomme : `World`, `moveSchema`, `statusSchema`, `mediaStateSchema`, `ServerEvents`.
- Produit :
  - `registerHandlers(io: TypedServer, socket, d: { world: World; env: Env })` ;
  - `startWorldTicks(io: TypedServer, world: World, tickMs: number): () => void`. Toutes les `tickMs`, si `drainMoves()` n'est pas vide, `io.to(OFFICE_ROOM).volatile.emit('world:tick', { t, moves })`.

**Règles :**
- `move` au-delà de `MOVE_RATE` pour une socket, ou invalide pour zod : ignoré. Refusé par `World` : `move:correct` à l'émetteur.
- `status:set` : `world.setStatus`, puis `status:changed` à tous.
- `media:state` : `media:changed` à tous.
- `profile:changed` venant de `ServerEvents` : `world.setProfile`, puis `profile:changed` à tous.
- `debug:teleport` n'est enregistré que si `E2E=1`. Il appelle `world.teleport` et met le joueur à l'arrêt.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('A bouge → B reçoit world:tick avec le mouvement de A en moins de 250 ms', /* … */);
test('mouvement trop rapide → move:correct à A, absent des ticks de B', /* … */);
test('charge utile invalide (x: 1.5) → ignorée, aucun tick, pas de plantage', /* … */);
test('rafale de 50 move en 100 ms → au plus 20 traités, le serveur répond toujours', /* compteur d'appels à applyMove */);
test('3 mouvements dans la même fenêtre → B ne reçoit que le dernier', /* … */);
test('statut dnd → status:changed chez B ; conservé après reconnexion', /* init.self.status === 'dnd' */);
test('PATCH /api/me { name } → profile:changed chez B', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/server/test/realtime-world.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter les gestionnaires et la boucle de tick.**
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(server): mouvements, statuts et profils en temps réel"`

### Tâche 15 : Client réseau : mouvements, avatars distants, interpolation

**Fichiers :**
- Créer : `apps/client/src/net/socket.ts`, `src/net/office-connection.ts`, `src/state/office-store.ts`, `src/game/move-sender.ts`, `src/game/snapshot-buffer.ts`, `src/game/objects/RemotePlayer.ts`, `src/game/objects/NameTag.ts`
- Modifier : `src/game/scenes/Office.ts` et `src/pages/OfficePage.tsx`
- Test : `apps/client/src/game/move-sender.test.ts`, `src/game/snapshot-buffer.test.ts`, `src/state/office-store.test.ts`, `e2e/multiplayer.spec.ts`

**Interfaces :**
- Consomme : `ServerToClientEvents`, `ClientToServerEvents`, `REMOTE_RENDER_DELAY_MS`, `TELEPORT_SNAP_PX`, `CLIENT_MOVE_MAX_HZ`, `EventBus`.
- Produit :

```ts
export function createOfficeSocket(): Socket<ServerToClientEvents, ClientToServerEvents>;   // même origine, withCredentials, autoConnect: false
export class MoveSender { constructor(maxHz?: number); next(now: number, s: MovePayload): MovePayload | null }
export interface Snapshot { x: number; y: number; dir: Direction; moving: boolean }
export class SnapshotBuffer { constructor(capacity?: number /* 20 */); push(at: number, s: Snapshot): void; sample(renderAt: number): Snapshot | null; snapToLatest(): void; size(): number }
export interface OfficeState { selfId: string | null; players: Record<string, PublicPlayer>; replaced: boolean;
  applyInit(p: InitPayload): void; upsertPlayer(p: PublicPlayer): void; removePlayer(id: string): void;
  setStatus(id: string, s: Status): void; setMedia(id: string, m: MediaState): void; setProfile(p: { id: string; name: string; avatarKey: string | null }): void; setReplaced(v: boolean): void }
export const useOfficeStore: UseBoundStore<StoreApi<OfficeState>>;
export function connectOffice(socket, store, bus): () => void;
// événements du bus : 'net:init' | 'net:tick' | 'net:joined' | 'net:left' | 'net:correct' | 'net:status' | 'net:profile' | 'local:move'
```

**Règles de `MoveSender` :**
- envoi immédiat si `dir` ou `moving` change ;
- sinon, envoi si `moving` est vrai, que la position a changé et que `1000 / maxHz` ms se sont écoulées ;
- jamais deux charges utiles identiques à la suite.

**Règles de `SnapshotBuffer` :**
- interpolation linéaire en `renderAt = now − REMOTE_RENDER_DELAY_MS` ;
- avant le premier instantané, on renvoie le premier ; après le dernier, le dernier (pas d'extrapolation) ; *remplacé à la tâche 15 : après le dernier, s'il marche, extrapolation à sa vitesse (plafonnée à `MAX_SPEED_PX_PER_S`) pendant `EXTRAPOLATION_MAX_MS` au plus, puis il attend ; arrêté, jamais ; bornée par la carte : sa zone de collision (`AVATAR_BODY`) n'entre jamais dans une case bloquante (`avatarBodyFits`)* ;
- un saut de plus de `TELEPORT_SNAP_PX` entre deux instantanés consécutifs fait sauter directement au second ;
- au plus `capacity` instantanés sont gardés.

**`NameTag` :** affiche le nom (20 caractères au plus, puis « … »), un point de statut (`available` #22c55e, `busy` #f59e0b, `away` #9ca3af, `dnd` #ef4444) et un anneau quand la personne parle.

**Retour sur l'onglet :** à `visibilitychange` vers `visible`, chaque `RemotePlayer` appelle `snapToLatest()`.

**Un deuxième `init`** (reconnexion ou redémarrage du serveur) remplace tous les joueurs et supprime les sprites orphelins.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('MoveSender', () => {
  const s = new MoveSender(10), m = (x: number, moving = true, dir: Direction = 'right') => ({ x, y: 0, dir, moving });
  expect(s.next(0, m(0))).toEqual(m(0));
  expect(s.next(50, m(5))).toBeNull();                       // < 100 ms
  expect(s.next(100, m(10))).toEqual(m(10));
  expect(s.next(120, m(12, true, 'up'))).toEqual(m(12, true, 'up'));     // changement de direction : immédiat
  expect(s.next(130, m(12, false, 'up'))).toEqual(m(12, false, 'up'));   // arrêt : immédiat
  expect(s.next(400, m(12, false, 'up'))).toBeNull();        // identique
});
test('SnapshotBuffer : interpolation, bornes, téléportation, capacité', () => {
  const b = new SnapshotBuffer(); const s = (x: number): Snapshot => ({ x, y: 0, dir: 'right', moving: true });
  b.push(0, s(0)); b.push(100, s(100));
  expect(b.sample(50)!.x).toBe(50); expect(b.sample(-10)!.x).toBe(0); expect(b.sample(500)!.x).toBe(100);
  b.snapToLatest(); expect(b.sample(50)!.x).toBe(100);       // retour sur l'onglet
  const t = new SnapshotBuffer(); t.push(0, s(0)); t.push(100, s(200)); expect(t.sample(50)!.x).toBe(200);
  const c = new SnapshotBuffer(20); for (let i = 0; i < 1000; i++) c.push(i * 100, s(i)); expect(c.size()).toBeLessThanOrEqual(20); // Point de vigilance 4
});
test('deuxième init : joueurs remplacés', /* applyInit({ players: [A, B] }) puis applyInit({ players: [A] }) → keys === [A] */);
```

```ts
// e2e/multiplayer.spec.ts : deux contextes de navigateur A et B
test('B voit A bouger', /* A : ArrowRight 600 ms ; dans la seconde, B.__office.players[A].x a augmenté de plus de 40 */);
test('A recharge la page : B voit toujours un seul A', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/game/move-sender.test.ts apps/client/src/game/snapshot-buffer.test.ts apps/client/src/state/office-store.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter.** `OfficePage` crée la socket, appelle `connectOffice`, puis `socket.connect()`. Sur `connect_error` avec `unauthorized`, elle redirige vers `/connexion`.
- [ ] **Étape 4 : vérifier le succès.** Les tests unitaires et `pnpm e2e e2e/multiplayer.spec.ts` → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(client): multijoueur, avatars distants et interpolation"`

### Tâche 16 : Présence dans l'interface

**Fichiers :**
- Créer : `apps/client/src/office/OfficeShell.tsx` (canevas, emplacement des vignettes en haut, barre en bas, panneaux à droite), `StatusMenu.tsx`, `PeoplePanel.tsx`, `ReplacedScreen.tsx`
- Test : `apps/client/src/office/people.test.ts`, `StatusMenu.test.tsx`, `e2e/presence.spec.ts`

**Interfaces :**
- Consomme : `useOfficeStore`, `GET /api/members`, la socket.
- Produit : `sortPeople(members: Array<{ id: string; name: string }>, online: ReadonlySet<string>): { online: typeof members; offline: typeof members }`. Chaque liste est triée par nom (`localeCompare` en français).

`ReplacedScreen` affiche `fr.office.replaced`, avec le bouton « Utiliser ici », qui reconnecte la socket.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('sortPeople : en ligne d\'abord, puis ordre alphabétique', /* … */);
test('StatusMenu : « Ne pas déranger » envoie status:set dnd', /* socket simulée */);
```

```ts
test('A passe en Ne pas déranger → B voit le point rouge', /* panneau Personnes de B : [data-user=A][data-status=dnd] */);
test('deuxième onglet de A → le premier affiche l\'écran « Ouvert dans un autre onglet »', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/office` → FAIL.
- [ ] **Étape 3 : implémenter les composants.**
- [ ] **Étape 4 : vérifier le succès.** Les tests unitaires et `pnpm e2e e2e/presence.spec.ts` → PASS.
- [ ] **Étape 5 : commit et mise en ligne.** `git commit -am "feat(client): statuts et panneau Personnes" && git push`

---

# Phase 4 : Audio/vidéo

### Tâche 17 : Calcul des groupes

**Fichiers :**
- Créer : `packages/shared/src/proximity/compute-groups.ts`
- Test : `packages/shared/test/compute-groups.test.ts`

**Interfaces :**
- Consomme : `OfficeMap`, `zoneAt`, `ProximityPlayer`, `JOIN_DISTANCE_PX`, `LEAVE_DISTANCE_PX`, `GROUP_DEBOUNCE_MS`.
- Produit :

```ts
export interface Group { id: string; members: string[]; zoneId: string | null }
export interface GroupingState { assignment: Record<string, string | null>; groups: Record<string, Group>;
  pending: Record<string, { target: string | null; since: number }>; nextId: number }
export const EMPTY_GROUPING: GroupingState;
export function computeGroups(players: ProximityPlayer[], map: OfficeMap, prev: GroupingState, now: number): GroupingState;
export function busyZoneIds(s: GroupingState): Set<string>;   // zones dont un groupe a au moins 2 membres
```

**Algorithme**, que ni la signature ni les tests ne déterminent à eux seuls :

```
1. éligibles = joueurs sans statut dnd ; zoneOf(p) = zoneAt(map, p.x, p.y)?.id ?? null
2. grappes :
   - une par zone comptant au moins 2 éligibles (zoneId = la zone)
   - espaces ouverts (zoneOf null) : arête a–b si
       déjà ensemble (prev.assignment[a] === prev.assignment[b] ≠ null) ET d ≤ LEAVE_DISTANCE_PX,
       ou pas ensemble ET d < JOIN_DISTANCE_PX ET !a.moving ET !b.moving
     chaque composante connexe d'au moins 2 personnes est une grappe (zoneId null)
3. identifiants : traiter les grappes de la plus grande à la plus petite (à égalité : plus petit id de membre)
   id = l'id de groupe actuel le plus fréquent parmi les membres et pas encore pris ;
        sinon la cible en attente la plus fréquente, pas encore prise ;
        sinon `g${nextId++}`  (à égalité : ordre lexicographique)
   voulu[m] = id pour chaque membre ; voulu = null pour les autres
4. délai, pour chaque joueur présent :
   actuel = prev.assignment[p] ?? null
   immédiat = voulu === null ET (p est dnd OU (actuel est un groupe de zone ET zoneOf(p) ≠ sa zone))
   voulu === actuel                       → on garde, rien en attente
   immédiat                               → null tout de suite
   même cible en attente depuis ≥ délai   → appliquer voulu
   sinon                                  → garder actuel ; attente = { cible: voulu, depuis: même cible ? ancien depuis : now }
5. groupes = inversion de l'affectation. Un groupe d'un seul membre, sans personne en attente vers lui,
   est dissous tout de suite (son membre passe à null). Les joueurs absents de la liste disparaissent.
```

- [ ] **Étape 1 : écrire les tests qui échouent.** Carte de développement ; `at(tx, ty)` donne le centre de la case en pixels ; `run(players, s, t)` appelle `computeGroups`.

```ts
test('deux personnes arrêtées à 2 cases : groupe après 500 ms, pas avant', /* t = 0 et 250 : null ; t = 500 : même id */);
test('en marchant : jamais de groupe', /* A en mouvement, jusqu'à t = 1000 */);
test('hystérésis', /* groupés à 64 px ; B à +112 px : toujours groupés à t + 1000 ; B à +144 px : groupés à +250, séparés à +500 */);
test('chaîne', /* A at(13,7), B at(15,7), C at(17,7) : un seul groupe de 3 */);
test('salle privée', /* A at(9,2), B at(12,3) groupés ; C at(10,6), à 2 cases de la porte, n'est pas avec eux */);
test('allée à côté d\'un bureau : pas de groupe ; entrer dans l\'espace de bureau : groupe', /* A at(6,11) bureau 1, C at(7,11) allée → null ; B at(4,11) → A et B groupés */);
test('Ne pas déranger', /* jamais groupé ; si le groupe était à deux, l'autre passe à null dans le même appel */);
test('sortir de la salle privée coupe tout de suite', /* A passe de at(9,2) à at(10,6) → null dans le même appel */);
test('fusion : le plus grand groupe garde son id', /* {A,B,C} en ligne 7 et {D,E} en at(13,14), at(15,14) ; D, E vont en at(19,7), at(21,7) → les 5 ont l'id de {A,B,C} */);
test('séparation : la plus grande partie garde son id', /* chaîne A–D ; D part en at(21,14) → A, B, C gardent l'id ; D null */);
test('id stable pendant l\'attente', /* pending[A].target identique à t = 0 et 250 ; l'id final à t = 500 est cette cible */);
test('joueur parti', /* B retiré de la liste → absent de assignment ; A seul → null */);
test('seul dans une zone : pas de groupe', /* … */);
test('busyZoneIds', /* deux personnes groupées dans la salle → contient l'id de la salle */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run packages/shared/test/compute-groups.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter `computeGroups` et `busyZoneIds`** selon l'algorithme.
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(shared): calcul des groupes de conversation"`

### Tâche 18 : Coordination LiveKit côté serveur

**Fichiers :**
- Créer : `apps/server/src/media/livekit.ts`, `src/media/media-coordinator.ts`
- Modifier : `apps/server/src/realtime/io.ts`
  - boucle des groupes toutes les `GROUPS_TICK_MS` ;
  - `busyZones` vient de `busyZoneIds(state)` ;
  - à chaque connexion, `media:join` est renvoyé si l'utilisateur est dans un groupe.
- Test : `apps/server/test/media-coordinator.test.ts`, `apps/server/test/realtime-media.test.ts`

**Interfaces :**
- Consomme : `computeGroups`, `GroupingState`, `World.proximityPlayers`, `LIVEKIT_TOKEN_TTL_S`, `MediaJoinPayload`.
- Produit :

```ts
export interface MediaBackend { url: string; mintToken(i: { room: string; identity: string; name: string }): Promise<string>; removeParticipant(room: string, identity: string): Promise<void> }
export function createLiveKitBackend(env: Env): MediaBackend | null;   // null si les variables LIVEKIT_* sont absentes (audio/vidéo désactivé, avertissement dans les journaux)
export class MediaCoordinator {
  constructor(backend: MediaBackend | null, bootId: string);           // bootId : 6 caractères aléatoires, tirés au démarrage
  roomFor(groupId: string): string;                                    // `${bootId}-${groupId}`
  apply(prev: GroupingState, next: GroupingState, send: (userId: string, e: { type: 'join'; p: MediaJoinPayload } | { type: 'leave' }) => void, nameOf: (id: string) => string): Promise<void>;
  currentJoin(userId: string): Promise<MediaJoinPayload | null>;
  groupMembersOf(userId: string): string[];                            // [] si la personne est hors groupe
}
```

**Règles :**
- **Jeton :** grants `{ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false }`, durée `LIVEKIT_TOKEN_TTL_S`, `identity = userId`, `name` = nom affiché.
- **Changement de groupe :** quand l'affectation d'une personne change, un `leave` (si elle avait un groupe) est suivi d'un `join` (si elle en a un nouveau).
- **Sortie d'un groupe :** appel à `removeParticipant(ancienne room, userId)`, en ignorant l'erreur « introuvable ».

- [ ] **Étape 1 : écrire les tests qui échouent** (faux backend qui enregistre ses appels)

```ts
test('nouveau groupe {A,B} : chacun reçoit join avec la room du groupe', /* room === `${boot}-g1` ; url === backend.url */);
test('C rejoint un groupe existant : seul C reçoit join', /* … */);
test('A quitte : leave pour A et removeParticipant(room, A)', /* … */);
test('fusion : seuls ceux qui changent de room reçoivent leave puis join', /* … */);
test('vrai jeton livekit-server-sdk : room et durée', /* TokenVerifier → video.room === room ; exp − iat ≤ 600 */);
```

```ts
// realtime-media.test.ts : LIVEKIT_* de test et faux backend injecté
test('deux personnes téléportées côte à côte et arrêtées : media:join pour les deux en moins d\'1 s', /* … */);
test('reconnexion pendant le délai de grâce : media:join renvoyé avec la même room', /* Point de vigilance 2 */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/server/test/media-coordinator.test.ts apps/server/test/realtime-media.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter le backend, le coordinateur et la boucle.** La boucle calcule `next = computeGroups(world.proximityPlayers(), map, state, now)`, appelle `apply`, puis `state = next`.
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(server): rooms LiveKit par groupe de conversation"`

### Tâche 19 : Client média (LiveKit) et préférences

**Fichiers :**
- Créer : `apps/client/src/media/media-client.ts` (l'interface), `livekit-media-client.ts`, `fake-media-client.ts`, `prefs.ts`, `use-media.ts`
- Test : `apps/client/src/media/prefs.test.ts`, `use-media.test.tsx`

**Interfaces :**
- Consomme : `MediaJoinPayload`, `MediaState`, la socket.
- Produit :

```ts
export interface MediaParticipant { id: string; name: string; isLocal: boolean; mic: boolean; cam: boolean; screen: boolean; speaking: boolean }
export interface MediaSnapshot { room: string | null; participants: MediaParticipant[]; local: MediaState; error: 'permission_denied' | 'connection_failed' | null }
export interface MediaPrefs { audioInput?: string; videoInput?: string; audioOutput?: string; mic: boolean; cam: boolean }
export interface MediaClient {
  join(p: MediaJoinPayload): Promise<void>;          // déjà dans une room : leave() d'abord, dans l'ordre
  leave(): Promise<void>;
  setMic(on: boolean): Promise<void>; setCam(on: boolean): Promise<void>; setScreenShare(on: boolean): Promise<void>;
  setPrefs(p: MediaPrefs): Promise<void>;
  attach(el: HTMLVideoElement, participantId: string, source: 'camera' | 'screen'): () => void;
  subscribe(cb: (s: MediaSnapshot) => void): () => void;
}
export function createLiveKitMediaClient(prefs: MediaPrefs): MediaClient;
export function loadPrefs(): MediaPrefs;   // clé localStorage 'bureau.media.v1' ; défaut { mic: true, cam: true } ; lecture et écriture dans un try/catch
export function savePrefs(p: MediaPrefs): void;
export function useMedia(client: MediaClient, socket): MediaSnapshot;  // relie media:join et media:leave, et envoie media:state quand l'état local change
```

**Côté LiveKit :**
- `Room` avec `adaptiveStream` et `dynacast` ;
- l'audio distant est attaché à des éléments `<audio>` cachés ;
- `ActiveSpeakersChanged` met à jour `speaking` ;
- si l'accès au micro ou à la caméra est refusé, on rejoint quand même la room, en réception seule, avec `error: 'permission_denied'`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('préférences : valeurs par défaut, et stockage corrompu → valeurs par défaut', /* localStorage 'bureau.media.v1' = '{' → { mic: true, cam: true } */);
test('media:join → client.join(payload)', /* FakeMediaClient */);
test('deuxième media:join → leave puis join, dans cet ordre', /* journal du faux : ['join:r1', 'leave', 'join:r2'] */);
test('media:leave → client.leave()', /* … */);
test('couper le micro envoie media:state { mic: false, cam: true, screen: false }', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/media` → FAIL.
- [ ] **Étape 3 : implémenter l'interface, le client LiveKit, le faux client, les préférences et le hook.**
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(client): client média LiveKit"`

### Tâche 20 : Écran d'entrée, vignettes, barre de commandes, partage d'écran

**Fichiers :**
- Créer : `apps/client/src/office/DeviceCheck.tsx`, `VideoStrip.tsx`, `ControlBar.tsx`
- Modifier : `OfficePage.tsx` (états `precheck` puis `inside`), `NameTag.ts` (anneau de parole, via l'événement de bus `media:speaking`), `e2e/helpers.ts` (`inviteAndJoin` clique sur « Entrer »)
- Test : `apps/client/src/office/VideoStrip.test.tsx`, `ControlBar.test.tsx`, `e2e/media.spec.ts`

**Interfaces :**
- Consomme : `MediaClient`, `useMedia`, `loadPrefs` et `savePrefs`, `StatusMenu`.
- Produit :
  - `DeviceCheck({ onEnter(prefs: MediaPrefs): void })` : aperçu de la caméra, niveau du micro, choix des périphériques. Le clic sur « Entrer » sert de geste utilisateur et débloque l'audio.
  - `VideoStrip({ snapshot, client })` : vignettes en haut, la sienne en premier, avec nom et état du micro. Un clic agrandit une vignette ; un partage d'écran s'affiche en grand.
  - `ControlBar` : micro, caméra, partage d'écran, statut, chat, personnes (et admin pour les admins).

**Refus d'accès :** si le micro ou la caméra sont refusés, `DeviceCheck` affiche `fr.media.permissionDenied` (« Sans micro ni caméra, tu pourras quand même écouter et écrire. ») et le bouton « Entrer quand même ».

- [ ] **Étape 1 : écrire les tests qui échouent**

```tsx
test('VideoStrip : une vignette par participant, la sienne d\'abord ; partage d\'écran affiché en grand', /* … */);
test('ControlBar : les boutons appellent setMic, setCam et setScreenShare', /* FakeMediaClient */);
```

```ts
// e2e/media.spec.ts : nécessite un serveur LiveKit (local `livekit-server --dev`, ou le projet Cloud) ; ignoré si E2E_LIVEKIT_URL est absente
// Chromium : --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
test('rapprochés et arrêtés → 2 vignettes et une vidéo distante qui joue en moins de 3 s', /* teleport at(14,7) et at(15,7) ; video.readyState ≥ 2 */);
test('B s\'éloigne → plus de vignettes en moins de 2 s', /* B téléporté en at(20,13) */);
test('salle de réunion privée', /* A at(9,2), B at(12,3) : 2 vignettes chacun ; C at(10,6) : 0 */);
test('micro et caméra refusés : on entre, on bouge, on reçoit', /* contexte sans faux périphériques, permissions refusées ; « Entrer quand même » ; à côté de A → 1 vignette distante (A) ; Point de vigilance 1 */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/office` → FAIL.
- [ ] **Étape 3 : implémenter les trois composants et l'état `precheck` de `OfficePage`.**
- [ ] **Étape 4 : vérifier le succès.** Les tests unitaires, puis les tests e2e audio/vidéo contre un serveur LiveKit → PASS :
  - en local : `livekit-server --dev` (installé par `brew install livekit` ; clé `devkey`, secret `secret`), puis `E2E_LIVEKIT_URL=ws://localhost:7880 E2E_LIVEKIT_API_KEY=devkey E2E_LIVEKIT_API_SECRET=secret pnpm e2e e2e/media.spec.ts` ;
  - ou avec le projet LiveKit Cloud : mêmes variables avec ses URL et clés.
- [ ] **Étape 5 : 👤 créer le projet LiveKit Cloud** et ajouter `LIVEKIT_URL`, `LIVEKIT_API_KEY` et `LIVEKIT_API_SECRET` sur Railway.
- [ ] **Étape 6 : commit et mise en ligne.** `git commit -am "feat(client): audio/vidéo de proximité et partage d'écran" && git push`. Test réel à deux, sur deux ordinateurs.

---

# Phase 5 : Chat

### Tâche 21 : Chat côté serveur

**Fichiers :**
- Créer : `apps/server/src/chat/chat-service.ts`
- Modifier : `apps/server/src/realtime/handlers.ts` (`chat:send`), `presence.ts` (`init.chatHistory`)
- Test : `apps/server/test/chat.test.ts`

**Interfaces :**
- Consomme : `chatSendSchema`, `CHAT_RATE`, `CHAT_HISTORY_LIMIT`, `createRateLimiter`, `MediaCoordinator.groupMembersOf`.
- Produit :
  - `createChatService(db: Db, now?: () => Date): { post(userId: string, text: string): Promise<ChatMessage>; recent(limit?: number): Promise<ChatMessage[]> }`. `post` vaut pour le canal `all`. `recent` renvoie les messages du plus ancien au plus récent, avec le nom de l'auteur.

**Règles de `chat:send` (avec accusé de réception) :**
1. charge utile invalide → `{ ok: false, error: 'invalid' }` ;
2. débit dépassé → `rate_limited` ;
3. canal `all` : enregistrer, envoyer à tous, `{ ok: true }` ;
4. canal `nearby` : si `groupMembersOf` est vide → `no_group` ; sinon, envoyer aux membres du groupe (émetteur compris), sans rien enregistrer. L'`id` est un uuid généré.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('recent : les 200 derniers, du plus ancien au plus récent', /* 205 messages insérés → longueur 200, premier = le 6e */);
test('all : B reçoit, accusé ok, présent dans le init suivant', /* … */);
test('6 messages en 5 s → le 6e est refusé (rate_limited)', /* … */);
test('nearby sans groupe → no_group', /* … */);
test('nearby dans {A,B} : B reçoit, C non, rien en base', /* … */);
test('501 caractères → invalid', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/server/test/chat.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter le service et le gestionnaire.**
- [ ] **Étape 4 : vérifier le succès.** Même commande → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat(server): chat Tout le monde et À proximité"`

### Tâche 22 : Chat dans l'interface

**Fichiers :**
- Créer : `apps/client/src/office/ChatPanel.tsx`, `apps/client/src/office/linkify.tsx`
- Modifier : `office-store.ts` (messages), `office-connection.ts` (`chat:message`, `init.chatHistory`)
- Test : `apps/client/src/office/linkify.test.tsx`, `ChatPanel.test.tsx`, `e2e/chat.spec.ts`

**Interfaces :**
- Consomme : `ChatMessage`, `ChatAck`, `MediaSnapshot.room`.
- Produit : `linkify(text: string): ReactNode[]`. Seuls `http:` et `https:` deviennent des liens, avec `target="_blank" rel="noopener noreferrer"`.

**`ChatPanel` :**
- deux onglets, « Tout le monde » et « À proximité » ; le second est désactivé quand `room` vaut null ;
- Entrée envoie le message ;
- un accusé `rate_limited` affiche `fr.chat.rateLimited`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```tsx
test('linkify', /* 'voir https://a.fr ok' → un <a href="https://a.fr"> ; 'javascript:alert(1)' → texte ; '<b>x</b>' → texte, aucun élément <b> */);
test('onglet À proximité désactivé sans room', /* … */);
```

```ts
test('A écrit à tout le monde → B le voit ; B recharge → toujours là', /* … */);
test('taper « zqsd » dans le chat ne déplace pas l\'avatar', /* self.x et self.y inchangés */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/office/linkify.test.tsx apps/client/src/office/ChatPanel.test.tsx` → FAIL.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : vérifier le succès.** Les tests unitaires et `pnpm e2e e2e/chat.spec.ts` → PASS.
- [ ] **Étape 5 : commit et mise en ligne.** `git commit -am "feat(client): chat" && git push`

---

# Phase 6 : Finitions

### Tâche 23 : Assets LimeZu, galerie d'avatars et réglages du compte

**👤 Avant de commencer :**
- acheter les packs LimeZu ;
- exporter 12 à 16 personnages en 32 px avec le Character Generator ;
- les déposer dans `apps/client/public/assets/limezu/characters/avatar-01.png`, et ainsi de suite ;
- fournir les archives des packs.

**Fichiers :**
- Créer : `apps/client/public/assets/limezu/**` (versionné : le dépôt est privé), `apps/client/src/pages/AvatarPage.tsx` (`/bienvenue`), `apps/client/src/RequireAvatar.tsx`, `apps/client/src/office/SettingsPanel.tsx`
- Modifier :
  - `packages/shared/src/avatars.ts` (`GALLERY_AVATAR_KEYS = ['avatar-01', …]`) ;
  - `apps/client/src/game/avatars.ts` (entrées LimeZu) ;
  - `ControlBar.tsx` (bouton « Réglages ») ;
  - `e2e/helpers.ts` (`inviteAndJoin` choisit le premier avatar de la galerie).
- Test : `apps/client/src/game/avatars.test.ts` (complété), `apps/client/src/office/SettingsPanel.test.tsx`, `e2e/avatar.spec.ts`

**Interfaces :**
- Consomme : `AvatarSpec`, `PATCH /api/me`, `GALLERY_AVATAR_KEYS`.
- Produit :
  - des entrées `AVATARS['avatar-NN']`. La taille des images et les lignes de chaque animation se lisent dans les fichiers exportés ; décrire la disposition trouvée en commentaire en tête de `avatars.ts` ;
  - `RequireAvatar` : si `session.user.avatarKey` vaut null, redirection vers `/bienvenue`.

**`AvatarPage` :** une grille d'aperçus (première image de chaque avatar en CSS `background-position`). Un clic appelle `PATCH /api/me { avatarKey }`, puis renvoie vers `/`.

**`SettingsPanel` (spec §6.4) :**
- nom affiché, via `PATCH /api/me { name }` ;
- avatar, via un lien vers `/bienvenue` ;
- mot de passe, via `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: false })` ;
- déconnexion.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('chaque avatar de la galerie : fichier présent, immobile et marche dans 4 directions', /* fs.existsSync(public + spec.url) */);
test('SettingsPanel : nouveau mot de passe de 9 caractères refusé avant envoi ; nom envoyé par PATCH /api/me', /* api simulée */);
```

```ts
test('nouveau membre → /bienvenue → choisit avatar-03 → bureau ; B voit avatarKey avatar-03', /* … */);
test('A change son nom dans les réglages → B voit le nouveau nom', /* panneau Personnes de B */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/game/avatars.test.ts apps/client/src/office/SettingsPanel.test.tsx` → FAIL.
- [ ] **Étape 3 : implémenter le registre, la page, la redirection et les réglages.**
- [ ] **Étape 4 : vérifier le succès.** Les tests unitaires et `pnpm e2e e2e/avatar.spec.ts` → PASS.
- [ ] **Étape 5 : commit.** `git commit -am "feat: avatars LimeZu, galerie et réglages du compte"`

### Tâche 24 : Carte définitive et crédits

**👤 La carte, à dessiner dans Tiled :**
- **Fichier :** `apps/client/public/assets/maps/office.json`, avec les tilesets LimeZu en 32 px, intégrés (Embed Tileset), et des calques en CSV.
- **Calques**, dans l'ordre : `sol`, `murs`, `meubles-bas`, `objets` (calque d'objets-tuiles), `dessus`, `collisions` (n'importe quelle tuile = case bloquante), `zones`.
- **Zones** (rectangles avec une classe) : un `spawn` près de l'entrée ; un `private` nommé par salle de réunion ; un `desk` d'environ 3 × 3 cases autour de chaque chaise de bureau ; des `label` avec la propriété `text`.
- **Contenu** (spec §5.2) : open space avec îlots, salle de réunion, coin détente, coin café, décor ; environ 40 × 30 cases.
- **Vérification :** `pnpm --filter @bureau/server map:check ../client/public/assets/maps/office.json` → code de sortie 0.

**Fichiers :**
- Créer : `apps/client/src/office/CreditsDialog.tsx` et `apps/client/public/fonts/PixelifySans.woff2` avec `OFL.txt`
- Modifier :
  - `map-layers.ts` : le calque `objets` devient des images avec `setOrigin(0, 1)` et une profondeur égale à `objectDepth(obj)` ;
  - `NameTag.ts` : police Pixelify Sans, chargée avec `FontFace` avant la création des textes ;
  - `ControlBar.tsx` : mention « Graphismes : LimeZu », qui ouvre les crédits.
- Test : `apps/client/src/game/map-layers.test.ts`, `e2e/office-map.spec.ts`

**Interfaces :**
- Produit : `objectDepth(o: { y: number }): number`, qui renvoie `o.y` (dans Tiled, l'origine d'un objet-tuile est en bas à gauche).

**`CreditsDialog` :** « Graphismes : LimeZu », avec un lien vers https://limezu.itch.io/, et « Police : Pixelify Sans (SIL Open Font License) ».

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
test('objectDepth = bas de l\'objet', () => expect(objectDepth({ y: 320 })).toBe(320));
```

```ts
// e2e/office-map.spec.ts, avec MAP_KEY=office
test('apparition praticable, on marche, crédits avec le lien LimeZu', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/game/map-layers.test.ts` → FAIL.
- [ ] **Étape 3 : implémenter le calque `objets`, la police et les crédits.**
- [ ] **Étape 4 : vérifier le succès.** Le test unitaire, `map:check` sur `office.json`, puis `MAP_KEY=office pnpm e2e e2e/office-map.spec.ts` → PASS. Mettre `MAP_KEY=office` sur Railway.
- [ ] **Étape 5 : commit.** `git commit -am "feat: carte définitive et crédits"`

### Tâche 25 : Panneau admin

**Fichiers :**
- Créer : `apps/client/src/office/AdminPanel.tsx`
- Test : `apps/client/src/office/AdminPanel.test.tsx`, `e2e/admin.spec.ts`

**Interfaces :**
- Consomme : les routes `/api/admin/*` de la tâche 6, `api()`.
- Produit : `AdminPanel`, affiché seulement si `session.user.role === 'admin'`. Il a trois sections :
  - **Inviter :** e-mail et rôle ;
  - **Invitations en attente :** renvoyer, annuler ;
  - **Membres :** retirer, avec une confirmation.

  Les erreurs 409 et 400 s'affichent avec `fr.admin.errors.*`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```tsx
test('invitation : POST puis rafraîchissement de la liste ; 409 already_invited affiché', /* api simulée */);
test('retrait d\'un membre : confirmation obligatoire', /* … */);
```

```ts
test('l\'admin invite → le lien d\'e-mail de test → le nouveau membre entre et apparaît dans la liste', /* … */);
test('l\'admin retire un membre → la page du membre est déconnectée ; après rechargement → /connexion', /* … */);
```

- [ ] **Étape 2 : vérifier l'échec.** `pnpm vitest run apps/client/src/office/AdminPanel.test.tsx` → FAIL.
- [ ] **Étape 3 : implémenter le panneau.**
- [ ] **Étape 4 : vérifier le succès.** Le test unitaire et `pnpm e2e e2e/admin.spec.ts` → PASS.
- [ ] **Étape 5 : commit et mise en ligne.** `git commit -am "feat(client): panneau admin" && git push`

### Tâche 26 : Lancement

**Fichiers :**
- Modifier : `README.md` (section « Exploitation » : inviter, retirer, suivre la consommation LiveKit, déployer)

- [ ] **Étape 1 : vérifications automatiques.** `pnpm test && pnpm typecheck && pnpm e2e` → tout passe, y compris `media.spec.ts` (LiveKit local ou Cloud).
- [ ] **Étape 2 : 👤 vérifier la production.**
  - Railway : `LIVEKIT_*`, `MAP_KEY=office` et `MAILER=resend` sont en place ;
  - un e-mail d'invitation réel arrive dans la boîte de réception, pas dans les spams.
- [ ] **Étape 3 : 👤 tester à plusieurs, en vrai.** Deux personnes, puis trois, sur Chrome, Firefox et Safari, dont une sur le partage de connexion d'un téléphone.
  - [ ] la conversation démarre en s'arrêtant à côté de quelqu'un ;
  - [ ] passer dans une allée ne connecte personne ;
  - [ ] la salle de réunion est privée ;
  - [ ] le partage d'écran fonctionne ;
  - [ ] après un redéploiement, tout le monde revient seul ;
  - [ ] le statut Ne pas déranger est respecté ;
  - [ ] l'avatar passe devant et derrière les meubles ;
  - [ ] fluidité : environ 60 images par seconde pendant une visio, mesurées avec l'onglet Performance du navigateur sur un portable milieu de gamme (spec §14).
- [ ] **Étape 4 : 👤 envoyer les invitations** à l'équipe depuis le panneau admin, et poser à LimeZu la question de la licence par personne.
- [ ] **Étape 5 : suivi après une semaine.** Consulter les minutes consommées dans le tableau de bord LiveKit Cloud. Si on approche des 5 000 minutes, passer à l'offre Ship, comme décidé dans la spec.
- [ ] **Étape 6 : commit.** `git commit -am "docs: exploitation" && git push`
