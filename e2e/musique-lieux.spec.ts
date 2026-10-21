import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { buildOfficeTiledMap, GRAND_HALL, isWalkableTile, LOUNGE, LOUNGE_MUSIC_X, LOUNGE_TERRACE_WIDTH, MEETING_ROOM, OFFICE_DESK_SLOTS, parseOfficeMap, PLAZA } from '../packages/shared/src/index';
import { deskSettingsButton, goToDeskButton, joinOffice, openDeskPanel, openJukebox, openPanel, selfAt } from './helpers';

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
// suite, pour que les tests de personnalisation, qui tournent en même temps sur ce serveur, en trouvent un de libre. Le panneau « Mon bureau » est
// derrière le bouton du dock, que l'avatar atteint en marchant jusqu'à son bureau (l'accueil en est loin : une dizaine de secondes) ; le bureau
// rendu, il revient où il était (l'accueil, dont la musique est celle qu'on attend d'abord).
async function giveDeskBack(page: Page): Promise<void> {
  // Sans bureau, le dock n'a ni « Aller à mon bureau » ni « Réglages du bureau » : il n'y a rien à rendre.
  if (!(await goToDeskButton(page).or(deskSettingsButton(page)).isVisible())) return;
  const { x, y } = await selfAt(page);
  const panel = await openDeskPanel(page);
  const giveBack = panel.getByRole('button', { name: 'Rendre mon bureau' });
  await expect(giveBack).toBeVisible();
  await giveBack.click();
  await expect(panel.getByText('Tu n\'as pas de bureau.')).toBeVisible();
  await panel.getByRole('button', { name: 'Fermer le panneau Mon bureau' }).click();
  await expect(panel).toHaveCount(0);
  // Rendu, il n'y a plus de bouton du bureau dans le dock.
  await expect(goToDeskButton(page).or(deskSettingsButton(page))).toHaveCount(0);
  await teleport(page, { x, y });
}

// Place l'avatar sur cette case (window.__office.teleport, que le serveur n'accepte qu'avec E2E=1), arrêté.
async function teleport(page: Page, spot: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => window.__office!.teleport(x, y), spot);
  await expect.poll(() => selfAt(page)).toMatchObject(spot);
}

// Les endroits de la grande carte : où se poser, l'ambiance qu'on y entend, et le nom du lieu que dit la puce en haut à gauche (office/where.ts :
// le même découpage de la carte, dans les deux cas).
const PLACES: Array<[name: string, at: { x: number; y: number }, scene: string, place: string]> = [
  ['la grande salle', spotNear(GRAND_HALL.x + 8, GRAND_HALL.y + 8), 'drift', 'Grande salle'],
  ['la place centrale', spotNear(PLAZA.x + 16, PLAZA.y + 6), 'sunny', 'Café'],
  ['la salle de réunion', spotNear(MEETING_ROOM.x + 6, MEETING_ROOM.y + 4), 'focus', 'Salle de réunion'],
  ['le coin musique', spotNear(LOUNGE_MUSIC_X + 4, LOUNGE.y + 7), 'quest', 'Coin musique'],
  ['le salon', spotNear(LOUNGE.x + LOUNGE_TERRACE_WIDTH + 6, LOUNGE.y + 9), 'dusk', 'Salon'],
  ['la terrasse de la piscine', spotNear(LOUNGE.x + 4, LOUNGE.y + 10), 'sunny', 'Piscine'],
  // Le bureau rendu est libre : « Place A3 ».
  ['un bureau', { x: (OFFICE_DESK_SLOTS[2]!.room.x + 4) * 32 + 16, y: (OFFICE_DESK_SLOTS[2]!.room.y + 3) * 32 + 16 }, 'focus', 'Place A3'],
  ['le couloir', spotNear(30, 12), 'lobby', 'Couloir'],
];

const whereChip = (page: Page) => page.getByRole('group', { name: 'Lieu' });

test('chaque endroit a son ambiance : on y reste un moment, la musique change, et la puce du lieu le nomme', async ({ page }) => {
  test.slow();
  await joinOffice(page, 'Fanny');
  await giveDeskBack(page);

  // On apparaît à l'accueil : la salle d'attente, et le lieu s'appelle « Accueil » (non « Couloir »).
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('lobby');
  await expect(whereChip(page)).toContainText('Accueil');

  for (const [name, at, scene, place] of PLACES) {
    await teleport(page, at);
    await expect.poll(() => playing(page), { message: `l'ambiance de ${name}`, timeout: DECODE_TIMEOUT }).toBe(scene);
    await expect(whereChip(page), `le lieu de ${name}`).toContainText(place);
  }
});

test('« Ici », dans Personnes, ne réunit que ceux du même lieu : deux personnes au café, l\'une part à la grande salle', async ({ browser }) => {
  test.slow();
  const contexts: BrowserContext[] = [];
  try {
    const arrive = async (name: string) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await joinOffice(page, name);
      return page;
    };
    const [a, b] = await Promise.all([arrive('Axelle'), arrive('Bruno')]);
    // Leurs bureaux d'abord (les tests de personnalisation en cherchent de libres), puis chacun à un bout de la place centrale.
    await Promise.all([giveDeskBack(a), giveDeskBack(b)]);
    await teleport(a, spotNear(PLAZA.x + 3, PLAZA.y + 3));
    await teleport(b, spotNear(PLAZA.x + PLAZA.w - 4, PLAZA.y + PLAZA.h - 4));
    await expect(whereChip(a)).toContainText('Café');

    const people = await openPanel(a, 'Personnes');
    const here = people.getByRole('region', { name: /^Ici/ });
    await expect(here.getByText('Axelle', { exact: true })).toBeVisible();
    await expect(here.getByText('Bruno', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Bruno va à la grande salle : plus ici. « Tout le bureau » le montre toujours, avec son lieu.
    await teleport(b, spotNear(GRAND_HALL.x + 8, GRAND_HALL.y + 8));
    await expect(here.getByText('Bruno', { exact: true })).toHaveCount(0, { timeout: 15_000 });
    await people.getByRole('tab', { name: /^Tout le bureau/ }).click();
    const idOfB = (await selfAt(b)).id;
    await expect(people.locator(`[data-user="${idOfB}"] .person-sub`)).toHaveText('Grande salle', { timeout: 15_000 });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('l\'ambiance choisie à la main prime sur l\'endroit, et « Selon l\'endroit » rend la main', async ({ page }) => {
  test.slow();
  await joinOffice(page, 'Gaspard');
  await giveDeskBack(page);
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('lobby');

  const jukebox = await openJukebox(page);
  await jukebox.getByRole('radio', { name: /^Expédition/ }).check();
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('quest');

  // Ailleurs sur la carte, elle continue.
  await teleport(page, spotNear(GRAND_HALL.x + 8, GRAND_HALL.y + 8));
  await page.waitForTimeout(1500);
  expect(await playing(page)).toBe('quest');

  // « Selon l'endroit » : la grande salle, où l'on est.
  await jukebox.getByRole('radio', { name: /^Selon l'endroit/ }).check();
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('drift');
});
