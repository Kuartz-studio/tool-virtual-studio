import { GAME_TABLE_REACH_TILES, TILE_SIZE, buildOfficeTiledMap, parseOfficeMap, type GameTable } from '@bureau/shared';
import { describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { GAME_PANEL_WIDTH_PX, gameTableTarget, tableFocus } from './game-tables';
import { Interactions } from './interactions';

const map = parseOfficeMap(buildOfficeTiledMap());
const chess = map.tables.find((table) => table.game === 'chess')!;
const centre = (table: GameTable) => ({ x: table.rect.x + table.rect.width / 2, y: table.rect.y + table.rect.height / 2 });

const state = (over: Partial<{ seated: boolean; playing: boolean }> = {}) => ({ seated: false, playing: false, ...over });

describe('gameTableTarget : la table, cible de la touche E', () => {
  test('« [E] Échecs : jouer » ; une partie en cours à laquelle on ne joue pas : « regarder la partie »', () => {
    let current = state();
    const target = gameTableTarget(chess, () => current, () => {});
    expect(target.prompt()).toBe('[E] Échecs : jouer');
    current = state({ playing: true });
    expect(target.prompt()).toBe(t(fr.games.prompt, { game: 'Échecs', action: fr.games.watch }));
    // Assis à la table, c'est toujours « jouer » : on y est pour jouer.
    current = state({ playing: true, seated: true });
    expect(target.prompt()).toBe(t(fr.games.prompt, { game: 'Échecs', action: fr.games.play }));
  });

  test('chaque jeu a son nom', () => {
    for (const table of map.tables) expect(gameTableTarget(table, () => state(), () => {}).prompt()).toContain(fr.games.names[table.game]);
  });

  test('l\'étiquette se pose au-dessus de la table, au milieu', () => {
    const target = gameTableTarget(chess, () => state(), () => {});
    expect(target.labelAt!.x).toBe(centre(chess).x);
    expect(target.labelAt!.y).toBeLessThan(chess.rect.y);
    expect(target.pos).toEqual(centre(chess));
    expect(target.id).toBe('game:chess');
  });

  test('actionnée, elle demande l\'ouverture de la table', () => {
    const open = vi.fn();
    gameTableTarget(chess, () => state(), open).use();
    expect(open).toHaveBeenCalledOnce();
  });

  test('la portée se compte depuis le bord de la table : à GAME_TABLE_REACH_TILES cases de son bord (et ses chaises), on peut jouer ; à quatre cases de plus, non', () => {
    const interactions = new Interactions();
    const target = gameTableTarget(chess, () => state(), () => {});
    interactions.register(target);
    const reach = GAME_TABLE_REACH_TILES * TILE_SIZE;
    // Près de chaque côté de la table : à 2 cases du bord.
    const right = { x: chess.rect.x + chess.rect.width + reach - 1, y: centre(chess).y };
    const left = { x: chess.rect.x - reach + 1, y: centre(chess).y };
    const above = { x: centre(chess).x, y: chess.rect.y - reach + 1 };
    const below = { x: centre(chess).x, y: chess.rect.y + chess.rect.height + reach - 1 };
    for (const feet of [right, left, above, below]) expect(interactions.update(feet), JSON.stringify(feet)).toBe(target);
    for (const seat of chess.seats) expect(interactions.update(seat)).toBe(target);
    // Loin : à quatre cases du bord.
    expect(interactions.update({ x: chess.rect.x + chess.rect.width + 4 * TILE_SIZE, y: centre(chess).y })).toBeNull();
    expect(interactions.update({ x: centre(chess).x, y: chess.rect.y - 5 * TILE_SIZE })).toBeNull();
  });

  test('deux tables voisines : la plus proche répond', () => {
    const [first, second] = [map.tables.find((table) => table.game === 'chess')!, map.tables.find((table) => table.game === 'backgammon')!];
    const interactions = new Interactions();
    const a = gameTableTarget(first, () => state(), () => {});
    const b = gameTableTarget(second, () => state(), () => {});
    interactions.register(a);
    interactions.register(b);
    expect(interactions.update(centre(first))).toBe(a);
    expect(interactions.update(centre(second))).toBe(b);
  });
});

describe('tableFocus : où la caméra se centre pour montrer la table', () => {
  const rect = { x: 768, y: 1120, width: 96, height: 64 };

  test('sur un écran large, la table est dans la partie que le panneau (à droite) laisse libre : le centre est décalé de la moitié du panneau, vers la droite', () => {
    const [x, y] = tableFocus(rect, 2, { width: 1280, height: 800 });
    expect(x).toBe(816 + GAME_PANEL_WIDTH_PX / 2 / 2);
    expect(y).toBe(1152);
  });

  test('plus on zoome, moins le décalage compte en pixels de la carte', () => {
    const [near] = tableFocus(rect, 4, { width: 1280, height: 800 });
    const [far] = tableFocus(rect, 1, { width: 1280, height: 800 });
    expect(near).toBeLessThan(far);
    expect(near - 816).toBeCloseTo(GAME_PANEL_WIDTH_PX / 2 / 4, 5);
  });

  test('sur un téléphone, le panneau est une feuille en bas : la table monte dans le tiers du haut (le centre descend)', () => {
    const [x, y] = tableFocus(rect, 2, { width: 400, height: 800 });
    expect(x).toBe(816);
    expect(y).toBeGreaterThan(1152);
  });
});
