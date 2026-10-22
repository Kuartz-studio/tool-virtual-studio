import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  avatarsOf,
  createInvitation,
  enterOffice,
  joinOffice,
  playerSeenBy,
  restingAt,
  selfAt,
  uniqueEmail,
  waitForOffice,
  WALK_TIMEOUT,
} from './helpers';
import { TEST_AVATAR_KEY } from './pixels';

// Plusieurs personnes dans le bureau, chacune dans son navigateur : un contexte par personne (ses cookies, donc sa session).
//
// Tous les tests partagent le serveur : les joueurs des autres tests sont là aussi. On ne regarde donc les autres que par leur
// identifiant (window.__office.players[id], avatarsOf(id)).

// Le délai de grâce du serveur (DISCONNECT_GRACE_MS) : une connexion perdue depuis moins longtemps n'est pas un départ.
const GRACE_MS = 10_000;

interface Person {
  context: BrowserContext;
  page: Page;
  id: string;
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Une personne de plus, dans le bureau. `beforeJoin` prépare sa page avant qu'elle ne se connecte.
async function arrive(browser: Browser, name: string, beforeJoin?: (page: Page) => Promise<void>): Promise<Person> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await beforeJoin?.(page);
  await joinOffice(page, name);
  return { context, page, id: (await selfAt(page)).id };
}

// Attend que `viewer` dessine `id` (une fois).
async function expectToSee(viewer: Page, id: string): Promise<void> {
  await expect.poll(() => avatarsOf(viewer, id), { timeout: WALK_TIMEOUT }).toBe(1);
}

test('B voit A bouger', async ({ browser }) => {
  const a = await arrive(browser, 'Ambre');
  const b = await arrive(browser, 'Basile');
  await expectToSee(b.page, a.id);
  await expectToSee(a.page, b.id);
  // B voit A là où A se voit (l'apparition, ou sa position du moment).
  const startA = await restingAt(a.page);
  await expect.poll(() => playerSeenBy(b.page, a.id)).toMatchObject({ x: startA.x, y: startA.y });

  await a.page.keyboard.down('ArrowRight');
  // Une machine chargée peut tarder à dessiner l'image qui voit la touche : les 600 ms commencent quand A a bougé.
  await expect.poll(async () => (await selfAt(a.page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(startA.x);
  await a.page.waitForTimeout(600);
  await a.page.keyboard.up('ArrowRight');

  // Dans la seconde, B voit A plus de 40 px plus à droite.
  await expect.poll(async () => (await playerSeenBy(b.page, a.id))!.x - startA.x, { timeout: 1000, intervals: [50] }).toBeGreaterThan(40);

  // Puis il le voit exactement là où A s'est arrêté, avec son avatar.
  const endA = await restingAt(a.page);
  expect(endA.x - startA.x).toBeGreaterThan(40);
  await expect.poll(() => playerSeenBy(b.page, a.id)).toEqual({ x: endA.x, y: endA.y, avatarKey: TEST_AVATAR_KEY });
  // Et A ne se voit pas en double.
  expect(await avatarsOf(a.page, a.id)).toBe(1);
});

test('window.__office.teleport : A va là, et B l\'y voit sans glisser ; refusée par le serveur (un mur), A revient', async ({ browser }) => {
  const a = await arrive(browser, 'Anaïs');
  const b = await arrive(browser, 'Boris');
  await expectToSee(b.page, a.id);
  const start = await restingAt(a.page);

  // Une case libre de l'open space, loin de l'apparition.
  await a.page.evaluate(() => window.__office!.teleport(400, 420));
  // `self` est tenu à jour à chaque image : sur une machine chargée, la lecture peut précéder l'image qui suit la téléportation.
  await expect.poll(() => selfAt(a.page), { timeout: WALK_TIMEOUT }).toEqual({ id: a.id, x: 400, y: 420 });
  // Chez B, A saute directement (plus de TELEPORT_SNAP_PX) : jamais vu entre les deux.
  const seen: Array<{ x: number; y: number }> = [];
  await expect
    .poll(async () => {
      const p = (await playerSeenBy(b.page, a.id))!;
      seen.push({ x: p.x, y: p.y });
      return p;
    }, { intervals: [10], timeout: WALK_TIMEOUT })
    .toMatchObject({ x: 400, y: 420 });
  for (const p of seen) expect([`${start.x},${start.y}`, '400,420']).toContain(`${p.x},${p.y}`);

  // Dans un mur : le serveur refuse, et le `move` qui suit est corrigé (move:correct) : A revient à sa dernière position acceptée.
  await a.page.evaluate(() => window.__office!.teleport(16, 16));
  await expect.poll(() => selfAt(a.page), { timeout: WALK_TIMEOUT }).toEqual({ id: a.id, x: 400, y: 420 });
  await b.page.waitForTimeout(500);
  expect(await playerSeenBy(b.page, a.id)).toMatchObject({ x: 400, y: 420 });
});

test('A passe en arrière-plan en pleine marche : il s\'arrête là, et B le voit s\'arrêter là', async ({ browser }) => {
  const a = await arrive(browser, 'Adèle');
  const b = await arrive(browser, 'Benoît');
  await expectToSee(b.page, a.id);
  const start = await selfAt(a.page);

  await a.page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(a.page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(start.x + 20);
  // L'onglet passe en arrière-plan. Le navigateur n'y dessine plus d'image, donc le jeu ne tourne plus : il ne reçoit que cet
  // événement. (Ici, les images continuent : la touche toujours enfoncée ferait marcher A jusqu'au mur s'il ne s'arrêtait pas.)
  const hiddenAt = await a.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.__office!.self!.x;
  });
  const stopped = await restingAt(a.page);
  expect(stopped.x - hiddenAt).toBeLessThanOrEqual(3);
  // B le voit arrêté au même endroit, et il y reste.
  await expect.poll(() => playerSeenBy(b.page, a.id)).toMatchObject({ x: stopped.x, y: stopped.y });
  await b.page.waitForTimeout(600);
  expect(await playerSeenBy(b.page, a.id)).toMatchObject({ x: stopped.x, y: stopped.y });
  await a.page.keyboard.up('ArrowRight');
});

test('A marche contre un mur en gardant la touche : B ne le dessine jamais dans le mur', async ({ browser }) => {
  test.slow();
  const a = await arrive(browser, 'Achille');
  const b = await arrive(browser, 'Blanche');
  await expectToSee(b.page, a.id);
  // B relève, à chaque image, le x le plus à droite où il dessine A.
  await b.page.evaluate((id) => {
    const w = window as unknown as { __maxX: number; __recording: boolean };
    w.__maxX = Number.NEGATIVE_INFINITY;
    w.__recording = true;
    const tick = () => {
      if (!w.__recording) return;
      const p = window.__office?.players[id];
      if (p) w.__maxX = Math.max(w.__maxX, p.x);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, a.id);

  // Trois fois : jusqu'au mur de droite (la colonne 23 commence en x = 736 ; le corps, de x − 10 à x + 10, s'arrête en x = 726),
  // touche gardée contre lui (A n'envoie plus rien : sa position ne change plus), puis un peu en arrière.
  for (let i = 0; i < 3; i++) {
    await a.page.keyboard.down('ArrowRight');
    await a.page.waitForFunction(() => window.__office!.self!.x >= 726, null, { timeout: WALK_TIMEOUT });
    await a.page.waitForTimeout(800);
    await a.page.keyboard.up('ArrowRight');
    await a.page.keyboard.down('ArrowLeft');
    await a.page.waitForTimeout(150 + 150 * i);
    await a.page.keyboard.up('ArrowLeft');
  }
  await restingAt(a.page);
  await b.page.waitForTimeout(500);
  const maxX = await b.page.evaluate(() => {
    const w = window as unknown as { __maxX: number; __recording: boolean };
    w.__recording = false;
    return w.__maxX;
  });
  // Dessiné jusqu'au mur, jamais dedans (l'extrapolation est bornée par la carte).
  expect(maxX).toBe(726);
});

test('A marche puis s\'arrête pendant que le jeu de B charge : B le voit à sa position d\'arrêt, arrêté', async ({ browser }) => {
  test.slow();
  const a = await arrive(browser, 'Aurèle');

  // B : la carte du jeu n'arrive qu'au signal du test. Le jeu ne démarre qu'avec l'init (c'est lui qui dit la carte) : quand la
  // carte est demandée, l'init de B est arrivé, et le bureau n'a pas encore de scène pour suivre les positions.
  const contextB = await browser.newContext();
  contexts.push(contextB);
  const pageB = await contextB.newPage();
  let mapRequested!: () => void;
  const requested = new Promise<void>((resolve) => (mapRequested = resolve));
  let releaseMap!: () => void;
  const released = new Promise<void>((resolve) => (releaseMap = resolve));
  await pageB.route('**/assets/maps/*.json', async (route) => {
    mapRequested();
    await released;
    await route.continue();
  });
  await pageB.goto(await createInvitation(pageB.request, uniqueEmail('beatrice')));
  await pageB.getByLabel('Nom affiché', { exact: true }).fill('Béatrice');
  await pageB.getByLabel('Mot de passe', { exact: true }).fill('motdepasse-de-beatrice');

  // A marche déjà quand le serveur construit l'init de B : B l'y reçoit « en marche ». La connexion de B s'ouvre à « Entrer », et son
  // jeu démarre à l'init : A part juste avant.
  await pageB.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(pageB.getByRole('button', { name: /^Entrer( quand même)?$/ })).toBeVisible();
  await a.page.keyboard.down('ArrowRight');
  await enterOffice(pageB);
  await requested;
  // Puis A s'arrête pendant que le jeu de B charge : son arrêt, et son renvoi 500 ms plus tard, arrivent avant la scène de B.
  await a.page.waitForTimeout(300);
  await a.page.keyboard.up('ArrowRight');
  const stopped = await restingAt(a.page);
  await pageB.waitForTimeout(900);
  releaseMap();
  await waitForOffice(pageB);

  // B le voit là où il s'est arrêté (et non à sa position de l'init, en marchant sur place), et l'y voit encore ensuite.
  await expect.poll(() => playerSeenBy(pageB, a.id), { timeout: WALK_TIMEOUT }).toMatchObject({ x: stopped.x, y: stopped.y });
  await pageB.waitForTimeout(600);
  expect(await playerSeenBy(pageB, a.id)).toMatchObject({ x: stopped.x, y: stopped.y });
});

test('A recharge la page : B voit toujours un seul A', async ({ browser }) => {
  test.slow();
  const a = await arrive(browser, 'Aline');
  const b = await arrive(browser, 'Bastien');
  await expectToSee(b.page, a.id);

  // A va un peu plus loin, pour qu'on reconnaisse sa position.
  await a.page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(a.page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThanOrEqual(120);
  await a.page.keyboard.up('ArrowRight');
  const before = await restingAt(a.page);
  await expect.poll(() => playerSeenBy(b.page, a.id)).toMatchObject({ x: before.x, y: before.y });

  await a.page.reload();
  await enterOffice(a.page);
  await waitForOffice(a.page);
  // A revient là où il était (le serveur l'a gardé pendant la coupure) : son init le dit.
  expect(await selfAt(a.page)).toEqual({ id: a.id, x: before.x, y: before.y });
  expect(await avatarsOf(a.page, a.id)).toBe(1);
  await expectToSee(a.page, b.id);

  // Chez B : un seul A, au même endroit, et il ne part pas une fois le délai de grâce écoulé (A s'est reconnecté avant).
  expect(await avatarsOf(b.page, a.id)).toBe(1);
  expect(await playerSeenBy(b.page, a.id)).toMatchObject({ x: before.x, y: before.y });
  await b.page.waitForTimeout(GRACE_MS + 1000);
  expect(await avatarsOf(b.page, a.id)).toBe(1);
  expect(await playerSeenBy(b.page, a.id)).toMatchObject({ x: before.x, y: before.y });
});

test('B perd la connexion pendant que A part, que C bouge et que D arrive : à son retour, le nouvel init remplace tout le monde', async ({ browser }) => {
  test.slow();
  // La connexion de B passe par le test, qui peut la couper : les requêtes de Socket.io (le transport HTTP du début) et sa
  // WebSocket. Coupée, une nouvelle tentative échoue aussitôt.
  let online = true;
  const openSockets: Array<{ close(): Promise<void> }> = [];
  const b = await arrive(browser, 'Bérénice', async (page) => {
    await page.route(/\/socket\.io\//, (route) => (online ? route.continue() : route.abort()));
    await page.routeWebSocket(/\/socket\.io\//, (ws) => {
      if (!online) {
        void ws.close();
        return;
      }
      const server = ws.connectToServer();
      openSockets.push(ws, server);
    });
  });
  const a = await arrive(browser, 'Arthur');
  const c = await arrive(browser, 'Capucine');
  await expectToSee(b.page, a.id);
  await expectToSee(b.page, c.id);
  const bBefore = await selfAt(b.page);

  // B est coupé du serveur. Il marche un peu : ses mouvements ne partent pas, le serveur le croit toujours à sa place.
  online = false;
  await Promise.all(openSockets.splice(0).map((socket) => socket.close()));
  await b.page.keyboard.down('ArrowDown');
  await expect.poll(async () => (await selfAt(b.page)).y, { timeout: WALK_TIMEOUT }).toBeGreaterThan(bBefore.y + 20);
  await b.page.keyboard.up('ArrowDown');

  // Pendant ce temps : C se déplace, A s'en va (son départ est annoncé au bout du délai de grâce), D arrive.
  await c.page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(c.page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThanOrEqual(150);
  await c.page.keyboard.up('ArrowRight');
  const cMoved = await restingAt(c.page);
  await a.context.close();
  await expect.poll(() => playerSeenBy(c.page, a.id), { timeout: GRACE_MS + WALK_TIMEOUT }).toBeNull();
  const d = await arrive(browser, 'Dorian');
  await expectToSee(c.page, d.id);
  // B n'en sait rien : il dessine encore A, et C à son ancienne place.
  expect(await avatarsOf(b.page, a.id)).toBe(1);
  expect(await avatarsOf(b.page, d.id)).toBe(0);

  // La connexion revient : Socket.io se reconnecte seul, et le serveur envoie un nouvel init.
  online = true;
  await expect.poll(() => avatarsOf(b.page, d.id), { timeout: 30_000 }).toBe(1);
  // A, parti pendant la coupure, a disparu (pas de sprite orphelin) ; C est là où il s'est arrêté, une seule fois ; B lui-même aussi.
  expect(await avatarsOf(b.page, a.id)).toBe(0);
  expect(await playerSeenBy(b.page, a.id)).toBeNull();
  expect(await avatarsOf(b.page, c.id)).toBe(1);
  await expect.poll(() => playerSeenBy(b.page, c.id)).toMatchObject({ x: cMoved.x, y: cMoved.y });
  expect(await avatarsOf(b.page, b.id)).toBe(1);
  // B est là où le serveur l'a gardé (sa position enregistrée), et C l'y voit.
  expect(await selfAt(b.page)).toEqual(bBefore);
  await expect.poll(() => playerSeenBy(c.page, b.id), { timeout: WALK_TIMEOUT }).toMatchObject({ x: bBefore.x, y: bBefore.y });

  // Et B se déplace de nouveau chez les autres : ses mouvements repartent après le nouvel init.
  await b.page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(b.page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(bBefore.x + 40);
  await b.page.keyboard.up('ArrowRight');
  const bMoved = await restingAt(b.page);
  await expect.poll(() => playerSeenBy(c.page, b.id), { timeout: WALK_TIMEOUT }).toMatchObject({ x: bMoved.x, y: bMoved.y });
});

// La bulle de parole : quand quelqu'un parle, tout le bureau le voit, même loin de lui et hors de sa conversation. Sans room audio, les tests n'ont pas
// de voix : window.__office.media.speak(true) fait parler l'avatar local, comme le ferait la détection de la room, et le reste est le vrai chemin
// (le délai de 150 ms, speaking:set, le serveur, speaking:changed, la scène de l'autre).
test('la bulle de parole : quand A parle, B, à l\'autre bout de la carte et hors de sa conversation, voit sa bulle, qui s\'éteint quand A se tait', async ({ browser }) => {
  const a = await arrive(browser, 'Anouk');
  const b = await arrive(browser, 'Basile');
  await expectToSee(b.page, a.id);
  // B est à l'autre bout de la ligne d'apparition, à 19 cases de A : bien au-delà de ce qui fait une conversation.
  await b.page.evaluate(() => window.__office!.teleport(688, 240));
  await expect.poll(async () => (await selfAt(b.page)).x).toBe(688);
  const bubblesOf = (page: Page) => page.evaluate(() => window.__office!.bubbles());
  expect(await bubblesOf(b.page)).not.toContain(a.id);

  // La bulle de soi s'allume sans attendre le serveur : deux images plus tard, avant même que « je parle » parte (150 ms de parole continue).
  const own = await a.page.evaluate(() => {
    window.__office!.media.speak(true);
    return new Promise<string[]>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__office!.bubbles()))));
  });
  expect(own).toContain(a.id);

  // B la voit, dans les secondes qui suivent : les 150 ms de parole, le serveur, le réseau, l'image.
  await expect.poll(() => bubblesOf(b.page), { timeout: 5000 }).toContain(a.id);

  // A se tait : sa bulle s'éteint chez lui tout de suite, chez B après 700 ms de silence.
  await a.page.evaluate(() => window.__office!.media.speak(false));
  await expect.poll(() => bubblesOf(a.page)).not.toContain(a.id);
  await expect.poll(() => bubblesOf(b.page), { timeout: 5000 }).not.toContain(a.id);
});
