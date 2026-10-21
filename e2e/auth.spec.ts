import { expect, test } from '@playwright/test';
import { createInvitation, enterOffice, expectInOffice, inviteAndJoin, joinWithLink, lastMail, officeBar, signIn, signOut, submitJoinForm, uniqueEmail } from './helpers';

test('invitation → compte → bureau → déconnexion → connexion', async ({ page }) => {
  const lea = { email: uniqueEmail('lea'), name: 'Léa', password: 'motdepasse-de-lea' };
  await inviteAndJoin(page, lea);
  // Le bureau est à Léa : son nom est dans la barre du bas, et le serveur du bureau lui a dit son statut (la connexion temps réel est
  // ouverte, sous sa session).
  await expectInOffice(page, 'Léa');
  await expect(officeBar(page).getByRole('button', { name: 'Statut : Disponible' })).toBeVisible();
  await expect(page).toHaveURL('/');

  await signOut(page);
  await expect(page).toHaveURL('/connexion');
  // La session est bien fermée : le bureau renvoie à la connexion.
  await page.goto('/');
  await expect(page).toHaveURL('/connexion');

  await signIn(page, lea);
  await expect(page).toHaveURL('/');
  // La session survit à un rechargement de la page (cookie) : l'écran d'entrée, puis le bureau.
  await page.reload();
  await enterOffice(page);
  await expectInOffice(page, 'Léa');
  await expect(officeBar(page).getByRole('button', { name: 'Statut : Disponible' })).toBeVisible();
});

test('mot de passe oublié de bout en bout', async ({ page }) => {
  const max = { email: uniqueEmail('max'), name: 'Max', password: 'ancien-motdepasse' };
  await inviteAndJoin(page, max);
  await signOut(page);

  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  // La page de connexion a aussi un champ « Adresse e-mail » : on attend la nouvelle page avant de remplir le sien.
  await expect(page.getByRole('heading', { name: 'Mot de passe oublié' })).toBeVisible();
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(max.email);
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  await expect(page.getByText(`Si un compte existe pour ${max.email}`)).toBeVisible();

  // L'e-mail part en arrière-plan : on attend qu'il soit là, puis on ouvre son lien comme le ferait Max.
  await expect.poll(async () => (await lastMail(page.request, max.email))?.subject).toBe('Réinitialiser ton mot de passe');
  const mail = await lastMail(page.request, max.email);
  await page.goto(mail!.link);
  await expect(page).toHaveURL(/\/reinitialiser\?token=/);

  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('nouveau-motdepasse');
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await expect(page.getByText('Ton mot de passe a été changé')).toBeVisible();
  await expect(page).toHaveURL('/connexion');

  // L'ancien mot de passe ne marche plus, le nouveau si.
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(max.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(max.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toHaveText('Adresse e-mail ou mot de passe incorrect.');
  await signIn(page, { ...max, password: 'nouveau-motdepasse' });

  // Le lien de l'e-mail ne sert qu'une fois.
  await page.goto(mail!.link);
  await expect(page.getByText('Ce lien n\'est plus valable')).toBeVisible();
});

test('lien réutilisé → message « déjà utilisé »', async ({ page }) => {
  const link = await createInvitation(page.request, uniqueEmail('zoe'));
  await joinWithLink(page, link, { name: 'Zoé', password: 'motdepasse-de-zoe' });

  await page.goto(link);
  await expect(page.getByText(/déjà utilisé/)).toBeVisible();
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveCount(0);
  // Zoé est toujours connectée : la page la renvoie à son bureau.
  await page.getByRole('link', { name: 'Aller au bureau' }).click();
  await enterOffice(page);
  await expectInOffice(page, 'Zoé');
});

test('lien d\'invitation ouvert en étant connecté avec un autre compte : déconnexion d\'abord, sans mélange de comptes', async ({ page }) => {
  const lea = { email: uniqueEmail('lea'), name: 'Léa', password: 'motdepasse-de-lea' };
  await inviteAndJoin(page, lea);

  const link = await createInvitation(page.request, uniqueEmail('sam'));
  await page.goto(link);
  await expect(page.getByText(`Ce navigateur est connecté au compte ${lea.email}`)).toBeVisible();
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Se déconnecter et continuer' }).click();

  // Le formulaire apparaît une fois Léa déconnectée.
  await submitJoinForm(page, { name: 'Sam', password: 'motdepasse-de-sam' });
  // Léa n'a rien perdu : son compte marche toujours.
  await signOut(page);
  await signIn(page, lea);
});
