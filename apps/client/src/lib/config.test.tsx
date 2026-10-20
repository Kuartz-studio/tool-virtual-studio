import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { fakeApi, json } from '../test/fake-api';
import { loadPublicConfig, useMailMode } from './config';

// Le module garde la configuration chargée d'une page à l'autre : test/setup.ts l'oublie après chaque test.
const countOf = (api: ReturnType<typeof fakeApi>) => api.mock.calls.length;

describe('loadPublicConfig', () => {
  test('lit GET /api/config une seule fois, même demandée plusieurs fois à la fois ou plus tard', async () => {
    const api = fakeApi({ 'GET /api/config': () => json(200, { mail: 'none' }) });
    const [first, second] = await Promise.all([loadPublicConfig(), loadPublicConfig()]);
    expect(first).toEqual({ mail: 'none' });
    expect(second).toBe(first);
    expect(await loadPublicConfig()).toEqual({ mail: 'none' });
    expect(countOf(api)).toBe(1);
  });

  test.each(['resend', 'none', 'memory'] as const)('mail: %s est reconnu', async (mail) => {
    fakeApi({ 'GET /api/config': () => json(200, { mail }) });
    expect(await loadPublicConfig()).toEqual({ mail });
  });

  test('un échec donne null sans rien garder : la demande suivante réessaie', async () => {
    let attempts = 0;
    const api = fakeApi({
      'GET /api/config': () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return json(200, { mail: 'none' });
      },
    });
    expect(await loadPublicConfig()).toBeNull();
    expect(await loadPublicConfig()).toEqual({ mail: 'none' });
    expect(countOf(api)).toBe(2);
  });

  test.each([
    ['une erreur du serveur', () => json(500, { error: 'internal' })],
    ['une page de relais', () => new Response('<html>Bad Gateway</html>', { status: 502 })],
    ['un mode inconnu', () => json(200, { mail: 'smtp' })],
    ['un corps sans mode', () => json(200, {})],
    ['un corps qui n\'est pas un objet', () => json(200, 'none')],
    ['aucun corps', () => new Response('', { status: 200 })],
  ])('%s → null, rien n\'est gardé', async (_name, reply) => {
    const api = fakeApi({ 'GET /api/config': reply });
    expect(await loadPublicConfig()).toBeNull();
    expect(await loadPublicConfig()).toBeNull();
    expect(countOf(api)).toBe(2);
  });
});

describe('useMailMode', () => {
  test('null d\'abord, puis le mode du serveur', async () => {
    fakeApi({ 'GET /api/config': () => json(200, { mail: 'none' }) });
    const { result } = renderHook(() => useMailMode());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('none'));
  });

  test('déjà chargé, il rend le mode tout de suite, sans nouvelle requête', async () => {
    const api = fakeApi({ 'GET /api/config': () => json(200, { mail: 'resend' }) });
    const first = renderHook(() => useMailMode());
    await waitFor(() => expect(first.result.current).toBe('resend'));
    first.unmount();
    const second = renderHook(() => useMailMode());
    expect(second.result.current).toBe('resend');
    expect(countOf(api)).toBe(1);
  });

  test('désactivé, il ne demande rien', async () => {
    const api = fakeApi({ 'GET /api/config': () => json(200, { mail: 'none' }) });
    const { result, rerender } = renderHook(({ enabled }) => useMailMode(enabled), { initialProps: { enabled: false } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeNull();
    expect(countOf(api)).toBe(0);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current).toBe('none'));
    expect(countOf(api)).toBe(1);
  });

  test('requête en échec → null (la page garde son comportement d\'avant)', async () => {
    fakeApi({ 'GET /api/config': () => json(500, { error: 'internal' }) });
    const { result } = renderHook(() => useMailMode());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeNull();
  });
});
