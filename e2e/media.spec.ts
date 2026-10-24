import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { chooseStatus, createInvitation, enterOffice, expectInOffice, messagesWith, officeBar, openChat, say, selfAt, uniqueEmail, waitForOffice, WALK_TIMEOUT } from './helpers';

// L'audio et la vidéo de proximité, de bout en bout, avec un vrai serveur LiveKit. En local : `livekit-server --dev`, puis
//   E2E_LIVEKIT_URL=ws://localhost:7880 E2E_LIVEKIT_API_KEY=devkey E2E_LIVEKIT_API_SECRET=secret pnpm e2e e2e/media.spec.ts --workers=1
// (ou les adresse et clés du projet LiveKit Cloud). Le serveur des tests les reçoit en LIVEKIT_* (playwright.config.ts). Sans
// E2E_LIVEKIT_URL, il n'a ni audio ni vidéo : ces tests sont ignorés. À lancer seul : avec LiveKit, les gens des autres fichiers, qui
// arrivent tous au point d'apparition, y formeraient une grande conversation (des vignettes en trop, et la machine surchargée).
//
// Chaque personne a son navigateur (un contexte), avec les faux micro et caméra de Chromium (une mire qui bouge, un bip), sauf celle
// du test du refus. On compte les vignettes de caméra de la conversation (une par participant), et on regarde si une vidéo joue
// (readyState ≥ 2 : HAVE_CURRENT_DATA, une image est là).
test.skip(!process.env.E2E_LIVEKIT_URL, 'Il faut un serveur LiveKit : E2E_LIVEKIT_URL, E2E_LIVEKIT_API_KEY et E2E_LIVEKIT_API_SECRET.');

// Les tests de ce fichier passent l'un après l'autre : ils placent des gens dans la même carte, et des groupes formés par deux tests à
// la fois fausseraient le compte des vignettes.
test.describe.configure({ mode: 'default' });

interface Person {
  context: BrowserContext;
  page: Page;
  id: string;
}

const people: Person[] = [];
const extraBrowsers: Browser[] = [];

// En partant, chacun prend le mode « Manger » (un des modes semés à la création du compte : ni entendre, ni être entendu, donc hors de toute
// conversation, comme l'ancien « Ne pas déranger », que le menu ne propose plus) : le serveur garde sa place pendant le délai de grâce (10 s),
// mais hors de tout groupe, et sa room LiveKit est quittée pour de bon. Le test suivant ne tombe ni dans son groupe, ni sur sa vignette.
const OUT_OF_CONVERSATIONS = 'Manger';
test.afterEach(async () => {
  for (const person of people.splice(0)) {
    try {
      await chooseStatus(person.page, OUT_OF_CONVERSATIONS);
      await expect.poll(() => roomOf(person.page), { timeout: 5000 }).toBeNull();
    } catch {
      // la page n'est plus là (test en échec) : on ferme quand même
    }
    await person.context.close();
  }
  await Promise.all(extraBrowsers.splice(0).map((browser) => browser.close()));
});

// Une case de la carte de développement (packages/shared/src/map/dev-office.ts) : son milieu, en pixels (les pieds de l'avatar).
const at = (column: number, row: number) => ({ x: column * 32 + 16, y: row * 32 + 16 });

// Un compte neuf, dans le bureau : invitation, compte, écran d'entrée (`beforeEnter` y fait ce qu'il veut), « Entrer » (ou « Entrer
// quand même »), et le jeu prêt.
async function arrive(context: BrowserContext, name: string, beforeEnter?: (page: Page) => Promise<void>): Promise<Person> {
  const page = await context.newPage();
  await page.goto(await createInvitation(page.request, uniqueEmail(name.toLowerCase())));
  await page.getByLabel('Nom affiché', { exact: true }).fill(name);
  await page.getByLabel('Mot de passe', { exact: true }).fill(`motdepasse-de-${name.toLowerCase()}`);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Prêt à entrer ?' })).toBeVisible();
  await beforeEnter?.(page);
  await page.getByRole('button', { name: /^Entrer( quand même)?$/ }).click();
  await expectInOffice(page, name);
  await waitForOffice(page);
  const person = { context, page, id: (await selfAt(page)).id };
  people.push(person);
  return person;
}

async function newPerson(browser: Browser, name: string, beforeEnter?: (page: Page) => Promise<void>): Promise<Person> {
  return arrive(await browser.newContext(), name, beforeEnter);
}

// Place l'avatar sur cette case (window.__office.teleport, que le serveur n'accepte qu'avec E2E=1), arrêté.
async function teleport(page: Page, spot: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => window.__office!.teleport(x, y), spot);
  await expect.poll(() => selfAt(page)).toMatchObject(spot);
}

// Les vignettes de caméra de la conversation, une par participant (en petit ou agrandie).
const cameraTiles = (page: Page) => page.locator('.video-strip [data-source="camera"]');
const remoteCameraTiles = (page: Page) => page.locator('.video-strip [data-source="camera"]:not([data-local])');

// Où en est la vidéo de la caméra de cette personne dans la page : 0 sans élément, sinon son readyState.
async function videoReadyState(page: Page, id: string): Promise<number> {
  const video = page.locator(`.video-strip [data-participant="${id}"][data-source="camera"] video`);
  if ((await video.count()) === 0) return 0;
  return video.evaluate((element: HTMLVideoElement) => element.readyState);
}

// La room LiveKit de la page (window.__office.media.room), null hors conversation.
async function roomOf(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__office?.media.room ?? null);
}

// Les deux se voient : deux vignettes chacun, et la vidéo de l'autre qui joue.
async function expectConversation(a: Person, b: Person, timeout: number): Promise<void> {
  await Promise.all(
    [
      [a, b],
      [b, a],
    ].map(async ([viewer, other]) => {
      await expect(cameraTiles(viewer!.page)).toHaveCount(2, { timeout });
      await expect.poll(() => videoReadyState(viewer!.page, other!.id), { timeout }).toBeGreaterThanOrEqual(2);
    }),
  );
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('rapprochés et arrêtés → 2 vignettes et une vidéo distante qui joue en moins de 3 s', async ({ browser }, testInfo) => {
  test.slow();
  const a = await newPerson(browser, 'Amandine', async (page) => {
    // L'aperçu de la caméra (la mire de Chromium) joue.
    await page.waitForFunction(
      () => ((document.querySelector('video[aria-label="Aperçu de ta caméra"]') as HTMLVideoElement | null)?.readyState ?? 0) >= 2,
    );
    await capture(page, testInfo, 'ecran-d-entree');
  });
  await teleport(a.page, at(22, 13));   // à plus de 15 cases du point d'apparition, où B arrive : ils ne se parlent pas avant
  const b = await newPerson(browser, 'Benoit');

  const start = Date.now();
  await teleport(b.page, at(21, 13));
  await expectConversation(a, b, 3000);
  expect(Date.now() - start).toBeLessThan(3000);
  // Chacun dans la même room, et la sienne d'abord.
  expect(await roomOf(a.page)).not.toBeNull();
  expect(await roomOf(b.page)).toBe(await roomOf(a.page));
  await expect(cameraTiles(a.page).first()).toHaveAttribute('data-participant', a.id);
  await capture(a.page, testInfo, 'deux-personnes-en-conversation');
});

// On reste dans une conversation d'espace ouvert jusqu'à 15 cases (OPEN_SPACE_GROUPING) : sur la petite carte (24 cases de large), A et B se
// parlent à un bout, et B part à l'autre.
test('B s\'éloigne → plus de vignettes en moins de 2 s', async ({ browser }) => {
  test.slow();
  const a = await newPerson(browser, 'Arnaud');
  await teleport(a.page, at(1, 13));
  const b = await newPerson(browser, 'Berangere');
  await teleport(b.page, at(2, 13));
  await expectConversation(a, b, WALK_TIMEOUT);

  const start = Date.now();
  await teleport(b.page, at(22, 7));
  await Promise.all([expect(cameraTiles(a.page)).toHaveCount(0, { timeout: 2000 }), expect(cameraTiles(b.page)).toHaveCount(0, { timeout: 2000 })]);
  expect(Date.now() - start).toBeLessThan(2000);
  expect(await roomOf(a.page)).toBeNull();
  expect(await roomOf(b.page)).toBeNull();
});

test('salle de réunion privée', async ({ browser }) => {
  test.slow();
  const a = await newPerson(browser, 'Agathe');
  await teleport(a.page, at(9, 2));
  const b = await newPerson(browser, 'Bruno');
  await teleport(b.page, at(12, 3));
  const c = await newPerson(browser, 'Come');
  await teleport(c.page, at(10, 6));

  // A et B sont dans la salle, à plus de 3 cases l'un de l'autre : la salle fait d'eux une conversation.
  await expectConversation(a, b, WALK_TIMEOUT);
  // C, juste devant la porte, n'en est pas : la salle est isolée. On lui laisse le temps d'un calcul des groupes (500 ms d'attente,
  // 4 calculs par seconde) avant de compter.
  await c.page.waitForTimeout(1500);
  await expect(cameraTiles(c.page)).toHaveCount(0);
  expect(await roomOf(c.page)).toBeNull();
  await expect(a.page.locator(`.video-strip [data-participant="${c.id}"]`)).toHaveCount(0);
  await expect(cameraTiles(a.page)).toHaveCount(2);
});

test('micro et caméra refusés : on entre, on bouge, on reçoit', async ({ browser, playwright, baseURL }, testInfo) => {
  test.slow();
  const a = await newPerson(browser, 'Aurore');
  await teleport(a.page, at(5, 13));

  // C : un navigateur sans faux périphériques, qui refuse le micro et la caméra (comme une personne qui clique sur « Bloquer »).
  const denied = await playwright.chromium.launch({ args: ['--use-fake-ui-for-media-stream=deny'] });
  extraBrowsers.push(denied);
  const c = await arrive(await denied.newContext({ baseURL }), 'Celeste', async (page) => {
    await expect(page.getByText('Sans micro ni caméra, tu pourras quand même écouter et écrire.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrer quand même' })).toBeVisible();
    await capture(page, testInfo, 'ecran-d-entree-refus');
  });

  // On bouge : au clavier.
  const start = await selfAt(c.page);
  await c.page.keyboard.down('ArrowUp');
  await expect.poll(async () => (await selfAt(c.page)).y, { timeout: WALK_TIMEOUT }).toBeLessThan(start.y - 10);
  await c.page.keyboard.up('ArrowUp');

  // À côté de A : la vignette de A, dont la vidéo joue, et son son (un élément audio qui joue).
  await teleport(c.page, at(6, 13));
  await expect(remoteCameraTiles(c.page)).toHaveCount(1, { timeout: WALK_TIMEOUT });
  await expect(remoteCameraTiles(c.page)).toHaveAttribute('data-participant', a.id);
  await expect.poll(() => videoReadyState(c.page, a.id), { timeout: WALK_TIMEOUT }).toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => c.page.evaluate(() => [...document.querySelectorAll('audio')].some((audio) => !audio.paused && audio.srcObject !== null)), {
      timeout: WALK_TIMEOUT,
    })
    .toBe(true);
  // Sa propre vignette : ses initiales (pas de caméra), micro coupé ; et A la voit ainsi.
  await expect(c.page.locator('.video-strip [data-local] .tile-initials')).toBeVisible();
  await expect(officeBar(c.page).getByRole('button', { name: 'Micro' })).toHaveAttribute('aria-pressed', 'false');
  await expect(a.page.locator(`.video-strip [data-participant="${c.id}"][data-source="camera"] .tile-initials`)).toBeVisible();
  await capture(c.page, testInfo, 'refus-en-conversation');
});

// La personne qui prend un mode où elle n'entend ni n'est entendue sort de son groupe : le serveur lui dit de quitter la room (media:leave),
// et l'autre, resté seul, la quitte aussi.
test('prendre un mode hors de toute conversation (« Manger ») retire les vignettes des deux', async ({ browser }) => {
  test.slow();
  const a = await newPerson(browser, 'Anais');
  await teleport(a.page, at(14, 13));
  const b = await newPerson(browser, 'Baptiste');
  await teleport(b.page, at(15, 13));
  await expectConversation(a, b, WALK_TIMEOUT);

  await chooseStatus(a.page, OUT_OF_CONVERSATIONS);
  await expect(cameraTiles(a.page)).toHaveCount(0, { timeout: 5000 });
  await expect(cameraTiles(b.page)).toHaveCount(0, { timeout: 5000 });
  expect(await roomOf(a.page)).toBeNull();
  expect(await roomOf(b.page)).toBeNull();
});

// Compte les connexions WebRTC qu'ouvre la page (RTCPeerConnection) : une conversation reprise n'en ouvre pas de nouvelle.
async function countPeerConnections(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    let created = 0;
    window.RTCPeerConnection = class extends Native {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        created += 1;
      }
    };
    Object.defineProperty(window, '__peerConnections', { get: () => created });
  });
}
const peerConnections = (page: Page) => page.evaluate(() => (window as unknown as { __peerConnections: number }).__peerConnections);

// Quitter une conversation garde sa connexion parquée une minute (MEDIA_PARK_MS) : revenir la reprend, dans la même room (le serveur rend au
// groupe reformé son id), sans ouvrir de nouvelle connexion.
test('s\'éloigner puis revenir dans la minute : la même room, reprise sans nouvelle connexion, en moins de 2 s', async ({ browser }, testInfo) => {
  test.slow();
  const contexts = [await browser.newContext(), await browser.newContext()];
  for (const context of contexts) await countPeerConnections(context);
  const a = await arrive(contexts[0]!, 'Aymeric');
  await teleport(a.page, at(1, 13));
  const b = await arrive(contexts[1]!, 'Bertille');
  await teleport(b.page, at(2, 13));
  await expectConversation(a, b, WALK_TIMEOUT);
  const room = await roomOf(a.page);
  const connections = [await peerConnections(a.page), await peerConnections(b.page)];

  await teleport(b.page, at(22, 7));
  await expect.poll(() => roomOf(a.page), { timeout: 5000 }).toBeNull();
  await expect.poll(() => roomOf(b.page), { timeout: 5000 }).toBeNull();
  await expect(cameraTiles(a.page)).toHaveCount(0);

  const start = Date.now();
  await teleport(b.page, at(2, 13));
  await expectConversation(a, b, 3000);
  const elapsed = Date.now() - start;
  testInfo.annotations.push({ type: 'retour', description: `${elapsed} ms` });
  expect(elapsed).toBeLessThan(2000);
  expect(await roomOf(a.page)).toBe(room);
  expect(await roomOf(b.page)).toBe(room);
  expect([await peerConnections(a.page), await peerConnections(b.page)]).toEqual(connections);
});

// Verrouiller la conversation : ses membres restent ensemble où qu'ils aillent, et personne d'autre n'y entre ; « Quitter » en sort seul.
test('verrouiller : B part à l\'autre bout sans quitter la conversation, C collé à A n\'y entre pas ; B la quitte, et C rejoint enfin A', async ({ browser }) => {
  test.slow();
  const a = await newPerson(browser, 'Alix');
  await teleport(a.page, at(1, 13));
  const b = await newPerson(browser, 'Blaise');
  await teleport(b.page, at(2, 13));
  await expectConversation(a, b, WALK_TIMEOUT);
  const room = await roomOf(a.page);
  const lockOf = (page: Page) => page.getByRole('group', { name: 'Verrou de la conversation' });

  await lockOf(a.page).getByRole('button', { name: 'Verrouiller', exact: true }).click();
  await expect(lockOf(a.page).getByRole('button', { name: 'Verrouillée par toi' })).toHaveAttribute('aria-pressed', 'true');
  await expect(lockOf(b.page).getByRole('button', { name: 'Verrouillée par Alix' })).toHaveAttribute('aria-pressed', 'true');
  await expect(b.page.getByText('Alix a verrouillé la conversation')).toBeVisible();

  // B part à l'autre bout de la carte : la même room, et sa vignette reste chez A (plein volume).
  await teleport(b.page, at(22, 7));
  await b.page.waitForTimeout(1500);
  expect(await roomOf(a.page)).toBe(room);
  expect(await roomOf(b.page)).toBe(room);
  await expect(remoteCameraTiles(a.page)).toHaveCount(1);

  // C arrive et se colle à A : il n'entre pas dans leur conversation.
  const c = await newPerson(browser, 'Cyprien');
  await teleport(c.page, at(1, 12));
  await c.page.waitForTimeout(1500);
  expect(await roomOf(c.page)).toBeNull();
  await expect(cameraTiles(a.page)).toHaveCount(2);

  // B la quitte : il en sort ; A, seul, n'est plus verrouillé, et C, à côté de lui, le rejoint dans la même room.
  await lockOf(b.page).getByRole('button', { name: 'Quitter', exact: true }).click();
  await expect.poll(() => roomOf(b.page), { timeout: 5000 }).toBeNull();
  await expect.poll(() => roomOf(c.page), { timeout: 5000 }).toBe(room);
  await expect(lockOf(a.page).getByRole('button', { name: 'Verrouiller', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

// Le chat « À proximité » (spec §9) demande une conversation, donc une room : sans elle, l'onglet est inactif. Le reste du chat, « Tout le
// monde », est dans chat.spec.ts.
test('chat À proximité : A et B en conversation s\'écrivent, C n\'en voit rien ; hors conversation, l\'onglet est inactif', async ({ browser }) => {
  test.slow();
  const a = await newPerson(browser, 'Alexandre');
  await teleport(a.page, at(1, 13));
  const c = await newPerson(browser, 'Clemence');
  await teleport(c.page, at(22, 7));
  const nearbyTab = (page: Page) => page.getByRole('tab', { name: 'À proximité' });
  const everyoneTab = (page: Page) => page.getByRole('tab', { name: 'Tout le monde' });

  // Seuls, A et C ne peuvent pas écrire à proximité.
  const panelOfA = await openChat(a.page);
  const panelOfC = await openChat(c.page);
  await expect(nearbyTab(a.page)).toBeDisabled();
  await expect(nearbyTab(c.page)).toBeDisabled();

  // B arrive à côté de A : leur conversation ouvre l'onglet chez eux deux, et pas chez C.
  const b = await newPerson(browser, 'Baudouin');
  await teleport(b.page, at(2, 13));
  await expectConversation(a, b, WALK_TIMEOUT);
  const panelOfB = await openChat(b.page);
  await expect(nearbyTab(a.page)).toBeEnabled();
  await expect(nearbyTab(b.page)).toBeEnabled();
  await expect(nearbyTab(c.page)).toBeDisabled();

  // A écrit à proximité : B le reçoit, signé A, dans son onglet À proximité, et A le voit aussi.
  const text = `Chut, ça reste entre nous (${Date.now()})`;
  await nearbyTab(a.page).click();
  await say(panelOfA, text);
  await expect(panelOfA.getByRole('textbox')).toHaveValue('');
  await expect(messagesWith(panelOfA, text)).toHaveCount(1);
  await expect(messagesWith(panelOfA, text)).toContainText('(toi)');
  await nearbyTab(b.page).click();
  await expect(messagesWith(panelOfB, text)).toHaveCount(1);
  await expect(messagesWith(panelOfB, text)).toContainText('Alexandre');
  await expect(messagesWith(panelOfB, text)).not.toContainText('(toi)');

  // Ni « Tout le monde » (chez A, chez B, chez C), ni C n'en ont rien : il est arrivé chez B, il aurait déjà atteint C.
  for (const [page, panel] of [[a.page, panelOfA], [b.page, panelOfB], [c.page, panelOfC]] as const) {
    await everyoneTab(page).click();
    await expect(messagesWith(panel, text)).toHaveCount(0);
  }
  await c.page.waitForTimeout(500);
  await expect(messagesWith(panelOfC, text)).toHaveCount(0);

  // Rien n'est gardé : B recharge la page, et le message ne revient pas (ni dans « Tout le monde », ni ailleurs).
  await b.page.reload();
  await enterOffice(b.page);
  await waitForOffice(b.page);
  const panelOfBAgain = await openChat(b.page);
  await expect(messagesWith(panelOfBAgain, text)).toHaveCount(0);

  // B s'éloigne (seul dans la salle de réunion) : la conversation finit. L'onglet de A, resté sur À proximité, garde ce qui s'est dit, mais on n'y
  // écrit plus.
  await nearbyTab(a.page).click();
  await expect(messagesWith(panelOfA, text)).toHaveCount(1);
  await teleport(b.page, at(11, 2));
  await expect.poll(() => roomOf(a.page), { timeout: 5000 }).toBeNull();
  await expect(nearbyTab(a.page)).toHaveAttribute('aria-selected', 'true');
  await expect(messagesWith(panelOfA, text)).toHaveCount(1);
  await expect(panelOfA.getByText('Personne n\'est à proximité. Rapproche-toi de quelqu\'un pour lui écrire ici.')).toBeVisible();
  await expect(panelOfA.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
});
