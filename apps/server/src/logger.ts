import { pino, stdSerializers, type DestinationStream, type Logger } from 'pino';
import type { Env } from './env';

// Journaux structurés (une ligne JSON par événement), muets pendant les tests. `destination` : la sortie standard par défaut (les
// tests y mettent un flux à eux). Les erreurs (`err`, et chez les enfants du journal : celui de Better Auth) passent par
// errSerializer, qui en retire les paramètres des requêtes.
export function createLogger(env: Pick<Env, 'NODE_ENV'>, destination?: DestinationStream): Logger {
  const options = { level: env.NODE_ENV === 'test' ? 'silent' : 'info', serializers: { err: errSerializer } };
  return destination ? pino(options, destination) : pino(options);
}

// Une erreur du serveur (une requête qui échoue en 500) : dans le journal, et aussi sur la sortie d'erreur quand le journal
// est muet. Les tests e2e lancent le serveur compilé avec NODE_ENV=test : sans ceci, une erreur 500 n'y laisserait aucune trace.
// Sur la sortie d'erreur aussi, l'erreur est sans les paramètres de ses requêtes.
export function logServerError(logger: Logger, fields: Record<string, unknown>, message: string): void {
  logger.error(fields, message);
  if (logger.level === 'silent') console.error(message, 'err' in fields ? { ...fields, err: withoutQueryParams(fields.err) } : fields);
}

// Le sérialiseur `err` de pino (type, message et pile, causes comprises, et les autres champs de l'erreur), sur l'erreur sans les
// paramètres de ses requêtes.
export function errSerializer(err: unknown): unknown {
  return stdSerializers.err(withoutQueryParams(err) as Error);
}

// Les causes suivies au plus : au-delà (une chaîne qui boucle, ou très longue), elles sont abandonnées.
const MAX_CAUSES = 8;
const HIDDEN = '[masqués]';

// Une erreur, ou ce qui en a l'air (un message), comme pour pino : une erreur d'un autre contexte n'est pas `instanceof Error`.
const isErrorLike = (value: unknown): value is Error =>
  typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string';

// Une requête qui échoue, telle que Drizzle la rend (DrizzleQueryError) : « Failed query: <requête>\nparams: <valeurs> ». Les valeurs
// (un jeton d'invitation, une adresse, le texte d'un message) sont dans son message, donc dans sa pile, et dans son champ `params` ; le
// pilote (PGlite) les garde aussi dans l'erreur d'origine (`params`), sa cause. Une erreur qui en enveloppe une autre (Better Auth)
// peut reprendre son message dans le sien.
//
// Rend une copie de l'erreur et de ses causes (MAX_CAUSES au plus), sans champ `params`, où la partie « params: … » de chaque message
// de requête de la chaîne est remplacée, dans tous les messages et toutes les piles. Le reste (le type, la requête, qui n'a que des
// $1, $2…, le message de la base, son code) est gardé. Ce qui n'est pas une erreur est rendu tel quel. Le chat a sa propre version,
// plus stricte, pour les erreurs qu'il lève (chat-service.ts : withoutParams).
export function withoutQueryParams(err: unknown): unknown {
  const chain: Error[] = [];
  for (let e: unknown = err; isErrorLike(e) && chain.length < MAX_CAUSES && !chain.includes(e); e = e.cause) chain.push(e);
  if (chain.length === 0) return err;

  // La partie « params: … » de chaque message de requête, du « \nparams: » à la fin.
  const sections = chain
    .filter((e) => e.message.startsWith('Failed query: ') && e.message.includes('\nparams: '))
    .map((e) => e.message.slice(e.message.indexOf('\nparams: ')));
  const hide = (text: string): string => {
    let hidden = text;
    for (const section of sections) hidden = hidden.replaceAll(section, `\nparams: ${HIDDEN}`);
    return hidden;
  };

  const copies = chain.map((e) => {
    const copy = Object.create(Object.getPrototypeOf(e) as object) as Error & Record<string, unknown>;
    for (const [key, value] of Object.entries(e)) {
      if (key !== 'params' && key !== 'cause') copy[key] = value;
    }
    copy.message = hide(e.message);
    if (e.stack !== undefined) copy.stack = hide(e.stack);
    return copy;
  });
  // Chacune a pour cause la copie de la suivante. La dernière garde une cause qui n'est pas une erreur (un texte) ; une erreur au-delà
  // (une boucle, ou plus de MAX_CAUSES) est abandonnée.
  copies.forEach((copy, i) => {
    if (i + 1 < copies.length) copy.cause = copies[i + 1];
  });
  const lastCause = chain.at(-1)!.cause;
  if (lastCause !== undefined && !isErrorLike(lastCause)) copies.at(-1)!.cause = lastCause;
  return copies[0];
}
