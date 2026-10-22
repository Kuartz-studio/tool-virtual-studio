import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  createInvitation,
  enterOffice,
  expectInOffice,
  holdUntilStopped,
  inviteAndJoin,
  joinOffice,
  openMoreMenu,
  restingAt,
  selfAt,
  uniqueEmail,
  WALK_TIMEOUT,
  type Account,
} from './helpers';
import { AVATAR_COLORS, AVATAR_FRAME, MAP_COLORS, SHIRT, shirtAt, tilePixel, type Rgb } from './pixels';
import { DEV_TILE } from '../packages/shared/src/index';

// Les couleurs des tuiles de la carte de développement et du personnage des tests : lues dans les images servies (pixels.ts). Les pixels sont
// dessinés sans lissage : un pixel de l'écran a exactement la couleur d'un pixel de la tuile.
// Le fond du jeu (config.ts), autour de la carte.
const BACKGROUND: Rgb = [29, 32, 48];
// La couleur du message d'échec du chargement (Preloader.ts), qui n'est pas celle de la barre de chargement, blanche.
const ERROR_TEXT: Rgb = [255, 180, 180];
// Le centre de la chemise du personnage dans son image de 32 × 64 px (pieds au milieu du bas), par rapport au milieu de l'image que la
// caméra suit.
const SHIRT_DX = shirtAt.x - AVATAR_FRAME.width / 2;
const SHIRT_DY = shirtAt.y - AVATAR_FRAME.height / 2;

// La barre du bas, les panneaux et les vignettes (office/OfficeShell.tsx) sont posés sur la carte et cachent ce qui est dessous.
const HIDE_OVERLAY = '.office-ui { visibility: hidden }';

// Attend que le jeu ait dessiné au moins deux images : celle de la scène qui vient d'être prête, et la suivante.
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

// Une capture de la page, jointe au rapport du test (test-results/…/<nom>.png).
async function screenshot(page: Page, testInfo: TestInfo, name: string, style?: string): Promise<Buffer> {
  await nextFrames(page);
  const path = testInfo.outputPath(`${name}.png`);
  const png = await page.screenshot({ path, style });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  return png;
}

// Lit la capture dans la page (un navigateur sait décoder un PNG) : combien de pixels ont chacune de ces couleurs, et la couleur
// des points demandés.
async function readPixels(
  page: Page,
  png: Buffer,
  colors: Record<string, Rgb>,
  points: Array<[number, number]> = [],
): Promise<{ counts: Record<string, number>; at: Rgb[] }> {
  return page.evaluate(
    async ({ base64, colors, points }) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const counts: Record<string, number> = Object.fromEntries(Object.keys(colors).map((name) => [name, 0]));
      for (let i = 0; i < data.length; i += 4) {
        for (const [name, [r, g, b]] of Object.entries(colors)) {
          if (data[i] === r && data[i + 1] === g && data[i + 2] === b) counts[name] = (counts[name] ?? 0) + 1;
        }
      }
      const at = points.map(([x, y]): [number, number, number] => {
        const offset = (y * image.width + x) * 4;
        return [data[offset] ?? -1, data[offset + 1] ?? -1, data[offset + 2] ?? -1];
      });
      return { counts, at };
    },
    { base64: png.toString('base64'), colors, points },
  );
}

interface ColorSpread {
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// Où sont les pixels de cette couleur dans la capture : combien, et le rectangle qui les contient (maxX = −1 s'il n'y en a pas).
async function findColor(page: Page, png: Buffer, color: Rgb): Promise<ColorSpread> {
  return page.evaluate(
    async ({ base64, color }) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const found = { count: 0, minX: Infinity, maxX: -1, minY: Infinity, maxY: -1 };
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4;
          if (data[i] !== color[0] || data[i + 1] !== color[1] || data[i + 2] !== color[2]) continue;
          found.count++;
          found.minX = Math.min(found.minX, x);
          found.maxX = Math.max(found.maxX, x);
          found.minY = Math.min(found.minY, y);
          found.maxY = Math.max(found.maxY, y);
        }
      }
      return found;
    },
    { base64: png.toString('base64'), color },
  );
}

// Pour cette capture, dans ce rectangle (x0, y0, x1, y1) : parmi les endroits où un pixel d'une de ces couleurs touche un pixel
// d'une autre de ces couleurs (de n'importe quelles couleurs : null), combien sont sur un x pair ou impair (à gauche d'un pixel qui
// change), puis sur un y pair ou impair. Un décor ou un personnage agrandi ×2 sans défaut a des pixels de 2 × 2 px à l'écran : ses
// changements de couleur tombent tous sur la même parité. Des pixels de 1 ou de 3 px de large, qui papillotent, en mélangent les deux.
async function colorChanges(
  page: Page,
  png: Buffer,
  region: [number, number, number, number],
  colors: readonly Rgb[] | null,
): Promise<{ x: [number, number]; y: [number, number] }> {
  return page.evaluate(
    async ({ base64, region, colors }) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const known = colors && new Set(colors.map((color) => color.join(',')));
      const colorAt = (x: number, y: number) => {
        const i = (y * image.width + x) * 4;
        return `${data[i]},${data[i + 1]},${data[i + 2]}`;
      };
      const [x0, y0, x1, y1] = region;
      const x: [number, number] = [0, 0];
      const y: [number, number] = [0, 0];
      for (let row = y0; row < y1; row++) {
        for (let col = x0 + 1; col < x1; col++) {
          const [here, before] = [colorAt(col, row), colorAt(col - 1, row)];
          if (here !== before && (!known || (known.has(here) && known.has(before)))) x[col % 2]!++;
        }
      }
      for (let col = x0; col < x1; col++) {
        for (let row = y0 + 1; row < y1; row++) {
          const [here, above] = [colorAt(col, row), colorAt(col, row - 1)];
          if (here !== above && (!known || (known.has(here) && known.has(above)))) y[row % 2]!++;
        }
      }
      return { x, y };
    },
    { base64: png.toString('base64'), region, colors },
  );
}

// Un point de la carte, juste dedans puis juste dehors, de chaque côté : x et y sont ceux du pixel dedans, dx et dy la direction
// de la sortie. Loin des commandes du bureau (barre du bas, vignettes), qui cachent ce qui est dessous.
const edge = (x: number, y: number, dx: number, dy: number): [[number, number], [number, number]] => [[x, y], [x + dx, y + dy]];

test('la carte s\'affiche', async ({ page }, testInfo) => {
  // 1600 × 1100 : assez grand pour le zoom ×2 et pour voir toute la carte (24 × 16 cases de 32 px : 1536 × 1024 px à l'écran).
  await page.setViewportSize({ width: 1600, height: 1100 });
  await inviteAndJoin(page, { email: uniqueEmail('carla'), name: 'Carla', password: 'motdepasse-de-carla' });
  await page.waitForFunction(() => window.__office?.ready);
  await page.evaluate(() => window.__office!.showOthers(false));

  // Le canevas remplit la fenêtre (scale.mode RESIZE).
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.boundingBox()).toMatchObject({ x: 0, y: 0, width: 1600, height: 1100 });
  // Et la barre du bureau est par-dessus : elle ne prend pas de place au canevas, qui garde la taille de la fenêtre (ci-dessus).
  await expectInOffice(page, 'Carla');

  // Zoom ×2, la carte au milieu : 32 px de marge à gauche et à droite, 38 en haut et en bas.
  const edgesX2 = [edge(32, 600, -1, 0), edge(1567, 600, 1, 0), edge(800, 38, 0, -1), edge(800, 1061, 0, 1)];
  const x2 = await readPixels(page, await screenshot(page, testInfo, 'carte-zoom-x2', HIDE_OVERLAY), MAP_COLORS, edgesX2.flat());
  edgesX2.forEach((_, side) => {
    expect(x2.at[side * 2], `dedans, bord ${side}`).not.toEqual(BACKGROUND);
    expect(x2.at[side * 2 + 1], `dehors, bord ${side}`).toEqual(BACKGROUND);
  });
  // Murs, sols, bureaux, sol de la salle de réunion, sol des espaces de bureau et étiquette sont tous dessinés.
  for (const [name, count] of Object.entries(x2.counts)) expect(count, name).toBeGreaterThan(name.startsWith('texte') ? 20 : 1000);

  // Le zoom est recalculé quand la fenêtre change de taille : sous 1280 × 720, retour au zoom ×1, et la carte reste au milieu
  // (166 px de marge à gauche et à droite, 124 en haut et en bas).
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBe(1100);
  const edgesX1 = [edge(166, 400, -1, 0), edge(933, 400, 1, 0), edge(550, 124, 0, -1), edge(550, 635, 0, 1)];
  const x1 = await readPixels(page, await screenshot(page, testInfo, 'carte-zoom-x1', HIDE_OVERLAY), MAP_COLORS, edgesX1.flat());
  edgesX1.forEach((_, side) => {
    expect(x1.at[side * 2], `dedans, bord ${side}`).not.toEqual(BACKGROUND);
    expect(x1.at[side * 2 + 1], `dehors, bord ${side}`).toEqual(BACKGROUND);
  });
});

// Un fichier dont dépend le bureau manque (404) : le message d'échec remplace le bureau, qui n'est pas prêt.
async function expectLoadFailure(page: Page, missingFile: string, account: Account): Promise<void> {
  await page.route(missingFile, (route) => route.fulfill({ status: 404, body: 'introuvable' }));
  await inviteAndJoin(page, account);
  await expect(page.locator('#game-container canvas')).toBeVisible();

  // Le message est dessiné dans le canevas : on le reconnaît à ses pixels.
  const messagePixels = async () => {
    const png = await page.screenshot({ style: HIDE_OVERLAY });
    return (await readPixels(page, png, { message: ERROR_TEXT })).counts.message;
  };
  await expect.poll(messagePixels).toBeGreaterThan(200);
  // Pas un pixel de la carte, et le bureau n'est pas prêt.
  const { counts } = await readPixels(page, await page.screenshot({ style: HIDE_OVERLAY }), MAP_COLORS);
  expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(0);
  expect(await page.evaluate(() => window.__office?.ready ?? false)).toBe(false);
}

test('carte introuvable : un message à la place de la carte', async ({ page }) => {
  const account = { email: uniqueEmail('anouk'), name: 'Anouk', password: 'motdepasse-d-anouk' };
  await expectLoadFailure(page, '**/assets/maps/dev-office.json', account);
});

test('atlas de la banque d\'éléments introuvable : le même message à la place de la carte', async ({ page }) => {
  // Les meubles de la carte sortent de ces atlas : sans l'un d'eux, le bureau n'apparaîtrait qu'à moitié.
  const account = { email: uniqueEmail('axel'), name: 'Axel', password: 'motdepasse-d-axel' };
  await expectLoadFailure(page, '**/assets/decor/ecrans.png', account);
});

// Après un déploiement, les fichiers compilés changent de nom, et le serveur n'a plus les anciens : un onglet ouvert avant ne trouve
// plus le jeu, qu'il charge à la demande (404). L'avis le dit dès l'écran d'entrée (qui charge le jeu d'avance), et la page qui ne
// peut pas s'afficher fait place à la page d'erreur de l'appli ; « Recharger » remet tout d'aplomb.
test('le jeu introuvable (un onglet d\'avant un déploiement) : « Nouvelle version disponible », puis la page d\'erreur, et « Recharger »', async ({ page }) => {
  const game = '**/assets/PhaserGame-*.js';
  await page.route(game, (route) => route.fulfill({ status: 404, body: 'introuvable' }));
  await page.goto(await createInvitation(page.request, uniqueEmail('noe')));
  await page.getByLabel('Nom affiché', { exact: true }).fill('Noé');
  await page.getByLabel('Mot de passe', { exact: true }).fill('motdepasse-de-noe');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();

  const notice = page.getByRole('alert').filter({ hasText: 'Nouvelle version disponible' });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Recharger' })).toBeVisible();

  await page.getByRole('button', { name: /^Entrer( quand même)?$/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'La page ne s\'affiche pas' })).toBeVisible();

  // Le jeu est de nouveau là (la nouvelle page pointerait vers les nouveaux fichiers) : « Recharger », et l'on entre.
  await page.unroute(game);
  await page.getByRole('main').getByRole('button', { name: 'Recharger' }).click();
  await enterOffice(page);
  await expectInOffice(page, 'Noé');
});

// ---- L'avatar local -------------------------------------------------------------------------------------------------------
//
// La carte de développement et les aides (joinOffice, selfAt, holdUntilStopped…) : helpers.ts.
//
// Tous les tests partagent le serveur, et ceux des autres fichiers tournent en même temps : leurs avatars apparaissent au même point
// d'apparition et se promènent dans la même carte. Les tests de ce fichier regardent l'avatar local, souvent à l'écran : ils cachent
// les autres joueurs (window.__office.showOthers).

// Un compte neuf, dans le bureau prêt, où l'on ne voit que soi.
async function joinOfficeAlone(page: Page, name: string): Promise<void> {
  await joinOffice(page, name);
  await page.evaluate(() => window.__office!.showOthers(false));
}

// La carte de développement, en pixels.
const MAP_SIZE = { width: 24 * 32, height: 16 * 32 };

// Où est l'avatar à l'écran, sur un axe, selon les règles de la caméra : elle regarde `target`, sans sortir de la carte. Une vue (la
// longueur du canevas divisée par le zoom) plus petite que la carte se déplace avec lui, entre sa moitié et la carte moins sa moitié
// (la caméra est alors contre le bord de la carte, et l'avatar n'est plus au centre). Une vue plus grande montre la carte entière,
// au milieu : rien à suivre.
function onScreen(target: number, mapLength: number, canvasLength: number, zoom: number): number {
  const view = canvasLength / zoom;
  const center = view >= mapLength ? mapLength / 2 : Math.min(Math.max(target, view / 2), mapLength - view / 2);
  return canvasLength / 2 + zoom * (target - center);
}

// Où est le milieu de la chemise de l'avatar dont les pieds sont en `feet`. La caméra regarde le milieu de l'avatar (32 px au-dessus
// des pieds : son image fait 64 px de haut), et la chemise est SHIRT_DX, SHIRT_DY px de carte plus loin.
function shirtOnScreen(feet: { x: number; y: number }, canvas: { width: number; height: number }, zoom: number): [number, number] {
  return [
    onScreen(feet.x, MAP_SIZE.width, canvas.width, zoom) + zoom * SHIRT_DX,
    onScreen(feet.y - 32, MAP_SIZE.height, canvas.height, zoom) + zoom * SHIRT_DY,
  ];
}

test('l\'avatar apparaît sur le point d\'apparition, pieds en (80, 240), avec son ombre', async ({ page }, testInfo) => {
  // Même fenêtre que « la carte s'affiche » : zoom ×2, la carte entière au milieu, à 32 px de marge à gauche et 38 en haut. Un
  // point de la carte (x, y) est donc à l'écran en (32 + 2x, 38 + 2y).
  await page.setViewportSize({ width: 1600, height: 1100 });
  await joinOfficeAlone(page, 'Zoé');

  // C'est le compte connecté : son identifiant est celui de la session.
  const session = (await (await page.request.get('/api/auth/get-session')).json()) as { user: { id: string } };
  expect(await selfAt(page)).toEqual({ id: session.user.id, x: 80, y: 240 });

  const png = await screenshot(page, testInfo, 'avatar-apparition', HIDE_OVERLAY);
  // L'image du personnage (32 × 64 px) a ses pieds au bas, au milieu : son coin haut-gauche est en (80 − 16, 240 − 64).
  const shirt: [number, number] = [32 + 2 * (64 + shirtAt.pixel.x) + 1, 38 + 2 * (176 + shirtAt.pixel.y) + 1];   // un pixel de la chemise
  const shadow: [number, number] = [32 + 2 * 80 + 1, 38 + 2 * 241 + 1];   // 1 px sous les pieds, au milieu de l'ombre
  const floorBesideShadow: [number, number] = [32 + 2 * 80 + 1, 38 + 2 * 244 + 1];   // 4 px sous les pieds, hors de l'ombre (6 px de haut)
  const { at } = await readPixels(page, png, {}, [shirt, shadow, floorBesideShadow]);

  // Le personnage des tests, face à nous.
  expect(at[0], 'chemise').toEqual(SHIRT);
  // Le sol (de la tuile (2, 7), aux pixels (16, 20) et (16, 17)), assombri d'un quart par l'ombre noire à 25 % sous les pieds. Le sol autour n'est
  // pas touché.
  expect(at[2], 'sol hors de l\'ombre').toEqual(tilePixel(DEV_TILE.floor, 16, 20));
  for (const [channel, base] of tilePixel(DEV_TILE.floor, 16, 17).entries()) {
    expect(Math.abs(at[1]![channel]! - 0.75 * base), `ombre, canal ${channel} : ${at[1]}`).toBeLessThanOrEqual(2);
  }
});

test('marcher à droite : ArrowRight enfoncée 500 ms fait avancer l\'avatar, qui s\'arrête quand on la relâche', async ({ page }) => {
  await joinOfficeAlone(page, 'Rosa');
  const x0 = (await selfAt(page)).x;

  const start = Date.now();
  await page.keyboard.down('ArrowRight');
  // Une machine chargée peut tarder à dessiner l'image qui voit la touche : les 500 ms commencent quand l'avatar a bougé.
  await expect.poll(async () => (await selfAt(page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(x0);
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const heldSeconds = (Date.now() - start) / 1000;

  const walked = await restingAt(page);
  expect(walked.x - x0).toBeGreaterThan(40);
  // 320 px/s (WALK_SPEED_PX_PER_S) : une demi-seconde fait 160 px. Jamais plus vite que la marche sans Maj, pendant le temps qu'a
  // duré l'appui (à quelques pixels près : l'image qui suit le relâchement).
  expect(walked.x - x0).toBeLessThanOrEqual(320 * heldSeconds + 24);
  // Une seule direction à la fois : il n'a pas bougé en y.
  expect(walked.y).toBe(240);

  // Relâchée, il s'arrête et ne repart pas.
  await page.waitForTimeout(300);
  expect(await selfAt(page)).toEqual(walked);
});

test('courir : avec Maj enfoncée, l\'avatar va une fois et demie plus vite, et le serveur ne le ramène pas en arrière', async ({ page }) => {
  await joinOfficeAlone(page, 'Rosa');
  const x0 = (await selfAt(page)).x;
  // La vitesse que la physique donne à l'avatar : exacte, quelle que soit la charge de la machine (WALK_SPEED_PX_PER_S, puis la course).
  const speed = () => page.evaluate(() => window.__office!.speed());

  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(x0);
  await expect.poll(speed).toBe(320);
  await page.waitForTimeout(400);

  // Maj enfoncée en marchant : on court, à la vitesse qu'avait la course avant la mise à jour (NORMAL_MAX_SPEED_PX_PER_S).
  await page.keyboard.down('Shift');
  await expect.poll(speed).toBe(480);
  await page.waitForTimeout(350);
  await page.keyboard.up('Shift');
  await expect.poll(speed).toBe(320);
  await page.keyboard.up('ArrowRight');
  await expect.poll(speed).toBe(0);

  // Le serveur a accepté le trajet : au repos, l'avatar est là où il s'est arrêté, sans retour en arrière (move:correct).
  const stopped = await restingAt(page);
  await page.waitForTimeout(500);
  expect(await selfAt(page)).toEqual(stopped);
});

test('le café : 640 px/s, 960 avec Maj en plus ; le serveur le laisse faire, et le mur d\'une case l\'arrête, même quand le jeu tourne au ralenti', async ({ page }) => {
  await joinOfficeAlone(page, 'Rosa');
  const speed = () => page.evaluate(() => window.__office!.speed());
  expect(await page.evaluate(() => window.__office!.boosted())).toBe(false);
  await page.evaluate(() => window.__office!.boost(30_000));
  expect(await page.evaluate(() => window.__office!.boosted())).toBe(true);

  // Le processeur est ralenti : le jeu dessine bien moins d'images par seconde. La physique avance par pas fixes, elle ne saute pas de mur pour autant.
  const cpu = await page.context().newCDPSession(page);
  await cpu.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    const x0 = (await selfAt(page)).x;
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await selfAt(page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(x0);
    await expect.poll(speed).toBe(640);
    // Maj en plus : 960 px/s, plus que ce que le serveur permet sans café (720 px/s tenus : il recalerait l'avatar).
    await page.keyboard.down('Shift');
    await expect.poll(speed).toBe(960);
    // Le mur de droite de la petite carte commence à x = 736 : la zone de collision (20 px de large) y touche à x = 726. Elle ne va jamais au-delà.
    await expect.poll(async () => (await selfAt(page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(700);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('Shift');
    const stopped = await restingAt(page);
    expect(stopped.x).toBeLessThanOrEqual(726);
    expect(stopped.y).toBe(240);
    // Le serveur a accepté tout le trajet : au repos, l'avatar est où il s'est arrêté, sans retour en arrière (move:correct).
    await page.waitForTimeout(500);
    expect(await selfAt(page)).toEqual(stopped);
  } finally {
    await cpu.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
});

test('zoom : la molette, les boutons et les touches, jusqu\'à ×2 plus près et ×4 plus loin que la vue de départ', async ({ page }) => {
  await joinOfficeAlone(page, 'Rosa');
  const zoom = () => page.evaluate(() => window.__office!.zoom());
  const start = await zoom();
  const [width, height] = [page.viewportSize()!.width, page.viewportSize()!.height];
  await page.mouse.move(width / 2, height / 2);
  const wheel = async (deltaY: number) => {
    await page.mouse.wheel(0, deltaY);
    // Au-delà de l'attente entre deux crans de molette.
    await page.waitForTimeout(300);
  };

  // La molette vers le haut rapproche, au plus ×2 ; encore un cran, et rien ne change.
  await wheel(-100);
  await expect.poll(zoom).toBe(start * 2);
  await wheel(-100);
  expect(await zoom()).toBe(start * 2);

  // Vers le bas : la vue de départ, puis ×1/2, ×1/4 au plus loin, et pas au-delà.
  await wheel(100);
  await expect.poll(zoom).toBe(start);
  await wheel(100);
  await expect.poll(zoom).toBe(start / 2);
  await wheel(100);
  await expect.poll(zoom).toBe(start / 4);
  await wheel(100);
  expect(await zoom()).toBe(start / 4);

  // Les boutons : le menu « Plus » dit 25 %, + remonte, « Rétablir le zoom » dans ce menu rend la vue de départ.
  const resetZoom = async () => (await openMoreMenu(page)).getByRole('menuitem', { name: 'Rétablir le zoom (100 %)' });
  await expect(await resetZoom()).toContainText('25 %');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Zoom avant' }).click();
  await expect.poll(zoom).toBe(start / 2);
  await (await resetZoom()).click();
  await expect.poll(zoom).toBe(start);

  // Le clavier : + rapproche, 0 rétablit, - éloigne.
  await page.keyboard.press('+');
  await expect.poll(zoom).toBe(start * 2);
  await page.keyboard.press('0');
  await expect.poll(zoom).toBe(start);
  await page.keyboard.press('-');
  await expect.poll(zoom).toBe(start / 2);

  // L'avatar suit toujours la caméra : on marche, il avance (la page n'est pas figée par le zoom).
  const x0 = (await selfAt(page)).x;
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(x0);
  await page.keyboard.up('ArrowRight');
});

test('un mur arrête : depuis l\'apparition, ArrowUp enfoncée 2 s', async ({ page }) => {
  await joinOfficeAlone(page, 'Mia');
  const start = await selfAt(page);

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2000);
  await page.keyboard.up('ArrowUp');

  const end = await selfAt(page);
  // La ligne 5 est un mur en x = 2 : il commence en y = 160 et finit en y = 192. Les pieds ne peuvent pas le passer.
  expect(end.y).toBeGreaterThanOrEqual(192);
  // Mais l'avatar a bien marché jusqu'à lui, et n'a pas dévié.
  expect(end.y).toBeLessThan(start.y);
  expect(end.x).toBe(start.x);
});

test('le corps de l\'avatar a 20 × 12 px aux pieds : il s\'arrête contre les murs et les bureaux sur ses bords', async ({ page }) => {
  test.slow();
  await joinOfficeAlone(page, 'Gaëlle');

  // Vers la gauche : le mur de la colonne 0 finit en x = 32, et le corps (20 px de large) s'arrête à 10 px de lui.
  expect(await holdUntilStopped(page, 'ArrowLeft')).toEqual({ x: 42, y: 240 });
  // Vers le haut : le mur de la ligne 5 finit en y = 192. Le corps (12 px de haut, du bas de l'avatar) s'arrête contre lui, et les
  // pieds, un pixel au-dessus de son bas, sont 11 px plus bas.
  expect(await holdUntilStopped(page, 'ArrowUp')).toEqual({ x: 42, y: 203 });
  // Vers le bas : le mur de la ligne 15 commence en y = 480. Le corps le touche, mais les pieds restent dans leur case (y = 479) :
  // en y = 480, le serveur les verrait déjà dans le mur.
  expect(await holdUntilStopped(page, 'ArrowDown')).toEqual({ x: 42, y: 479 });
});

test('un bureau arrête : vu d\'en haut, comme un mur', async ({ page }) => {
  await joinOfficeAlone(page, 'Théo');

  // Le bureau des colonnes 4 et 5 (x de 128 à 192) commence en y = 288. Il faut être au-dessus : vers la droite jusqu'à x = 150, le
  // corps (de x − 10 à x + 10) est alors devant lui.
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(page)).x, { intervals: [20], timeout: WALK_TIMEOUT }).toBeGreaterThanOrEqual(150);
  await page.keyboard.up('ArrowRight');
  const above = await restingAt(page);
  // Le corps recouvre encore les colonnes du bureau tant que x − 10 < 192.
  expect(above.x).toBeLessThan(200);

  const stopped = await holdUntilStopped(page, 'ArrowDown');
  expect(stopped.y).toBe(287);
  expect(stopped.x).toBe(above.x);
});

test('les touches ZQSD d\'un AZERTY sont celles de WASD : par leur position (KeyW, KeyA, KeyS, KeyD)', async ({ page }) => {
  await joinOfficeAlone(page, 'Inès');
  const start = await selfAt(page);

  // À droite : « D » (même position sur les deux claviers).
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyD');
  const right = await restingAt(page);
  expect(right.x).toBeGreaterThan(start.x + 20);
  expect(right.y).toBe(start.y);

  // En bas : « S » (même position aussi).
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyS');
  const down = await restingAt(page);
  expect(down.y).toBeGreaterThan(right.y + 20);
  expect(down.x).toBe(right.x);

  // À gauche : « Q » d'un AZERTY, à la position de KeyA. Un événement tel que l'AZERTY l'envoie : key = 'q', code = 'KeyA'.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyA' })));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'q', code: 'KeyA' })));
  const left = await restingAt(page);
  expect(left.x).toBeLessThan(down.x - 20);

  // Le « A » d'un AZERTY est à la position de KeyQ : il ne déplace pas.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyQ' })));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyQ' })));
  expect(await restingAt(page)).toEqual(left);
});

test('dans un champ de saisie, les touches ne déplacent pas l\'avatar', async ({ page }) => {
  await joinOfficeAlone(page, 'Hugo');
  const start = await selfAt(page);

  // Un champ (le chat, bientôt) qui a le focus.
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.id = 'champ-de-saisie';
    document.body.append(field);
    field.focus();
  });
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ArrowRight');
  expect(await selfAt(page)).toEqual(start);
  // Les lettres ont bien été tapées dans le champ.
  await expect(page.locator('#champ-de-saisie')).toHaveValue('d');

  // Le focus quitte le champ : le clavier déplace de nouveau l'avatar.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  expect((await selfAt(page)).x).toBeGreaterThan(start.x + 20);
});

test('la fenêtre perd le focus en pleine marche : l\'avatar s\'arrête, même si la touche est restée enfoncée', async ({ page }) => {
  await joinOfficeAlone(page, 'Lina');
  const start = await selfAt(page);

  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(page)).x).toBeGreaterThan(start.x + 10);
  // Un relâchement n'arrive pas à une page qui n'a plus le focus : sans cela, la touche resterait « enfoncée ».
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(200);
  const stopped = await selfAt(page);
  await page.waitForTimeout(300);
  expect(await selfAt(page)).toEqual(stopped);
  await page.keyboard.up('ArrowRight');
});

// Le milieu vertical de la chemise bouge d'une image à l'autre de l'animation d'attente (les bras, le souffle) : une machine chargée le
// photographie à n'importe quelle image de l'animation, d'où une marge plus large qu'à l'horizontale, que rien n'anime.
const expectNear = (value: number, expected: number, tolerance = 8) => expect(Math.abs(value - expected), `${value} pour ${expected}`).toBeLessThan(tolerance);

test('la caméra suit l\'avatar, sans sortir de la carte', async ({ page }, testInfo) => {
  test.slow();
  // 1280 × 720 : zoom ×2, la vue (640 × 360 px de carte) est plus petite que la carte (768 × 512).
  await joinOfficeAlone(page, 'Lou');
  expect(page.viewportSize()).toEqual({ width: 1280, height: 720 });
  const canvas = { width: 1280, height: 720 };

  // La caméra regarde le milieu de l'avatar sans quitter la carte : horizontalement, le centre de la vue ne peut pas aller plus à
  // gauche que x = 320 (la moitié de la vue) ni plus à droite que x = 448 (768 − 320). À l'apparition (x = 80), la caméra est donc
  // contre le bord gauche, et l'avatar à gauche du centre : 640 + 2 × (80 − 320) = 160. Verticalement, la vue (360) tient dans la
  // carte (512) et l'avatar est au milieu de l'écran : le milieu de sa chemise est à 360 + 2 × SHIRT_DY.
  const spawn = await findColor(page, await screenshot(page, testInfo, 'camera-apparition', HIDE_OVERLAY), SHIRT);
  expect(spawn.count).toBeGreaterThan(50);
  const [spawnX, spawnY] = shirtOnScreen(await selfAt(page), canvas, 2);
  expect([spawnX, spawnY]).toEqual([160 + 2 * SHIRT_DX, 360 + 2 * SHIRT_DY]);
  expect((spawn.minX + spawn.maxX) / 2).toBeCloseTo(spawnX, -1);   // à 5 px près
  expectNear((spawn.minY + spawn.maxY) / 2, spawnY);

  // Plus loin dans la carte (de x = 320 à 448), la caméra le suit : l'avatar reste au centre de l'écran, x = 640.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await selfAt(page)).x, { intervals: [50], timeout: WALK_TIMEOUT }).toBeGreaterThanOrEqual(380);
  await page.keyboard.up('KeyD');
  const middleAt = await restingAt(page);
  const pngMiddle = await screenshot(page, testInfo, 'camera-milieu', HIDE_OVERLAY);
  const middle = await findColor(page, pngMiddle, SHIRT);
  const [middleX, middleY] = shirtOnScreen(middleAt, canvas, 2);
  expect((middle.minX + middle.maxX) / 2).toBeCloseTo(middleX, -1);
  expectNear((middle.minY + middle.maxY) / 2, middleY);
  // La vue est entièrement dans la carte : pas un pixel du fond du jeu.
  expect((await readPixels(page, pngMiddle, { fond: BACKGROUND })).counts.fond).toBe(0);

  // Près du bord droit, la caméra s'arrête avec la carte (centre de la vue en x = 448) : l'avatar quitte le centre de l'écran, et le
  // bord de la carte est celui de l'écran, sans le vide du fond autour.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await selfAt(page)).x, { intervals: [50], timeout: WALK_TIMEOUT }).toBeGreaterThanOrEqual(600);
  await page.keyboard.up('KeyD');
  const rightAt = await restingAt(page);
  const pngRight = await screenshot(page, testInfo, 'camera-bord-droit', HIDE_OVERLAY);
  const right = await findColor(page, pngRight, SHIRT);
  const [rightX, rightY] = shirtOnScreen(rightAt, canvas, 2);
  expect(rightX).toBeCloseTo(640 + 2 * (rightAt.x - 448) + 2 * SHIRT_DX, 5);
  expect((right.minX + right.maxX) / 2).toBeCloseTo(rightX, -1);
  expectNear((right.minY + right.maxY) / 2, rightY);
  const { at, counts } = await readPixels(page, pngRight, { fond: BACKGROUND }, [[1279, 360], [1279, 5], [1279, 714]]);
  for (const pixel of at) expect(pixel).not.toEqual(BACKGROUND);
  expect(counts.fond).toBe(0);
});

test('la caméra continue de suivre l\'avatar quand la fenêtre change de taille', async ({ page }) => {
  test.slow();
  await joinOfficeAlone(page, 'Eva');
  // L'avatar s'arrête vers x = 370, loin des bords : à 1280 × 720 comme dans les deux fenêtres qui suivent, la caméra le suit (au
  // centre de la vue de x = 320 à 448, puis de 350 à 418), même s'il dépasse un peu avant que la touche soit relâchée.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await selfAt(page)).x, { intervals: [50], timeout: WALK_TIMEOUT }).toBeGreaterThanOrEqual(365);
  await page.keyboard.up('KeyD');
  const resting = await restingAt(page);

  const shirtCenter = async () => {
    const shirt = await findColor(page, await page.screenshot({ style: HIDE_OVERLAY }), SHIRT);
    return [(shirt.minX + shirt.maxX) / 2, (shirt.minY + shirt.maxY) / 2];
  };
  // La chemise est à l'écran là où les règles de la caméra la mettent, dans cette fenêtre, une fois dessinée à sa taille.
  const expectShirtAt = async (canvas: { width: number; height: number }, zoom: number) => {
    const [x, y] = shirtOnScreen(resting, canvas, zoom);
    await expect.poll(async () => (await shirtCenter())[0], { timeout: WALK_TIMEOUT }).toBeCloseTo(x, -1);
    expectNear((await shirtCenter())[1], y);
    return [x, y];
  };

  // Plus grande, toujours au zoom ×2 (la vue : 700 × 400 px de carte) : l'avatar est au centre de l'écran, x = 700 tant que x est
  // entre 350 et 418, et y = 400 + 2 × SHIRT_DY.
  await page.setViewportSize({ width: 1400, height: 800 });
  const [, bigY] = await expectShirtAt({ width: 1400, height: 800 }, 2);
  expect(bigY).toBe(400 + 2 * SHIRT_DY);

  // Plus petite que 1280 × 720 : zoom ×1, la vue (700 × 480 px de carte) est plus petite que la carte (768 × 512). Horizontalement,
  // l'avatar est toujours suivi. Verticalement, la caméra ne descend pas sous y = 240 (la moitié de la vue) : le milieu de l'avatar
  // (y = 208) est 32 px au-dessus du centre de l'écran, et la chemise à 240 − 32 + SHIRT_DY.
  await page.setViewportSize({ width: 700, height: 480 });
  const [, smallY] = await expectShirtAt({ width: 700, height: 480 }, 1);
  expect(smallY).toBe(208 + SHIRT_DY);

  // Et il ne s'est pas déplacé pendant ce temps.
  expect(await selfAt(page)).toEqual(resting);
});

test('les pixels restent nets pour un avatar arrêté à x entier, dans une fenêtre de largeur impaire', async ({ page }) => {
  test.slow();
  // 1283 × 727 : zoom ×2, et le centre de l'écran est entre deux pixels (641,5). Quand la caméra suit l'avatar à un x entier, un
  // pixel de la carte tombe pile entre deux pixels de l'écran : sans arrondi à l'affichage, des pixels de 1 et de 3 px de large.
  await page.setViewportSize({ width: 1283, height: 727 });
  await joinOfficeAlone(page, 'Ida');

  // Un x entier, au milieu de la zone que la caméra suit (x de 320 à 448) : l'avatar contre la face est du bureau du milieu (les
  // colonnes 11 et 12, x de 352 à 416, y de 288 à 320). Le corps (de x − 10 à x + 10, de y − 11 à y + 1) s'y arrête en
  // x = 416 + 10 = 426, s'il est en face du bureau : y de 288 à 330. L'avatar est posé à droite du bureau, au milieu de cette bande
  // (window.__office.teleport), puis marche vers la gauche jusqu'au bureau.
  //
  // Posé, et non amené au clavier : il fallait relâcher ArrowDown dans cette bande de 43 px (moins de 270 ms de marche), et sur une
  // machine chargée, la position lue trop rarement et la touche relâchée trop tard laissaient l'avatar descendre jusqu'à y = 346 : il
  // passait sous le bureau, jusqu'au mur (x = 42).
  await page.evaluate(() => window.__office!.teleport(450, 309));
  await expect.poll(() => selfAt(page), { timeout: WALK_TIMEOUT }).toMatchObject({ x: 450, y: 309 });
  const stopped = await holdUntilStopped(page, 'ArrowLeft');
  expect(stopped).toEqual({ x: 426, y: 309 });
  await restingAt(page);

  const png = await page.screenshot({ style: HIDE_OVERLAY });
  const shirt = await findColor(page, png, SHIRT);
  const avatar = await colorChanges(page, png, [shirt.minX - 40, shirt.minY - 90, shirt.maxX + 40, shirt.maxY + 70], AVATAR_COLORS);
  // Un coin de l'écran qui n'a que de la carte : ni l'avatar, ni l'étiquette.
  const map = await colorChanges(page, png, [1283 - 420, 40, 1283 - 20, 330], null);

  for (const [name, { x, y }] of Object.entries({ avatar, carte: map })) {
    expect(x[0] + x[1], `${name} : des changements de couleur`).toBeGreaterThan(100);
    expect(Math.min(...x), `${name}, x pair/impair : ${x}`).toBe(0);
    expect(Math.min(...y), `${name}, y pair/impair : ${y}`).toBe(0);
  }
  expect((await readPixels(page, png, { fond: BACKGROUND })).counts.fond).toBe(0);
});

test('les pixels restent nets quand la caméra suit l\'avatar, même dans une fenêtre de taille impaire', async ({ page }) => {
  test.slow();
  // 1283 × 727 : zoom ×2, et le centre de l'écran est entre deux pixels (641,5) : la caméra, qui suit l'avatar à des positions
  // quelconques, n'est presque jamais sur un pixel de l'écran. Les objets de la carte et l'avatar sont arrondis à l'affichage.
  await page.setViewportSize({ width: 1283, height: 727 });
  await joinOfficeAlone(page, 'Ugo');

  // La caméra commence à suivre l'avatar à x = 320 : on regarde la marche de 330 à 700 environ.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await selfAt(page)).x, { intervals: [20], timeout: WALK_TIMEOUT }).toBeGreaterThan(330);
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(23 + i * 7);
    const png = await page.screenshot({ style: HIDE_OVERLAY });
    const shirt = await findColor(page, png, SHIRT);
    const { x, y } = await colorChanges(page, png, [shirt.minX - 40, shirt.minY - 90, shirt.maxX + 40, shirt.maxY + 70], AVATAR_COLORS);
    expect(x[0] + x[1], 'le personnage a des changements de couleur').toBeGreaterThan(100);
    expect(Math.min(...x), `x pair/impair : ${x}`).toBe(0);
    expect(Math.min(...y), `y pair/impair : ${y}`).toBe(0);
    // Ni couture entre les tuiles de la carte, qui laisserait voir le fond.
    expect((await readPixels(page, png, { fond: BACKGROUND })).counts.fond).toBe(0);
  }
  await page.keyboard.up('KeyD');
});

test('la marche s\'anime sur place, et l\'avatar immobile ne bouge plus', async ({ page }) => {
  test.slow();
  // La carte entière est visible (1600 × 1100) : la caméra ne bouge pas, l'avatar est toujours au même endroit de l'écran.
  await page.setViewportSize({ width: 1600, height: 1100 });
  await joinOfficeAlone(page, 'Noé');

  // ArrowUp jusqu'au mur (les pieds en (80, 203)), puis la touche reste enfoncée : l'avatar marche sur place.
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => (await selfAt(page)).y, { intervals: [50], timeout: WALK_TIMEOUT }).toBe(203);

  // L'avatar (64 px de haut, ses pieds en (192, 444) à l'écran), et son ombre.
  const clip = { x: 160, y: 310, width: 64, height: 156 };
  // Des captures à intervalles inégaux : le cycle de marche dure 600 ms (6 images de 100 ms), et des captures à intervalles réguliers,
  // d'une demi-période par exemple, tomberaient toujours sur la même image.
  const gaps = [0, 37, 71, 113, 29, 97, 53, 131, 17, 89, 61, 43];
  const looks = async () => {
    const seen = new Set<string>();
    for (const gap of gaps) {
      await page.waitForTimeout(gap);
      seen.add((await page.screenshot({ clip, style: HIDE_OVERLAY })).toString('base64'));
    }
    return seen;
  };

  // Le cycle de marche fait six images différentes ; on en voit plusieurs.
  const walking = await looks();
  expect(walking.size).toBeGreaterThanOrEqual(3);
  expect((await selfAt(page)).y).toBe(203);

  // Relâchée : l'avatar respire (son cycle d'immobile, plus lent), mais ne marche plus : aucune des images de la marche, et il n'a pas bougé.
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(300);
  const resting = await looks();
  expect(resting.size).toBeGreaterThanOrEqual(1);
  expect([...resting].filter((look) => walking.has(look))).toEqual([]);
  expect((await selfAt(page)).y).toBe(203);
});
