import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, onTestFinished, test } from 'vitest';
import { createInvitationService } from '../src/auth/invitations';
import { createDb } from '../src/db/client';

const execFileAsync = promisify(execFile);
const serverDir = resolve(import.meta.dirname, '..');

// Une configuration valide, sans DATABASE_URL.
const config = { APP_URL: 'http://localhost:4000', BETTER_AUTH_SECRET: 'x'.repeat(32) };

// Lance la vraie commande (src/cli/admin-invite.ts sous tsx, comme `pnpm admin:invite`) avec cet environnement, jusqu'à sa sortie.
async function runCommand(args: string[], env: Record<string, string>) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli/admin-invite.ts', ...args], {
      cwd: serverDir,
      env: { PATH: process.env.PATH ?? '', ...env },
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const { code, stdout, stderr } = err as { code: number | null; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

test('admin:invite crée une invitation admin dans la base PGlite, affiche le lien et demande d\'arrêter le serveur de développement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bureau-admin-invite-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const databaseUrl = `pglite://${join(dir, 'base')}`;

  const run = await runCommand(['Root@X.fr'], { ...config, DATABASE_URL: databaseUrl });
  expect(run.code, run.stderr).toBe(0);
  // Deux processus sur un même dossier PGlite perdent des écritures : l'avertissement passe avant tout, sur la sortie d'erreur.
  expect(run.stderr).toMatch(/arrêter le serveur de développement/i);
  expect(run.stdout).toMatch(/MAILER=memory/);   // aucun e-mail n'est parti : le lien affiché est la seule porte d'entrée
  const link = run.stdout.match(/https?:\/\/\S+/)?.[0];
  expect(link).toMatch(/^http:\/\/localhost:4000\/rejoindre\?token=[\w-]+$/);

  // Le processus a fini et fermé la base : on la rouvre pour vérifier que l'invitation y est, bien enregistrée.
  const { db, close } = await createDb(databaseUrl);
  try {
    const token = new URL(link!).searchParams.get('token')!;
    expect(await createInvitationService(db).check(token)).toMatchObject({
      status: 'valid',
      invitation: { email: 'root@x.fr', role: 'admin', invitedBy: null },
    });
  } finally {
    await close();
  }
}, 60_000);

test('admin:invite échoue avec un message en français : adresse absente ou invalide, configuration invalide, base en mémoire, base injoignable', async () => {
  const cases = [
    { name: 'sans adresse', args: [], env: { ...config, DATABASE_URL: 'pglite://.data/jamais' }, stderr: /Usage/ },
    { name: 'deux adresses', args: ['a@x.fr', 'b@x.fr'], env: { ...config, DATABASE_URL: 'pglite://.data/jamais' }, stderr: /Usage/ },
    { name: 'adresse invalide', args: ['pas-une-adresse'], env: { ...config, DATABASE_URL: 'pglite://.data/jamais' }, stderr: /adresse e-mail/ },
    { name: 'configuration invalide', args: ['root@x.fr'], env: { DATABASE_URL: 'pglite://.data/jamais' }, stderr: /Configuration invalide[^]*APP_URL[^]*BETTER_AUTH_SECRET/ },
    { name: 'base en mémoire', args: ['root@x.fr'], env: { ...config, DATABASE_URL: 'memory://' }, stderr: /memory:\/\// },
    { name: 'base injoignable', args: ['root@x.fr'], env: { ...config, DATABASE_URL: 'postgres://127.0.0.1:1/bureau' }, stderr: /Invitation impossible/ },
  ];
  const runs = await Promise.all(cases.map((c) => runCommand(c.args, c.env)));
  runs.forEach((run, index) => {
    const { name, stderr } = cases[index]!;
    expect(run.code, name).toBe(1);
    expect(run.stderr, name).toMatch(stderr);
    expect(run.stdout, name).toBe('');   // aucun lien affiché
  });
}, 60_000);
