import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { fakeAuth, resetFakeAuth } from '../test/fake-auth-client';
import { renderRoute } from '../test/render';

vi.mock('../lib/auth-client', () => import('../test/fake-auth-client'));

beforeEach(() => {
  resetFakeAuth();
});

describe('mot de passe oublié', () => {
  test('demande le lien pour /reinitialiser de cette origine, puis confirme sans dire si le compte existe', async () => {
    const user = userEvent.setup();
    renderRoute('/mot-de-passe-oublie');
    await user.type(await screen.findByLabelText(fr.forgotPassword.email), ' lea@x.fr ');
    await user.click(screen.getByRole('button', { name: fr.forgotPassword.submit }));

    expect(await screen.findByText(t(fr.forgotPassword.sent, { email: 'lea@x.fr' }))).toBeTruthy();
    expect(fakeAuth.requestPasswordReset).toHaveBeenCalledWith({ email: 'lea@x.fr', redirectTo: `${window.location.origin}/reinitialiser` });
    expect(screen.getByRole('link', { name: fr.forgotPassword.backToLogin }).getAttribute('href')).toBe('/connexion');
  });

  test('trop de demandes (429) → message, le formulaire reste là', async () => {
    fakeAuth.requestPasswordReset.mockResolvedValue({ data: null, error: { status: 429 } });
    const user = userEvent.setup();
    renderRoute('/mot-de-passe-oublie');
    await user.type(await screen.findByLabelText(fr.forgotPassword.email), 'lea@x.fr');
    await user.click(screen.getByRole('button', { name: fr.forgotPassword.submit }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', fr.common.errors.tooManyAttempts);
    expect(screen.getByLabelText(fr.forgotPassword.email)).toBeTruthy();
  });
});

describe('nouveau mot de passe', () => {
  test('bouton actif à partir de 10 caractères ; une fois changé, retour à la connexion avec un message', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/reinitialiser?token=jeton-reset');
    const password = await screen.findByLabelText(fr.resetPassword.password);
    const submit = screen.getByRole('button', { name: fr.resetPassword.submit });

    await user.type(password, '123456789');
    expect(submit).toHaveProperty('disabled', true);
    await user.type(password, '0');
    await user.click(submit);

    expect(await screen.findByText(fr.login.passwordChanged)).toBeTruthy();
    expect(router.state.location.pathname).toBe('/connexion');
    expect(fakeAuth.resetPassword).toHaveBeenCalledWith({ newPassword: '1234567890', token: 'jeton-reset' });
  });

  // Better Auth renvoie vers /reinitialiser?error=INVALID_TOKEN un lien expiré ou déjà servi.
  test.each(['/reinitialiser?error=INVALID_TOKEN', '/reinitialiser'])('%s → lien invalide, avec de quoi en demander un autre', async (path) => {
    renderRoute(path);
    expect(await screen.findByText(fr.resetPassword.invalidLink)).toBeTruthy();
    expect(screen.queryByLabelText(fr.resetPassword.password)).toBeNull();
    expect(screen.getByRole('link', { name: fr.resetPassword.requestNewLink }).getAttribute('href')).toBe('/mot-de-passe-oublie');
  });

  test('jeton refusé à l\'envoi (expiré entre-temps) → lien invalide', async () => {
    fakeAuth.resetPassword.mockResolvedValue({ data: null, error: { status: 400, code: 'INVALID_TOKEN' } });
    const user = userEvent.setup();
    renderRoute('/reinitialiser?token=jeton-reset');
    await user.type(await screen.findByLabelText(fr.resetPassword.password), 'motdepasse1');
    await user.click(screen.getByRole('button', { name: fr.resetPassword.submit }));
    expect(await screen.findByText(fr.resetPassword.invalidLink)).toBeTruthy();
  });
});
