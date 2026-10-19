import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { fr } from './i18n/fr';
import { fakeAuth, resetFakeAuth, setFakeSession } from './test/fake-auth-client';
import { renderRoute } from './test/render';

vi.mock('./lib/auth-client', () => import('./test/fake-auth-client'));

beforeEach(() => {
  resetFakeAuth();
});

const LEA = { id: 'u-lea', name: 'Léa', email: 'lea@x.fr' };

test('sans session, le bureau renvoie à /connexion', async () => {
  const router = renderRoute('/');
  expect(await screen.findByRole('heading', { name: fr.login.title })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/connexion');
});

test('avec session : « Bonjour Léa » ; « Se déconnecter » ferme la session et renvoie à /connexion', async () => {
  setFakeSession(LEA);
  const user = userEvent.setup();
  const router = renderRoute('/');

  expect(await screen.findByText('Bonjour Léa')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: fr.office.signOut }));
  expect(await screen.findByRole('heading', { name: fr.login.title })).toBeTruthy();
  expect(fakeAuth.signOut).toHaveBeenCalledOnce();
  expect(router.state.location.pathname).toBe('/connexion');
});

// La session est relue auprès du serveur à chaque arrivée sur le bureau : une session ouverte juste avant (connexion,
// création du compte) ou fermée ailleurs compte tout de suite.
test('la session est relue à chaque arrivée sur le bureau', async () => {
  setFakeSession(LEA);
  renderRoute('/');
  expect(await screen.findByText('Bonjour Léa')).toBeTruthy();
  expect(fakeAuth.getSession).toHaveBeenCalled();
});

test('serveur injoignable → message et « Réessayer », sans renvoyer à la connexion', async () => {
  fakeAuth.getSession.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  setFakeSession(LEA);
  const user = userEvent.setup();
  const router = renderRoute('/');

  expect(await screen.findByText(fr.common.errors.network)).toBeTruthy();
  expect(router.state.location.pathname).toBe('/');
  await user.click(screen.getByRole('button', { name: fr.common.retry }));
  expect(await screen.findByText('Bonjour Léa')).toBeTruthy();
});

test.each([
  ['serveur injoignable', () => fakeAuth.signOut.mockRejectedValueOnce(new TypeError('Failed to fetch')), fr.common.errors.network],
  ['serveur en erreur (500)', () => fakeAuth.signOut.mockResolvedValueOnce({ data: null, error: { status: 500 } }), fr.common.errors.unexpected],
])('déconnexion impossible (%s) → message, on reste au bureau', async (_case, failSignOut, message) => {
  setFakeSession(LEA);
  failSignOut();
  const user = userEvent.setup();
  const router = renderRoute('/');

  await user.click(await screen.findByRole('button', { name: fr.office.signOut }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', message);
  expect(router.state.location.pathname).toBe('/');
  expect(screen.getByRole('button', { name: fr.office.signOut })).toHaveProperty('disabled', false);
});
