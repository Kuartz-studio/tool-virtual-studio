import { render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { EventBus } from './EventBus';
import type { IRefPhaserGame } from './PhaserGame';

// Le vrai jeu a besoin d'un vrai canevas : ici, un jeu factice, qui dit s'il a été détruit.
const games = vi.hoisted(() => [] as Array<{ destroy: ReturnType<typeof vi.fn> }>);
vi.mock('./config', () => ({
  startGame: vi.fn(() => {
    const game = { destroy: vi.fn() };
    games.push(game);
    return game;
  }),
}));
// test/setup.ts remplace PhaserGame par un composant vide pour les autres tests : ici, c'est le vrai qu'on teste.
const { PhaserGame } = await vi.importActual<typeof import('./PhaserGame')>('./PhaserGame');

const SCENE_READY = 'current-scene-ready';
const scene = { scene: 'office' } as unknown as Phaser.Scene;

afterEach(() => {
  games.length = 0;
  EventBus.removeAllListeners();
});

test('démonté, il ne retire que son écouteur de current-scene-ready : ceux des autres restent', () => {
  const other = vi.fn();
  EventBus.on(SCENE_READY, other);

  const { unmount } = render(<PhaserGame mapKey="dev-office" />);
  expect(EventBus.listenerCount(SCENE_READY)).toBe(2);
  unmount();

  expect(EventBus.listenerCount(SCENE_READY)).toBe(1);
  EventBus.emit(SCENE_READY, scene);
  expect(other).toHaveBeenCalledExactlyOnceWith(scene);
});

test('il retire aussi l\'écouteur qu\'il remplace quand la propriété currentActiveScene change : un seul à la fois', () => {
  const first = vi.fn();
  const second = vi.fn();
  const other = vi.fn();
  EventBus.on(SCENE_READY, other);

  const { rerender, unmount } = render(<PhaserGame mapKey="dev-office" currentActiveScene={first} />);
  rerender(<PhaserGame mapKey="dev-office" currentActiveScene={second} />);
  expect(EventBus.listenerCount(SCENE_READY)).toBe(2);

  EventBus.emit(SCENE_READY, scene);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledExactlyOnceWith(scene);
  expect(other).toHaveBeenCalledOnce();

  unmount();
  expect(EventBus.listenerCount(SCENE_READY)).toBe(1);
});

test('la scène prête est transmise à la propriété et à la ref', () => {
  const onScene = vi.fn();
  const ref = createRef<IRefPhaserGame>();
  render(<PhaserGame ref={ref} mapKey="dev-office" currentActiveScene={onScene} />);
  expect(ref.current?.scene).toBeNull();

  EventBus.emit(SCENE_READY, scene);
  expect(onScene).toHaveBeenCalledExactlyOnceWith(scene);
  expect(ref.current?.scene).toBe(scene);
  expect(ref.current?.game).toBe(games[0]);
});

test('le jeu est détruit au démontage, et recréé pour une autre carte', () => {
  const { rerender, unmount } = render(<PhaserGame mapKey="carte-a" />);
  expect(games).toHaveLength(1);

  rerender(<PhaserGame mapKey="carte-b" />);
  expect(games[0]!.destroy).toHaveBeenCalledExactlyOnceWith(true);
  expect(games).toHaveLength(2);

  unmount();
  expect(games[1]!.destroy).toHaveBeenCalledExactlyOnceWith(true);
});
