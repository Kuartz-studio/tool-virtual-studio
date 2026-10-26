import { expect, type Locator, type Page } from '@playwright/test';
import { selfAt, teleportTo } from './helpers';

// Ce qu'il faut aux tests de bout en bout des jeux (jeux-plateforme.spec.ts et un spec par jeu), sur la vraie carte : les tables en pixels, la vue que le magasin a d'une table,
// aller s'asseoir ou regarder, ouvrir le panneau d'une table, fabriquer une fin de partie. Chaque spec de jeu ne touche qu'à sa table (les quatre jeux ne se gênent pas), avec
// des comptes neufs (joinOffice).

export type GameId = 'chess' | 'backgammon' | 'connect4' | 'ludo';

// Le nom du panneau de chaque jeu (celui de son `complementary`).
export const GAME_LABELS: Record<GameId, string> = { chess: 'Échecs', backgammon: 'Backgammon', connect4: 'Puissance 4', ludo: 'Petits chevaux' };

export interface TableInfo {
  game: string;
  x: number;
  y: number;
  width: number;
  height: number;
  seats: Array<{ x: number; y: number }>;
}

// Les tables de la carte, en pixels (window.__office.tables).
export function tables(page: Page): Promise<TableInfo[]> {
  return page.evaluate(() => window.__office!.tables());
}

export async function tableInfo(page: Page, game: GameId): Promise<TableInfo> {
  const found = (await tables(page)).find((table) => table.game === game);
  if (!found) throw new Error(`La carte n'a pas de table de ${game}.`);
  return found;
}

// La vue que le magasin de cette page a de la table (celle du serveur : chaises, spectateurs, partie), ou null (window.__office.gameTable).
export interface TableView {
  game: GameId;
  version: number;
  chairs: Array<{ userId: string; name: string; ready: boolean; connected: boolean } | null>;
  spectators: Array<{ id: string; name: string }>;
  match: null | {
    id: string;
    status: 'playing' | 'ended';
    players: Array<{ userId: string; name: string; connected: boolean }>;
    first: number;
    state: unknown;
    result: null | { ranking: number[][]; reason: string; detail?: unknown };
    ranked: boolean | null;
    ratings: Array<{ userId: string; before: number; after: number }> | null;
    drawOffer: number | null;
  };
}

export function gameTable(page: Page, game: GameId): Promise<TableView | null> {
  return page.evaluate((id) => (window.__office!.gameTable(id) as TableView | null) ?? null, game);
}

// Attend que la table de cette page réponde à cette condition (relue sur la vue du magasin).
export async function waitForTable(page: Page, game: GameId, check: (view: TableView) => boolean, timeout = 15_000): Promise<TableView> {
  let last: TableView | null = null;
  try {
    await expect
      .poll(
        async () => {
          last = await gameTable(page, game);
          return last !== null && check(last);
        },
        { timeout },
      )
      .toBe(true);
  } catch (error) {
    // Le message se construit ici, une fois l'attente finie : dans les options du sondage, il aurait été figé avant la première lecture (« null »).
    throw new Error(`La table de ${game} n'a pas pris l'état attendu : ${JSON.stringify(last)}`, { cause: error });
  }
  return last!;
}

// Fabrique l'état d'une partie en cours (window.__office.debugGame : `debug:game`, que le serveur n'accepte qu'avec E2E=1), et impose les prochains dés.
export function debugGame(page: Page, game: GameId, state: unknown, rolls?: number[]): Promise<void> {
  return page.evaluate(({ id, value, dice }) => window.__office!.debugGame(id, value, dice), { id: game, value: state, dice: rolls });
}

// Pose l'avatar sur la chaise n de cette table (le vrai serveur accepte la téléportation de débogage si la case est praticable), arrêté.
export async function goToChair(page: Page, game: GameId, chair = 0): Promise<void> {
  const table = await tableInfo(page, game);
  const seat = table.seats[chair];
  if (!seat) throw new Error(`La table de ${game} n'a pas de chaise ${chair}.`);
  await teleportTo(page, seat);
}

// Le panneau de ce jeu, ouvert (le `complementary` nommé comme le jeu).
export function gamePanel(page: Page, game: GameId): Locator {
  return page.getByRole('complementary', { name: GAME_LABELS[game], exact: true });
}

// Ouvre le panneau de la table : la touche E, devant elle. Rend le panneau, une fois visible.
export async function openTableWithKey(page: Page, game: GameId): Promise<Locator> {
  await page.keyboard.press('e');
  const panel = gamePanel(page, game);
  await expect(panel).toBeVisible();
  return panel;
}

// S'asseoir à la chaise n de ce panneau (le vrai bouton « S'asseoir à la chaise n »), et attendre que le serveur l'ait confirmé.
export async function sitAt(page: Page, game: GameId, chair: number): Promise<void> {
  await gamePanel(page, game).getByRole('button', { name: `S'asseoir à la chaise ${chair + 1}`, exact: true }).click();
  await waitForTable(page, game, (view) => view.chairs[chair] !== null);
}

// « Prêt », le bouton à bascule de sa chaise ; après une partie, « Revanche », sous la phrase de fin.
export function readyButton(page: Page, game: GameId): Locator {
  return gamePanel(page, game).getByRole('button', { name: /^(Prêt|Revanche)$/ });
}

// Où est l'avatar : dans la salle de jeu (la place `game` de la carte), à deux cases au plus de la table.
export async function expectNearTable(page: Page, game: GameId, slackTiles = 3): Promise<void> {
  const table = await tableInfo(page, game);
  const feet = await selfAt(page);
  const margin = slackTiles * 32;
  expect(feet.x).toBeGreaterThanOrEqual(table.x - margin);
  expect(feet.x).toBeLessThanOrEqual(table.x + table.width + margin);
  expect(feet.y).toBeGreaterThanOrEqual(table.y - margin);
  expect(feet.y).toBeLessThanOrEqual(table.y + table.height + margin);
}
