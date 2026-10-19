import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Le serveur des tests de bout en bout : celui de production (client et serveur compilés), sur un port à lui.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '.',
  // Tous les tests partagent un serveur et sa base en mémoire : chacun crée ses propres comptes (helpers.ts, uniqueEmail).
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // VITE_E2E=1 active dans le client ce qu'il réserve aux tests. NODE_ENV=production pour le build : Vite le lirait
    // sinon dans l'env ci-dessous (test), et livrerait React en mode développement.
    command: 'VITE_E2E=1 NODE_ENV=production pnpm build && node apps/server/dist/index.js',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: `${BASE_URL}/api/health`,
    // Toujours un serveur neuf, compilé depuis le code du moment : un serveur oublié sur le port fait échouer le lancement
    // au lieu de tester un ancien build.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      E2E: '1',
      NODE_ENV: 'test',
      DATABASE_URL: 'memory://',
      MAILER: 'memory',
      AUTH_RATE_LIMIT: 'off',
      BETTER_AUTH_SECRET: 'secret-des-tests-e2e-0123456789-abcdef',
      PORT: String(PORT),
      APP_URL: BASE_URL,
      CLIENT_DIST_DIR: 'apps/client/dist',
      MAPS_DIR: 'apps/client/dist/assets/maps',
    },
  },
});
