import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { fabricateLudo, ludo, type LudoState } from '../packages/shared/src/games/ludo/index';
import { giveDeskBack, joinOffice, selfAt } from './helpers';
import { debugGame, gamePanel, gameTable, goToChair, openTableWithKey, readyButton, sitAt, waitForTable, type TableView } from './jeux-helpers';

// Les petits chevaux, de bout en bout, à trois navigateurs (§ 16.8 du document des jeux) : Alice, Bastien et Claire s'assoient par des invitations et se disent prêts ; chacun a son
// écurie en bas à gauche ; chacun joue un vrai tour (les dés du serveur : lancer, puis un coup ou un tour passé) ; Claire abandonne (ses chevaux quittent le plateau, la partie continue à
// deux) ; `debugGame` pose une fin proche et ses dés, le dernier coup est joué à la souris, le classement complet s'affiche et les notes changent une fois (+16, 0, −16 pour trois joueurs
// à 1200) ; puis une revanche, où Bastien joue sur un téléphone (375 px), par la liste des coups, sans défilement horizontal. Une table à elle (celle des petits chevaux), des comptes
// neufs. Les captures du plateau (440 px et 375 px, de jour et de nuit) vont dans `.superpowers/captures/ludo/`.

test.describe.configure({ mode: 'serial' });

const CAPTURES = fileURLToPath(new URL('../.superpowers/captures/ludo/', import.meta.url));
mkdirSync(CAPTURES, { recursive: true });

// Un écran assez haut pour qu'un panneau de jeu montre tout son contenu (la liste des joueurs, le plateau, le dé, la liste des coups, les boutons) sans défiler : une capture d'élément ne
// prend que ce qui est visible. Un téléphone, lui, a l'écran d'un téléphone (la feuille du bas défile) ; pour voir tout son contenu d'un coup, un écran de la même largeur, mais haut.
const DESKTOP = { width: 1280, height: 1300 };
const PHONE = { width: 375, height: 812 };
const PHONE_TALL = { width: 375, height: 1500 };

interface Player {
  context: BrowserContext;
  page: Page;
}
const players = {} as { alice: Player; bastien: Player; claire: Player };
const contexts: BrowserContext[] = [];

test.afterAll(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Une personne de plus, dans le bureau, sans bureau (les autres tests en cherchent un libre), sur un grand écran.
async function arrive(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext({ viewport: DESKTOP });
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  await giveDeskBack(page);
  return { context, page };
}

const panelOf = (page: Page) => gamePanel(page, 'ludo');
const stateOf = (view: TableView | null): LudoState => view!.match!.state as LudoState;
const tableOf = async (page: Page): Promise<TableView> => (await gameTable(page, 'ludo'))!;
const seatOf = (view: TableView, name: string): number => view.match!.players.findIndex((player) => player.name === name);

// Le thème de la couche d'interface (la lumière du bureau : `data-theme`, « day » ou « night »), posé à la main : c'est ce que la nuit change aux jetons de couleur. La couche change de
// couleurs en un temps (--dur-theme, 500 ms) : on attend qu'elle ait fini avant de photographier.
async function setTheme(page: Page, theme: 'day' | 'night'): Promise<void> {
  await page.locator('.office-ui').first().evaluate((element, value) => element.setAttribute('data-theme', value), theme);
  await page.waitForTimeout(800);
}

// Prend le panneau en photo dans `.superpowers/captures/ludo/`, de nuit si on le demande, puis rend le jour. Le dé a fini de rouler, et rien ne glisse plus : ce qu'on photographie est
// l'état posé.
async function capture(page: Page, name: string, options: { night?: boolean } = {}): Promise<void> {
  await expect(panelOf(page).locator('.ludo-die[data-rolling], .ludo-horse[data-sliding]')).toHaveCount(0);
  if (options.night) await setTheme(page, 'night');
  await panelOf(page).screenshot({ path: `${CAPTURES}${name}.png` });
  if (options.night) await setTheme(page, 'day');
}

// La page entière, à l'écran d'un téléphone : ce que la personne voit (la feuille du bas, défilée jusqu'au plateau).
async function captureScreen(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${CAPTURES}${name}.png` });
}

// Ce que le panneau a de trop large : rien, quand rien ne défile de côté (ni la page, ni le corps du panneau), et le plateau reste dans le corps du panneau.
async function horizontalFit(page: Page): Promise<{ page: number; body: number; boardLeft: number; boardRight: number; bodyLeft: number; bodyRight: number; viewport: number }> {
  return page.evaluate(() => {
    const body = document.querySelector('.game-drawer .drawer-body') as HTMLElement;
    const board = document.querySelector('.game-drawer svg.ludo-board') as SVGElement;
    const root = document.documentElement;
    const boardBox = board.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    return {
      page: root.scrollWidth - root.clientWidth,
      body: body.scrollWidth - body.clientWidth,
      boardLeft: boardBox.left,
      boardRight: boardBox.right,
      bodyLeft: bodyBox.left,
      bodyRight: bodyBox.right,
      viewport: window.innerWidth,
    };
  });
}

// Les états fabriqués : l'avancée de chaque cheval par prénom, rangée par siège ; les autres sièges, à l'écurie. `fabricateLudo` refuse un état illégal : le test le saurait.
function fabricate(view: TableView, horses: Partial<Record<'Alice' | 'Bastien' | 'Claire', number[]>>, extra: Omit<Parameters<typeof fabricateLudo>[0], 'horses'>): LudoState {
  const rows = view.match!.players.map((player) => horses[player.name as 'Alice'] ?? [-1, -1, -1, -1]);
  return fabricateLudo({ horses: rows, ...extra });
}

// Joue un tour entier de celui dont le trait est à ce navigateur, avec les vrais boutons et les vrais dés du serveur : « Lancer le dé », puis, s'il y a un coup, le premier de la liste ;
// et ainsi de suite tant que le trait reste à lui (un 6, un essai de plus quand aucun cheval n'est en jeu). Chaque fois que le dé laisse un coup à jouer, la valeur du dé, que
// l'état donne, est celle que les trois navigateurs montrent une fois le dé arrêté. Rend la dernière vue de ce navigateur.
async function playTurn(page: Page, everyone: Page[]): Promise<TableView> {
  const name = await nameOf(page);
  for (let guard = 0; guard < 80; guard++) {
    const view = await tableOf(page);
    const state = stateOf(view);
    if (view.match!.status !== 'playing' || state.turn !== seatOf(view, name)) return view;
    const panel = panelOf(page);
    if (state.phase === 'roll') {
      await panel.getByRole('button', { name: 'Lancer le dé' }).click();
      const rolled = await waitForTable(page, 'ludo', (next) => next.version > view.version);
      const after = stateOf(rolled);
      if (after.phase === 'move') for (const watcher of everyone) await expect(panelOf(watcher).getByRole('img', { name: `Dé : ${after.die}` })).toBeVisible();
    } else {
      await panel.locator('.ludo-move').first().click();
      await waitForTable(page, 'ludo', (next) => next.version > view.version);
    }
  }
  throw new Error('Un tour de petits chevaux ne finit pas en 80 actions.');
}

async function nameOf(page: Page): Promise<string> {
  for (const [key, player] of Object.entries(players)) if (player.page === page) return key[0]!.toUpperCase() + key.slice(1);
  throw new Error('Page inconnue.');
}

test('Alice invite Bastien et Claire aux petits chevaux : ils s\'assoient, tous se disent prêts, la partie commence, et chacun a son écurie en bas à gauche', async ({ browser }) => {
  test.setTimeout(300_000);
  players.alice = await arrive(browser, 'Alice');
  players.bastien = await arrive(browser, 'Bastien');
  players.claire = await arrive(browser, 'Claire');
  const { alice, bastien, claire } = players;

  // Alice s'assoit à la chaise 1, et ouvre la table (la touche E devant elle) : la salle d'attente, au-dessus d'un plateau d'aperçu (deux joueurs, tous les chevaux à l'écurie).
  await goToChair(alice.page, 'ludo', 0);
  await openTableWithKey(alice.page, 'ludo');
  await sitAt(alice.page, 'ludo', 0);
  await expect(panelOf(alice.page).locator('.game-ludo[data-preview="true"]')).toBeVisible();
  await expect(panelOf(alice.page).locator('.ludo-horse')).toHaveCount(8);
  await expect(panelOf(alice.page).locator('.ludo-roll, .ludo-move, .ludo-hit')).toHaveCount(0);
  expect((await panelOf(alice.page).boundingBox())!.width).toBe(440);
  expect(await panelOf(alice.page).locator('.game-ludo').getAttribute('data-cell')).toBe('27');
  expect((await horizontalFit(alice.page)).body).toBeLessThanOrEqual(0);
  await capture(alice.page, '01-salle-d-attente-440-jour');
  await capture(alice.page, '01-salle-d-attente-440-nuit', { night: true });

  // Elle invite Bastien, puis Claire : chacun accepte (il est posé près de la table, assis, et le panneau s'ouvre). La liste des personnes à inviter reste ouverte entre les deux.
  const invite = async (guest: Player, name: string, chair: number) => {
    const toggle = panelOf(alice.page).getByRole('button', { name: 'Inviter quelqu\'un' });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await panelOf(alice.page).getByRole('button', { name: `Inviter ${name}`, exact: true }).click();
    const invitation = guest.page.locator('.toast', { hasText: 'Alice t\'invite aux petits chevaux' });
    await expect(invitation).toBeVisible();
    await invitation.getByRole('button', { name: 'Accepter l\'invitation de Alice' }).click();
    await expect(panelOf(guest.page)).toBeVisible();
    await waitForTable(alice.page, 'ludo', (view) => view.chairs[chair]?.name === name);
  };
  await invite(bastien, 'Bastien', 1);
  await invite(claire, 'Claire', 2);

  // Tous se disent prêts : la partie commence.
  for (const player of [alice, bastien, claire]) await readyButton(player.page, 'ludo').click();
  const view = await waitForTable(alice.page, 'ludo', (next) => next.match?.status === 'playing');
  expect(view.match!.players.map((player) => player.name)).toEqual(['Alice', 'Bastien', 'Claire']);
  expect(ludo.invariants(stateOf(view))).toEqual([]);

  // Chacun voit le même plateau, tourné pour que son écurie soit en bas à gauche : rouge, vert et jaune (trois joueurs) font 3, 2 et 1 quarts de tour.
  const turns = { alice: '3', bastien: '2', claire: '1' } as const;
  for (const [key, player] of Object.entries(players) as Array<[keyof typeof turns, Player]>) {
    const board = panelOf(player.page).locator('.game-ludo');
    await expect(board).toBeVisible();
    await expect(board).toHaveAttribute('data-turns', turns[key]);
    await expect(board).toHaveAttribute('data-phase', 'roll');
    await expect(panelOf(player.page).locator('.ludo-horse')).toHaveCount(12);
    await expect(panelOf(player.page).locator('.ludo-yard-name')).toHaveText(['Alice', 'Bastien', 'Claire']);
  }
  // L'écurie qui n'a personne (le bleu) est effacée ; les trois joueurs ont leur couleur dans la liste des joueurs.
  await expect(panelOf(alice.page).locator('.ludo-yard[data-color="3"]')).toHaveAttribute('data-unused', 'true');
  await expect(panelOf(alice.page).locator('.game-seat')).toHaveText(['Rouge', 'Vert', 'Jaune']);
  // Celui qui a le trait a un bouton « Lancer le dé » ; les autres n'ont rien.
  const first = stateOf(view).turn;
  const names = ['alice', 'bastien', 'claire'] as const;
  for (const [seat, key] of names.entries()) {
    await expect(panelOf(players[key].page).getByRole('button', { name: 'Lancer le dé' })).toHaveCount(seat === first ? 1 : 0);
  }
  await capture(alice.page, '02-debut-de-partie-440-jour');
});

test('un vrai tour de chacun, avec les dés du serveur : le dé s\'arrête sur la même valeur chez tous, puis un coup, ou le tour qui passe', async () => {
  test.setTimeout(240_000);
  const { alice, bastien, claire } = players;
  const order = [alice, bastien, claire];
  const pages = order.map((player) => player.page);

  for (let turn = 0; turn < 3; turn++) {
    const before = await tableOf(alice.page);
    const seat = stateOf(before).turn;
    const after = await playTurn(order[seat]!.page, pages);
    expect(stateOf(after).turn).not.toBe(seat);
    // Les trois navigateurs voient le même état, et il est légal.
    for (const player of order) {
      await waitForTable(player.page, 'ludo', (next) => next.version === after.version);
      expect(stateOf(await tableOf(player.page))).toEqual(stateOf(after));
    }
    expect(ludo.invariants(stateOf(after))).toEqual([]);
  }
});

test('Claire abandonne en pleine partie : ses chevaux quittent le plateau, son écurie est grisée, et la partie continue à deux', async () => {
  test.setTimeout(120_000);
  const { alice, bastien, claire } = players;
  await panelOf(claire.page).getByRole('button', { name: 'Abandonner' }).click();
  await claire.page.getByRole('alertdialog').getByRole('button', { name: 'Abandonner', exact: true }).click();

  const view = await waitForTable(alice.page, 'ludo', (next) => stateOf(next).out.length === 1);
  const state = stateOf(view);
  const claireSeat = seatOf(view, 'Claire');
  expect(view.match!.status).toBe('playing');
  expect(state.out).toEqual([{ seat: claireSeat, reason: 'resign' }]);
  expect(state.horses[claireSeat]).toEqual([-1, -1, -1, -1]);
  expect(state.turn).not.toBe(claireSeat);
  expect(ludo.invariants(state)).toEqual([]);

  for (const player of [alice, bastien, claire]) {
    const panel = panelOf(player.page);
    await expect(panel.locator('.ludo-yard[data-color="2"]')).toHaveAttribute('data-out', 'true');
    await expect(panel.locator('.ludo-yard[data-color="2"]')).toContainText('sorti');
    await expect(panel.locator(`.ludo-horse[data-seat="${claireSeat}"]`)).toHaveCount(0);
  }
  // Le lecteur d'écran l'entend, et la partie ne s'arrête pas : celui qui a le trait peut lancer le dé.
  await expect(panelOf(bastien.page).locator('[aria-live="polite"]')).toContainText('Claire abandonne : ses chevaux quittent le plateau.');
  const next = [alice, bastien][state.turn === seatOf(view, 'Alice') ? 0 : 1]!;
  await expect(panelOf(next.page).getByRole('button', { name: 'Lancer le dé' })).toBeVisible();
  // Claire, elle, n'a plus rien à jouer.
  await expect(panelOf(claire.page).locator('.ludo-roll, .ludo-move')).toHaveCount(0);
  await capture(claire.page, '03-apres-l-abandon-vue-de-claire-440-jour');
});

test('une partie en cours vue d\'Alice : les coups possibles, le survol d\'un coup, et le plateau de jour comme de nuit (captures à 440 px)', async () => {
  test.setTimeout(120_000);
  const { alice, bastien, claire } = players;
  const view = await tableOf(alice.page);
  const aliceSeat = seatOf(view, 'Alice');
  // Alice a tiré un 6 : sortir un cheval qui prend (un cheval de Bastien est sur sa case de départ), avancer, arriver ; Bastien a un cheval qui vient d'être joué, un autre arrivé ; Claire est sortie.
  const state = fabricate(
    view,
    { Alice: [-1, 10, 50, 3], Bastien: [39, 20, 56, -1] },
    { turn: aliceSeat, die: 6, sixes: 1, moves: 24, out: [{ seat: seatOf(view, 'Claire'), reason: 'resign' }], last: { seat: seatOf(view, 'Bastien'), horse: 1, from: 14, to: 20 } },
  );
  await debugGame(alice.page, 'ludo', state);
  const panel = panelOf(alice.page);
  await expect(panel.locator('.ludo-move')).toHaveText(['Sortir un cheval, prise !', 'Cheval 2 : avancer de 6', 'Cheval 3 : arrivée', 'Cheval 4 : avancer de 6']);
  await expect(panel.getByRole('img', { name: 'Dé : 6' })).toBeVisible();
  await expect(panel.locator('.ludo-mark')).toHaveText(['1er six']);
  await expect(panel.locator('.ludo-horse[data-playable="true"]')).toHaveCount(4);
  // Les autres voient le même plateau (sept chevaux dessinés : les quatre d'Alice, trois de Bastien, dont le quatrième est arrivé et n'est plus sur la piste ; Claire n'a plus rien), sans
  // aucun coup à jouer.
  await expect(panel.locator('.ludo-horse')).toHaveCount(7);
  for (const watcher of [bastien, claire]) {
    await expect(panelOf(watcher.page).locator('.ludo-horse')).toHaveCount(7);
    await expect(panelOf(watcher.page).locator('.ludo-move, .ludo-roll, .ludo-hit')).toHaveCount(0);
  }
  expect((await horizontalFit(alice.page)).body).toBeLessThanOrEqual(0);

  // Survoler un coup marque sa case d'arrivée ; la prise se marque autrement (trait plein).
  await panel.locator('.ludo-move').first().hover();
  await expect(panel.locator('.ludo-target[data-capture="true"]')).toHaveCount(1);
  await capture(alice.page, '03-partie-440-jour');
  await capture(alice.page, '03-partie-440-nuit', { night: true });
  await panel.locator('.ludo-move').nth(1).hover();
  await expect(panel.locator('.ludo-target')).toHaveCount(1);
  await expect(panel.locator('.ludo-target[data-capture]')).toHaveCount(0);
  await capture(alice.page, '04-coup-survole-440-jour');
});

test('une fin proche, avec ses dés : le dernier coup est joué à la souris, le classement complet s\'affiche, et les notes changent une fois (+16, 0, −16)', async () => {
  test.setTimeout(180_000);
  const { alice, bastien, claire } = players;
  const view = await tableOf(alice.page);
  const aliceSeat = seatOf(view, 'Alice');
  // Alice a trois chevaux arrivés et un à la case 53 de son allée : un 3 le fait arriver. Bastien en a deux sur la piste (avancées 20 et 21), Claire est sortie ; 24 coups déjà joués : la
  // partie est classée.
  const state = fabricate(view, { Alice: [56, 56, 56, 53], Bastien: [20, 21, -1, -1] }, { turn: aliceSeat, moves: 24, out: [{ seat: seatOf(view, 'Claire'), reason: 'resign' }] });
  await debugGame(alice.page, 'ludo', state, [3]);
  const panel = panelOf(alice.page);
  await panel.getByRole('button', { name: 'Lancer le dé' }).click();
  await expect(panel.getByRole('img', { name: 'Dé : 3' })).toBeVisible();
  await expect(panel.locator('.ludo-move')).toHaveText(['Cheval 4 : arrivée']);

  // Le dernier coup, à la souris : un clic sur le cheval souligné, sur le plateau.
  const horse = panel.locator('.ludo-horse[data-playable="true"]');
  await expect(horse).toHaveCount(1);
  await horse.locator('.ludo-hit').click();

  // La partie est finie pour tous : la phrase de fin, le classement complet (trois lignes, avec les avancées), les trois lignes de notes de la plateforme.
  for (const player of [alice, bastien, claire]) {
    const board = panelOf(player.page);
    await expect(board.locator('.game-status')).toHaveText('Alice a ramené ses quatre chevaux.');
    await expect(board.locator('.ludo-standing')).toHaveText(['1. Alice, rouge : avancée 228 sur 228', '2. Bastien, vert : avancée 43 sur 228', '3. Claire, jaune : a quitté la partie']);
    await expect(board.locator('.game-ratings li')).toHaveText(['Alice : 1200 → 1216 (+16)', 'Bastien : 1200 → 1200 (±0)', 'Claire : 1200 → 1184 (−16)']);
    await expect(board.locator('.ludo-roll, .ludo-move, .ludo-hit')).toHaveCount(0);
  }
  const ended = await waitForTable(alice.page, 'ludo', (next) => next.match?.status === 'ended');
  expect(ended.match!.ranked).toBe(true);
  expect(ended.match!.result).toMatchObject({ reason: 'finished', ranking: [[aliceSeat], [seatOf(ended, 'Bastien')], [seatOf(ended, 'Claire')]] });
  expect(ended.match!.ratings!.map((rating) => [rating.before, rating.after])).toEqual([
    [1200, 1216],
    [1200, 1200],
    [1200, 1184],
  ]);
  await capture(alice.page, '05-fin-440-jour');
  await capture(bastien.page, '05-fin-vue-de-bastien-440-nuit', { night: true });

  // Le classement du jeu a changé une fois, pas deux : trois lignes, chacune avec une seule partie.
  await panel.getByRole('tab', { name: 'Classement' }).click();
  await expect(panel.locator('.ladder-row')).toHaveCount(3);
  await expect(panel.locator('.ladder-row .ladder-rating')).toHaveText(['1216', '1200', '1184']);
  await expect(panel.locator('.ladder-row').first()).toContainText('Alice');
  await panel.getByRole('tab', { name: 'Partie' }).click();
});

test('la revanche, vue sur un téléphone de 375 px : Bastien joue par la liste des coups, sans défilement horizontal, avec des boutons de 44 px de haut', async () => {
  test.setTimeout(180_000);
  const { alice, bastien, claire } = players;
  // Revanche : les trois se disent prêts de nouveau (Claire, qui avait abandonné, est toujours assise).
  for (const player of [alice, bastien, claire]) await readyButton(player.page, 'ludo').click();
  const view = await waitForTable(alice.page, 'ludo', (next) => next.match?.status === 'playing');
  expect(stateOf(view).moves).toBe(0);
  expect(stateOf(view).out).toEqual([]);
  const bastienSeat = seatOf(view, 'Bastien');
  // Un coup à choisir : Bastien a tiré un 4, deux de ses chevaux peuvent jouer.
  const state = fabricate(view, { Alice: [10, -1, -1, -1], Bastien: [5, 30, -1, -1] }, { turn: bastienSeat, die: 4, moves: 6 });
  await debugGame(bastien.page, 'ludo', state);

  await bastien.page.setViewportSize(PHONE);
  const panel = panelOf(bastien.page);
  await expect(panel.locator('.ludo-move')).toHaveText(['Cheval 1 : avancer de 4', 'Cheval 2 : avancer de 4']);
  await expect(panel.getByRole('img', { name: 'Dé : 4' })).toBeVisible();

  // Sans défilement horizontal : ni la page, ni le corps du panneau ; le plateau est tout entier dans le panneau, en cases entières, ni trop petit ni rogné.
  const fit = await horizontalFit(bastien.page);
  expect(fit.page).toBeLessThanOrEqual(0);
  expect(fit.body).toBeLessThanOrEqual(0);
  expect(fit.bodyRight).toBeLessThanOrEqual(fit.viewport);
  expect(fit.boardLeft).toBeGreaterThanOrEqual(fit.bodyLeft);
  expect(fit.boardRight).toBeLessThanOrEqual(fit.bodyRight);
  const cell = Number(await panel.locator('.game-ludo').getAttribute('data-cell'));
  expect(cell).toBeGreaterThanOrEqual(18);
  const board = await panel.locator('svg.ludo-board').boundingBox();
  expect(board!.width).toBe(15 * cell);
  // La liste des coups est le chemin du téléphone : des boutons de 44 px de haut au moins, bien plus que les 24 px que demande l'accessibilité ; les chevaux jouables, eux, ont une cible
  // d'au moins 24 px, même sur des cases de 20 px.
  for (const button of await panel.locator('.ludo-move').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const hit of await panel.locator('.ludo-hit').all()) {
    const box = (await hit.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }

  // Au clavier, les flèches passent d'un coup à l'autre, et l'avatar reste où il est (elles le feraient marcher partout ailleurs sur la page).
  const standing = await selfAt(bastien.page);
  await panel.locator('.ludo-move').first().focus();
  await bastien.page.keyboard.press('ArrowDown');
  await expect(panel.locator('.ludo-move').nth(1)).toBeFocused();
  await bastien.page.keyboard.press('ArrowRight');
  await bastien.page.keyboard.press('ArrowUp');
  await expect(panel.locator('.ludo-move').first()).toBeFocused();
  await bastien.page.waitForTimeout(400);
  expect(await selfAt(bastien.page)).toEqual(standing);

  // Ce que voit la personne : l'écran du téléphone, la feuille du bas défilée jusqu'au plateau (le plateau, puis le dé, puis les coups).
  await bastien.page.evaluate(() => {
    const body = document.querySelector('.game-drawer .drawer-body') as HTMLElement;
    const svg = document.querySelector('.game-drawer svg.ludo-board') as SVGElement;
    body.scrollTop += svg.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
  });
  await captureScreen(bastien.page, '06-partie-375-ecran-jour');
  await setTheme(bastien.page, 'night');
  await captureScreen(bastien.page, '06-partie-375-ecran-nuit');
  await setTheme(bastien.page, 'day');
  // Tout le panneau d'un coup, sur un écran de la même largeur, mais haut.
  await bastien.page.setViewportSize(PHONE_TALL);
  await capture(bastien.page, '07-partie-375-panneau-jour');
  await capture(bastien.page, '07-partie-375-panneau-nuit', { night: true });
  await bastien.page.setViewportSize(PHONE);

  // Il joue le second coup, du bout du doigt : le cheval 2 passe de 30 à 34, et le trait passe à la suivante.
  await panel.locator('.ludo-move').nth(1).click();
  const played = await waitForTable(bastien.page, 'ludo', (next) => stateOf(next).moves === 7);
  expect(stateOf(played).horses[bastienSeat]).toEqual([5, 34, -1, -1]);
  expect(stateOf(played).turn).toBe((bastienSeat + 1) % 3);
  await expect(panel.locator('.ludo-move')).toHaveCount(0);
  await expect(panel.locator('.ludo-roll')).toHaveCount(0);
  await bastien.page.setViewportSize(PHONE_TALL);
  await capture(bastien.page, '08-apres-le-coup-375-panneau-jour');
});
