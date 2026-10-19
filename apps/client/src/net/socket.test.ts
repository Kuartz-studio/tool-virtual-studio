import { expect, test } from 'vitest';
import { createOfficeSocket } from './socket';

test('createOfficeSocket : même origine que la page, /socket.io, avec les cookies, et rien ne part avant connect()', () => {
  const socket = createOfficeSocket();
  // La page des tests est http://bureau.test (vite.config.ts). L'adresse du gestionnaire de connexion n'est pas dans ses types.
  expect(new URL((socket.io as unknown as { uri: string }).uri).origin).toBe('http://bureau.test');
  expect(socket.io.opts.path).toBe('/socket.io');
  expect(socket.io.opts.withCredentials).toBe(true);
  expect(socket.connected).toBe(false);
  expect(socket.active).toBe(false);
});

test('chaque appel ouvre une connexion à elle (un nouvel onglet du composant ne partage rien avec l\'ancien)', () => {
  const first = createOfficeSocket();
  const second = createOfficeSocket();
  expect(second.io).not.toBe(first.io);
});
