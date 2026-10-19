import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeAuth, resetFakeAuth, setFakeSession } from '../test/fake-auth-client';
import { SESSION_REFRESH_INTERVAL_MS, useSessionKeepAlive } from './session';

vi.mock('./auth-client', () => import('../test/fake-auth-client'));

beforeEach(() => {
  resetFakeAuth();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('la session est relue toutes les 12 heures (la poignée de main du temps réel ne la prolonge jamais)', async () => {
  expect(SESSION_REFRESH_INTERVAL_MS).toBe(12 * 3600 * 1000);
  setFakeSession({ id: 'u-lea', name: 'Léa', email: 'lea@x.fr' });
  const signedOut = vi.fn();
  renderHook(() => useSessionKeepAlive(signedOut));

  await vi.advanceTimersByTimeAsync(SESSION_REFRESH_INTERVAL_MS - 1);
  expect(fakeAuth.getSession).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fakeAuth.getSession).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(SESSION_REFRESH_INTERVAL_MS);
  expect(fakeAuth.getSession).toHaveBeenCalledTimes(2);
  expect(signedOut).not.toHaveBeenCalled();
});

test('plus de session (expirée, ou fermée ailleurs) : signedOut ; serveur injoignable : rien', async () => {
  setFakeSession({ id: 'u-lea', name: 'Léa', email: 'lea@x.fr' });
  const signedOut = vi.fn();
  renderHook(() => useSessionKeepAlive(signedOut));

  fakeAuth.getSession.mockResolvedValueOnce({ data: null, error: { status: 0 } });
  await vi.advanceTimersByTimeAsync(SESSION_REFRESH_INTERVAL_MS);
  fakeAuth.getSession.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await vi.advanceTimersByTimeAsync(SESSION_REFRESH_INTERVAL_MS);
  expect(signedOut).not.toHaveBeenCalled();

  setFakeSession(null);
  await vi.advanceTimersByTimeAsync(SESSION_REFRESH_INTERVAL_MS);
  expect(signedOut).toHaveBeenCalledOnce();
});

test('démonté : plus de relecture', async () => {
  const { unmount } = renderHook(() => useSessionKeepAlive(() => {}));
  unmount();
  await vi.advanceTimersByTimeAsync(3 * SESSION_REFRESH_INTERVAL_MS);
  expect(fakeAuth.getSession).not.toHaveBeenCalled();
});

test('le dernier signedOut donné est celui qui est appelé (sans relancer le minuteur)', async () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = renderHook(({ fn }) => useSessionKeepAlive(fn), { initialProps: { fn: first } });
  await vi.advanceTimersByTimeAsync(SESSION_REFRESH_INTERVAL_MS / 2);
  rerender({ fn: second });
  await vi.advanceTimersByTimeAsync(SESSION_REFRESH_INTERVAL_MS / 2);
  expect(fakeAuth.getSession).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});
