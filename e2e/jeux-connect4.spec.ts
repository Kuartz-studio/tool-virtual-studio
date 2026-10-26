import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { playColumns } from '../packages/shared/src/games/connect4';
import { giveDeskBack, joinOffice, selfAt } from './helpers';
import { debugGame, expectNearTable, gamePanel, gameTable, goToChair, openTableWithKey, readyButton, sitAt, waitForTable, type TableView } from './jeux-helpers';

// Le Puissance 4 de bout en bout, sur la vraie carte, à deux navigateurs (Alice, assise à la première chaise ; Bastien, qui accepte son invitation) et un troisième qui regarde : l'invitation et
// l'arrivée à la table, une partie jouée à la souris jusqu'à la victoire (la verticale de la colonne 4, C4 du document des jeux), les notes 1216 et 1184 écrites une seule fois, la revanche où
// l'autre commence (jouée au clavier), un spectateur qui ne peut rien, un abandon, puis une nulle (`debugGame` pose la grille pleine moins un jeton, le dernier est joué à la souris), et les
// captures du plateau à 440 et 375 px, de jour et de nuit. Ce spec passe en série, sur une seule table : chaque test prend la suite du précédent (le projet « jeux » : playwright.config.ts).

test.describe.configure({ mode: 'serial' });
// Un clic qui n'aboutit pas (un élément qui n'est jamais actif) échoue vite au lieu d'attendre la fin du test.
test.use({ actionTimeout: 20_000 });

const CAPTURES = fileURLToPath(new URL('../.superpowers/captures/connect4/', import.meta.url));
const TEST_TIMEOUT_MS = 240_000;
// Les colonnes de la partie du document, jouées dans l'ordre à partir de celui qui commence : il joue quatre fois la colonne 4 (indice 3), l'autre trois fois la colonne 5.
const C4 = [3, 4, 3, 4, 3, 4, 3];
// C9 : le 27e jeton, en colonne 7, achève deux lignes à la fois (la verticale et la diagonale : sept cases). C10 : la grille pleine, sans alignement.
const C9 = [3, 0, 2, 0, 5, 0, 6, 2, 0, 4, 6, 1, 0, 2, 6, 0, 4, 1, 3, 5, 4, 3, 5, 2, 1, 5, 6];
const C10 = [0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 1, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 4, 6, 6, 6, 6, 6, 6, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5];

const contexts: BrowserContext[] = [];
let alice: Page;
let bastien: Page;
// Les pages par siège : Alice a la première chaise (siège 0), Bastien la seconde (siège 1).
let seatPages: [Page, Page];
const NAMES = ['Alice', 'Bastien'] as const;

// Une personne de plus, dans le bureau, sans bureau (d'autres tests en cherchent un libre) : elle apparaît à l'accueil, loin de la table.
async function arrive(browser: Browser, name: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<Page> {
  const context = await browser.newContext(options);
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  await giveDeskBack(page);
  return page;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  alice = await arrive(browser, 'Alice');
  bastien = await arrive(browser, 'Bastien');
  seatPages = [alice, bastien];
});

test.afterAll(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Ce que le plateau montre, par page.
const panel = (page: Page) => gamePanel(page, 'connect4');
const board = (page: Page) => panel(page).locator('.game-connect4');
const column = (page: Page, n: number) => panel(page).getByRole('button', { name: new RegExp(`^Colonne ${n} :`) });
const tokens = (page: Page) => board(page).locator('.game-connect4-token');
const statusLine = (page: Page) => panel(page).locator('.game-status');

interface State {
  first: number;
  moves: number[];
}
const stateOf = (view: TableView): State => view.match!.state as State;
const movesOf = (view: TableView): number[] => stateOf(view).moves;

// La partie de cette table, vue par cette page.
async function current(page: Page): Promise<{ id: string; first: number; moves: number[]; view: TableView }> {
  const view = (await gameTable(page, 'connect4'))!;
  return { id: view.match!.id, first: stateOf(view).first, moves: movesOf(view), view };
}

// Joue ces colonnes à la souris, chacune par celui qui a le trait (`first`, puis l'autre), après `already` jetons déjà posés : on attend que sa colonne soit jouable, on clique, on attend le serveur.
async function playWithMouse(first: number, columns: number[], already = 0): Promise<void> {
  for (const [index, col] of columns.entries()) {
    const played = already + index;
    const mover = seatPages[(first + played) % 2]!;
    const target = column(mover, col + 1);
    await expect(target).toHaveAttribute('aria-disabled', 'false');
    await target.click();
    await waitForTable(mover, 'connect4', (view) => movesOf(view).length === played + 1);
  }
}

// Les deux se disent prêts (« Prêt », ou « Revanche ») : une nouvelle partie commence. Rend la partie, vue par Alice.
async function bothReady(): Promise<Awaited<ReturnType<typeof current>>> {
  const before = (await gameTable(alice, 'connect4'))?.match?.id ?? null;
  await readyButton(alice, 'connect4').click();
  await readyButton(bastien, 'connect4').click();
  await waitForTable(alice, 'connect4', (view) => view.match !== null && view.match.id !== before && view.match.status === 'playing');
  return current(alice);
}

// Une capture du panneau (ou du plateau), dans .superpowers/captures/connect4/ de ce worktree.
async function capture(page: Page, name: string, what: 'panneau' | 'plateau' = 'panneau'): Promise<void> {
  mkdirSync(CAPTURES, { recursive: true });
  const target = what === 'panneau' ? panel(page) : board(page);
  await target.screenshot({ path: `${CAPTURES}${name}.png` });
}

const setNight = (page: Page, night: boolean) =>
  page.evaluate((on) => {
    const layer = document.querySelector('.office-ui');
    if (on) layer?.setAttribute('data-theme', 'night');
    else layer?.removeAttribute('data-theme');
  }, night);

test('Alice s\'assoit et invite Bastien : il accepte, arrive près de la table, assis, et la partie commence quand les deux sont prêts', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  // La table est libre : un spec qui a passé avant (la plateforme : une Alice s'y assoit pour essayer l'invitation) l'a peut-être laissée, et la chaise ne se libère que quelques secondes
  // après le départ de celle qui l'occupait.
  await waitForTable(alice, 'connect4', (view) => view.match === null && view.chairs.every((chair) => chair === null), 45_000);
  await goToChair(alice, 'connect4', 0);
  await openTableWithKey(alice, 'connect4');
  await sitAt(alice, 'connect4', 0);
  // Avant la première partie : la grille de départ, où rien n'est cliquable.
  await expect(board(alice)).toHaveAttribute('data-preview', 'true');
  await expect(panel(alice).getByRole('button', { name: /^Colonne \d :/ })).toHaveCount(7);
  for (let n = 1; n <= 7; n++) await expect(column(alice, n)).toHaveAttribute('aria-disabled', 'true');

  await panel(alice).getByRole('button', { name: 'Inviter quelqu\'un' }).click();
  // Le Bastien du spec d'avant (les échecs) reste dans le bureau 10 s après son départ (DISCONNECT_GRACE_MS) : on attend qu'il n'y en ait plus qu'un.
  await expect(panel(alice).getByRole('button', { name: 'Inviter Bastien', exact: true })).toHaveCount(1, { timeout: 15_000 });
  await panel(alice).getByRole('button', { name: 'Inviter Bastien', exact: true }).click();
  const invitation = bastien.locator('.toast', { hasText: 'Alice t\'invite au Puissance 4' });
  await expect(invitation).toBeVisible();
  const before = await selfAt(bastien);
  await invitation.getByRole('button', { name: 'Accepter l\'invitation de Alice' }).click();

  await expect(panel(bastien)).toBeVisible();
  await expectNearTable(bastien, 'connect4');
  expect(await selfAt(bastien)).not.toEqual(before);
  await waitForTable(bastien, 'connect4', (view) => view.chairs.every((chair) => chair !== null));
  expect((await gameTable(alice, 'connect4'))!.chairs.map((chair) => chair?.name)).toEqual(['Alice', 'Bastien']);

  const started = await bothReady();
  expect([0, 1]).toContain(started.first);
  expect(started.moves).toEqual([]);
  for (const page of seatPages) await expect(board(page)).not.toHaveAttribute('data-preview', /.*/);
});

test('au départ, le fantôme suit la souris sur la colonne de celui qui a le trait, et l\'autre ne voit ni fantôme ni colonne jouable', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { first } = await current(alice);
  const mover = seatPages[first]!;
  const waiting = seatPages[1 - first]!;
  for (let n = 1; n <= 7; n++) {
    await expect(column(mover, n)).toHaveAttribute('aria-disabled', 'false');
    await expect(column(waiting, n)).toHaveAttribute('aria-disabled', 'true');
  }
  // Le fantôme est invisible tant qu'on ne survole pas, puis il a la couleur du siège de celui qui joue et se montre sur la colonne visée.
  const ghost = column(mover, 4).locator('.game-connect4-ghost');
  await expect(ghost).toHaveCount(1);
  await mover.mouse.move(0, 0);
  await expect.poll(() => ghost.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
  await column(mover, 4).hover();
  await expect.poll(() => ghost.evaluate((element) => getComputedStyle(element).opacity)).toBe('0.6');
  await expect(ghost).toHaveAttribute('data-seat', String(first));
  await column(mover, 1).hover();
  await expect.poll(() => ghost.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
  // Celui qui attend n'a aucun fantôme, même en survolant.
  await column(waiting, 4).hover();
  await expect(board(waiting).locator('.game-connect4-ghost')).toHaveCount(0);
});

test('une partie jouée à la souris jusqu\'à la victoire : quatre jetons l\'un sur l\'autre, la ligne est marquée sur les deux plateaux, et celui qui commençait gagne', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { first } = await current(alice);
  await playWithMouse(first, C4.slice(0, 1));
  // Le jeton de l'autre arrive sur ma page en tombant : data-falling, jusqu'au prochain changement.
  const opponent = seatPages[1 - first]!;
  await expect(tokens(opponent)).toHaveCount(1);
  await expect(tokens(opponent).first()).toHaveAttribute('data-falling', 'true');
  await playWithMouse(first, C4.slice(1), 1);

  const winner = NAMES[first]!;
  for (const page of seatPages) {
    await expect(statusLine(page)).toHaveText(`Quatre alignés : ${winner} gagne.`);
    await expect(tokens(page)).toHaveCount(7);
    await expect(board(page).locator('.game-connect4-token[data-win]')).toHaveCount(4);
    await expect(board(page).locator('.game-connect4-token[data-dim]')).toHaveCount(3);
    await expect(board(page).locator('.game-connect4-token[data-last]')).toHaveCount(1);
    for (let n = 1; n <= 7; n++) await expect(column(page, n)).toHaveAttribute('aria-disabled', 'true');
    // La phrase de fin et « Revanche » se voient sans faire défiler le panneau à la main : sous le plateau, elles étaient sous le pli. Le panneau défile de lui-même.
    await expect(statusLine(page)).toBeInViewport({ ratio: 1 });
    await expect(readyButton(page, 'connect4')).toBeInViewport({ ratio: 1 });
  }
  const view = (await gameTable(alice, 'connect4'))!;
  expect(view.match!.status).toBe('ended');
  expect(view.match!.result).toEqual({ ranking: [[first], [1 - first]], reason: 'four', detail: { cells: [18, 19, 20, 21] } });
  expect(movesOf(view)).toEqual(C4);
});

test('les notes : 1216 pour le gagnant et 1184 pour l\'autre, une seule fois, à l\'écran comme dans le classement', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { first, view } = await current(alice);
  const winner = NAMES[first]!;
  const loser = NAMES[1 - first]!;
  expect(view.match!.ranked).toBe(true);
  const ratings = view.match!.ratings!;
  expect(ratings.map((rating) => [rating.before, rating.after])).toEqual(first === 0 ? [[1200, 1216], [1200, 1184]] : [[1200, 1184], [1200, 1216]]);
  // Les deux pages ont la même vue, et chaque ligne de note n'est écrite qu'une fois.
  expect((await gameTable(bastien, 'connect4'))!.match!.ratings).toEqual(ratings);
  for (const page of seatPages) {
    await expect(panel(page).locator('.game-ratings li')).toHaveText([`Alice : ${first === 0 ? '1200 → 1216 (+16)' : '1200 → 1184 (−16)'}`, `Bastien : ${first === 0 ? '1200 → 1184 (−16)' : '1200 → 1216 (+16)'}`]);
    await expect(panel(page).getByText('→ 1216')).toHaveCount(1);
    await expect(panel(page).getByText('→ 1184')).toHaveCount(1);
  }
  // Le classement de la table : chacun une partie, le gagnant en tête.
  await panel(alice).getByRole('tab', { name: 'Classement' }).click();
  const rows = panel(alice).locator('.ladder-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(winner);
  await expect(rows.nth(0).locator('.ladder-rating')).toHaveText('1216');
  await expect(rows.nth(0).locator('td').nth(2)).toHaveText('1');
  await expect(rows.nth(0).locator('.ladder-record')).toHaveText('1 / 0 / 0');
  await expect(rows.nth(1)).toContainText(loser);
  await expect(rows.nth(1).locator('.ladder-rating')).toHaveText('1184');
  await expect(rows.nth(1).locator('.ladder-record')).toHaveText('0 / 0 / 1');
  await panel(alice).getByRole('tab', { name: 'Partie' }).click();
  await expect(board(alice)).toBeVisible();
});

test('la revanche : c\'est l\'autre qui commence, et il joue au clavier (flèches, Entrée, chiffre) sans que son avatar bouge', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const previous = await current(alice);
  const started = await bothReady();
  expect(started.id).not.toBe(previous.id);
  expect(started.first).toBe(1 - previous.first);
  expect(started.moves).toEqual([]);

  const mover = seatPages[started.first]!;
  const waiting = seatPages[1 - started.first]!;
  for (let n = 1; n <= 7; n++) {
    await expect(column(mover, n)).toHaveAttribute('aria-disabled', 'false');
    await expect(column(waiting, n)).toHaveAttribute('aria-disabled', 'true');
  }

  // Le focus entre dans le plateau, une flèche tenue enfoncée le déplace d'une colonne, et l'avatar reste où il est : le plateau a pris la touche.
  const feet = await selfAt(mover);
  await column(mover, 4).focus();
  await mover.keyboard.down('ArrowRight');
  await mover.waitForTimeout(500);
  await mover.keyboard.up('ArrowRight');
  await expect(mover.locator(':focus')).toHaveAttribute('aria-label', /^Colonne 5 :/);
  expect(await selfAt(mover)).toEqual(feet);
  // Entrée lâche le jeton dans la colonne qui a le focus.
  await mover.keyboard.press('Enter');
  await waitForTable(mover, 'connect4', (view) => movesOf(view).length === 1);
  expect(movesOf((await gameTable(mover, 'connect4'))!)).toEqual([4]);
  // L'autre joue à la souris, puis un chiffre joue sa colonne, d'où que soit le focus dans le plateau.
  await playWithMouse(started.first, [4], 1);
  await expect(column(mover, 2)).toHaveAttribute('aria-disabled', 'false');
  await mover.keyboard.press('2');
  await waitForTable(mover, 'connect4', (view) => movesOf(view).length === 3);
  expect(movesOf((await gameTable(mover, 'connect4'))!)).toEqual([4, 4, 1]);
  expect(await selfAt(mover)).toEqual(feet);
  await playWithMouse(started.first, [0], 3);
});

test('un spectateur, mouvement réduit demandé, voit la partie sans pouvoir jouer : ni colonne jouable ni fantôme, et le jeton qui arrive est posé tout de suite', async ({ browser }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const claire = await arrive(browser, 'Claire', { reducedMotion: 'reduce' });
  await goToChair(claire, 'connect4', 1);
  await openTableWithKey(claire, 'connect4');
  await waitForTable(alice, 'connect4', (view) => view.spectators.some((spectator) => spectator.name === 'Claire'));
  await expect(panel(alice).getByText('1 spectateur : Claire')).toBeVisible();
  await expect(panel(claire).getByText('Tu regardes la partie.')).toBeVisible();

  // Elle voit les quatre jetons déjà posés, et ne peut rien : rien de jouable, pas de fantôme, un clic ne part pas.
  await expect(tokens(claire)).toHaveCount(4);
  for (let n = 1; n <= 7; n++) await expect(column(claire, n)).toHaveAttribute('aria-disabled', 'true');
  await column(claire, 4).hover();
  // Playwright ne clique pas ce qui se dit inactif (aria-disabled) : on force le clic, pour voir qu'il ne part rien.
  await column(claire, 4).click({ force: true });
  await expect(board(claire).locator('.game-connect4-ghost')).toHaveCount(0);
  expect(movesOf((await gameTable(claire, 'connect4'))!)).toHaveLength(4);

  // Le jeton suivant : celui qui a le trait le joue ; chez les joueurs il tombe, chez elle (mouvement réduit) il est déjà posé, sans chute, et elle voit le dernier jeton cerclé.
  const { first } = await current(alice);
  const mover = seatPages[(first + 4) % 2]!;
  const other = seatPages[(first + 5) % 2]!;
  await column(mover, 7).click();
  await waitForTable(claire, 'connect4', (view) => movesOf(view).length === 5);
  await expect(tokens(claire)).toHaveCount(5);
  await expect(board(claire).locator('.game-connect4-token[data-last]')).toHaveCount(1);
  await expect(board(claire).locator('.game-connect4-token[data-falling]')).toHaveCount(0);
  await expect(board(other).locator('.game-connect4-token[data-falling]')).toHaveCount(1);
  expect(await board(claire).locator('.game-connect4-token').first().evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  await panel(claire).getByRole('button', { name: 'Fermer', exact: true }).click();
  await waitForTable(alice, 'connect4', (view) => view.spectators.length === 0);
});

// Un objet qui dit s'il y a du défilement horizontal, et si une cible est plus petite que 24 px, dans le panneau d'une page.
async function layoutOf(page: Page) {
  return page.evaluate(() => {
    const aside = document.querySelector<HTMLElement>('aside.game-drawer')!;
    const body = aside.querySelector<HTMLElement>('.drawer-body')!;
    const boardElement = aside.querySelector<HTMLElement>('.game-connect4')!;
    const frame = aside.querySelector<HTMLElement>('.game-connect4-frame')!;
    const small: string[] = [];
    for (const element of aside.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"], [role="tab"]')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.width < 24 - 0.01 || box.height < 24 - 0.01) small.push(`${element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName} (${Math.round(box.width)} × ${Math.round(box.height)})`);
    }
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      asideOverflow: aside.scrollWidth - aside.clientWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      boardWidth: frame.getBoundingClientRect().width,
      containerWidth: boardElement.getBoundingClientRect().width,
      cell: getComputedStyle(boardElement).getPropertyValue('--game-connect4-cell').trim(),
      small,
    };
  });
}

test('captures et mise en page : la grille à 440 px et à 375 px, de jour et de nuit, sans défilement horizontal ni cible sous 24 px, jusqu\'à la ligne gagnante de deux lignes à la fois', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  // La partie en cours devient C9 moins son dernier jeton : le siège 0 (Alice) a le trait, et son jeton en colonne 7 achève la verticale et la diagonale à la fois.
  await debugGame(alice, 'connect4', playColumns(0, C9.slice(0, 26)));
  await waitForTable(alice, 'connect4', (view) => movesOf(view).length === 26);
  await waitForTable(bastien, 'connect4', (view) => movesOf(view).length === 26);
  await expect(column(alice, 7)).toHaveAttribute('aria-disabled', 'false');
  await expect(column(bastien, 7)).toHaveAttribute('aria-disabled', 'true');

  // À 440 px (le panneau d'un ordinateur) : la grille en cours de partie, la souris sur la colonne 7 (le fantôme), de jour puis de nuit.
  await column(alice, 7).hover();
  await expect.poll(() => column(alice, 7).locator('.game-connect4-ghost').evaluate((element) => getComputedStyle(element).opacity)).toBe('0.6');
  const desktop = await layoutOf(alice);
  expect(desktop.cell).toBe('58px');
  expect(desktop.boardWidth).toBe(58 * 7);
  expect(desktop.pageOverflow).toBeLessThanOrEqual(0);
  expect(desktop.bodyOverflow).toBeLessThanOrEqual(0);
  expect(desktop.small).toEqual([]);
  const width = (await panel(alice).boundingBox())!.width;
  expect(width).toBe(440);
  await capture(alice, 'grille-440-jour');
  await setNight(alice, true);
  await capture(alice, 'grille-440-nuit');
  await setNight(alice, false);

  // Au clavier, sans la souris sur la grille : le focus d'une colonne se voit (le liseré de la plateforme), avec son fantôme.
  await alice.mouse.move(2, 2);
  await column(alice, 3).focus();
  await alice.keyboard.press('ArrowRight');
  await expect(alice.locator(':focus')).toHaveAttribute('aria-label', /^Colonne 4 :/);
  await expect.poll(() => column(alice, 4).locator('.game-connect4-ghost').evaluate((element) => getComputedStyle(element).opacity)).toBe('0.6');
  await capture(alice, 'clavier-440-jour');
  await setNight(alice, true);
  await capture(alice, 'clavier-440-nuit');
  await setNight(alice, false);

  // À 375 px (un téléphone) : la feuille du bas, des cases de 44 px.
  await alice.setViewportSize({ width: 375, height: 812 });
  await expect(panel(alice)).toBeVisible();
  await expect.poll(async () => (await layoutOf(alice)).cell).toBe('44px');
  const phone = await layoutOf(alice);
  expect(phone.boardWidth).toBe(44 * 7);
  expect(phone.boardWidth).toBeLessThanOrEqual(phone.containerWidth);
  expect(phone.pageOverflow).toBeLessThanOrEqual(0);
  expect(phone.asideOverflow).toBeLessThanOrEqual(0);
  expect(phone.bodyOverflow).toBeLessThanOrEqual(0);
  expect(phone.small).toEqual([]);
  await column(alice, 7).hover();
  await capture(alice, 'grille-375-jour');
  await capture(alice, 'plateau-375-jour', 'plateau');
  await setNight(alice, true);
  await capture(alice, 'grille-375-nuit');
  await capture(alice, 'plateau-375-nuit', 'plateau');
  await setNight(alice, false);

  // Le dernier jeton, à la souris : deux lignes à la fois, sept cases marquées, la partie finie.
  await column(alice, 7).click();
  await expect(statusLine(alice)).toHaveText('Quatre alignés : Alice gagne.');
  await expect(board(alice).locator('.game-connect4-token[data-win]')).toHaveCount(7);
  await expect(board(bastien).locator('.game-connect4-token[data-win]')).toHaveCount(7);
  const finished = await layoutOf(alice);
  expect(finished.pageOverflow).toBeLessThanOrEqual(0);
  expect(finished.bodyOverflow).toBeLessThanOrEqual(0);
  expect(finished.small).toEqual([]);
  await capture(alice, 'victoire-375-jour');
  await capture(alice, 'victoire-plateau-375-jour', 'plateau');
  await setNight(alice, true);
  await capture(alice, 'victoire-375-nuit');
  await capture(alice, 'victoire-plateau-375-nuit', 'plateau');
  await setNight(alice, false);

  await alice.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(async () => (await panel(alice).boundingBox())?.width).toBe(440);
  await capture(alice, 'victoire-440-jour');
  await setNight(alice, true);
  await capture(alice, 'victoire-440-nuit');
  await setNight(alice, false);
});

test('un abandon : chacun joue un jeton (la partie compte au classement), puis celui qui a le trait abandonne ; l\'autre gagne, et la plateforme le dit', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const started = await bothReady();
  expect(started.moves).toEqual([]);
  await playWithMouse(started.first, [3, 3]);
  const resigner = seatPages[started.first]!;
  const resignerName = NAMES[started.first]!;
  const winnerName = NAMES[1 - started.first]!;
  await resigner.getByRole('button', { name: 'Abandonner', exact: true }).click();
  const dialog = resigner.getByRole('alertdialog', { name: 'Abandonner la partie ?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Abandonner', exact: true }).click();
  for (const page of seatPages) {
    await expect(statusLine(page)).toHaveText(`${resignerName} abandonne. ${winnerName} gagne.`);
    await expect(panel(page).getByText('Partie non classée', { exact: false })).toHaveCount(0);
  }
  const view = (await gameTable(alice, 'connect4'))!;
  expect(view.match!.result).toEqual({ ranking: [[1 - started.first], [started.first]], reason: 'resign' });
  expect(view.match!.ranked).toBe(true);
  expect(view.match!.ratings).toHaveLength(2);
});

test('une nulle : la grille pleine moins un jeton est posée, le dernier est joué à la souris, « Grille pleine : nulle. », sans ligne marquée', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const started = await bothReady();
  expect(started.moves).toEqual([]);
  // C10 moins son dernier jeton, à partir du siège 0 : le 42e jeton est celui du siège 1 (Bastien), en colonne 6.
  await debugGame(alice, 'connect4', playColumns(0, C10.slice(0, 41)));
  await waitForTable(bastien, 'connect4', (view) => movesOf(view).length === 41);
  await expect(tokens(bastien)).toHaveCount(41);
  await expect(column(bastien, 6)).toHaveAttribute('aria-disabled', 'false');
  for (let n = 1; n <= 7; n++) if (n !== 6) await expect(column(bastien, n)).toHaveAttribute('aria-disabled', 'true');
  await expect(column(alice, 6)).toHaveAttribute('aria-disabled', 'true');
  await column(bastien, 6).click();

  for (const page of seatPages) {
    await expect(statusLine(page)).toHaveText('Grille pleine : nulle.');
    await expect(tokens(page)).toHaveCount(42);
    await expect(board(page).locator('.game-connect4-token[data-win]')).toHaveCount(0);
    await expect(board(page).locator('.game-connect4-token[data-dim]')).toHaveCount(0);
  }
  const view = (await gameTable(alice, 'connect4'))!;
  expect(view.match!.result).toEqual({ ranking: [[0, 1]], reason: 'full' });
  expect(view.match!.ranked).toBe(true);
  await capture(alice, 'nulle-440-jour');
});

test('à la fin, les deux se lèvent : la table est libre pour les autres', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  for (const page of seatPages) await panel(page).getByRole('button', { name: 'Se lever' }).click();
  await waitForTable(alice, 'connect4', (view) => view.chairs.every((chair) => chair === null));
});
