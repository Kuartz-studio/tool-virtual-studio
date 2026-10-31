import { expect, test } from '@playwright/test';
import { buildOfficeTiledMap, freeSpotIn, parseOfficeMap, placeByKey } from '../packages/shared/src/index';
import { giveDeskBack, joinOffice, selfAt } from './helpers';

// La carte du bureau (touche M, office/OfficePlan.tsx), sur la vraie carte : le plan schématique, chacun à sa place ; un double-clic y fait courir l'avatar (la
// marche automatique, `local:walk-to`), avec une marque à l'endroit visé jusqu'à l'arrivée ; un clic à côté, ou Échap, la ferme.

// La vraie carte (91 × 56 cases de 32 px), en pixels, et la salle de conférence (son rectangle, et la case libre la plus proche de son milieu : la grande table
// en occupe le centre).
const map = parseOfficeMap(buildOfficeTiledMap());
const OFFICE = { width: map.widthTiles * map.tileSize, height: map.heightTiles * map.tileSize };
const conference = placeByKey(map, 'conference')!;
const ROOM = conference.rects[0]!;
const TARGET = freeSpotIn(map, conference, [])!;

const autoWalking = (page: import('@playwright/test').Page) => page.evaluate(() => window.__office!.autoWalking());

test('la touche M ouvre la carte, chacun à sa place ; un double-clic y fait courir l\'avatar ; un clic à côté la ferme', async ({ page }) => {
  await joinOffice(page, 'Margaux');
  await giveDeskBack(page);
  const plan = page.getByRole('dialog', { name: 'Carte du bureau' });

  await page.keyboard.press('m');
  await expect(plan).toBeVisible();
  await expect(plan.locator('.plan-person[data-self] .plan-name')).toHaveText('Margaux');
  await expect(plan.locator('.plan-label', { hasText: 'CAFÉTÉRIA' })).toBeVisible();

  // Un double-clic dans la salle de conférence, sur le plan : l'avatar y court, une marque reste là tant qu'il y va. La fenêtre se déplie depuis le coin
  // (plan-unfold) : on mesure le plan une fois dépliée, sinon le double-clic tombe ailleurs (au hall, pour une mesure prise à mi-dépliage).
  await plan.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const frame = plan.locator('.plan-frame');
  const box = (await frame.boundingBox())!;
  const at = { x: box.x + (TARGET.x / OFFICE.width) * box.width, y: box.y + (TARGET.y / OFFICE.height) * box.height };
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(() => autoWalking(page)).toBe(true);
  await expect(plan.locator('.plan-pin')).toBeVisible();
  await expect.poll(() => autoWalking(page), { timeout: 20_000 }).toBe(false);
  const feet = await selfAt(page);
  expect(feet.x >= ROOM.x && feet.x < ROOM.x + ROOM.width && feet.y >= ROOM.y && feet.y < ROOM.y + ROOM.height, `arrivé en (${feet.x}, ${feet.y})`).toBe(true);
  await expect(plan.locator('.plan-pin')).toHaveCount(0);

  // Un clic à côté, sur le jeu, la ferme ; M la rouvre, Échap la referme.
  const canvas = (await page.locator('#game-container canvas').boundingBox())!;
  await page.mouse.click(canvas.x + 300, canvas.y + 300);
  await expect(plan).toBeHidden();
  await page.keyboard.press('m');
  await expect(plan).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(plan).toBeHidden();
});
