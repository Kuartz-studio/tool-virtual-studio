import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { TEST_AVATAR_KEY } from './pixels';

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

// La barre du bas du bureau (le groupe « Barre du bureau »), faite de docks : à gauche la puce « Moi » (le portrait, le nom, et le mode ou le
// statut de la personne) ; au milieu micro, caméra et partage d'écran, puis la musique et le bureau ; à droite le zoom, Chat, Personnes et « Plus ».
export function officeBar(page: Page): Locator {
  return page.getByRole('group', { name: 'Barre du bureau' });
}

// La puce « Moi » : un bouton nommé « Mon profil », qui montre le nom et, dessous, le mode en cours, sinon le statut (que le serveur a confirmé).
export function meChip(page: Page): Locator {
  return officeBar(page).getByRole('button', { name: 'Mon profil', exact: true });
}

// Ouvre le menu de la puce « Moi » de cette page, et le renvoie : le statut, le mode, l'apparence et Se déconnecter.
export async function openMeMenu(page: Page): Promise<Locator> {
  await meChip(page).click();
  const menu = page.getByRole('menu', { name: 'Menu de mon profil' });
  await expect(menu).toBeVisible();
  return menu;
}

// La ligne de ce nom dans le menu « Moi », que cette fonction ouvre : à l'appelant de la choisir (ou de fermer le menu avec Échap).
export async function meMenuEntry(page: Page, name: string): Promise<Locator> {
  return (await openMeMenu(page)).getByRole('menuitem', { name, exact: true });
}

// Choisit ce statut dans le menu « Moi » (qui se referme), et attend que le serveur l'ait confirmé : la puce le dit alors.
export async function chooseStatus(page: Page, label: string): Promise<void> {
  await (await openMeMenu(page)).getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect(meChip(page)).toContainText(label);
}

// Le bouton « Plus » de la barre : son menu a la déco, l'Admin (pour un admin) et le zoom de départ.
export function moreButton(page: Page): Locator {
  return officeBar(page).getByRole('button', { name: 'Plus', exact: true });
}

// Ouvre le menu « Plus » de cette page, et le renvoie.
export async function openMoreMenu(page: Page): Promise<Locator> {
  await moreButton(page).click();
  const menu = page.getByRole('menu', { name: 'Plus d\'options' });
  await expect(menu).toBeVisible();
  return menu;
}

// La ligne de ce nom dans le menu « Plus », que cette fonction ouvre : à l'appelant de la choisir (ou de fermer le menu avec Échap).
export async function moreMenuEntry(page: Page, name: string): Promise<Locator> {
  return (await openMoreMenu(page)).getByRole('menuitem', { name, exact: true });
}

// Les panneaux qu'on peut ouvrir, et le nom que porte chacun (celui de son `complementary`) quand il n'est pas le même.
export type PanelName = 'Chat' | 'Personnes' | 'Mon bureau' | 'Personnage' | 'Décorer' | 'Admin';
const PANEL_TITLES: Partial<Record<PanelName, string>> = { Personnage: 'Mon personnage', Décorer: 'Décorer mon bureau' };
// Celui qu'ouvre une ligne du menu « Moi », et le nom de cette ligne : « Personnage » y est « Changer d'apparence ».
const ME_MENU_ENTRIES: Partial<Record<PanelName, string>> = { Personnage: 'Changer d\'apparence' };

// Ouvre ce panneau et le renvoie, une fois visible. Un seul est ouvert à la fois : il prend la place du précédent. Chat et Personnes ont leur
// bouton dans la barre ; Personnage est une ligne du menu « Moi », Décorer et Admin du menu « Plus », et Mon bureau a son bouton dans le dock du
// milieu (openDeskPanel).
export async function openPanel(page: Page, name: PanelName): Promise<Locator> {
  const meEntry = ME_MENU_ENTRIES[name];
  if (name === 'Mon bureau') return openDeskPanel(page);
  if (name === 'Chat') await chatToggle(page).click();
  else if (name === 'Personnes') await officeBar(page).getByRole('button', { name: 'Personnes', exact: true }).click();
  else if (meEntry) await (await meMenuEntry(page, meEntry)).click();
  else await (await moreMenuEntry(page, name)).click();
  const panel = page.getByRole('complementary', { name: PANEL_TITLES[name] ?? name, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

// Le bouton « Musique et ambiances » du dock du milieu.
export function musicButton(page: Page): Locator {
  return officeBar(page).getByRole('button', { name: 'Musique et ambiances', exact: true });
}

// Ouvre le juke-box (la fenêtre « Musique et ambiances », au-dessus du bouton du dock), et le renvoie : la musique, son volume, les ambiances et les
// effets sonores. Ses cartes d'ambiance sont des boutons radio, que le nom de l'ambiance (« Crépuscule ») ou « Selon l'endroit » désigne.
export async function openJukebox(page: Page): Promise<Locator> {
  await musicButton(page).click();
  const jukebox = page.getByRole('dialog', { name: 'Musique et ambiances', exact: true });
  await expect(jukebox).toBeVisible();
  return jukebox;
}

// Le bureau d'une personne n'a plus de ligne dans un menu : son bouton est dans le dock du milieu, et change selon l'endroit. Dehors,
// « Aller à mon bureau » fait marcher l'avatar jusqu'à sa place ; dedans, « Réglages du bureau » ouvre le panneau « Mon bureau ». Sans bureau (les
// six places sont prises), il n'y a aucun des deux.
export function goToDeskButton(page: Page): Locator {
  return officeBar(page).getByRole('button', { name: 'Aller à mon bureau', exact: true });
}

export function deskSettingsButton(page: Page): Locator {
  return officeBar(page).getByRole('button', { name: 'Réglages du bureau', exact: true });
}

// Le temps qu'on laisse à l'avatar pour marcher de l'accueil de la grande carte à son bureau (65 cases à 160 px/s : 13 s, plus sur une machine chargée).
const DESK_WALK_TIMEOUT = 60_000;

// Ouvre le panneau « Mon bureau » de cette page, et le renvoie : si l'on n'est pas dans son bureau, on y marche d'abord (« Aller à mon bureau », le
// vrai bouton, jusqu'à ce que « Réglages du bureau » le remplace).
export async function openDeskPanel(page: Page): Promise<Locator> {
  const settings = deskSettingsButton(page);
  if (!(await settings.isVisible())) {
    await goToDeskButton(page).click();
    await expect(settings).toBeVisible({ timeout: DESK_WALK_TIMEOUT });
  }
  await settings.click();
  const panel = page.getByRole('complementary', { name: 'Mon bureau', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

// Se déconnecte, par la ligne du menu « Moi ».
export async function signOut(page: Page): Promise<void> {
  await (await meMenuEntry(page, 'Se déconnecter')).click();
}

// Le bouton Chat de la barre : son nom devient « Chat, N nouveaux messages » quand il y en a de non lus (la pastille, `.icon-badge`, le dit).
export function chatToggle(page: Page): Locator {
  return officeBar(page).getByRole('button', { name: /^Chat/ });
}

// Ouvre le panneau Chat de cette page, et le renvoie : le focus est dans le champ du message.
export async function openChat(page: Page): Promise<Locator> {
  await chatToggle(page).click();
  const panel = page.getByRole('complementary', { name: 'Chat' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox')).toBeFocused();
  return panel;
}

// Écrit ce texte dans le champ du panneau Chat, et l'envoie avec Entrée (dans l'onglet choisi).
export async function say(panel: Locator, text: string): Promise<void> {
  const box = panel.getByRole('textbox');
  await box.fill(text);
  await box.press('Enter');
}

// Les messages de l'onglet affiché du panneau Chat qui portent ce texte.
export function messagesWith(panel: Locator, text: string): Locator {
  return panel.getByRole('log').getByRole('listitem').filter({ hasText: text });
}

// Le bureau est affiché pour cette personne : son nom est dans la barre du bas.
export async function expectInOffice(page: Page, name: string): Promise<void> {
  await expect(officeBar(page).getByText(name, { exact: true })).toBeVisible();
}

// La page du bureau s'ouvre sur l'écran d'entrée (micro et caméra, ici les faux de Chromium : playwright.config.ts) : « Entrer », ou
// « Entrer quand même » quand ils sont refusés, puis la barre du bureau s'affiche. À chaque arrivée sur la page : connexion,
// rechargement, nouvel onglet.
export async function enterOffice(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Entrer( quand même)?$/ }).click();
  await expect(officeBar(page)).toBeVisible();
}

// Remplit le formulaire de la page « Rejoindre » (déjà ouverte, ou qui va s'afficher), crée le compte, passe l'écran d'entrée
// (« Entrer ») et attend le bureau.
export async function submitJoinForm(page: Page, { name, password }: Pick<Account, 'name' | 'password'>): Promise<void> {
  await page.getByLabel('Nom affiché', { exact: true }).fill(name);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await enterOffice(page);
  await expectInOffice(page, name);
}

// Ouvre un lien d'invitation, crée le compte, entre et attend le bureau.
export async function joinWithLink(page: Page, link: string, account: Pick<Account, 'name' | 'password'>): Promise<void> {
  await page.goto(link);
  await submitJoinForm(page, account);
}

// Invite cette adresse (membre, ou admin), crée son compte depuis le lien de l'invitation, clique sur « Entrer » et attend le bureau : la
// page reste connectée.
export async function inviteAndJoin(page: Page, { email, name, password }: Account, role: 'admin' | 'member' = 'member'): Promise<void> {
  await joinWithLink(page, await createInvitation(page.request, email, role), { name, password });
}

// Se connecte depuis la page de connexion, entre et attend le bureau.
export async function signIn(page: Page, { email, password, name }: Account): Promise<void> {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await enterOffice(page);
  await expectInOffice(page, name);
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

// Donne à la personne connectée ce personnage (PATCH /api/me), et attend que le jeu l'ait assemblé et le montre : les tests de pixels
// reconnaissent ses couleurs.
export async function chooseAvatar(page: Page, avatarKey: string): Promise<void> {
  const res = await page.request.patch('/api/me', { data: { avatarKey } });
  expect(res.status(), await res.text()).toBe(200);
  await page.waitForFunction((key) => {
    const avatar = window.__office?.selfAvatar();
    return avatar?.wanted === key && avatar.shown === key;
  }, avatarKey);
}

// Un compte neuf (membre, ou admin), entré dans le bureau prêt, avec le personnage des tests (TEST_AVATAR_KEY). Renvoie le compte (pour se
// reconnecter).
export async function joinOffice(page: Page, name: string, role: 'admin' | 'member' = 'member'): Promise<Account> {
  // L'adresse e-mail n'a pas d'accent : « Zoé » devient zoe.
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const account = { email: uniqueEmail(slug), name, password: `motdepasse-de-${slug}` };
  await inviteAndJoin(page, account, role);
  await waitForOffice(page);
  await chooseAvatar(page, TEST_AVATAR_KEY);
  return account;
}

// Attend le bureau prêt (on est entré, le serveur a envoyé son état, la carte est construite), puis un moment de jeu.
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

// Place l'avatar sur ce point (window.__office.teleport, que le serveur n'accepte qu'avec E2E=1), et attend qu'il y soit, arrêté.
export async function teleportTo(page: Page, spot: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => window.__office!.teleport(x, y), spot);
  await expect.poll(() => selfAt(page)).toMatchObject(spot);
}

// Chacun reçoit un bureau en arrivant sur la vraie carte, et les tests de personnalisation en cherchent de libres sur ce serveur : un test qui n'a pas
// besoin du sien le rend tout de suite. L'avatar y marche, puis revient où il était.
export async function giveDeskBack(page: Page): Promise<void> {
  if (!(await goToDeskButton(page).or(deskSettingsButton(page)).isVisible())) return;
  const { x, y } = await selfAt(page);
  const panel = await openDeskPanel(page);
  const giveBack = panel.getByRole('button', { name: 'Rendre mon bureau' });
  await expect(giveBack).toBeVisible();
  await giveBack.click();
  await expect(panel.getByText('Tu n\'as pas de bureau.')).toBeVisible();
  await panel.getByRole('button', { name: 'Fermer le panneau Mon bureau' }).click();
  await expect(panel).toHaveCount(0);
  await expect(goToDeskButton(page).or(deskSettingsButton(page))).toHaveCount(0);
  await teleportTo(page, { x, y });
}
