import { describe, expect, test, vi } from 'vitest';
import { AvatarLibrary, FALLBACK_KEY, specOf } from '../avatars';
import { AvatarSkin } from './avatar-skin';

// Une bibliothèque d'avatars de poche : ce qu'un AvatarSkin lui demande (a-t-on cet avatar ? peut-on l'assembler ?).
function fakeLibrary() {
  const ready = new Set<string>();
  const waiting = new Map<string, () => void>();
  const library = {
    has: (key: string) => ready.has(key),
    textureFor: (key: string) => (ready.has(key) ? key : FALLBACK_KEY),
    specFor: (key: string) => specOf(ready.has(key) ? key : FALLBACK_KEY),
    ensure: (key: string) =>
      ready.has(key)
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) => {
            waiting.set(key, () => {
              ready.add(key);
              resolve(true);
            });
          }),
  };
  return { library: library as unknown as AvatarLibrary, ready, finish: (key: string) => waiting.get(key)!() };
}

describe('AvatarSkin', () => {
  test('montre la silhouette tant que l\'avatar s\'assemble, puis le prévient dès qu\'il est prêt', async () => {
    const { library, finish } = fakeLibrary();
    const onChange = vi.fn();
    const skin = new AvatarSkin(library, 'u1', 'p.04', onChange);
    expect(skin.spec.key).toBe(FALLBACK_KEY);
    expect(skin.key).toBe('p.04');
    finish('p.04');
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]![0].key).toBe('p.04');
    expect(skin.spec.key).toBe('p.04');
  });

  test('un avatar déjà prêt : aucune silhouette, aucun rappel', () => {
    const { library, ready } = fakeLibrary();
    ready.add('p.02');
    const onChange = vi.fn();
    const skin = new AvatarSkin(library, 'u1', 'p.02', onChange);
    expect(skin.spec.key).toBe('p.02');
    expect(onChange).not.toHaveBeenCalled();
  });

  test('sans clé valable : le personnage prêt de cette personne', () => {
    const { library } = fakeLibrary();
    const skin = new AvatarSkin(library, 'u1', 'dev-red', () => {});
    expect(skin.key).toMatch(/^p\.\d\d$/);
  });

  test('un changement de profil pendant l\'assemblage : seul le dernier avatar demandé est pris', async () => {
    const { library, finish } = fakeLibrary();
    const onChange = vi.fn();
    const skin = new AvatarSkin(library, 'u1', 'p.04', onChange);
    skin.set('p.06');
    finish('p.04');
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    finish('p.06');
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange.mock.calls.map((c) => c[0].key)).toEqual(['p.06']);
  });

  test('détruit : plus de rappel', async () => {
    const { library, finish } = fakeLibrary();
    const onChange = vi.fn();
    const skin = new AvatarSkin(library, 'u1', 'p.04', onChange);
    skin.destroy();
    finish('p.04');
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });
});
