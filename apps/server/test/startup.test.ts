import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ClientToServerEvents, InitPayload, ServerToClientEvents } from '@bureau/shared';
import { eq } from 'drizzle-orm';
import { io as ioClient, type Socket } from 'socket.io-client';
import { expect, onTestFinished, test } from 'vitest';
import { createDb } from '../src/db/client';
import { user } from '../src/db/schema';

const execFileAsync = promisify(execFile);
const serverDir = resolve(import.meta.dirname, '..');

// Une configuration valide, sauf DATABASE_URL : `pglite://` sans dossier fait échouer le démarrage après la validation.
const config = { APP_URL: 'http://localhost:4000', BETTER_AUTH_SECRET: 'x'.repeat(32), DATABASE_URL: 'pglite://' };

// Lance le vrai point d'entrée (src/index.ts sous tsx) avec cet environnement, jusqu'à sa sortie.
async function startServer(env: Record<string, string>) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { PATH: process.env.PATH ?? '', ...env },
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const { code, stdout, stderr } = err as { code: number | null; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

test('échec au démarrage avec NODE_ENV=test : l\'erreur reste lisible sur stderr', async () => {
  const { code, stdout, stderr } = await startServer({ ...config, NODE_ENV: 'test' });
  expect(code).toBe(1);
  expect(stderr).toMatch(/Démarrage impossible/);
  expect(stderr).toMatch(/pglite:\/\/ doit être suivie d'un dossier/);
  expect(stdout).toBe('');   // les journaux ordinaires restent muets en test
}, 30_000);

test('échec au démarrage hors test : une ligne fatal du journal, sans doublon sur stderr', async () => {
  const { code, stdout, stderr } = await startServer({ ...config, NODE_ENV: 'development' });
  expect(code).toBe(1);
  expect(JSON.parse(stdout.trim())).toMatchObject({ level: 60, msg: 'Démarrage impossible', err: { message: expect.stringMatching(/pglite:\/\//) } });
  expect(stderr).toBe('');
}, 30_000);

// Lance le vrai point d'entrée en arrière-plan, avec NODE_ENV=development : le journal écrit une ligne JSON par événement, dont
// « Serveur démarré » avec le port réel (PORT=0). Renvoie le processus et l'adresse du serveur, une fois démarré. Un processus
// encore vivant à la fin du test est tué, même quand le test échoue sur son délai (un `finally` n'y serait jamais atteint).
async function spawnServer(env: Record<string, string>): Promise<{ child: ChildProcessWithoutNullStreams; base: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'development', APP_URL: 'http://localhost:4000', BETTER_AUTH_SECRET: 'x'.repeat(32), PORT: '0', ...env },
  });
  onTestFinished(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  const port = await new Promise<number>((resolve, reject) => {
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      for (const line of stdout.split('\n')) {
        if (line.includes('Serveur démarré')) resolve((JSON.parse(line) as { port: number }).port);
      }
    });
    child.once('exit', (code) => reject(new Error(`le serveur s'est arrêté (code ${code}) : ${stdout}`)));
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

test('démarrage complet : base en mémoire migrée, santé, inscription directe refusée, redirection de réinitialisation limitée à l\'appli', async () => {
  const { base } = await spawnServer({ DATABASE_URL: 'memory://' });
  expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true });
  // fetch envoie `sec-fetch-mode: cors` sans en-tête Origin : la protection CSRF de Better Auth répondrait alors 403
  // (MISSING_OR_NULL_ORIGIN) avant même le crochet des invitations. Avec l'origine de confiance (APP_URL du serveur
  // lancé), la requête passe ce contrôle : le 403 attendu est bien celui du verrou des invitations.
  const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:4000' },
    body: JSON.stringify({ email: 'x@x.fr', password: 'motdepasse1', name: 'X' }),
  });
  expect(signUp.status).toBe(403);
  expect(await signUp.json()).toMatchObject({ code: 'INVITATION_REQUIRED' });
  expect((await fetch(`${base}/api/invitations/inconnu`)).status).toBe(404);

  // Le lien de réinitialisation renvoie le jeton vers `redirectTo` : sans contrôle, quelqu'un pourrait demander la
  // réinitialisation d'un autre compte avec l'adresse de son propre site, et le lien reçu par ce compte lui livrerait le
  // jeton. Better Auth ne contrôle les adresses de redirection que hors NODE_ENV=test : les tests en processus ne le
  // voient pas, ce serveur lancé en développement si.
  const requestReset = (redirectTo: string) =>
    fetch(`${base}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:4000' },
      body: JSON.stringify({ email: 'x@x.fr', redirectTo }),
    });
  expect((await requestReset('http://localhost:4000/reinitialiser')).status).toBe(200);
  const foreign = await requestReset('https://pirate.example/reinitialiser');
  expect(foreign.status).toBe(403);
  expect(await foreign.json()).toMatchObject({ code: 'INVALID_REDIRECT_URL' });
}, 30_000);

test('configuration invalide : les variables fautives sont nommées sur stderr', async () => {
  const { code, stdout, stderr } = await startServer({ NODE_ENV: 'test', DATABASE_URL: 'memory://' });
  expect(code).toBe(1);
  expect(stderr).toMatch(/Configuration invalide[^]*APP_URL[^]*BETTER_AUTH_SECRET/);
  expect(stdout).toBe('');
}, 30_000);

test('carte introuvable : démarrage impossible, le message donne le chemin de la carte', async () => {
  const { code, stderr } = await startServer({ ...config, NODE_ENV: 'test', DATABASE_URL: 'memory://', MAPS_DIR: '/nulle-part' });
  expect(code).toBe(1);
  expect(stderr).toMatch(/Démarrage impossible/);
  expect(stderr).toMatch(/Carte du bureau illisible : \/nulle-part\/dev-office\.json/);
}, 30_000);

// Railway arrête l'ancienne version par SIGTERM à chaque déploiement ; Ctrl+C envoie SIGINT. Le serveur enregistre alors la position
// de chaque personne présente, ferme le serveur HTTP et la base, et sort avec le code 0. Une base PGlite dans un dossier : on la
// relit après la sortie du processus.
test.each(['SIGTERM', 'SIGINT'] as const)('%s : positions enregistrées, serveur et base fermés, sortie avec le code 0', async (signal) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bureau-arret-'));
  onTestFinished(() => rmSync(dataDir, { recursive: true, force: true }));
  // E2E=1 : la route de test crée l'invitation, sans admin ni e-mail.
  const { child, base } = await spawnServer({ DATABASE_URL: `pglite://${dataDir}`, E2E: '1' });
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  const invited = await fetch(`${base}/api/test/invitations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'lea@x.fr' }),
  });
  const token = new URL(((await invited.json()) as { link: string }).link).searchParams.get('token');
  const accepted = await fetch(`${base}/api/invitations/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, name: 'Léa', password: 'motdepasse1' }),
  });
  expect(accepted.status).toBe(201);
  const cookie = accepted.headers.getSetCookie().map((setCookie) => setCookie.split(';')[0]).join('; ');

  // Léa entre au bureau, au point d'apparition : sa position n'est encore qu'en mémoire.
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = ioClient(base, { transports: ['websocket'], extraHeaders: { cookie }, reconnection: false });
  onTestFinished(() => {
    socket.close();
  });
  const init = await new Promise<InitPayload>((resolve) => socket.once('init', resolve));
  expect(init.self).toMatchObject({ x: 80, y: 240, dir: 'down' });

  child.kill(signal);
  expect(await exited).toBe(0);

  const { db, close } = await createDb(`pglite://${dataDir}`);
  try {
    const [saved] = await db.select({ lastX: user.lastX, lastY: user.lastY, lastDir: user.lastDir }).from(user).where(eq(user.email, 'lea@x.fr'));
    expect(saved).toEqual({ lastX: 80, lastY: 240, lastDir: 'down' });
  } finally {
    await close();
  }
}, 30_000);
