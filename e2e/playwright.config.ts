import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Le serveur des tests de bout en bout : celui de production (client et serveur compilés), sur un port à lui, avec la petite carte de
// développement (dev-office). Un second serveur, sur le même build, a la vraie carte (office) et sa propre base : ses six bureaux sont tous
// libres, ce que les tests de personnalisation (personnalisation.spec.ts : le builder, la déco du bureau) demandent, et dont les zones servent
// à la musique par endroit (musique-lieux.spec.ts) et à la lumière (lumiere.spec.ts).
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const OFFICE_PORT = 3101;
const OFFICE_URL = `http://localhost:${OFFICE_PORT}`;

// Les tests qui veulent la vraie carte : la personnalisation (six bureaux libres), la musique par endroit (les zones de la grande carte), la
// lumière (l'interrupteur de la rue nord) et les portes vitrées des bureaux.
const OFFICE_SPECS = /(personnalisation|musique-lieux|lumiere|portes)\.spec\.ts/;

// Les faux périphériques de Chromium : une caméra (une mire qui bouge) et un micro (un bip), accordés sans question. L'écran d'entrée
// du bureau les montre, et les tests audio/vidéo (media.spec.ts) les publient. Le test du refus lance son propre navigateur.
const FAKE_MEDIA_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

// Un serveur LiveKit pour les tests audio/vidéo : E2E_LIVEKIT_URL, E2E_LIVEKIT_API_KEY et E2E_LIVEKIT_API_SECRET, que le serveur des
// tests reçoit en LIVEKIT_*. En local : `livekit-server --dev` (ws://localhost:7880, clé devkey, secret secret). Sans elles, le serveur
// tourne sans audio ni vidéo, et media.spec.ts est ignoré.
const LIVEKIT_ENV: Record<string, string> = process.env.E2E_LIVEKIT_URL
  ? {
      LIVEKIT_URL: process.env.E2E_LIVEKIT_URL,
      LIVEKIT_API_KEY: process.env.E2E_LIVEKIT_API_KEY ?? '',
      LIVEKIT_API_SECRET: process.env.E2E_LIVEKIT_API_SECRET ?? '',
    }
  : {};

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
  projects: [
    { name: 'chromium', testIgnore: OFFICE_SPECS, use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA_ARGS } } },
    { name: 'office', testMatch: OFFICE_SPECS, use: { ...devices['Desktop Chrome'], baseURL: OFFICE_URL, launchOptions: { args: FAKE_MEDIA_ARGS } } },
  ],
  webServer: [
    {
      // VITE_E2E=1 active dans le client ce qu'il réserve aux tests. NODE_ENV=production pour le build : Vite le lirait
      // sinon dans l'env ci-dessous (test), et livrerait React en mode développement. Le build fini, le serveur de la vraie carte démarre en
      // arrière-plan (même env, autre port, autre origine, autre carte), puis celui de la petite carte prend la place du shell.
      command: `VITE_E2E=1 NODE_ENV=production pnpm build && (PORT=${OFFICE_PORT} APP_URL=${OFFICE_URL} MAP_KEY=office node apps/server/dist/index.js &) ; exec node apps/server/dist/index.js`,
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
        ...LIVEKIT_ENV,
      },
    },
    {
      // Le second serveur est lancé par la commande ci-dessus (il répond souvent déjà quand Playwright arrive ici : d'où
      // reuseExistingServer) : cette entrée attend seulement qu'il réponde, avant de lancer les tests.
      command: 'sleep 3600',
      url: `${OFFICE_URL}/api/health`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
