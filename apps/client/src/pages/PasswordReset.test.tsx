import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { fakeApi, json } from '../test/fake-api';
import { fakeAuth, resetFakeAuth } from '../test/fake-auth-client';
import { renderRoute } from '../test/render';

vi.mock('../lib/auth-client', () => import('../test/fake-auth-client'));

beforeEach(() => {
  resetFakeAuth();
});

// La page lit GET /api/config une fois (lib/config.ts) : ici, un serveur qui envoie des e-mails.
function serveConfig(mail = 'resend') {
  return fakeApi({ 'GET /api/config': () => json(200, { mail }) });
}

describe('mot de passe oublié', () => {
  beforeEach(() => {
    serveConfig();
  });

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

// MAILER=none : aucun e-mail ne part, la page ne peut rien promettre. Un admin envoie le lien (panneau Admin, « Lien de mot de passe »).
describe('mot de passe oublié, serveur sans e-mail', () => {
  test('la page le dit à la place du formulaire, avec un lien vers la connexion', async () => {
    serveConfig('none');
    renderRoute('/mot-de-passe-oublie');

    expect(await screen.findByText(fr.forgotPassword.noMail)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: fr.forgotPassword.title })).toBeTruthy();
    expect(screen.queryByLabelText(fr.forgotPassword.email)).toBeNull();
    expect(screen.queryByRole('button', { name: fr.forgotPassword.submit })).toBeNull();
    expect(screen.queryByText(fr.forgotPassword.intro)).toBeNull();
    expect(screen.getByRole('link', { name: fr.forgotPassword.backToLogin }).getAttribute('href')).toBe('/connexion');
    expect(fakeAuth.requestPasswordReset).not.toHaveBeenCalled();
  });

  test('le texte est celui qu\'on attend', () => {
    expect(fr.forgotPassword.noMail).toBe('Les e-mails ne sont pas activés sur ce bureau. Demande à un admin de t\'envoyer un lien de réinitialisation.');
  });

  test.each(['resend', 'memory'])('avec MAILER=%s : le formulaire d\'avant, sans le message', async (mail) => {
    serveConfig(mail);
    renderRoute('/mot-de-passe-oublie');
    expect(await screen.findByLabelText(fr.forgotPassword.email)).toBeTruthy();
    // La lecture de la configuration est finie quand le message d'absence d'e-mail aurait pu apparaître.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(fr.forgotPassword.noMail)).toBeNull();
    expect(screen.getByRole('button', { name: fr.forgotPassword.submit })).toBeTruthy();
  });

  test.each([
    ['le serveur répond 500', () => json(500, { error: 'internal' })],
    ['la réponse n\'a pas la forme attendue', () => json(200, { mail: 'sms' })],
    ['le serveur ne répond pas', () => {
      throw new TypeError('Failed to fetch');
    }],
  ])('si la configuration ne se lit pas (%s) : le formulaire d\'avant', async (_name, reply) => {
    fakeApi({ 'GET /api/config': reply });
    const user = userEvent.setup();
    renderRoute('/mot-de-passe-oublie');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await user.type(await screen.findByLabelText(fr.forgotPassword.email), 'lea@x.fr');
    await user.click(screen.getByRole('button', { name: fr.forgotPassword.submit }));
    expect(await screen.findByText(t(fr.forgotPassword.sent, { email: 'lea@x.fr' }))).toBeTruthy();
    expect(screen.queryByText(fr.forgotPassword.noMail)).toBeNull();
  });

  test('la configuration n\'est lue qu\'une fois : revenir sur la page ne la relit pas', async () => {
    const api = serveConfig('none');
    const router = renderRoute('/mot-de-passe-oublie');
    expect(await screen.findByText(fr.forgotPassword.noMail)).toBeTruthy();

    await act(async () => {
      await router.navigate('/connexion');
    });
    await screen.findByLabelText(fr.login.email);
    await act(async () => {
      await router.navigate('/mot-de-passe-oublie');
    });
    expect(screen.getByText(fr.forgotPassword.noMail)).toBeTruthy();   // tout de suite : elle est déjà connue
    expect(api.mock.calls.filter(([input]) => String(input) === '/api/config')).toHaveLength(1);
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
