import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { buildOfficeTiledMap, parseOfficeMap } from '../packages/shared/src/index';
import { giveDeskBack, holdUntilStopped, joinOffice, selfAt, teleportTo, waitForOffice } from './helpers';

// L'octogone (le ring de la salle de boxe de la vraie carte) : deux combattants et une spectatrice, chacun dans son navigateur. Le ring couvre les cases 69 à 78
// en largeur, 37 à 43 en hauteur (2208 à 2528 px, 1184 à 1408 px) ; au sud, jusqu'aux bancs, la salle est au public.

const map = parseOfficeMap(buildOfficeTiledMap());
const ring = map.arena!;
const RING = { left: ring.x, top: ring.y, right: ring.x + ring.width, bottom: ring.y + ring.height };
// Dans la salle, juste sous le ring, au milieu de sa largeur : la case (73, 44).
const IN_ROOM = { x: ring.x + ring.width / 2 - map.tileSize / 2, y: RING.bottom + map.tileSize / 2 };
// Les pieds sont-ils dans le rectangle du ring (la cage est à l'intérieur) ?
const inRing = ({ x, y }: { x: number; y: number }) => x > RING.left && x < RING.right && y > RING.top && y < RING.bottom;

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

async function arrive(browser: Browser, name: string): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  // Chacun reçoit un bureau en arrivant : on le rend tout de suite, pour les specs qui en cherchent un de libre sur ce serveur (il n'y en a que six).
  await giveDeskBack(page);
  await waitForOffice(page);
  await teleportTo(page, IN_ROOM);
  return { page, id: (await selfAt(page)).id };
}

const card = (page: Page) => page.getByRole('region', { name: 'Octogone' });
const hpOf = (page: Page, corner: 'Coin rouge' | 'Coin bleu') => card(page).getByRole('meter', { name: corner });

test('deux combattants armés, une spectatrice : choix des armes, Start, une flèche, des coups d\'épée, un K.O.', async ({ browser }) => {
  // Trois arrivées, chacune avec la marche jusqu'à son bureau pour le rendre, puis le combat : plus que 90 s sur une machine chargée.
  test.setTimeout(180_000);
  const a = await arrive(browser, 'Rocky');
  const b = await arrive(browser, 'Apollo');
  const c = await arrive(browser, 'Adrienne');

  // Le panneau paraît dans la salle ; chacun prend son rôle.
  await card(a.page).getByRole('button', { name: 'Combattre' }).click();
  await card(b.page).getByRole('button', { name: 'Combattre' }).click();
  await card(c.page).getByRole('button', { name: 'Regarder' }).click();
  await expect(card(c.page)).toContainText('Tu regardes le combat.');
  // « Regarder » pose la spectatrice au bord de la cage, dehors.
  await expect.poll(async () => inRing(await selfAt(c.page))).toBe(false);

  // La cage est un mur, même hors combat : Rocky, combattant mais pas encore en combat, ne la traverse pas en marchant vers le nord.
  await teleportTo(a.page, IN_ROOM);
  expect((await holdUntilStopped(a.page, 'ArrowUp')).y).toBeGreaterThan(RING.bottom);
  await expect(card(a.page)).toContainText('Apollo');

  // Sans arme, pas de combat ; Rocky prend l'épée, Apollo l'arc.
  await expect(card(a.page).getByRole('button', { name: 'Start' })).toBeDisabled();
  await card(a.page).getByRole('button', { name: /^Épée/ }).click();
  await card(b.page).getByRole('button', { name: /^Arc/ }).click();
  await expect(card(a.page).getByRole('button', { name: /^Épée/ })).toHaveAttribute('aria-pressed', 'true');

  // Start : le compte à rebours, puis le combat ; chacun est posé dans son coin, face à face sur la même rangée.
  await card(a.page).getByRole('button', { name: 'Start' }).click();
  await expect(card(c.page)).toContainText('Le combat commence');
  await expect(card(c.page)).toContainText('Combat en cours', { timeout: 6_000 });

  // Apollo, à l'est, se tourne vers Rocky (à l'ouest) et tire : la flèche traverse le ring et le touche.
  await b.page.keyboard.down('ArrowLeft');
  await b.page.waitForTimeout(40);
  await b.page.keyboard.up('ArrowLeft');
  const aAt = await selfAt(a.page);
  await teleportTo(b.page, { x: (await selfAt(b.page)).x, y: aAt.y });
  await b.page.keyboard.press('Space');
  await expect(hpOf(c.page, 'Coin rouge')).not.toHaveAttribute('aria-valuenow', '100');

  // Pendant le combat, on ne sort pas de la cage : Rocky marche vers le sud et bute sur le grillage.
  expect((await holdUntilStopped(a.page, 'ArrowDown')).y).toBeLessThan(RING.bottom);

  // Rocky se colle à Apollo, le regarde (à droite), et frappe à l'épée jusqu'au K.O.
  const bAt = await selfAt(b.page);
  await teleportTo(a.page, { x: bAt.x - 36, y: bAt.y });
  await a.page.keyboard.down('ArrowRight');
  await a.page.waitForTimeout(60);
  await a.page.keyboard.up('ArrowRight');
  for (let i = 0; i < 30; i++) {
    if ((await card(c.page).textContent())?.includes('gagne')) break;
    await a.page.keyboard.press('Space');
    await a.page.waitForTimeout(520);
  }
  await expect(card(c.page)).toContainText('Rocky gagne par K.O. !');
  await expect(hpOf(b.page, 'Coin bleu')).toHaveAttribute('aria-valuenow', '0');

  // Après le combat (l'écran de victoire, puis le retour à l'attente), les combattants sont sortis de la cage, gardent leur arme, et peuvent relancer.
  await expect(card(a.page)).toContainText('Un des deux combattants lance le combat.', { timeout: 10_000 });
  await expect.poll(async () => inRing(await selfAt(a.page))).toBe(false);
  await expect.poll(async () => inRing(await selfAt(b.page))).toBe(false);
  await expect(card(a.page).getByRole('button', { name: 'Start' })).toBeEnabled();
});
