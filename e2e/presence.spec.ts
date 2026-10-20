import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { avatarsOf, joinOffice, officeBar, selfAt, waitForOffice, WALK_TIMEOUT } from './helpers';

// La présence dans l'interface : le menu des statuts, le panneau Personnes et l'écran « Ouvert dans un autre onglet ».
// Chaque personne a son navigateur (un contexte : ses cookies, donc sa session). Tous les tests partagent le serveur, et donc ses
// membres : on ne regarde les autres que par leur identifiant (`data-user`).

// Le délai de grâce du serveur (DISCONNECT_GRACE_MS) : une connexion perdue depuis moins longtemps n'est pas un départ.
const GRACE_MS = 10_000;

// Les couleurs des points (apps/client/src/lib/status.ts : vert, orange, gris, rouge), telles que le navigateur les calcule.
const DOT_COLOR = {
  available: 'rgb(34, 197, 94)',
  busy: 'rgb(245, 158, 11)',
  away: 'rgb(156, 163, 175)',
  dnd: 'rgb(239, 68, 68)',
};

interface Person {
  context: BrowserContext;
  page: Page;
  id: string;
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Une personne de plus, dans le bureau.
async function arrive(browser: Browser, name: string): Promise<Person> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  return { context, page, id: (await selfAt(page)).id };
}

// Ouvre le panneau Personnes de cette page, et le renvoie.
async function openPeople(page: Page) {
  await officeBar(page).getByRole('button', { name: 'Personnes' }).click();
  const panel = page.getByRole('complementary', { name: 'Personnes' });
  await expect(panel).toBeVisible();
  return panel;
}

// Choisit ce statut dans le menu de la barre.
async function chooseStatus(page: Page, label: string): Promise<void> {
  await officeBar(page).getByRole('button', { name: /^Statut/ }).click();
  await page.getByRole('menuitemradio', { name: label }).click();
}

const statusButton = (page: Page, label: string) => officeBar(page).getByRole('button', { name: `Statut : ${label}` });

test('A passe en Ne pas déranger → B voit le point rouge dans le panneau Personnes', async ({ browser }) => {
  const a = await arrive(browser, 'Alix');
  const b = await arrive(browser, 'Bastien');
  const panel = await openPeople(b.page);

  // A est là, disponible : un point vert, dans « En ligne ».
  const online = panel.getByRole('region', { name: /^En ligne/ });
  const dotOfA = online.locator(`[data-user="${a.id}"]`);
  await expect(dotOfA).toHaveAttribute('data-status', 'available');
  await expect(dotOfA).toHaveCSS('background-color', DOT_COLOR.available);

  await chooseStatus(a.page, 'Ne pas déranger');
  await expect(panel.locator(`[data-user="${a.id}"][data-status="dnd"]`)).toBeVisible();
  await expect(dotOfA).toHaveCSS('background-color', DOT_COLOR.dnd);
  await expect(dotOfA.locator('xpath=ancestor::li')).toContainText('Ne pas déranger');
  // A voit son nouveau statut quand le serveur l'a confirmé, et B n'a pas changé.
  await expect(statusButton(a.page, 'Ne pas déranger')).toBeVisible();
  await expect(online.locator(`[data-user="${b.id}"]`)).toHaveAttribute('data-status', 'available');

  // Les trois autres statuts ont leur couleur.
  for (const [label, status] of [['Occupé', 'busy'], ['Absent', 'away'], ['Disponible', 'available']] as const) {
    await chooseStatus(a.page, label);
    await expect(panel.locator(`[data-user="${a.id}"][data-status="${status}"]`)).toBeVisible();
    await expect(dotOfA).toHaveCSS('background-color', DOT_COLOR[status]);
  }
});

test('le statut survit à un rechargement de la page : A le retrouve, et B ne le voit pas bouger', async ({ browser }) => {
  const a = await arrive(browser, 'Alice');
  const b = await arrive(browser, 'Baptiste');
  const panel = await openPeople(b.page);
  await chooseStatus(a.page, 'Absent');
  await expect(panel.locator(`[data-user="${a.id}"][data-status="away"]`)).toBeVisible();

  await a.page.reload();
  await waitForOffice(a.page);
  await expect(statusButton(a.page, 'Absent')).toBeVisible();
  // Revenue dans le délai de grâce : B n'a rien vu, ni départ ni changement.
  await expect(panel.locator(`[data-user="${a.id}"]`)).toHaveAttribute('data-status', 'away');
  // Et le menu marche de nouveau.
  await chooseStatus(a.page, 'Disponible');
  await expect(panel.locator(`[data-user="${a.id}"][data-status="available"]`)).toBeVisible();
});

test('deuxième onglet de A → le premier affiche l\'écran « Ouvert dans un autre onglet » ; « Utiliser ici » reprend la main', async ({ browser }) => {
  const a = await arrive(browser, 'Axel');
  const b = await arrive(browser, 'Bianca');
  const panelOfB = await openPeople(b.page);
  const first = a.page;

  // Un deuxième onglet, avec la même session.
  const second = await a.context.newPage();
  await second.goto('/');
  await waitForOffice(second);

  // Le premier est remplacé : l'écran, et sa barre est inerte (le clavier ne l'atteint plus).
  const replaced = first.getByRole('dialog', { name: 'Ouvert dans un autre onglet' });
  await expect(replaced).toBeVisible();
  await expect(replaced.getByRole('button', { name: 'Utiliser ici' })).toBeFocused();
  await expect(first.locator('.office-ui')).toHaveAttribute('inert', '');
  await expect(second.getByRole('dialog')).toHaveCount(0);
  await expect(statusButton(second, 'Disponible')).toBeEnabled();
  // Pour B, rien n'a changé : A est toujours là, en un seul exemplaire.
  await expect(panelOfB.locator(`[data-user="${a.id}"]`)).toHaveAttribute('data-status', 'available');
  expect(await avatarsOf(b.page, a.id)).toBe(1);

  // « Utiliser ici » : le premier reprend la main, et c'est au deuxième d'être remplacé.
  await replaced.getByRole('button', { name: 'Utiliser ici' }).click();
  await expect(replaced).toBeHidden();
  await expect(second.getByRole('dialog', { name: 'Ouvert dans un autre onglet' })).toBeVisible();
  await expect(first.locator('.office-ui')).not.toHaveAttribute('inert', /.*/);
  await expect(statusButton(first, 'Disponible')).toBeEnabled();
  // Le premier onglet marche : son statut part au serveur, et B le voit.
  await chooseStatus(first, 'Occupé');
  await expect(panelOfB.locator(`[data-user="${a.id}"][data-status="busy"]`)).toBeVisible();
  expect(await avatarsOf(b.page, a.id)).toBe(1);
});

test('A ferme son onglet → B le voit passer en « Hors ligne » après le délai de grâce, puis revenir en ligne', async ({ browser }) => {
  test.slow();
  const a = await arrive(browser, 'Alma');
  const b = await arrive(browser, 'Bruno');
  const panel = await openPeople(b.page);
  const online = panel.getByRole('region', { name: /^En ligne/ });
  const offline = panel.getByRole('region', { name: /^Hors ligne/ });
  await expect(online.locator(`[data-user="${a.id}"]`)).toBeVisible();
  await expect(offline.locator(`[data-user="${a.id}"]`)).toHaveCount(0);

  await a.page.close();
  // Le délai de grâce : A est encore là pour les autres.
  await b.page.waitForTimeout(GRACE_MS / 2);
  await expect(online.locator(`[data-user="${a.id}"]`)).toBeVisible();
  // Puis il part : hors ligne, sans point de couleur (on ne connaît plus son statut), sous le même nom.
  const dotOfA = offline.locator(`[data-user="${a.id}"]`);
  await expect(dotOfA).toBeVisible({ timeout: GRACE_MS + 10_000 });
  await expect(dotOfA).not.toHaveAttribute('data-status', /.*/);
  await expect(dotOfA.locator('xpath=ancestor::li')).toHaveText('Alma');
  await expect(online.locator(`[data-user="${a.id}"]`)).toHaveCount(0);

  // Il revient (un nouvel onglet, la session est celle du contexte) : en ligne de nouveau.
  const back = await a.context.newPage();
  await back.goto('/');
  await waitForOffice(back);
  await expect(online.locator(`[data-user="${a.id}"]`)).toBeVisible({ timeout: WALK_TIMEOUT });
  await expect(offline.locator(`[data-user="${a.id}"]`)).toHaveCount(0);
});

test('le panneau Personnes est posé sur le jeu, sans le déplacer, et se manie au clavier', async ({ browser }) => {
  const a = await arrive(browser, 'Anouk');
  const page = a.page;
  const canvas = page.locator('#game-container canvas');
  const before = await canvas.boundingBox();
  expect(before).toMatchObject({ x: 0, y: 0 });

  const toggle = officeBar(page).getByRole('button', { name: 'Personnes' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Personnes' });
  await expect(panel).toBeVisible();
  // Le focus est passé au titre du panneau, qui est sur le jeu à droite, au-dessus de la barre.
  await expect(panel.getByRole('heading', { name: 'Personnes' })).toBeFocused();
  const box = (await panel.boundingBox())!;
  const bar = (await officeBar(page).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(before!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  // Le canevas n'a ni bougé ni changé de taille (pas de décalage, pas de nouveau zoom).
  expect(await canvas.boundingBox()).toEqual(before);

  // Échap ferme le panneau et rend le focus au bouton.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(await canvas.boundingBox()).toEqual(before);
});

test('le clavier : le menu des statuts garde ses flèches ; fermé, l\'avatar marche de nouveau', async ({ browser }) => {
  const a = await arrive(browser, 'Anselme');
  const page = a.page;
  const start = await selfAt(page);

  // Menu ouvert, ↓ et ↑ passent d'un statut à l'autre : l'avatar reste où il est.
  await officeBar(page).getByRole('button', { name: /^Statut/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: 'Disponible' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Occupé' })).toBeFocused();
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowDown');
  expect(await selfAt(page)).toEqual(start);

  // Échap : le menu se ferme, le focus est sur le bouton (un bouton ne prend pas les flèches), et l'avatar marche.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(officeBar(page).getByRole('button', { name: /^Statut/ })).toBeFocused();
  await page.keyboard.down('ArrowDown');
  await expect.poll(async () => (await selfAt(page)).y, { timeout: WALK_TIMEOUT }).toBeGreaterThan(start.y);
  await page.keyboard.up('ArrowDown');
});
