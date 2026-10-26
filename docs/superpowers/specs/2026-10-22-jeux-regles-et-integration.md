# Jeux du bureau : règles, contrat et intégration

> **Tâche G1** du plan [`2026-10-22-bureau-pieces-modes-jeux.md`](../plans/2026-10-22-bureau-pieces-modes-jeux.md). Quatre lecteurs : G2 (la plateforme, dans la session principale), les agents G3 à G6 (un jeu chacun, sans pouvoir poser de question) et G7 (l'intégration). Chaque agent lit les « Décisions », les parties communes (§ 1 à § 12), puis la partie de son jeu (§ 13 à § 16). Les extraits TypeScript sont des contrats à recopier : ils ne sont pas dans le dépôt.
>
> **Ce qui fait foi.** Pour les règles des jeux : ce document. Pour l'API de la plateforme : le code de G2 une fois fusionné. Si ce code diffère d'un extrait d'ici, l'agent suit le code et le dit dans son rapport.
>
> **Sources.** Chaque règle porte sa source entre crochets (liste au § 17), ou la mention « choix de variante ». Les positions et séquences citées pour les quatre jeux ont été vérifiées par des scripts tenus hors du dépôt (§ 19).

## Décisions à valider par Andrea

1. **Petits chevaux, variante « bureau » proche du Ludo** (§ 16) : 4 chevaux, sortie sur un 6, un 6 fait rejouer, le 3e 6 de suite est perdu, 3 lancers pour sortir quand aucun cheval n'est en piste, prise en tombant juste, pas de case protégée, jamais deux chevaux d'une couleur sur une case (donc pas de barrage), arrivée au compte exact, fin au premier joueur arrivé (les autres classés à l'avancée), à 2 joueurs couleurs opposées.
2. **Backgammon standard, sans videau** (§ 14) ; gammon et backgammon affichés mais comptés victoire simple. Un tour = « Lancer » puis le tour entier envoyé d'un bloc.
3. **`chess.js` 1.4.0 recommandé** (§ 13.0) : licence BSD-2 (et non MIT comme l'écrit le plan), 11,7 ko gzip, aucune dépendance. Sans ton oui : règles écrites à la main, prouvées par perft. Le contrat accepte les deux.
4. **Échecs** : nulle automatique à la 3e répétition et aux 50 coups (pas de bouton « réclamer »), matériel insuffisant limité aux cas classiques, nulle proposée seulement après un coup de chaque camp, pas de pendule, abandon = défaite même face à un roi seul.
5. **Qui commence** : tiré au sort à la première partie d'une table, puis alternance à chaque revanche (aux échecs les couleurs s'échangent ; au backgammon le lancer d'ouverture décide, comme dans la règle).
6. **Plateforme** : un seul événement `game:do` (comme `desk:do`) ; la table entière est diffusée à tout le bureau à chaque changement (rien n'est caché dans ces quatre jeux) ; dés tirés avec `crypto`, côté serveur.
7. **Invitations refusées** en « Ne pas déranger » et dans un mode qui ferme la porte ou téléporte (Concentration, Sport).
8. **Délais** : 5 min par coup, 90 s pour revenir, 60 s pour répondre à une invitation ; **ajout** : une chaise occupée sans partie se libère au bout de 10 min.
9. **Classement** : la règle « moins de 2 coups » compte les coups du jeu (un lancer de dés n'en est pas un) ; note entière, arrondie une fois par partie.
10. **Redémarrage du serveur** : les parties en cours sont perdues (v1), rien n'est écrit ; le client affiche « Partie interrompue ».
11. **Plan G2 corrigé** (§ 2.3) : `create` reçoit `{ seats, first }` et non des identifiants ; ajout de `forfeit`, `countedMoves`, `invariants` ; l'e2e « partie jusqu'au bout + classement » passe de G2 (le morpion n'a pas d'interface) à G5 et G7.
12. **10 000 parties au hasard par jeu** avec `JEUX_FUZZ=10000` (commande à part) ; `pnpm test` en joue quelques centaines, pour rester rapide.
13. **Panneau des jeux de 440 px** ; sur téléphone, la feuille du bas (311 px utiles sur un écran de 375 px).

---

## 1. Lire ce document

### 1.1 Les mots

| Mot | Sens |
|---|---|
| table | une des quatre tables de la salle de jeu, une par jeu : la zone `game` de la carte, dont le nom est l'identifiant du jeu (T6) |
| chaise | une zone `seat` de la carte (`chess:1`, `ludo:4`…) ; dans les messages, `chairs[n − 1]` |
| siège | la place d'un joueur dans une partie : 0 à n − 1, les chaises occupées prises dans l'ordre des chaises, figées au début de la partie |
| coup | ce qu'un joueur envoie (`move`) ; un lancer de dés est un coup |
| coup compté | ce que le jeu compte pour la règle des 2 coups (`countedMoves`) : jamais un lancer, jamais un tour passé |
| partie, revanche | une partie va de « tous prêts » au résultat ; la revanche est la partie suivante à la même table |
| spectateur | une personne qui a ouvert le panneau d'une table sans y être assise |

### 1.2 Qui fait quoi

| Qui | Quoi | Où |
|---|---|---|
| G2, session principale | tout ce qui est commun : contrat, hasard, Elo, protocole, base, service des tables, invitations, téléportation, panneau, classement, aides de test | § 2 à § 12 |
| G3 · G4 · G5 · G6, un agent par jeu | règles et tests du jeu, plateau React, textes, styles, e2e de son jeu | § 12 et la partie de son jeu |
| G7, session principale | fusion des quatre worktrees, relecture de chaque moteur contre ce document, captures | § 12.8 |

### 1.3 Ce que G2 livre avant le lancement des agents

Les agents partent du dépôt où G2 est fusionné. Il leur faut :

1. `packages/shared/src/games/` : `types.ts`, `rng.ts`, `elo.ts`, `protocol.ts`, `arrival.ts`, `conformance.ts`, `registry.ts` (vide : `export {};`, pour rester un module), `index.ts`, et `testing/` (le morpion jetable, § 11) ; l'index de `@bureau/shared` réexporte `games/index.ts` ; `packages/shared/package.json` gagne l'export `"./games/*": "./src/games/*/index.ts"` (le client d'un jeu importe `@bureau/shared/games/<jeu>`).
2. Les constantes `GAME_*` (§ 7) dans `packages/shared/src/constants.ts`.
3. Le serveur complet (§ 4 à § 8), la migration `0008_games.sql`, les crochets de présence, `debug:game`.
4. Côté client : `apps/client/src/games/types.ts` (`GameUi`, § 9.4), `game-ui.ts` (chargeur paresseux), `GamePanel`, `GameFrame`, `GameLobby`, `InviteToast`, `Ladder`, la tranche `games` du magasin, la connexion, les tables comme `Interactable` dans `Office.ts`, les textes communs (`fr.games`), les styles communs.
5. Les e2e : `e2e/jeux-helpers.ts`, les projets Playwright `jeux-plateforme` et `jeux` (§ 12.6), les ports réglables par `E2E_PORT` et `E2E_OFFICE_PORT`, `window.__office.tables()`, `gameTable(id)` et `debugGame(…)`.
6. Les sons `dice`, `piece`, `win` et `teleport` au catalogue (T7).
7. Si Andrea dit oui à `chess.js` : la dépendance ajoutée à `packages/shared/package.json` en version exacte (`"chess.js": "1.4.0"`), `pnpm-lock.yaml` à jour, la ligne de crédit dans `CREDITS.txt`. L'agent G3 n'ajoute jamais de dépendance lui-même.

Le message de lancement de G3 dit l'option retenue pour les échecs. **Sans consigne explicite : règles à la main.**

---

## 2. Le contrat d'un jeu

### 2.1 `packages/shared/src/games/types.ts`

```ts
import type { z } from 'zod';

// Les quatre jeux : les noms des zones `game` de la carte (T6). Si T6 a déjà défini GAME_IDS (parse-map.ts), ce fichier le réexporte : une
// seule liste.
export const GAME_IDS = ['chess', 'backgammon', 'connect4', 'ludo'] as const;
export type GameId = (typeof GAME_IDS)[number];

// Un nombre dans [0, 1). Côté serveur : crypto (cryptoRng). Dans les tests : une graine ou une suite écrite. Jamais Math.random dans des règles.
export type Rng = () => number;

// La partie à créer : le nombre de joueurs (sièges 0 … seats − 1) et le siège qui commence (aux échecs, celui qui a les Blancs).
export interface GameSetup {
  seats: number;
  first: number;
}

// Ce qu'une action a provoqué : le client l'anime et en tire les sons. Chaque jeu définit son union ; `type` est toujours là.
export interface GameEventBase {
  type: string;
}

// Pourquoi un siège sort d'une partie qu'il n'a pas finie. C'est la plateforme qui le décide, jamais le jeu.
export const FORFEIT_REASONS = ['resign', 'timeout', 'disconnect'] as const;
export type ForfeitReason = (typeof FORFEIT_REASONS)[number];

// Les raisons de fin que la plateforme connaît et sait écrire. Chaque jeu ajoute les siennes (« checkmate », « four »…) et les écrit lui-même.
export const PLATFORM_END_REASONS = ['resign', 'timeout', 'disconnect', 'agreement'] as const;

export interface GameResult {
  // Les sièges, du meilleur au moins bon ; un groupe = des ex æquo. Chaque siège y figure une fois. Nulle à deux : [[0, 1]].
  ranking: number[][];
  // Une raison de PLATFORM_END_REASONS, ou une raison propre au jeu (listée dans sa partie).
  reason: string;
  // Pour l'affichage seulement (gammon, cases gagnantes…) ; le classement ne le lit jamais. Du JSON.
  detail?: Record<string, unknown>;
}

export type ApplyResult<S, E extends GameEventBase> =
  | { ok: true; state: S; events: E[] }
  // Un code court en anglais (« illegal », « wrong_phase »…) : journalisé, jamais montré tel quel.
  | { ok: false; error: string };

// Un jeu. Tout est pur : aucune fonction ne modifie ses arguments, ne lit l'heure ni Math.random, ne lève (sauf bogue).
// Écrire les fonctions en méthodes (`create(…): …`, pas `create: (…) => …`) : c'est ce qui permet de ranger un
// GameDefinition<ChessState, ChessMove, ChessEvent> dans le registre, typé GameDefinition<unknown, unknown> (bivariance des méthodes).
export interface GameDefinition<S, M, E extends GameEventBase = GameEventBase> {
  id: GameId;
  label: string;                    // « Échecs », « Backgammon », « Puissance 4 », « Petits chevaux »
  minPlayers: number;
  maxPlayers: number;
  drawOffers: boolean;              // la nulle par accord existe (échecs seulement)
  moveSchema: z.ZodType<M>;         // la forme d'un coup (pas sa légalité) ; tableaux bornés (.max)
  create(setup: GameSetup, rng: Rng): { state: S; events: E[] };
  turn(state: S): number | null;               // le siège qui doit agir ; null : partie finie
  legalMoves(state: S, seat: number): M[];     // [] si ce n'est pas à `seat`, ou si la partie est finie
  apply(state: S, seat: number, move: M, rng: Rng): ApplyResult<S, E>;
  forfeit(state: S, seat: number, reason: ForfeitReason): { state: S; events: E[] };
  agreeDraw?(state: S): { state: S; events: E[] };   // obligatoire quand drawOffers est vrai
  result(state: S): GameResult | null;
  countedMoves(state: S): number;              // coups qui comptent pour GAME_MIN_RANKED_MOVES
  invariants(state: S): string[];              // [] : l'état est légal ; sinon une phrase par violation
}

export type AnyGameDefinition = GameDefinition<unknown, unknown, GameEventBase>;
```

### 2.2 Règles pour qui écrit un jeu

| # | Règle | Comment c'est vérifié |
|---|---|---|
| R1 | **Pur.** Aucune fonction ne modifie un argument : elle rend un nouvel état. | le harnais gèle l'état avant chaque appel (`deepFreeze`, § 11) |
| R2 | **JSON.** État, coups et événements ne contiennent que des objets, des tableaux, des chaînes, des nombres finis, des booléens et `null`. Jamais `undefined` comme valeur (on omet la clé), ni `Map`, `Set`, `Date`, `BigInt`, classe. | `JSON.parse(JSON.stringify(x))` égal à `x` (`toStrictEqual`) à chaque pas |
| R3 | **Déterministe.** Même état, même coup, mêmes valeurs du générateur : même résultat. Le nombre d'appels au générateur ne dépend que de l'état et du coup. | rejouer le journal d'une partie redonne le même état final |
| R4 | **Méfiant.** `apply` revérifie tout (phase, siège, légalité) et rend `{ ok: false }` sans rien changer. | coups illégaux tirés au hasard (§ 11.2) |
| R5 | **Transitions dans `apply`.** Tour passé faute de coup, fin de partie, bonus : décidés dans l'appel qui les provoque, jamais plus tard. | les cas nommés de chaque jeu |
| R6 | `turn(state) === null` si et seulement si `result(state) !== null`. | harnais, à chaque pas |
| R7 | Le classement d'un résultat contient chaque siège une fois. | harnais, en fin de partie |
| R8 | **Petit.** Un état reste sous 50 ko de JSON, même dans la partie la plus longue (il part à tout le bureau à chaque coup). | harnais : mesure du plus gros état vu |
| R9 | **Partagé.** Aucune dépendance au serveur ni au client, aucune API de Node ni du navigateur : le même code tourne des deux côtés. | `pnpm typecheck`, build du client |
| R10 | **Robuste.** Toute fonction accepte n'importe quel état qui passe `invariants` (les tests e2e en fabriquent : `debug:game`). | cas nommés sur états fabriqués |
| R11 | **Français.** Seul `label` est un texte visible dans `packages/shared` ; tout le reste vit dans le module client du jeu. | relecture G7 |
| R12 | **Siège ≠ couleur.** Le jeu reçoit des sièges (0 … n − 1) ; il en déduit lui-même la couleur (§ 13 à § 16). Il ne connaît aucun identifiant de compte. | relecture G7 |

### 2.3 Ce qui change par rapport au plan (tâche G2)

| Plan | Ici | Pourquoi |
|---|---|---|
| `create(playerIds: string[], rng): State` | `create({ seats, first }, rng): { state, events }` | Les règles n'ont pas à connaître les comptes ; « qui commence » et l'alternance des revanches sont décidés par la plateforme ; le lancer d'ouverture du backgammon produit des événements. |
| `legalMoves`, `apply`, `result`, `turn`, `moveSchema` | inchangés | — |
| Fin décidée par la plateforme (abandon, inactivité, départ, nulle) | `forfeit(state, seat, reason)` et `agreeDraw(state)` dans le jeu | Le résultat vit dans l'état, à un seul endroit ; aux petits chevaux, une sortie ne finit pas la partie ; le journal se rejoue. |
| — | `countedMoves(state)` | « Moins de 2 coups » ne veut pas dire la même chose d'un jeu à l'autre (un lancer n'est pas un coup). |
| — | `invariants(state)` | Les parties au hasard et `debug:game` vérifient qu'un état est légal. |
| — | `drawOffers` | La nulle par accord n'existe qu'aux échecs. |
| `GameResult = { ranking: number[][] }` ou nulle | `{ ranking, reason, detail? }` | Le client doit écrire la fin (« Échec et mat », « Gammon ») ; une nulle est un seul groupe. |
| Morpion « dans `packages/shared/test/` seulement », e2e de G2 sur un morpion | morpion dans `packages/shared/src/games/testing/`, jamais au registre ; l'e2e de G2 s'arrête à « assis et prêts » | Le serveur doit pouvoir l'importer (`@bureau/shared/games/testing`) ; aucune interface ne le dessine, donc pas de partie jouée en e2e avant G5. |
| Événements `game:join`, `game:leave`, `game:watch`, `game:ready`, `game:move`, `game:resign`, `game:draw`, `game:invite`, `game:invite:answer` | un seul `game:do` à commandes typées, plus `game:ladder` | Le même motif que `desk:do` : un schéma zod, une limite de débit, un accusé, un test de refus. |
| `game:table`, `game:invite`, `game:ended`, `game:error` | `game:table`, `game:invite`, `game:invite:gone`, `game:notice` | La fin est dans la vue de la table ; les erreurs passent par l'accusé. |
| `game_rating.rating int` | gardé (`integer`), arrondi une fois par partie | Voir § 6.3. |

### 2.4 Le registre

```ts
// packages/shared/src/games/registry.ts : une ligne par jeu, ajoutée par l'agent du jeu ; G7 fusionne les quatre.
export { chess } from './chess';
export { backgammon } from './backgammon';
export { connect4 } from './connect4';
export { ludo } from './ludo';
```

```ts
// packages/shared/src/games/index.ts (G2)
import * as registry from './registry';
import type { AnyGameDefinition, GameId } from './types';
export * from './types';
export * from './rng';
export * from './elo';
export * from './protocol';
export * from './arrival';
// Les jeux connus, par identifiant. Un jeu absent du registre (pas encore fusionné) n'existe pas : sa table reste fermée (« Bientôt »).
export const GAMES: Partial<Record<GameId, AnyGameDefinition>> = Object.fromEntries(
  Object.values(registry as Record<string, AnyGameDefinition>).map((def) => [def.id, def]),
);
```

Un test de G2 vérifie que chaque entrée a un `id` de `GAME_IDS`, unique, égal à sa clé, et `1 ≤ minPlayers ≤ maxPlayers ≤ chaises de sa table`.

---

## 3. Le hasard

### 3.1 `packages/shared/src/games/rng.ts`

```ts
export type { Rng } from './types';
// mulberry32 : la même graine donne la même suite. Pour les tests et les parties au hasard ; jamais en production.
export function seededRng(seed: number): Rng;
// Rend les valeurs données une à une, puis `then` ; sans `then`, lève une erreur (« plus de valeurs ») : un test qui tire plus que prévu échoue.
export function scriptedRng(values: readonly number[], then?: Rng): Rng;
// Les valeurs qui font sortir ces dés avec rollDie : (d − 0,5) / sides. rngFromDice([6, 1]) → [0.9166…, 0.0833…].
export function rngFromDice(dice: readonly number[], sides?: number): number[];
// 1 + floor(rng() × sides), ramené à [1, sides]. Le seul tirage de dé des jeux.
export function rollDie(rng: Rng, sides?: number): number;
// Un entier de 0 à n − 1 (choix au hasard : premier joueur, coup d'une partie au hasard).
export function pickIndex(rng: Rng, n: number): number;
// Enveloppe un générateur et retient ce qu'il a rendu : le journal d'une partie garde ces valeurs pour la rejouer.
export function recordingRng(rng: Rng): { rng: Rng; take(): number[] };
```

`cryptoRng()` vit côté serveur seulement (`apps/server/src/games/crypto-rng.ts`) : `randomInt(2 ** 47) / 2 ** 47` de `node:crypto` (Node exige un écart inférieur à 2⁴⁸ : `randomInt(2 ** 48)` lèverait). Il n'entre jamais dans `packages/shared` (le client le compilerait).

### 3.2 Règles

- **Les dés ne sont tirés que dans `create` et `apply`, côté serveur.** Le client n'appelle jamais `apply` pour de vrai ; il peut seulement prévisualiser des étapes sans hasard (les pions du backgammon).
- **L'état ne contient jamais le générateur** ni une graine : rien ne permet de deviner les prochains dés. Les dés tirés, eux, sont dans l'état et dans un événement `dice`, pour que le client les anime.
- **Le journal de chaque partie** garde, pour chaque appel, les valeurs rendues par le générateur (`MatchLogEntry.rng`, § 4.3) : `scriptedRng` les rejoue.
- Les dés « qui roulent » à l'écran sont décoratifs (`Math.random` côté client, permis) et finissent toujours sur les valeurs du serveur.

---

## 4. Protocole temps réel

### 4.1 Les événements

```ts
// packages/shared/src/protocol.ts (ajouts de G2)
// ClientToServerEvents
'game:do': (p: GameCommand, ack: (r: GameAck) => void) => void;
'game:ladder': (p: { game: GameId }, ack: (r: LadderAck) => void) => void;
'debug:game': (p: { game: GameId; state: unknown; rolls?: number[] }) => void;   // accepté seulement si E2E=1
// ServerToClientEvents
'game:table': (p: GameTableView) => void;                                        // à tout le bureau, à chaque changement d'une table
'game:invite': (p: GameInvite) => void;                                          // à l'invitée
'game:invite:gone': (p: { id: string; reason: 'expired' | 'cancelled' | 'answered' }) => void;   // à l'invitée : retirer le toast
'game:notice': (p: GameNotice) => void;                                          // à l'invitante : réponse, silence, départ
// InitPayload
games?: GameTableView[];          // les tables de la carte ; absent ou [] : la carte n'en a pas (petite carte de développement)
gameInvites?: GameInvite[];       // les invitations qui attendent sa réponse
```

### 4.2 Les commandes de `game:do`

```ts
// packages/shared/src/games/protocol.ts
export const gameIdSchema = z.enum(GAME_IDS);
export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('watch'), game: gameIdSchema }),
  z.object({ type: z.literal('unwatch'), game: gameIdSchema }),
  z.object({ type: z.literal('sit'), game: gameIdSchema, chair: z.number().int().min(0).max(3).optional() }),
  z.object({ type: z.literal('stand'), game: gameIdSchema }),
  z.object({ type: z.literal('ready'), game: gameIdSchema, ready: z.boolean() }),
  z.object({ type: z.literal('move'), game: gameIdSchema, version: z.number().int().nonnegative(), move: z.unknown() }),
  z.object({ type: z.literal('resign'), game: gameIdSchema }),
  z.object({ type: z.literal('draw'), game: gameIdSchema, action: z.enum(['offer', 'accept', 'decline']) }),
  z.object({ type: z.literal('invite'), game: gameIdSchema, userId: z.string().min(1).max(128) }),
  z.object({ type: z.literal('answer'), invite: z.string().min(1).max(64), accept: z.boolean() }),
]);
export type GameCommand = z.infer<typeof gameCommandSchema>;
export const GAME_ERRORS = [
  'invalid', 'rate_limited', 'unknown_game', 'too_far', 'chair_taken', 'table_full', 'already_here', 'in_progress', 'busy',
  'not_seated', 'no_match', 'stale', 'not_your_turn', 'illegal', 'no_offer', 'already_offered', 'too_early',
  'self', 'offline', 'dnd', 'too_many', 'expired', 'unavailable',
] as const;
export type GameError = (typeof GAME_ERRORS)[number];
export type GameAck = { ok: true } | { ok: false; error: GameError };
```

Chaque commande passe d'abord par le tronc commun du § 4.8. Puis :

| Commande | Conditions, dans l'ordre (erreur rendue) | Effet |
|---|---|---|
| `watch` | table de la carte (`unknown_game`) ; la personne est dans la place qui contient la table, là où le monde la voit, ou assise à cette table (`too_far`) | spectatrice de cette table (elle cesse de regarder une autre table) ; diffusion |
| `unwatch` | aucune (sans effet si elle ne regardait pas) | n'est plus spectatrice ; diffusion |
| `sit` | table (`unknown_game`) ; dans la place (`too_far`) ; déjà assise ici (`already_here`) ; partie en cours à cette table (`in_progress`) ; joueuse d'une partie en cours ailleurs (`busy`) ; chaise demandée prise (`chair_taken`) ; sans `chair`, aucune chaise libre (`table_full`) | assise, pas prête ; levée de l'autre table où elle attendait ; retirée des spectateurs ; diffusion |
| `stand` | assise ici (`not_seated`) ; joueuse de la partie en cours (`in_progress` : il faut abandonner) | chaise libre ; elle reste spectatrice ; diffusion |
| `ready` | assise ici (`not_seated`) ; partie en cours (`in_progress`) | prête ou non. Si toutes les personnes assises sont prêtes et connectées, et au moins `minPlayers` : la partie commence (§ 4.4) |
| `move` | voir § 4.4 | voir § 4.4 |
| `resign` | partie en cours (`no_match`) ; joueuse pas encore sortie (`not_seated`) | `forfeit(siège, 'resign')` |
| `draw` | partie en cours (`no_match`) ; jeu à `drawOffers` (`invalid`) ; joueuse (`not_seated`). `offer` : `countedMoves ≥ 2` (`too_early`) [FIDE 5.2.3], aucune offre en cours (`already_offered`), elle a joué depuis sa dernière offre (`too_early`). `accept`, `decline` : une offre de l'autre camp est en cours (`no_offer`) | offre enregistrée ; `agreeDraw` ; offre retirée |
| `invite` | `GAME_INVITE_RATE` par compte (`rate_limited`) ; table (`unknown_game`) ; invitante assise ici (`not_seated`) ; cible ≠ soi (`self`) ; cible au bureau (`offline`) ; cible ni en « Ne pas déranger » ni dans un mode à `allowEntry: false` ou à `place` (`dnd`) ; cible pas joueuse d'une partie en cours (`busy`) ; cible pas déjà assise ici (`already_here`) ; au plus `GAME_INVITES_PER_USER` invitations en attente pour l'invitante (`too_many`) | invitation créée (§ 4.5) ; inviter de nouveau la même personne à la même table remplace l'ancienne et remet le délai à 60 s |
| `answer` | invitation à elle, encore valable (`expired`) | § 4.5 |

### 4.3 La vue d'une table

C'est le seul message de jeu qui part à tout le bureau. **Le même objet part à tous** : joueurs, spectateurs et les autres. Ces quatre jeux n'ont rien de caché ; ce qui est privé (invitations, générateur, journal) n'y est jamais.

```ts
export interface GameChairView { userId: string; name: string; avatarKey: string | null; ready: boolean; connected: boolean }
export interface GameMatchPlayer { userId: string; name: string; avatarKey: string | null; connected: boolean; reconnectMs: number | null }
export interface GameMatchView {
  id: string;                        // uuid, celui de la ligne game_match
  status: 'playing' | 'ended';
  players: GameMatchPlayer[];        // par siège ; reconnectMs : ms avant la défaite d'un joueur déconnecté, sinon null
  first: number;
  state: unknown;                    // l'état du jeu ; le client le type avec le module du jeu
  events: unknown[];                 // ce qu'a provoqué le dernier changement de la partie (à animer)
  turnMs: number | null;             // ms qu'il reste à celui qui doit agir avant l'inactivité ; null si finie
  drawOffer: number | null;          // le siège qui propose la nulle
  startedAt: number;                 // ms depuis 1970
  result: GameResult | null;         // = result(state), pour qui n'a pas chargé le module du jeu
  ranked: boolean | null;            // null tant que la partie n'est pas finie
  ratings: Array<{ userId: string; before: number; after: number }> | null;   // null : pas classée, ou base indisponible
}
export interface GameTableView {
  game: GameId;
  version: number;                   // + 1 à chaque changement de la table ; jamais remis à zéro
  chairs: Array<GameChairView | null>;   // une case par chaise ; null : libre
  spectators: Array<{ id: string; name: string }>;
  match: GameMatchView | null;       // la partie en cours, ou la dernière finie, jusqu'au début de la suivante
}
export interface GameInvite { id: string; game: GameId; from: { id: string; name: string; avatarKey: string | null }; ttlMs: number }
export interface GameNotice { kind: 'accepted' | 'declined' | 'expired' | 'gone'; game: GameId; user: { id: string; name: string } }
export interface LadderRow { rank: number; userId: string; name: string; rating: number; games: number; wins: number; losses: number; draws: number }
export type LadderAck = { ok: true; top: LadderRow[]; me: LadderRow | null } | { ok: false; error: 'invalid' | 'rate_limited' | 'unavailable' };
// Le journal d'une partie (en mémoire, puis la colonne `moves` de game_match). `at` : ms depuis le début de la partie (affichage seulement).
export type MatchLogEntry =
  | { kind: 'create'; setup: GameSetup; rng: number[] }
  | { kind: 'move'; seat: number; move: unknown; rng: number[]; at: number }
  | { kind: 'forfeit'; seat: number; reason: ForfeitReason; at: number }
  | { kind: 'draw'; at: number }
  | { kind: 'debug'; state: unknown; at: number };   // E2E seulement (§ 4.9) : l'état est remplacé tel quel
```

Les durées partent en **ms restantes**, jamais en heure absolue : le client compte à rebours depuis la réception, quelle que soit son horloge.

### 4.4 Une partie, pas à pas

Toutes les commandes d'une table, et le balayage des délais de cette table, passent **l'une après l'autre** dans une file par table (`oneAtATimePerKey`, comme `LightsService`). Deux coups simultanés sont donc jugés l'un après l'autre, le second sur l'état laissé par le premier.

**Début.**
1. Joueurs : les chaises occupées, dans l'ordre des chaises : sièges 0 à n − 1.
2. `first` : si les joueurs sont les mêmes, aux mêmes sièges, qu'à la partie précédente de cette table, `(first d'avant + 1) % n` ; sinon `pickIndex(cryptoRng(), n)` [choix de variante].
3. `create({ seats: n, first }, rng)` avec un `recordingRng(cryptoRng())` ; journal `{ kind: 'create', … }`.
4. `id` = `randomUUID()` ; drapeaux « prêt » remis à faux ; délai d'inactivité armé pour `turn(state)` ; version + 1 ; diffusion.

**Un coup** (`move`), dans cet ordre :
1. partie en cours à cette table (`no_match`) ;
2. la personne est joueuse de cette partie et n'en est pas sortie (`not_seated`) ;
3. `version` égale la version de la table (`stale`) : un coup envoyé deux fois, ou sur un état périmé, ne compte qu'une fois ;
4. `moveSchema.safeParse` (`invalid`) ;
5. `turn(state) === siège` (`not_your_turn`) ;
6. `apply(state, siège, coup, rng)` ; `{ ok: false }` → `illegal`, rien ne change.

Accepté : nouvel état et événements, journal `{ kind: 'move', … }`, l'offre de nulle de l'**autre** camp tombe [FIDE 9.1.2.1], le délai d'inactivité repart pour `turn(state)` (même si c'est encore le même siège : bonus, dés lancés), puis fin éventuelle, version + 1, diffusion, accusé `{ ok: true }`.

**Fin** (dès que `result(state)` n'est plus nul, après un coup, un `forfeit` ou `agreeDraw`) : `status = 'ended'`, `ranked = countedMoves(state) ≥ GAME_MIN_RANKED_MOVES`, écriture en base (§ 5.2), `ratings` dans la vue, diffusion. Les joueurs restent assis, pas prêts. « Revanche » = `ready`.

**Sortie d'un siège** (`resign`, inactivité, départ) : `forfeit(state, siège, raison)`, journal, puis comme un coup accepté. Un siège déjà sorti ne sort pas deux fois (la plateforme tient la liste des sièges sortis de la partie).

**Nulle par accord** (échecs) : `offer` note le siège qui propose et le bloque jusqu'à son prochain coup ; un coup de l'autre camp ou `decline` retire l'offre ; `accept` appelle `agreeDraw`, journal `{ kind: 'draw' }`, fin.

### 4.5 Invitations

1. `invite` crée `{ id, game, from, to, expiresAt = now + GAME_INVITE_TTL_MS }` (en mémoire) et envoie `game:invite` (avec `ttlMs`) aux sockets de l'invitée.
2. Le client montre un toast « {nom} t'invite {aux échecs} » (`fr.games.invitedTo[game]`), avec « Accepter » et « Refuser », qui disparaît de lui-même après `ttlMs`.
3. `answer` refusé : invitation retirée, `game:notice { kind: 'declined' }` à l'invitante.
4. `answer` accepté : le serveur revérifie (l'invitante est encore assise à cette table, sinon `expired` ; l'invitée n'est pas joueuse ailleurs, sinon `busy`), puis :
   - la **téléporte** autour de la table (§ 8) ;
   - l'**assoit** s'il n'y a pas de partie en cours et qu'une chaise est libre (elle quitte alors la table où elle attendait) ; sinon elle devient **spectatrice** ;
   - `game:notice { kind: 'accepted' }` à l'invitante, `game:invite:gone { reason: 'answered' }` à l'invitée, diffusion.
   Le client de l'invitée ouvre le panneau de la table.
5. Expirée : `game:invite:gone { reason: 'expired' }` à l'invitée, `game:notice { kind: 'expired' }` à l'invitante. Une réponse tardive rend `expired`.
6. L'invitante se lève, quitte le bureau ou est retirée : ses invitations tombent (`cancelled`). L'invitée quitte le bureau : l'invitation tombe, `game:notice { kind: 'gone' }`.
7. L'`init` d'une socket redit les invitations qui attendent sa réponse (`gameInvites`, avec le temps restant).

Être invité en « Ne pas déranger » est refusé à l'envoi. Une personne qui passe en « Ne pas déranger » après avoir été invitée peut encore accepter : c'est elle qui décide.

### 4.6 Spectateurs

- Une personne regarde au plus une table. Ouvrir le panneau d'une table envoie `watch` (si elle n'y est pas assise) ; le fermer envoie `unwatch`.
- Elle reste spectatrice si elle s'éloigne de la salle ; elle cesse de l'être à sa déconnexion.
- Les spectateurs reçoivent exactement la même vue que les joueurs (§ 4.3), ni plus ni moins.

### 4.7 Reconnexion et départ

La présence (`presence.ts`) garde un joueur 10 s au monde après la chute de sa dernière socket (`DISCONNECT_GRACE_MS`). Le jeu garde sa place **90 s** (`GAME_RECONNECT_MS`), plus longtemps : un joueur peut avoir disparu du bureau (`player:left`) et garder son siège. G2 ajoute à `createPresence` quatre crochets appelés par la présence :

| Crochet | Quand | Ce que font les jeux |
|---|---|---|
| `onSocketsGone(userId)` | la dernière socket de la personne tombe | joueur d'une partie en cours : `disconnectedSince[siège] = now`, `connected: false`, diffusion. Assis sans partie : pas prêt, `connected: false`. Spectateur : retiré. Ses invitations envoyées tombent ; celles reçues tombent (`gone` à l'invitante). |
| `onWelcome(socket)` (existe déjà) | une socket reçoit son `init` | joueur déconnecté : délai annulé, `connected: true`, diffusion. |
| `onDepart(userId)` | la fin du délai de grâce : la personne quitte le monde | levée des chaises où elle attendait (une partie en cours garde son siège jusqu'à 90 s). |
| `onRemoved(userId)` | `member:removed` | sortie immédiate (`disconnect`) de toute partie, levée, plus spectatrice, invitations retirées. |

Revenu à temps, le joueur reçoit dans son `init` la table entière : le plateau repart de l'état du moment, sans animation. Le délai d'inactivité de 5 min, lui, ne s'arrête pas pendant la déconnexion.

Un changement de profil (`profile:changed`) met à jour les noms et avatars des chaises, des joueurs et des spectateurs, puis rediffuse les tables touchées.

### 4.8 Le tronc commun, ce qui est ignoré sans réponse, les limites

Comme dans `handlers.ts` :
1. une socket qui n'a pas reçu son `init`, ou dont la personne n'est pas au monde : **ignorée, sans accusé** ;
2. plus de `GAME_RATE` par socket : `rate_limited` ;
3. charge utile refusée par `gameCommandSchema` : `invalid` ;
4. puis la commande. Rien ne lève : une erreur imprévue est journalisée (`logServerError`) et rend `unavailable`.

`game:ladder` : même tronc, limite `GAME_LADDER_RATE`, base en panne → `unavailable`.

Côté client, tout `game:do` part avec `socket.timeout(5000)` ; un délai écoulé vaut `unavailable`. Un `stale` après un double clic est attendu : le client l'ignore sans message.

### 4.9 Débogage (E2E seulement)

`debug:game { game, state, rolls? }`, enregistré seulement avec `E2E=1`, comme `debug:teleport` :
- une partie doit être en cours à cette table ; `state` doit passer `invariants` et avoir `turn(state) !== null` ; sinon, ignoré ;
- l'état remplace celui de la partie (journal `{ kind: 'debug', state, at }`, que le rejeu applique tel quel), version + 1, diffusion ;
- `rolls` (dés de 1 à 6) : les prochains appels au générateur de cette partie rendent `rngFromDice(rolls)`, puis reviennent à `cryptoRng`.
- Un test qui veut une partie classée pose un état dont `countedMoves` vaut déjà 1 ou plus (un compteur de coups dans l'état fabriqué) : sinon la fin ne compte pas au classement.

Côté client : `window.__office.debugGame(game, state, rolls?)`, `window.__office.gameTable(game)` (la vue du magasin) et `window.__office.tables()` (les tables de la carte, en pixels).

---

## 5. Base de données

### 5.1 Le schéma (`apps/server/src/db/schema.ts`, ajouts de G2)

```ts
// Une partie finie, classée ou non, écrite une fois, à sa fin. `id` est fixé par le serveur au début de la partie : une seconde écriture
// de la même partie ne fait rien. Les joueurs sont copiés (identifiant, nom du moment, notes avant et après) : pas de clé étrangère, la
// ligne reste si un compte disparaît.
export const gameMatch = pgTable(
  'game_match',
  {
    id: uuid('id').primaryKey(),
    game: text('game').$type<GameId>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    players: jsonb('players').$type<Array<{ seat: number; userId: string; name: string; before: number | null; after: number | null }>>().notNull(),
    result: jsonb('result').$type<GameResult>().notNull(),
    moves: jsonb('moves').$type<MatchLogEntry[]>().notNull(),
    moveCount: integer('move_count').notNull(),      // countedMoves à la fin
    ranked: boolean('ranked').notNull(),
  },
  (t) => [index('game_match_game_ended_at_idx').on(t.game, t.endedAt)],
);

// La note de chaque personne à chaque jeu. Sans ligne : 1200, aucune partie classée. Part avec le compte.
export const gameRating = pgTable(
  'game_rating',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    game: text('game').$type<GameId>().notNull(),
    rating: integer('rating').notNull().default(1200),
    games: integer('games').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    draws: integer('draws').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.game] }), index('game_rating_game_rating_idx').on(t.game, t.rating)],
);
```

Migration : `pnpm --filter @bureau/server db:generate --name games`, le numéro qui suit les migrations de T12 et T13 (`0008_games.sql` dans le plan). On ne modifie jamais une migration existante.

### 5.2 Écrire une partie finie (`LadderService.record`)

Dans une file unique (`oneAtATimePerKey`, clé `ladder`), en **une transaction** :
1. partie classée : lire `rating` et `games` des joueurs pour ce jeu (`FOR UPDATE`) ; absents : 1200 et 0 ; calculer `eloChanges` (§ 6) ;
2. `INSERT INTO game_match … ON CONFLICT (id) DO NOTHING RETURNING id` ; aucune ligne rendue : la partie est déjà écrite, on annule la transaction et on rend `null` ;
3. partie classée : pour chaque joueur, `INSERT … ON CONFLICT (user_id, game) DO UPDATE` : nouvelle note, `games + 1`, et `wins`, `draws` ou `losses + 1` ;
4. rendre les changements (la vue de la table les montre).

`wins`, `draws`, `losses` à plusieurs [choix de variante] : seul dans le premier groupe → victoire ; premier groupe partagé → nulle ; sinon → défaite. Une erreur de base est journalisée (sans valeurs, comme ailleurs) : la partie est finie quand même, `ratings: null`.

### 5.3 Lire le classement (`game:ladder`)

- `top` : `game_rating` jointe à `user`, pour ce jeu, `games > 0`, comptes actifs (`disabled_at IS NULL`), triés par note décroissante, puis `games` décroissant, puis nom ; `GAME_LADDER_TOP` lignes. Le nom est celui du compte au moment de la lecture, comme pour le chat.
- `rank` = 1 + le nombre de lignes (même filtre) de note strictement plus haute : des ex æquo ont le même rang (« 1, 2, 2, 4 »).
- `me` : sa ligne et son rang, ou `null` sans partie classée.

---

## 6. Classement

### 6.1 La formule

Pour deux joueurs de notes Rₐ et R_b, le score attendu de A est Eₐ = 1 / (1 + 10^((R_b − Rₐ) / 400)), et sa note change de Δ = K × (S − Eₐ), où S vaut 1 (victoire), 0,5 (nulle) ou 0 (défaite) [Wikipédia Elo]. Les notes d'avant la partie servent à tous les calculs.

### 6.2 Les réglages [plan]

- Départ : 1200 (`ELO_START`).
- K = 32 tant que le joueur a joué moins de 30 parties classées à ce jeu (avant celle-ci), puis 20 (`ELO_K_NEW`, `ELO_K`, `ELO_K_NEW_GAMES`). Chaque joueur a son K.
- À plusieurs : comparaison par paires. Pour chaque autre joueur j, S = 1 si i est dans un meilleur groupe, 0,5 dans le même groupe, 0 dans un moins bon ; Δᵢ = Σⱼ (Kᵢ / (n − 1)) × (Sᵢⱼ − Eᵢⱼ), n = nombre de joueurs de la partie. À deux, c'est l'Elo ordinaire.
- Arrondi [choix de variante] : Δ est arrondi **une fois par joueur et par partie**, la moitié loin de zéro (± 15,5 → ± 16) ; la note est un entier. Ainsi, à deux et à K égal, ce que l'un gagne, l'autre le perd.
- Abandon, inactivité, départ : défaite (le `forfeit` du jeu met ce siège derrière les autres). Partie avec `countedMoves < 2` : non classée (ligne `game_match` écrite avec `ranked: false`, notes inchangées). Gammon et backgammon : victoire simple.

### 6.3 `packages/shared/src/games/elo.ts`

```ts
export const ELO_START = 1200, ELO_K_NEW = 32, ELO_K = 20, ELO_K_NEW_GAMES = 30;
export function expectedScore(rating: number, opponent: number): number;
export function kFactor(gamesBefore: number): number;                 // < 30 → 32, sinon 20
export function roundHalfAwayFromZero(x: number): number;
// `ranking` en indices de `players`. Rend un changement par joueur, dans l'ordre de `players`.
export function eloChanges(
  players: ReadonlyArray<{ userId: string; rating: number; games: number }>,
  ranking: ReadonlyArray<ReadonlyArray<number>>,
): Array<{ userId: string; before: number; after: number }>;
```

| Cas (tests P1 à P7) | Avant | Classement | Après |
|---|---|---|---|
| victoire à égalité, K 32 | 1200 · 1200 | [[0], [1]] | 1216 · 1184 |
| nulle à égalité | 1200 · 1200 | [[0, 1]] | 1200 · 1200 |
| le favori gagne (E = 0,7597) | 1400 · 1200 | [[0], [1]] | 1408 · 1192 |
| l'outsider gagne | 1400 · 1200 | [[1], [0]] | 1376 · 1224 |
| K différents (40 parties contre 0) | 1200 · 1200 | [[0], [1]] | 1210 · 1184 |
| à trois, K 32 | 1200 × 3 | [[0], [1], [2]] | 1216 · 1200 · 1184 |
| à quatre, K 32 | 1200 × 4 | [[0], [1], [2], [3]] | 1216 · 1205 · 1195 · 1184 |
| à quatre, ex æquo | 1200 × 4 | [[0], [1, 2], [3]] | 1216 · 1200 · 1200 · 1184 |
| 29 parties avant → K 32 ; 30 → K 20 | — | — | `kFactor(29) = 32`, `kFactor(30) = 20` |

---

## 7. Délais et constantes

À ajouter à `packages/shared/src/constants.ts` (G2), avec un commentaire en français chacune.

| Constante | Valeur | Ce qu'elle règle | Source |
|---|---|---|---|
| `GAME_TURN_TIMEOUT_MS` | 300 000 (5 min) | sans action du siège qui doit agir : `forfeit(siège, 'timeout')`. Repart à chaque action acceptée, lancer compris. | plan, question 3 |
| `GAME_TURN_WARNING_MS` | 60 000 | le compte à rebours ne s'affiche que dans la dernière minute, annoncé une fois au lecteur d'écran | choix de variante |
| `GAME_RECONNECT_MS` | 90 000 | un joueur sans socket depuis 90 s : `forfeit(siège, 'disconnect')` | plan |
| `GAME_INVITE_TTL_MS` | 60 000 | une invitation sans réponse expire | plan |
| `GAME_CHAIR_IDLE_MS` | 600 000 (10 min) | une chaise occupée sans partie se libère ; compté depuis le dernier de ces gestes : s'asseoir, la fin de la partie, un `ready` | choix de variante (ajout) |
| `GAME_SWEEP_MS` | 1 000 | le balayage des délais | choix de variante |
| `GAME_MIN_RANKED_MOVES` | 2 | partie classée à partir de 2 coups comptés | plan |
| `GAME_INVITES_PER_USER` | 3 | invitations en attente par invitante | choix de variante |
| `GAME_RATE` | `{ max: 20, windowMs: 2_000 }` | `game:do`, par socket | choix (le double de `DESK_RATE` : un tour de petits chevaux enchaîne lancers et coups) |
| `GAME_INVITE_RATE` | `{ max: 6, windowMs: 60_000 }` | invitations, par compte | choix |
| `GAME_LADDER_RATE` | `{ max: 10, windowMs: 10_000 }` | `game:ladder`, par socket | choix |
| `GAME_LADDER_TOP` | 10 | lignes du classement | plan, G7 |
| `GAME_ARRIVAL_RING_TILES` | 2 | l'anneau d'arrivée autour d'une table (§ 8) | choix |
| `GAME_TABLE_REACH_TILES` | 2 | portée de la touche E autour d'une table | choix (comme `COFFEE_REACH_TILES`) |

**Le balayage.** Une boucle `every(GAME_SWEEP_MS, …)` (minuteur `unref`, exception journalisée, comme `startWorldTicks`) appelle `games.sweep(now())` sur l'horloge monotone du monde. Les tests appellent `sweep(t)` eux-mêmes, sans faux minuteurs. Chaque table balayée passe par sa file : inactivité, déconnexions de plus de 90 s, invitations expirées, chaises oubliées. Quand l'inactivité et la déconnexion tombent ensemble, le siège sort une fois, pour la première échue. `stop()` (arrêt du serveur) arrête la boucle avant tout le reste.

---

## 8. Téléportation autour de la table

Seule l'**acceptation d'une invitation** téléporte. S'asseoir depuis la salle (`sit`) ne déplace personne : la personne est venue à pied.

```ts
// packages/shared/src/games/arrival.ts (G2)
// La case où poser quelqu'un qui arrive à une table : sa chaise si elle est libre, sinon une case de l'anneau autour de la table, sinon une
// case de la salle ; null s'il n'y a de place nulle part (il reste où il est). `taken` : les pieds des autres avatars, en pixels.
export function arrivalSpot(map: OfficeMap, table: GameTable, chair: number | null, taken: ReadonlyArray<Point>): Point | null;
```

1. `chair` donnée, sa case praticable, et aucun point de `taken` à moins de 2 cases (`max(|dx|, |dy|) < 2`, en cases) : le centre de la chaise.
2. Sinon `freeSpotIn(map, anneau, taken)` (T6), où `anneau` est la place de la table réduite au rectangle de la table élargi de `GAME_ARRIVAL_RING_TILES` cases de chaque côté (les cases de la table sont bloquées de toute façon).
3. Sinon `freeSpotIn(map, place de la table, taken)` : n'importe où dans la salle.
4. Sinon `null` : pas de téléportation ; la personne est assise ou spectatrice quand même ; un avertissement est journalisé.

`taken` = les positions de tous les autres avatars du monde. L'écart de 2 cases entre deux arrivants est la garantie de `freeSpotIn` [plan, T6].

Le déplacement passe par l'utilitaire commun de T13 (`apps/server/src/teleport.ts`) : `world.teleport` (les autres voient un mouvement `tp`, T2) puis `move:correct` avec `reason: 'teleport'` pour la personne (anneau de lumière et son `teleport`, T13). Si T13 n'est pas encore fusionné quand G2 est codé : `world.teleport` puis `move:correct`, comme `moveTo` de `desk-controller.ts`, à réconcilier à la fusion.

La table que G2 attend de T6 dans `OfficeMap.tables` (si T6 l'a écrite autrement, G2 s'y adapte : seules ces quatre informations comptent) :

```ts
export interface GameTable {
  game: GameId;                                      // le nom de la zone `game`
  x: number; y: number; width: number; height: number;   // la table, en pixels
  seats: Array<{ x: number; y: number }>;            // centres des zones `seat` `<jeu>:1`, `<jeu>:2`… dans cet ordre
  place: string | null;                              // la clé de la place qui la contient (la salle de jeu)
}
```

---

## 9. Interface commune

### 9.1 Le panneau

- Un panneau latéral de plus (`PanelId` : `'game'`), un seul à la fois comme les autres. Il s'ouvre par la table (`Interactable` : « [E] Échecs : jouer » ou « regarder la partie », à `GAME_TABLE_REACH_TILES` cases, ou d'un clic), et à l'acceptation d'une invitation.
- Largeur : `.office-side[data-panel='game'] { width: min(440px, calc(100% - 2 * var(--bar-gap))) }`, soit **408 px** de contenu. Sous 720 px, la feuille du bas (70 % de la hauteur) : sur un écran de 375 px, **311 px** de contenu.
- La caméra se centre sur la table dans la partie visible de l'écran (à gauche du panneau sur un ordinateur).

### 9.2 Le cadre (`GameFrame`, G2), de haut en bas

1. En-tête du panneau : `label` du jeu, « Règles » (un `IconButton` qui montre `ui.rules`), « Fermer ».
2. Onglets (`Segmented`) : « Partie » · « Classement ».
3. Les joueurs, une ligne par siège : portrait (`AvatarPortrait`), nom, pastille et nom de couleur (`ui.seatLabel`), « (toi) », repère du tour, compte à rebours dans la dernière minute, « déconnecté · 1:12 ».
4. Le plateau (`ui.Board`). Avant la première partie d'une table : un plateau d'aperçu (`preview`, état de `create({ seats: max(minPlayers, assises), first: 0 }, seededRng(1))` ; jamais un générateur constant, qui ferait relancer sans fin l'ouverture du backgammon), et la salle d'attente (chaises, « S'asseoir », « Prêt », « Inviter ») plus bas, sous la ligne d'état.
5. La ligne d'état : « À toi de jouer », « Au tour de Bastien », puis le texte de fin (raisons de plateforme écrites par G2, raisons du jeu par `ui.describeResult`) et les changements de note (« +16 »). Juste sous le texte de fin, pour une personne assise, la barre de la revanche (`RematchBar`, chantier du 26 oct.) : « Revanche » (= prêt ; demandée, le bouton reste enfoncé, pâle avec une coche, et un second clic l'annule) et la phrase qui dit qui attend qui, du point de vue de celui qui lit (« Bastien veut la revanche : on n'attend plus que toi. », « Revanche demandée : on attend Bastien. »). À la fin, ou quand le panneau s'ouvre sur une partie finie, le corps du panneau défile juste ce qu'il faut pour la montrer : sous un grand plateau, elle serait sous le pli.
6. Les actions. En partie : « Abandonner » (confirmation dans un `alertdialog`, focus sur « Annuler », comme le retrait d'un membre) ; aux échecs, « Proposer la nulle », ou « Accepter la nulle » et « Refuser ». Après la fin : « Revanche » (dans la barre de la revanche) et « Se lever » (dans la salle d'attente, dont les chaises disent « veut la revanche » de qui l'a acceptée). Panneau fermé, quand une autre personne assise demande la revanche : un toast « Bastien veut la revanche aux échecs », avec « Revanche » (l'accepte et ouvre le panneau) et « Plus tard » ; une fois par partie, il part quand la revanche ne tient plus ou qu'on ouvre le panneau, sinon au bout de 60 s. Spectateur : « S'asseoir » quand une chaise est libre et qu'aucune partie ne tourne.
7. Les spectateurs : « 2 spectateurs : Claire, Dan ».
8. Une seule région `aria-live="polite"` : les phrases de `ui.announce`, « À toi de jouer », la fin.
9. Onglet « Classement » : les 10 premiers (rang, nom, note, parties, victoires, nulles, défaites) et sa propre ligne si elle est au-delà ; relu à l'ouverture et après chaque fin de partie à cette table.

### 9.3 Ce que la plateforme fait pour tous les jeux

- `canAct` = partie `playing`, siège à soi, `def.turn(state) === mySeat`, aucun coup en attente de réponse.
- Les `events` donnés au plateau sont ceux de la vue quand sa `version` suit exactement la précédente ; sinon `[]` (init, reconnexion, message manqué) : le plateau saute au nouvel état sans animer.
- L'envoi du coup, l'attente de l'accusé, le message « Coup refusé » (`fr.games.errors`), sauf pour `stale`.
- Les sons, seulement panneau ouvert et effets permis : `ui.sounds(events, mySeat)` à chaque nouvelle version ; `win` pour qui est seul en tête à la fin ; `teleport` par T13. « Ne pas déranger » ne coupe pas les sons d'un panneau de jeu ouvert : la personne a choisi de jouer.
- Les invitations : `InviteToast` passe par `useToasts` (clé `invite:<id>`, durée `ttlMs`, « Accepter » et « Refuser ») ; `game:notice` donne un toast court.
- « Partie interrompue » : si le client jouait une partie (`playing`) et qu'après une reconnexion la table n'a plus cette partie, il affiche « Partie interrompue : le serveur a redémarré. »

### 9.4 Le contrat d'un module client (`apps/client/src/games/types.ts`, G2)

```ts
import type { ComponentType } from 'react';
import type { GameResult } from '@bureau/shared';
import type { SfxId } from '../audio/catalog';

export interface GamePlayerView { userId: string; name: string; avatarKey: string | null; connected: boolean }
export interface GameBoardProps<S, M, E> {
  state: S;
  mySeat: number | null;            // son siège ; null : spectateur ou aperçu
  players: GamePlayerView[];        // par siège
  events: E[];                      // à animer ; [] après un saut d'état
  canAct: boolean;
  onMove(move: M): void;            // la plateforme l'envoie, avec la version
  reducedMotion: boolean;           // prefers-reduced-motion
  preview: boolean;                 // avant la première partie : rien n'est cliquable
}
export interface GameUi<S, M, E> {
  Board: ComponentType<GameBoardProps<S, M, E>>;
  seatLabel(seat: number, state: S): { name: string; color: string };    // « Blancs », '#f2ead8' (la pastille)
  describeResult(result: GameResult, names: string[], state: S): string;  // raisons propres au jeu ; les autres sont à la plateforme
  announce(events: E[], state: S, names: string[]): string | null;        // une phrase pour le lecteur d'écran, ou rien
  sounds(events: E[], mySeat: number | null): SfxId[];                     // les effets de ce lot (« dice », « piece »), dans l'ordre
  rules: string[];                                                         // l'aide « Règles » du panneau : 4 à 8 phrases courtes
}
```

`apps/client/src/games/game-ui.ts` (G2) charge les modules à la demande : `import.meta.glob<{ default: GameUi<unknown, unknown, GameEventBase> }>('./*/index.tsx')`. Chaque jeu (et sa feuille de style) devient un fichier à part du build, chargé à l'ouverture de sa table. Sans module : « Bientôt disponible ».

### 9.5 Ce que tout plateau respecte (agents)

1. **Taille.** Il occupe toute la largeur qu'on lui donne (408 px, ou 311 px sur téléphone), jamais de défilement horizontal. Il se mesure sur son conteneur (`ResizeObserver`), jamais sur la fenêtre. Sur téléphone, 380 px de haut au plus.
2. **Cibles.** Tout ce qui se clique fait au moins 24 × 24 px [WCAG 2.5.8]. Quand les cases sont plus petites (petits chevaux sur téléphone), une liste de coups en boutons double le plateau.
3. **Clavier.** Le motif « grid » [APG] : une seule case dans l'ordre de tabulation (tabindex mobile), les flèches déplacent le focus, `Début` et `Fin` vont aux bouts de la rangée, `Entrée` et `Espace` agissent, `Échap` annule la sélection. **Toute touche prise par le plateau reçoit `event.preventDefault()` et `event.stopPropagation()`** : le clavier de l'avatar (`game/input.ts`), la touche E et les touches du zoom ignorent alors l'événement ; sinon les flèches et ZQSD font marcher l'avatar (voir le correctif du juke-box, commit `015108d`). Les touches que le plateau n'utilise pas passent.
4. **Lecteur d'écran.** Chaque case est un bouton dont le nom dit la case et son contenu (« e4, pion blanc ») et son état (« sélectionnée », « coup possible », « dernier coup »). Les annonces passent par `announce`, dans la région de la plateforme. La couleur n'est jamais seule à dire quelque chose [WCAG 1.4.1] ; un surlignage contraste à 3 contre 1 avec sa case [WCAG 1.4.11].
5. **Mouvement réduit.** Avec `reducedMotion`, aucune animation menée en JavaScript (glissement, dés qui roulent, jeton qui tombe) : l'état final tout de suite. `styles.css` neutralise déjà les animations CSS, pas une suite minutée en JavaScript.
6. **Images.** Pièces, pions, jetons, chevaux et dés sont dessinés en code, en pixel art, comme `office/ambiance-covers.ts` (des lignes de lettres et une palette) ou en SVG `shape-rendering="crispEdges"`, à l'échelle entière, `image-rendering: pixelated`. Aucun nouveau fichier d'image ni de son. Leurs couleurs sont celles de l'illustration, jour comme nuit ; le cadre autour suit les jetons.
7. **Sons.** Aucun appel direct au moteur audio : `sounds()` dit quoi jouer. Les cases et boutons du plateau portent `data-sfx="none"` (sinon chaque sélection fait « clic », `sfx-events.ts`).
8. **Spectateur.** `mySeat === null` : rien n'est sélectionnable, orientation du siège 0 (sauf mention contraire dans la partie du jeu) ; dernier coup et dés restent visibles.
9. **Pas de `backdrop-filter`**, pas de `position: fixed` (le panneau défile), aucun style global.
10. **Aucune valeur en dur** : durées d'animation, tailles et marges sont des constantes nommées en tête de leur fichier (contrainte globale du plan).
11. **Bouton à icône seule** : toujours `IconButton` (`office/ui`), dont le nom accessible et l'infobulle sont le même texte (contrainte globale du plan).

---

## 10. Pièges d'intégration communs

| # | Piège | Parade | Test |
|---|---|---|---|
| 1 | Deux coups en même temps (double clic, deux joueurs) | file par table ; `version` dans chaque coup | P10, P11 |
| 2 | Reconnexion en pleine partie | siège gardé 90 s ; l'`init` redit la table ; le client saute sans animer ; les 5 min continuent | P15 |
| 3 | Un spectateur qui voit trop | rien de caché dans l'état ; ni générateur ni journal envoyés ; le même objet pour tous ; invitations et avis à une seule personne | P17 |
| 4 | Invitation expirée | délai tenu par le serveur ; réponse tardive `expired` ; `game:invite:gone` retire le toast, que le client retire aussi seul après `ttlMs` | P19 |
| 5 | Classement compté deux fois | fin traitée une fois dans la file de la table (`status` vérifié) ; `ON CONFLICT (id) DO NOTHING`, notes changées seulement pour une ligne neuve, dans la même transaction | P16 |
| 6 | Joueur déjà assis ailleurs | en partie : `busy` ; en attente : s'asseoir ailleurs le lève de l'ancienne table ; inviter un joueur en partie : `busy` | P21 |
| 7 | Joueur qui quitte le bureau en pleine partie | 90 s, puis sortie `disconnect` ; revenu avant, même après les 10 s de grâce du monde, il reprend | P15 |
| 8 | Serveur redémarré | parties perdues (v1), rien n'est écrit ; `stop()` arrête le balayage d'abord ; le client affiche « Partie interrompue » | P26 |
| 9 | « Ne pas déranger », Concentration, Sport | invitation refusée (`dnd`). Un joueur qui prend Sport en pleine partie est téléporté (T13), garde son siège et joue depuis le panneau | P20 |
| 10 | Dés tirés côté client | impossible : seuls `create` et `apply`, côté serveur, tirent | P17, revue G7 |
| 11 | Les touches de l'avatar | `preventDefault` sur les touches prises par un plateau (§ 9.5) | tests clavier de chaque jeu |
| 12 | Carte sans table (petite carte de développement) | `init.games` vide, aucun bouton de jeu | P24 |
| 13 | Membre retiré en pleine partie | sortie `disconnect` immédiate | P25 |
| 14 | Nom changé en pleine partie | `profile:changed` met les vues à jour | P8 |
| 15 | Base en panne à la fin | la partie se finit, `ratings: null`, erreur journalisée, ligne perdue (accepté en v1) | P16 |
| 16 | Horloge | délais sur l'horloge monotone du monde ; dates en base par `Date.now()` ; durées envoyées en ms restantes | P14 |
| 17 | Coup énorme | `moveSchema` borne chaque tableau ; Socket.IO coupe au-delà de 1 Mo | revue G7 |
| 18 | Deux e2e sur la même table en même temps | une table par spec ; tests d'un spec en série ; le spec de plateforme passe avant les autres | § 12.6 |
| 19 | Quatre agents qui lancent l'e2e en même temps | des ports par agent (`E2E_PORT`, `E2E_OFFICE_PORT`) | § 12.6 |

---

## 11. Tests de la plateforme (G2)

### 11.1 Le morpion jetable

`packages/shared/src/games/testing/tictactoe.ts` (exporté par `@bureau/shared/games/testing`, jamais au registre) : grille 3 × 3, deux joueurs, `first` commence, trois en ligne gagne, grille pleine nulle, `countedMoves` = pions posés. Il remplit tout le contrat ; il sert aux tests du service et du harnais. Le même dossier contient `brokenGames` : des copies fausses exprès (état modifié en place, `undefined` dans l'état, tirage non déterministe, résultat sans tous les sièges) que le harnais doit attraper.

### 11.2 Le harnais (`packages/shared/src/games/conformance.ts`)

```ts
export interface ConformanceOptions {
  games: number;                    // parties au hasard (les tests passent Number(process.env.JEUX_FUZZ ?? défaut du jeu))
  seed?: number;                    // la partie k joue avec seed + k : un échec cite sa graine
  seats: number[];                  // nombres de joueurs essayés à tour de rôle (petits chevaux : [2, 3, 4])
  maxActions: number;               // garde-fou : au-delà, la partie n'en finit pas, c'est un échec
  forfeitRate?: number;             // part des parties où un siège tiré au hasard sort à un moment tiré au hasard (défaut 0,05)
  drawRate?: number;                // jeux à drawOffers : part des parties finies par accord, après 2 coups comptés (défaut 0,01)
  illegal?(state: unknown, rng: Rng): unknown;   // un coup sans doute illégal, fabriqué par le jeu
  sameOutcome?(a: unknown, b: unknown): boolean; // deux états « au même point » ; défaut : égalité profonde
}
export function runGameConformance(def: AnyGameDefinition, o: ConformanceOptions): { games: number; actions: number; longest: number; biggestStateBytes: number };
export function replayMatch(def: AnyGameDefinition, log: readonly MatchLogEntry[]): unknown;   // l'état final, en rejouant le journal
export function deepFreeze<T>(value: T): T;
```

À chaque pas : `invariants` vide ; aller-retour JSON identique ; entrée gelée (une modification lève) ; `turn` nul si et seulement si `result` non nul ; `legalMoves` vide pour tout siège qui n'a pas le trait ; un échantillon (20 au plus) des coups légaux passe `moveSchema` ; un coup légal tiré au hasard est joué avec un `recordingRng(seededRng(…))` et accepté ; une fois sur dix, `illegal()` est soit refusé sans changer l'état, soit accepté, et l'état obtenu est alors au même point (`sameOutcome`) que celui que donne l'un des coups de `legalMoves` avec les mêmes valeurs du générateur (un `play` de backgammon dans un autre ordre, par exemple). En fin de partie : le classement contient chaque siège une fois ; la partie est rejouée depuis son journal (`replayMatch`) et l'état final est identique. Un échec lève une `Error` qui donne le jeu, la graine, le pas et les 30 dernières entrées du journal.

### 11.3 Les tests de G2, numérotés

| # | Test |
|---|---|
| P1 à P7 | `elo` : les neuf lignes du tableau du § 6.3, et `roundHalfAwayFromZero(±15,5) = ±16`, `(±2,4) = ±2` |
| P8 | service (morpion) : deux assis prêts → la partie commence ; `first` tiré au sort ; à la revanche des mêmes joueurs, `first` alterne ; un `profile:changed` met le nom à jour dans la vue |
| P9 | un coup hors tour → `not_your_turn`, rien ne change |
| P10 | le même coup envoyé deux fois avec la même version → le second rend `stale`, une seule diffusion |
| P11 | un coup illégal → `illegal`, version inchangée |
| P12 | abandon → l'autre gagne ; classée avec 2 coups comptés |
| P13 | moins de 2 coups comptés → `ranked: false`, notes inchangées, une ligne `game_match` |
| P14 | 5 min sans jouer (horloge réglée à la main) → défaite `timeout` de celui qui a le trait ; une action remet le délai à zéro |
| P15 | déconnexion : la chaise reste ; retour avant 90 s → la partie continue ; après 90 s → `disconnect` ; l'`init` du retour contient la table |
| P16 | fin traitée deux fois (deux appels à `record`, même `id`) → une ligne, `games = 1` ; base en panne → partie finie, `ratings: null` |
| P17 | un spectateur, un joueur et une personne du bureau reçoivent le même `game:table` (égalité stricte) ; ni le générateur ni le journal de la partie n'y figurent (aucune clé `rng`, `seed` ou `log`) |
| P18 | accepter une invitation téléporte (case praticable, à 2 cases au moins des autres avatars, autour de la table) et assoit ; table pleine ou partie en cours → spectatrice |
| P19 | une invitation expire à 60 s → `game:invite:gone` à l'invitée, `game:notice expired` à l'invitante ; réponse tardive → `expired` |
| P20 | pas d'invitation en « Ne pas déranger », ni à quelqu'un dans un mode `allowEntry: false` ou à `place` (`dnd`) ; soi-même → `self` ; hors du bureau → `offline` |
| P21 | pas assis à deux tables : en partie → `busy` ; en attente → s'asseoir ailleurs lève de l'ancienne table |
| P22 | `sit` et `watch` hors de la salle de jeu → `too_far` |
| P23 | nulle (faux jeu à `drawOffers`) : avant 2 coups → `too_early` ; acceptée → nulle ; un coup de l'adversaire retire l'offre ; une seconde offre sans coup joué entre-temps → `too_early` |
| P24 | l'`init` donne les tables et les invitations en attente ; sur la petite carte, `games` est vide |
| P25 | `member:removed` en pleine partie → défaite `disconnect` tout de suite |
| P26 | `stop()` arrête le balayage, aucun minuteur ne tire ensuite, aucune partie en cours n'est écrite |
| P27 | `debug:game` n'existe pas sans `E2E=1` ; avec, un état qui ne passe pas `invariants` est ignoré ; `rolls` fixe les dés suivants |
| P28 | le harnais passe sur le morpion et attrape chacun des `brokenGames` |
| P29 | `game:ladder` : 10 premiers triés, son rang, ex æquo au même rang, membres retirés absents, `rate_limited` |
| P30 | client : `GameLobby` (chaises, spectateurs, « Inviter »), `Ladder` (tri, sa ligne), `InviteToast` (60 s, « Accepter », « Refuser »), jeu sans module → « Bientôt disponible », événements ignorés quand la version saute |
| P31 | e2e `jeux-plateforme.spec.ts` : Alice invite Bastien, il accepte, il apparaît près de la table, assis ; les deux se disent prêts (sans jeu fusionné, la partie ne démarre pas : ce spec le vérifie et s'arrête là) |

---

## 12. Fichiers et règles de travail

### 12.1 Fichiers de la plateforme (G2 ; les agents ne les modifient jamais)

```text
packages/shared/src/games/{types,rng,elo,protocol,arrival,conformance,registry,index}.ts   + tests
packages/shared/src/games/testing/{index,tictactoe,broken}.ts
packages/shared/src/{protocol,constants,index}.ts          (ajouts)
packages/shared/package.json                               (export "./games/*" ; chess.js si accordé)
apps/server/src/games/{games-service,games-controller,ladder-service,crypto-rng}.ts   + tests
apps/server/src/db/schema.ts, drizzle/0008_games.sql       (et le journal de drizzle)
apps/server/src/realtime/{handlers,presence,io}.ts         (branchements)
apps/client/src/games/{types.ts,game-ui.ts,GamePanel.tsx,GameFrame.tsx,GameLobby.tsx,InviteToast.tsx,Ladder.tsx}   + tests
apps/client/src/state/office-store.ts, net/office-connection.ts, office/{OfficeShell.tsx,panels.ts}, game/scenes/Office.ts, game/debug.ts
apps/client/src/i18n/fr.ts (section games), apps/client/src/styles.css (styles du cadre)
e2e/jeux-helpers.ts, e2e/jeux-plateforme.spec.ts, e2e/playwright.config.ts
```

### 12.2 Fichiers d'un jeu (agent du jeu, `<jeu>` = `chess`, `backgammon`, `connect4` ou `ludo`)

```text
packages/shared/src/games/<jeu>/index.ts        export const <jeu>: GameDefinition<…> ; ses types ; les aides dont son interface a besoin
packages/shared/src/games/<jeu>/*.ts            le moteur, découpé comme l'agent veut
packages/shared/src/games/<jeu>/rules.test.ts   les cas nommés C1, C2… (un test par cas, son numéro en tête du titre)
packages/shared/src/games/<jeu>/fuzz.test.ts    runGameConformance (JEUX_FUZZ)
packages/shared/src/games/<jeu>/replay.test.ts  parties enregistrées rejouées (fixtures/*.json)
packages/shared/src/games/<jeu>/fixtures/       journaux de parties (JSON)
apps/client/src/games/<jeu>/index.tsx           export default ui (satisfies GameUi<…>)
apps/client/src/games/<jeu>/*.tsx, *.ts         plateau, pièces, aides
apps/client/src/games/<jeu>/fr.ts               tous les textes du jeu (§ 12.3)
apps/client/src/games/<jeu>/<jeu>.css           ses styles (§ 12.4)
apps/client/src/games/<jeu>/*.test.tsx          tests de l'interface
e2e/jeux-<jeu>.spec.ts
```

Plus **une ligne** dans `packages/shared/src/games/registry.ts` : `export { <jeu> } from './<jeu>';`. Le module client importe ses règles par `@bureau/shared/games/<jeu>` ; il n'importe jamais un autre jeu.

### 12.3 Les textes

- `apps/client/src/i18n/fr.ts`, section `games` (G2) : tout ce qui est commun. Boutons (« S'asseoir », « Se lever », « Prêt », « Revanche », « Abandonner », « Proposer la nulle », « Accepter la nulle », « Refuser », « Inviter », « Regarder »), onglets, ligne d'état, comptes à rebours, invitations (`invitedTo` : `{ chess: 'aux échecs', backgammon: 'au backgammon', connect4: 'au Puissance 4', ludo: 'aux petits chevaux' }`), avis, erreurs de `GameAck`, raisons de plateforme (« Alice abandonne. », « Bastien n'a pas joué depuis 5 minutes. », « Bastien a quitté le bureau. », « Nulle par accord. »), classement, « Partie interrompue », « Bientôt disponible ».
- `apps/client/src/games/<jeu>/fr.ts` (agent) : tout ce qui est dans le plateau et propre au jeu. Noms des couleurs et des pièces, des cases (lecteur d'écran), des coups, aides (« coup possible », « Lancer les dés »), choix de promotion, liste des coups, raisons de fin du jeu (« Échec et mat », « Pat », « Gammon », « Quatre alignés », « Grille pleine »…), annonces, `rules`. Il importe `t` de `../../i18n/fr` sans modifier ce fichier.
- `label` du `GameDefinition` (dans `packages/shared`) : le nom du jeu, en français.

### 12.4 Les styles

- `apps/client/src/styles.css` (G2) : la largeur du panneau, le cadre, la salle d'attente, le classement.
- `apps/client/src/games/<jeu>/<jeu>.css` (agent), importé par son `index.tsx` : **tous les sélecteurs commencent par `.game-<jeu>`** ; seulement les jetons existants de `styles.css` (`var(--surface)`, `var(--accent)`…) et des variables locales déclarées sur `.game-<jeu>` (la palette de l'illustration) ; jamais `:root`, jamais un sélecteur d'élément nu, jamais un jeton redéfini. Un test de l'agent lit sa feuille et vérifie ces trois points (comme `office/ui/tokens.test.ts`).

### 12.5 Règles de travail des agents (G3 à G6)

1. **Préparer.** Dans le worktree : `pnpm install`. Lire ce document (§ 1 à § 12, puis son jeu), puis le code de G2 : `games/types.ts`, `conformance.ts`, `testing/tictactoe.ts` (le modèle d'un jeu complet), `apps/client/src/games/types.ts`, `GameFrame.tsx`, `e2e/jeux-helpers.ts`.
2. **Ne toucher qu'à ses dossiers** (§ 12.2) et à sa ligne du registre. Jamais un fichier de la plateforme, ni `fr.ts`, ni `styles.css`, ni le catalogue des sons, ni `package.json`, ni le verrou de pnpm. Un défaut de la plateforme qui bloque : le contourner dans son dossier si c'est possible, sinon s'arrêter, et le décrire (avec une reproduction) dans le rapport.
3. **Aucune dépendance nouvelle.** Aux échecs, `chess.js` n'est permis que si G2 l'a déjà ajouté et que le message de lancement le dit.
4. **Tests d'abord.** Dans cet ordre : cas nommés (rouges), moteur (verts), harnais, rejeu, tests de l'interface, interface, e2e.
5. **Ni serveur de développement ni bac à sable** : jamais `pnpm dev`, ni les ports 3056, 3057, 4000, 4100, 5173 et 5273. Seuls les tests et l'e2e, sur ses ports (§ 12.6).
6. **Trancher sans demander.** Une règle que ce document ne tranche pas : le choix le plus simple qui reste fidèle à la source citée, écrit dans un commentaire en français et dans le rapport.
7. **Français partout** : textes, commentaires du code (dans le style du dépôt : phrases complètes qui disent pourquoi), titres des tests. **Commits** dans son worktree, en français (`feat(jeux): échecs, règles et tests`), terminés par la ligne d'attribution demandée par l'outil ; jamais de push, jamais de fusion.
8. **Fini** quand `pnpm typecheck && pnpm test` passent, que `JEUX_FUZZ=10000` passe une fois, que l'e2e de son jeu passe, et que le critère d'acceptation de son jeu est rempli.

### 12.6 Commandes, ports, e2e

| Quoi | Commande |
|---|---|
| règles d'un jeu | `pnpm vitest run packages/shared/src/games/<jeu>` |
| interface d'un jeu | `pnpm vitest run apps/client/src/games/<jeu>` |
| 10 000 parties | `JEUX_FUZZ=10000 pnpm vitest run packages/shared/src/games/<jeu>/fuzz.test.ts` (noter la durée) |
| perft longs (échecs) | `JEUX_LONG=1 pnpm vitest run packages/shared/src/games/chess/perft.test.ts` |
| tout | `pnpm typecheck && pnpm test` |
| e2e d'un jeu | `E2E_PORT=<p> E2E_OFFICE_PORT=<p+1> pnpm e2e e2e/jeux-<jeu>.spec.ts` |

Ports e2e : échecs 3110 et 3111, backgammon 3120 et 3121, Puissance 4 3130 et 3131, petits chevaux 3140 et 3141 (3100 et 3101 restent à la session principale).

Parties au hasard dans `pnpm test` (sans `JEUX_FUZZ`) : échecs 100, backgammon 300, petits chevaux 300, Puissance 4 2 000 ; délai du test : 120 s.

Configuration Playwright (G2) : les specs `jeux-*` tournent sur le serveur de la vraie carte ; un projet `jeux-plateforme` (`jeux-plateforme.spec.ts`) passe d'abord, puis le projet `jeux` (les quatre jeux, `dependencies: ['jeux-plateforme']`). Chaque spec de jeu : `test.describe.configure({ mode: 'serial' })`, ne touche qu'à **sa** table, des comptes neufs (`joinOffice`), plusieurs navigateurs par `browser.newContext()`. Les specs lisent l'état par `window.__office.gameTable(game)` et fabriquent une fin de partie par `debugGame` quand une partie complète serait trop longue (dés).

### 12.7 Le rapport de l'agent (30 lignes au plus)

Ce qui marche ; ce qui est vérifié (commandes, nombres, durées : perft, 10 000 parties, e2e) ; ce qui ne l'est pas ; les règles tranchées en plus de ce document ; les défauts de la plateforme vus (reproduction) ; les captures du plateau à 440 px et à 375 px (chemins des fichiers produits par l'e2e).

### 12.8 Intégration (G7)

1. Fusionner les worktrees un à un ; le registre reçoit ses quatre lignes ; relancer `pnpm typecheck && pnpm test`, puis les e2e `jeux-*`.
2. Relire chaque moteur contre la partie de son jeu, cas nommé par cas nommé.
3. `JEUX_FUZZ=10000` sur les quatre jeux ; perft longs des échecs.
4. Un joueur qui joue aux quatre jeux a quatre notes ; l'onglet « Classement » de chaque table montre ses 10 premiers et son rang.
5. Captures : les quatre plateaux (jour et nuit, 440 px et 375 px), une partie avec spectateur, une invitation et l'arrivée à la table.

---

## 13. Échecs (`chess`, G3)

### 13.0 `chess.js` ou règles à la main

| Critère | `chess.js` 1.4.0 | Règles à la main |
|---|---|---|
| Licence | BSD-2-Clause [npm, GitHub] : usage libre, commercial compris ; garder la notice de copyright (une ligne dans `CREDITS.txt`) | — |
| Taille | 35 ko minifié, 11,7 ko gzip [bundlephobia] ; côté client, chargé avec le bureau (le registre des jeux est dans l'index partagé : peu de chose à côté des 1,4 Mo de Phaser) ; côté serveur, tsup devrait l'embarquer dans `dist` avec `@bureau/shared` (à vérifier par `pnpm build`, § 19) | environ 600 lignes à nous |
| Dépendances | aucune [npm] | — |
| Maintenance | 1.4.0 du 14 juin 2025, environ 168 000 téléchargements par semaine ; aucune version depuis 16 mois (bibliothèque stable) | à nous |
| API | `moves({ verbose: true })`, `move()` (lève sur un coup illégal), `isCheckmate`, `isStalemate`, `isInsufficientMaterial`, `isThreefoldRepetition`, `isDrawByFiftyMoves`, `perft`, FEN, SAN [code source] | à écrire |
| Écarts avec nos règles | sa répétition compte la case de prise en passant dès qu'un pion adverse est à côté, même cloué (la FIDE dit « coup possible », R10) ; recréé depuis un FEN, il oublie l'historique ; son matériel insuffisant est exactement R9 | aucun |
| Client et serveur | oui : TypeScript, ESM, sans API de Node | oui |
| Risque | faible ; une partie au hasard est lente (l'objet est recréé à chaque coup) | moyen : un bogue rare que perft ne voit pas (fins de partie, notation) ; le temps de l'agent |

**Recommandation : `chess.js`, enveloppé.** L'état reste notre JSON (FEN, coups, répétitions) ; la clé de répétition est la nôtre (FIDE) ; l'ordre des contrôles de fin est le nôtre (R12) ; `legalMoves` est la liste de `chess.js` mise à notre forme, et `apply` vérifie qu'un coup y figure avant de le jouer. **Sans l'accord d'Andrea, règles à la main** : même contrat, mêmes tests, perft en preuve. Conseils pour l'écrire : plateau 0x88 ou 10 × 12, génération pseudo-légale puis rejet des coups qui laissent son roi attaqué, jouer et déjouer sur place pour perft, `divide` (le nombre de feuilles par premier coup) pour trouver un écart, lecture et écriture du FEN, SAN avec désambiguïsation.

### 13.1 Règles retenues

| # | Règle | Source |
|---|---|---|
| R1 | Échiquier de 8 × 8, a1 sombre, position de départ habituelle. Le siège `first` a les Blancs, qui commencent. | FIDE 2 ; choix (qui a les Blancs) |
| R2 | Marche des pièces : roi, dame, tour, fou, cavalier, pion. | FIDE 3.1 à 3.8.1 |
| R3 | Prise en passant : un pion qui vient d'avancer de deux cases peut être pris comme s'il n'avait avancé que d'une, **au coup suivant seulement**. | FIDE 3.7.3.1, 3.7.3.2 |
| R4 | Promotion : un pion qui atteint la dernière rangée devient, au choix, dame, tour, fou ou cavalier, quelles que soient les pièces prises ; le coup doit dire la pièce. | FIDE 3.7.3.3 à 3.7.3.5 |
| R5 | Roque : droit perdu si le roi a bougé, ou avec une tour qui a bougé. Empêché si une case entre le roi et la tour est occupée, ou si la case du roi, celle qu'il traverse ou celle où il arrive est attaquée. La tour peut être attaquée ; au grand roque, b1 (b8) peut être attaquée mais doit être vide. Le droit disparaît aussi quand la tour est prise sur sa case de départ. | FIDE 3.8.2 ; choix d'écriture (FEN habituel) pour la tour prise |
| R6 | Aucun coup ne laisse son roi en échec, ni ne l'y met. | FIDE 3.9 |
| R7 | Mat : la partie est gagnée. | FIDE 5.1.1 |
| R8 | Pat (aucun coup légal, roi pas en échec) : nulle. | FIDE 5.2.1 |
| R9 | Matériel insuffisant, nulle immédiate quand il ne reste que : (a) les deux rois ; (b) les rois et un seul fou ; (c) les rois et un seul cavalier ; (d) les rois et des fous, d'un camp ou des deux, tous sur des cases de même couleur. Tout le reste continue (deux cavaliers contre roi, cavalier contre cavalier, etc.). | FIDE 5.2.2 réduit au matériel : choix de variante (comme chess.com et `chess.js`) |
| R10 | Triple répétition : nulle automatique dès qu'une position apparaît pour la 3e fois. Même position : même joueur au trait, mêmes pièces sur les mêmes cases, mêmes droits de roque, même possibilité de prise en passant ; la case de prise en passant ne compte que si une prise en passant est **légale** à ce moment. La position de départ compte pour une apparition. | FIDE 9.2.3 pour l'égalité ; automatique : choix de variante (FIDE 9.2 : sur réclamation, 9.6.1 : d'office à la 5e ; chess.com : d'office à la 3e) |
| R11 | Règle des 50 coups : nulle automatique après 50 coups de chaque camp (100 demi-coups) sans mouvement de pion ni prise. Un mat donné à ce demi-coup l'emporte. | FIDE 9.3, 9.6.2 ; automatique : choix de variante (chess.com : d'office à 50) |
| R12 | Après chaque coup, dans cet ordre, la première condition vraie décide : mat, pat, matériel insuffisant, triple répétition, 50 coups. | FIDE 9.6.2 (le mat d'abord) ; ordre des nulles : choix |
| R13 | Nulle par accord : seulement quand chaque camp a joué au moins un coup ; un joueur propose, à son tour ou non ; l'offre ne se retire pas ; elle tombe si l'adversaire refuse ou joue ; son auteur ne propose de nouveau qu'après avoir joué un coup. La plateforme le gère (`drawOffers: true`) ; le jeu fournit `agreeDraw`. | FIDE 5.2.3, 9.1.2.1 ; anti-répétition des offres : choix |
| R14 | Abandon, à tout moment, par l'un ou l'autre joueur : défaite. | plan ; écart à FIDE 5.1.2 (nulle si l'adversaire ne peut plus mater), choix de variante |
| R15 | Pas de pendule ; 5 min sans jouer : défaite de celui qui a le trait (§ 7). | plan, question 3 ; écart à FIDE 6.9, choix de variante |
| R16 | Notation à l'écran : algébrique abrégée avec les initiales françaises (R, D, T, F, C ; pion sans lettre), `0-0` et `0-0-0`, « + » échec, « # » mat, « =D » promotion. L'état garde la SAN anglaise standard. | FIDE annexe C.3 (chacun peut utiliser les initiales de son pays) |

### 13.2 Variantes et règles optionnelles écartées

- Pendule et cadences (hors périmètre, plan).
- Réclamation des nulles par répétition et 50 coups (FIDE 9.2, 9.3) : remplacée par la nulle automatique ; les seuils de 5 répétitions et 75 coups (FIDE 9.6) n'ont plus d'objet.
- Position morte au-delà du matériel (murs de pions…) : non détectée.
- Nulle au lieu de défaite quand l'adversaire ne peut plus mater, à l'abandon (FIDE 5.1.2) ou au temps (FIDE 6.9).
- Interdiction de la nulle par accord avant un nombre de coups (FIDE 9.1.1) : seulement « un coup chacun ».
- Reprise d'un coup, pré-coups, « pièce touchée, pièce jouée » (FIDE 4.3), échecs 960.

### 13.3 État et coups

```ts
// packages/shared/src/games/chess/index.ts (extraits)
export type Square = `${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Promotion = 'q' | 'r' | 'b' | 'n';
export interface ChessMove { from: Square; to: Square; promotion?: Promotion }   // le roque : le roi va en g1/c1 (g8/c8)
export interface ChessPly {
  from: Square;
  to: Square;
  promotion?: Promotion;
  san: string;            // SAN anglaise standard : « Nf3 », « exf6 », « O-O », « a8=Q+ », « Qxf7# »
  piece: PieceType;       // la pièce qui a bougé (le pion, pour une promotion)
  captured?: PieceType;
  castle?: 'k' | 'q';
  enPassant?: true;
  check?: true;
  mate?: true;
}
export interface ChessState {
  fen: string;                         // la position, FEN complète (6 champs)
  white: number;                       // le siège qui a les Blancs (= setup.first)
  plies: ChessPly[];                   // les demi-coups joués
  positions: Record<string, number>;   // clé de répétition → apparitions, depuis le dernier coup irréversible
  result: GameResult | null;
}
export type ChessEvent =
  | { type: 'move'; seat: number; ply: ChessPly }
  | { type: 'end'; reason: string; winner: number | null }
  | { type: 'forfeit'; seat: number; reason: ForfeitReason }
  | { type: 'draw' };
export const chessMoveSchema = z.object({
  from: z.string().regex(/^[a-h][1-8]$/),
  to: z.string().regex(/^[a-h][1-8]$/),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
});
```

- **Clé de répétition** (`positionKey`) : les champs 1 à 3 du FEN (placement, trait, roques), puis la case de prise en passant **seulement si une prise en passant est légale**, sinon `-`. Après 1.e4 : `rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -`.
- **`positions` repart de zéro** à chaque coup irréversible (mouvement de pion, prise, perte d'un droit de roque), avant de compter la nouvelle position : aucune position d'avant ne peut revenir. La table garde ainsi 101 entrées au plus.
- **Case de prise en passant du FEN** : deux usages existent (après toute avance de deux cases, ou seulement quand la prise est possible, comme `chess.js`). L'état garde ce que rend le moteur ; les tests comparent `positionKey` ou les champs 1 à 3, jamais ce champ seul.
- `create({ seats: 2, first })` : FEN de départ, `white = first`, `positions` avec la clé de départ à 1, aucun événement. `minPlayers = maxPlayers = 2`, `drawOffers = true`, `label = 'Échecs'`.
- `turn` : `null` si fini, sinon `white` quand les Blancs ont le trait, `1 − white` sinon.
- `legalMoves(state, seat)` : tous les coups légaux du camp au trait, une entrée par pièce de promotion (4 par promotion) ; `[]` si `seat` n'a pas le trait.
- `apply` : le coup doit figurer **exactement** dans `legalMoves` (mêmes `from`, `to`, `promotion`) ; sinon `{ ok: false, error: 'illegal' }`. Événements : `move`, puis `end` si la partie finit.
- `forfeit(state, seat, reason)` : `{ ranking: [[1 − seat], [seat]], reason }` ; événements `forfeit` puis `end`.
- `agreeDraw` : `{ ranking: [[0, 1]], reason: 'agreement' }` ; événements `draw` puis `end`.
- `countedMoves` : `plies.length`.
- `invariants` : FEN lisible ; un roi de chaque couleur ; aucun pion sur la 1re ni la 8e rangée ; le camp qui n'a pas le trait n'est pas en échec ; chaque droit de roque a son roi et sa tour sur leurs cases de départ ; une case de prise en passant est sur la 3e (Noirs au trait : 6e) rangée, vide, avec le pion qui vient d'avancer devant elle ; compteurs entiers (demi-coups ≥ 0, coups ≥ 1) ; la clé de la position courante est dans `positions` ; `result` non nul si et seulement si la partie est finie.

Exemples JSON (`white = 1`) :

```json
{ "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "white": 1, "plies": [],
  "positions": { "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": 1 }, "result": null }
```

```json
{ "from": "e2", "to": "e4" }
{ "from": "a7", "to": "a8", "promotion": "n" }
{ "type": "move", "seat": 1, "ply": { "from": "e2", "to": "e4", "san": "e4", "piece": "p" } }
{ "type": "end", "reason": "checkmate", "winner": 1 }
```

### 13.4 Fin de partie et résultat

| Raison (`reason`) | Classement | Texte (module client) |
|---|---|---|
| `checkmate` | [[gagnant], [perdant]] | « Échec et mat : {nom} gagne. » |
| `stalemate` | [[0, 1]] | « Pat : nulle. » |
| `insufficient` | [[0, 1]] | « Matériel insuffisant : nulle. » |
| `threefold` | [[0, 1]] | « Triple répétition : nulle. » |
| `fifty` | [[0, 1]] | « Règle des 50 coups : nulle. » |
| `agreement`, `resign`, `timeout`, `disconnect` | voir § 4.4 | textes de la plateforme |

### 13.5 Tests qui prouvent les règles

**Perft** (`perft.test.ts`), sur le moteur (`chess.js` : sa méthode `perft` ; à la main : le nôtre). Valeurs publiées [CPW] ; « long » = seulement avec `JEUX_LONG=1`, exigé pour l'acceptation (l'agent le lance une fois et donne la durée ; G7 le relance) ; le reste tourne dans `pnpm test`.

| Position (FEN) | Profondeur 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| départ `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` | 20 | 400 | 8 902 | 197 281 | 4 865 609 (long) |
| 2 « Kiwipete » `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1` | 48 | 2 039 | 97 862 | 4 085 603 (long) | — |
| 3 `8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1` | 14 | 191 | 2 812 | 43 238 | 674 624 |
| 4 `r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1` | 6 | 264 | 9 467 | 422 333 | 15 833 292 (long) |
| 4 en miroir `r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1` | 6 | 264 | 9 467 | 422 333 | — |
| 5 `rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8` | 44 | 1 486 | 62 379 | 2 103 487 (long) | — |
| 6 `r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10` | 46 | 2 079 | 89 890 | 3 894 594 (long) | — |

Pour chercher un écart (moteur à la main), le détail publié [CPW] : départ, profondeur 4 : 1 576 prises, 469 échecs, 8 mats ; profondeur 5 : 82 719 prises, 258 prises en passant, 27 351 échecs, 347 mats. Kiwipete, profondeur 2 : 351 prises, 1 en passant, 91 roques, 3 échecs ; profondeur 3 : 17 102 prises, 45 en passant, 3 162 roques, 993 échecs, 1 mat.

**Perft par l'API** (`perftApi`, à travers `legalMoves` et `apply`, états JSON) : départ, profondeur 3 = 8 902 ; Kiwipete, profondeur 2 = 2 039 ; position 3, profondeur 3 = 2 812. Il prouve l'enveloppe (promotions, roques, prise en passant mis à notre forme).

**Cas nommés** (`rules.test.ts`). Les coups sont écrits `de`+`vers`(+pièce) : `e2e4`, `a7a8q`.

| # | Situation | Attendu |
|---|---|---|
| C1 | `create({ seats: 2, first: 0 })` | FEN de départ, 20 coups légaux, `turn` = 0 |
| C2 | `create({ seats: 2, first: 1 })` | `white` = 1, `turn` = 1 ; `legalMoves(state, 0)` = [] |
| C3 | depuis le départ : `e2e4 d7d5 e4e5 f7f5` | position `rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6` ; `e5f6` légal, `e5d6` illégal ; après `e5f6`, le pion f5 a disparu (`rnbqkbnr/ppp1p1pp/5P2/3p4/8/8/PPPP1PPP/RNBQKBNR b KQkq`) |
| C4 | C3 puis `g1f3 b8c6` | `e5f6` illégal (prise en passant seulement au coup suivant) |
| C5 | `8/8/8/KPp4r/8/8/8/4k3 w - c6 0 2` | `b5c6` illégal (la prise découvrirait le roi a5) ; `positionKey` = celle du même FEN avec `-` |
| C6 | `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1` | `e1g1` et `e1c1` légaux ; après `e1g1` : roi g1, tour f1, roques `kq` |
| C7 | `r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1` | `e1g1` illégal (f1 attaquée), `e1c1` légal |
| C8 | `1r2k2r/8/8/8/8/8/8/R3K2R w KQk - 0 1` | `e1c1` légal (b1 attaquée, le roi ne la traverse pas) |
| C9 | `3rk2r/8/8/8/8/8/8/R3K2R w KQk - 0 1` | `e1c1` illégal (d1 attaquée), `e1g1` légal |
| C10 | `4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1` | ni `e1g1` ni `e1c1` (roi en échec) |
| C11 | `r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1` | `e1c1` illégal (cavalier en b1), `e1g1` légal |
| C12 | `4k2r/8/8/8/8/8/8/4K2R w Kk - 0 1` | `e1g1` légal (seule la tour h1 est attaquée) |
| C13 | C6 puis `e1e2 e8e7 e2e1 e7e8` | roques `-`, aucun roque légal |
| C14 | `r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1`, `g2h1` | roques `Qkq` |
| C15 | `4k3/P7/8/8/8/8/8/4K3 w - - 0 1` | 9 coups légaux, dont `a7a8q`, `a7a8r`, `a7a8b`, `a7a8n` ; `{ from: 'a7', to: 'a8' }` refusé ; `a7a8n` pose un cavalier blanc en a8 ; SAN : `a8=Q+`, `a8=R+`, `a8=B`, `a8=N` |
| C16 | au départ, `{ from: 'e2', to: 'e4', promotion: 'q' }` | refusé ; `promotion: 'k'` refusé par le schéma |
| C17 | `4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1` | coups légaux : `e1d1`, `e1d2`, `e1f1`, `e1f2` seulement (fou cloué) |
| C18 | `4k3/8/8/8/8/8/3r4/4K3 w - - 0 1` | coups légaux : `e1d2`, `e1f1` seulement |
| C19 | départ, `e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7` | mat ; le siège des Blancs gagne ; SAN du dernier coup `Qxf7#` |
| C20 | départ, `f2f3 e7e5 g2g4 d8h4` | mat ; le siège des Noirs gagne |
| C21 | `7k/5Q2/8/6K1/8/8/8/8 w - - 0 1`, `g5g6` | pat : nulle `stalemate` |
| C22 | départ, `e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6` (le pat de Sam Loyd en 10 coups) | pat au 19e demi-coup ; position `5bnr/4p1pq/4Qpkr/7p/7P/4P3/PPPP1PP1/RNB1KBNR b KQ` |
| C23 | `4k3/8/8/8/8/8/5r2/4KB2 w - - 0 1`, `e1f2` | nulle `insufficient` (roi et fou contre roi) |
| C24 | `5b1k/8/8/8/8/8/1r6/K1B5 w - - 0 1`, `a1b2` | nulle `insufficient` (fous c1 et f8 sur cases sombres) |
| C25 | `2b4k/8/8/8/8/8/1r6/K1B5 w - - 0 1`, `a1b2` | la partie continue (fous de couleurs opposées) |
| C26 | positions `6nk/8/8/8/8/8/8/KN6`, `7k/8/8/8/8/8/8/KNN5`, `7k/8/8/8/8/8/P7/K7` (Blancs au trait), un coup de roi | la partie continue |
| C27 | départ, `g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8` | nulle `threefold` au 8e demi-coup, pas avant |
| C28 | départ, `e2e4 g8f6 g1f3 f6g8 f3g1 g8f6 g1f3 f6g8 f3g1` | nulle `threefold` au 9e demi-coup : la position après 1.e4 compte malgré la case e3 du FEN (aucune prise possible). Une clé qui garde toujours la case e.p. ne trouve pas la nulle |
| C29 | `4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1`, `d7d5 e1e2 e8e7 e2e1 e7e8 e1e2 e8e7 e2e1 e7e8 e1e2` | nulle au 10e demi-coup, pas au 9e : après `d7d5`, `exd6` e.p. est possible, cette position n'est pas celle qui revient. Une clé sans case e.p. trouve la nulle trop tôt |
| C30 | `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1`, trois fois `e1e2 e8e7 e2e1 e7e8` | nulle au 10e demi-coup, pas au 8e (les droits de roque perdus changent la position) |
| C31 | `8/8/8/8/8/8/R7/K6k w - - 99 80`, `a2b2` | nulle `fifty` |
| C32 | `7k/8/6K1/8/8/8/8/R7 w - - 99 80`, `a1a8` | mat, pas nulle |
| C33 | `8/8/8/8/8/8/RP6/K6k w - - 99 80`, `b2b3` | compteur de demi-coups à 0, la partie continue |
| C34 | coup refusé : mauvais siège, case vide, pièce adverse, coup d'une autre position, partie finie | `{ ok: false }`, état égal à l'entrée |
| C35 | départ, `g1f3 d7d6 d2d3 e7e6`, puis `b1d2` | SAN `Nbd2` (et `f3d2` : `Nfd2`) ; affichage `Cbd2` |
| C36 | `forfeit(état, 0, 'resign')` ; `agreeDraw(état)` | [[1], [0]] raison `resign` ; [[0, 1]] raison `agreement` ; `turn` nul, `legalMoves` vides |
| C37 | aller-retour : `positionKey(fen)` stable ; `JSON.parse(JSON.stringify(état))` égal ; FEN relu puis réécrit identique (champs 1 à 4) | égalité |

**Rejeu** (`replay.test.ts`) : C19, C20 et C22 en fixtures ; trois parties au hasard du harnais (graines fixes), enregistrées en JSON puis rejouées : état final et résultat identiques.

**Harnais** (`fuzz.test.ts`) : `runGameConformance(chess, { games: Number(process.env.JEUX_FUZZ ?? 100), seats: [2], maxActions: 12_000, drawRate: 0.01, illegal })` ; `illegal` tire deux cases au hasard (et parfois une promotion). Une partie au hasard finit toujours grâce aux nulles automatiques ; 12 000 demi-coups n'arrivent jamais (une partie dure au plus environ 5 900 coups) : les atteindre est un bogue.

### 13.6 Interface

- **Plateau** 8 × 8, sa couleur en bas (spectateur : les Blancs en bas). Coordonnées discrètes (`--text-xs`) dans les cases du bord : lettres en bas, chiffres à gauche. 408 px : cases de 51 px ; 311 px : cases de 38 px.
- **Pièces** en pixel art, 16 × 16, ×3 sur ordinateur, ×2 sur téléphone ; deux couleurs plus un contour, lisibles sur les deux couleurs de case. Nom accessible : « roi blanc », « dame noire »…
- **Jouer** : un clic sur une de ses pièces la sélectionne (contour) et montre ses cases d'arrivée (un point pour un coup simple, un anneau pour une prise, prise en passant et roque compris) ; un clic sur une case d'arrivée joue ; un clic sur une autre de ses pièces change la sélection ; ailleurs, la sélection tombe. Le roque se joue en amenant le roi sur g1/c1. Une promotion ouvre un petit choix (Dame, Tour, Fou, Cavalier ; focus sur Dame ; `Échap` annule) avant l'envoi. Glisser-déposer : facultatif.
- **Dernier coup** : ses deux cases teintées. **Échec** : la case du roi cerclée de rouge.
- **Pièces prises** : au-dessus et au-dessous du plateau, côté de qui les a prises, triées par valeur, avec l'avance matérielle (« +3 » ; pion 1, cavalier 3, fou 3, tour 5, dame 9).
- **Coups** : une liste repliable sous le plateau, numérotée, en deux colonnes, notation française (R16), le dernier en évidence ; repliée sur téléphone.
- **Clavier** : `role="grid"` nommée « Échiquier », 64 boutons ; les flèches suivent l'écran (haut = vers l'adversaire de qui regarde) ; `Entrée`/`Espace` sélectionne puis joue ; `Échap` annule. Après un coup, le focus reste sur la case d'arrivée.
- **Lecteur d'écran** : « e4, pion blanc, coup possible » ; annonces en mots : « Alice : cavalier en f3. », « Bastien : pion e5 prend d6 en passant, échec. », « Alice : petit roque. », « Bastien : promotion en dame en a8. ».
- **Sons** : `piece` à chaque coup (`sounds`).
- **Mouvement réduit** : pas de glissement des pièces.

### 13.7 Pièges propres aux échecs

- Le client n'envoie jamais de SAN : seulement `from`, `to`, `promotion`. Avec `chess.js`, `move()` lève sur un coup illégal : l'enveloppe vérifie d'abord la liste et attrape toute erreur.
- `legalMoves` est coûteux : le plateau le mémorise par `state.fen`.
- L'orientation des Noirs inverse aussi les flèches du clavier et les coordonnées.
- La table `positions` repart de zéro aussi quand un droit de roque se perd (C30), et la case e.p. n'entre dans la clé que si la prise est légale (C5, C28, C29).
- « Proposer la nulle » n'apparaît qu'après un coup de chaque camp (R13).

### 13.8 Critère d'acceptation

Toutes les valeurs perft du tableau (longues comprises), les trois perft par l'API et les cas C1 à C37 passent ; 10 000 parties au hasard sans état illégal, toutes finies, et rejouées à l'identique ; l'e2e `jeux-chess.spec.ts`, à deux navigateurs : Alice invite Bastien, il accepte et apparaît à la table, tous deux prêts, le mat du berger (C19) joué à la souris jusqu'au mat, le classement montre 1216 et 1184 une seule fois, la revanche échange les couleurs, un abandon finit la partie, un troisième navigateur spectateur voit les coups ; un test d'interface joue une promotion entièrement au clavier ; à 375 px, ni défilement horizontal ni cible sous 24 px.

---

## 14. Backgammon (`backgammon`, G4)

### 14.1 Règles retenues

| # | Règle | Source |
|---|---|---|
| R1 | 24 points, 15 pions par joueur. Chacun numérote les points de 1 à 24 depuis sa maison : son point 24 est le point 1 de l'adversaire. Départ : 2 pions sur son 24, 5 sur son 13, 3 sur son 8, 5 sur son 6. Siège 0 : les Blancs ; siège 1 : les Rouges. | bkgm (Setup) ; noms des couleurs : choix |
| R2 | Les pions avancent toujours vers les petits numéros. But : tout ramener dans sa maison (points 1 à 6), puis sortir ; le premier qui a sorti ses 15 pions gagne. | bkgm (Object) |
| R3 | Ouverture : chacun lance un dé, on relance les égalités ; le plus haut commence et joue ces deux dés-là, sans nouveau lancer. Tirée dans `create` ; `first` est ignoré. | bkgm (Movement) |
| R4 | Ensuite, à son tour : on lance deux dés (`roll`), puis on joue. Chaque dé est un déplacement à part ; un même pion peut jouer les deux si la case intermédiaire est ouverte. | bkgm |
| R5 | Une case est ouverte si elle n'a pas deux pions adverses ou plus. | bkgm |
| R6 | Un doublé se joue quatre fois. | bkgm |
| R7 | Jouer les deux dés si c'est possible (les quatre pour un doublé) ; si un seul peut l'être, le jouer ; si l'un ou l'autre peut l'être mais pas les deux, jouer le plus grand ; si aucun, le tour est perdu ; un doublé : en jouer autant que possible. | bkgm |
| R8 | Un pion seul (« blot ») sur la case d'arrivée est frappé : il part sur la barre. | bkgm (Hitting) |
| R9 | Avec un pion sur la barre, on doit d'abord l'entrer dans la maison adverse : le dé d donne sa case 25 − d. Impossible : le tour est perdu. On entre autant de pions que possible ; une fois tous entrés, les dés restants se jouent avec n'importe quel pion. | bkgm |
| R10 | Sortie, seulement quand tous ses pions encore en jeu sont dans sa maison (aucun sur la barre) : un dé sort un pion du point de même numéro ; sans pion sur ce point, il faut jouer un pion d'un point plus haut ; sans pion plus haut, on sort le pion du point le plus haut (c'est permis et obligatoire). On n'est pas obligé de sortir si un autre coup est possible. Un pion frappé pendant la sortie doit rentrer et revenir à la maison avant que la sortie reprenne. Le dernier pion qui entre dans la maison permet déjà de sortir avec le dé suivant du même tour. | bkgm (Bearing off) ; même tour : lecture de bkgm (« une fois tous ses pions dans la maison ») |
| R11 | Fin : 15 pions sortis. Gammon : le perdant n'a sorti aucun pion ; backgammon : en plus, il a un pion sur la barre ou dans la maison du gagnant. Affichés, comptés **victoire simple** au classement. | bkgm (Gammons) ; classement : plan |
| R12 | Aucun coup possible après un lancer : le tour passe tout seul (événement `pass`). | bkgm (« loses his turn ») ; automatique : choix |
| R13 | Abandon : défaite simple. | plan ; choix (abandonner « un gammon » : écarté) |
| R14 | Pas de nulle. | bkgm |

### 14.2 Variantes et règles optionnelles écartées

- **Le videau** (cube) et ses options (doubles automatiques, « beaver », règle Jacoby). Il ne change que la mise. Notre classement compte une victoire simple quel que soit l'enjeu : le videau n'y changerait rien. Il ajouterait trois états (offre, acceptation, refus = défaite) et leur interface, plus un piège (refuser un double vaut abandon). D'accord avec le plan : pas de videau en v1.
- Matchs en points et règle de Crawford ; abandon d'un gammon ou d'un backgammon ; règles d'irrégularités du jeu physique (dé cassé, jeu incomplet accepté) ; reprise d'un tour validé.

### 14.3 État et coups

```ts
// packages/shared/src/games/backgammon/index.ts (extraits)
export type BgPoint = number;                     // 1 à 24, dans la numérotation du joueur qui joue
export interface BgStep { from: BgPoint | 'bar'; to: BgPoint | 'off'; die: number }
export type BackgammonMove = { type: 'roll' } | { type: 'play'; steps: BgStep[] };
export interface BackgammonState {
  points: number[];          // 24 cases ; index i = point i + 1 du siège 0 ; > 0 : pions du siège 0, < 0 : pions du siège 1
  bar: [number, number];     // pions sur la barre, par siège
  off: [number, number];     // pions sortis, par siège
  turn: 0 | 1;
  phase: 'roll' | 'move' | 'over';
  dice: number[];            // [] en phase roll ; [a, b] sinon (un doublé reste [d, d] et se joue quatre fois)
  opening: Array<[number, number]>;   // les lancers d'ouverture, égalités comprises : [dé du siège 0, dé du siège 1]
  turns: number;             // tours joués (coups comptés)
  last: { seat: 0 | 1; dice: number[]; steps: BgStep[] } | null;   // le dernier tour joué, pour l'afficher
  result: GameResult | null;
}
export type BackgammonEvent =
  | { type: 'opening'; rolls: Array<[number, number]>; first: 0 | 1 }
  | { type: 'dice'; seat: 0 | 1; values: [number, number] }
  | { type: 'step'; seat: 0 | 1; from: BgPoint | 'bar'; to: BgPoint | 'off'; die: number; hit: boolean }
  | { type: 'pass'; seat: 0 | 1 }
  | { type: 'end'; winner: 0 | 1; kind: 'simple' | 'gammon' | 'backgammon' }
  | { type: 'forfeit'; seat: 0 | 1; reason: ForfeitReason };
const point = z.number().int().min(1).max(24);
export const backgammonMoveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roll') }),
  z.object({
    type: z.literal('play'),
    steps: z.array(z.object({ from: z.union([point, z.literal('bar')]), to: z.union([point, z.literal('off')]), die: z.number().int().min(1).max(6) })).min(1).max(4),
  }),
]);
```

- **Numérotation.** Le point p du siège 0 est `points[p − 1]` ; le point p du siège 1 est `points[24 − p]` (son point p est le point 25 − p du siège 0). Tous les coups et événements parlent dans la numérotation de **qui joue**. Départ : `points = [-2,0,0,0,0,5,0,3,0,0,0,-5,5,0,0,0,-3,0,-5,0,0,0,0,2]`.
- `create` : lancers d'ouverture avec `rollDie`, dé du siège 0 puis dé du siège 1, jusqu'à deux valeurs différentes ; `turn` = le plus haut ; `phase: 'move'`, `dice` = les deux dés ; événement `opening`. `minPlayers = maxPlayers = 2`, `drawOffers = false`, `label = 'Backgammon'`.
- Phase `roll` : `legalMoves` = `[{ type: 'roll' }]`. `apply(roll)` : deux `rollDie`, événement `dice` ; si aucun déplacement n'est possible, événement `pass`, le tour passe (phase `roll` de l'autre) ; sinon phase `move`.
- Phase `move` : `legalMoves` = **un `play` par position finale différente** (une suite d'étapes qui y mène). `apply(play)` n'exige pas cette suite-là : il rejoue les étapes dans l'ordre reçu ; chacune doit être légale sur la position du moment, avec un dé encore disponible ; le nombre d'étapes doit être le maximum jouable de ce tour (R7) ; si ce maximum est 1, avec deux dés différents, et que le plus grand se joue seul, l'étape doit utiliser le plus grand. Puis : 15 pions sortis → fin ; sinon le tour passe (phase `roll`, `dice: []`).
- Aides exportées pour l'interface : `nextSteps(state, done: BgStep[]): BgStep[]` (les étapes suivantes qui laissent encore finir un tour légal : un préfixe d'une suite légale maximale), `previewSteps(state, steps)` (la position après ces étapes, sans hasard), `pipCount(state, seat)`, et la conversion des numérotations.
- `countedMoves` : `turns` (un `play` accepté ; ni lancer ni tour passé).
- `forfeit` : `{ ranking: [[1 − seat], [seat]], reason, detail: { kind: 'simple' } }`.
- `invariants` : 24 cases ; pour chaque siège, plateau + barre + sortis = 15 ; barre et sortis entre 0 et 15 ; phase `roll` ⇒ `dice` vide ; phase `move` ⇒ deux dés de 1 à 6 ; phase `over` ⇔ `result` non nul ; 15 sortis ⇒ ce siège a gagné ; `opening` non vide, sa dernière paire sans égalité.

Exemples JSON (ouverture 3-3 relancée, puis 5-2 : le siège 0 commence) :

```json
{ "points": [-2,0,0,0,0,5,0,3,0,0,0,-5,5,0,0,0,-3,0,-5,0,0,0,0,2], "bar": [0, 0], "off": [0, 0], "turn": 0,
  "phase": "move", "dice": [5, 2], "opening": [[3, 3], [5, 2]], "turns": 0, "last": null, "result": null }
```

```json
{ "type": "roll" }
{ "type": "play", "steps": [{ "from": 13, "to": 8, "die": 5 }, { "from": 13, "to": 11, "die": 2 }] }
{ "type": "play", "steps": [{ "from": "bar", "to": 20, "die": 5 }, { "from": 20, "to": 14, "die": 6 }] }
{ "type": "step", "seat": 0, "from": 13, "to": 8, "die": 5, "hit": false }
{ "type": "end", "winner": 0, "kind": "gammon" }
```

### 14.4 Fin de partie et résultat

| Raison | Classement | Détail | Texte (module client) |
|---|---|---|---|
| `bearoff` | [[gagnant], [perdant]] | `kind` : `simple`, `gammon` ou `backgammon` | « {nom} a sorti tous ses pions. » + « Gammon ! » ou « Backgammon ! » |
| `resign`, `timeout`, `disconnect` | [[autre], [siège]] | `kind: 'simple'` | textes de la plateforme |

### 14.5 Tests qui prouvent les règles

Positions écrites dans la numérotation de chaque joueur : « Blancs {9: 1}, sortis 14 » = un pion blanc sur le point 9 des Blancs. Un outil de test de l'agent fabrique l'état (`points` signé) à partir de cette écriture. Sauf mention, les Blancs (siège 0) ont le trait, en phase `move`, avec les dés indiqués.

| # | Situation | Attendu |
|---|---|---|
| C1 | `create` | `points` de départ (§ 14.3), `bar` et `off` à zéro ; course (pip count) de 167 pour chacun |
| C2 | ouverture avec `rngFromDice([3, 3, 5, 2])` | `opening` = [[3, 3], [5, 2]], `turn` = 0, `dice` = [5, 2], phase `move`, événement `opening` |
| C3 | départ, dés [6, 6] | 11 positions finales différentes, chaque `play` a 4 étapes |
| C4 | départ, dés [3, 1] · [2, 1] · [6, 5] | 16 · 15 · 7 positions finales différentes ; aucune suite à un seul dé |
| C5 | départ, dés [6, 5], `play` avec la seule étape 24→18 | refusé (les deux dés se jouent) |
| C6 | Blancs {9: 1}, sortis 14 ; Rouges {24: 2, 6: 13} ; dés [6, 2] | seul `play` légal : 9→3 (6). 9→7 (2) seul : refusé (le plus grand dé) |
| C7 | Blancs {9: 1}, sortis 14 ; Rouges {22: 2, 24: 2, 6: 11} ; dés [6, 2] | seul `play` légal : 9→7 (2) (le 6 ne se joue pas) |
| C8 | Blancs {13: 1}, sortis 14 ; Rouges {22: 2, 6: 13} ; dés [5, 5] | seul `play` légal : 13→8 (un seul des quatre 5) |
| C9 | Blancs {13: 1}, sortis 14 ; Rouges {6: 15} ; dés [5, 5] | `play` 13→8, 8→3, 3→sortie (trois 5) ; victoire `bearoff`, `kind: 'gammon'` |
| C10 | comme C9, Rouges {24: 1, 6: 14} | `kind: 'backgammon'` (un pion rouge dans la maison des Blancs) |
| C11 | comme C9, Rouges sortis 1, {6: 14} | `kind: 'simple'` |
| C12 | Blancs barre 1, {6: 5, 8: 3, 13: 5, 24: 1} ; Rouges {6: 5, 8: 3, 13: 5, 24: 2} ; dés [6, 1] | exactement trois `play` : barre→24 (1) puis 24→18, 13→7 ou 8→2 (6) ; une suite qui ne commence pas par la barre : refusée |
| C13 | même position, phase `roll`, `rngFromDice([6, 6])` | événement `pass`, le tour passe aux Rouges (phase `roll`) |
| C14 | Blancs barre 2, {6: 5, 8: 3, 13: 5} ; Rouges comme C12 ; dés [6, 1] | seul `play` légal : barre→24 (1) |
| C15 | Blancs {13: 15} ; Rouges {17: 1, 6: 14} ; dés [5, 1], étape 13→8 | frappé : Rouges barre 1 ; le point 8 des Blancs a 1 pion blanc |
| C16 | Blancs {13: 15} ; Rouges {17: 2, 6: 13} ; dés [5, 1] | aucune étape 13→8 (point bloqué) |
| C17 | Blancs {13: 1}, sortis 14 ; Rouges {17: 2, 15: 2, 6: 11} ; phase `roll`, `rngFromDice([5, 3])` | aucun coup : `pass` |
| C18 | Blancs {13: 1}, sortis 14 ; Rouges {17: 2, 6: 13} ; dés [5, 3] | seul `play` légal : 13→10 (3), 10→5 (5) |
| C19 | Blancs {6: 1, 3: 1}, sortis 13 ; Rouges {6: 15} ; dés [4, 1] | aucune suite ne contient « 3→sortie avec le 4 » ; deux positions finales : {3, 1} et {2, 2} |
| C20 | Blancs {3: 1, 2: 1}, sortis 13 ; dés [6, 5] | les deux ordres sortent les deux pions ; victoire |
| C21 | Blancs {7: 1, 3: 1}, sortis 13 ; Rouges {6: 15} ; dés [6, 3] | exactement : 7→1 (6) puis 3→sortie (3), ou 7→4 (3) puis 4→sortie (6) ; aucune sortie avant que le 7 soit rentré |
| C22 | Blancs {2: 1}, barre 1, sortis 13 ; Rouges {22: 1, 6: 14} ; dés [6, 5] | seul `play` légal : barre→20 (5), 20→14 (6) (pas de sortie avec un pion dehors) |
| C23 | départ, dés [6, 1] : 13→7 puis 8→7, ou 8→7 puis 13→7 | les deux ordres acceptés, même position finale |
| C24 | `play` en phase `roll`, `roll` en phase `move`, un dé non tiré, une suite plus courte que le maximum, le mauvais siège | `{ ok: false }`, état inchangé |
| C25 | `forfeit(état, 1, 'resign')` | [[0], [1]], raison `resign`, `kind: 'simple'` |
| C26 | `nextSteps` sur C12 sans étape faite | seulement barre→24 ; après elle : 24→18, 13→7, 8→2 |
| C27 | course (`pipCount` : somme des numéros des points de ses pions, 25 pour un pion sur la barre, 0 pour un pion sorti) : au départ | 167 pour chacun ; dans C15, la course des Rouges passe de 101 à 109 |

**Rejeu** : deux parties du harnais (graines fixes) enregistrées en fixtures, rejouées à l'identique.

**Harnais** : `runGameConformance(backgammon, { games: Number(process.env.JEUX_FUZZ ?? 300), seats: [2], maxActions: 20_000, illegal, sameOutcome })` ; `illegal` fabrique un `play` d'étapes tirées au hasard ; `sameOutcome` compare `points`, `bar`, `off`, `turn`, `phase`, `dice` et `result`, sans `last` (l'ordre des étapes).

### 14.6 Interface

- **Plateau** en SVG dessiné en code : 24 flèches de deux couleurs, la barre au milieu, la zone de sortie à droite ; **sa maison en bas à droite** (spectateur : celle des Blancs). Les numéros des points, dans sa numérotation, en petit le long des bords.
- **Pions** : disques ivoire et rouge brique en pixel art ; une pile montre 5 pions au plus, puis « +n » sur le dernier.
- **Dés** : deux dés à points, dessinés en code, dans la moitié du plateau de qui joue ; un doublé montre « ×2 » ; un dé utilisé s'estompe.
- **Lancer** : le bouton « Lancer les dés », au centre du plateau, quand c'est à soi en phase `roll`. Les dés roulent environ 600 ms (faces décoratives tirées par le client), puis se posent sur les valeurs du serveur ; mouvement réduit : les valeurs tout de suite.
- **Jouer son tour** : un pion jouable est discrètement souligné ; un clic le prend, ses arrivées possibles (`nextSteps`) s'éclairent, un clic sur l'une fait l'étape en aperçu (`previewSteps`). Les étapes faites s'écrivent sous le plateau (« 13→8, 13→11 »). « Annuler » défait la dernière étape ; « Valider » envoie le `play`, actif quand le tour est complet (le nombre de dés jouables atteint). Aucun coup possible : « Aucun coup possible » s'affiche 1,5 s, annoncé.
- **Dernier tour de l'adversaire** : rejoué étape par étape (200 ms par pion ; mouvement réduit : tout de suite), les pions déplacés soulignés jusqu'à sa prochaine action.
- **Course** : « Course : toi 142 · Bastien 156 ».
- **Téléphone** : flèches de 24 px de large au moins, barre de 12 px, zone de sortie remplacée par un bouton « Sortir » sous le plateau et le nombre de pions sortis en texte ; environ 300 × 260 px.
- **Clavier** : le focus parcourt la barre, les points 24 à 1 (dans sa numérotation) et la sortie ; gauche et droite suivent l'écran, haut et bas passent d'une rangée à l'autre ; `Entrée` prend un pion puis le pose ; `Échap` annule ; « Lancer », « Annuler » et « Valider » sont des boutons ordinaires.
- **Lecteur d'écran** : « Point 13 : 5 pions blancs, jouable » ; « Barre : 1 pion rouge » ; annonces : « Alice lance 5 et 3. », « Alice joue 13 vers 8, 13 vers 10, et frappe. », « Bastien ne peut pas jouer. ».
- **Sons** : `dice` à chaque lancer (ouverture comprise), `piece` à chaque étape animée.

### 14.7 Pièges propres au backgammon

- **Les deux numérotations** sont la première source de bogues : tout calcul passe par une seule fonction de conversion, testée seule ; l'entrée depuis la barre est la case 25 − d de qui joue.
- Un doublé est stocké `[d, d]` mais se joue quatre fois.
- R7 se décide sur le tour entier : un premier pas qui empêcherait d'utiliser le maximum de dés est illégal, même s'il est légal seul ; l'interface ne le propose donc pas (`nextSteps`).
- Le tour sans coup passe côté serveur, dans le `roll` : le client ne doit rien attendre de plus de ce joueur.
- Aucun hasard côté client : seules les faces qui roulent à l'écran.
- L'ouverture relance tant qu'il y a égalité : un générateur constant la ferait tourner sans fin. Les tests donnent assez de valeurs à `scriptedRng` (qui lève quand il n'en a plus) ou utilisent `seededRng`.

### 14.8 Critère d'acceptation

Les cas C1 à C27 passent ; 10 000 parties au hasard sans état illégal, toutes finies, rejouées à l'identique ; l'e2e `jeux-backgammon.spec.ts`, à deux navigateurs : partie lancée par invitation, un vrai tour joué à la souris (lancer, deux étapes, valider), puis `debugGame` pose une fin de partie (C9) avec ses dés : le dernier tour est joué à la souris, « Gammon » s'affiche, le classement change une fois (+16 / −16), la revanche part ; en mouvement réduit (`page.emulateMedia({ reducedMotion: 'reduce' })`), les dés s'affichent sans rouler ; à 375 px, ni défilement horizontal ni cible sous 24 px.

---

## 15. Puissance 4 (`connect4`, G5)

### 15.1 Règles retenues

| # | Règle | Source |
|---|---|---|
| R1 | Grille verticale de 7 colonnes sur 6 rangées, deux joueurs ; siège 0 rouge, siège 1 jaune. | Wikipédia Connect Four ; couleurs : choix |
| R2 | À son tour, on lâche un jeton dans une colonne qui n'est pas pleine : il tombe dans la plus basse case libre. | Wikipédia |
| R3 | Le premier qui aligne quatre jetons ou plus, horizontalement, verticalement ou en diagonale, gagne. | Wikipédia |
| R4 | Grille pleine sans alignement : nulle. Un alignement fait par le 42e jeton est une victoire. | Wikipédia ; le 42e jeton : la victoire se constate avant la grille pleine (choix d'écriture) |
| R5 | Qui commence : `first` (tiré au sort à la première partie, puis alternance). Les couleurs restent attachées aux sièges. | la règle ne fixe pas qui commence [sources secondaires] ; le premier joueur gagne avec un jeu parfait (jeu résolu) [Wikipédia], d'où l'alternance : choix |
| R6 | Abandon : défaite. Pas de nulle par accord. | plan ; choix |

### 15.2 Variantes écartées

PopOut, Pop 10, « Power Up », cinq en ligne, grilles d'autres tailles [Wikipédia, variantes].

### 15.3 État et coups

```ts
// packages/shared/src/games/connect4/index.ts (extraits)
export interface Connect4State {
  cells: number[];          // 42 cases, index = colonne × 6 + rangée (rangée 0 en bas) ; 0 vide, 1 siège 0, 2 siège 1
  first: 0 | 1;
  moves: number[];          // les colonnes jouées, dans l'ordre
  winLine: number[];        // index des cases alignées par le dernier jeton (toutes ses lignes de 4 ou plus), triés ; [] sinon
  result: GameResult | null;
}
export interface Connect4Move { col: number }   // 0 à 6
export type Connect4Event =
  | { type: 'drop'; seat: 0 | 1; col: number; row: number }
  | { type: 'end'; winner: 0 | 1 | null; cells: number[] }
  | { type: 'forfeit'; seat: 0 | 1; reason: ForfeitReason };
export const connect4MoveSchema = z.object({ col: z.number().int().min(0).max(6) });
```

- `create({ seats: 2, first })` : 42 cases vides, `moves: []`. `minPlayers = maxPlayers = 2`, `drawOffers = false`, `label = 'Puissance 4'`.
- `turn` : `null` si fini, sinon `first` quand `moves.length` est pair, l'autre sinon (jamais stocké à part).
- `legalMoves` : les colonnes non pleines.
- `apply` : colonne pleine → `illegal` ; le jeton tombe ; on cherche, à partir de la case posée, les lignes de 4 ou plus dans les quatre directions et on les réunit (une ligne de 5, deux lignes à la fois) ; victoire, sinon nulle au 42e jeton.
- `countedMoves` : `moves.length`. `forfeit` : [[autre], [siège]].
- `invariants` : 42 valeurs de 0 à 2 ; aucun trou sous un jeton ; jetons du premier joueur − jetons de l'autre ∈ {0, 1} ; rejouer `moves` sur une grille vide redonne `cells` ; aucune ligne de 4 sur la grille, sauf celle qui a fini la partie (elle contient le dernier jeton) ; `result` non nul si et seulement si la partie est finie.

Exemples JSON : `{ "cells": [42 zéros], "first": 1, "moves": [], "winLine": [], "result": null }` ; coup `{ "col": 3 }` ; événement `{ "type": "drop", "seat": 1, "col": 3, "row": 0 }`.

### 15.4 Fin de partie et résultat

| Raison | Classement | Détail | Texte (module client) |
|---|---|---|---|
| `four` | [[gagnant], [perdant]] | `cells` : `winLine` | « Quatre alignés : {nom} gagne. » |
| `full` | [[0, 1]] | — | « Grille pleine : nulle. » |
| `resign`, `timeout`, `disconnect` | [[autre], [siège]] | — | textes de la plateforme |

### 15.5 Tests qui prouvent les règles

Séquences de colonnes (0 à 6), le premier joueur d'abord. Chaque cas tourne avec `first = 0` puis `first = 1` : le gagnant est toujours le siège qui a commencé (ou l'autre, selon le cas).

| # | Séquence | Attendu |
|---|---|---|
| C1 | `create` | grille vide, `turn = first`, 7 coups légaux |
| C2 | `3` | jeton en colonne 3, rangée 0 ; puis `3` : rangée 1 |
| C3 | six fois `0`, puis `0` | le 7e est refusé (colonne pleine) ; `legalMoves` n'a plus la colonne 0 |
| C4 | `3 4 3 4 3 4 3` | victoire du premier joueur au 7e jeton, verticale (3,0) à (3,3) |
| C5 | `0 0 1 1 2 2 3` | victoire au 7e jeton, horizontale (0,0) à (3,0) |
| C6 | `0 1 1 2 3 2 2 3 6 3 3` | victoire au 11e jeton, diagonale (0,0) (1,1) (2,2) (3,3) |
| C7 | `6 5 5 4 3 4 4 3 0 3 3` | victoire au 11e jeton, diagonale (6,0) (5,1) (4,2) (3,3) |
| C8 | `0 0 1 1 3 3 4 6 2` | victoire au 9e jeton ; `winLine` a 5 cases : (0,0) à (4,0) |
| C9 | `3 0 2 0 5 0 6 2 0 4 6 1 0 2 6 0 4 1 3 5 4 3 5 2 1 5 6` | victoire du premier joueur au 27e jeton ; `winLine` réunit 7 cases : la verticale (6,0) à (6,3) et la diagonale (3,0) (4,1) (5,2) (6,3) |
| C10 | `0 2 2 2 2 2 2 0 0 0 0 0 1 3 3 3 3 3 3 1 1 1 1 1 4 6 6 6 6 6 6 4 4 4 4 4 5 5 5 5 5 5` | grille pleine, aucun alignement : nulle `full`, [[0, 1]] |
| C11 | `1 2 4 6 5 2 1 0 2 5 4 0 6 5 4 1 5 2 1 6 3 4 0 4 5 2 5 4 6 2 6 3 6 0 1 1 0 0 3 3 3 3` | victoire du second joueur au 42e jeton (rangée du haut, (0,5) à (4,5)), pas nulle |
| C12 | C4 puis un coup | refusé (partie finie) |
| C13 | un coup du siège qui n'a pas le trait | refusé, état inchangé |
| C14 | `forfeit(état, 0, 'timeout')` | [[1], [0]], raison `timeout` |
| C15 | aller-retour JSON ; `invariants` d'une grille avec un trou ou trop de jetons d'une couleur | égalité ; violations listées |

**Rejeu** : C9, C10 et C11 en fixtures, plus deux parties du harnais.

**Harnais** : `runGameConformance(connect4, { games: Number(process.env.JEUX_FUZZ ?? 2_000), seats: [2], maxActions: 42, illegal })` ; `illegal` joue une colonne pleine ou hors de 0 à 6.

### 15.6 Interface

- **Grille** 7 × 6 dessinée en code (cadre bleu, trous ronds), jetons rouges et jaunes en pixel art ; cases de 58 px (408 px), de 44 px (311 px).
- **Jouer** : chaque colonne entière est un bouton ; au survol ou au focus, un jeton fantôme de sa couleur au-dessus d'elle ; un clic lâche le jeton. Une colonne pleine est inactive (« Colonne pleine »). Spectateur : pas de fantôme.
- **Chute** : le jeton tombe (environ 250 ms, accélération, petit rebond) ; mouvement réduit : il est posé tout de suite.
- **Dernier jeton** cerclé ; **ligne gagnante** soulignée (pulsation ; mouvement réduit : contour épais fixe).
- **Clavier** : les 7 colonnes forment un groupe nommé « Colonnes » à tabindex mobile ; gauche et droite, `Début` et `Fin` ; `Entrée`/`Espace` lâche ; les chiffres 1 à 7 lâchent dans cette colonne quand la grille a le focus (`0` reste au zoom).
- **Lecteur d'écran** : « Colonne 4 : rouge, jaune, rouge ; 3 places libres » (de bas en haut) ; annonces : « Alice joue en colonne 4. », « Quatre alignés : Alice gagne. », « Grille pleine : nulle. ».
- **Sons** : `piece` à chaque jeton.

### 15.7 Pièges propres au Puissance 4

- L'état range la rangée 0 en bas ; l'écran dessine la rangée 5 en haut : une seule fonction de passage.
- La victoire se cherche autour du dernier jeton seulement, mais dans les quatre directions, et réunit toutes les lignes (C8, C9).
- Le 42e jeton peut gagner (C11) : chercher l'alignement avant de conclure à la nulle.
- Le trait se déduit de `moves.length` et `first` : jamais un champ de plus qui pourrait diverger.

### 15.8 Critère d'acceptation

Les cas C1 à C15 passent ; 10 000 parties au hasard sans état illégal, toutes finies, rejouées à l'identique ; l'e2e `jeux-connect4.spec.ts` porte aussi la vérification « partie complète et classement » retirée de G2 : à deux navigateurs, invitation acceptée, arrivée à la table, une partie jouée à la souris jusqu'à la victoire (C4), classement 1216 et 1184 une seule fois, revanche où l'autre commence, un abandon, puis une nulle (`debugGame` pose C10 moins son dernier jeton, le dernier est joué à la souris : « Grille pleine ») ; à 375 px, ni défilement horizontal ni cible sous 24 px.

---

## 16. Petits chevaux (`ludo`, G6)

### 16.1 Règles retenues : la variante « bureau »

Le jeu des petits chevaux a autant de règles que d'éditeurs [Wikipédia FR]. La règle française la plus répandue (escalier numéroté de 1 à 6, chaque marche au chiffre exact, puis un 6 pour la coupe) demande sept chiffres exacts d'affilée, soit environ 42 lancers par cheval pour la seule montée (mon calcul) : trop long pour une pause. J'ai retenu une variante proche du Ludo [Wikipédia EN], courte (15 à 25 minutes), avec peu de règles à retenir et une vraie part de choix (quel cheval jouer, sortir ou prendre).

| # | Règle | Source |
|---|---|---|
| R1 | 2 à 4 joueurs, 4 chevaux chacun. Couleurs, dans le sens des aiguilles d'une montre : rouge (0), vert (1), jaune (2), bleu (3). À 2 : rouge et jaune (face à face) ; à 3 : rouge, vert, jaune ; à 4 : les quatre. Le siège k a la couleur `colors[k]`. | Wikipédia FR (2 à 4 joueurs) ; couleurs et placement : choix (à 2, couleurs opposées : la même distance entre eux) |
| R2 | Plateau en croix de 15 × 15 cases : une piste de 52 cases parcourue dans le sens des aiguilles d'une montre ; chaque couleur a son écurie (un coin), sa case de départ sur la piste, et son allée de 5 cases vers l'arrivée (le centre). Un cheval fait le tour (51 cases après son départ), entre dans son allée, puis arrive. | Wikipédia FR (le tour du plateau, puis sa dernière allée) ; Wikipédia EN (géométrie 52 + 5) ; choix (le plan du Ludo plutôt que l'escalier numéroté) |
| R3 | À son tour, on lance un dé (`roll`), puis on avance **un seul** cheval du nombre de points. | Wikipédia FR |
| R4 | Sortir un cheval de l'écurie demande un 6 : il se pose sur sa case de départ (le 6 sert à la sortie). | Wikipédia FR |
| R5 | Un 6 donne un nouveau lancer, même s'il n'a pas pu être joué. Au troisième 6 de suite dans un même tour, ce 6 n'est pas joué et le tour passe. | Wikipédia FR (6 = rejouer) ; Wikipédia EN (3e six : le tour passe) ; écarté : « éliminer un de ses pions » (Wikipédia FR) |
| R6 | Trois essais : sans cheval en jeu (tous à l'écurie ou arrivés), on a jusqu'à trois lancers dans le tour pour faire un 6. Et, sans cheval en jeu, le dé fait 6 deux fois sur six (les cinq autres faces, 4/30 chacune) ; avec un cheval en jeu, il est juste. | Wikipédia EN (règle maison répandue) ; choix (accélère le début) ; le 6 deux fois sur six : demande d'Andréa du 26 octobre 2026 (« ça permet d'éviter d'avoir des parties qui traînent en longueur ») |
| R7 | On doit jouer si un coup est possible, et on choisit le cheval. Sans coup possible, le tour passe (sauf R5 et R6). | Wikipédia FR, EN |
| R8 | Prise : un cheval qui s'arrête sur une case de la piste occupée par un cheval adverse le renvoie dans son écurie, y compris en sortant sur sa case de départ. Aucune case n'est protégée. Rien ne se prend dans les allées. | Wikipédia FR ; aucune case protégée : choix (les cases étoilées sûres de Wikipédia EN : écartées) |
| R9 | Jamais deux chevaux d'une même couleur sur une même case (piste ou allée) : un coup qui finirait sur un de ses chevaux est interdit. Donc ni empilement ni barrage. L'arrivée, elle, reçoit les quatre. | choix de variante (Wikipédia FR : on s'arrête juste derrière ; Wikipédia EN : empilement en bloc) |
| R10 | On passe librement par-dessus tous les chevaux. | Wikipédia FR, EN (rien n'interdit de passer, faute de barrage) |
| R11 | Arrivée au compte exact : un coup qui dépasserait l'arrivée est interdit. | Wikipédia EN (« exact number ») ; écarté : le rebond (Wikipédia FR) |
| R12 | Fin : dès qu'un joueur a ses quatre chevaux arrivés, il gagne et la partie s'arrête (même sur un 6). Les autres sont classés à leur avancée : la somme, pour leurs 4 chevaux, de 0 à l'écurie, avancée + 1 en piste ou dans l'allée, 57 arrivé ; à égalité, ex æquo. | choix de variante (Wikipédia EN : les autres continuent souvent pour les places ; écarté : une partie deux fois plus longue) |
| R13 | Qui commence : `first` ; ensuite, dans l'ordre des sièges. | choix (Wikipédia EN : le plus haut lancer commence) |
| R14 | Un joueur qui sort de la partie (abandon, inactivité, départ) : ses chevaux quittent le plateau, son tour est sauté, il est classé derrière tous ceux qui restent (le dernier sorti devant ceux sortis avant lui). S'il ne reste qu'un joueur, il gagne. | plan (« abandon = défaite ») ; le reste : choix |

### 16.2 Variantes et règles optionnelles écartées

L'escalier numéroté de 1 à 6 au chiffre exact (règle française) ; le rebond à l'arrivée ; l'élimination d'un cheval au troisième 6 ; les barrages et les blocs ; « s'arrêter derrière son propre cheval » ; les cases protégées ; la sortie sur un 1 ; les deux dés ; rejouer après une prise ou une arrivée ; jouer jusqu'au dernier pour les places ; gagner avec un seul cheval.

### 16.3 État et coups

```ts
// packages/shared/src/games/ludo/index.ts (extraits)
// Avancée d'un cheval : −1 écurie ; 0 à 50 piste (0 = sa case de départ) ; 51 à 55 son allée ; 56 arrivé.
export const LUDO_TRACK = 52, LUDO_HOME = 56;
export const LUDO_START = [0, 13, 26, 39] as const;                 // case de départ de chaque couleur sur la piste
export const LUDO_COLORS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] } as const;
export interface LudoState {
  colors: number[];                    // la couleur de chaque siège : 0 rouge, 1 vert, 2 jaune, 3 bleu
  horses: number[][];                  // horses[siège][cheval] : son avancée
  turn: number;
  phase: 'roll' | 'move' | 'over';
  die: number | null;                  // le dé à jouer en phase move ; null sinon
  sixes: number;                       // 6 déjà tirés dans ce tour
  tries: number;                       // lancers faits dans ce tour sans cheval en jeu
  out: Array<{ seat: number; reason: ForfeitReason }>;   // sièges sortis, dans l'ordre
  moves: number;                       // chevaux déplacés (coups comptés)
  last: { seat: number; horse: number; from: number; to: number; captured?: { seat: number; horse: number } } | null;
  result: GameResult | null;
}
export type LudoMove = { type: 'roll' } | { type: 'move'; horse: number };
export type LudoEvent =
  | { type: 'dice'; seat: number; value: number }
  | { type: 'move'; seat: number; horse: number; from: number; to: number }    // from = −1 : une sortie
  | { type: 'capture'; seat: number; victim: { seat: number; horse: number } }
  | { type: 'pass'; seat: number; reason: 'no-move' | 'retry' | 'bonus' | 'third-six' }
  | { type: 'turn'; seat: number }
  | { type: 'end'; ranking: number[][] }
  | { type: 'forfeit'; seat: number; reason: ForfeitReason };
export const ludoMoveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roll') }),
  z.object({ type: z.literal('move'), horse: z.number().int().min(0).max(3) }),
]);
```

**Case de piste** d'un cheval de couleur c à l'avancée p (0 à 50) : `(LUDO_START[c] + p) % 52`. Deux chevaux se rencontrent seulement sur la piste, par cette case ; l'allée et l'arrivée sont propres à chaque couleur. Deux chevaux d'une même couleur ne partagent jamais une avancée de 0 à 55.

**Le tour, exactement** :

```text
roll (phase roll, siège = turn) :
  enJeu = un cheval du siège a une avancée de 0 à 55
  d = rollLudoDie(rng, enJeu) ; événement dice
    (une seule valeur v du générateur ; f = 1 + ⌊6v⌋ ; si non enJeu et f ≠ 6 et 6v − (f − 1) ≥ 4/5 : d = 6, sinon d = f)
  si d = 6 : sixes + 1 ; si sixes = 3 : événement pass « third-six », tour suivant, fin
  si non enJeu : tries + 1
  coups = coupsLégaux(d)
  si coups non vide : phase move, die = d
  sinon si d = 6 : événement pass « bonus » (même siège, phase roll)
  sinon si non enJeu et tries < 3 : événement pass « retry » (même siège, phase roll)
  sinon : événement pass « no-move », tour suivant
move (phase move, cheval h ∈ coupsLégaux(die), sinon illegal) :
  de = son avancée ; vers = (de = −1 ? 0 : de + die)
  moves + 1, last, événement move
  si vers ≤ 50 et un cheval adverse est sur cette case de piste : il retourne à l'écurie (−1), événement capture
  si ses 4 chevaux sont arrivés : fin (R12), événement end
  sinon si die = 6 : phase roll, die = null (même siège ; sixes garde son compte)
  sinon : tour suivant
coupsLégaux(d), chevaux pris dans l'ordre 0 à 3 :
  à l'écurie : si d = 6 et aucun de ses chevaux en 0 ; une seule sortie listée (le premier cheval à l'écurie)
  avancée p de 0 à 55 : p + d ≤ 56, et si p + d ≤ 55, aucun de ses chevaux à p + d
  arrivé : rien
tour suivant : turn = le siège suivant qui n'est pas sorti ; phase roll ; die = null ; sixes = 0 ; tries = 0 ; événement turn
```

- `create({ seats, first })` : `colors = LUDO_COLORS[seats]`, chevaux à −1, `turn = first`, phase `roll`, aucun événement. `minPlayers = 2`, `maxPlayers = 4`, `drawOffers = false`, `label = 'Petits chevaux'`.
- `legalMoves` : `[{ type: 'roll' }]` en phase `roll` ; en phase `move`, un `{ type: 'move', horse }` par cheval jouable.
- `forfeit(state, seat, reason)` : `out` reçoit le siège, ses chevaux passent à −1 (ils ne sont plus dessinés : son écurie s'affiche grisée, « sorti ») ; s'il ne reste qu'un siège, fin ; sinon, si c'était son tour, tour suivant. Événements `forfeit`, puis `turn` ou `end`.
- `countedMoves` : `moves`.
- `invariants` : `colors` = `LUDO_COLORS[nombre de sièges]` ; 4 chevaux par siège, avancées de −1 à 56 ; jamais deux chevaux d'une couleur à la même avancée de 0 à 55 ; jamais deux chevaux sur une même case de piste ; sièges sortis uniques, tous leurs chevaux à −1 ; `turn` n'est pas un siège sorti (sauf fin) ; phase `roll` ⇒ `die` nul ; phase `move` ⇒ `die` de 1 à 6 et au moins un coup légal ; `sixes` de 0 à 2 ; `tries` de 0 à 3 ; phase `over` ⇔ `result` non nul.

Exemples JSON (3 joueurs, le siège 1 commence) :

```json
{ "colors": [0, 1, 2], "horses": [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]], "turn": 1, "phase": "roll",
  "die": null, "sixes": 0, "tries": 0, "out": [], "moves": 0, "last": null, "result": null }
```

```json
{ "type": "roll" }
{ "type": "move", "horse": 2 }
{ "type": "dice", "seat": 1, "value": 6 }
{ "type": "move", "seat": 1, "horse": 0, "from": -1, "to": 0 }
{ "type": "capture", "seat": 0, "victim": { "seat": 1, "horse": 0 } }
{ "type": "pass", "seat": 2, "reason": "retry" }
```

### 16.4 Fin de partie et résultat

| Raison | Quand | Classement | Détail |
|---|---|---|---|
| `finished` | un siège a ses 4 chevaux arrivés | [[gagnant], puis les autres sièges restés par avancée décroissante (ex æquo groupés), puis les sortis du dernier au premier] | `scores` : l'avancée de chaque siège |
| `resign`, `timeout`, `disconnect` | une sortie ne laisse qu'un siège | [[le dernier resté], puis les sortis du dernier au premier] | `scores` |

Texte (module client) : « {nom} a ramené ses quatre chevaux. » ; pour une sortie, le texte de la plateforme. Le panneau montre ensuite le classement complet, avec les avancées.

### 16.5 Tests qui prouvent les règles

Les états sont fabriqués par un outil de test de l'agent (avancées par siège). Dés imposés par `scriptedRng(rngFromDice([…]))`.

| # | Situation | Attendu |
|---|---|---|
| C1 | `create({ seats: 4, first: 2 })` | couleurs [0, 1, 2, 3], chevaux à −1, `turn` = 2, phase `roll` |
| C2 | `create` à 2 et à 3 | couleurs [0, 2] et [0, 1, 2] |
| C3 | siège 0 tout à l'écurie, dé 6 | phase `move`, un seul coup : sortir le cheval 0 ; après lui : avancée 0, même siège en phase `roll`, `sixes` = 1 |
| C4 | tout à l'écurie, dés 3, 2, 5 | `pass` « retry », « retry », puis « no-move » ; le tour passe ; `tries` revient à 0 |
| C5 | tout à l'écurie, dés 1, 2, 6 | au troisième lancer, la sortie est jouable |
| C6 | un cheval à l'avancée 10, dés 6, 6, 6 | deux coups joués, puis `pass` « third-six » ; le tour passe ; le troisième 6 ne bouge rien ; `sixes` revient à 0 |
| C7 | chevaux à 56, 56, 56 et 53, dé 6 | aucun coup (53 + 6 > 56) : `pass` « bonus », même siège en phase `roll` |
| C8 | 4 joueurs ; rouge (siège 0) à l'avancée 10 ; vert (siège 1) à l'avancée 1 (case de piste 14) ; rouge tire 4 | prise : le cheval vert retourne à l'écurie, événement `capture` |
| C9 | 4 joueurs ; vert à l'avancée 39 (case 0, le départ des rouges) ; rouge tout à l'écurie tire 6 | la sortie prend le cheval vert |
| C10 | 4 joueurs ; vert à l'avancée 45 (case 6) ; rouge à l'avancée 2 tire 4 | prise (tour de piste : (13 + 45) mod 52 = 6) |
| C11 | rouge à 5 et à 8, dé 3 | seul le cheval à 8 est jouable |
| C12 | rouge un cheval à 0 et trois à l'écurie, dé 6 | pas de sortie (sa case de départ est prise par lui) ; seul coup : le cheval à 0 va à 6 |
| C13 | 2 joueurs ; rouge à 5 ; jaune (siège 1) à l'avancée 33 (case 7) ; rouge tire 4 | rouge passe par-dessus et s'arrête en case 9, sans prise |
| C14 | rouge un cheval à 54, les autres à l'écurie ; dé 2, puis (autre état) dé 3 | 2 : arrivée ; 3 : aucun coup (compte exact), un cheval en jeu donc pas d'essai de plus : `pass` « no-move », le tour passe |
| C15 | rouge à l'avancée 51 (son allée) ; aucun adversaire ne peut l'atteindre | jamais pris ; aucun cheval adverse n'a d'avancée qui mène dans une allée rouge |
| C16 | 4 joueurs ; siège 0 : 56, 56, 56, 55 ; siège 1 : 20, 21, −1, −1 ; siège 2 : 42, −1, −1, −1 ; siège 3 : 5, −1, −1, −1 ; siège 0 tire 1 | fin `finished` ; avancées 228, 43, 43, 6 ; classement [[0], [1, 2], [3]] |
| C17 | 4 joueurs, pendant le tour du siège 1, `forfeit(état, 2, 'resign')`, puis le siège 1 finit son tour | chevaux du siège 2 à −1, `out` = [{ seat: 2, reason: 'resign' }] ; après le siège 1 vient le siège 3 ; la partie continue |
| C18 | 3 joueurs : le siège 1, puis le siège 2 sortent | fin ; classement [[0], [2], [1]], raison de la dernière sortie |
| C19 | 2 joueurs : `forfeit(état, 1, 'timeout')` | [[0], [1]], raison `timeout` |
| C20 | `move` en phase `roll`, `roll` en phase `move`, un cheval arrivé ou bloqué, le mauvais siège | `{ ok: false }`, état inchangé ; `horse: 4` refusé par le schéma |
| C21 | trois chevaux à l'écurie et un 6 | `legalMoves` n'a qu'une sortie (le premier cheval à l'écurie) |
| C22 | deux chevaux arrivés, deux à l'écurie ; dés 2, 4, 1 | les arrivés ne sont pas « en jeu » : trois essais, puis le tour passe |
| C23 | un 6 joué, puis un 2 | le tour passe ; au tour suivant, `sixes` et `tries` sont à 0 |
| C24 | aller-retour JSON ; `invariants` de deux chevaux sur une même case de piste, d'un siège sorti avec un cheval en piste | égalité ; violations listées |
| C49 | 6 000 lancers d'un générateur à graine, sans cheval en jeu (tout à l'écurie, ou des arrivés et le reste à l'écurie), puis avec un cheval en jeu | sans : le 6 entre 31 % et 36 %, chaque autre face entre 11,5 % et 15,5 % ; avec : chaque face entre 14 % et 19 % |
| C50 | les dés imposés `rngFromDice([d])`, avec et sans cheval en jeu ; les bords de la part du 3 | toujours la face d ; sans cheval en jeu, le dernier cinquième de la part du 3 fait un 6 |

**Rejeu** : trois parties du harnais (2, 3 et 4 joueurs, graines fixes) enregistrées en fixtures, rejouées à l'identique.

**Harnais** : `runGameConformance(ludo, { games: Number(process.env.JEUX_FUZZ ?? 300), seats: [2, 3, 4], maxActions: 100_000, forfeitRate: 0.1, illegal })` ; `illegal` choisit un cheval au hasard en phase `move`, ou `move` en phase `roll`.

### 16.6 Interface

- **Plateau** 15 × 15 dessiné en code. Coordonnées (colonne, rangée), depuis le coin haut gauche. La piste, case par case (vérifiée : 52 cases différentes, chacune voisine de la suivante ; les quatre pas en diagonale contournent les coins du centre) :

  | Cases | Coordonnées |
  |---|---|
  | 0 à 4 | (1, 6) → (5, 6) |
  | 5 à 10 | (6, 5) → (6, 0) |
  | 11 | (7, 0) |
  | 12 à 17 | (8, 0) → (8, 5) |
  | 18 à 23 | (9, 6) → (14, 6) |
  | 24 | (14, 7) |
  | 25 à 30 | (14, 8) → (9, 8) |
  | 31 à 36 | (8, 9) → (8, 14) |
  | 37 | (7, 14) |
  | 38 à 43 | (6, 14) → (6, 9) |
  | 44 à 49 | (5, 8) → (0, 8) |
  | 50 | (0, 7) |
  | 51 | (0, 6) |

  Départs : rouge (1, 6) = case 0, vert (8, 1) = 13, jaune (13, 8) = 26, bleu (6, 13) = 39. Allées (avancées 51 à 55) : rouge (1, 7) → (5, 7), vert (7, 1) → (7, 5), jaune (13, 7) → (9, 7), bleu (7, 13) → (7, 9). Arrivée : le carré central (6 à 8, 6 à 8), un triangle par couleur. Écuries : les coins de 6 × 6 (rouge en haut à gauche, vert en haut à droite, jaune en bas à droite, bleu en bas à gauche).
- **Orientation** : souhaitable, une rotation par quarts de tour qui amène son écurie en bas à gauche ; spectateur : sans rotation.
- **Chevaux** : têtes de cheval en pixel art (12 × 12) de leur couleur ; un par case de piste ; 4 places dans l'écurie ; les arrivés dans le triangle de leur couleur, avec leur nombre.
- **Dé** : un dé à points ; « Lancer le dé » quand c'est à soi en phase `roll` ; il roule environ 600 ms (mouvement réduit : tout de suite) ; petits repères « 2e six », « encore 2 essais ».
- **Choisir** : les chevaux jouables sont soulignés ; survoler ou viser l'un montre sa case d'arrivée ; un clic le joue (un cheval n'a qu'une arrivée par dé). **Sous le plateau, la liste des coups en boutons** : « Sortir un cheval », « Cheval 2 : avancer de 4, prise ! », « Cheval 3 : arrivée ». C'est le chemin du clavier, du lecteur d'écran et du téléphone : ici, les cases ne sont pas focalisables une à une, le plateau est une image dotée d'un équivalent texte (« Position des chevaux » : par couleur, l'écurie, les cases, les arrivés).
- **Animations** : le cheval saute de case en case (80 ms par case ; mouvement réduit : tout de suite) ; un cheval pris revient à son écurie (300 ms).
- **Lecteur d'écran** : annonces « Alice lance un 6. », « Alice sort un cheval. », « Bastien prend un cheval d'Alice. », « Claire ne peut pas jouer. », « Troisième 6 : le tour passe. », « Encore un lancer. ».
- **Téléphone** : cases de 20 px, chevaux de 16 px ; on joue par la liste de coups (boutons de 44 px de haut).
- **Sons** : `dice` à chaque lancer, `piece` à chaque déplacement, sortie et prise.

### 16.7 Pièges propres aux petits chevaux

- Avancée et case de piste : une seule fonction de passage ; les rencontres se jugent sur la case de piste, et seulement pour les avancées de 0 à 50.
- Siège ≠ couleur : à 2 joueurs, le siège 1 est jaune.
- L'enchaînement 6 / troisième 6 / trois essais : les cas C3 à C7, C22 et C23 le fixent, sans interprétation.
- La partie s'arrête dès le quatrième cheval arrivé, même sur un 6 : pas de lancer de plus.
- Une sortie de joueur retire ses chevaux sans événement `capture`, et le tour ne revient jamais à lui.

### 16.8 Critère d'acceptation

Les cas C1 à C24 passent ; 10 000 parties au hasard à 2, 3 et 4 joueurs, avec sorties, sans état illégal, toutes finies, rejouées à l'identique ; l'e2e `jeux-ludo.spec.ts`, à trois navigateurs : invitations, un vrai tour de chacun (lancer, puis coup ou tour passé), Claire abandonne (ses chevaux disparaissent, la partie continue à deux), puis `debugGame` pose une fin proche et ses dés : le dernier coup est joué à la souris, le classement complet s'affiche (trois lignes), le classement Elo change une fois (+16, 0, −16 pour trois joueurs à 1200) ; à 375 px, on joue par la liste de coups, sans défilement horizontal.

---

## 17. Sources

- [FIDE] FIDE, *Laws of Chess*, en vigueur depuis le 1er janvier 2023 : <https://handbook.fide.com/chapter/E012023> (articles 2, 3, 5, 6.9, 9, annexe C).
- [CPW] Chess Programming Wiki, *Perft Results* : <https://www.chessprogramming.org/Perft_Results>.
- [chess.com] *How do draws work?* (nulles automatiques à la 3e répétition et aux 50 coups) : <https://support.chess.com/en/articles/8572743-how-do-draws-work>.
- [npm, GitHub, bundlephobia] `chess.js` : <https://www.npmjs.com/package/chess.js>, <https://github.com/jhlywa/chess.js>, <https://bundlephobia.com/package/chess.js@1.4.0>.
- [bkgm] *Backgammon Rules*, bkgm.com : <https://www.bkgm.com/rules.html>.
- [Wikipédia] *Connect Four* : <https://en.wikipedia.org/wiki/Connect_Four>.
- [Wikipédia FR] *Jeu des petits chevaux* : <https://fr.wikipedia.org/wiki/Jeu_des_petits_chevaux>.
- [Wikipédia EN] *Ludo* : <https://en.wikipedia.org/wiki/Ludo>.
- [Wikipédia Elo] *Elo rating system* : <https://en.wikipedia.org/wiki/Elo_rating_system>.
- [WCAG] *Web Content Accessibility Guidelines 2.2* (1.4.1, 1.4.11, 2.5.8) : <https://www.w3.org/TR/WCAG22/>.
- [APG] *ARIA Authoring Practices Guide*, motif « grid » : <https://www.w3.org/WAI/ARIA/apg/patterns/grid/>.
- [plan] [`docs/superpowers/plans/2026-10-22-bureau-pieces-modes-jeux.md`](../plans/2026-10-22-bureau-pieces-modes-jeux.md) (tâches G1 à G7, T6, T7, T13, contraintes globales).

## 18. Questions ouvertes

Rien ici ne bloque la construction ; chaque point a un choix par défaut.

1. Annoncer les résultats dans le chat « Tout le monde » (« Alice a battu Bastien aux échecs ») ? Par défaut : non.
2. Un statut automatique « En partie » pendant une partie (pastille du panneau Personnes) ? Par défaut : non.
3. Montrer la note à côté du nom des joueurs pendant la partie ? Par défaut : seulement dans l'onglet « Classement » et en fin de partie.
4. Revanche à 3 ou 4 joueurs : seul le premier joueur tourne, les couleurs restent aux chaises. À changer si l'on préfère faire tourner les couleurs.
5. Une partie de moins de 2 coups est écrite en base (`ranked: false`) : utile pour l'historique, inutile pour le classement. La garder ?
6. Un son de défaite ? Le pack retenu par T7 n'en prévoit pas : rien ne sonne pour le perdant.
7. Une seule table par jeu (plan) : deux parties d'échecs à la fois sont impossibles. Plusieurs tables par jeu : hors périmètre.
8. Les chaises oubliées se libèrent après 10 min (ajout de ce document). Garder cette durée ?

## 19. Ce que je n'ai pas pu vérifier

- **T6, T7 et T13 ne sont pas encore codées** : `freeSpotIn`, `placeAt`, `Place`, `OfficeMap.tables` (et la forme de `GameTable`), les sons `dice`, `piece`, `win`, `teleport`, l'utilitaire `teleport.ts` et `move:correct.reason` viennent du plan, pas du code. G2 s'aligne sur ce qui aura été écrit.
- **`chess.js` n'a pas été exécuté** (pas de téléchargement dans cette tâche) : j'ai lu son code source sur GitHub (`perft`, `isInsufficientMaterial`, `isThreefoldRepetition` et sa clé de répétition) et ses métadonnées npm et bundlephobia. Sa vitesse (perft 5, 10 000 parties) et son passage dans le build du serveur (tsup, `pnpm deploy`) sont à mesurer par G2 et G3.
- **Valeurs perft** : reprises du Chess Programming Wiki ; je les ai recontrôlées jusqu'aux profondeurs 3 et 4 (selon la position) avec un petit générateur écrit pour l'occasion, hors du dépôt ; les profondeurs 4 et 5 restantes ne sont pas recontrôlées.
- **Positions et séquences du document** : vérifiées par des scripts hors du dépôt (générateur d'échecs validé par perft, énumérateur de backgammon, simulateur de Puissance 4, simulateur des petits chevaux qui suit l'algorithme du § 16.3, tracé de la piste). Ces scripts ne sont pas des preuves indépendantes des règles : ils vérifient que les cas sont cohérents avec ce document.
- **Règles des petits chevaux** : Wikipédia (français et anglais) seulement ; aucune règle d'éditeur consultée.
- **Qui commence au Puissance 4** : le livret de Hasbro n'a pas été trouvé ; sources secondaires.
- **Interface** : la lisibilité des petits chevaux à 20 px par case, le confort tactile du backgammon à 24 px par flèche et la place réelle du panneau de 440 px avec la caméra centrée sur la table sont à juger à l'œil, sur capture.
- **Durées** : 10 000 parties d'échecs au hasard prendront plusieurs minutes (estimation, surtout avec `chess.js`) ; les perft « longs » aussi.
