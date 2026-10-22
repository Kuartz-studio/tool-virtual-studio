import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { HORSE_ROWS } from './horse-art';
import { SEAT_COLORS } from './palette';

// La feuille de style des petits chevaux (§ 12.4 et § 9.5 du document des jeux), lue telle qu'elle est écrite : happy-dom ne calcule pas les styles d'une feuille, le test lit ses
// déclarations, qui sont ce que le navigateur appliquerait (comme office/ui/tokens.test.ts).

const source = readFileSync(resolve(import.meta.dirname, 'ludo.css'), 'utf8');
const styles = readFileSync(resolve(import.meta.dirname, '../../styles.css'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selector: string;
  body: string;
  // La règle @ qui la contient (@media…), ou null.
  within: string | null;
}

// Les règles de la feuille, à plat : un sélecteur (ou plusieurs, séparés par des virgules), son corps, et le @media qui l'enveloppe. Une règle @ sans règles dedans (@keyframes, @font-face)
// est rendue comme une règle dont le sélecteur est son en-tête.
function parse(text: string, within: string | null = null): Rule[] {
  const rules: Rule[] = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('{', at);
    if (open === -1) break;
    const head = text.slice(at, open).trim();
    let depth = 1;
    let end = open + 1;
    while (end < text.length && depth > 0) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}') depth--;
      end++;
    }
    const body = text.slice(open + 1, end - 1);
    if (/^@(media|supports|container)/.test(head)) rules.push(...parse(body, head));
    else rules.push({ selector: head, body, within });
    at = end;
  }
  return rules;
}

const rules = parse(css);
const declarations = (body: string): Map<string, string> => new Map([...body.matchAll(/(?:^|;|\n)\s*([-\w]+)\s*:\s*([^;]+?)\s*(?=;|$)/g)].map((m) => [m[1]!, m[2]!] as const));
const ruleFor = (selector: string): Map<string, string> => {
  const found = rules.find((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector));
  if (!found) throw new Error(`Pas de règle « ${selector} » dans ludo.css.`);
  return declarations(found.body);
};
const px = (value: string | undefined): number => Number(/^([\d.]+)px$/.exec(value ?? '')?.[1] ?? Number.NaN);

describe('§ 12.4 : rien ici n\'est global', () => {
  test('la feuille a des règles, et tous les sélecteurs commencent par .game-ludo', () => {
    expect(rules.length).toBeGreaterThan(40);
    for (const rule of rules) {
      for (const selector of rule.selector.split(',').map((part) => part.trim())) expect(selector.startsWith('.game-ludo'), selector).toBe(true);
    }
  });

  test('ni :root, ni html, ni body, ni sélecteur universel (un nom de classe peut contenir « body »), ni @import, ni @font-face', () => {
    for (const rule of rules) expect(rule.selector).not.toMatch(/:root|(^|[\s>+~,])(html|body|\*)(?![\w-])/);
    expect(css).not.toMatch(/@import|@font-face/);
  });

  test('les variables déclarées sont locales (--ludo-… ou --tone…), et aucune ne redit un jeton de styles.css', () => {
    const mine = [...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!);
    expect(mine.length).toBeGreaterThan(20);
    for (const name of mine) expect(/^--(ludo|tone)(-|$)/.test(name), name).toBe(true);
    const tokens = new Set([...styles.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!));
    for (const name of mine) expect(tokens.has(name), `${name} existe déjà dans styles.css`).toBe(false);
  });

  test('les variables lues dans la feuille existent : celles du plateau, ou des jetons de styles.css', () => {
    const mine = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!));
    const tokens = new Set([...styles.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!));
    for (const [, name] of css.matchAll(/var\((--[\w-]+)/g)) expect(mine.has(name!) || tokens.has(name!), name).toBe(true);
  });
});

describe('§ 9.5 : ce que tout plateau respecte', () => {
  test('pas de backdrop-filter, pas de position: fixed, pas d\'image (url()), pas de unité de fenêtre', () => {
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/position\s*:\s*fixed/);
    expect(css).not.toMatch(/url\(/);
    expect(css).not.toMatch(/\b\d+(\.\d+)?(vw|vh|vmin|vmax|dvw|dvh|svw|svh)\b/);
  });

  test('le plateau se mesure sur son conteneur : aucune règle ne dépend de la largeur de la fenêtre (@media)', () => {
    for (const rule of rules) expect(rule.within, rule.selector).toBeNull();
  });

  test('9.5.1 : le plateau n\'est jamais plus large que son conteneur, et son dessin est net (image-rendering: pixelated)', () => {
    const board = ruleFor('.game-ludo .ludo-board');
    expect(board.get('max-width')).toBe('100%');
    expect(board.get('image-rendering')).toBe('pixelated');
    expect(ruleFor('.game-ludo').get('min-width')).toBe('0');
  });

  test('9.5.2 : la liste des coups et le lancer font 44 px de haut au moins, bien au-delà des 24 px du WCAG', () => {
    const variables = ruleFor('.game-ludo');
    expect(px(variables.get('--ludo-touch'))).toBeGreaterThanOrEqual(44);
    expect(ruleFor('.game-ludo .ludo-move').get('min-height')).toBe('var(--ludo-touch)');
    expect(ruleFor('.game-ludo .ludo-roll').get('min-height')).toBe('var(--ludo-touch)');
    expect(ruleFor('.game-ludo .ludo-move').get('width')).toBe('100%');
    expect(px(variables.get('--ludo-die-size'))).toBeGreaterThanOrEqual(24);
  });

  test('9.5.5 : un cheval saute (sa place change d\'un coup) : sa règle ne donne aucune durée, Board.tsx en donne une au seul cheval qu\'on prend', () => {
    const horse = ruleFor('.game-ludo .ludo-horse');
    expect(horse.get('transition-property')).toBe('transform');
    expect(horse.has('transition-duration')).toBe(false);
    expect(horse.has('transition')).toBe(false);
    expect(css).not.toMatch(/@keyframes|animation\s*:/);
  });

  test('9.5.6 : la palette de l\'illustration est celle des pastilles (SEAT_COLORS), et ne change pas la nuit', () => {
    const variables = ruleFor('.game-ludo');
    expect(['--ludo-red', '--ludo-green', '--ludo-yellow', '--ludo-blue'].map((name) => variables.get(name))).toEqual([...SEAT_COLORS]);
    expect(styles).not.toContain('.game-ludo');
    for (const rule of rules) expect(rule.selector).not.toMatch(/data-theme/);
  });

  test('chaque lettre de la tête de cheval a sa couleur (.px-<lettre>), et chaque couleur de 0 à 3 ses quatre teintes', () => {
    const letters = new Set(HORSE_ROWS.join('').replaceAll('.', ''));
    for (const letter of letters) expect(ruleFor(`.game-ludo .px-${letter}`).has('fill'), letter).toBe(true);
    for (const color of [0, 1, 2, 3]) {
      const tone = ruleFor(`.game-ludo .ludo-tone-${color}`);
      for (const name of ['--tone', '--tone-light', '--tone-dark', '--tone-soft']) expect(tone.has(name), `${color} ${name}`).toBe(true);
    }
  });

  test('le surlignage contraste à 3 contre 1 avec les cases du plateau [WCAG 1.4.11], et une prise se marque autrement que par la couleur', () => {
    const variables = ruleFor('.game-ludo');
    const luminance = (hex: string): number => {
      const channel = (offset: number) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    const contrast = (a: string, b: string): number => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high! + 0.05) / (low! + 0.05);
    };
    const highlight = variables.get('--ludo-focus')!;
    // Les cases sur lesquelles le surlignage se pose : le papier, les teintes douces, et les couleurs pleines (départs, arrivées).
    const cells = ['--ludo-paper', '--ludo-board', '--ludo-red', '--ludo-green', '--ludo-yellow', '--ludo-blue', '--ludo-red-soft', '--ludo-green-soft', '--ludo-yellow-soft', '--ludo-blue-soft'];
    for (const name of cells) expect(contrast(highlight, variables.get(name)!), name).toBeGreaterThanOrEqual(3);
    const step = ruleFor('.game-ludo .ludo-target');
    const capture = ruleFor('.game-ludo .ludo-target[data-capture]');
    expect(step.get('stroke-dasharray')).not.toBe('none');
    expect(capture.get('stroke-dasharray')).toBe('none');
    expect(px(capture.get('stroke-width')?.replace(/$/, 'px'))).toBeGreaterThan(px(step.get('stroke-width')?.replace(/$/, 'px')));
  });

  test('le trait est marqué par un cadre plus épais autour de l\'écurie, et un dé sans valeur est estompé', () => {
    const turn = ruleFor('.game-ludo .ludo-yard[data-turn] .ludo-yard-bg');
    expect(Number(turn.get('stroke-width'))).toBeGreaterThan(Number(ruleFor('.game-ludo .ludo-yard-bg').get('stroke-width')));
    expect(Number(ruleFor('.game-ludo .ludo-die:not([data-value])').get('opacity'))).toBeLessThan(1);
  });
});
