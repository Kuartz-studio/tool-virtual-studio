import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { buildOfficeTiledMap, deskKey, freeSpotIn, isWalkableTile, parseOfficeMap, placeByKey, zoneAt } from '../packages/shared/src/index';
import { enterOffice, giveDeskBack, joinOffice, openDeskPanel, selfAt, teleportTo } from './helpers';

// La musique de chaque pièce, sur la vraie carte (le second serveur des tests : playwright.config.ts) : ceux qui sont dans une pièce la règlent pour tous. À l'enceinte (la
// touche E) on la coupe et on la relance ; dans un bureau, son propriétaire règle l'ambiance avec le bouton haut-parleur de la puce du lieu, et celui qui y entre l'entend.
// Les vrais fichiers sont décodés par Chromium : on attend ce qu'il joue (`window.__audio.playing()`).

// Un seul navigateur à la fois : plusieurs personnes, et le reste de la suite qui tourne sur ce serveur (les tests de personnalisation cherchent un bureau libre).
test.describe.configure({ mode: 'default' });

const map = parseOfficeMap(buildOfficeTiledMap());
const DECODE_TIMEOUT = 20_000;
// Le serveur laisse MUSIC_RATE_MS (800 ms) entre deux réglages d'une même personne.
const MUSIC_RATE_MS = 800;

// Le milieu de la case praticable la plus proche de (column, row) : un meuble peut occuper celle qu'on vise.
function spotNear(column: number, row: number): { x: number; y: number } {
  for (let radius = 0; radius < 8; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (isWalkableTile(map, column + dx, row + dy)) return { x: (column + dx) * 32 + 16, y: (row + dy) * 32 + 16 };
      }
    }
  }
  throw new Error(`Aucune case praticable près de (${column}, ${row}).`);
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

async function arrive(browser: Browser, name: string, desk: 'given back' | 'kept' = 'given back'): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  if (desk === 'given back') await giveDeskBack(page);
  return page;
}

const playing = (page: Page) => page.evaluate(() => window.__audio?.playing() ?? null);

test('Alice coupe la musique de la salle de jeu à l\'enceinte : Bastien, qui y est, n\'entend plus rien, même après un rechargement ; elle la relance, il l\'entend', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  const bastien = await arrive(browser, 'Bastien');
  // La salle de jeu joue le crépuscule. Alice est devant l'enceinte (case (34, 33), l'amplificateur au-dessus d'elle), Bastien au milieu de la salle.
  const game = placeByKey(map, 'game')!;
  await teleportTo(alice, spotNear(34, 35));
  await teleportTo(bastien, freeSpotIn(map, game, [spotNear(34, 35)])!);
  await expect.poll(() => playing(alice), { timeout: DECODE_TIMEOUT }).toBe('dusk');
  await expect.poll(() => playing(bastien), { timeout: DECODE_TIMEOUT }).toBe('dusk');

  // E devant l'enceinte la coupe, pour tous ceux qui sont dans la pièce.
  await alice.keyboard.press('e');
  await expect.poll(() => playing(alice), { timeout: DECODE_TIMEOUT }).toBeNull();
  await expect.poll(() => playing(bastien), { timeout: DECODE_TIMEOUT }).toBeNull();

  // Le serveur la garde : Bastien recharge, la pièce est toujours coupée pour lui.
  await bastien.reload();
  await enterOffice(bastien);
  await bastien.waitForTimeout(1500);
  expect(await playing(bastien)).toBeNull();

  // Alice la relance : Bastien l'entend de nouveau, ce qui montre aussi que le silence d'avant venait bien de la pièce.
  await alice.waitForTimeout(MUSIC_RATE_MS + 200);
  await alice.keyboard.press('e');
  await expect.poll(() => playing(bastien), { timeout: DECODE_TIMEOUT }).toBe('dusk');
  await expect.poll(() => playing(alice), { timeout: DECODE_TIMEOUT }).toBe('dusk');
});

test('Alice règle la musique de son bureau avec le bouton de la puce du lieu : Bastien, qui y entre, l\'entend, mais ne peut pas la régler', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice', 'kept');
  const bastien = await arrive(browser, 'Bastien');

  // Alice dans son bureau (le vrai bouton : elle y marche), dont on tire la clé.
  const panel = await openDeskPanel(alice);
  await panel.getByRole('button', { name: 'Fermer le panneau Mon bureau' }).click();
  await expect(panel).toHaveCount(0);
  const here = await selfAt(alice);
  const room = zoneAt(map, here.x, here.y, ['desk'])!;
  const place = placeByKey(map, `desk:${deskKey(room)}`)!;
  await expect.poll(() => playing(alice), { timeout: DECODE_TIMEOUT }).toBe('focus');

  // Dans son bureau, la puce du lieu a son bouton haut-parleur ; la vignette de la carte ouvre la liste : elle choisit « Expédition ».
  const button = alice.getByRole('button', { name: 'Musique de la pièce', exact: true });
  await button.click();
  const dialog = alice.getByRole('dialog', { name: 'Musique de la pièce' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Changer la musique de la pièce/ }).click();
  // Le choix ne change qu'à l'annonce du serveur : on clique (la ligne ne se coche pas d'elle-même), puis on attend.
  await dialog.getByRole('button', { name: /^Expédition/ }).click();
  await expect(dialog.getByRole('button', { name: /^Expédition/ })).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => playing(alice), { timeout: DECODE_TIMEOUT }).toBe('quest');
  // Échap revient à la carte, qui dit qui l'a réglée ; un second Échap ferme la fenêtre.
  await alice.keyboard.press('Escape');
  await expect(dialog.getByText('Réglée par Alice')).toBeVisible();
  await alice.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Bastien entre dans son bureau (la porte est ouverte) : il entend l'ambiance d'Alice, et n'a pas de bouton pour la régler.
  await teleportTo(bastien, freeSpotIn(map, place, [here])!);
  await expect.poll(() => playing(bastien), { timeout: DECODE_TIMEOUT }).toBe('quest');
  await expect(bastien.getByRole('button', { name: 'Musique de la pièce', exact: true })).toHaveCount(0);

  // Alice le rend : le bureau est libre pour les tests suivants.
  await giveDeskBack(alice);
});
