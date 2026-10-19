import { execFile, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

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

test('démarrage complet : base en mémoire migrée, santé, inscription directe refusée', async () => {
  // NODE_ENV=development : le journal écrit une ligne JSON par événement, dont « Serveur démarré » avec le port réel.
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'development', APP_URL: 'http://localhost:4000', BETTER_AUTH_SECRET: 'x'.repeat(32), DATABASE_URL: 'memory://', PORT: '0' },
  });
  try {
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
    const base = `http://127.0.0.1:${port}`;
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
  } finally {
    child.kill();
  }
}, 30_000);

test('configuration invalide : les variables fautives sont nommées sur stderr', async () => {
  const { code, stdout, stderr } = await startServer({ NODE_ENV: 'test', DATABASE_URL: 'memory://' });
  expect(code).toBe(1);
  expect(stderr).toMatch(/Configuration invalide[^]*APP_URL[^]*BETTER_AUTH_SECRET/);
  expect(stdout).toBe('');
}, 30_000);
