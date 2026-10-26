import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { stateFromFen, type ChessState } from '../packages/shared/src/games/chess/index';
import { giveDeskBack, joinOffice, selfAt } from './helpers';
import { debugGame, expectNearTable, gamePanel, gameTable, goToChair, openTableWithKey, readyButton, sitAt, waitForTable, type TableView } from './jeux-helpers';

// Les échecs, de bout en bout, sur la vraie carte (le second serveur des tests) : deux navigateurs qui jouent à la souris, un troisième qui regarde. Le spec ne touche qu'à la table des échecs,
// avec des comptes neufs, en série (§ 12.6 du document des jeux). Les fins proches (promotion, mat, nulle, pat) se fabriquent avec `debugGame` et `stateFromFen`, parce qu'une partie
// complète serait trop longue. Les captures de l'échiquier (440 px et 375 px, jour et nuit) vont dans `.superpowers/captures/chess/`.
test.describe.configure({ mode: 'serial' });

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

const CAPTURES = resolve('.superpowers/captures/chess');
// La hauteur d'une page assez haute pour montrer tout le panneau d'un jeu sans défilement.
const TALL_VIEWPORT = 1500;
mkdirSync(CAPTURES, { recursive: true });

// Le mat du berger (C19 du document des jeux), coup par coup : les Blancs jouent aux demi-coups pairs.
const SCHOLARS_MATE = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
// L'ouverture du « Fried Liver » : deux prises de pion contre un pion et un cavalier, de quoi remplir les bandes de pièces prises et la liste des coups.
const FRIED_LIVER = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'f3g5', 'd7d5', 'e4d5', 'f6d5', 'g5f7', 'e8f7'];

// Une personne de plus au bureau, sans bureau (elle l'a rendu : d'autres tests en cherchent un libre).
async function arrive(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  await giveDeskBack(page);
  return page;
}

// Le panneau est ouvert, assis à cette chaise : l'avatar s'y pose, la touche E ouvre le panneau, « S'asseoir ».
async function seatAt(page: Page, chair: number): Promise<void> {
  await goToChair(page, 'chess', chair);
  await openTableWithKey(page, 'chess');
  await sitAt(page, 'chess', chair);
}

const plies = (view: TableView): unknown[] => (view.match!.state as { plies: unknown[] }).plies;
const squareButton = (page: Page, square: string) => gamePanel(page, 'chess').getByRole('button', { name: new RegExp(`^${square},`) });
const status = (page: Page) => gamePanel(page, 'chess').locator('.game-status');

// Un coup à la souris : la case de départ, puis celle d'arrivée ; on attend que le serveur l'ait joué (la table compte un demi-coup de plus).
async function playByMouse(page: Page, move: string, expectedPlies: number): Promise<void> {
  await squareButton(page, move.slice(0, 2)).click();
  await squareButton(page, move.slice(2, 4)).click();
  await waitForTable(page, 'chess', (view) => view.match !== null && plies(view).length >= expectedPlies);
}

// Joue des coups à la souris, chacun sur la page de celui qui a le trait : les Blancs sont au siège `white`.
async function playLine(pages: Page[], white: number, line: string[], already = 0): Promise<void> {
  for (const [index, move] of line.entries()) {
    const total = already + index;
    await playByMouse(pages[total % 2 === 0 ? white : 1 - white]!, move, total + 1);
  }
}

// Le siège des Blancs de la partie en cours.
async function whiteSeat(page: Page): Promise<number> {
  const view = await waitForTable(page, 'chess', (candidate) => candidate.match?.status === 'playing');
  return view.match!.first;
}

// Les deux joueurs se disent prêts (ou demandent la revanche) : la partie commence.
async function bothReady(pages: Page[], previousId: string | null = null): Promise<void> {
  for (const page of pages) await readyButton(page, 'chess').click();
  await waitForTable(pages[0]!, 'chess', (view) => view.match?.status === 'playing' && view.match.id !== previousId);
}

// Pose cette position dans la partie en cours, avec deux demi-coups notés (pour que la fin compte et que la nulle puisse se proposer) sur des cases que les positions des tests n'utilisent
// pas : le dernier coup marque ses deux cases.
async function setPosition(page: Page, fen: string, white: number): Promise<void> {
  const base = stateFromFen(fen, white);
  const state: ChessState = { ...base, plies: [{ from: 'd2', to: 'd4', san: 'd4', piece: 'p' }, { from: 'd7', to: 'd5', san: 'd5', piece: 'p' }] };
  await debugGame(page, 'chess', state);
  await waitForTable(page, 'chess', (view) => (view.match?.state as ChessState | undefined)?.fen === base.fen);
}

// Jour ou nuit, puis la capture : la nuit se pose sur la couche d'interface juste avant (la coque la ferait à sa façon avec la lumière).
async function capture(page: Page, name: string, theme: 'jour' | 'nuit', target: 'panneau' | 'page' = 'panneau'): Promise<void> {
  await page.evaluate((night) => {
    const layer = document.querySelector('.office-ui');
    if (night) layer?.setAttribute('data-theme', 'night');
    else layer?.removeAttribute('data-theme');
  }, theme === 'nuit');
  await page.waitForTimeout(300);
  const path = `${CAPTURES}/${name}-${theme}.png`;
  if (target === 'page') {
    await page.screenshot({ path });
    return;
  }
  // Le panneau défile : pour le voir en entier, on grandit la page le temps de la capture, puis on la rend telle qu'elle était.
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, TALL_VIEWPORT) });
  await page.waitForTimeout(300);
  await gamePanel(page, 'chess').screenshot({ path });
  await page.setViewportSize(size);
}

// Les deux thèmes, l'un après l'autre.
async function captureBoth(page: Page, name: string, target: 'panneau' | 'page' = 'panneau'): Promise<void> {
  await capture(page, name, 'jour', target);
  await capture(page, name, 'nuit', target);
  await capture(page, name, 'jour', target);
}

test('Alice invite Bastien : il accepte et apparaît à la table ; le mat du berger à la souris, le classement, la revanche aux couleurs échangées, un spectateur, un abandon', async ({ browser }) => {
  test.setTimeout(900_000);
  const alice = await arrive(browser, 'Alice');
  const bastien = await arrive(browser, 'Bastien');
  const pages = [alice, bastien];

  await test.step('Alice s\'assoit et invite Bastien, resté à l\'accueil : il accepte, apparaît près de la table, assis', async () => {
    await seatAt(alice, 0);
    const panel = gamePanel(alice, 'chess');
    await panel.getByRole('button', { name: 'Inviter quelqu\'un' }).click();
    await panel.getByRole('button', { name: 'Inviter Bastien', exact: true }).click();
    const invitation = bastien.locator('.toast', { hasText: 'Alice t\'invite aux échecs' });
    await expect(invitation).toBeVisible();
    const before = await selfAt(bastien);
    await invitation.getByRole('button', { name: 'Accepter l\'invitation de Alice' }).click();
    await expect(gamePanel(bastien, 'chess')).toBeVisible();
    await expectNearTable(bastien, 'chess');
    expect(await selfAt(bastien)).not.toEqual(before);
    await waitForTable(alice, 'chess', (view) => view.chairs.every((chair) => chair !== null));
    expect((await gameTable(alice, 'chess'))!.chairs.map((chair) => chair?.name)).toEqual(['Alice', 'Bastien']);
  });

  let white = 0;
  await test.step('avant la partie : l\'échiquier d\'aperçu, rien de cliquable ; tous deux prêts, la partie commence', async () => {
    await expect(gamePanel(alice, 'chess').getByRole('grid', { name: 'Échiquier' })).toBeVisible();
    await squareButton(alice, 'e2').click();
    await expect(squareButton(alice, 'e2')).toHaveAttribute('aria-label', 'e2, pion blanc');
    await bothReady(pages);
    white = await whiteSeat(alice);
    const whiteName = ['Alice', 'Bastien'][white]!;
    // Les Blancs sont en bas pour celui qui les joue, retourné pour l'autre.
    await expect(gamePanel(pages[white]!, 'chess').locator('.game-chess')).toHaveAttribute('data-orientation', 'w');
    await expect(gamePanel(pages[1 - white]!, 'chess').locator('.game-chess')).toHaveAttribute('data-orientation', 'b');
    await expect(status(pages[white]!)).toHaveText('À toi de jouer');
    await expect(status(pages[1 - white]!)).toHaveText(`Au tour de ${whiteName}`);
  });

  await test.step('le mat du berger, joué à la souris jusqu\'au mat : la fin est dite aux deux, avec les notes', async () => {
    await playLine(pages, white, SCHOLARS_MATE);
    const winner = ['Alice', 'Bastien'][white]!;
    for (const page of pages) await expect(status(page)).toHaveText(`Échec et mat : ${winner} gagne.`);
    const view = await waitForTable(alice, 'chess', (candidate) => candidate.match?.status === 'ended');
    expect(view.match!.result).toMatchObject({ ranking: [[white], [1 - white]], reason: 'checkmate' });
    expect(view.match!.ranked).toBe(true);
    // La plateforme dit les notes de chacun (1216 et 1184, une seule fois), et le roi noir est cerné.
    const winnerLine = `${winner} : 1200 → 1216 (+16)`;
    const loser = ['Alice', 'Bastien'][1 - white]!;
    for (const page of pages) {
      await expect(gamePanel(page, 'chess').getByText(winnerLine, { exact: true })).toBeVisible();
      await expect(gamePanel(page, 'chess').getByText(`${loser} : 1200 → 1184 (\u221216)`, { exact: true })).toBeVisible();
      await expect(squareButton(page, 'e8')).toHaveAttribute('aria-label', 'e8, roi noir, en échec');
      await expect(squareButton(page, 'f7')).toHaveAttribute('aria-label', 'f7, dame blanche, dernier coup');
    }
    await captureBoth(pages[white]!, 'mat-440');
  });

  await test.step('le classement montre 1216 et 1184, chacun une seule fois', async () => {
    const panel = gamePanel(alice, 'chess');
    await panel.getByRole('tab', { name: 'Classement' }).click();
    await expect(panel.locator('.ladder-rating')).toHaveCount(2);
    await expect(panel.locator('.ladder-rating', { hasText: /^1216$/ })).toHaveCount(1);
    await expect(panel.locator('.ladder-rating', { hasText: /^1184$/ })).toHaveCount(1);
    await panel.getByRole('tab', { name: 'Partie' }).click();
  });

  let secondWhite = 0;
  await test.step('la revanche échange les couleurs', async () => {
    const first = await waitForTable(alice, 'chess', (view) => view.match?.status === 'ended');
    await bothReady(pages, first.match!.id);
    secondWhite = await whiteSeat(alice);
    expect(secondWhite).toBe(1 - white);
    await expect(gamePanel(pages[secondWhite]!, 'chess').locator('.game-chess')).toHaveAttribute('data-orientation', 'w');
  });

  const claire = await arrive(browser, 'Claire');
  await test.step('un troisième navigateur ouvre la table sans s\'asseoir : il regarde, les Blancs en bas, et voit chaque coup', async () => {
    await goToChair(claire, 'chess', 0);
    await openTableWithKey(claire, 'chess');
    await expect(gamePanel(claire, 'chess').locator('.game-chess')).toHaveAttribute('data-orientation', 'w');
    await expect(gamePanel(alice, 'chess').getByText('1 spectateur : Claire')).toBeVisible();
    await playLine(pages, secondWhite, FRIED_LIVER.slice(0, 6));
    await expect(squareButton(claire, 'e4')).toHaveAttribute('aria-label', 'e4, pion blanc');
    await expect(squareButton(claire, 'f6')).toHaveAttribute('aria-label', 'f6, cavalier noir, dernier coup');
    // Un spectateur ne peut rien jouer : un clic ne sélectionne rien.
    await squareButton(claire, 'g1').click();
    await expect(squareButton(claire, 'g1')).toHaveAttribute('aria-label', 'g1, vide');
    await playLine(pages, secondWhite, FRIED_LIVER.slice(6), 6);
    await expect(squareButton(claire, 'f7')).toHaveAttribute('aria-label', 'f7, roi noir, dernier coup');
  });

  await test.step('les pièces prises, l\'avance et la liste des coups ; la sélection allume les cases d\'arrivée (captures)', async () => {
    const whitePage = pages[secondWhite]!;
    const panel = gamePanel(whitePage, 'chess');
    // Les Noirs ont pris un pion et un cavalier, les Blancs deux pions : l'avance est aux Noirs, de 2.
    await expect(panel.getByRole('group', { name: `Pièces prises par ${['Alice', 'Bastien'][1 - secondWhite]!}` }).getByText('+2')).toBeVisible();
    await expect(panel.getByRole('list', { name: 'Liste des coups' }).getByRole('listitem')).toHaveCount(6);
    await expect(panel.getByRole('list', { name: 'Liste des coups' })).toContainText('Cg5');
    await squareButton(whitePage, 'd1').click();
    await expect(squareButton(whitePage, 'f3')).toHaveAttribute('aria-label', 'f3, vide, coup possible');
    await expect(squareButton(whitePage, 'h5')).toHaveAttribute('aria-label', 'h5, vide, coup possible');
    await captureBoth(whitePage, 'partie-440');
    await captureBoth(claire, 'spectateur-440');
    await squareButton(whitePage, 'd1').click();
  });

  await test.step('un abandon finit la partie, pour les trois navigateurs', async () => {
    const resigner = pages[secondWhite]!;
    const resignerName = ['Alice', 'Bastien'][secondWhite]!;
    const winnerName = ['Alice', 'Bastien'][1 - secondWhite]!;
    await gamePanel(resigner, 'chess').getByRole('button', { name: 'Abandonner', exact: true }).click();
    await gamePanel(resigner, 'chess').getByRole('alertdialog').getByRole('button', { name: 'Abandonner', exact: true }).click();
    for (const page of [alice, bastien, claire]) await expect(status(page)).toHaveText(`${resignerName} abandonne. ${winnerName} gagne.`);
    const view = await waitForTable(alice, 'chess', (candidate) => candidate.match?.status === 'ended');
    expect(view.match!.result).toMatchObject({ reason: 'resign' });
    // La partie est finie : plus aucune pièce ne se sélectionne.
    await squareButton(resigner, 'e1').click();
    await expect(squareButton(resigner, 'e1')).toHaveAttribute('aria-label', /^e1, roi blanc$|^e1, roi blanc, /);
    await expect(resigner.locator('.game-chess [data-selected]')).toHaveCount(0);
  });

  await test.step('chacun se lève : la table est libre pour la suite', async () => {
    for (const page of pages) await gamePanel(page, 'chess').getByRole('button', { name: 'Se lever', exact: true }).click();
    await waitForTable(alice, 'chess', (view) => view.chairs.every((chair) => chair === null));
  });
});

test('les fins proches : une promotion par le choix, un mat en un coup, une nulle proposée puis acceptée, un pat', async ({ browser }) => {
  test.setTimeout(900_000);
  const alice = await arrive(browser, 'Alice');
  const bastien = await arrive(browser, 'Bastien');
  const pages = [alice, bastien];
  await seatAt(alice, 0);
  await seatAt(bastien, 1);
  await bothReady(pages);
  let white = await whiteSeat(alice);

  await test.step('une promotion : le pion arrive au bout, un choix s\'ouvre (rien n\'est envoyé), « Cavalier » le résout', async () => {
    // Un pion noir reste en h7 : roi et cavalier contre roi seul serait une nulle (matériel insuffisant), et la partie ne continuerait pas pour la suite du test.
    await setPosition(pages[white]!, '4k3/P6p/8/8/8/8/8/4K3 w - - 0 1', white);
    const player = pages[white]!;
    await squareButton(player, 'a7').click();
    await expect(squareButton(player, 'a8')).toHaveAttribute('aria-label', 'a8, vide, coup possible');
    await squareButton(player, 'a8').click();
    const choice = gamePanel(player, 'chess').getByRole('dialog', { name: 'Promotion : choisis une pièce' });
    await expect(choice).toBeVisible();
    await expect(choice.getByRole('button', { name: 'Dame' })).toBeFocused();
    expect(plies((await gameTable(player, 'chess'))!).length).toBe(2);
    await captureBoth(player, 'promotion-440');
    await choice.getByRole('button', { name: 'Cavalier' }).click();
    await expect(squareButton(player, 'a8')).toHaveAttribute('aria-label', 'a8, cavalier blanc, dernier coup');
    await expect(squareButton(pages[1 - white]!, 'a8')).toHaveAttribute('aria-label', 'a8, cavalier blanc, dernier coup');
    expect(((await gameTable(player, 'chess'))!.match!.state as ChessState).fen.startsWith('N3k3/')).toBe(true);
  });

  await test.step('un mat en un coup, joué à la souris : la fin, le cercle rouge, « Revanche »', async () => {
    await setPosition(pages[white]!, '7k/8/6K1/8/8/8/8/R7 w - - 0 1', white);
    await playByMouse(pages[white]!, 'a1a8', 3);
    for (const page of pages) await expect(status(page)).toHaveText(`Échec et mat : ${['Alice', 'Bastien'][white]!} gagne.`);
    await expect(squareButton(pages[1 - white]!, 'h8')).toHaveAttribute('aria-label', 'h8, roi noir, en échec');
    await expect(readyButton(pages[0]!, 'chess')).toHaveText('Revanche');
    // La phrase de fin et « Revanche » se voient sans faire défiler le panneau à la main : sous le grand plateau, elles étaient sous le pli. Le panneau défile de lui-même.
    for (const page of pages) {
      await expect(status(page)).toBeInViewport({ ratio: 1 });
      await expect(readyButton(page, 'chess')).toBeInViewport({ ratio: 1 });
    }
  });

  await test.step('la revanche, puis une nulle : proposée par l\'un, acceptée par l\'autre', async () => {
    const ended = await waitForTable(alice, 'chess', (view) => view.match?.status === 'ended');
    await bothReady(pages, ended.match!.id);
    white = await whiteSeat(alice);
    await setPosition(pages[white]!, 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1', white);
    const proposer = pages[1 - white]!;
    const other = pages[white]!;
    const proposerName = ['Alice', 'Bastien'][1 - white]!;
    await gamePanel(proposer, 'chess').getByRole('button', { name: 'Proposer la nulle' }).click();
    await expect(gamePanel(other, 'chess').getByText(`${proposerName} propose la nulle.`)).toBeVisible();
    await gamePanel(other, 'chess').getByRole('button', { name: 'Accepter la nulle' }).click();
    for (const page of pages) await expect(status(page)).toHaveText('Nulle par accord.');
  });

  await test.step('la revanche, puis un pat : la nulle automatique', async () => {
    const ended = await waitForTable(alice, 'chess', (view) => view.match?.status === 'ended');
    await bothReady(pages, ended.match!.id);
    white = await whiteSeat(alice);
    await setPosition(pages[white]!, '7k/5Q2/8/6K1/8/8/8/8 w - - 0 1', white);
    await playByMouse(pages[white]!, 'g5g6', 3);
    for (const page of pages) await expect(status(page)).toHaveText('Pat : nulle.');
    const view = await waitForTable(alice, 'chess', (candidate) => candidate.match?.status === 'ended');
    expect(view.match!.result).toMatchObject({ ranking: [[0, 1]], reason: 'stalemate' });
  });
});

test('à 375 px : ni défilement horizontal ni cible sous 24 px ; l\'échiquier est lisible (captures)', async ({ browser }) => {
  test.setTimeout(900_000);
  const alice = await arrive(browser, 'Alice');
  const bastien = await arrive(browser, 'Bastien');
  const pages = [alice, bastien];
  await seatAt(alice, 0);
  await seatAt(bastien, 1);
  await bothReady(pages);
  const white = await whiteSeat(alice);
  await playLine(pages, white, FRIED_LIVER);
  const player = pages[1 - white]!;

  await test.step('la feuille du bas d\'un téléphone : l\'échiquier mesure 311 px de contenu, des cases de 38 px', async () => {
    await player.setViewportSize({ width: 375, height: 812 });
    // La liste des coups choisit d'être repliée à l'ouverture du panneau : on le referme et on le rouvre, comme sur un vrai téléphone.
    await gamePanel(player, 'chess').getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(gamePanel(player, 'chess')).toHaveCount(0);
    const panel = await openTableWithKey(player, 'chess');
    const board = panel.locator('.game-chess-board');
    await expect(board).toBeVisible();
    const box = (await board.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(311);
    expect(box.width).toBeGreaterThanOrEqual(300);
    const cell = (await squareButton(player, 'e4').boundingBox())!;
    expect(Math.round(cell.width)).toBeGreaterThanOrEqual(37);
    expect(Math.round(cell.width)).toBeLessThanOrEqual(39);
    // La liste des coups est repliée d'emblée, sur téléphone.
    await expect(panel.getByRole('button', { name: /^Coups/ })).toHaveAttribute('aria-expanded', 'false');
  });

  await test.step('aucun défilement horizontal, ni dans la page ni dans le panneau', async () => {
    const overflow = await player.evaluate(() => {
      const page = document.documentElement;
      const panel = document.querySelector('.game-drawer') as HTMLElement | null;
      return { page: page.scrollWidth - page.clientWidth, panel: panel ? panel.scrollWidth - panel.clientWidth : 0 };
    });
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.panel).toBeLessThanOrEqual(0);
  });

  await test.step('aucune cible sous 24 px de côté, dans tout le panneau', async () => {
    const targets = await player.evaluate(() => {
      const panel = document.querySelector('.game-drawer') as HTMLElement;
      return [...panel.querySelectorAll<HTMLElement>('button, [role="tab"], a[href], input, select')]
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.visibility !== 'hidden' && style.display !== 'none' && !element.closest('.visually-hidden') && element.getClientRects().length > 0;
        })
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30) ?? '', width: Math.round(box.width), height: Math.round(box.height) };
        });
    });
    expect(targets.length).toBeGreaterThan(64);
    const tooSmall = targets.filter((target) => target.width < 24 || target.height < 24);
    expect(tooSmall, JSON.stringify(tooSmall)).toEqual([]);
  });

  await test.step('captures de la feuille du bas, de jour et de nuit (une page haute pour voir tout le panneau)', async () => {
    await player.setViewportSize({ width: 375, height: 1700 });
    await expect(gamePanel(player, 'chess').locator('.game-chess-board')).toBeVisible();
    await captureBoth(player, 'partie-375', 'page');
    await player.setViewportSize({ width: 375, height: 812 });
  });

  await test.step('les cases et le choix de promotion tiennent à 375 px', async () => {
    await setPosition(pages[white]!, '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', white);
    const mover = pages[white]!;
    await mover.setViewportSize({ width: 375, height: 1700 });
    await squareButton(mover, 'a7').click();
    await squareButton(mover, 'a8').click();
    const choice = gamePanel(mover, 'chess').getByRole('dialog', { name: 'Promotion : choisis une pièce' });
    await expect(choice).toBeVisible();
    const options = await choice.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()).map((box) => ({ width: box.width, height: box.height, right: box.right })));
    for (const option of options) {
      expect(option.width).toBeGreaterThanOrEqual(24);
      expect(option.height).toBeGreaterThanOrEqual(24);
      expect(option.right).toBeLessThanOrEqual(375);
    }
    await captureBoth(mover, 'promotion-375', 'page');
    await choice.getByRole('button', { name: 'Dame' }).click();
  });
});
