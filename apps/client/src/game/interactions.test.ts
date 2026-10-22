import { TILE_SIZE } from '@bureau/shared';
import { describe, expect, test, vi } from 'vitest';
import { Interactions, type Interactable } from './interactions';

const cases = (n: number) => n * TILE_SIZE;
const at = (x: number, y: number) => ({ x, y });

// Une cible de poche : elle compte combien de fois on l'a actionnée.
type Counted = Interactable & { used: number };
function target(id: string, pos: { x: number; y: number }, extra: Partial<Interactable> = {}): Counted {
  const made: Counted = {
    id,
    pos,
    reachTiles: 3,
    prompt: () => `[E] ${id}`,
    use: () => {
      made.used++;
    },
    used: 0,
    ...extra,
  };
  return made;
}

describe('la cible : la plus proche à portée', () => {
  test('prend la cible la plus proche à portée', () => {
    const interactions = new Interactions();
    const far = target('far', at(0, 0));
    const near = target('near', at(cases(2), 0));
    interactions.register(far);
    interactions.register(near);
    expect(interactions.update(at(cases(2) + 4, 0))).toBe(near);
    expect(interactions.update(at(cases(-1), 0))).toBe(far);
  });

  test('ignore une cible hors de portée', () => {
    const interactions = new Interactions();
    interactions.register(target('lointaine', at(0, 0)));
    expect(interactions.update(at(0, cases(4)))).toBeNull();
  });

  test('la portée est inclusive, en ligne droite : à 3 cases oui, un pixel de plus non', () => {
    const interactions = new Interactions();
    const t = target('t', at(0, 0));
    interactions.register(t);
    expect(interactions.update(at(0, cases(3)))).toBe(t);
    expect(interactions.update(at(cases(3), 0))).toBe(t);
    expect(interactions.update(at(0, cases(3) + 1))).toBeNull();
    expect(interactions.update(at(cases(2), cases(2)))).toBe(t);   // 2,83 cases
    expect(interactions.update(at(72, 72))).toBeNull();   // 3,18 cases
  });

  test('chaque cible a sa portée', () => {
    const interactions = new Interactions();
    const courte = target('courte', at(0, 0), { reachTiles: 1 });
    interactions.register(courte);
    expect(interactions.update(at(cases(1), 0))).toBe(courte);
    expect(interactions.update(at(cases(2), 0))).toBeNull();
  });

  test('ignore une cible dont prompt() est null', () => {
    const interactions = new Interactions();
    let nothingToDo = true;
    const near = target('near', at(0, 0), { prompt: () => (nothingToDo ? null : '[E] near') });
    const far = target('far', at(cases(2), 0));
    interactions.register(near);
    interactions.register(far);
    expect(interactions.update(at(0, 0))).toBe(far);
    nothingToDo = false;
    expect(interactions.update(at(0, 0))).toBe(near);
  });

  test('à égalité de distance, la première enregistrée', () => {
    const left = target('gauche', at(cases(-1), 0));
    const right = target('droite', at(cases(1), 0));
    const one = new Interactions();
    one.register(left);
    one.register(right);
    expect(one.update(at(0, 0))).toBe(left);
    const two = new Interactions();
    two.register(right);
    two.register(left);
    expect(two.update(at(0, 0))).toBe(right);
  });
});

describe('actionner', () => {
  test('use() rend faux et ne fait rien sans cible', () => {
    const interactions = new Interactions();
    const t = target('t', at(0, 0));
    interactions.register(t);
    expect(interactions.use()).toBe(false);
    interactions.update(at(0, cases(9)));
    expect(interactions.use()).toBe(false);
    expect(t.used).toBe(0);
  });

  test('use() agit sur la cible de la dernière mise à jour', () => {
    const interactions = new Interactions();
    const t = target('t', at(0, 0));
    interactions.register(t);
    interactions.update(at(0, cases(1)));
    expect(interactions.use()).toBe(true);
    expect(t.used).toBe(1);
  });

  test('use(pieds) relit la portée à cet instant : un pas depuis la dernière image compte', () => {
    const interactions = new Interactions();
    const t = target('t', at(0, 0));
    interactions.register(t);
    interactions.update(at(0, cases(9)));
    expect(interactions.use(at(0, cases(1)))).toBe(true);
    expect(t.used).toBe(1);
    expect(interactions.use(at(0, cases(9)))).toBe(false);
    expect(t.used).toBe(1);
  });

  test('si l\'on donne un fournisseur de pieds, use() et update() s\'en servent', () => {
    let where = at(0, cases(8));
    const interactions = new Interactions({ feet: () => where });
    const t = target('t', at(0, 0));
    interactions.register(t);
    expect(interactions.update()).toBeNull();
    expect(interactions.use()).toBe(false);
    where = at(0, cases(2));   // aucune image entre-temps : personne n'a appelé update
    expect(interactions.use()).toBe(true);
    expect(t.used).toBe(1);
    expect(interactions.update()).toBe(t);
  });

  test('useTarget agit sur la cible cliquée, même si une autre est plus proche, à portée seulement', () => {
    const interactions = new Interactions();
    const near = target('near', at(0, 0));
    const far = target('far', at(cases(2), 0));
    interactions.register(near);
    interactions.register(far);
    expect(interactions.useTarget(far, at(0, 0))).toBe(true);
    expect([near.used, far.used]).toEqual([0, 1]);
    expect(interactions.useTarget(far, at(cases(-2), 0))).toBe(false);   // à 4 cases
    expect(far.used).toBe(1);
  });

  test('useTarget ne fait rien d\'une cible sans texte, ni d\'une cible retirée', () => {
    const interactions = new Interactions();
    const muette = target('muette', at(0, 0), { prompt: () => null });
    const retiree = target('retirée', at(0, 0));
    interactions.register(muette);
    interactions.register(retiree)();
    expect(interactions.useTarget(muette, at(0, 0))).toBe(false);
    expect(interactions.useTarget(retiree, at(0, 0))).toBe(false);
    expect([muette.used, retiree.used]).toEqual([0, 0]);
  });

  test('useTarget sans pieds, ni fournisseur : rien', () => {
    const interactions = new Interactions();
    const t = target('t', at(0, 0));
    interactions.register(t);
    expect(interactions.useTarget(t)).toBe(false);
  });
});

describe('retirer et suivre', () => {
  test('une cible retirée ne répond plus', () => {
    const interactions = new Interactions();
    const t = target('t', at(0, 0));
    const remove = interactions.register(t);
    expect(interactions.update(at(0, 0))).toBe(t);
    remove();
    expect(interactions.use()).toBe(false);
    expect(t.used).toBe(0);
    expect(interactions.update(at(0, 0))).toBeNull();
    remove();   // retirer deux fois ne fait rien
  });

  test('onChange ne part que quand la cible change', () => {
    const interactions = new Interactions();
    const a = target('a', at(0, 0));
    interactions.register(a);
    const listener = vi.fn();
    const stop = interactions.onChange(listener);
    interactions.update(at(0, 0));
    interactions.update(at(0, 4));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(a);
    interactions.update(at(0, cases(9)));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(null);
    interactions.update(at(0, cases(9)));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    interactions.update(at(0, 0));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('onChange part aussi quand la cible courante est retirée', () => {
    const interactions = new Interactions();
    const a = target('a', at(0, 0));
    const remove = interactions.register(a);
    interactions.update(at(0, 0));
    const listener = vi.fn();
    interactions.onChange(listener);
    remove();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  test('un texte qui change sur la même cible n\'est pas un changement de cible', () => {
    const interactions = new Interactions();
    let text = '[E] Éteindre';
    const a = target('a', at(0, 0), { prompt: () => text });
    interactions.register(a);
    const listener = vi.fn();
    interactions.onChange(listener);
    interactions.update(at(0, 0));
    text = '[E] Allumer';
    interactions.update(at(0, 0));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
