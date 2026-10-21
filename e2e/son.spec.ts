import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { joinOffice, officeBar, openChat, playerSeenBy, say, selfAt } from './helpers';

// Le son, avec les vrais fichiers décodés par Chromium (Playwright coupe son haut-parleur : on lit ce que le moteur dit, window.__audio,
// apps/client/src/game/debug.ts). La musique d'ambiance par endroit est dans musique-lieux.spec.ts, sur la grande carte.
//
// Chaque personne a son navigateur (un contexte). Tous les tests partagent le serveur, et donc ses arrivées et ses messages : on cherche
// ce qu'on attend dans la liste des effets demandés, sans la supposer exacte.

const status = (page: Page) => page.evaluate(() => window.__audio?.status() ?? null);
const playing = (page: Page) => page.evaluate(() => window.__audio?.playing() ?? null);
const requested = (page: Page) => page.evaluate(() => window.__audio?.sfx() ?? []);
// Les effets demandés depuis ce point, sans ceux que d'autres tests (qui arrivent, qui écrivent) font sonner à tout le monde.
const sinceThen = async (page: Page, from: number) => (await requested(page)).slice(from).filter((id) => id !== 'arrive' && id !== 'message');

// Les tests de ce fichier passent l'un après l'autre, dans un seul navigateur à la fois : plusieurs gens par test, des fichiers de plusieurs
// Mo à décoder, et le reste de la suite qui tourne en même temps : étalés sur tous les processus, ils feraient dépasser leur délai à des tests
// déjà longs (le builder de personnalisation, les groupes de multiplayer).
test.describe.configure({ mode: 'default' });

// Le temps qu'on laisse à Chromium pour télécharger et décoder une boucle de plusieurs Mo, sur une machine chargée.
const DECODE_TIMEOUT = 20_000;

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

async function arrive(browser: Browser, name: string): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  return { page, id: (await selfAt(page)).id };
}

test('le premier clic de la page de connexion lance la salle d\'attente : la boucle est vraiment décodée et jouée', async ({ page }) => {
  await page.goto('/connexion');
  // Avant un geste, le navigateur ne laisse pas démarrer le son.
  await expect.poll(() => status(page)).toBe('locked');
  expect(await playing(page)).toBeNull();

  await page.getByLabel('Adresse e-mail', { exact: true }).click();
  await expect.poll(() => status(page), { timeout: DECODE_TIMEOUT }).toBe('running');
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('lobby');
});

test('l\'interrupteur de la musique des pages sans barre : il la coupe, et le réglage survit à un rechargement', async ({ page }) => {
  await page.goto('/connexion');
  const toggle = page.getByRole('button', { name: 'Musique', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Ce premier clic débloque le son, mais la musique n'a plus lieu de jouer.
  await expect.poll(() => status(page), { timeout: DECODE_TIMEOUT }).toBe('running');
  expect(await playing(page)).toBeNull();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Musique', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Adresse e-mail', { exact: true }).click();
  await expect.poll(() => status(page), { timeout: DECODE_TIMEOUT }).toBe('running');
  expect(await playing(page)).toBeNull();

  // La rallumer remet la salle d'attente.
  await page.getByRole('button', { name: 'Musique', exact: true }).click();
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('lobby');
});

test('au bureau : le jingle d\'arrivée, l\'ambiance de la petite carte, et les bruits des boutons (panneau, micro)', async ({ browser }) => {
  test.slow();
  const { page } = await arrive(browser, 'Alix');
  // Entrer sonne (« Entrer » est le geste qui débloque le son, le serveur répond ensuite).
  await expect.poll(() => requested(page)).toContain('welcome');
  // La petite carte n'a qu'une ambiance : la concentration.
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('focus');

  const from = (await requested(page)).length;
  const bar = officeBar(page);
  await bar.getByRole('button', { name: 'Personnes' }).click();
  await bar.getByRole('button', { name: 'Personnes' }).click();
  await bar.getByRole('button', { name: 'Micro' }).click();
  await bar.getByRole('button', { name: 'Micro' }).click();
  await expect.poll(() => sinceThen(page, from)).toEqual(['panel-open', 'panel-close', 'toggle-off', 'toggle-on']);
});

test('le panneau Son : choisir une ambiance la joue partout, « Selon l\'endroit » rend la main, couper la musique la fait taire', async ({ browser }) => {
  test.slow();
  const { page } = await arrive(browser, 'Blandine');
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('focus');

  await officeBar(page).getByRole('button', { name: 'Son', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Son', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('radio', { name: /^Selon l'endroit/ })).toBeChecked();
  // L'ambiance qui joue est marquée.
  await expect(panel.getByText('En cours')).toBeVisible();

  await panel.getByRole('radio', { name: /^Crépuscule/ }).check();
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('dusk');
  await panel.getByRole('radio', { name: /^Selon l'endroit/ }).check();
  await expect.poll(() => playing(page), { timeout: DECODE_TIMEOUT }).toBe('focus');

  await panel.getByRole('switch', { name: 'Musique' }).uncheck();
  await expect.poll(() => playing(page)).toBeNull();
  // Le volume et le choix de l'ambiance sont éteints avec la musique ; les effets ne le sont pas.
  await expect(panel.getByRole('slider', { name: 'Volume de la musique' })).toBeDisabled();
  await expect(panel.getByRole('slider', { name: 'Volume des effets sonores' })).toBeEnabled();

  // Un exemple d'effet pour régler son volume : il sonne, mais son bouton n'a pas de clic à lui.
  const from = (await requested(page)).length;
  await panel.getByRole('button', { name: 'Écouter un effet' }).click();
  await expect.poll(() => sinceThen(page, from)).toEqual([]);
  await expect.poll(async () => (await requested(page)).slice(from)).toContain('message');

  // Les réglages sont gardés : au rechargement, la musique reste coupée.
  await page.reload();
  await page.getByRole('button', { name: /^Entrer/ }).click();
  await expect(officeBar(page)).toBeVisible();
  await expect.poll(() => status(page), { timeout: DECODE_TIMEOUT }).toBe('running');
  expect(await playing(page)).toBeNull();
});

test('chez les autres : une arrivée sonne, un message sonne ; en « Ne pas déranger », plus rien ne sonne', async ({ browser }) => {
  test.slow();
  const a = await arrive(browser, 'Corinne');
  await expect.poll(() => requested(a.page)).toContain('welcome');

  const fromArrival = (await requested(a.page)).length;
  const b = await arrive(browser, 'Damien');
  await expect.poll(async () => (await requested(a.page)).slice(fromArrival)).toContain('arrive');

  // B écrit à tout le monde : A entend le message.
  const chat = await openChat(b.page);
  const fromMessage = (await requested(a.page)).length;
  await say(chat, 'Bonjour Corinne !');
  await expect.poll(async () => (await requested(a.page)).slice(fromMessage)).toContain('message');

  // A passe en « Ne pas déranger » : un nouvel arrivant et un message ne la dérangent plus.
  await officeBar(a.page).getByRole('button', { name: /^Statut/ }).click();
  await a.page.getByRole('menuitemradio', { name: 'Ne pas déranger' }).click();
  await expect(officeBar(a.page).getByRole('button', { name: 'Statut : Ne pas déranger' })).toBeVisible();
  const quietFrom = (await requested(a.page)).length;
  const c = await arrive(browser, 'Élise');
  await expect.poll(async () => playerSeenBy(a.page, c.id), { timeout: 20_000 }).not.toBeNull();
  await say(chat, 'Un second message.');
  await expect(a.page.getByRole('button', { name: /^Chat/ })).toBeVisible();
  // Laisser le temps à un bruit, s'il y en avait un, de venir.
  await a.page.waitForTimeout(1500);
  expect((await requested(a.page)).slice(quietFrom).filter((id) => id === 'arrive' || id === 'message')).toEqual([]);
});
