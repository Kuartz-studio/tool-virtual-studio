import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { contrast } from './contrast';
import { MARKER_OUTLINE } from './sprites';

// La feuille de style du jeu (§ 12.4 du document des jeux) : tous ses sélecteurs commencent par `.game-connect4`, elle ne parle que par les jetons de styles.css et par ses propres
// variables (celles de l'illustration, posées sur `.game-connect4`), elle ne redéfinit aucun jeton, aucun sélecteur d'élément nu, jamais `:root`. happy-dom ne calcule pas les styles :
// le test lit les déclarations, qui sont ce que le navigateur appliquerait (comme office/ui/tokens.test.ts).

const here = import.meta.dirname;
const sheet = readFileSync(resolve(here, 'connect4.css'), 'utf8');
const platform = readFileSync(resolve(here, '../../styles.css'), 'utf8');

interface Rule {
  selectors: string[];
  declarations: Map<string, string>;
}

function declarationsOf(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return found;
}

// Les règles d'une feuille (celles d'un `@media` ou d'un `@supports` comprises) et les noms de ses `@keyframes`, sans les commentaires.
function parse(source: string): { rules: Rule[]; keyframes: string[] } {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const keyframes: string[] = [];
  const walk = (chunk: string) => {
    let from = 0;
    for (;;) {
      const open = chunk.indexOf('{', from);
      if (open === -1) return;
      const prelude = chunk.slice(from, open).trim();
      let depth = 1;
      let close = open + 1;
      while (close < chunk.length && depth > 0) {
        if (chunk[close] === '{') depth++;
        if (chunk[close] === '}') depth--;
        close++;
      }
      const body = chunk.slice(open + 1, close - 1);
      if (prelude.startsWith('@keyframes')) keyframes.push(prelude.replace('@keyframes', '').trim());
      else if (prelude.startsWith('@')) walk(body);
      else rules.push({ selectors: prelude.split(',').map((selector) => selector.trim()), declarations: declarationsOf(body) });
      from = close;
    }
  };
  walk(text);
  return { rules, keyframes };
}

// Les jetons de la plateforme : ceux de `:root` (le jour) et ceux que la nuit redit.
function tokensOf(selector: string): Map<string, string> {
  const open = platform.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`Pas de règle « ${selector} » dans styles.css.`);
  const body = platform.slice(platform.indexOf('{', open) + 1, platform.indexOf('}', open));
  return new Map([...body.matchAll(/^\s*(--[\w-]+):\s*(.+?);\s*$/gm)].map(([, name, value]) => [name!, value!]));
}
const day = tokensOf(':root');
const night = tokensOf(".office-ui[data-theme='night']");
const { rules, keyframes } = parse(sheet);
const root = rules.find((rule) => rule.selectors.length === 1 && rule.selectors[0] === '.game-connect4');

// Les variables que le plateau pose lui-même sur ses éléments, selon sa taille et la chute (Board.tsx).
const INLINE_VARIABLES = ['--game-connect4-cell', '--game-connect4-inset', '--game-connect4-fall-rows'];

describe('la feuille de style du Puissance 4 respecte la plateforme', () => {
  test('elle existe, et le module du jeu l\'importe', () => {
    expect(rules.length).toBeGreaterThan(10);
    expect(readFileSync(resolve(here, 'index.tsx'), 'utf8')).toMatch(/import ['"]\.\/connect4\.css['"]/);
  });

  test('tous les sélecteurs commencent par `.game-connect4` : jamais `:root`, jamais un élément nu, jamais un sélecteur de la plateforme', () => {
    for (const rule of rules) {
      for (const selector of rule.selectors) expect(selector, selector).toMatch(/^\.game-connect4/);
    }
    expect(sheet).not.toMatch(/:root|(^|[\s,}])(html|body|\*)\s*[,{]/);
  });

  test('les animations ont des noms à elle : `game-connect4-…`', () => {
    expect(keyframes.length).toBeGreaterThanOrEqual(2);
    for (const name of keyframes) expect(name).toMatch(/^game-connect4-/);
    for (const rule of rules) {
      for (const name of (rule.declarations.get('animation') ?? rule.declarations.get('animation-name') ?? '').split(/[\s,]+/).filter((word) => /^[a-z-]+$/.test(word) && !['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'infinite', 'alternate', 'forwards', 'both', 'none'].includes(word))) {
        expect(keyframes, `animation « ${name} » de ${rule.selectors.join(', ')}`).toContain(name);
      }
    }
  });

  test('elle ne redéfinit aucun jeton, et ses variables sont toutes posées sur `.game-connect4` et nommées `--game-connect4-…`', () => {
    expect(root).toBeDefined();
    for (const rule of rules) {
      for (const name of rule.declarations.keys()) {
        if (!name.startsWith('--')) continue;
        expect(rule.selectors, `variable ${name}`).toEqual(['.game-connect4']);
        expect(name, `variable ${name}`).toMatch(/^--game-connect4-/);
        expect(day.has(name) || night.has(name), `${name} est un jeton de la plateforme`).toBe(false);
      }
    }
  });

  test('elle ne lit que des jetons qui existent (ceux de styles.css, ses propres variables, ou celles que le plateau pose en ligne)', () => {
    const declared = new Set([...(root?.declarations.keys() ?? [])].filter((name) => name.startsWith('--')));
    for (const rule of rules) {
      for (const [property, value] of rule.declarations) {
        for (const [, name] of value.matchAll(/var\((--[\w-]+)/g)) {
          expect(day.has(name!) || declared.has(name!) || INLINE_VARIABLES.includes(name!), `${name} lu par « ${property} » de ${rule.selectors.join(', ')}`).toBe(true);
        }
      }
    }
  });

  test('aucune valeur de réglage en dur hors des variables de `.game-connect4` : ni durée, ni couleur, ni taille de jeton dans les autres règles', () => {
    for (const rule of rules) {
      if (rule === root) continue;
      for (const [property, value] of rule.declarations) {
        const where = `${property} de ${rule.selectors.join(', ')}`;
        expect(value, where).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(value, where).not.toMatch(/rgba?\(/i);
        if (/^(animation|transition)/.test(property)) expect(value, where).not.toMatch(/(^|[\s,])\d*\.?\d+m?s(?![\w-])/);
      }
    }
  });

  test('ni `position: fixed` (le panneau défile), ni `backdrop-filter` (un coût à chaque image), ni `!important`', () => {
    expect(sheet).not.toMatch(/position:\s*fixed/);
    expect(sheet).not.toMatch(/backdrop-filter/);
    expect(sheet).not.toMatch(/!important/);
  });

  test('le pixel art ne se floute pas : `image-rendering: pixelated` sur les dessins', () => {
    const drawn = rules.filter((rule) => rule.selectors.some((selector) => /svg|disc|slot|token|ghost/.test(selector)) && rule.declarations.get('image-rendering') === 'pixelated');
    expect(drawn.length).toBeGreaterThan(0);
  });
});

describe('l\'illustration est la même le jour et la nuit, et se voit sur les deux', () => {
  const variable = (name: string): string => {
    const value = root?.declarations.get(name);
    if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} n'est pas une couleur #rrggbb dans .game-connect4 : ${String(value)}`);
    return value.toLowerCase();
  };

  test('le plateau, ses bords et la couleur du cerclage sont des variables de `.game-connect4`, jamais redites pour la nuit', () => {
    for (const name of ['--game-connect4-plate', '--game-connect4-plate-edge', '--game-connect4-marker']) expect(() => variable(name)).not.toThrow();
    expect(sheet).not.toMatch(/data-theme/);
    expect(variable('--game-connect4-marker')).toBe(MARKER_OUTLINE);
  });

  test('le cerclage se détache du plateau (3 contre 1 au moins), et le bord du plateau se détache de la page, de jour comme de nuit', () => {
    expect(contrast(variable('--game-connect4-marker'), variable('--game-connect4-plate'))).toBeGreaterThanOrEqual(3);
    for (const [name, surface] of [['le jour', day.get('--surface')!], ['la nuit', night.get('--surface')!]] as const) {
      expect(contrast(variable('--game-connect4-plate-edge'), surface), name).toBeGreaterThanOrEqual(3);
    }
  });

  test('les durées sont des variables nommées : la chute d\'environ 250 ms, la pulsation de la ligne gagnante', () => {
    expect(root?.declarations.get('--game-connect4-fall-duration')).toBe('250ms');
    expect(root?.declarations.get('--game-connect4-pulse-duration')).toMatch(/^\d+ms$/);
  });
});

describe('la chute, la pulsation et le contour de la ligne gagnante', () => {
  const rule = (selectorPart: RegExp) => rules.find((candidate) => candidate.selectors.some((selector) => selectorPart.test(selector)));
  // La règle qui n'a que ce sélecteur, et pas une liste dont il est un des membres.
  const alone = (selector: string) => rules.find((candidate) => candidate.selectors.length === 1 && candidate.selectors[0] === selector);

  test('un jeton qui tombe est animé par la feuille de style (pas par du JavaScript), de la hauteur que le plateau lui donne', () => {
    const falling = rule(/token\[data-falling\]/);
    expect(falling?.declarations.get('animation')).toMatch(/game-connect4-fall/);
    expect(falling?.declarations.get('animation')).toContain('var(--game-connect4-fall-duration)');
    expect(sheet).toMatch(/@keyframes game-connect4-fall[\s\S]*var\(--game-connect4-fall-rows\)/);
  });

  test('la ligne gagnante a un contour épais et fixe (il reste quand la pulsation est coupée par le mouvement réduit), et une pulsation en plus', () => {
    const outline = alone('.game-connect4-token[data-win]');
    expect(outline).toBeDefined();
    expect(outline!.declarations.get('filter')).toMatch(/drop-shadow/);
    // Le contour ne bouge pas : il ne dépend d'aucune animation.
    expect(outline!.declarations.get('animation')).toBeUndefined();
    const pulse = rule(/token\[data-win\] .*disc/);
    expect(pulse?.declarations.get('animation')).toMatch(/game-connect4-pulse/);
    expect(pulse?.declarations.get('animation')).toContain('var(--game-connect4-pulse-duration)');
  });

  test('la chute et la pulsation ne se disputent pas la même propriété : le jeton qui gagne en tombant fait les deux (la chute sur le jeton, la pulsation sur son dessin)', () => {
    const fall = alone('.game-connect4-token[data-falling]');
    const pulse = rule(/token\[data-win\] .*disc/);
    expect(fall).toBeDefined();
    expect(pulse).toBeDefined();
    expect(fall!.selectors).not.toEqual(pulse!.selectors);
    expect(pulse!.selectors.join(' ')).not.toMatch(/data-falling/);
  });

  test('les autres jetons s\'assombrissent quand une ligne est gagnée (data-dim), sans disparaître ni se mêler au bleu du plateau (pas de transparence)', () => {
    const dim = rule(/token\[data-dim\]/);
    expect(dim).toBeDefined();
    const brightness = Number(/brightness\(([\d.]+)\)/.exec(dim!.declarations.get('filter') ?? '')?.[1]);
    expect(brightness).toBeGreaterThan(0.3);
    expect(brightness).toBeLessThan(1);
    expect(dim!.declarations.get('opacity')).toBeUndefined();
  });

  test('le survol d\'une colonne la voile sans la cacher : un fond translucide, jamais un jeton de la plateforme opaque (il recouvrirait le plateau)', () => {
    const hover = rule(/column:not\(\[aria-disabled=['"]?true['"]?\]\):hover$/);
    expect(hover).toBeDefined();
    expect(hover!.declarations.get('background')).toBe('var(--game-connect4-hover)');
    const veil = root?.declarations.get('--game-connect4-hover') ?? '';
    expect(veil).toMatch(/^rgb\(\d+ \d+ \d+ \/ \d+%\)$/);
    expect(Number(/\/ (\d+)%/.exec(veil)?.[1])).toBeLessThan(50);
  });

  test('le fantôme est caché tant qu\'on ne survole pas, ni ne vise la colonne au clavier, et jamais sur une colonne qu\'on ne peut pas jouer', () => {
    expect(alone('.game-connect4-ghost')?.declarations.get('opacity')).toBe('0');
    const shown = rules.filter((candidate) => candidate.selectors.some((selector) => /:hover .*ghost|:focus-visible .*ghost/.test(selector)));
    expect(shown.length).toBeGreaterThan(0);
    for (const candidate of shown) {
      for (const selector of candidate.selectors) expect(selector, selector).toMatch(/:not\(\[aria-disabled=['"]?true['"]?\]\)/);
    }
  });

  test('une colonne inactive ne se présente pas comme cliquable (curseur), une colonne jouable si', () => {
    const inactive = rule(/column\[aria-disabled=['"]?true/);
    expect(inactive?.declarations.get('cursor')).toBeDefined();
    expect(inactive?.declarations.get('cursor')).not.toBe('pointer');
    expect(alone('.game-connect4-column')?.declarations.get('cursor')).toBe('pointer');
  });
});
