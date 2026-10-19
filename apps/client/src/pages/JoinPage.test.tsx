import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { fakeApi, json, sentBody } from '../test/fake-api';
import { fakeAuth, resetFakeAuth, setFakeSession } from '../test/fake-auth-client';
import { renderRoute } from '../test/render';

vi.mock('../lib/auth-client', () => import('../test/fake-auth-client'));

beforeEach(() => {
  resetFakeAuth();
});

const LEA = { id: 'u-lea', name: 'Léa', email: 'lea@x.fr' };
const MAX = { id: 'u-max', name: 'Max', email: 'max@x.fr' };

// GET /api/invitations/tok répond ceci.
function invitation(status: number, body: unknown, more: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({ 'GET /api/invitations/tok': () => json(status, body), ...more });
}

test('affiche l\'e-mail invité ; bouton actif à partir de 10 caractères', async () => {
  invitation(200, { email: 'lea@x.fr' });
  const user = userEvent.setup();
  renderRoute('/rejoindre?token=tok');

  // L'adresse vient de l'invitation : affichée, pas modifiable.
  const email = await screen.findByLabelText(fr.join.email);
  expect(email).toHaveProperty('value', 'lea@x.fr');
  expect(email).toHaveProperty('readOnly', true);

  const submit = screen.getByRole('button', { name: fr.join.submit });
  await user.type(screen.getByLabelText(fr.join.name), 'Léa');
  await user.type(screen.getByLabelText(fr.join.password), '123456789');
  expect(submit).toHaveProperty('disabled', true);
  await user.type(screen.getByLabelText(fr.join.password), '0');
  expect(submit).toHaveProperty('disabled', false);

  // Un nom fait d'espaces ne compte pas.
  await user.clear(screen.getByLabelText(fr.join.name));
  await user.type(screen.getByLabelText(fr.join.name), '   ');
  expect(submit).toHaveProperty('disabled', true);
});

test('lien déjà utilisé → message fr.join.errors.used', async () => {
  invitation(410, { error: 'used' });
  renderRoute('/rejoindre?token=tok');

  expect(await screen.findByText(fr.join.errors.used)).toBeTruthy();
  expect(screen.queryByLabelText(fr.join.password)).toBeNull();
  expect(screen.getByRole('link', { name: fr.join.goToLogin }).getAttribute('href')).toBe('/connexion');
});

// Le cas d'un lien rouvert juste après avoir créé son compte : la page de connexion n'aurait rien à faire.
test('lien déjà utilisé, ce navigateur étant connecté → lien vers le bureau plutôt que vers la connexion', async () => {
  invitation(410, { error: 'used' });
  setFakeSession(LEA);
  renderRoute('/rejoindre?token=tok');

  expect(await screen.findByText(fr.join.errors.used)).toBeTruthy();
  expect((await screen.findByRole('link', { name: fr.join.goToOffice })).getAttribute('href')).toBe('/');
  expect(screen.queryByRole('link', { name: fr.join.goToLogin })).toBeNull();
});

test('déjà connecté avec un autre compte → fr.join.signedInAs et bouton « Se déconnecter et continuer »', async () => {
  invitation(200, { email: 'lea@x.fr' });
  setFakeSession(MAX);
  const user = userEvent.setup();
  renderRoute('/rejoindre?token=tok');

  expect(await screen.findByText(t(fr.join.signedInAs, { email: 'max@x.fr' }))).toBeTruthy();
  // Pas de formulaire tant que ce navigateur est connecté : créer le compte remplacerait la session de Max.
  expect(screen.queryByLabelText(fr.join.password)).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Se déconnecter et continuer' }));
  expect(fakeAuth.signOut).toHaveBeenCalledOnce();
  expect(await screen.findByLabelText(fr.join.password)).toBeTruthy();
  expect(screen.getByLabelText(fr.join.email)).toHaveProperty('value', 'lea@x.fr');
});

test('création du compte → le jeton, le nom et le mot de passe partent au serveur, puis le bureau s\'ouvre', async () => {
  const api = invitation(200, { email: 'lea@x.fr' }, {
    // Le serveur crée le compte et pose le cookie de session.
    'POST /api/invitations/accept': () => {
      setFakeSession(LEA);
      return json(201, { ok: true });
    },
  });
  const user = userEvent.setup();
  const router = renderRoute('/rejoindre?token=tok');

  await user.type(await screen.findByLabelText(fr.join.name), ' Léa ');
  await user.type(screen.getByLabelText(fr.join.password), 'motdepasse1');
  await user.click(screen.getByRole('button', { name: fr.join.submit }));

  expect(await screen.findByText('Bonjour Léa')).toBeTruthy();
  expect(router.state.location.pathname).toBe('/');
  expect(sentBody(api, 'POST /api/invitations/accept')).toEqual({ token: 'tok', name: 'Léa', password: 'motdepasse1' });
});

describe('invitation inutilisable', () => {
  test.each([
    [410, 'expired', fr.join.errors.expired],
    [410, 'revoked', fr.join.errors.revoked],
    [404, 'unknown', fr.join.errors.unknown],
  ])('GET → %i %s : message, sans formulaire', async (status, error, message) => {
    invitation(status, { error });
    renderRoute('/rejoindre?token=tok');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByLabelText(fr.join.password)).toBeNull();
  });

  test('lien sans jeton → message, sans appel au serveur', async () => {
    const api = fakeApi({});
    renderRoute('/rejoindre');
    expect(await screen.findByText(fr.join.errors.missingToken)).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  test('serveur injoignable → message réseau et « Réessayer »', async () => {
    let attempts = 0;
    fakeApi({
      'GET /api/invitations/tok': () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return json(200, { email: 'lea@x.fr' });
      },
    });
    const user = userEvent.setup();
    renderRoute('/rejoindre?token=tok');

    expect(await screen.findByText(fr.common.errors.network)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: fr.common.retry }));
    expect(await screen.findByLabelText(fr.join.password)).toBeTruthy();
  });
});

describe('refus à la création du compte', () => {
  async function submitForm() {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(fr.join.name), 'Léa');
    await user.type(screen.getByLabelText(fr.join.password), 'motdepasse1');
    await user.click(screen.getByRole('button', { name: fr.join.submit }));
  }

  test('409 already_member → message et lien vers la connexion', async () => {
    invitation(200, { email: 'lea@x.fr' }, { 'POST /api/invitations/accept': () => json(409, { error: 'already_member' }) });
    renderRoute('/rejoindre?token=tok');
    await submitForm();
    expect(await screen.findByText(fr.join.errors.alreadyMember)).toBeTruthy();
    expect(screen.queryByLabelText(fr.join.password)).toBeNull();
    expect(screen.getByRole('link', { name: fr.join.goToLogin })).toBeTruthy();
  });

  test('410 used (lien utilisé entre-temps, dans un autre onglet) → message fr.join.errors.used', async () => {
    invitation(200, { email: 'lea@x.fr' }, { 'POST /api/invitations/accept': () => json(410, { error: 'used' }) });
    renderRoute('/rejoindre?token=tok');
    await submitForm();
    expect(await screen.findByText(fr.join.errors.used)).toBeTruthy();
    expect(screen.queryByLabelText(fr.join.password)).toBeNull();
  });

  test('400 invalid → message sous le formulaire, qui reste là', async () => {
    invitation(200, { email: 'lea@x.fr' }, { 'POST /api/invitations/accept': () => json(400, { error: 'invalid' }) });
    renderRoute('/rejoindre?token=tok');
    await submitForm();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', t(fr.join.errors.invalid, { maxName: 40, minPassword: 10, maxPassword: 128 }));
    expect(screen.getByLabelText(fr.join.password)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: fr.join.submit })).toHaveProperty('disabled', false));
  });

  test('erreur du serveur (500) → message générique, le formulaire reste là', async () => {
    invitation(200, { email: 'lea@x.fr' }, { 'POST /api/invitations/accept': () => json(500, { error: 'internal' }) });
    renderRoute('/rejoindre?token=tok');
    await submitForm();
    expect(await screen.findByText(fr.common.errors.unexpected)).toBeTruthy();
    expect(screen.getByLabelText(fr.join.password)).toBeTruthy();
  });
});
