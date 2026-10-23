import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { OFFICE_DESK_SLOTS, buildOfficeTiledMap, deskKey, parseOfficeMap, zoneAt } from '../packages/shared/src/index';
import { joinOffice, openDeskPanel, selfAt } from './helpers';

// Les portes vitrées des bureaux, sur la vraie carte (le second serveur des tests : playwright.config.ts) : le propriétaire ferme sa porte (elle se ferme chez
// tous, avec le bruit du verrou et de la porte), l'autre bute contre elle, y toque, le propriétaire le laisse entrer, puis rouvre la porte.

// Un seul navigateur à la fois : deux personnes, et le reste de la suite qui tourne sur ce serveur (les tests de personnalisation cherchent un bureau libre).
test.describe.configure({ mode: 'default' });

const map = parseOfficeMap(buildOfficeTiledMap());
const px = (tile: number) => tile * 32 + 16;
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

async function arrive(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  return page;
}

const doorsOf = (page: Page) => page.evaluate(() => window.__office!.doors());
const sfxOf = (page: Page) => page.evaluate(() => window.__audio?.sfx() ?? []);

async function teleport(page: Page, spot: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => window.__office!.teleport(x, y), spot);
  await expect.poll(() => selfAt(page)).toMatchObject(spot);
}

test('le propriétaire ferme sa porte : elle se ferme chez tous, l\'autre bute, toque, est laissé entrer, et la porte s\'ouvre devant lui', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  const bruno = await arrive(browser, 'Bruno');

  // La place d'Alice : celle du bureau où elle se trouve une fois arrivée chez elle (le serveur donne la première place libre).
  const panel = await openDeskPanel(alice);
  const here = await selfAt(alice);
  const room = zoneAt(map, here.x, here.y, ['desk'])!;
  const key = deskKey(room);
  const slot = OFFICE_DESK_SLOTS.find((s) => s.key === key)!;
  const door = { x: (slot.door.x + slot.door.w / 2) * 32, y: (slot.door.y + slot.door.h / 2) * 32 };
  // Alice se met au fond de sa pièce, loin de sa porte (elle ne s'ouvre qu'à 1,5 case) ; Bruno dans la rue, 2 cases devant la porte.
  const southDoor = slot.doorSide === 'south';
  await teleport(alice, { x: px(slot.room.x + 4), y: southDoor ? px(slot.room.y + 1) : px(slot.room.y + slot.room.h - 2) });
  const street = { x: door.x, y: southDoor ? (slot.door.y + slot.door.h) * 32 + 48 : slot.door.y * 32 - 48 };
  await teleport(bruno, street);
  await expect.poll(async () => (await doorsOf(bruno))[key]).toBe('open');

  // Elle ferme (l'interrupteur de la porte) : le verrou et la porte, pour elle ; la porte, pour Bruno qui est à deux cases.
  const lock = panel.getByRole('switch', { name: 'Fermer la porte' });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await doorsOf(bruno))[key], { timeout: 10_000 }).toBe('closed');
  await expect.poll(async () => (await doorsOf(alice))[key], { timeout: 10_000 }).toBe('closed');
  await expect.poll(() => sfxOf(alice)).toEqual(expect.arrayContaining(['lock', 'door-close']));
  await expect.poll(() => sfxOf(bruno)).toContain('door-close');

  // Bruno marche vers la porte : il bute, et on lui dit comment toquer.
  const toward = southDoor ? 'ArrowUp' : 'ArrowDown';
  await bruno.keyboard.down(toward);
  await bruno.waitForTimeout(1800);
  await bruno.keyboard.up(toward);
  const stopped = await selfAt(bruno);
  expect(zoneAt(map, stopped.x, stopped.y, ['desk'])?.name ?? null, 'Bruno n\'est pas entré').not.toBe(key);
  await expect(bruno.getByText(/porte fermée\. Clique sur la porte pour toquer/)).toBeVisible();

  // Il clique sur la porte : Alice voit qui toque, et le laisse entrer.
  await expect.poll(async () => bruno.evaluate(({ x, y }) => window.__office!.toScreen(x, y), { x: door.x, y: door.y })).toBeTruthy();
  const onScreen = await bruno.evaluate(({ x, y }) => window.__office!.toScreen(x, y), { x: door.x, y: door.y });
  await bruno.mouse.click(onScreen.x, onScreen.y);
  await expect(alice.getByText('Bruno toque à la porte de ton bureau.')).toBeVisible({ timeout: 10_000 });
  await alice.getByRole('button', { name: 'Laisser entrer Bruno' }).click();

  // La porte s'ouvre devant lui, et il entre.
  await bruno.keyboard.down(toward);
  await expect.poll(async () => (await doorsOf(bruno))[key], { timeout: 10_000 }).toMatch(/opening|open/);
  await expect
    .poll(async () => {
      const at = await selfAt(bruno);
      return zoneAt(map, at.x, at.y, ['desk'])?.name ?? null;
    }, { timeout: 15_000 })
    .toBe(key);
  await bruno.keyboard.up(toward);

  // Alice rouvre sa porte pour tout le monde : elle s'ouvre chez tous.
  await lock.click();
  await expect(lock).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await doorsOf(alice))[key], { timeout: 10_000 }).toBe('open');
  await expect.poll(async () => (await doorsOf(bruno))[key], { timeout: 10_000 }).toBe('open');
  await expect.poll(() => sfxOf(alice)).toContain('unlock');
});
