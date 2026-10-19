// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEV_AVATAR_KEYS, DIRECTIONS } from '@bureau/shared';
import { PNG } from 'pngjs';
import { expect, test } from 'vitest';
import { AVATARS } from '../src/game/avatars';
import { ASSETS_DIR } from './gen-dev-assets';

// Le registre des avatars (src/game/avatars.ts) décrit des planches commitées : le Preloader les charge à l'adresse du registre,
// avec la taille d'image du registre, et chaque animation prend ses images dans la planche.
test.each(DEV_AVATAR_KEYS)('%s : l\'adresse du registre est celle de la planche commitée, découpée en images de la taille du registre', (key) => {
  const spec = AVATARS[key];
  // L'adresse est celle du site (/assets/dev/avatars/…) ; les fichiers sont dans public/.
  const sheet = PNG.sync.read(readFileSync(resolve(ASSETS_DIR, '..', `.${spec.url}`)));

  expect([sheet.width % spec.frameWidth, sheet.height % spec.frameHeight], 'la planche est un nombre entier d\'images').toEqual([0, 0]);
  const frames = (sheet.width / spec.frameWidth) * (sheet.height / spec.frameHeight);
  expect(frames).toBe(12);

  const used = DIRECTIONS.flatMap((dir) => [...spec.idle[dir], ...spec.walk[dir]]);
  expect(Math.min(...used)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...used)).toBeLessThan(frames);
});
