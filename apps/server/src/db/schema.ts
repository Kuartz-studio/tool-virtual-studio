import type { GameId, GameResult, MatchLogEntry, PlacedItem, Role, TaskView, XpSource } from '@bureau/shared';
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

// Le schéma complet de la base : drizzle-kit en tire les migrations (drizzle/), createDb le donne à Drizzle.
// Les tables de Better Auth (user, session, account, verification, rateLimit) sont générées dans auth-schema.ts
// par sa CLI, depuis la configuration de src/auth/auth.cli.ts : ne pas modifier ce fichier à la main.
export * from './auth-schema';

// Une invitation à créer un compte. Seule l'empreinte sha256 du jeton est enregistrée : le jeton lui-même ne figure
// que dans le lien envoyé par e-mail.
export const invitation = pgTable('invitation', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),                       // en minuscules
  tokenHash: text('token_hash').notNull().unique(),     // sha256 du jeton, en hexadécimal
  role: text('role').$type<Role>().notNull(),
  invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),   // null : invitation créée par la commande
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// Les messages du canal « Tout le monde » (« À proximité » n'est pas conservé).
export const chatMessage = pgTable(
  'chat_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chat_message_created_at_idx').on(table.createdAt)],
);

// Les bureaux occupés : une ligne par place prise. `key` est le nom de la zone desk de la carte (A1…), `ownerId` celui qui l'occupe (une
// seule place par personne : unique), `name` le nom qu'il lui a donné (null : le nom par défaut) et `locked` si la porte est fermée.
// Une place libre n'a pas de ligne. Qui est exclu ou admis n'est pas enregistré : cela vaut le temps du serveur.
export const desk = pgTable('desk', {
  key: text('key').primaryKey(),
  ownerId: text('owner_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name'),
  locked: boolean('locked').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Le décor de la pièce d'une personne (sol, murs, éléments posés) : il lui appartient, pas à la place. Il la suit quand elle déménage, et
// il est conservé quand elle rend son bureau (elle le retrouve à sa prochaine place) ; il part avec son compte. Une personne qui n'a rien
// réglé n'a pas de ligne : sa pièce montre alors le poste par défaut (DEFAULT_DESK_DECOR). `items` est la liste [{ id, x, y }] des éléments
// posés, déjà validée par checkDecor avant d'arriver ici.
export const deskSetup = pgTable('desk_setup', {
  ownerId: text('owner_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  floor: text('floor').notNull(),
  wall: text('wall').notNull(),
  items: jsonb('items').$type<PlacedItem[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Les états d'activité qu'une personne crée (« En focus », « À table »…) : un nom, la couleur de son point, une icône facultative, un emplacement
// facultatif (le lieu où le mode conduit), et trois interrupteurs (laisser entrer dans son bureau, entendre, être entendue). Ils lui appartiennent, et
// partent avec son compte.
export const activityState = pgTable(
  'activity_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    color: text('color').notNull(),   // « #rrggbb », en minuscules
    icon: text('icon'),   // un nom de ACTIVITY_ICONS ; null : pas d'icône, le point de la couleur
    place: text('place'),   // la clé d'une destination de la carte (la salle de sport) où ce mode conduit ; null : on ne bouge pas
    allowEntry: boolean('allow_entry').notNull().default(true),
    hear: boolean('hear').notNull().default(true),
    heard: boolean('heard').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('activity_state_user_id_idx').on(table.userId)],
);

// La lumière du bureau, la même pour tout le monde : une seule ligne (id = 1), écrite au premier changement. Sans ligne, la lumière est
// allumée. `changedBy` est celui qui l'a changée en dernier (null si son compte n'existe plus), `changedAt` le moment du changement.
export const officeLights = pgTable('office_lights', {
  id: integer('id').primaryKey().default(1),
  on: boolean('on').notNull().default(true),
  changedBy: text('changed_by').references(() => user.id, { onDelete: 'set null' }),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

// La musique de chaque pièce, que ceux qui y sont règlent pour tous : une ligne par pièce touchée (la clé du lieu : `game`, `desk:A1`), écrite au premier
// changement. Sans ligne, la pièce est allumée avec son ambiance par défaut. `scene` est l'ambiance choisie (null : celle par défaut de la pièce), `changedBy`
// celui qui l'a réglée en dernier (null si son compte n'existe plus), `changedAt` le moment du changement.
export const roomMusic = pgTable('room_music', {
  placeKey: text('place_key').primaryKey(),
  on: boolean('on').notNull().default(true),
  scene: text('scene'),
  changedBy: text('changed_by').references(() => user.id, { onDelete: 'set null' }),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

// Une partie de jeu finie, classée ou non, écrite une seule fois, à sa fin. `id` est fixé par le serveur au début de la partie : une seconde écriture de la
// même partie ne fait rien. Les joueurs sont copiés (siège, identifiant, nom du moment, notes avant et après ; null quand la partie n'est pas classée) : pas de
// clé étrangère, la ligne reste si un compte disparaît. `moves` est le journal de la partie (de quoi la rejouer), `moveCount` les coups comptés à la fin.
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
    moveCount: integer('move_count').notNull(),
    ranked: boolean('ranked').notNull(),
  },
  (table) => [index('game_match_game_ended_at_idx').on(table.game, table.endedAt)],
);

// La note de chaque personne à chaque jeu (Elo). Sans ligne : 1200, aucune partie classée. La ligne part avec le compte.
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
  (table) => [primaryKey({ columns: [table.userId, table.game] }), index('game_rating_game_rating_idx').on(table.game, table.rating)],
);

// Les tâches de chacun : celles de sa propre liste (`kind` todo, `giverId` null) et les missions que d'autres lui confient auprès d'une administratrice de
// l'accueil (`kind` mission, `giverId` : qui l'a confiée ; null si son compte n'existe plus). `tier` : la difficulté d'une mission (1 à 10). `xp` : ce que la
// tâche rapporte (une mission : selon sa difficulté, fixé quand on la confie ; une tâche à soi : TODO_XP), puis, une fois faite, ce qu'elle a rapporté (une tâche à
// soi au-delà du plafond du jour : 0). `seenAt` : quand celle qui l'a reçue l'a vue (null : nouvelle). Elle part avec le compte de celle qui la porte.
export const task = pgTable(
  'task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    giverId: text('giver_id').references(() => user.id, { onDelete: 'set null' }),
    kind: text('kind').$type<TaskView['kind']>().notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    tier: integer('tier'),
    xp: integer('xp').notNull(),
    status: text('status').$type<TaskView['status']>().notNull().default('open'),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (table) => [index('task_owner_status_idx').on(table.ownerId, table.status), index('task_giver_created_idx').on(table.giverId, table.createdAt)],
);

// La progression de chacun : son XP totale (le niveau s'en déduit : levelOf), ses écus (gagnés en montant de niveau, dépensés à la boutique) et son pointage (le
// jour du dernier, « AAAA-MM-JJ » dans son fuseau, et la série de jours ouvrés). Sans ligne : 0 XP, 0 écu, jamais pointé. Elle part avec le compte.
export const progress = pgTable('progress', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  xp: integer('xp').notNull().default(0),
  ecus: integer('ecus').notNull().default(0),
  checkInDay: text('check_in_day'),
  streak: integer('streak').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Le journal des gains d'XP : d'où chacun vient (une mission, une tâche à soi, le pointage, une partie), de quoi tenir les plafonds du jour (`day`, le jour de la
// personne dans son fuseau) et montrer à chacun son histoire. `taskId` : la tâche qui l'a rapporté, s'il y en a une (sans clé étrangère : le journal reste si la tâche
// disparaît). Il part avec le compte.
export const xpEvent = pgTable(
  'xp_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    source: text('source').$type<XpSource>().notNull(),
    label: text('label').notNull(),
    day: text('day').notNull(),
    taskId: uuid('task_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('xp_event_user_day_idx').on(table.userId, table.day), index('xp_event_user_created_idx').on(table.userId, table.createdAt)],
);

// Ce que chacun a acheté à la boutique : un élément de décor (son identifiant dans la banque), une fois pour toutes ; il le pose ensuite dans sa pièce autant qu'il
// le veut. `price` : ce qu'il l'a payé, en écus. Il part avec le compte.
export const shopPurchase = pgTable(
  'shop_purchase',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    price: integer('price').notNull(),
    boughtAt: timestamp('bought_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.itemId] })],
);
