import type { Role } from '@bureau/shared';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

// Les états d'activité qu'une personne crée (« En focus », « À table »…) : un nom, la couleur de son point, et trois interrupteurs (laisser
// entrer dans son bureau, entendre, être entendue). Ils lui appartiennent, et partent avec son compte.
export const activityState = pgTable(
  'activity_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    color: text('color').notNull(),   // « #rrggbb », en minuscules
    allowEntry: boolean('allow_entry').notNull().default(true),
    hear: boolean('hear').notNull().default(true),
    heard: boolean('heard').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('activity_state_user_id_idx').on(table.userId)],
);
