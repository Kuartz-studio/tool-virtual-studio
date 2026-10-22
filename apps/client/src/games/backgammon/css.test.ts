import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// La feuille du jeu (§ 12.4 du document des jeux) : tous ses sélecteurs commencent par `.game-backgammon`, elle ne lit que les jetons qui existent dans `styles.css` et ses propres
// variables (la palette de l'illustration, déclarée sur `.game-backgammon`), et elle ne redéfinit aucun jeton, ni `:root`, ni un élément nu. happy-dom ne calcule pas les styles :
// le test lit les déclarations de la feuille, qui sont ce que le navigateur appliquerait.

const own = readFileSync(resolve(import.meta.dirname, 'backgammon.css'), 'utf8');
const platform = readFileSync(resolve(import.meta.dirname, '../../styles.css'), 'utf8');

interface Rule {
  selectors: string[];
  body: string;
  // Le bloc `@media` ou `@supports` qui la contient, s'il y en a un.
  within: string | null;
}

// Un découpage de feuille de style assez bon pour celle-ci : des règles, éventuellement dans un @media. Les commentaires sont retirés d'abord.
function parse(css: string): { rules: Rule[]; keyframes: string[] } {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const keyframes: string[] = [];
  const walk = (from: number, to: number, within: string | null): void => {
    let index = from;
    while (index < to) {
      const open = text.indexOf('{', index);
      if (open === -1 || open >= to) break;
      const prelude = text.slice(index, open).trim();
      let depth = 1;
      let close = open + 1;
      while (depth > 0 && close < to) {
        if (text[close] === '{') depth++;
        else if (text[close] === '}') depth--;
        close++;
      }
      const body = text.slice(open + 1, close - 1);
      if (prelude.startsWith('@keyframes')) keyframes.push(prelude.replace('@keyframes', '').trim());
      else if (prelude.startsWith('@media') || prelude.startsWith('@supports')) walk(open + 1, close - 1, prelude);
      else rules.push({ selectors: prelude.split(',').map((selector) => selector.trim()), body, within });
      index = close;
    }
  };
  walk(0, text.length, null);
  return { rules, keyframes };
}

const sheet = parse(own);
const tokens = new Set([...platform.slice(platform.indexOf(':root {'), platform.indexOf('}', platform.indexOf(':root {'))).matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]!));

describe('backgammon.css', () => {
  test('la feuille a des règles (le test ne passe pas à vide)', () => {
    expect(sheet.rules.length).toBeGreaterThan(20);
    expect(tokens.size).toBeGreaterThan(20);
    expect(tokens.has('--surface')).toBe(true);
  });

  test('tous les sélecteurs commencent par `.game-backgammon` (la classe racine, ou une classe de ce nom suivie d\'un suffixe) : jamais `:root`, jamais un élément nu, jamais un sélecteur d\'un autre jeu ou de la plateforme', () => {
    for (const rule of sheet.rules) {
      for (const selector of rule.selectors) {
        expect(selector, `« ${selector} »`).toMatch(/^\.game-backgammon/);
        expect(selector, `« ${selector} »`).not.toContain(':root');
      }
    }
  });

  test('les sélecteurs composés restent sous `.game-backgammon` : chaque morceau d\'un sélecteur descendant est une classe, un attribut, un pseudo ou l\'élément d\'un descendant précis', () => {
    for (const rule of sheet.rules) {
      for (const selector of rule.selectors) {
        // Aucun sélecteur universel nu, ni `body`, `html`, `button` en tête d'un morceau (hors du premier, qui est `.game-backgammon`).
        expect(selector, selector).not.toMatch(/(^|[\s>+~])(\*|html|body)(?![\w-])/);
      }
    }
  });

  test('aucun jeton de la plateforme n\'est redéfini : les variables déclarées ici sont les siennes, et elles sont déclarées sur `.game-backgammon` seulement', () => {
    for (const rule of sheet.rules) {
      for (const [, name] of rule.body.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
        expect(tokens.has(name!), `${name} existe déjà dans styles.css : il ne se redéfinit pas`).toBe(false);
        expect(rule.selectors, `${name} se déclare sur .game-backgammon`).toEqual(['.game-backgammon']);
      }
    }
  });

  test('chaque `var(--…)` lue est un jeton de styles.css ou une variable de la feuille : rien d\'inventé', () => {
    const local = new Set([...own.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]!));
    expect(local.size).toBeGreaterThan(8);
    for (const [, name] of own.matchAll(/var\((--[\w-]+)/g)) expect(tokens.has(name!) || local.has(name!), `${name} n'est ni un jeton ni une variable locale`).toBe(true);
  });

  test('la palette de l\'illustration est la même le jour et la nuit : aucune règle de nuit ne la redit', () => {
    expect(own).not.toContain('data-theme');
    expect(own).not.toContain('prefers-color-scheme');
  });

  test('pas de `backdrop-filter`, pas de `position: fixed`, pas de `!important` (le cadre défile, la plateforme garde la main)', () => {
    const code = own.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('backdrop-filter');
    expect(code).not.toMatch(/position:\s*fixed/);
    expect(code).not.toContain('!important');
  });

  test('les animations de la feuille (s\'il y en a) portent un nom du jeu : les noms de @keyframes sont globaux', () => {
    for (const name of sheet.keyframes) expect(name).toMatch(/^game-backgammon-/);
  });

  test('chaque cible porte une taille minimale de 24 px, ou celle qu\'elle reçoit en ligne (`min-width` et `min-height` des boutons)', () => {
    const buttons = sheet.rules.filter((rule) => rule.selectors.some((selector) => /button|cell|roll|undo|confirm|bear/.test(selector)));
    expect(buttons.length).toBeGreaterThan(0);
    for (const rule of buttons) {
      for (const [, value] of rule.body.matchAll(/min-(?:width|height):\s*(\d+)px/g)) expect(Number(value)).toBeGreaterThanOrEqual(24);
    }
  });
});
