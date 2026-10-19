/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Le serveur de l'API en développement (apps/server, lancé avec lui par `pnpm dev`).
const API_SERVER = 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    // En développement, le navigateur ne voit que ce serveur : APP_URL (fichier .env) doit valoir son adresse, puisque c'est
    // l'origine des cookies de session et des liens des e-mails. D'où un port fixe : occupé, Vite s'arrête au lieu d'en
    // prendre un autre, qui ne correspondrait plus à APP_URL.
    port: 5173,
    strictPort: true,
    // L'API et le temps réel passent par Vite : client, /api et /socket.io partagent une origine, comme en production.
    proxy: {
      '/api': API_SERVER,
      '/socket.io': { target: API_SERVER, ws: true },
    },
  },
  test: {
    environment: 'happy-dom',
    // L'adresse de la page des tests. Par défaut, happy-dom prend http://localhost:3000, où tourne un autre programme : une
    // requête qu'un test aurait oublié de simuler partirait vers lui. Le domaine .test n'existe jamais : elle échoue.
    environmentOptions: { happyDOM: { url: 'http://bureau.test' } },
    setupFiles: ['./src/test/setup.ts'],
    // Un `fetch` remplacé par un test (vi.stubGlobal) redevient le vrai après ce test.
    unstubGlobals: true,
  },
});
