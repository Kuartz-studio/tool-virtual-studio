import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { backgammonStateFrom, STARTING_LAYOUT } from '../packages/shared/src/games/backgammon';
import { giveDeskBack, joinOffice } from './helpers';
import { debugGame, gamePanel, gameTable, goToChair, openTableWithKey, readyButton, sitAt, waitForTable, type TableView } from './jeux-helpers';

// Le backgammon de bout en bout, à deux navigateurs, sur la vraie carte (§ 14.8 du document des jeux) : une partie lancée par invitation, un vrai tour joué à la souris (lancer, deux
// étapes, valider), puis une fin de partie fabriquée avec ses dés (`debugGame`) dont le dernier tour se joue aussi à la souris : « Gammon » s'affiche, le classement change une fois
// (+16 et −16), la revanche part avec l'autre en tête. En mouvement réduit les dés se posent sans rouler ; à 375 px, ni défilement horizontal ni cible sous 24 px. Les captures du
// tablier (440 et 375 px, jour et nuit) sont rangées dans .superpowers/captures/backgammon/.

test.describe.configure({ mode: 'serial' });

const CAPTURES = fileURLToPath(new URL('../.superpowers/captures/backgammon/', import.meta.url));
mkdirSync(CAPTURES, { recursive: true });

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Une personne de plus au bureau, sans bureau (d'autres tests en cherchent un libre), loin des tables.
async function arrive(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  await giveDeskBack(page);
  return page;
}

const panel = (page: Page): Locator => gamePanel(page, 'backgammon');
const board = (page: Page): Locator => panel(page).getByRole('grid', { name: 'Tablier de backgammon' });
const cell = (page: Page, name: string | RegExp): Locator => board(page).getByRole('button', { name });
const action = (page: Page, name: string): Locator => panel(page).getByRole('button', { name, exact: true });
const diceOf = (page: Page): Locator => panel(page).locator('.game-backgammon-dice');
const matchOf = async (page: Page): Promise<NonNullable<TableView['match']>> => (await gameTable(page, 'backgammon'))!.match!;

// L'état d'une partie en cours, fabriqué : le départ, ou une fin proche. `turns: 1` : un coup est déjà compté, la fin comptera pour le classement.
const startState = (dice?: number[]) => backgammonStateFrom({ white: STARTING_LAYOUT, red: STARTING_LAYOUT, turn: 0, turns: 1, ...(dice ? { dice } : {}) });
const lastTurn = () => backgammonStateFrom({ white: { 13: 1 }, whiteOff: 14, red: { 6: 15 }, turn: 0, turns: 1 });

// Alice (chaise 1, les Blancs, siège 0) s'assoit et invite Bastien, qui accepte (chaise 2, les Rouges, siège 1) ; les deux se disent prêts : la partie commence.
async function startMatch(browser: Browser): Promise<{ alice: Page; bastien: Page }> {
  const alice = await arrive(browser, 'Alice');
  const bastien = await arrive(browser, 'Bastien');
  await goToChair(alice, 'backgammon', 0);
  await openTableWithKey(alice, 'backgammon');
  await sitAt(alice, 'backgammon', 0);
  await panel(alice).getByRole('button', { name: 'Inviter quelqu\'un' }).click();
  await panel(alice).getByRole('button', { name: 'Inviter Bastien', exact: true }).click();
  const invitation = bastien.locator('.toast', { hasText: 'Alice t\'invite au backgammon' });
  await expect(invitation).toBeVisible();
  await invitation.getByRole('button', { name: 'Accepter l\'invitation de Alice' }).click();
  await expect(panel(bastien)).toBeVisible();
  await waitForTable(bastien, 'backgammon', (view) => view.chairs.every((chair) => chair !== null));
  await readyButton(alice, 'backgammon').click();
  await readyButton(bastien, 'backgammon').click();
  await waitForTable(alice, 'backgammon', (view) => view.match?.status === 'playing');
  await expect(board(alice)).toBeVisible();
  await expect(board(bastien)).toBeVisible();
  return { alice, bastien };
}

// Une capture de ce panneau ou tablier, de jour puis de nuit (la coque pose `data-theme="night"` quand la lumière s'éteint ; on le pose à la main, juste avant la capture).
async function shoot(page: Page, target: Locator, name: string): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: `${CAPTURES}${name}-jour.png` });
  const before = await page.evaluate(() => {
    const root = document.querySelector('.office-ui');
    const previous = root?.getAttribute('data-theme') ?? null;
    root?.setAttribute('data-theme', 'night');
    return previous;
  });
  await target.screenshot({ path: `${CAPTURES}${name}-nuit.png` });
  await page.evaluate((previous) => {
    const root = document.querySelector('.office-ui');
    if (previous === null) root?.removeAttribute('data-theme');
    else root?.setAttribute('data-theme', previous);
  }, before);
}

// Note ce que `data-rolling` a valu sur les dés d'une page, tant qu'on l'observe : de quoi prouver qu'ils n'ont (ou ont) roulé.
async function watchRolling(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __rolling: string[] }).__rolling = seen;
    const scan = () => document.querySelectorAll('.game-backgammon-dice').forEach((dice) => seen.push(dice.getAttribute('data-rolling') ?? ''));
    new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-rolling', 'data-values'] });
  });
  return () => page.evaluate(() => [...(window as unknown as { __rolling: string[] }).__rolling]);
}

test('une partie de bout en bout : invitation, un tour à la souris, une fin en gammon, le classement, la revanche, le mouvement réduit et le téléphone', async ({ browser }) => {
  test.setTimeout(300_000);
  const { alice, bastien } = await startMatch(browser);
  const firstMatch = await matchOf(alice);
  expect(firstMatch.players.map((player) => player.name)).toEqual(['Alice', 'Bastien']);
  // La pastille de chaque camp, dans la liste des joueurs.
  await expect(panel(alice).locator('.game-player').nth(0)).toContainText('Blancs');
  await expect(panel(alice).locator('.game-player').nth(1)).toContainText('Rouges');

  // ─── Un vrai tour, à la souris ───
  // Le lancer d'ouverture a décidé qui commence ; pour la suite on pose le départ, au tour d'Alice, avec un 3 et un 1 au prochain lancer.
  await debugGame(alice, 'backgammon', startState(), [3, 1]);
  await waitForTable(alice, 'backgammon', (view) => (view.match?.state as { phase: string; turns: number }).phase === 'roll');
  await action(alice, 'Lancer les dés').click();
  // Les dés roulent environ 600 ms, puis se posent sur les valeurs du serveur : 3 et 1.
  await expect(diceOf(alice)).toHaveAttribute('data-rolling', 'true');
  await expect(diceOf(alice)).toHaveAttribute('data-rolling', 'false');
  await expect(diceOf(alice)).toHaveAttribute('data-values', '3,1');
  await expect(panel(alice).getByText('Dés : 3 et 1')).toHaveCount(1);
  // Le pion du point 8 : il est jouable, il se prend, ses arrivées s'éclairent.
  await cell(alice, /^Point 8 : 3 pions blancs, jouable$/).click();
  await expect(cell(alice, /^Point 8 : 3 pions blancs, sélectionné$/)).toBeVisible();
  await expect(cell(alice, /^Point 5 : vide, arrivée possible$/)).toBeVisible();
  await shoot(alice, panel(alice), '01-pion-choisi-440');
  await cell(alice, /^Point 5 : vide, arrivée possible$/).click();
  await expect(panel(alice).getByText('Ton tour : 8→5')).toBeVisible();
  // « Valider » n'est actif que quand le tour est complet.
  await expect(action(alice, 'Valider')).toBeDisabled();
  await cell(alice, /^Point 6 : 5 pions blancs, jouable$/).click();
  await cell(alice, /^Point 5 : 1 pion blanc, (jouable, )?arrivée possible$/).click();
  await expect(panel(alice).getByText('Ton tour : 8→5, 6→5')).toBeVisible();
  await expect(action(alice, 'Valider')).toBeEnabled();
  await action(alice, 'Valider').click();
  // Le serveur a joué le tour, d'un bloc : deux pions sur le point 5 des Blancs, un coup compté, le trait à Bastien.
  const afterTurn = await waitForTable(alice, 'backgammon', (view) => (view.match?.state as { turn: number; phase: string }).turn === 1);
  const state = afterTurn.match!.state as { points: number[]; turns: number; phase: string; last: { seat: number; steps: unknown[] } };
  expect(state.points[4]).toBe(2);
  expect(state.turns).toBe(2);
  expect(state.last.steps).toHaveLength(2);
  // Bastien le voit rejoué, dans sa numérotation (le point 5 des Blancs est son point 20) ; et c'est à lui de lancer.
  await expect(cell(bastien, /^Point 20 : 2 pions blancs/)).toBeVisible();
  await expect(action(bastien, 'Lancer les dés')).toBeVisible();
  await expect(panel(bastien).getByText('À toi de jouer').first()).toBeVisible();

  // ─── La fin : le dernier tour d'Alice, à la souris, fabriqué avec ses dés ───
  await debugGame(alice, 'backgammon', lastTurn(), [5, 5]);
  await waitForTable(alice, 'backgammon', (view) => (view.match?.state as { turn: number; phase: string }).phase === 'roll' && (view.match?.state as { turn: number }).turn === 0);
  await action(alice, 'Lancer les dés').click();
  await expect(diceOf(alice)).toHaveAttribute('data-values', '5,5');
  await expect(panel(alice).locator('.game-backgammon-times')).toHaveText('×2');
  await cell(alice, /^Point 13 : 1 pion blanc, jouable$/).click();
  await cell(alice, /^Point 8 : vide, arrivée possible$/).click();
  await cell(alice, /^Point 8 : 1 pion blanc, jouable$/).click();
  await cell(alice, /^Point 3 : vide, arrivée possible$/).click();
  await cell(alice, /^Point 3 : 1 pion blanc, jouable$/).click();
  // Largeur de 440 px : la zone de sortie à droite du tablier, qui s'éclaire pour le pion choisi.
  await cell(alice, /^Sortie : 14 pions sortis, arrivée possible$/).click();
  await expect(panel(alice).getByText('Ton tour : 13→8, 8→3, 3→sortie')).toBeVisible();
  await expect(action(alice, 'Valider')).toBeEnabled();
  await action(alice, 'Valider').click();
  const ended = await waitForTable(alice, 'backgammon', (view) => view.match?.status === 'ended');
  expect(ended.match!.result).toMatchObject({ ranking: [[0], [1]], reason: 'bearoff', detail: { kind: 'gammon' } });
  // « Gammon ! » s'affiche pour les deux, la partie comptée vaut une victoire simple : +16 et −16, une seule fois.
  await expect(panel(alice).locator('.game-status')).toContainText('Alice a sorti tous ses pions. Gammon !');
  await expect(panel(bastien).locator('.game-status')).toContainText('Alice a sorti tous ses pions. Gammon !');
  await expect(panel(alice).getByText('Alice : 1200 → 1216 (+16)')).toBeVisible();
  await expect(panel(alice).getByText('Bastien : 1200 → 1184 (−16)')).toBeVisible();
  expect(ended.match!.ranked).toBe(true);
  expect(ended.match!.ratings!.map((rating) => rating.after - rating.before)).toEqual([16, -16]);
  await shoot(alice, panel(alice), '02-gammon-440');
  // Le classement du jeu : Alice 1216 et Bastien 1184, une partie chacun (la fin n'a été comptée qu'une fois).
  await panel(alice).getByRole('tab', { name: 'Classement' }).click();
  const aliceRow = panel(alice).locator('.ladder-row', { hasText: 'Alice' });
  const bastienRow = panel(alice).locator('.ladder-row', { hasText: 'Bastien' });
  await expect(aliceRow.locator('.ladder-rating')).toHaveText('1216');
  await expect(bastienRow.locator('.ladder-rating')).toHaveText('1184');
  await expect(aliceRow.locator('td').nth(2)).toHaveText('1');
  await expect(aliceRow.locator('.ladder-record')).toHaveText('1 / 0 / 0');
  await expect(bastienRow.locator('.ladder-record')).toHaveText('0 / 0 / 1');
  await panel(alice).getByRole('tab', { name: 'Partie' }).click();

  // ─── La revanche : les mêmes joueurs, l'autre commence ; en mouvement réduit les dés ne roulent pas ───
  await alice.emulateMedia({ reducedMotion: 'reduce' });
  const aliceRolling = await watchRolling(alice);
  const bastienRolling = await watchRolling(bastien);
  await readyButton(alice, 'backgammon').click();
  await readyButton(bastien, 'backgammon').click();
  const rematch = await waitForTable(alice, 'backgammon', (view) => view.match?.status === 'playing' && view.match.id !== firstMatch.id);
  expect(rematch.match!.first).toBe((firstMatch.first + 1) % 2);
  await expect(diceOf(alice)).toHaveCount(1);
  await expect(diceOf(bastien)).toHaveCount(1);
  // Alice, en mouvement réduit : les dés sont posés dès qu'ils paraissent. Bastien, non : les siens roulent, puis se posent sur les mêmes valeurs.
  await expect(diceOf(bastien)).toHaveAttribute('data-rolling', 'false');
  expect(await bastienRolling()).toContain('true');
  expect(await aliceRolling()).not.toContain('true');
  await expect(diceOf(alice)).toHaveAttribute('data-values', (await diceOf(bastien).getAttribute('data-values'))!);

  // ─── Un téléphone de 375 px : ni défilement horizontal, ni cible sous 24 px ───
  await shoot(alice, panel(alice), '03-ouverture-440');
  await alice.setViewportSize({ width: 375, height: 812 });
  await expect(panel(alice).locator('.game-backgammon')).toHaveAttribute('data-layout', 'compact');
  const overflow = await alice.evaluate(() => {
    const root = document.querySelector('.game-backgammon') as HTMLElement;
    const body = root.closest('.drawer-body') as HTMLElement | null;
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      board: root.scrollWidth - root.clientWidth,
      panel: body ? body.scrollWidth - body.clientWidth : 0,
    };
  });
  expect(overflow).toEqual({ page: 0, board: 0, panel: 0 });
  const targets = await alice.locator('.game-backgammon button').evaluateAll((buttons) =>
    buttons.map((element) => {
      const box = element.getBoundingClientRect();
      return { name: element.getAttribute('aria-label') ?? element.textContent ?? '', width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10, none: getComputedStyle(element).pointerEvents === 'none' };
    }),
  );
  expect(targets.length).toBeGreaterThan(24);
  for (const target of targets) {
    if (target.none) {
      // La barre de 12 px : pas une cible de pointeur (le pion qui y est se prend tout seul), mais elle reste au clavier.
      expect(target.name, JSON.stringify(target)).toMatch(/^Barre/);
      continue;
    }
    expect(target.width, JSON.stringify(target)).toBeGreaterThanOrEqual(24);
    expect(target.height, JSON.stringify(target)).toBeGreaterThanOrEqual(24);
  }
  await shoot(alice, panel(alice).locator('.game-backgammon'), '04-tablier-375');
  await shoot(alice, panel(alice), '05-panneau-375');
  await alice.setViewportSize({ width: 1280, height: 720 });
  await alice.emulateMedia({ reducedMotion: 'no-preference' });

  // On laisse la table propre : Alice abandonne, les deux se lèvent.
  await action(alice, 'Abandonner').click();
  await alice.getByRole('alertdialog').getByRole('button', { name: 'Abandonner', exact: true }).click();
  await waitForTable(alice, 'backgammon', (view) => view.match?.status === 'ended');
  await action(alice, 'Se lever').click();
  await action(bastien, 'Se lever').click();
  await waitForTable(alice, 'backgammon', (view) => view.chairs.every((chair) => chair === null));
});
