import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// La feuille de style du plateau (§ 12.4 du document des jeux) : ses sélecteurs commencent tous par `.game-chess`, elle ne parle que par les jetons de `styles.css` et par ses variables
// locales, elle ne fixe rien, ne floute rien, ne charge aucune image, et ses couleurs de plateau tiennent les contrastes demandés (§ 9.5.4). happy-dom ne calcule pas les styles :
// le test lit les déclarations de la feuille, qui sont ce que le navigateur appliquerait (comme office/ui/tokens.test.ts).
const chessCss = readFileSync(resolve(import.meta.dirname, 'chess.css'), 'utf8');
const globalCss = readFileSync(resolve(import.meta.dirname, '../../styles.css'), 'utf8');

interface Rule {
  selector: string;
  body: string;
  inKeyframes: boolean;
}

// Les règles d'une feuille : le sélecteur et le corps de chacune, les blocs @media et @keyframes parcourus (les pas d'un @keyframes sont marqués).
function parseRules(source: string): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const stack: Array<{ prelude: string; body: string }> = [];
  let text = '';
  for (const char of css) {
    if (char === '{') {
      stack.push({ prelude: text.trim(), body: '' });
      text = '';
    } else if (char === '}') {
      const frame = stack.pop()!;
      frame.body += text;
      text = '';
      if (!frame.prelude.startsWith('@')) rules.push({ selector: frame.prelude, body: frame.body, inKeyframes: stack.some((outer) => outer.prelude.startsWith('@keyframes')) });
    } else {
      text += char;
    }
  }
  return rules;
}

const rules = parseRules(chessCss);
const plainRules = rules.filter((rule) => !rule.inKeyframes);

// Les jetons de `styles.css` : ceux de `:root` et ceux que la nuit redit.
function tokenNames(selector: string): string[] {
  const open = globalCss.indexOf(`${selector} {`);
  const body = globalCss.slice(globalCss.indexOf('{', open) + 1, globalCss.indexOf('}', open));
  return [...body.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]!);
}
const globalTokens = new Set([...tokenNames(':root'), ...tokenNames(".office-ui[data-theme='night']")]);

// Les variables que le plateau pose lui-même sur ses éléments (le style en ligne de ChessBoard), sans les déclarer dans la feuille.
const INLINE_VARIABLES = new Set(['--chess-cell', '--chess-slide-x', '--chess-slide-y']);

const declaredLocals = new Set([...chessCss.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]!));
const valueOf = (name: string): string => {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(chessCss);
  if (!match) throw new Error(`la feuille ne déclare pas ${name}`);
  return match[1]!.trim();
};

describe('la portée : tout est sous `.game-chess`', () => {
  test('la feuille a des règles, et chaque sélecteur de chaque règle commence par `.game-chess`', () => {
    expect(plainRules.length).toBeGreaterThan(20);
    for (const rule of plainRules) {
      for (const selector of rule.selector.split(',').map((part) => part.trim())) expect(selector.startsWith('.game-chess'), selector).toBe(true);
    }
  });

  test('ni `:root`, ni `html`, ni `body`, ni sélecteur d\'élément nu, ni `*` : un sélecteur d\'élément ne vient jamais qu\'après `.game-chess`', () => {
    for (const rule of plainRules) {
      expect(rule.selector).not.toMatch(/:root|(^|[\s,>+~])(html|body|\*)(?![\w-])/);
    }
  });

  test('les animations portent le nom du jeu', () => {
    const names = [...chessCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith('game-chess-'), name).toBe(true);
  });
});

describe('les jetons : seulement ceux qui existent, et jamais redéfinis', () => {
  test('toute variable que la feuille déclare est locale (`--chess-…`), et aucune ne redéfinit un jeton de `styles.css`', () => {
    expect(declaredLocals.size).toBeGreaterThan(10);
    for (const name of declaredLocals) {
      expect(name.startsWith('--chess-'), name).toBe(true);
      expect(globalTokens.has(name), name).toBe(false);
    }
  });

  test('toute variable que la feuille lit est un jeton de `styles.css`, une variable locale, ou une de celles que le plateau pose en ligne', () => {
    const used = new Set([...chessCss.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!));
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(globalTokens.has(name) || declaredLocals.has(name) || INLINE_VARIABLES.has(name), name).toBe(true);
  });

  test('le cadre autour suit les jetons (texte, surfaces, accent), le plateau garde les couleurs de l\'illustration : aucune règle de nuit', () => {
    expect(chessCss).not.toContain('data-theme');
    const used = new Set([...chessCss.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!));
    for (const token of ['--text', '--surface-soft', '--border-strong']) expect(used.has(token), token).toBe(true);
  });
});

describe('ce que le plateau s\'interdit (§ 9.5.6, § 9.5.9)', () => {
  test('pas de `position: fixed` (le panneau défile), pas de `backdrop-filter`', () => {
    expect(chessCss).not.toMatch(/position:\s*fixed/);
    expect(chessCss).not.toMatch(/backdrop-filter/);
  });

  test('aucune image, aucune police, aucun fichier : ni `url(`, ni `@import`, ni `@font-face`', () => {
    expect(chessCss).not.toMatch(/url\(|@import|@font-face/);
  });

  test('les pièces sont à l\'échelle entière, sans lissage', () => {
    expect(chessCss).toMatch(/image-rendering:\s*pixelated/);
  });

  test('aucune durée en dur dans une animation ou une transition : elles lisent des variables, déclarées en tête de feuille', () => {
    for (const rule of plainRules) {
      for (const declaration of rule.body.split(';')) {
        if (!/^\s*(animation|transition)(-duration)?\s*:/.test(declaration)) continue;
        expect(declaration, declaration).not.toMatch(/\b\d*\.?\d+m?s\b/);
      }
    }
    expect(declaredLocals.has('--chess-slide-duration')).toBe(true);
    expect(valueOf('--chess-slide-duration')).toMatch(/^\d+ms$/);
  });

  test('le glissement ne s\'applique qu\'aux pièces que le plateau marque (data-slide) : sans cette marque, aucune animation', () => {
    const animated = plainRules.filter((rule) => /\banimation\b\s*:/.test(rule.body));
    expect(animated.length).toBeGreaterThan(0);
    for (const rule of animated) expect(rule.selector, rule.selector).toContain('[data-slide]');
  });
});

describe('les cibles : 24 px au moins (WCAG 2.5.8)', () => {
  const minSizes = (selector: string): { width: number; height: number } => {
    const found = plainRules.filter((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector));
    expect(found.length, selector).toBeGreaterThan(0);
    const body = found.map((rule) => rule.body).join(';');
    const read = (property: string): number => Number(new RegExp(`${property}:\\s*(\\d+)px`).exec(body)?.[1] ?? 0);
    return { width: read('min-width'), height: read('min-height') };
  };

  test.each(['.game-chess-square', '.game-chess-promotion-option', '.game-chess-moves-toggle'])('%s déclare min-width et min-height d\'au moins 24 px', (selector) => {
    const { width, height } = minSizes(selector);
    expect(width).toBeGreaterThanOrEqual(24);
    expect(height).toBeGreaterThanOrEqual(24);
  });
});

// Le contraste de deux couleurs #rrggbb, d'après la luminance relative de WCAG 2.2.
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
};

describe('les contrastes de la palette (WCAG 1.4.11 : 3 contre 1 avec la case)', () => {
  const squares = () => [valueOf('--chess-light'), valueOf('--chess-dark')];

  test('les couleurs de la palette sont des #rrggbb', () => {
    for (const name of ['--chess-light', '--chess-dark', '--chess-ring-dark', '--chess-ring-light', '--chess-hint', '--chess-hint-halo', '--chess-check', '--chess-check-halo', '--chess-edge-white', '--chess-edge-black']) {
      expect(valueOf(name), name).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test('l\'anneau de sélection et du focus, et le point des coups possibles, tranchent à 3 contre 1 sur les deux couleurs de case', () => {
    for (const square of squares()) {
      expect(contrast(valueOf('--chess-ring-dark'), square), `anneau sur ${square}`).toBeGreaterThanOrEqual(3);
      expect(contrast(valueOf('--chess-hint'), square), `point sur ${square}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(valueOf('--chess-ring-dark'), valueOf('--chess-ring-light'))).toBeGreaterThanOrEqual(3);
    expect(contrast(valueOf('--chess-hint'), valueOf('--chess-hint-halo'))).toBeGreaterThanOrEqual(3);
  });

  test('l\'échec : le cercle rouge ou son liseré clair tranche à 3 contre 1 sur chaque case, et les deux tranchent entre eux', () => {
    for (const square of squares()) {
      const best = Math.max(contrast(valueOf('--chess-check'), square), contrast(valueOf('--chess-check-halo'), square));
      expect(best, `échec sur ${square}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(valueOf('--chess-check'), valueOf('--chess-check-halo'))).toBeGreaterThanOrEqual(3);
  });

  test('le contour des pièces tranche à 3 contre 1 sur les deux couleurs de case : on lit la forme, blanche comme noire', () => {
    for (const square of squares()) {
      expect(contrast(valueOf('--chess-edge-white'), square), `blanche sur ${square}`).toBeGreaterThanOrEqual(3);
      expect(contrast(valueOf('--chess-edge-black'), square), `noire sur ${square}`).toBeGreaterThanOrEqual(3);
    }
  });

  test('les deux couleurs de case se distinguent l\'une de l\'autre', () => {
    expect(contrast(valueOf('--chess-light'), valueOf('--chess-dark'))).toBeGreaterThanOrEqual(1.8);
  });
});
