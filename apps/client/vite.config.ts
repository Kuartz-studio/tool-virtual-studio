/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Le serveur de l'API en développement (apps/server, lancé avec lui par `pnpm dev`). Les ports et l'adresse d'écoute viennent de
// l'environnement quand le workspace PM2 lance le client et le serveur chacun de son côté (PORT, API_PORT, LISTEN_HOST) ; sans eux,
// les valeurs de `pnpm dev` : 5173 et 4000.
const API_SERVER = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`;

export default defineConfig({
  plugins: [react()],
  // Le faux live (`pnpm dev:sim`) : __SIM__ est remplacé à la compilation par true avec VITE_SIM=1, false sinon (sim/sim-globals.d.ts).
  define: { __SIM__: JSON.stringify(process.env.VITE_SIM === '1') },
  server: {
    // En développement, le navigateur ne voit que ce serveur : APP_URL (fichier .env) doit valoir son adresse, puisque c'est
    // l'origine des cookies de session et des liens des e-mails. D'où un port fixe : occupé, Vite s'arrête au lieu d'en
    // prendre un autre, qui ne correspondrait plus à APP_URL.
    port: Number(process.env.PORT ?? 5173),
    host: process.env.LISTEN_HOST || undefined,
    strictPort: true,
    // L'API et le temps réel passent par Vite : client, /api et /socket.io partagent une origine, comme en production.
    proxy: {
      '/api': API_SERVER,
      '/socket.io': { target: API_SERVER, ws: true },
    },
  },
  build: {
    // Phaser (1,4 Mo) forme un fichier à lui, que le navigateur ne télécharge qu'avec le bureau (OfficePage). L'alerte de Vite, dès
    // 500 ko, n'apprendrait rien de plus.
    chunkSizeWarningLimit: 1500,
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
