import { describe, expect, test, vi } from 'vitest';
import { createServerEvents } from '../src/server-events';

describe('createServerEvents', () => {
  test('emit livre la charge aux écouteurs de cet événement, dans l\'ordre, et à eux seuls', () => {
    const events = createServerEvents();
    const calls: string[] = [];
    const profile = vi.fn();
    events.on('member:removed', (userId) => calls.push(`premier ${userId}`));
    events.on('member:removed', (userId) => calls.push(`second ${userId}`));
    events.on('profile:changed', profile);

    events.emit('member:removed', 'u1');
    expect(calls).toEqual(['premier u1', 'second u1']);
    expect(profile).not.toHaveBeenCalled();

    events.emit('profile:changed', { id: 'u1', name: 'Léa', avatarKey: null });
    expect(profile).toHaveBeenCalledTimes(1);
    expect(profile).toHaveBeenCalledWith({ id: 'u1', name: 'Léa', avatarKey: null });
    expect(calls).toHaveLength(2);
  });

  test('émettre sans écouteur ne fait rien', () => {
    expect(() => createServerEvents().emit('member:removed', 'u1')).not.toThrow();
  });

  test('on renvoie la fonction qui désabonne l\'écouteur', () => {
    const events = createServerEvents();
    const listener = vi.fn();
    const off = events.on('member:removed', listener);
    events.emit('member:removed', 'u1');
    off();
    off();   // sans effet la seconde fois
    events.emit('member:removed', 'u2');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('u1');
  });

  test('un écouteur qui lève une erreur ne bloque ni les suivants ni l\'émetteur : l\'erreur va à onError', () => {
    const onError = vi.fn();
    const events = createServerEvents({ onError });
    const failure = new Error('écouteur cassé');
    const next = vi.fn();
    events.on('member:removed', () => {
      throw failure;
    });
    events.on('member:removed', next);

    expect(() => events.emit('member:removed', 'u1')).not.toThrow();
    expect(next).toHaveBeenCalledWith('u1');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  test('un écouteur asynchrone rejeté va à onError au lieu de devenir un rejet non géré', async () => {
    const onError = vi.fn();
    const events = createServerEvents({ onError });
    const failure = new Error('écouteur asynchrone cassé');
    events.on('profile:changed', async () => {
      throw failure;
    });

    events.emit('profile:changed', { id: 'u1', name: 'Léa', avatarKey: null });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  });

  test('sans onError, l\'erreur d\'un écouteur est écrite sur la sortie d\'erreur', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const events = createServerEvents();
      events.on('member:removed', () => {
        throw new Error('écouteur cassé');
      });
      events.emit('member:removed', 'u1');
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('un écouteur qui se désabonne pendant emit ne fait sauter aucun autre écouteur', () => {
    const events = createServerEvents();
    const second = vi.fn();
    const off = events.on('member:removed', () => off());
    events.on('member:removed', second);

    events.emit('member:removed', 'u1');
    expect(second).toHaveBeenCalledWith('u1');
  });
});
