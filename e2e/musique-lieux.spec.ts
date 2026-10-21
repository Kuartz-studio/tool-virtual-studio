import { expect, test, type Page } from '@playwright/test';
import { buildOfficeTiledMap, GRAND_HALL, isWalkableTile, LOUNGE, LOUNGE_MUSIC_X, LOUNGE_TERRACE_WIDTH, MEETING_ROOM, OFFICE_DESK_SLOTS, parseOfficeMap, PLAZA } from '../packages/shared/src/index';
import { joinOffice, officeBar, selfAt } from './helpers';

// La musique d'ambiance par endroit, sur la vraie carte (le second serveur des tests : playwright.config.ts) : en marchant d'un endroit à
// l'autre, l'ambiance change, avec les vrais fichiers décodés par Chromium. Les règles sont dans apps/client/src/audio/scene-at.ts.

// Les tests de ce fichier passent l'un après l'autre, dans un seul navigateur à la fois : plusieurs gens par test, des fichiers de plusieurs
// Mo à décoder, et le reste de la suite qui tourne en même temps : étalés sur tous les processus, ils feraient dépasser leur délai à des tests
// déjà longs (le builder de personnalisation, les groupes de multiplayer).
test.describe.configure({ mode: 'default' });

const map = parseOfficeMap(buildOfficeTiledMap());
const DECODE_TIMEOUT = 20_000;

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

const playing = (page: Page) => page.evaluate(() => window.__audio?.playing() ?? null);

// Il n'y a que six bureaux sur cette carte, et le serveur en donne un à chaque arrivant : ce test n'a pas besoin du sien, il le rend tout de
// suite, pour que les tests de personnalisation, qui tournent en même temps sur ce serveur, en trouvent un de libre.
async function giveDeskBack(page: Page): Promise<void> {
  await officeBar(page).getByRole('button', { name: 'Mon bureau' }).click();
  const panel = page.getByRole('complementary', { name: 'Mon bureau' });
  const giveBack = panel.getByRole('button', { name: 'Rendre mon bureau' });
  await expect(giveBack.or(panel.getByText('Tu n\'as pas de bureau.'))).toBeVisible();
  if (await giveBack.isVisible()) await giveBack.click();
  await expect(panel.getByText('Tu n\'as pas de bureau.')).toBeVisible();
  await officeBar(page).getByRole('button', { name: 'Mon bureau' }).click();
  await expect(panel).toHaveCount(0);
}

// Place l'avatar sur cette case (window.__office.teleport, que le serveur n'accepte qu'avec E2E=1), arrêté.
async function teleport(page: Page, spot: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => window.__office!.teleport(x, y), spot);
  await expect.poll(() => selfAt(page)).toMatchObject(spot);
}

test('chaque endroit a son ambiance : on y reste un moment, la musique change', async ({ page }) => {
  test.slow();
  await joinOffice(page, 'Fanny');
  await giveDeskBack(page);

  // On apparaît à l'accueil : la salle d'attente.
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('lobby');

  const places: Array<[name: string, at: { x: number; y: number }, scene: string]> = [
    ['la grande salle', spotNear(GRAND_HALL.x + 8, GRAND_HALL.y + 8), 'drift'],
    ['la place centrale', spotNear(PLAZA.x + 16, PLAZA.y + 6), 'sunny'],
    ['la salle de réunion', spotNear(MEETING_ROOM.x + 6, MEETING_ROOM.y + 4), 'focus'],
    ['le coin musique', spotNear(LOUNGE_MUSIC_X + 4, LOUNGE.y + 7), 'quest'],
    ['le salon', spotNear(LOUNGE.x + LOUNGE_TERRACE_WIDTH + 6, LOUNGE.y + 9), 'dusk'],
    ['la terrasse de la piscine', spotNear(LOUNGE.x + 4, LOUNGE.y + 10), 'sunny'],
    ['un bureau', { x: (OFFICE_DESK_SLOTS[2]!.room.x + 4) * 32 + 16, y: (OFFICE_DESK_SLOTS[2]!.room.y + 3) * 32 + 16 }, 'focus'],
    ['le couloir', spotNear(30, 12), 'lobby'],
  ];
  for (const [name, at, scene] of places) {
    await teleport(page, at);
    await expect.poll(() => playing(page), { message: `l'ambiance de ${name}`, timeout: DECODE_TIMEOUT }).toBe(scene);
  }
});

test('l\'ambiance choisie à la main prime sur l\'endroit, et « Selon l\'endroit » rend la main', async ({ page }) => {
  test.slow();
  await joinOffice(page, 'Gaspard');
  await giveDeskBack(page);
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('lobby');

  await officeBar(page).getByRole('button', { name: 'Son', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Son', exact: true });
  await panel.getByRole('radio', { name: /^Expédition/ }).check();
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('quest');

  // Ailleurs sur la carte, elle continue.
  await teleport(page, spotNear(GRAND_HALL.x + 8, GRAND_HALL.y + 8));
  await page.waitForTimeout(1500);
  expect(await playing(page)).toBe('quest');

  // « Selon l'endroit » : la grande salle, où l'on est.
  await panel.getByRole('radio', { name: /^Selon l'endroit/ }).check();
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('drift');
});
