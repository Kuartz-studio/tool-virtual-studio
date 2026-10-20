import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { betterAuthLogger } from '../src/auth/auth-logger';
import { createLogger, logServerError } from '../src/logger';

test('journaux muets pendant les tests, actifs sinon', () => {
  expect(createLogger({ NODE_ENV: 'test' }).level).toBe('silent');
  expect(createLogger({ NODE_ENV: 'development' }).level).toBe('info');
  expect(createLogger({ NODE_ENV: 'production' }).level).toBe('info');
});

// Le journal de production (createLogger), dont on garde le texte de chaque ligne.
function productionLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: createLogger({ NODE_ENV: 'production' }, stream), lines };
}

// Une requête qui échoue, telle que Drizzle la rend : DrizzleQueryError cite les paramètres dans son message (et donc sa pile), et les
// garde (`params`) ; le pilote (PGlite) les garde aussi dans l'erreur d'origine. Ici, le jeton d'une invitation et une adresse.
const TOKEN = 'jeton-secret-0123456789abcdef';
const EMAIL = 'lea@x.fr';
function queryError(): DrizzleQueryError {
  const driver = Object.assign(new Error('duplicate key value violates unique constraint "invitation_token_hash_unique"'), {
    code: '23505',
    params: [TOKEN, EMAIL],
  });
  return new DrizzleQueryError('insert into "invitation" ("token_hash", "email") values ($1, $2)', [TOKEN, EMAIL], driver);
}

test('une erreur de la base journalisée : ni ses paramètres, ni ceux de sa cause ; la requête, le message et le code restent', () => {
  const { logger, lines } = productionLogs();
  logger.error({ err: queryError() }, 'Erreur pendant une requête');
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(TOKEN);
  expect(lines[0]).not.toContain(EMAIL);
  const { err } = JSON.parse(lines[0]!) as { err: Record<string, unknown> };
  expect(err).not.toHaveProperty('params');
  expect(err.type).toBe('DrizzleQueryError');
  expect(err.query).toBe('insert into "invitation" ("token_hash", "email") values ($1, $2)');
  expect(err.message).toContain('Failed query: insert into "invitation"');
  expect(err.message).toContain('duplicate key value violates unique constraint');   // celui de la cause, que pino y ajoute
  expect(err.stack).toContain('caused by:');
});

test('enveloppée dans une autre erreur (Better Auth, un appelant) : rien non plus', () => {
  const { logger, lines } = productionLogs();
  logger.error({ err: new Error('Échec de la création du compte', { cause: queryError() }) }, 'Erreur');
  expect(lines[0]).not.toContain(TOKEN);
  expect(lines[0]).toContain('Failed query: insert into');
});

test('le pont des journaux de Better Auth passe par le même journal', () => {
  const { logger, lines } = productionLogs();
  betterAuthLogger(logger).log!('error', 'Failed to create invitation', queryError());
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(TOKEN);
  expect(JSON.parse(lines[0]!)).toMatchObject({ source: 'better-auth', err: { type: 'DrizzleQueryError' } });
});

// Better Auth passe parfois l'erreur elle-même en guise de message (`logger.error(e)`), et journalise `e.message` en texte quand il parle
// d'une colonne, d'une table ou d'une relation : dans les deux cas, le « Failed query: … params: … » de Drizzle arrive dans le texte.
test('le pont de Better Auth : une erreur de la base passée en guise de message n\'a pas ses paramètres dans le texte', () => {
  const { logger, lines } = productionLogs();
  betterAuthLogger(logger).log!('error', queryError() as unknown as string);
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(TOKEN);
  expect(lines[0]).not.toContain(EMAIL);
  const { msg } = JSON.parse(lines[0]!) as { msg: string };
  expect(msg).toContain('Failed query: insert into "invitation"');
});

test('le pont de Better Auth : un texte « Failed query: … params: … » n\'a pas ses paramètres non plus', () => {
  const { logger, lines } = productionLogs();
  betterAuthLogger(logger).log!('error', queryError().message);
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(TOKEN);
  expect(lines[0]).not.toContain(EMAIL);
  const { msg } = JSON.parse(lines[0]!) as { msg: string };
  expect(msg).toContain('Failed query: insert into "invitation"');
});

test('le pont de Better Auth : un texte ordinaire est gardé tel quel', () => {
  const { logger, lines } = productionLogs();
  betterAuthLogger(logger).log!('warn', 'Invalid password, params: pas ceux d\'une requête');
  expect(JSON.parse(lines[0]!)).toMatchObject({ msg: 'Invalid password, params: pas ceux d\'une requête' });
});

test('journal muet (tests, e2e) : la sortie d\'erreur de logServerError ne les montre pas non plus', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    logServerError(createLogger({ NODE_ENV: 'test' }), { err: queryError(), userId: 'u1' }, 'Erreur pendant une requête');
    expect(consoleError).toHaveBeenCalledOnce();
    const [message, fields] = consoleError.mock.calls[0]! as [string, { err: Error; userId: string }];
    expect(message).toBe('Erreur pendant une requête');
    expect(fields.userId).toBe('u1');
    expect(fields.err).not.toHaveProperty('params');
    expect(`${fields.err.message}\n${fields.err.stack}\n${String((fields.err.cause as Error).stack)}`).not.toContain(TOKEN);
    expect(JSON.stringify((fields.err.cause as Record<string, unknown>).params)).toBeUndefined();
  } finally {
    consoleError.mockRestore();
  }
});

test('une chaîne de causes qui boucle, ou très longue : journalisée quand même, sans fin', () => {
  const { logger, lines } = productionLogs();
  const looping = queryError();
  (looping.cause as Error).cause = looping;
  let deep: Error = queryError();
  for (let i = 0; i < 50; i++) deep = new Error(`niveau ${i}`, { cause: deep });
  logger.error({ err: looping }, 'boucle');
  logger.error({ err: deep }, 'profonde');
  expect(lines).toHaveLength(2);
  expect(lines[0]).not.toContain(TOKEN);
  expect(lines[1]).not.toContain(TOKEN);
  expect(lines[1]).toContain('niveau 49');
});

test('une erreur ordinaire est journalisée comme avant', () => {
  const { logger, lines } = productionLogs();
  logger.error({ err: Object.assign(new Error('LiveKit injoignable'), { code: 'ECONNREFUSED' }) }, 'Retrait impossible');
  expect(JSON.parse(lines[0]!).err).toMatchObject({ type: 'Error', message: 'LiveKit injoignable', code: 'ECONNREFUSED' });
});
