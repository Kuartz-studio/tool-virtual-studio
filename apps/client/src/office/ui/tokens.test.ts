import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, '../../styles.css'), 'utf8');

// Les jetons de la feuille de style : ceux de `:root` (le jour) et ceux que la nuit redit sous `.office-ui[data-theme='night']`. La couche
// d'interface prend le thème de la nuit quand la coque lui pose `data-theme="night"` (quand la lumière est éteinte). happy-dom ne calcule
// pas les styles d'une feuille aussi grande : le test lit les déclarations du bloc, qui sont ce que le navigateur appliquerait.
function declarations(selector: string): Map<string, string> {
  const open = css.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`Pas de règle « ${selector} » dans styles.css.`);
  const body = css.slice(css.indexOf('{', open) + 1, css.indexOf('}', open));
  const found = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/^\s*(--[\w-]+):\s*(.+?);\s*$/gm)) found.set(name!, value!);
  return found;
}

const day = declarations(':root');
const night = declarations(".office-ui[data-theme='night']");

test('le jour : l\'encre, les surfaces, le trait et l\'accent', () => {
  expect(day.get('--text')).toBe('#15171c');
  expect(day.get('--text-soft')).toBe('#5d6270');
  expect(day.get('--text-muted')).toBe('#656a79');
  expect(day.get('--surface')).toBe('#ffffff');
  expect(day.get('--surface-soft')).toBe('#f1f2f5');
  expect(day.get('--border')).toBe('rgb(21 23 28 / 9%)');
  expect(day.get('--accent')).toBe('#3b5bdb');
  expect(day.get('--accent-soft')).toBe('#e9edff');
});

test('la nuit : les mêmes jetons, d\'autres valeurs, et l\'accent prend la couleur des lampes', () => {
  expect(night.get('--text')).toBe('#eef0f4');
  expect(night.get('--text-soft')).toBe('#a3aaba');
  expect(night.get('--text-muted')).toBe('#8a91a3');
  expect(night.get('--surface')).toBe('#171a22');
  expect(night.get('--surface-soft')).toBe('#232835');
  expect(night.get('--border')).toBe('rgb(255 255 255 / 9%)');
  expect(night.get('--accent')).toBe('#ffc56b');
  expect(night.get('--accent-soft')).toBe('rgb(255 197 107 / 14%)');
});

test('chaque jeton de la nuit existe le jour : la nuit ne crée rien, elle redit', () => {
  for (const name of night.keys()) expect(day.has(name), name).toBe(true);
});

test('la nuit redit aussi ce qui se pose sur une surface (texte sur l\'accent, ombres qui citent le trait, rouges)', () => {
  expect(day.get('--on-accent')).toBe('#ffffff');
  expect(night.get('--on-accent')).toBe('#15171c');
  // Une variable qui en cite une autre prend sa valeur là où elle est posée : les ombres doivent être redites avec la nuit.
  for (const name of ['--shadow-dock', '--shadow-pop']) {
    expect(day.get(name), name).toContain('var(--border)');
    expect(night.get(name), name).toContain('var(--border)');
    expect(night.get(name), name).not.toBe(day.get(name));
  }
  expect(day.get('--danger-soft')).toBe('#fdecec');
  expect(night.get('--danger-soft')).toBe('rgb(229 72 77 / 16%)');
});

test('les jetons de l\'interface par icônes sont ceux du jour seul : statuts, rayons, mouvements', () => {
  expect(day.get('--ok')).toBe('#2fb35b');
  expect(day.get('--busy')).toBe('#f5a524');
  expect(day.get('--away')).toBe('#a1a6b3');
  expect(day.get('--dnd')).toBe('#e5484d');
  expect(day.get('--radius-dock')).toBe('18px');
  expect(day.get('--radius-btn')).toBe('12px');
  expect(day.get('--radius-pop')).toBe('20px');
  expect(day.get('--ease-out')).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  expect(day.get('--dur-fast')).toBe('160ms');
  expect(day.get('--dur-pop')).toBe('220ms');
  expect(day.get('--dur-theme')).toBe('500ms');
  for (const name of ['--ok', '--busy', '--away', '--dnd', '--radius-dock', '--radius-btn', '--radius-pop', '--ease-out', '--dur-fast', '--dur-pop', '--dur-theme']) {
    expect(night.has(name), name).toBe(false);
  }
});

test('la police est Instrument Sans, et le texte a ses tailles : 12, 13, 14 et 16 px', () => {
  expect(css).toMatch(/:root \{[^}]*font-family: 'Instrument Sans Variable', system-ui, sans-serif;/);
  expect([day.get('--text-xs'), day.get('--text-s'), day.get('--text-m'), day.get('--text-l')]).toEqual(['0.75rem', '0.8125rem', '0.875rem', '1rem']);
  expect([day.get('--weight-medium'), day.get('--weight-semibold')]).toEqual(['500', '600']);
});
