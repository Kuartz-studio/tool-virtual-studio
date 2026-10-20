import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { FakeSocket } from '../test/fake-socket';
import { useSocketConnected } from './use-socket-connected';

test('sans socket : pas connecté', () => {
  const { result } = renderHook(() => useSocketConnected(null));
  expect(result.current).toBe(false);
});

test('suit la socket : connectée à la poignée de main, plus connectée à la coupure', () => {
  const socket = new FakeSocket();
  const { result } = renderHook(() => useSocketConnected(socket.asSocket()));
  expect(result.current).toBe(false);

  act(() => socket.serverAccepts());
  expect(result.current).toBe(true);
  act(() => socket.connectionDrops());
  expect(result.current).toBe(false);
  act(() => socket.serverAccepts());
  expect(result.current).toBe(true);
  act(() => socket.serverDisconnects());
  expect(result.current).toBe(false);
});

test('une socket déjà connectée au premier rendu l\'est tout de suite', () => {
  const socket = new FakeSocket();
  socket.serverAccepts();
  const { result } = renderHook(() => useSocketConnected(socket.asSocket()));
  expect(result.current).toBe(true);
});

test('une autre socket : c\'est elle qu\'on suit, et l\'ancienne n\'a plus d\'écouteur', () => {
  const first = new FakeSocket();
  const second = new FakeSocket();
  second.serverAccepts();
  const { result, rerender, unmount } = renderHook(({ socket }) => useSocketConnected(socket.asSocket()), { initialProps: { socket: first } });
  expect(first.listenerCount()).toBeGreaterThan(0);
  expect(result.current).toBe(false);

  rerender({ socket: second });
  expect(result.current).toBe(true);
  expect(first.listenerCount()).toBe(0);

  unmount();
  expect(second.listenerCount()).toBe(0);
});
