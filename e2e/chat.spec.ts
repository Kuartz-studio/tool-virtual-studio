import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';
import { chatToggle, enterOffice, joinOffice, messagesWith, officeBar, openChat, restingAt, say, selfAt, waitForOffice, WALK_TIMEOUT } from './helpers';

// Le chat de bout en bout : le panneau Chat de la barre du bas et son canal « Tout le monde », conservé en base. Chaque personne a son
// navigateur (un contexte : ses cookies, donc sa session). Tous les tests partagent le serveur, et donc le chat « Tout le monde » : chacun
// écrit des textes qui lui sont propres, et ne cherche que ceux-là.
//
// Le canal « À proximité » demande une conversation, donc une room LiveKit (l'onglet est inactif sans elle) : son test est dans
// media.spec.ts, avec les autres qui en ont besoin.

// Ce qui passe par le serveur d'un navigateur à l'autre (un message, son badge) peut mettre plus que les 5 s par défaut à s'afficher sur une
// machine chargée (les autres fichiers jouent en même temps).
const PROPAGATION = { timeout: 15_000 };

// Les tests de ce fichier passent l'un après l'autre : le chat « Tout le monde » est le même pour tous, et les messages non lus du badge
// compteraient ceux qu'un autre test écrit en même temps. (Les autres fichiers n'y écrivent pas.)
test.describe.configure({ mode: 'default' });

interface Person {
  context: BrowserContext;
  page: Page;
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Une personne de plus, dans le bureau.
async function arrive(browser: Browser, name: string, options: BrowserContextOptions = {}): Promise<Person> {
  const context = await browser.newContext(options);
  contexts.push(context);
  const page = await context.newPage();
  await joinOffice(page, name);
  return { context, page };
}

test('A écrit à tout le monde → B le voit ; B recharge → toujours là', async ({ browser }) => {
  test.slow();   // deux personnes dans deux navigateurs : plus de 20 s sur une machine chargée
  const a = await arrive(browser, 'Aurore');
  const b = await arrive(browser, 'Bruno');
  const text = `Bonjour l'équipe (${Date.now()})`;
  const link = 'https://example.com/chat-e2e';
  // Un mot sans espace plus long que le panneau : il passe à la ligne, il ne le fait pas déborder.
  const longWord = 'x'.repeat(150);

  // A écrit un lien, et du HTML qui n'en est pas. Le serveur répond, le champ se vide, et A voit son message, signé « (toi) ».
  const panelOfA = await openChat(a.page);
  await say(panelOfA, `${text} ${link} <b>pas gras</b> ${longWord}`);
  await expect(panelOfA.getByRole('textbox')).toHaveValue('');
  const messageOfA = messagesWith(panelOfA, text);
  await expect(messageOfA).toHaveCount(1, PROPAGATION);
  await expect(messageOfA).toContainText('Aurore');
  await expect(messageOfA).toContainText('(toi)');
  // Son propre message n'est pas un message non lu.
  await expect(chatToggle(a.page)).toHaveAccessibleName('Chat');

  // B, panneau fermé, a un badge de non-lus : le message de A, et lui seul (l'historique de son arrivée est lu).
  await expect(chatToggle(b.page)).toHaveAccessibleName('Chat, 1 nouveau message', PROPAGATION);
  await expect(chatToggle(b.page).locator('.icon-badge')).toHaveText('1');

  // Il ouvre le panneau : le message de A, avec son nom, son heure et son lien ; le badge a disparu.
  const panelOfB = await openChat(b.page);
  const messageForB = messagesWith(panelOfB, text);
  await expect(messageForB).toHaveCount(1, PROPAGATION);
  await expect(messageForB).toContainText('Aurore');
  await expect(messageForB).not.toContainText('(toi)');
  await expect(messageForB.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
  await expect(chatToggle(b.page)).toHaveAccessibleName('Chat');
  const anchor = messageForB.getByRole('link', { name: link });
  await expect(anchor).toHaveAttribute('href', link);
  await expect(anchor).toHaveAttribute('target', '_blank');
  await expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
  // Le HTML n'en est pas : la balise est écrite telle quelle, et aucun élément <b> n'existe dans la page.
  await expect(messageForB).toContainText('<b>pas gras</b>');
  await expect(b.page.locator('.chat-text b')).toHaveCount(0);
  // Le long mot ne fait pas déborder la liste.
  await expect(messageForB).toContainText(longWord);
  expect(await panelOfB.getByRole('log').evaluate((list) => list.scrollWidth <= list.clientWidth)).toBe(true);

  // B recharge la page : le message est toujours là (l'historique du init), lu d'avance.
  await b.page.reload();
  await enterOffice(b.page);
  await waitForOffice(b.page);
  await expect(chatToggle(b.page)).toHaveAccessibleName('Chat');
  const panelAfterReload = await openChat(b.page);
  const messageAfterReload = messagesWith(panelAfterReload, text);
  await expect(messageAfterReload).toHaveCount(1, PROPAGATION);
  await expect(messageAfterReload).toContainText('Aurore');
  await expect(messageAfterReload.getByRole('link', { name: link })).toHaveAttribute('href', link);
});

test('taper « zqsd » dans le chat ne déplace pas l\'avatar', async ({ browser }) => {
  test.slow();   // les touches sont tenues 300 ms chacune, et la page met du temps à se charger sur une machine chargée
  const { page } = await arrive(browser, 'Zélie');
  const start = await restingAt(page);

  // Le focus est dans le champ du message. ZQSD, c'est KeyW, KeyA, KeyS, KeyD sur un clavier AZERTY, avec les flèches : chacune est tenue
  // le temps qu'un avatar aurait marché.
  const panel = await openChat(page);
  await page.keyboard.type('zqsd');
  for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
    await page.keyboard.press(key, { delay: 300 });
  }
  // Les lettres sont allées dans le champ (les flèches, non), et l'avatar n'a pas bougé d'un pixel.
  await expect(panel.getByRole('textbox')).toHaveValue('zqsdwasd');
  const stayed = await restingAt(page);
  expect({ x: stayed.x, y: stayed.y }).toEqual({ x: start.x, y: start.y });

  // Échap ferme le panneau, et le focus revient à son bouton : les mêmes touches font de nouveau marcher l'avatar (le test éprouve
  // donc bien ce qu'il dit).
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(chatToggle(page)).toBeFocused();
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(start.x);
  await page.keyboard.up('ArrowRight');
});

// Envoie ces messages l'un après l'autre aussi vite que le client le permet, depuis la page même : cinq messages en moins de 5 s ne doivent
// pas dépendre de la vitesse du test (une machine chargée met plus de 5 s à les écrire un à un). Le client n'envoie qu'un message à la
// fois : le suivant part quand l'accusé du précédent a vidé le champ. S'arrête au premier refus (l'erreur reste affichée, le texte dans
// le champ), et renvoie combien de messages sont partis.
async function sayQuickly(page: Page, texts: string[]): Promise<number> {
  return page.evaluate(async (messages) => {
    const input = document.querySelector<HTMLInputElement>('.chat-compose input')!;
    const form = input.form!;
    // React suit la valeur du champ : on la pose par le setter du navigateur, puis on lui dit qu'elle a changé.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    let sent = 0;
    for (const text of messages) {
      setValue.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
      while (input.value !== '' && form.querySelector('[role="alert"]') === null) await new Promise((resolve) => setTimeout(resolve, 2));
      if (input.value !== '') break;
      sent++;
    }
    return sent;
  }, texts);
}

test('6 messages en 5 s → le 6e est refusé : l\'erreur est dite, le texte reste, et il part quand le délai est passé', async ({ browser }) => {
  test.slow();
  const { page } = await arrive(browser, 'Rita');
  const panel = await openChat(page);
  const box = panel.getByRole('textbox');
  const tag = `limite-${Date.now()}`;

  // Les cinq premiers passent, le sixième est refusé.
  const sent = await sayQuickly(page, [1, 2, 3, 4, 5, 6].map((n) => `${tag} ${n}`));
  expect(sent).toBe(5);
  await expect(panel.getByRole('alert')).toHaveText('Tu écris trop vite. Patiente quelques secondes, puis réessaie.');
  await expect(box).toHaveValue(`${tag} 6`);
  await expect(messagesWith(panel, `${tag} 5`)).toHaveCount(1);
  await expect(messagesWith(panel, `${tag} 6`)).toHaveCount(0);

  // La fenêtre de 5 s passée, le même texte part.
  await expect(async () => {
    await box.press('Enter');
    await expect(box).toHaveValue('', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(messagesWith(panel, `${tag} 6`)).toHaveCount(1);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(messagesWith(panel, tag)).toHaveCount(6);
});

test('la liste suit le dernier message ; remontée lire plus haut, elle ne saute pas ; les flèches la font défiler, pas marcher l\'avatar', async ({ browser }) => {
  test.slow();   // trois personnes dans trois navigateurs
  // Une fenêtre basse : quelques messages suffisent à faire défiler la liste. Basile et Cléo écrivent (cinq messages en 5 s au plus chacun).
  const lowWindow = { viewport: { width: 1280, height: 480 } };
  const a = await arrive(browser, 'Lola', lowWindow);
  const b = await arrive(browser, 'Basile', lowWindow);
  const c = await arrive(browser, 'Cleo');
  const tag = `defile-${Date.now()}`;
  const panelOfA = await openChat(a.page);
  const log = panelOfA.getByRole('log');
  // Où en est la liste : sa position, et le bas où elle peut aller (0 : rien à faire défiler).
  const scroll = () => log.evaluate((list) => ({ top: list.scrollTop, max: list.scrollHeight - list.clientHeight }));
  const atBottom = async () => {
    const { top, max } = await scroll();
    return max > 0 && top >= max - 2;
  };

  const panelOfB = await openChat(b.page);
  for (let n = 1; n <= 4; n++) await say(panelOfB, `${tag} message ${n} de Basile, assez long pour passer à la ligne dans le panneau`);
  await expect(messagesWith(panelOfA, `${tag} message 4`)).toHaveCount(1, PROPAGATION);
  // La liste déborde, et elle est tout en bas : le dernier message est sous les yeux.
  await expect.poll(atBottom, PROPAGATION).toBe(true);

  // Un autre panneau prend sa place (un seul est ouvert à la fois) : le chat reste monté, caché ; revenu, sa liste est en bas.
  await officeBar(a.page).getByRole('button', { name: 'Personnes' }).click();
  await expect(panelOfA).toBeHidden();
  await chatToggle(a.page).click();
  await expect(panelOfA).toBeVisible();
  await expect.poll(atBottom, PROPAGATION).toBe(true);

  // A remonte tout en haut lire : un message de plus ne la ramène pas en bas.
  await log.evaluate((list) => {
    list.scrollTop = 0;
  });
  const panelOfC = await openChat(c.page);
  await say(panelOfC, `${tag} message 5 de Cleo`);
  await expect(messagesWith(panelOfA, `${tag} message 5`)).toHaveCount(1, PROPAGATION);
  expect((await scroll()).top).toBe(0);

  // Les flèches font défiler la liste, que le focus a gagnée, et ne font pas marcher l'avatar.
  const start = await restingAt(a.page);
  await log.focus();
  await a.page.keyboard.press('ArrowDown', { delay: 300 });
  await expect.poll(async () => (await scroll()).top).toBeGreaterThan(0);
  await a.page.keyboard.press('ArrowRight', { delay: 300 });
  const stayed = await restingAt(a.page);
  expect({ x: stayed.x, y: stayed.y }).toEqual({ x: start.x, y: start.y });

  // Revenue tout en bas (Fin), elle suit de nouveau.
  await a.page.keyboard.press('End');
  await expect.poll(atBottom, PROPAGATION).toBe(true);
  await say(panelOfC, `${tag} message 6 de Cleo`);
  await expect(messagesWith(panelOfA, `${tag} message 6`)).toHaveCount(1, PROPAGATION);
  await expect.poll(atBottom, PROPAGATION).toBe(true);

  // Basile ferme son panneau, des messages arrivent, il le rouvre : la liste est tout en bas, sur le dernier.
  await b.page.keyboard.press('Escape');
  await expect(panelOfB).toBeHidden();
  await say(panelOfC, `${tag} message 7 de Cleo`);
  await say(panelOfC, `${tag} message 8 de Cleo`);
  await expect(chatToggle(b.page)).toHaveAccessibleName('Chat, 2 nouveaux messages', PROPAGATION);
  await chatToggle(b.page).click();
  await expect(messagesWith(panelOfB, `${tag} message 8`)).toBeVisible(PROPAGATION);
  const logOfB = panelOfB.getByRole('log');
  await expect
    .poll(() => logOfB.evaluate((list) => list.scrollHeight > list.clientHeight && list.scrollTop >= list.scrollHeight - list.clientHeight - 2))
    .toBe(true);
});
