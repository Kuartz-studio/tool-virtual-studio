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

// ---- Le bureau ----------------------------------------------------------------------------------------------------------------
//
// La carte de développement (packages/shared/src/map/dev-office.ts) : 24 × 16 cases de 32 px. L'apparition est au centre de la case
// (2, 7), soit (80, 240) en pixels, dans l'open space. Les x et y d'un avatar sont ceux de ses pieds, en pixels de la carte. Le jeu
// expose son état dans window.__office (apps/client/src/game/debug.ts).

// Le temps qu'on laisse à l'avatar pour marcher jusqu'à un endroit (la marche la plus longue : 2 s). Une machine chargée fait tourner le
// jeu plus lentement que l'horloge (Phaser ne laisse pas une image durer plus de 200 ms) : on ne veut pas d'échec pour cela.
export const WALK_TIMEOUT = 20_000;

// Où est l'avatar local (window.__office.self, tenu à jour par la scène à chaque image).
export async function selfAt(page: Page): Promise<{ id: string; x: number; y: number }> {
  const self = await page.evaluate(() => window.__office?.self ?? null);
  if (!self) throw new Error('window.__office.self est vide : le bureau n\'a pas d\'avatar local.');
  return self;
}

// Un compte neuf, dans le bureau prêt. Renvoie le compte (pour se reconnecter).
export async function joinOffice(page: Page, name: string): Promise<Account> {
  // L'adresse e-mail n'a pas d'accent : « Zoé » devient zoe.
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const account = { email: uniqueEmail(slug), name, password: `motdepasse-de-${slug}` };
  await inviteAndJoin(page, account);
  await waitForOffice(page);
  return account;
}

// Attend le bureau prêt (le serveur a envoyé son état, la carte est construite), puis un moment de jeu.
export async function waitForOffice(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__office?.ready);
  // Les premières images, qui compilent les shaders et envoient les textures à la carte graphique, sont les plus lentes. Une marche
  // qui commence là serait plus courte que prévu : on attend que le jeu ait tourné un moment.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => (++frames >= 30 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
}

// Garde cette touche enfoncée jusqu'à ce que `reached` soit vrai, puis la relâche.
export async function holdUntil(page: Page, key: string, reached: (feet: { x: number; y: number }) => boolean): Promise<void> {
  await page.keyboard.down(key);
  await expect.poll(async () => reached(await selfAt(page)), { intervals: [15], timeout: WALK_TIMEOUT }).toBe(true);
  await page.keyboard.up(key);
}

// Garde cette touche enfoncée jusqu'à ce que l'avatar ne bouge plus (un mur l'arrête), puis la relâche. Renvoie où il s'est arrêté.
export async function holdUntilStopped(page: Page, key: string): Promise<{ x: number; y: number }> {
  await page.keyboard.down(key);
  let { x, y } = await selfAt(page);
  for (let still = 0, tries = 0; still < 6; tries++) {
    if (tries > 300) throw new Error(`L'avatar bouge encore après 30 s, ${key} enfoncée.`);
    await page.waitForTimeout(100);
    const now = await selfAt(page);
    still = now.x === x && now.y === y ? still + 1 : 0;
    ({ x, y } = now);
  }
  await page.keyboard.up(key);
  return { x, y };
}

// Où est l'avatar une fois arrêté : l'image qui suit le relâchement d'une touche peut encore le faire avancer de quelques pixels.
export async function restingAt(page: Page): Promise<{ id: string; x: number; y: number }> {
  let last = await selfAt(page);
  for (let still = 0, tries = 0; still < 3; tries++) {
    if (tries > 300) throw new Error('L\'avatar bouge encore après 15 s.');
    await page.waitForTimeout(50);
    const now = await selfAt(page);
    still = now.x === last.x && now.y === last.y ? still + 1 : 0;
    last = now;
  }
  return last;
}

// Un autre joueur tel que cette page le dessine (window.__office.players), ou null s'il n'y est pas.
export async function playerSeenBy(page: Page, id: string): Promise<{ x: number; y: number; avatarKey: string | null } | null> {
  return page.evaluate((playerId) => window.__office?.players[playerId] ?? null, id);
}

// Le nombre d'avatars que cette page dessine pour ce joueur.
export async function avatarsOf(page: Page, id: string): Promise<number> {
  return page.evaluate((playerId) => window.__office?.avatarsOf(playerId) ?? 0, id);
}
