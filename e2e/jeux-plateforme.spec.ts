import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { chooseStatus, giveDeskBack, joinOffice, selfAt } from './helpers';
import { GAME_LABELS, expectNearTable, gamePanel, gameTable, goToChair, openTableWithKey, readyButton, sitAt, waitForTable, type GameId } from './jeux-helpers';

// La plateforme des jeux, sur la vraie carte (le second serveur des tests : playwright.config.ts) : s'asseoir, regarder, inviter, accepter (on est téléporté près de la table), se dire
// prêt. Les règles d'un jeu sont l'affaire de son propre spec (jeux-<jeu>.spec.ts). Ce spec passe en premier (le projet « jeux-plateforme »), et chaque test prend une table à lui.

// Un seul navigateur à la fois par test, et le reste de la suite qui tourne sur ce serveur (les tests de personnalisation cherchent un bureau libre).
test.describe.configure({ mode: 'serial' });

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Une personne de plus, dans le bureau, sans bureau (elle l'a rendu : d'autres tests en cherchent un libre). Elle apparaît à l'accueil, loin des tables.
async function arrive(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  await giveDeskBack(page);
  return page;
}

// Ouvre le panneau d'une table, assise à sa première chaise : l'avatar s'y pose, la touche E ouvre le panneau, « S'asseoir ».
async function seatAliceAt(page: Page, game: GameId, chair = 0): Promise<void> {
  await goToChair(page, game, chair);
  await openTableWithKey(page, game);
  await sitAt(page, game, chair);
}

test('Alice s\'assoit aux échecs et invite Bastien, resté à l\'accueil : il accepte, il est téléporté près de la table, assis, et les deux se disent prêts', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  const bastien = await arrive(browser, 'Bastien');
  await seatAliceAt(alice, 'chess');

  // Alice invite Bastien : la liste des personnes en ligne, son bouton.
  const panel = gamePanel(alice, 'chess');
  await panel.getByRole('button', { name: 'Inviter quelqu\'un' }).click();
  await panel.getByRole('button', { name: 'Inviter Bastien', exact: true }).click();
  await expect(panel.getByText('Invitation envoyée à Bastien.')).toBeVisible();

  // Bastien reçoit le toast, avec « Accepter » et « Refuser ».
  const invitation = bastien.locator('.toast', { hasText: 'Alice t\'invite aux échecs' });
  await expect(invitation).toBeVisible();
  const before = await selfAt(bastien);
  await invitation.getByRole('button', { name: 'Accepter l\'invitation de Alice' }).click();

  // Il est posé près de la table, le panneau s'ouvre, et il est assis à la seconde chaise.
  await expect(gamePanel(bastien, 'chess')).toBeVisible();
  await expectNearTable(bastien, 'chess');
  expect(await selfAt(bastien)).not.toEqual(before);
  await waitForTable(bastien, 'chess', (view) => view.chairs.every((chair) => chair !== null));
  const seated = (await gameTable(alice, 'chess'))!.chairs.map((chair) => chair?.name);
  expect(seated).toEqual(['Alice', 'Bastien']);
  // Alice est avertie, et le toast de Bastien est parti.
  await expect(alice.locator('.toast', { hasText: 'Bastien a rejoint la table de Échecs.' })).toBeVisible();
  await expect(invitation).toHaveCount(0);

  // Les deux se disent prêts. Sans le jeu au registre (« Bientôt disponible »), la partie ne démarre pas ; avec lui, elle commence.
  await readyButton(alice, 'chess').click();
  await readyButton(bastien, 'chess').click();
  await waitForTable(alice, 'chess', (view) => view.match !== null || view.chairs.every((chair) => chair?.ready === true));
  const soon = await gamePanel(alice, 'chess').getByText('Bientôt disponible').isVisible();
  const view = (await gameTable(alice, 'chess'))!;
  if (soon) {
    expect(view.match).toBeNull();
    expect(view.chairs.map((chair) => chair?.ready)).toEqual([true, true]);
  } else {
    expect(view.match?.status).toBe('playing');
    // Le plateau du jeu est monté dans son cadre (et non « Bientôt disponible ») : le cadre est `.game-board`, dont le contenu est celui du jeu.
    await expect(gamePanel(bastien, 'chess').locator('.game-board > *').first()).toBeVisible();
    await expect(gamePanel(bastien, 'chess').getByText('Bientôt disponible')).toHaveCount(0);
  }
});

test('Claire refuse l\'invitation d\'Alice : Alice le voit, Claire reste où elle est, et la table ne change pas', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  const claire = await arrive(browser, 'Claire');
  await seatAliceAt(alice, 'backgammon');
  const panel = gamePanel(alice, 'backgammon');
  await panel.getByRole('button', { name: 'Inviter quelqu\'un' }).click();
  await panel.getByRole('button', { name: 'Inviter Claire', exact: true }).click();

  const invitation = claire.locator('.toast', { hasText: 'Alice t\'invite au backgammon' });
  await expect(invitation).toBeVisible();
  const before = await selfAt(claire);
  await invitation.getByRole('button', { name: 'Refuser l\'invitation de Alice' }).click();
  await expect(invitation).toHaveCount(0);
  await expect(alice.locator('.toast', { hasText: 'Claire a refusé ton invitation.' })).toBeVisible();
  expect(await selfAt(claire)).toEqual(before);
  expect((await gameTable(alice, 'backgammon'))!.chairs.map((chair) => chair?.name ?? null)).toEqual(['Alice', null]);
});

test('une personne qui ne veut pas être dérangée n\'a pas de bouton « Inviter » actif', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  const dan = await arrive(browser, 'Dan');
  // Dan prend « Concentration », un mode qui ferme sa porte (« Ne pas déranger » ne se choisit plus dans le menu « Moi » depuis le 24 oct.) : on ne l'invite pas.
  await chooseStatus(dan, 'Concentration');
  await seatAliceAt(alice, 'connect4');
  const panel = gamePanel(alice, 'connect4');
  await panel.getByRole('button', { name: 'Inviter quelqu\'un' }).click();
  await expect(panel.getByRole('button', { name: 'Inviter Dan', exact: true })).toBeDisabled();
});

test('Dan ouvre la table des petits chevaux avec la touche E sans s\'asseoir : il regarde, Alice le voit parmi les spectateurs, et l\'onglet « Classement » est vide ; il referme : il ne regarde plus', async ({ browser }) => {
  test.slow();
  const alice = await arrive(browser, 'Alice');
  const dan = await arrive(browser, 'Dan');
  await seatAliceAt(alice, 'ludo');
  await goToChair(dan, 'ludo', 2);
  const danPanel = await openTableWithKey(dan, 'ludo');
  await waitForTable(alice, 'ludo', (view) => view.spectators.some((spectator) => spectator.name === 'Dan'));
  await expect(gamePanel(alice, 'ludo').getByText('1 spectateur : Dan')).toBeVisible();

  await danPanel.getByRole('tab', { name: 'Classement' }).click();
  await expect(danPanel.getByText('Personne n\'est encore classé à ce jeu', { exact: false })).toBeVisible();

  await danPanel.getByRole('button', { name: 'Fermer', exact: true }).click();
  await waitForTable(alice, 'ludo', (view) => view.spectators.length === 0);
  await expect(gamePanel(alice, 'ludo').getByText(/spectateur/)).toHaveCount(0);
});

test('la touche E loin des tables n\'ouvre aucun panneau de jeu ; près de la table des échecs, elle ouvre celui des échecs', async ({ browser }) => {
  test.slow();
  const page = await arrive(browser, 'Alice');
  // À l'accueil, loin de la salle de jeu : rien à actionner.
  await page.keyboard.press('e');
  for (const game of Object.keys(GAME_LABELS) as GameId[]) await expect(gamePanel(page, game)).toHaveCount(0);
  await goToChair(page, 'chess', 1);
  await expect(await openTableWithKey(page, 'chess')).toBeVisible();
  expect(GAME_LABELS.chess).toBe('Échecs');
});
