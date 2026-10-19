import type { Role } from '@bureau/shared';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
