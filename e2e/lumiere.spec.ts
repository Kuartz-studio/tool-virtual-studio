import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { deskSettingsButton, goToDeskButton, joinOffice, openDeskPanel, selfAt } from './helpers';

// La lumière du bureau, sur la vraie carte (le second serveur des tests : playwright.config.ts) : l'interrupteur est sur le mur nord de la rue
// (case 28, 10). Une personne qui s'en approche et appuie sur E tamise la lumière pour tout le monde ; un deuxième appui l'éteint : la nuit tombe chez
// elle et chez les autres, qui l'apprennent par un message passager ; un troisième rallume.

// Un seul navigateur à la fois : deux personnes, et le reste de la suite qui tourne sur ce serveur (les tests de personnalisation cherchent un
// bureau libre, et il n'y en a que six).
test.describe.configure({ mode: 'default' });

// Dans la rue, à deux cases de l'interrupteur (la portée est de trois) : la case (28, 12).
const NEAR_SWITCH = { x: 28 * 32 + 16, y: 12 * 32 + 16 };

// Place l'avatar sur cette case (window.__office.teleport, que le serveur n'accepte qu'avec E2E=1), arrêté.
async function teleport(page: Page, spot: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => window.__office!.teleport(x, y), spot);
  await expect.poll(() => selfAt(page)).toMatchObject(spot);
}

// Chacun reçoit un bureau en arrivant, et les tests de personnalisation en cherchent de libres sur ce serveur : on le rend tout de suite (voir
// musique-lieux.spec.ts, d'où vient cette fonction). L'avatar y marche, puis revient où il était.
async function giveDeskBack(page: Page): Promise<void> {
  if (!(await goToDeskButton(page).or(deskSettingsButton(page)).isVisible())) return;
  const { x, y } = await selfAt(page);
  const panel = await openDeskPanel(page);
  const giveBack = panel.getByRole('button', { name: 'Rendre mon bureau' });
  await expect(giveBack).toBeVisible();
  await giveBack.click();
  await panel.getByRole('button', { name: 'Oui, le rendre' }).click();   // la confirmation
  await expect(panel.getByText('Tu n\'as pas de bureau.')).toBeVisible();
  await panel.getByRole('button', { name: 'Fermer le panneau Mon bureau' }).click();
  await expect(panel).toHaveCount(0);
  await expect(goToDeskButton(page).or(deskSettingsButton(page))).toHaveCount(0);
  await teleport(page, { x, y });
}

const ui = (page: Page) => page.locator('.office-ui');
const nightLevel = (page: Page) => page.evaluate(() => window.__office?.nightLevel() ?? -1);

test('l\'interrupteur du couloir tamise, éteint et rallume la lumière pour tout le monde', async ({ browser }) => {
  test.slow();
  const contexts: BrowserContext[] = [];
  let a: Page | null = null;
  try {
    const arrive = async (name: string) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await joinOffice(page, name);
      return page;
    };
    const [pageA, pageB] = await Promise.all([arrive('Alice'), arrive('Bastien')]);
    a = pageA;
    const b = pageB;
    await Promise.all([giveDeskBack(a), giveDeskBack(b)]);

    // Tout commence allumé : la couche de nuit n'est pas dessinée.
    await expect(ui(a)).toHaveAttribute('data-lights', 'on');
    await expect(ui(b)).toHaveAttribute('data-lights', 'on');
    expect(await nightLevel(a)).toBe(0);

    // Alice se met près de l'interrupteur, et appuie sur E : la lumière est tamisée chez les deux, la pièce s'assombrit (DIM_LEVEL, 0,56), et Bastien en est prévenu.
    await teleport(a, NEAR_SWITCH);
    await a.keyboard.press('e');
    await expect(ui(a)).toHaveAttribute('data-lights', 'dim');
    await expect(ui(b)).toHaveAttribute('data-lights', 'dim');
    await expect(ui(b)).toHaveAttribute('data-theme', 'day');
    await expect.poll(() => nightLevel(a!), { timeout: 10_000 }).toBe(0.56);
    await expect.poll(() => nightLevel(b), { timeout: 10_000 }).toBe(0.56);
    await expect(b.locator('.toast').filter({ hasText: 'Alice a tamisé la lumière' })).toBeVisible();

    // Le serveur laisse 800 ms entre deux changements d'une même personne : on les attend. Un deuxième appui éteint : la nuit va jusqu'au bout.
    await a.waitForTimeout(1000);
    await a.keyboard.press('e');
    await expect(ui(a)).toHaveAttribute('data-lights', 'off');
    await expect(ui(b)).toHaveAttribute('data-lights', 'off');
    await expect.poll(() => nightLevel(a!), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => nightLevel(b), { timeout: 10_000 }).toBe(1);
    await expect(b.locator('.toast').filter({ hasText: 'Alice a éteint la lumière' })).toBeVisible();

    // Un troisième appui rallume pour les deux.
    await a.waitForTimeout(1000);
    await a.keyboard.press('e');
    await expect(ui(a)).toHaveAttribute('data-lights', 'on');
    await expect(ui(b)).toHaveAttribute('data-lights', 'on');
    // Le néon clignote un instant au rallumage, puis la nuit est retirée.
    await expect.poll(() => nightLevel(a!), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => nightLevel(b), { timeout: 10_000 }).toBe(0);
  } finally {
    // Un échec en route ne doit pas laisser la nuit (ou la lumière tamisée) sur le serveur : on rallume si besoin, un appui après l'autre.
    for (let presses = 0; a && presses < 2 && (await ui(a).getAttribute('data-lights').catch(() => 'on')) !== 'on'; presses++) {
      await a.waitForTimeout(1000);
      await a.keyboard.press('e').catch(() => undefined);
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});
