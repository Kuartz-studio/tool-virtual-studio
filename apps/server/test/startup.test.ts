import { execFile } from 'node:child_process';
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

test('configuration invalide : les variables fautives sont nommées sur stderr', async () => {
  const { code, stdout, stderr } = await startServer({ NODE_ENV: 'test', DATABASE_URL: 'memory://' });
  expect(code).toBe(1);
  expect(stderr).toMatch(/Configuration invalide[^]*APP_URL[^]*BETTER_AUTH_SECRET/);
  expect(stdout).toBe('');
}, 30_000);
