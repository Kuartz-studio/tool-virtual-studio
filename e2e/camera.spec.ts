import { expect, test, type Page } from '@playwright/test';
import { joinOffice, selfAt } from './helpers';

// La caméra se fait glisser à la souris sur la carte, et revient sur soi d'un double-clic, ou quand on se remet à marcher.

// Où l'avatar local est dessiné à l'écran (en pixels du canevas).
async function selfOnScreen(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const self = window.__office!.self!;
    return window.__office!.toScreen(self.x, self.y);
  });
}

async function canvasBox(page: Page) {
  const box = await page.locator('#game-container canvas').boundingBox();
  if (!box) throw new Error('Pas de canevas.');
  return box;
}

test('glisser la carte déplace la vue, le double-clic la recentre', async ({ page }) => {
  await joinOffice(page, 'Paulo');
  const box = await canvasBox(page);
  const before = await selfOnScreen(page);
  const feet = await selfAt(page);

  // Un appui à un quart du canevas, glissé de 200 px vers la gauche et 120 px vers le haut.
  const from = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 100, from.y - 60, { steps: 5 });
  await page.mouse.move(from.x - 200, from.y - 120, { steps: 5 });
  await page.mouse.up();

  // La vue a suivi la souris : l'avatar est dessiné plus à gauche et plus haut ; lui n'a pas bougé.
  const dragged = await selfOnScreen(page);
  expect(dragged.x).toBeLessThan(before.x - 50);
  expect(dragged.y).toBeLessThan(before.y - 30);
  expect(await selfAt(page)).toMatchObject({ x: feet.x, y: feet.y });

  // Un simple clic ne fait pas glisser la carte.
  await page.mouse.click(from.x, from.y);
  const clicked = await selfOnScreen(page);
  expect(Math.abs(clicked.x - dragged.x)).toBeLessThan(2);

  // Un double-clic la recentre sur l'avatar.
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(async () => Math.abs((await selfOnScreen(page)).x - before.x)).toBeLessThan(3);
  await expect.poll(async () => Math.abs((await selfOnScreen(page)).y - before.y)).toBeLessThan(3);
});

test('après avoir glissé la carte, se remettre à marcher recentre la caméra', async ({ page }) => {
  await joinOffice(page, 'Pauline');
  const box = await canvasBox(page);
  const from = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 220, from.y + 80, { steps: 8 });
  await page.mouse.up();
  const centre = { x: box.width / 2, y: box.height / 2 };
  const far = await selfOnScreen(page);
  expect(Math.abs(far.x - centre.x)).toBeGreaterThan(100);

  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.up('ArrowDown');
  await expect.poll(async () => Math.abs((await selfOnScreen(page)).x - centre.x), { timeout: 3000 }).toBeLessThan(40);
});
