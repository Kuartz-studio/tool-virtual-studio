import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface Account {
  email: string;
  name: string;
  password: string;
}

// Une adresse propre à ce test : tous les tests d'une exécution partagent la base du serveur e2e.
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

// Crée une invitation par la route de test (E2E=1) et renvoie le lien que l'e-mail contiendrait.
export async function createInvitation(request: APIRequestContext, email: string, role: 'admin' | 'member' = 'member'): Promise<string> {
  const res = await request.post('/api/test/invitations', { data: { email, role } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { link: string }).link;
}

// Le dernier e-mail envoyé à cette adresse (route de test), ou null s'il n'y en a pas encore.
export async function lastMail(request: APIRequestContext, to: string): Promise<{ subject: string; link: string } | null> {
  const res = await request.get('/api/test/mails/last', { params: { to } });
  return res.ok() ? ((await res.json()) as { subject: string; link: string }) : null;
}

// Remplit le formulaire de la page « Rejoindre » (déjà ouverte, ou qui va s'afficher), crée le compte et attend le bureau.
export async function submitJoinForm(page: Page, { name, password }: Pick<Account, 'name' | 'password'>): Promise<void> {
  await page.getByLabel('Nom affiché', { exact: true }).fill(name);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByText(`Bonjour ${name}`)).toBeVisible();
}

// Ouvre un lien d'invitation, crée le compte et attend le bureau.
export async function joinWithLink(page: Page, link: string, account: Pick<Account, 'name' | 'password'>): Promise<void> {
  await page.goto(link);
  await submitJoinForm(page, account);
}

// Invite cette adresse, crée son compte depuis le lien de l'invitation, et attend le bureau : la page reste connectée.
export async function inviteAndJoin(page: Page, { email, name, password }: Account): Promise<void> {
  await joinWithLink(page, await createInvitation(page.request, email), { name, password });
}

// Se connecte depuis la page de connexion et attend le bureau.
export async function signIn(page: Page, { email, password, name }: Account): Promise<void> {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText(`Bonjour ${name}`)).toBeVisible();
}
