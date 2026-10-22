import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Die } from './Die';

// Le dé : un carré à points, dessiné en code. Chaque face a ses points, à la bonne place.

// Les centres des points d'une face, sur la grille de 10 × 10 du dessin.
function pips(value: number | null, rolling = false, face: number | null = null): Array<[number, number]> {
  const { container } = render(<Die value={value} rolling={rolling} face={face} />);
  return [...container.querySelectorAll('.ludo-die-pip')].map((pip) => [Number(pip.getAttribute('x')) + Number(pip.getAttribute('width')) / 2, Number(pip.getAttribute('y')) + Number(pip.getAttribute('height')) / 2]);
}

describe('les faces', () => {
  test('chaque face a autant de points que sa valeur, tous différents, tous dans le dé', () => {
    for (let value = 1; value <= 6; value++) {
      const found = pips(value);
      expect(found, `face ${value}`).toHaveLength(value);
      expect(new Set(found.map(([x, y]) => `${x},${y}`)).size).toBe(value);
      for (const [x, y] of found) {
        expect(x).toBeGreaterThan(0.5);
        expect(x).toBeLessThan(9.5);
        expect(y).toBeGreaterThan(0.5);
        expect(y).toBeLessThan(9.5);
      }
    }
  });

  test('les points sont symétriques autour du centre du dé : un point en face de chacun (le 1, le 3 et le 5 ont le leur au centre)', () => {
    for (let value = 1; value <= 6; value++) {
      const found = pips(value);
      const keys = new Set(found.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of found) expect(keys.has(`${10 - x},${10 - y}`), `face ${value}, point ${x},${y}`).toBe(true);
    }
  });

  test('la face 2 sur une diagonale, la 4 aux quatre coins, la 6 sur deux colonnes de trois', () => {
    const [two, four, six] = [pips(2), pips(4), pips(6)];
    expect(two.map(([x, y]) => x === y)).toEqual([true, true]);
    expect(new Set(four.map(([x]) => x)).size).toBe(2);
    expect(new Set(four.map(([, y]) => y)).size).toBe(2);
    expect(new Set(six.map(([x]) => x)).size).toBe(2);
    expect(new Set(six.map(([, y]) => y)).size).toBe(3);
    expect(pips(5).some(([x, y]) => x === 5 && y === 5)).toBe(true);
    expect(pips(1)).toEqual([[5, 5]]);
  });
});

describe('l\'état du dé', () => {
  test('sans valeur : aucun point, nommé « pas encore lancé »', () => {
    const { container } = render(<Die value={null} rolling={false} face={null} />);
    expect(container.querySelectorAll('.ludo-die-pip')).toHaveLength(0);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Dé : pas encore lancé');
    expect(container.querySelector('svg')!.getAttribute('data-value')).toBeNull();
  });

  test('qui roule : la face montrée est celle du hasard, pas la valeur ; son nom dit qu\'il roule', () => {
    const { container } = render(<Die value={4} rolling face={2} />);
    expect(container.querySelectorAll('.ludo-die-pip')).toHaveLength(2);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Le dé roule');
    expect(container.querySelector('svg')!.getAttribute('data-rolling')).toBe('true');
    // Arrêté : la valeur, et le nom qui la dit.
    const rest = render(<Die value={4} rolling={false} face={2} />);
    expect(rest.container.querySelectorAll('.ludo-die-pip')).toHaveLength(4);
    expect(rest.container.querySelector('svg')!.getAttribute('aria-label')).toBe('Dé : 4');
    expect(rest.container.querySelector('svg')!.getAttribute('data-rolling')).toBeNull();
  });

  test('il est dessiné en code, aux bords nets', () => {
    const { container } = render(<Die value={3} rolling={false} face={null} />);
    expect(container.querySelector('svg')!.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(container.querySelector('svg')!.getAttribute('role')).toBe('img');
  });
});
