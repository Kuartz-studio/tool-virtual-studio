import { describe, expect, test } from 'vitest';
import { GAMES, GAME_IDS } from './index';

describe('le registre des jeux', () => {
  test('chaque entrée a un identifiant connu, unique, égal à sa clé, et des bornes de joueurs cohérentes avec sa table', () => {
    const seen = new Set<string>();
    for (const [key, definition] of Object.entries(GAMES)) {
      expect(GAME_IDS as readonly string[]).toContain(key);
      expect(definition!.id).toBe(key);
      expect(seen.has(definition!.id)).toBe(false);
      seen.add(definition!.id);
      expect(definition!.minPlayers).toBeGreaterThanOrEqual(1);
      expect(definition!.maxPlayers).toBeGreaterThanOrEqual(definition!.minPlayers);
      expect(definition!.maxPlayers).toBeLessThanOrEqual(4);
      expect(typeof definition!.label).toBe('string');
      // La nulle par accord s'accompagne de sa fonction.
      if (definition!.drawOffers) expect(typeof definition!.agreeDraw).toBe('function');
    }
  });

  test('chaque jeu qui y figure a une table sur la carte, avec autant de chaises qu\'il a de joueurs au plus', async () => {
    const { buildOfficeTiledMap } = await import('../map/office');
    const { parseOfficeMap } = await import('../map/parse-map');
    const map = parseOfficeMap(buildOfficeTiledMap());
    for (const definition of Object.values(GAMES)) {
      const table = map.tables.find((candidate) => candidate.game === definition!.id);
      expect(table, `la carte n'a pas de table pour ${definition!.id}`).toBeDefined();
      expect(table!.seats.length).toBeGreaterThanOrEqual(definition!.maxPlayers);
    }
  });

  test('la liste des jeux de la carte est celle de GAME_IDS : les quatre noms de zones', () => {
    expect([...GAME_IDS]).toEqual(['chess', 'backgammon', 'connect4', 'ludo']);
  });
});
