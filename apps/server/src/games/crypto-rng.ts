import { randomInt } from 'node:crypto';
import type { Rng } from '@bureau/shared';

// Le hasard des vraies parties : les dés et le premier joueur sont tirés ici, côté serveur, avec le générateur du système (jamais Math.random, jamais le client).
// `randomInt(2 ** 47)` : Node exige un écart inférieur à 2⁴⁸ (`randomInt(2 ** 48)` lèverait). Ce fichier n'entre jamais dans `packages/shared`, que le client compile.
const RANGE = 2 ** 47;

export const cryptoRng: Rng = () => randomInt(RANGE) / RANGE;
