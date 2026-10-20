import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { adminToggle, joinOffice, joinWithLink, lastMail, officeBar, restingAt, selfAt, uniqueEmail, WALK_TIMEOUT, type Account } from './helpers';

// Le panneau Admin de bout en bout : inviter, les invitations en attente, retirer un membre. Chaque personne a son navigateur (un contexte :
// ses cookies, donc sa session). Tous les tests partagent le serveur, et donc ses membres : chacun ne cherche dans les listes que les
// siens, par leur adresse e-mail (uniqueEmail), et ne retire que le sien.
//
// L'admin est un compte créé par la route de test (l'invitation porte le rôle « admin »), comme n'importe quel compte de ces tests : que
// le bouton Admin soit dans sa barre prouve que le rôle va de l'invitation au compte, à la session, puis à l'interface.

// Ce qui passe par le serveur d'un navigateur à l'autre (un membre qui entre, une page déconnectée) peut mettre plus que les 5 s par défaut
// sur une machine chargée (les autres fichiers jouent en même temps).
const PROPAGATION = { timeout: 15_000 };

interface Person {
  context: BrowserContext;
  page: Page;
  account: Account;
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Une personne de plus, dans le bureau.
async function arrive(browser: Browser, name: string, role: 'admin' | 'member' = 'member'): Promise<Person> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const account = await joinOffice(page, name, role);
  return { context, page, account };
}

// Un navigateur sans compte, pour ouvrir un lien d'invitation.
async function arriveWithoutAccount(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  return context.newPage();
}

// Ouvre le panneau Admin de cette page, et le renvoie : ses deux listes sont arrivées.
async function openAdmin(page: Page): Promise<Locator> {
  await adminToggle(page).click();
  const panel = page.getByRole('complementary', { name: 'Admin' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('region', { name: /^Membres \(\d+\)$/ })).toBeVisible();
  await expect(panel.getByRole('region', { name: /^Invitations en attente \(\d+\)$/ })).toBeVisible();
  return panel;
}

// Les trois sections du panneau.
function sectionsOf(panel: Locator) {
  return {
    invite: panel.getByRole('region', { name: 'Inviter', exact: true }),
    pending: panel.getByRole('region', { name: /^Invitations en attente/ }),
    members: panel.getByRole('region', { name: /^Membres/ }),
  };
}

// La ligne de cette adresse dans une liste.
const rowOf = (section: Locator, email: string) => section.getByRole('listitem').filter({ hasText: email });

test('l\'admin invite → le lien d\'e-mail de test → le nouveau membre entre et apparaît dans la liste', async ({ browser }) => {
  test.slow();   // deux personnes dans deux navigateurs : plus de 20 s sur une machine chargée
  const admin = await arrive(browser, 'Adèle', 'admin');
  const panel = await openAdmin(admin.page);
  const { invite, pending, members } = sectionsOf(panel);
  const field = invite.getByLabel('Adresse e-mail');
  const send = invite.getByRole('button', { name: 'Envoyer l\'invitation' });
  const email = uniqueEmail('nina');

  // Elle s'invite : le serveur répond, le champ se vide, et l'invitation est dans la liste des invitations en attente (relue).
  await field.fill(email);
  await send.click();
  await expect(invite.getByText(`Invitation envoyée à ${email}.`)).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  const waiting = rowOf(pending, email);
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText('Membre');
  await expect(waiting).not.toContainText('expirée');

  // La même adresse une seconde fois : le serveur refuse (409), le message est dit, et l'adresse reste dans le champ.
  await field.fill(email);
  await send.click();
  await expect(invite.getByRole('alert')).toHaveText('Une invitation est déjà en attente pour cette adresse.');
  await expect(field).toHaveValue(email);
  await expect(rowOf(pending, email)).toHaveCount(1);

  // Le serveur a « envoyé » l'e-mail (mailer en mémoire des tests) : c'est le lien de la page « Rejoindre ».
  await expect.poll(async () => (await lastMail(admin.page.request, email))?.subject, PROPAGATION).toBe('Invitation au bureau virtuel');
  const mail = await lastMail(admin.page.request, email);
  expect(mail!.link).toMatch(/\/rejoindre\?token=/);

  // Nina ouvre le lien dans son navigateur, crée son compte et entre au bureau.
  const nina = await browser.newContext();
  contexts.push(nina);
  const ninaPage = await nina.newPage();
  await joinWithLink(ninaPage, mail!.link, { name: 'Nina', password: 'motdepasse-de-nina' });

  // Le panneau de l'admin, resté ouvert, se met à jour tout seul : l'invitation n'est plus en attente, Nina est dans les membres.
  const nowMember = rowOf(members, email);
  await expect(nowMember).toBeVisible(PROPAGATION);
  await expect(nowMember).toContainText('Nina');
  await expect(nowMember).toContainText('Membre');
  await expect(rowOf(pending, email)).toHaveCount(0);
  await expect(nowMember.getByRole('button', { name: 'Retirer Nina' })).toBeVisible();
  // L'admin ne peut pas se retirer elle-même : sa ligne est « (toi) », sans bouton.
  const own = rowOf(members, admin.account.email);
  await expect(own).toContainText('(toi)');
  await expect(own).toContainText('Admin');
  await expect(own.getByRole('button')).toHaveCount(0);

  // Nina est un membre : ni bouton Admin, ni accès aux routes admin.
  await expect(officeBar(ninaPage).getByRole('button', { name: 'Personnes' })).toBeVisible();
  await expect(adminToggle(ninaPage)).toHaveCount(0);
  expect((await ninaPage.request.get('/api/admin/members')).status()).toBe(403);
});

test('une invitation en attente se renvoie (nouvel e-mail, nouveau lien) et s\'annule (le lien ne marche plus)', async ({ browser }) => {
  test.slow();
  const admin = await arrive(browser, 'Alix', 'admin');
  const panel = await openAdmin(admin.page);
  const { invite, pending } = sectionsOf(panel);
  const email = uniqueEmail('hugo');

  // Inviter un admin : son rôle est dit dans la liste.
  await invite.getByLabel('Adresse e-mail').fill(email);
  await invite.getByLabel('Rôle').selectOption({ label: 'Admin' });
  await invite.getByRole('button', { name: 'Envoyer l\'invitation' }).click();
  const waiting = rowOf(pending, email);
  await expect(waiting).toContainText('Admin');
  await expect(invite.getByLabel('Rôle')).toHaveValue('member');
  await expect.poll(async () => (await lastMail(admin.page.request, email))?.link, PROPAGATION).toBeTruthy();
  const first = (await lastMail(admin.page.request, email))!;

  // Renvoyer : un deuxième e-mail, avec un autre lien (l'ancien ne sert plus).
  await waiting.getByRole('button', { name: `Renvoyer l'invitation à ${email}` }).click();
  await expect(pending.getByText(`Invitation renvoyée à ${email}.`)).toBeVisible();
  await expect.poll(async () => (await lastMail(admin.page.request, email))?.link, PROPAGATION).not.toBe(first.link);
  const second = (await lastMail(admin.page.request, email))!;
  const stranger = await arriveWithoutAccount(browser);
  await stranger.goto(first.link);
  await expect(stranger.getByText('Ce lien d\'invitation n\'est pas valable.')).toBeVisible();

  // Annuler : la ligne disparaît, le focus passe au titre de la section, et le lien du dernier e-mail ne marche plus.
  await waiting.getByRole('button', { name: `Annuler l'invitation de ${email}` }).click();
  await expect(rowOf(pending, email)).toHaveCount(0);
  await expect(pending.getByText(`Invitation à ${email} annulée.`)).toBeVisible();
  await expect(pending.getByRole('heading')).toBeFocused();
  await stranger.goto(second.link);
  await expect(stranger.getByText('Cette invitation a été annulée.')).toBeVisible();
});

test('l\'admin retire un membre → la page du membre est déconnectée ; après rechargement → /connexion', async ({ browser }) => {
  test.slow();
  const admin = await arrive(browser, 'Adrien', 'admin');
  const member = await arrive(browser, 'Bastien');
  const panel = await openAdmin(admin.page);
  const { members } = sectionsOf(panel);
  const row = rowOf(members, member.account.email);
  await expect(row).toBeVisible();

  // Une confirmation, qui nomme la personne ; le focus est sur « Annuler », le geste sûr.
  await row.getByRole('button', { name: 'Retirer Bastien' }).click();
  const dialog = admin.page.getByRole('alertdialog', { name: 'Retirer Bastien ?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(member.account.email);
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  // Tab ne sort pas de la boîte.
  await admin.page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Retirer', exact: true })).toBeFocused();
  await admin.page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();

  // Dans la boîte, le clavier n'est plus celui de l'avatar : flèches et ZQSD (KeyW, KeyA, KeyS, KeyD) le laissent où il est.
  const start = await restingAt(admin.page);
  for (const key of ['ArrowRight', 'ArrowDown', 'KeyD', 'KeyS']) await admin.page.keyboard.press(key, { delay: 300 });
  const stayed = await restingAt(admin.page);
  expect({ x: stayed.x, y: stayed.y }).toEqual({ x: start.x, y: start.y });

  // Échap renonce : Bastien est toujours là, et toujours au bureau.
  await admin.page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Retirer Bastien' })).toBeFocused();
  await expect(member.page).toHaveURL('/');
  await expect(officeBar(member.page)).toBeVisible();
  // La boîte fermée, la même touche fait marcher l'avatar (le test éprouve donc bien ce qu'il dit).
  await admin.page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(admin.page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(start.x);
  await admin.page.keyboard.up('ArrowRight');

  // Confirmé : Bastien n'est plus dans la liste, et le panneau le dit.
  await row.getByRole('button', { name: 'Retirer Bastien' }).click();
  await dialog.getByRole('button', { name: 'Retirer', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rowOf(members, member.account.email)).toHaveCount(0);
  await expect(members.getByText('Bastien ne fait plus partie du bureau.')).toBeVisible();
  await expect(members.getByRole('heading')).toBeFocused();

  // Sa page est déconnectée sans attendre qu'il fasse quoi que ce soit : le serveur a coupé sa connexion au bureau, et refuse la suivante.
  await expect(member.page).toHaveURL('/connexion', PROPAGATION);
  // Après un rechargement, le bureau renvoie à la connexion : sa session n'existe plus.
  await member.page.goto('/');
  await expect(member.page).toHaveURL('/connexion');
  await member.page.reload();
  await expect(member.page).toHaveURL('/connexion');
  // Et il ne peut plus se connecter : son compte est désactivé.
  await member.page.getByLabel('Adresse e-mail', { exact: true }).fill(member.account.email);
  await member.page.getByLabel('Mot de passe', { exact: true }).fill(member.account.password);
  await member.page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(member.page.getByRole('alert')).toHaveText('Ce compte a été désactivé.');
  // Son adresse ne peut plus être invitée (le compte existe, retiré ou non).
  await panel.getByRole('region', { name: 'Inviter', exact: true }).getByLabel('Adresse e-mail').fill(member.account.email);
  await panel.getByRole('region', { name: 'Inviter', exact: true }).getByRole('button', { name: 'Envoyer l\'invitation' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Cette adresse a déjà un compte (actif ou retiré).');
});

test('un membre n\'a pas de bouton Admin, ni panneau, et le serveur lui refuse /api/admin ; l\'admin y a accès', async ({ browser }) => {
  test.slow();
  const member = await arrive(browser, 'Maëlle');
  const admin = await arrive(browser, 'Axelle', 'admin');

  await expect(adminToggle(member.page)).toHaveCount(0);
  await expect(member.page.getByRole('complementary', { name: 'Admin' })).toHaveCount(0);
  const refused = await member.page.request.get('/api/admin/invitations');
  expect(refused.status()).toBe(403);

  await expect(adminToggle(admin.page)).toBeVisible();
  const allowed = await admin.page.request.get('/api/admin/members');
  expect(allowed.status()).toBe(200);
  expect(((await allowed.json()) as Array<{ email: string }>).map((m) => m.email)).toContain(member.account.email);
});
