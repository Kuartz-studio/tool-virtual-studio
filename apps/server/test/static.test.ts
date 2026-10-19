import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, test } from 'vitest';
import { createTestApp } from './helpers/test-app';

// Un client compilé de test, comme celui que produit `vite build` : index.html et un fichier sous assets/.
const INDEX_HTML = '<!doctype html><html lang="fr"><head><title>Bureau virtuel</title></head><body><div id="root"></div></body></html>';

function writeClientDist(dir: string): string {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), INDEX_HTML);
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("bureau");');
  return dir;
}

const distDir = writeClientDist(mkdtempSync(join(tmpdir(), 'bureau-client-')));
afterAll(() => rmSync(distDir, { recursive: true, force: true }));

const clientApp = () => createTestApp({ env: { CLIENT_DIST_DIR: distDir } });

test('SPA : /rejoindre renvoie index.html ; /api/inconnu renvoie 404 en JSON', async () => {
  const { app } = await clientApp();

  const page = await request(app).get('/rejoindre?token=abc');
  expect(page.status).toBe(200);
  expect(page.type).toBe('text/html');
  expect(page.text).toBe(INDEX_HTML);

  const unknown = await request(app).get('/api/inconnu');
  expect(unknown.status).toBe(404);
  expect(unknown.type).toBe('application/json');
  expect(unknown.body).toEqual({ error: 'not_found' });
});

describe('client compilé', () => {
  test.each(['/', '/connexion', '/mot-de-passe-oublie', '/reinitialiser?token=xyz', '/une/page/inconnue', '/apiculture'])(
    'GET %s → index.html, revalidé à chaque visite',
    async (path) => {
      const { app } = await clientApp();
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.text).toBe(INDEX_HTML);
      // Après un déploiement, le navigateur doit recharger la page, qui pointe vers les nouveaux fichiers.
      expect(res.get('Cache-Control')).toBe('no-cache');
    },
  );

  test('les fichiers du client sont servis tels quels', async () => {
    const { app } = await clientApp();
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/javascript');
    expect(res.text).toBe('console.log("bureau");');
  });

  // Un fichier absent n'est pas une page : renvoyer index.html ferait lire du HTML comme du JavaScript ou du JSON.
  test.each(['/assets/absent.js', '/assets/maps/absente.json', '/favicon.ico'])('fichier absent %s → 404 en JSON', async (path) => {
    const { app } = await clientApp();
    const res = await request(app).get(path);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  test.each([
    ['GET', '/api'],
    ['GET', '/api/'],
    ['GET', '/api/auth-inconnue'],
    ['POST', '/api/inconnu'],
    ['GET', '/socket.io/?EIO=4&transport=polling'],
    ['POST', '/rejoindre'],
  ])('%s %s → 404 en JSON, jamais index.html', async (method, path) => {
    const { app } = await clientApp();
    const res = await (method === 'GET' ? request(app).get(path) : request(app).post(path));
    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: 'not_found' });
  });

  test('l\'API garde la priorité sur le client', async () => {
    const { app } = await clientApp();
    const res = await request(app).get('/api/health');
    expect(res.body).toEqual({ ok: true });
  });
});

test('sans CLIENT_DIST_DIR (développement : Vite sert le client), aucune page n\'est servie', async () => {
  const { app } = await createTestApp();
  const res = await request(app).get('/rejoindre');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'not_found' });
});

// Un dossier dont un parent commence par un point : un worktree git (.worktrees/, .claude/worktrees/), un dossier de
// déploiement caché. Les pages doivent y être servies comme ailleurs, pas seulement les fichiers.
test('CLIENT_DIST_DIR sous un dossier caché (.worktrees/…) : pages et fichiers servis', async () => {
  const base = mkdtempSync(join(tmpdir(), 'bureau-'));
  try {
    const hiddenDist = writeClientDist(join(base, '.worktrees', 'tache-7', 'apps', 'client', 'dist'));
    const { app } = await createTestApp({ env: { CLIENT_DIST_DIR: hiddenDist } });

    const page = await request(app).get('/connexion');
    expect(page.status).toBe(200);
    expect(page.text).toBe(INDEX_HTML);
    const asset = await request(app).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.text).toBe('console.log("bureau");');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('CLIENT_DIST_DIR sans index.html (client pas compilé) → le serveur refuse de démarrer', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'bureau-client-vide-'));
  try {
    await expect(createTestApp({ env: { CLIENT_DIST_DIR: empty } })).rejects.toThrow(/CLIENT_DIST_DIR[^]*index\.html/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
