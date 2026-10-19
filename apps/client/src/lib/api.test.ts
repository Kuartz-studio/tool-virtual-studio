import { expect, test } from 'vitest';
import { fakeApi, json } from '../test/fake-api';
import { api, ApiError } from './api';

test('réponse 2xx → son corps JSON', async () => {
  fakeApi({ 'GET /api/members': () => json(200, [{ id: 'u1', name: 'Léa' }]) });
  await expect(api('/api/members')).resolves.toEqual([{ id: 'u1', name: 'Léa' }]);
});

test('un corps envoyé part en JSON, avec les cookies de l\'origine', async () => {
  const fetchMock = fakeApi({ 'PATCH /api/me': () => json(200, { id: 'u1', name: 'Léa' }) });
  await api('/api/me', { method: 'PATCH', body: JSON.stringify({ name: 'Léa' }) });
  const [, init] = fetchMock.mock.calls[0]!;
  expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  expect(init?.credentials).toBe('same-origin');
  expect(init?.body).toBe('{"name":"Léa"}');
});

test('erreur de l\'API → ApiError { status, error } avec le code de l\'API', async () => {
  fakeApi({ 'GET /api/invitations/tok': () => json(410, { error: 'expired' }) });
  const failure = await api('/api/invitations/tok').catch((err: unknown) => err);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure).toMatchObject({ status: 410, error: 'expired' });
});

test('réponse sans code d\'erreur (page d\'un relais, 502) → ApiError { error: unexpected }', async () => {
  fakeApi({ 'GET /api/members': () => new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }) });
  await expect(api('/api/members')).rejects.toMatchObject({ status: 502, error: 'unexpected' });
});

test('serveur injoignable → ApiError { status: 0, error: network }', async () => {
  fakeApi({
    'GET /api/members': () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await expect(api('/api/members')).rejects.toMatchObject({ status: 0, error: 'network' });
});

test('réponse 204 sans corps → undefined', async () => {
  fakeApi({ 'DELETE /api/admin/invitations/i1': () => new Response(null, { status: 204 }) });
  await expect(api('/api/admin/invitations/i1', { method: 'DELETE' })).resolves.toBeUndefined();
});
