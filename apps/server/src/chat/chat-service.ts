import { CHAT_HISTORY_LIMIT, type ChatMessage } from '@bureau/shared';
import { DrizzleQueryError, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { chatMessage, user } from '../db/schema';

export interface ChatService {
  /** Enregistre un message du canal « Tout le monde » (le texte est déjà validé) et le rend tel qu'on l'envoie. */
  post(userId: string, text: string): Promise<ChatMessage>;
  /** Les `limit` derniers messages (CHAT_HISTORY_LIMIT par défaut), du plus ancien au plus récent. */
  recent(limit?: number): Promise<ChatMessage[]>;
}

// Une panne de la base, sans les paramètres de la requête. DrizzleQueryError les cite dans son message, et le pilote de PGlite les garde
// dans l'erreur (`params`) : le texte du message irait dans les journaux de qui l'attrape. On ne reprend de l'erreur de la base que son
// message et son code (SQLSTATE), qui n'en disent rien.
function withoutParams(err: unknown): Error {
  const source = err instanceof DrizzleQueryError && err.cause ? err.cause : err;
  const code = (source as { code?: unknown } | null)?.code;
  return Object.assign(new Error(source instanceof Error ? source.message : String(source)), typeof code === 'string' ? { code } : {});
}

// Le chat « Tout le monde », conservé en base (table chat_message). « À proximité » n'y passe pas : il n'est jamais enregistré.
//
// Seuls l'auteur, le texte et l'heure sont enregistrés, pas le nom : il se lit dans le compte, au moment où l'on rend le message
// (post, recent). L'historique donne ainsi le nom actuel de chacun, et un changement de nom ne demande aucune réécriture.
//
// `now` donne l'heure d'un message (l'horloge de la machine par défaut) : celle de la ligne, et celle du message rendu. Le texte est
// enregistré tel que le serveur l'a validé, sans aucun traitement HTML : c'est le client qui l'affiche comme du texte.
export function createChatService(db: Db, now: () => Date = () => new Date()): ChatService {
  return {
    // Une seule requête : la ligne, et le nom de l'auteur lu dans la même instruction. Un compte inconnu est refusé (clé étrangère), et
    // rien n'est enregistré. Une requête qui échoue lève une erreur sans le texte du message (withoutParams).
    async post(userId, text) {
      const createdAt = now();
      try {
        const [row] = await db
          .insert(chatMessage)
          .values({ userId, body: text, createdAt })
          .returning({
            id: chatMessage.id,
            name: sql<string>`(select ${user.name} from ${user} where ${user.id} = ${userId})`,
          });
        return { id: row!.id, channel: 'all', userId, name: row!.name, text, sentAt: createdAt.toISOString() };
      } catch (err) {
        throw withoutParams(err);
      }
    },

    // Les plus récents par date (puis par identifiant, pour que deux messages de la même milliseconde gardent leur ordre d'un appel
    // à l'autre), rendus du plus ancien au plus récent. Un message a toujours un compte : la clé étrangère le supprime avec lui.
    async recent(limit = CHAT_HISTORY_LIMIT) {
      const rows = await db
        .select({ id: chatMessage.id, userId: chatMessage.userId, name: user.name, body: chatMessage.body, createdAt: chatMessage.createdAt })
        .from(chatMessage)
        .innerJoin(user, eq(user.id, chatMessage.userId))
        .orderBy(desc(chatMessage.createdAt), desc(chatMessage.id))
        .limit(limit);
      return rows.reverse().map((row) => ({
        id: row.id,
        channel: 'all' as const,
        userId: row.userId,
        name: row.name,
        text: row.body,
        sentAt: row.createdAt.toISOString(),
      }));
    },
  };
}
