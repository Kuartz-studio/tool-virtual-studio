import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DEV_OFFICE, buildTiledMap, type TiledMapJson, type TiledObjectLayer, type TiledTileLayer } from '@bureau/shared';
import { expect, onTestFinished, test } from 'vitest';

const execFileAsync = promisify(execFile);
const serverDir = resolve(import.meta.dirname, '..');
// Le chemin que donne la spec, relatif au dossier du serveur (pnpm --filter y lance la commande).
const DEV_MAP = '../client/public/assets/maps/dev-office.json';
const OFFICE_MAP = '../client/public/assets/maps/office.json';

// Lance la vraie commande (src/cli/map-check.ts sous tsx, comme `pnpm map:check`) avec ces arguments, jusqu'à sa sortie.
async function runCommand(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli/map-check.ts', ...args], {
      cwd: serverDir,
      env: { PATH: process.env.PATH ?? '' },
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const { code, stdout, stderr } = err as { code: number | null; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bureau-map-check-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const devMap = (): TiledMapJson => buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: '../dev/tiles.png' } });
const tileLayer = (m: TiledMapJson, name: string) => m.layers.find((l): l is TiledTileLayer => l.type === 'tilelayer' && l.name === name)!;
const zonesLayer = (m: TiledMapJson) => m.layers.find((l): l is TiledObjectLayer => l.type === 'objectgroup' && l.name === 'zones')!;

test('map:check sur la carte de développement : résumé en français (zones par type, apparition), code 0', async () => {
  const run = await runCommand([DEV_MAP]);
  expect(run.code, run.stderr).toBe(0);
  expect(run.stderr).toBe('');
  expect(run.stdout).toMatch(/^Carte valide : \.\.\/client\/public\/assets\/maps\/dev-office\.json$/m);
  expect(run.stdout).toMatch(/Taille : 24 × 16 cases de 32 px/);
  expect(run.stdout).toMatch(/Cases bloquantes : 109 sur 384/);
  expect(run.stdout).toMatch(/^\s+spawn : 1$/m);
  expect(run.stdout).toMatch(/^\s+private : 1$/m);
  expect(run.stdout).toMatch(/^\s+desk : 3$/m);
  expect(run.stdout).toMatch(/^\s+label : 1$/m);
  expect(run.stdout).toMatch(/^\s+switch : 0$/m);   // pas d'interrupteur : les tests de bout en bout lisent les pixels de cette carte
  expect(run.stdout).toMatch(/Point d'apparition : x = 80, y = 240 \(case 2, 7\)/);
}, 60_000);

// La carte que le serveur charge en production (MAP_KEY=office) : le JSON généré dans le client doit rester lisible par le code du serveur.
test('map:check sur la grande carte du bureau : 81 × 46 cases, 6 bureaux avec leur porte, 6 salles, 12 lieux, apparition à l\'accueil, code 0', async () => {
  const run = await runCommand([OFFICE_MAP]);
  expect(run.code, run.stderr).toBe(0);
  expect(run.stderr).toBe('');
  expect(run.stdout).toMatch(/^Carte valide : \.\.\/client\/public\/assets\/maps\/office\.json$/m);
  expect(run.stdout).toMatch(/Taille : 81 × 46 cases de 32 px/);
  expect(run.stdout).toMatch(/^\s+desk : 6$/m);
  expect(run.stdout).toMatch(/^\s+door : 6$/m);
  expect(run.stdout).toMatch(/^\s+private : 6$/m);   // la réunion, l'octogone, la conférence, le sport, le jeu, la détente
  expect(run.stdout).toMatch(/^\s+spawn : 1$/m);
  expect(run.stdout).toMatch(/^\s+switch : 1$/m);   // l'interrupteur de la lumière, dans la rue nord
  expect(run.stdout).toMatch(/^\s+place : 12$/m);
  expect(run.stdout).toMatch(/^\s+speaker : 8$/m);   // une enceinte par lieu qui a de la musique
  expect(run.stdout).toMatch(/^\s+coffee : 1$/m);
  expect(run.stdout).toMatch(/^\s+game : 4$/m);
  expect(run.stdout).toMatch(/^\s+seat : 10$/m);
  expect(run.stdout).toMatch(/^\s+arena : 1$/m);   // le ring de l'octogone
  expect(run.stdout).toMatch(/Point d'apparition : x = 1296, y = 720 \(case 40, 22\)/);
}, 60_000);

test('map:check refuse une carte invalide : code 1, le code de MapError et un message en français, rien sur la sortie normale', async () => {
  const dir = tempDir();
  const cases: Array<{ name: string; code: string; mutate: (m: TiledMapJson) => void; message: RegExp }> = [
    { name: 'calque collisions absent', code: 'missing_layer', mutate: (m) => { m.layers = m.layers.filter((l) => l.name !== 'collisions'); }, message: /calque « collisions » est absent/ },
    { name: 'tileset externe', code: 'external_tileset', mutate: (m) => { m.tilesets = [{ firstgid: 1, source: 'tiles.tsx' }]; }, message: /tiles\.tsx[^]*pas intégré/ },
    { name: 'calque compressé', code: 'compressed_layer', mutate: (m) => { Object.assign(tileLayer(m, 'sol'), { encoding: 'base64', compression: 'zlib', data: 'eJwDAAAAAAE=' }); }, message: /calque « sol » est compressé \(zlib\)/ },
    { name: 'pas de zone spawn', code: 'missing_spawn', mutate: (m) => { zonesLayer(m).objects = zonesLayer(m).objects.filter((o) => o.type !== 'spawn'); }, message: /aucune zone « spawn »/ },
    { name: 'zone mal formée', code: 'bad_zone', mutate: (m) => { zonesLayer(m).objects[0]!.type = 'salon'; }, message: /Zone n° 1[^]*« salon » est inconnu/ },
  ];
  const runs = await Promise.all(
    cases.map((c) => {
      const map = devMap();
      c.mutate(map);
      const file = join(dir, `${c.code}.json`);
      writeFileSync(file, JSON.stringify(map));
      return runCommand([file]);
    }),
  );
  runs.forEach((run, index) => {
    const { name, code, message } = cases[index]!;
    expect(run.code, name).toBe(1);
    expect(run.stderr, name).toContain(`Carte invalide (${code})`);
    expect(run.stderr, name).toMatch(message);
    expect(run.stdout, name).toBe('');
  });
}, 60_000);

test('map:check échoue avec un message en français : fichier absent ou illisible, pas du JSON, pas une carte, mauvais nombre d\'arguments', async () => {
  const dir = tempDir();
  const notJson = join(dir, 'pas-du-json.json');
  writeFileSync(notJson, '{ "layers": [ ');
  const notMap = join(dir, 'liste.json');
  writeFileSync(notMap, '[1, 2, 3]');
  const noLayers = join(dir, 'sans-calques.json');
  writeFileSync(noLayers, '{ "hello": "world" }');
  const cases = [
    { name: 'sans argument', args: [], stderr: /Usage : pnpm --filter @bureau\/server map:check <fichier>/ },
    { name: 'deux arguments', args: [DEV_MAP, DEV_MAP], stderr: /Usage/ },
    { name: 'fichier absent', args: [join(dir, 'absent.json')], stderr: /Fichier introuvable[^]*absent\.json/ },
    { name: 'un dossier', args: [dir], stderr: /Lecture impossible/ },
    { name: 'pas du JSON', args: [notJson], stderr: /pas-du-json\.json[^]*n'est pas du JSON valide/ },
    { name: 'JSON qui n\'est pas une carte', args: [notMap], stderr: /liste\.json[^]*n'est pas une carte Tiled/ },
    { name: 'objet JSON sans calques', args: [noLayers], stderr: /Carte invalide \(missing_layer\)/ },
  ];
  const runs = await Promise.all(cases.map((c) => runCommand(c.args)));
  runs.forEach((run, index) => {
    const { name, stderr } = cases[index]!;
    expect(run.code, name).toBe(1);
    expect(run.stderr, name).toMatch(stderr);
    expect(run.stdout, name).toBe('');
  });
}, 60_000);
