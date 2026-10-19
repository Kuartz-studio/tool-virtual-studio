import { loadEnv, type Env } from '../../src/env';

// Un Env valide pour les tests : base et e-mails en mémoire, limitation des tentatives
// désactivée (les tests qui la vérifient passent { AUTH_RATE_LIMIT: 'on' }).
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...loadEnv({
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'memory://',
      BETTER_AUTH_SECRET: 'secret-de-test-secret-de-test-0123456789',
      MAILER: 'memory',
      AUTH_RATE_LIMIT: 'off',
    }),
    ...overrides,
  };
}
