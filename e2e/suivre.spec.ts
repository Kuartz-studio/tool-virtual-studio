import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { buildOfficeTiledMap, parseOfficeMap, placeByKey, zoneAt } from '../packages/shared/src/index';
import { giveDeskBack, joinOffice, openDeskPanel, openPanel, selfAt } from './helpers';

// Le menu d'une personne, sur la vraie carte (le second serveur des tests : playwright.config.ts) : un clic droit sur son avatar l'ouvre à la place de celui du
// navigateur. À moins de 5 cases, « Suivre » fait marcher derrière elle, à une case ; plus loin, « Rejoindre » pose à côté d'elle ; dans son bureau, porte fermée,
// « Inviter dans le bureau » (ici depuis le panneau Personnes, au clic droit sur sa ligne) : elle accepte, et arrive dans la pièce.

// Un seul navigateur à la fois : deux personnes, et le reste de la suite qui tourne sur ce serveur (les tests de personnalisation cherchent un bureau libre).
test.describe.configure({ mode: 'default' });

const map = parseOfficeMap(buildOfficeTiledMap());
const at = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });
// La rue des bureaux, sur sa rangée du milieu (la 17) : rien n'y bloque, d'une terrasse à l'autre. Alice à douze cases de son bout ouest (la colonne 30),
// Bruno à quatre cases d'elle, ou à vingt (hors de l'écran).
const street = placeByKey(map, 'street')!.rects[0]!;
const [WEST, ROW] = [Math.floor(street.x / 32), Math.floor((street.y + street.height / 2) / 32)];
const ALICE = at(WEST + 12, ROW);
const NEAR = at(WEST + 16, ROW);
const FAR = at(WEST + 32, ROW);

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Chacun reçoit un bureau à son arrivée, s'il en reste un des six : qui n'a pas besoin du sien le rend tout de suite, pour Alice, qui en a besoin
// au second test, et pour les specs qui passent après sur ce serveur.
async function arrive(browser: Browser, name: string, desk: 'needed' | 'given back' = 'given back'): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  if (desk === 'given back') await giveDeskBack(page);
  return page;
}

async function teleport(page: Page, spot: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => window.__office!.teleport(x, y), spot);
  await expect.poll(() => selfAt(page)).toMatchObject(spot);
}

// Où est cette personne d'après la page de l'autre (le dernier point dessiné), en pixels de la carte.
const seenAt = (page: Page, id: string) => page.evaluate((who) => window.__office!.players[who] ?? null, id);
const gap = async (page: Page, id: string) => {
  const [me, other] = [await selfAt(page), await seenAt(page, id)];
  return other ? Math.hypot(me.x - other.x, me.y - other.y) : Number.POSITIVE_INFINITY;
};

// Un clic droit sur l'avatar de cette personne (au milieu de son corps), tel que la page le dessine.
async function rightClickAvatar(page: Page, id: string): Promise<void> {
  await expect.poll(() => seenAt(page, id)).not.toBeNull();
  const other = (await seenAt(page, id))!;
  const screen = await page.evaluate(({ x, y }) => window.__office!.toScreen(x, y - 20), other);
  await page.mouse.click(screen.x, screen.y, { button: 'right' });
}

test('clic droit sur un avatar : à quatre cases, Suivre fait marcher derrière lui à une case ; plus loin, Rejoindre pose à côté de lui', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  const bruno = await arrive(browser, 'Bruno');
  const aliceId = (await selfAt(alice)).id;
  await teleport(alice, ALICE);
  await teleport(bruno, NEAR);
  // Son saut arrive chez Bruno par le monde, un peu après le sien : avant, il la voit encore à l'accueil, hors de son écran.
  await expect.poll(() => seenAt(bruno, aliceId)).toMatchObject(ALICE);

  // Le menu, à la place de celui du navigateur : Profil et Suivre (elle est à moins de 5 cases).
  await rightClickAvatar(bruno, aliceId);
  const menu = bruno.getByRole('menu', { name: 'Actions pour Alice' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Profil', 'Suivre']);
  await menu.getByRole('menuitem', { name: 'Suivre' }).click();
  await expect(menu).toHaveCount(0);
  await expect(bruno.locator('.follow-pill')).toContainText('Tu suis Alice');
  // Il marche jusqu'à une case d'elle, et s'arrête.
  await expect.poll(() => gap(bruno, aliceId), { timeout: 10_000 }).toBeLessThanOrEqual(36);
  expect(await gap(bruno, aliceId)).toBeGreaterThanOrEqual(28);

  // Elle s'en va vers l'ouest : il la suit, et s'arrête de nouveau à une case.
  await alice.keyboard.down('ArrowLeft');
  await alice.waitForTimeout(900);
  await alice.keyboard.up('ArrowLeft');
  await expect.poll(() => gap(bruno, aliceId), { timeout: 10_000 }).toBeLessThanOrEqual(50);
  expect((await selfAt(bruno)).x).toBeLessThan(ALICE.x);
  expect(await gap(bruno, aliceId)).toBeGreaterThanOrEqual(16);

  // Une touche de déplacement reprend la main : il ne la suit plus.
  await bruno.keyboard.press('ArrowDown');
  await expect(bruno.locator('.follow-pill')).toHaveCount(0);

  // Loin d'elle (elle n'est plus à l'écran) : le même menu, par sa ligne du panneau Personnes ; Rejoindre, et il arrive à côté d'elle, d'un saut.
  await teleport(bruno, FAR);
  const panel = await openPanel(bruno, 'Personnes');
  // Par son identifiant : les Alice d'autres tests sont peut-être encore là.
  await panel.locator(`[data-user="${aliceId}"]`).click({ button: 'right' });
  const far = bruno.getByRole('menu', { name: 'Actions pour Alice' });
  await expect(far.getByRole('menuitem')).toHaveText(['Profil', 'Rejoindre']);
  await far.getByRole('menuitem', { name: 'Rejoindre' }).click();
  await expect.poll(() => gap(bruno, aliceId), { timeout: 10_000 }).toBeLessThanOrEqual(50);
  expect(await gap(bruno, aliceId)).toBeGreaterThanOrEqual(28);
});

test('dans son bureau, porte fermée : inviter quelqu\'un depuis le panneau Personnes ; il accepte, et arrive dans la pièce', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice', 'needed');
  const bruno = await arrive(browser, 'Bruno');
  const brunoId = (await selfAt(bruno)).id;
  await teleport(bruno, FAR);

  // Alice va dans son bureau et ferme sa porte.
  const desk = await openDeskPanel(alice);
  const lock = desk.getByRole('switch', { name: 'Fermer la porte' });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-checked', 'true');
  const here = await selfAt(alice);
  const key = zoneAt(map, here.x, here.y, ['desk'])!.name;

  // Un clic droit sur la ligne de Bruno : Inviter dans le bureau.
  const people = await openPanel(alice, 'Personnes');
  await people.locator(`[data-user="${brunoId}"]`).click({ button: 'right' });
  const menu = alice.getByRole('menu', { name: 'Actions pour Bruno' });
  await menu.getByRole('menuitem', { name: 'Inviter dans le bureau' }).click();
  await expect(alice.locator('.toast').filter({ hasText: 'Invitation envoyée à Bruno.' })).toBeVisible();

  // Bruno voit l'invitation, l'accepte, et arrive dans le bureau d'Alice, porte fermée comprise ; Alice l'apprend.
  await expect(bruno.locator('.toast').filter({ hasText: 'Alice t\'invite dans son bureau' })).toBeVisible({ timeout: 10_000 });
  await bruno.getByRole('button', { name: 'Accepter l\'invitation de Alice' }).click();
  await expect
    .poll(async () => {
      const spot = await selfAt(bruno);
      return zoneAt(map, spot.x, spot.y, ['desk'])?.name ?? null;
    }, { timeout: 10_000 })
    .toBe(key);
  await expect(alice.locator('.toast').filter({ hasText: 'Bruno arrive dans ton bureau.' })).toBeVisible();

  // Alice rend son bureau (elle y est : pas de marche), pour les tests qui cherchent une place libre.
  const again = await openDeskPanel(alice);
  await again.getByRole('button', { name: 'Rendre mon bureau' }).click();
  await again.getByRole('button', { name: 'Oui, le rendre' }).click();
  await expect(again.getByText('Tu n\'as pas de bureau.')).toBeVisible();
});
