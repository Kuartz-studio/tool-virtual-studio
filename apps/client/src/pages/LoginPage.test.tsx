import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { fakeAuth, resetFakeAuth, setFakeSession } from '../test/fake-auth-client';
import { renderRoute } from '../test/render';

vi.mock('../lib/auth-client', () => import('../test/fake-auth-client'));

beforeEach(() => {
  resetFakeAuth();
});

const LEA = { id: 'u-lea', name: 'Léa', email: 'lea@x.fr' };

async function signIn(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(fr.login.email), email);
  await user.type(screen.getByLabelText(fr.login.password), password);
  await user.click(screen.getByRole('button', { name: fr.login.submit }));
}

test('connexion → le bureau', async () => {
  fakeAuth.signInEmail.mockImplementation(async () => {
    setFakeSession(LEA);
    return { data: { user: LEA }, error: null };
  });
  const router = renderRoute('/connexion');

  await signIn(' lea@x.fr ', 'motdepasse1');
  expect(await screen.findByText('Bonjour Léa')).toBeTruthy();
  expect(router.state.location.pathname).toBe('/');
  expect(fakeAuth.signInEmail).toHaveBeenCalledWith({ email: 'lea@x.fr', password: 'motdepasse1' });
});

test('identifiants refusés → message, on reste sur la page', async () => {
  const router = renderRoute('/connexion');
  await signIn('lea@x.fr', 'pas-le-bon');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', fr.login.errors.invalidCredentials);
  expect(router.state.location.pathname).toBe('/connexion');
  expect(screen.getByRole('button', { name: fr.login.submit })).toHaveProperty('disabled', false);
});

test.each([
  [{ status: 403, code: 'ACCOUNT_DISABLED' }, fr.login.errors.accountDisabled],
  [{ status: 429 }, fr.common.errors.tooManyAttempts],
  [{ status: 500 }, fr.common.errors.unexpected],
])('refus %j → message', async (error, message) => {
  fakeAuth.signInEmail.mockResolvedValue({ data: null, error });
  renderRoute('/connexion');
  await signIn('lea@x.fr', 'motdepasse1');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', message);
});

test('serveur injoignable → message réseau', async () => {
  fakeAuth.signInEmail.mockRejectedValue(new TypeError('Failed to fetch'));
  renderRoute('/connexion');
  await signIn('lea@x.fr', 'motdepasse1');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', fr.common.errors.network);
});

test('le bureau sans session renvoie ici ; après connexion, retour au bureau', async () => {
  fakeAuth.signInEmail.mockImplementation(async () => {
    setFakeSession(LEA);
    return { data: { user: LEA }, error: null };
  });
  const router = renderRoute('/');
  expect(await screen.findByRole('heading', { name: fr.login.title })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/connexion');

  await signIn('lea@x.fr', 'motdepasse1');
  expect(await screen.findByText('Bonjour Léa')).toBeTruthy();
});

test('lien « Mot de passe oublié ? » → /mot-de-passe-oublie', async () => {
  renderRoute('/connexion');
  expect((await screen.findByRole('link', { name: fr.login.forgotPassword })).getAttribute('href')).toBe('/mot-de-passe-oublie');
});
