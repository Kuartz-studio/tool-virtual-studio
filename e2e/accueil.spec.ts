import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { buildOfficeTiledMap, parseOfficeMap } from '../packages/shared/src/index';
import { giveDeskBack, joinOffice, officeBar, teleportTo } from './helpers';

// L'accueil, sur la vraie carte (le second serveur des tests : playwright.config.ts) : trois administratrices derrière le comptoir (Margot, Inès, Lucie,
// cases 13 à 15 de la rangée 38), à qui l'on parle de deux cases au plus (la touche E). Auprès d'elles, on confie une mission à quelqu'un, qui la reçoit dans sa
// liste, la termine, et monte de niveau (tout le bureau le voit) ; on y trouve aussi la boutique.

// Un seul navigateur à la fois : plusieurs personnes, et le reste de la suite qui tourne sur ce serveur (les tests de personnalisation cherchent un bureau libre).
test.describe.configure({ mode: 'default' });

const map = parseOfficeMap(buildOfficeTiledMap());
// Devant Inès, de l'autre côté du comptoir : la case sous la sienne (la carte dit où elle se tient).
const ines = map.clerks.find((clerk) => clerk.name === 'ines')!;
const AT_DESK = { x: ines.x, y: ines.y + map.tileSize };

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

// La pastille de niveau sur la puce « Moi » : le nombre seul (le texte pour les lecteurs d'écran est à part).
const meLevel = (page: Page) => officeBar(page).locator('.me-portrait .level-badge > [aria-hidden="true"]');

test('confier une mission à l\'accueil : elle arrive chez l\'autre, qui la termine et monte de niveau sous les yeux de tous', async ({ browser }) => {
  test.slow();
  const ana = await arrive(browser, 'Annabelle');
  const bob = await arrive(browser, 'Barnabé');
  const bobId = await bob.evaluate(() => window.__office!.self!.id);

  await teleportTo(ana, AT_DESK);
  await expect(meLevel(bob)).toHaveText('0');
  await ana.keyboard.press('e');
  const dialog = ana.getByRole('dialog', { name: 'Conversation avec Inès' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confier une mission' }).click();
  await dialog.locator(`[data-user="${bobId}"]`).click();
  await dialog.getByLabel('La mission').fill('Refaire la maquette');
  await dialog.getByRole('button', { name: 'Suivant' }).click();
  await dialog.getByRole('radio', { name: /^7/ }).click();
  await dialog.getByRole('button', { name: 'Suivant' }).click();
  await dialog.getByRole('button', { name: 'Confier la mission' }).click();
  await expect(dialog.getByRole('button', { name: 'Une autre mission' })).toBeVisible();

  // Barnabé est prévenu, la trouve dans ses missions et la termine : 1 250 XP, le niveau 1.
  await expect(bob.getByText('Annabelle te confie une mission : « Refaire la maquette »')).toBeVisible();
  await officeBar(bob).getByRole('button', { name: /^Missions/ }).click();
  const panel = bob.getByRole('complementary', { name: 'Missions' });
  await panel.getByRole('button', { name: 'Terminer la mission « Refaire la maquette »' }).click();
  await expect(bob.locator('.level-up')).toContainText('Niveau 1 !');
  await expect(meLevel(bob)).toHaveText('1');

  // Annabelle l'apprend, et le voit au niveau 1 dans le panneau Personnes.
  await expect(ana.getByText('Barnabé a accompli « Refaire la maquette »')).toBeVisible();
  await officeBar(ana).getByRole('button', { name: 'Personnes', exact: true }).click();
  await expect(ana.locator(`[data-user="${bobId}"] .level-badge > [aria-hidden="true"]`)).toHaveText('1');
});

test('la boutique : un élément acheté avec ses kuartzons est à soi, et la bourse baisse de son prix', async ({ browser }) => {
  test.slow();
  const ana = await arrive(browser, 'Apolline');
  // De quoi acheter (le coup de pouce des tests : de l'XP et des kuartzons d'un coup).
  await ana.evaluate(() => window.__office!.xp(0, 500));
  await officeBar(ana).getByRole('button', { name: 'Plus' }).click();
  await ana.getByRole('menuitem', { name: 'Boutique' }).click();
  const shop = ana.getByRole('complementary', { name: 'Boutique' });
  await expect(shop.locator('.shop-wallet-value')).toHaveText('500 kuartzons');
  await shop.getByRole('button', { name: 'Acheter « Papillon suspendu » pour 100 kuartzons' }).click();
  await shop.getByRole('button', { name: 'Confirmer l\'achat de « Papillon suspendu » pour 100 kuartzons' }).click();
  await expect(shop.locator('[data-item="mu-9-36"] .shop-owned')).toBeVisible();
  await expect(shop.locator('.shop-wallet-value')).toHaveText('400 kuartzons');
  await shop.getByRole('tab', { name: /^Mes achats/ }).click();
  await expect(shop.locator('.shop-card')).toHaveCount(1);
});
