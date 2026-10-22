import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { buildOfficeTiledMap, parseOfficeMap, placeAt } from '../packages/shared/src/index';
import { giveDeskBack, joinOffice, meChip, openDeskPanel, openMeMenu, openPanel, playerSeenBy, selfAt } from './helpers';

// Les modes qui conduisent quelque part, sur la vraie carte (le second serveur des tests : playwright.config.ts) : « Sport » téléporte à la salle de sport, et « Normal » (ou n'importe quel autre
// mode) ramène à son bureau, ou à l'accueil quand on n'en a pas. Les autres voient l'avatar arriver là ; le départ et l'arrivée ont leur anneau de lumière et leur son.

// Un seul navigateur à la fois : plusieurs personnes, et le reste de la suite qui tourne sur ce serveur (les tests de personnalisation cherchent un bureau libre).
test.describe.configure({ mode: 'default' });

const map = parseOfficeMap(buildOfficeTiledMap());
// Le lieu où est ce point de la carte (sa clé), ou null.
const placeOf = (point: { x: number; y: number }) => placeAt(map, point.x, point.y)?.key ?? null;
// Le temps qu'on laisse au serveur et à la scène : le saut est immédiat, mais une machine chargée fait tourner le jeu plus lentement que l'horloge.
const TRAVEL_TIMEOUT = 15_000;

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

// Où est l'avatar local, comme lieu de la carte.
const aliceAt = async (page: Page) => placeOf(await selfAt(page));

test('Alice prend « Sport » depuis son bureau : elle arrive à la salle de sport, où Bastien la voit ; « Normal » la ramène à son bureau', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice', 'kept');
  const bastien = await arrive(browser, 'Bastien');

  // Alice dans son bureau (le vrai bouton : elle y marche) : c'est là qu'elle reviendra.
  const panel = await openDeskPanel(alice);
  await panel.getByRole('button', { name: 'Fermer le panneau Mon bureau' }).click();
  await expect(panel).toHaveCount(0);
  const desk = await selfAt(alice);
  const deskPlace = placeOf(desk);
  expect(deskPlace).toMatch(/^desk:/);

  // « Sport » : un anneau de lumière paraît (on le guette avant le clic : il ne vit qu'un instant), elle est conduite à la salle de sport, et la puce dit le mode.
  const ring = alice.waitForFunction(() => (window.__office?.rings() ?? 0) > 0, undefined, { polling: 'raf', timeout: TRAVEL_TIMEOUT });
  await (await openMeMenu(alice)).getByRole('menuitemradio', { name: 'Sport', exact: true }).click();
  await expect(meChip(alice)).toContainText('Sport');
  await ring;
  await expect.poll(() => aliceAt(alice), { timeout: TRAVEL_TIMEOUT }).toBe('gym');
  expect(await alice.evaluate(() => window.__audio?.sfx() ?? [])).toContain('teleport');

  // Bastien, resté à l'accueil, la voit arriver dans la salle.
  await expect
    .poll(async () => {
      const seen = await playerSeenBy(bastien, desk.id);
      return seen === null ? null : placeOf(seen);
    }, { timeout: TRAVEL_TIMEOUT })
    .toBe('gym');
  // Dans le panneau Personnes de Bastien, son mode passe avant son statut.
  const people = await openPanel(bastien, 'Personnes');
  await people.getByRole('tab', { name: /^Tout le bureau/ }).click();
  const rowOfAlice = people.locator(`[data-user="${desk.id}"]`);
  await expect(rowOfAlice).toContainText('Sport');

  // « Normal » : le statut est de retour, et elle revient à son bureau.
  await (await openMeMenu(alice)).getByRole('menuitemradio', { name: 'Normal', exact: true }).click();
  await expect(meChip(alice)).toContainText('Disponible');
  await expect(rowOfAlice).not.toContainText('Sport');
  await expect.poll(() => aliceAt(alice), { timeout: TRAVEL_TIMEOUT }).toBe(deskPlace);
  await expect
    .poll(async () => {
      const seen = await playerSeenBy(bastien, desk.id);
      return seen === null ? null : placeOf(seen);
    }, { timeout: TRAVEL_TIMEOUT })
    .toBe(deskPlace);

  // Elle rend son bureau : il est libre pour les tests suivants.
  await giveDeskBack(alice);
});

test('Alice crée un mode « Muscu » avec la salle de sport pour emplacement, sur la mini-carte : le prendre l\'y conduit, un autre mode l\'en fait sortir', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  expect(await aliceAt(alice)).not.toBe('gym');

  // Le panneau de ses états : un nom, l'icône haltère, et la salle de sport choisie sur la mini-carte (un clic la choisit, un second la retire).
  await (await openMeMenu(alice)).getByRole('menuitem', { name: 'Créer un mode', exact: true }).click();
  const panel = alice.getByRole('complementary', { name: 'Mes états d\'activité' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Nom de l\'état', { exact: true }).fill('Muscu');
  await panel.getByRole('button', { name: 'Haltère', exact: true }).click();
  const gym = panel.getByRole('button', { name: 'Salle de sport', exact: true });
  await gym.click();
  await expect(gym).toHaveAttribute('aria-pressed', 'true');
  await gym.click();
  await expect(gym).toHaveAttribute('aria-pressed', 'false');
  await gym.click();
  await expect(gym).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Créer l\'état' }).click();

  // Il est dans la liste, avec son icône et le lieu où il conduit.
  const row = panel.getByRole('listitem').filter({ hasText: 'Muscu' });
  await expect(row.locator('svg.lucide-dumbbell')).toBeVisible();
  await expect(row).toContainText('à Salle de sport');

  // Le prendre : elle est conduite à la salle de sport.
  await row.getByRole('button', { name: 'Prendre l\'état Muscu' }).click();
  await expect(meChip(alice)).toContainText('Muscu');
  await expect.poll(() => aliceAt(alice), { timeout: TRAVEL_TIMEOUT }).toBe('gym');

  // Un autre mode (ici « Concentration », sans emplacement) la fait sortir de la salle : elle n'a pas de bureau, elle revient à l'accueil.
  await (await openMeMenu(alice)).getByRole('menuitemradio', { name: 'Concentration', exact: true }).first().click();
  await expect(meChip(alice)).toContainText('Concentration');
  await expect.poll(() => aliceAt(alice), { timeout: TRAVEL_TIMEOUT }).not.toBe('gym');
});
