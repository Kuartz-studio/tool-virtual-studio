import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { buildOfficeTiledMap, parseOfficeMap, placeByKey } from '../packages/shared/src/index';
import { giveDeskBack, joinOffice, playerSeenBy, restingAt, selfAt, teleportTo, WALK_TIMEOUT } from './helpers';

// Le café, sur la vraie carte (le second serveur des tests : playwright.config.ts). La machine est sur le bar de la cafétéria (case 44, 24) ; on se sert
// devant le bar, sur la case (44, 25). Se servir (la touche E, à deux cases au plus) donne 30 s de vitesse doublée : le serveur la laisse faire, tout le
// bureau voit une tasse fumante au-dessus de la tête, et celui qui l'a prise voit la pastille compter.

// Un seul navigateur à la fois : plusieurs personnes, et le reste de la suite qui tourne sur ce serveur (les tests de personnalisation cherchent un bureau libre).
test.describe.configure({ mode: 'default' });

const map = parseOfficeMap(buildOfficeTiledMap());
// La case où l'on se sert (la carte la donne : le centre de la case devant la machine).
const AT_MACHINE = map.coffees[0]!;
// À trois cases de là : un pas trop loin (la portée est de deux).
const TOO_FAR = { x: AT_MACHINE.x, y: AT_MACHINE.y + 3 * map.tileSize };
// Le bout ouest de la rue des bureaux, sur sa rangée du milieu (la 17) : libre jusqu'au jardin de l'est, plus de 70 cases, de quoi courir à 960 px/s pendant
// plus de 2 s.
const street = placeByKey(map, 'street')!.rects[0]!;
const STREET_WEST = { x: street.x + map.tileSize / 2, y: street.y + street.height / 2 };

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

async function arrive(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  await giveDeskBack(page);
  return page;
}

const cupsOf = (page: Page) => page.evaluate(() => window.__office!.cups());
const sfxOf = (page: Page) => page.evaluate(() => window.__audio?.sfx() ?? []);
const speed = (page: Page) => page.evaluate(() => window.__office!.speed());
const boosted = (page: Page) => page.evaluate(() => window.__office!.boosted());
const pill = (page: Page) => page.locator('.coffee-pill');

test('se servir à la machine : la vitesse du café, une tasse chez tous, la pastille qui compte, les sons ; et la fin du café', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  const bruno = await arrive(browser, 'Bruno');
  const aliceId = (await selfAt(alice)).id;

  // Rien au départ : ni tasse, ni pastille, ni vitesse du café.
  expect(await cupsOf(alice)).toEqual([]);
  expect(await cupsOf(bruno)).toEqual([]);
  await expect(pill(alice)).toHaveCount(0);

  // Trop loin de la machine, E ne fait rien.
  await teleportTo(alice, TOO_FAR);
  await alice.keyboard.press('e');
  await alice.waitForTimeout(700);
  expect(await boosted(alice)).toBe(false);
  expect(await cupsOf(bruno)).toEqual([]);

  // Devant la machine, E sert un café : à la confirmation du serveur, Alice a la vitesse du café, une tasse (chez elle et chez Bruno) et sa pastille ; le
  // bruit de la machine, puis celui du café, et la machine s'agite un instant.
  await teleportTo(alice, AT_MACHINE);
  await alice.keyboard.press('e');
  await expect.poll(() => boosted(alice)).toBe(true);
  await expect.poll(() => cupsOf(alice)).toEqual([aliceId]);
  await expect.poll(() => cupsOf(bruno)).toEqual([aliceId]);
  await expect(pill(alice)).toBeVisible();
  await expect(pill(alice)).toHaveText(/^(30|29) s$/);
  await expect(pill(bruno)).toHaveCount(0);
  await expect.poll(() => alice.evaluate(() => window.__office!.machineExcited())).toBe(true);
  await expect.poll(async () => (await sfxOf(alice)).filter((id) => id === 'coffee' || id === 'boost')).toEqual(['coffee', 'boost']);

  // Le compte à rebours avance.
  await expect(pill(alice)).toHaveText(/^(2[0-9]) s$/, { timeout: 15_000 });

  // Elle court à 640 px/s, 960 avec Maj en plus, et le serveur la laisse faire : Bruno la voit avancer, et elle n'est pas recalée. La rue des bureaux est assez
  // longue pour tenir la course (la cafétéria, elle, n'a qu'une vingtaine de cases libres à l'est du bar).
  await teleportTo(alice, STREET_WEST);
  const x0 = (await selfAt(alice)).x;
  await alice.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(alice)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(x0);
  await expect.poll(() => speed(alice)).toBe(640);
  await alice.keyboard.down('Shift');
  await expect.poll(() => speed(alice)).toBe(960);
  await expect.poll(async () => (await playerSeenBy(bruno, aliceId))?.x ?? 0, { timeout: WALK_TIMEOUT }).toBeGreaterThan(x0 + 100);
  await alice.keyboard.up('Shift');
  await alice.keyboard.up('ArrowRight');
  const stopped = await restingAt(alice);
  await alice.waitForTimeout(500);
  expect(await selfAt(alice)).toEqual(stopped);

  // La fin : les 30 s de la machine sont trop longues pour un test, mais le serveur éteint comme à l'échéance quand il en reste 2,5 s (debug:boost remet le
  // compte à cette durée, comme le ferait un café). La tasse part chez tous, la pastille aussi, et la vitesse retombe à celle de la course.
  await alice.evaluate(() => window.__office!.boost(2500));
  await expect.poll(() => cupsOf(bruno)).toEqual([aliceId]);
  await expect.poll(() => cupsOf(alice), { timeout: 10_000 }).toEqual([]);
  await expect.poll(() => cupsOf(bruno), { timeout: 10_000 }).toEqual([]);
  await expect(pill(alice)).toHaveCount(0);
  expect(await boosted(alice)).toBe(false);
  await alice.keyboard.down('ArrowLeft');
  await alice.keyboard.down('Shift');
  await expect.poll(() => speed(alice)).toBe(480);
  await alice.keyboard.up('Shift');
  await alice.keyboard.up('ArrowLeft');
});

test('arriver pendant le café d\'un autre : sa tasse est déjà là, avec ce qu\'il en reste', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  const aliceId = (await selfAt(alice)).id;
  await teleportTo(alice, AT_MACHINE);
  await alice.keyboard.press('e');
  await expect.poll(() => cupsOf(alice)).toEqual([aliceId]);

  // Chloé arrive après : l'init du serveur lui dit le café d'Alice.
  const chloe = await arrive(browser, 'Chloé');
  await expect.poll(() => cupsOf(chloe)).toEqual([aliceId]);
  // Et le café d'Alice n'est pas celui de Chloé : pas de pastille chez elle, pas de vitesse.
  await expect(pill(chloe)).toHaveCount(0);
  expect(await boosted(chloe)).toBe(false);
});
