import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_OFFICE, buildTiledMap } from '@bureau/shared';
import { onTestFinished } from 'vitest';
import type { Env } from '../../src/env';

// La carte de développement, avec un interrupteur de lumière : celle des tests de la lumière. La vraie carte de développement n'en a pas
// (les tests de bout en bout lisent ses pixels, qu'une plaque au mur changerait), et seule la grande carte (office) reçoit le sien.
//
// L'interrupteur est la case (13, 5), un mur de la grande pièce du bas (les portes sont aux cases 3, 10 et 18) : son centre est en
// (432, 176) en pixels. La personne se tient dans la pièce, au sud du mur.
export const SWITCH_TILE = { x: 13, y: 5 } as const;
export const SWITCH_AT = { x: 13 * 32 + 16, y: 5 * 32 + 16 } as const;
// À 2 cases de l'interrupteur : à portée. Le point d'apparition de la carte (80, 240), lui, en est à plus de 11 cases.
export const NEAR_SWITCH = { x: SWITCH_AT.x, y: SWITCH_AT.y + 2 * 32 } as const;

// Écrit la carte dans un dossier à part (supprimé à la fin du test) et rend les variables d'environnement qui la désignent :
// startTestServer({ env: { ...withSwitchMap() } }). À appeler depuis un test.
export function withSwitchMap(): Pick<Env, 'MAPS_DIR' | 'MAP_KEY'> {
  const dir = mkdtempSync(join(tmpdir(), 'bureau-lights-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const zones = [...DEV_OFFICE.zones, { type: 'switch' as const, x: SWITCH_TILE.x, y: SWITCH_TILE.y, w: 1, h: 1 }];
  const json = buildTiledMap({ ascii: DEV_OFFICE.ascii, zones, tileset: { name: 'dev', image: '../dev/tiles.png' } });
  writeFileSync(join(dir, 'switch-office.json'), JSON.stringify(json));
  return { MAPS_DIR: dir, MAP_KEY: 'switch-office' };
}
