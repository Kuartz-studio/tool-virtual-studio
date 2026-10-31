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
// d'une autre de ces couleurs (de n'importe quelles couleurs : null), combien tombent sur chaque reste de x modulo `scale` (à gauche d'un
// pixel qui change), puis de y. Un décor ou un personnage agrandi à un zoom entier (200 % : ×3) sans défaut a des pixels de 3 × 3 px à
// l'écran : ses changements de couleur tombent tous sur le même reste. Des pixels de 2 ou de 4 px de large, qui papillotent, en mélangent
// plusieurs.
async function colorChanges(
  page: Page,
  png: Buffer,
  region: [number, number, number, number],
  colors: readonly Rgb[] | null,
  scale: number,
): Promise<{ x: number[]; y: number[] }> {
  return page.evaluate(
    async ({ base64, region, colors, scale }) => {
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
      const x = new Array<number>(scale).fill(0);
      const y = new Array<number>(scale).fill(0);
      for (let row = y0; row < y1; row++) {
        for (let col = x0 + 1; col < x1; col++) {
          const [here, before] = [colorAt(col, row), colorAt(col - 1, row)];
          if (here !== before && (!known || (known.has(here) && known.has(before)))) x[col % scale]!++;
        }
      }
      for (let col = x0; col < x1; col++) {
        for (let row = y0 + 1; row < y1; row++) {
          const [here, above] = [colorAt(col, row), colorAt(col, row - 1)];
          if (here !== above && (!known || (known.has(here) && known.has(above)))) y[row % scale]!++;
        }
      }
      return { x, y };
    },
    { base64: png.toString('base64'), region, colors, scale },
  );
}

// Tous les changements de couleur sont sur le même reste : les pixels ont tous la même largeur.
const onOneResidue = (counts: number[]): boolean => counts.filter((count) => count > 0).length <= 1;

test('la carte s\'affiche', async ({ page }, testInfo) => {
  // 1600 × 1100 : assez grand pour le zoom de départ (×1,5 à 100 %) ; la carte (24 × 16 cases de 32 px) y fait 1152 × 768 px à l'écran.
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

  // Zoom ×1,5 (100 %), la caméra sur le milieu de l'avatar, au point d'apparition (ses pieds en (80, 240), son milieu 32 px plus haut), mais dans ses
  // bornes : la carte et cinq cases de marge (game/zoom.ts, cameraBounds). La vue fait 1066,7 px de carte de large : son centre ne va pas à l'ouest de
  // −160 + 533,3 = 373,3 px. La carte a donc 160 px de carte (240 px de l'écran) de fond à sa gauche : son bord gauche est à 800 − 1,5 × 373,3 = 240 px,
  // le droit à 1392 px, le haut à 550 − 1,5 × 208 = 238 px, le bas à 1006 px.
  expect(await page.evaluate(() => window.__office!.zoom())).toBe(1.5);
  const cameraBig = await page.evaluate(() => window.__office!.camera());
  expect(cameraBig.x).toBeCloseTo(-160 + 1600 / 1.5 / 2, 6);
  expect(cameraBig.y).toBeCloseTo(208, 6);
  const edgesBig = mapEdges({ width: 1600, height: 1100 }, 1.5, cameraBig);
  expect(edgesBig.map(({ outside }) => outside !== null)).toEqual([true, true, true, true]);
  const pngBig = await screenshot(page, testInfo, 'carte-zoom-150', HIDE_OVERLAY);
  await expectMapEdges(page, pngBig, edgesBig);
  // Murs, sols, bureaux, sol de la salle de réunion, sol des espaces de bureau et étiquette sont tous dessinés.
  for (const [name, count] of Object.entries((await readPixels(page, pngBig, MAP_COLORS)).counts)) expect(count, name).toBeGreaterThan(name.startsWith('texte') ? 20 : 1000);

  // Le zoom est recalculé quand la fenêtre change de taille : sous 1280 × 720, le zoom de départ est ×1 (donc ×0,75 à 100 %), et la caméra reste
  // sur l'avatar, dans ses bornes : la vue fait 1066,7 × 800 px de carte, son centre va en (373,3, 240) (le bord gauche de la carte à 400 − 0,75 × 373,3
  // = 120 px, le droit à 696 px, le haut à 300 − 0,75 × 240 = 120 px, le bas à 504 px). 800 × 600 : une fenêtre où 100 % est au-dessus du plancher du
  // zoom (98 % : la carte et ses cinq cases de marge font 1088 × 832 px) ; sur 1100 × 760, il serait à 135 % (zoom.ts, zoomFloorPercent).
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBe(800);
  await expect.poll(() => page.evaluate(() => window.__office!.zoom())).toBe(0.75);
  const cameraSmall = await page.evaluate(() => window.__office!.camera());
  expect(cameraSmall.x).toBeCloseTo(-160 + 800 / 0.75 / 2, 6);
  expect(cameraSmall.y).toBeCloseTo(-160 + 600 / 0.75 / 2, 6);
  const edgesSmall = mapEdges({ width: 800, height: 600 }, 0.75, cameraSmall);
  expect(edgesSmall.map(({ outside }) => outside !== null)).toEqual([true, true, true, true]);
  await expectMapEdges(page, await screenshot(page, testInfo, 'carte-zoom-75', HIDE_OVERLAY), edgesSmall);
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

// Un bord de la carte à l'écran : un pixel juste dedans, et un juste dehors, ou null quand le bord est au-delà de l'écran (le pixel dedans est
// alors le dernier de l'écran, de ce côté).
interface MapEdge {
  inside: [number, number];
  outside: [number, number] | null;
}

// Les quatre bords de la carte à l'écran (gauche, droite, haut, bas), la caméra centrée sur le point `center` de la carte (le milieu de l'avatar,
// qu'elle suit, ramené dans ses bornes) : le point (x, y) de la carte est à l'écran en (largeur / 2 + zoom × (x − center.x), hauteur / 2 + zoom × (y −
// center.y)), sans arrondi. Un reste impair met le bord entre deux pixels de l'écran, et le pixel à cheval est mi-carte, mi-fond : on prend de
// part et d'autre le premier pixel tout entier dedans, et le premier tout entier dehors. Au milieu de l'écran, loin des commandes du bureau
// (barre du bas, vignettes), qui cachent ce qui est dessous.
function mapEdges(canvas: { width: number; height: number }, zoom: number, center: { x: number; y: number }): MapEdge[] {
  const left = canvas.width / 2 - zoom * center.x;
  const top = canvas.height / 2 - zoom * center.y;
  const right = left + MAP_SIZE.width * zoom;
  const bottom = top + MAP_SIZE.height * zoom;
  const [middleX, middleY] = [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)];
  const [lastX, lastY] = [canvas.width - 1, canvas.height - 1];
  const within = (value: number, last: number) => Math.min(last, Math.max(0, value));
  const edge = (inside: [number, number], outside: [number, number]): MapEdge => {
    const shown = outside[0] >= 0 && outside[0] <= lastX && outside[1] >= 0 && outside[1] <= lastY;
    return shown ? { inside, outside } : { inside: [within(inside[0], lastX), within(inside[1], lastY)], outside: null };
  };
  // Le pixel x couvre [x, x + 1) : tout entier dedans à gauche dès x ≥ left, à droite tant que x + 1 ≤ right ; dehors, l'inverse.
  return [
    edge([Math.ceil(left), middleY], [Math.floor(left) - 1, middleY]),
    edge([Math.floor(right) - 1, middleY], [Math.ceil(right), middleY]),
    edge([middleX, Math.ceil(top)], [middleX, Math.floor(top) - 1]),
    edge([middleX, Math.floor(bottom) - 1], [middleX, Math.ceil(bottom)]),
  ];
}

// Dans cette capture, la carte est dessinée juste en deçà de chaque bord, et le fond du jeu juste au-delà (quand le bord est à l'écran).
async function expectMapEdges(page: Page, png: Buffer, edges: MapEdge[]): Promise<void> {
  const { at } = await readPixels(page, png, {}, edges.flatMap(({ inside, outside }) => [inside, outside ?? inside]));
  edges.forEach(({ outside }, side) => {
    expect(at[side * 2], `dedans, bord ${side}`).not.toEqual(BACKGROUND);
    if (outside) expect(at[side * 2 + 1], `dehors, bord ${side}`).toEqual(BACKGROUND);
  });
}

// 200 % : au plus près, le zoom est entier (×3 à partir de 1280 × 720) : un pixel de la carte est un carré de 3 × 3 pixels de l'écran, ce
// que vérifient les tests de netteté. À 100 %, le zoom (×1,5) ne l'est pas.
async function zoomToMax(page: Page): Promise<void> {
  for (let i = 0; i < 10; i++) await page.keyboard.press('+');
  await expect.poll(() => page.evaluate(() => window.__office!.zoom())).toBe(3);
}

// Le fond du jeu dans cette capture d'un canevas de `width` × `height` : rien, ou une bande pleine, de toute la hauteur, contre le bord
// droit (au-delà du bord est de la carte, que la caméra montre quand l'avatar en approche) ; renvoie sa largeur. Une couture entre deux tuiles, qui laisserait voir
// le fond dans la carte, n'est ni l'un ni l'autre : elle élargirait la boîte du fond sans la remplir.
async function backgroundBandOnTheRight(page: Page, png: Buffer, width: number, height: number): Promise<number> {
  const fond = await findColor(page, png, BACKGROUND);
  if (fond.count === 0) return 0;
  expect([fond.maxX, fond.minY, fond.maxY], 'le fond touche le bord droit, de haut en bas').toEqual([width - 1, 0, height - 1]);
  expect(fond.count, `le fond, de x = ${fond.minX} au bord droit, sans rien dedans`).toBe((width - fond.minX) * height);
  return width - fond.minX;
}

// Le fond du jeu dans cette capture : les bandes pleines qu'il fait contre chaque bord de l'écran (des colonnes ou des rangées tout entières de
// fond, au-delà des bords de la carte), en pixels, et les pixels de fond qui restent entre ces bandes, là où est la carte : une couture entre
// deux tuiles, qui laisserait voir le fond dans la carte. Où que soit la carte à l'écran (la caméra suit l'avatar qui marche, et la carte
// bouge avec lui), on n'a pas à savoir où elle est à l'image de la capture.
async function backgroundBands(page: Page, png: Buffer): Promise<{ left: number; right: number; top: number; bottom: number; stray: number }> {
  return page.evaluate(
    async ({ base64, color }) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const [width, height] = [image.width, image.height];
      const isBackground = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return data[i] === color[0] && data[i + 1] === color[1] && data[i + 2] === color[2];
      };
      const fullColumn = (x: number) => {
        for (let y = 0; y < height; y++) if (!isBackground(x, y)) return false;
        return true;
      };
      const fullRow = (y: number) => {
        for (let x = 0; x < width; x++) if (!isBackground(x, y)) return false;
        return true;
      };
      let left = 0;
      while (left < width && fullColumn(left)) left++;
      let right = 0;
      while (right < width - left && fullColumn(width - 1 - right)) right++;
      let top = 0;
      while (top < height && fullRow(top)) top++;
      let bottom = 0;
      while (bottom < height - top && fullRow(height - 1 - bottom)) bottom++;
      let stray = 0;
      for (let y = top; y < height - bottom; y++) for (let x = left; x < width - right; x++) if (isBackground(x, y)) stray++;
      return { left, right, top, bottom, stray };
    },
    { base64: png.toString('base64'), color: BACKGROUND },
  );
}

// Où est le milieu de la chemise de l'avatar à l'écran, dans un canevas de `canvas` pixels, à ce zoom. La caméra suit le milieu de l'avatar
// (32 px au-dessus des pieds : son image fait 64 px de haut), sans bornes : il est au centre de l'écran, partout sur la carte ; la chemise est
// SHIRT_DX, SHIRT_DY px de carte plus loin.
function shirtOnScreen(canvas: { width: number; height: number }, zoom: number): [number, number] {
  return [canvas.width / 2 + zoom * SHIRT_DX, canvas.height / 2 + zoom * SHIRT_DY];
}

test('l\'avatar apparaît sur le point d\'apparition, pieds en (80, 240), avec son ombre', async ({ page }, testInfo) => {
  // Même fenêtre que « la carte s'affiche » : zoom ×1,5, la caméra sur le milieu de l'avatar, (80, 208), ramené dans ses bornes : (373,3, 208), au centre de
  // l'écran (800, 550). Un point de la carte (x, y) est donc à l'écran en (800 + 1,5 (x − 373,3), 550 + 1,5 (y − 208)), soit (240 + 1,5 x, 238 + 1,5 y) : on
  // lit le pixel du milieu de chaque pixel de la carte.
  await page.setViewportSize({ width: 1600, height: 1100 });
  await joinOfficeAlone(page, 'Zoé');
  const camera = await page.evaluate(() => window.__office!.camera());
  expect(camera.x).toBeCloseTo(-160 + 1600 / 1.5 / 2, 6);
  expect(camera.y).toBeCloseTo(208, 6);
  const middleOf = (x: number, y: number): [number, number] => [Math.floor(240 + 1.5 * (x + 0.5)), Math.floor(238 + 1.5 * (y + 0.5))];

  // C'est le compte connecté : son identifiant est celui de la session.
  const session = (await (await page.request.get('/api/auth/get-session')).json()) as { user: { id: string } };
  expect(await selfAt(page)).toEqual({ id: session.user.id, x: 80, y: 240 });

  const png = await screenshot(page, testInfo, 'avatar-apparition', HIDE_OVERLAY);
  // L'image du personnage (32 × 64 px) a ses pieds au bas, au milieu : son coin haut-gauche est en (80 − 16, 240 − 64).
  const shirt = middleOf(64 + shirtAt.pixel.x, 176 + shirtAt.pixel.y);   // un pixel de la chemise
  const shadow = middleOf(80, 241);   // 1 px sous les pieds, au milieu de l'ombre
  const floorBesideShadow = middleOf(80, 244);   // 4 px sous les pieds, hors de l'ombre (6 px de haut)
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

test('zoom : la molette et le pincement au pas de 5 %, les boutons et les touches au pas de 10 %, du plancher à 200 %', async ({ page }) => {
  await joinOfficeAlone(page, 'Rosa');
  const zoom = () => page.evaluate(() => window.__office!.zoom());
  const base = await zoom();
  // 1280 × 720 : le zoom de départ du canevas est ×2, aux trois quarts à 100 %.
  expect(base).toBe(1.5);
  // Le zoom de la caméra à ce pourcentage : celui de 100 % fois le pourcentage, une fois que la caméra y a glissé.
  const expectZoom = (percent: number) => expect.poll(zoom).toBeCloseTo((base * percent) / 100, 6);
  const readout = page.locator('.dock-zoom .zoom-value');
  const zoomIn = page.getByRole('button', { name: 'Zoom avant' });
  const zoomOut = page.getByRole('button', { name: 'Zoom arrière' });
  const [width, height] = [page.viewportSize()!.width, page.viewportSize()!.height];
  await page.mouse.move(width / 2, height / 2);
  await expect(readout).toHaveText('100 %');

  // Un cran de molette (100 px) fait 5 % : vers le haut plus près, vers le bas plus loin.
  await page.mouse.wheel(0, -100);
  await expect(readout).toHaveText('105 %');
  await expectZoom(105);
  await page.mouse.wheel(0, 100);
  await expect(readout).toHaveText('100 %');
  await expectZoom(100);

  // Un pavé tactile envoie de petits deltas, qui s'additionnent : cinq fois 5 px font un cran.
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -5);
  await expect(readout).toHaveText('105 %');

  // Un pincement, vu comme Ctrl + molette, zoome le jeu et ne zoome pas la page : l'événement est arrêté avant d'arriver à la page.
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { __wheelPrevented: boolean[] }).__wheelPrevented = seen;
    window.addEventListener('wheel', (event) => seen.push(event.defaultPrevented), { passive: true });
  });
  const pixelRatio = await page.evaluate(() => window.devicePixelRatio);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(readout).toHaveText('110 %');
  expect(await page.evaluate(() => (window as unknown as { __wheelPrevented: boolean[] }).__wheelPrevented)).toEqual([true]);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(pixelRatio);

  // Jusqu'à 200 % : encore un cran, et rien ne change ; le bouton « Zoom avant » s'éteint.
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -100);
  await expect(readout).toHaveText('200 %');
  await expectZoom(200);
  await expect(zoomIn).toBeDisabled();
  // Et jusqu'au plancher, pas au-delà : sur cette petite carte (24 × 16 cases), la vue où l'on voit la carte entourée de ses cinq cases de
  // marge, pas plus (zoom.ts, zoomFloorPercent). 1280 × 720 : la vue y fait 1088 px de large, la carte et deux marges, soit 78,4 %.
  const floor = (100 * 1280) / (24 * 32 + 2 * 5 * 32) / base;
  for (let i = 0; i < 50; i++) await page.mouse.wheel(0, 100);
  await expect(readout).toHaveText('78 %');
  await expectZoom(floor);
  await expect(zoomOut).toBeDisabled();
  // La touche - n'y fait rien non plus.
  await page.keyboard.press('-');
  await expect(readout).toHaveText('78 %');

  // Les boutons font 10 % : depuis le plancher, + va à 80 %. Le pourcentage du milieu rétablit 100 %.
  await zoomIn.click();
  await expect(readout).toHaveText('80 %');
  await page.getByRole('button', { name: 'Rétablir le zoom de départ' }).click();
  await expect(readout).toHaveText('100 %');
  await expectZoom(100);
  // Le menu « Plus » dit le pourcentage du moment, et le rétablit aussi.
  await zoomOut.click();
  await expect(readout).toHaveText('90 %');
  const resetZoom = async () => (await openMoreMenu(page)).getByRole('menuitem', { name: 'Rétablir le zoom de départ' });
  await expect(await resetZoom()).toContainText('90 %');
  await page.keyboard.press('Escape');
  await (await resetZoom()).click();
  await expect(readout).toHaveText('100 %');
  await expectZoom(100);

  // Le clavier : + rapproche de 10 %, 0 rétablit, - éloigne de 10 %.
  await page.keyboard.press('+');
  await expect(readout).toHaveText('110 %');
  await page.keyboard.press('0');
  await expect(readout).toHaveText('100 %');
  await page.keyboard.press('-');
  await expect(readout).toHaveText('90 %');
  await expectZoom(90);

  // L'avatar suit toujours la caméra : on marche, il avance (la page n'est pas figée par le zoom).
  const x0 = (await selfAt(page)).x;
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await selfAt(page)).x, { timeout: WALK_TIMEOUT }).toBeGreaterThan(x0);
  await page.keyboard.up('ArrowRight');

  // Une fenêtre plus grande relève le plancher : sur 1920 × 1080, cette petite carte et sa marge ne tiennent qu'à 117,6 %. Le pourcentage (90 %)
  // y remonte, « − » s'éteint, et la vue de départ (0) est le plancher, au-dessus de 100 %.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(readout).toHaveText('118 %');
  await expectZoom((100 * 1920) / (24 * 32 + 2 * 5 * 32) / base);
  await expect(zoomOut).toBeDisabled();
  await page.keyboard.press('+');
  await expect(readout).toHaveText('120 %');
  await page.keyboard.press('0');
  await expect(readout).toHaveText('118 %');
});

// Le zoom de la caméra à chaque image, depuis cet appel (window.__zoomSeen) : de quoi voir si la caméra glisse ou saute.
async function recordZoomPerFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { __zoomSeen: number[] }).__zoomSeen = seen;
    const tick = () => {
      seen.push(window.__office!.zoom());
      requestAnimationFrame(tick);
    };
    tick();
  });
}
const zoomsSeen = (page: Page) => page.evaluate(() => (window as unknown as { __zoomSeen: number[] }).__zoomSeen);

test('zoom : la caméra glisse d\'un pourcentage à l\'autre, sans saut ni dépassement', async ({ page }) => {
  await joinOfficeAlone(page, 'Rosa');
  const zoom = () => page.evaluate(() => window.__office!.zoom());
  const base = await zoom();
  const target = base * 1.05;
  await page.mouse.move(640, 360);
  await recordZoomPerFrame(page);

  await page.mouse.wheel(0, -100);
  await expect.poll(zoom).toBeCloseTo(target, 9);
  const seen = await zoomsSeen(page);

  // Elle part de la vue de départ, arrive à la cible, et ne recule ni ne dépasse jamais.
  expect(seen[0]).toBeCloseTo(base, 9);
  expect(seen.at(-1)).toBeCloseTo(target, 9);
  for (let i = 1; i < seen.length; i++) expect(seen[i]!, `image ${i}`).toBeGreaterThanOrEqual(seen[i - 1]!);
  expect(Math.max(...seen)).toBeLessThanOrEqual(target + 1e-9);
  // Et elle passe par des zooms intermédiaires, au moins trois : un glissement, pas un saut.
  expect(seen.filter((z) => z > base + 1e-6 && z < target - 1e-6).length).toBeGreaterThanOrEqual(3);
});

test('zoom : si la personne demande moins de mouvement, la caméra saute au nouveau zoom', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await joinOfficeAlone(page, 'Rosa');
  const zoom = () => page.evaluate(() => window.__office!.zoom());
  const base = await zoom();
  const target = base * 1.05;
  await page.mouse.move(640, 360);
  await recordZoomPerFrame(page);

  await page.mouse.wheel(0, -100);
  await expect.poll(zoom).toBeCloseTo(target, 9);
  // Entre la vue de départ et la cible, aucune image intermédiaire.
  expect((await zoomsSeen(page)).filter((z) => z > base + 1e-6 && z < target - 1e-6)).toEqual([]);
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
// photographie à n'importe quelle image de l'animation, d'où une marge plus large qu'à l'horizontale, que rien n'anime. De profil (l'avatar
// vient de marcher vers la droite), la chemise n'est pas tout à fait où elle est de face (SHIRT_DY) : 8 px plus haut à ×3 sur une capture du
// 29 octobre, d'où PROFILE_TOLERANCE ; la caméra, elle, est relevée exactement (expectCameraOn).
const expectNear = (value: number, expected: number, tolerance = 8) => expect(Math.abs(value - expected), `${value} pour ${expected}`).toBeLessThan(tolerance);
const PROFILE_TOLERANCE = 12;

// Le centre de la caméra est sur le milieu de l'avatar dont les pieds sont en `feet` (32 px plus haut : son image fait 64 px de haut), ramené dans ses bornes
// (la carte et cinq cases de marge : game/zoom.ts, cameraBounds) pour une vue de `canvas` pixels à ce zoom, à 1 px près. Rend ce centre.
async function expectCameraOn(page: Page, feet: { x: number; y: number }, canvas: { width: number; height: number }, zoom: number): Promise<{ x: number; y: number }> {
  const axis = (value: number, length: number, size: number) => Math.min(Math.max(-160 + length / 2 / zoom, size + 160 - length / 2 / zoom), Math.max(-160 + length / 2 / zoom, value));
  const wanted = { x: axis(feet.x, canvas.width, MAP_SIZE.width), y: axis(feet.y - 32, canvas.height, MAP_SIZE.height) };
  const camera = await page.evaluate(() => window.__office!.camera());
  expect(Math.abs(camera.x - wanted.x), `la caméra en x = ${camera.x}, attendue en ${wanted.x}`).toBeLessThanOrEqual(1);
  expect(Math.abs(camera.y - wanted.y), `la caméra en y = ${camera.y}, attendue en ${wanted.y}`).toBeLessThanOrEqual(1);
  return wanted;
}

test('la caméra suit l\'avatar, jusque contre le mur est, où elle s\'arrête à cinq cases de fond : l\'avatar y quitte le centre de l\'écran', async ({ page }, testInfo) => {
  test.slow();
  // 1280 × 720 à 200 % : zoom ×3, la vue fait 426,7 × 240 px de carte (768 × 512).
  await joinOfficeAlone(page, 'Lou');
  await zoomToMax(page);
  expect(page.viewportSize()).toEqual({ width: 1280, height: 720 });
  const canvas = { width: 1280, height: 720 };
  // Le milieu de la chemise, l'avatar au centre de l'écran : (640 + 3 × SHIRT_DX, 360 + 3 × SHIRT_DY), où qu'il soit.
  const [shirtX, shirtY] = shirtOnScreen(canvas, 3);
  expect(shirtX).toBeCloseTo(640 + 3 * SHIRT_DX, 6);
  expect(shirtY).toBeCloseTo(360 + 3 * SHIRT_DY, 6);

  // À l'apparition (x = 80, à 2,5 cases du bord ouest), la vue (213,3 px de carte de chaque côté) dépasse le bord de 133,3 px, moins que la marge (160) :
  // l'avatar est au centre de l'écran, et l'on voit à gauche le fond du jeu, au-delà de la carte (de 0 à 640 − 3 × 80 = 400 px de l'écran).
  const pngSpawn = await screenshot(page, testInfo, 'camera-apparition', HIDE_OVERLAY);
  const spawn = await findColor(page, pngSpawn, SHIRT);
  expect(spawn.count).toBeGreaterThan(50);
  expect((spawn.minX + spawn.maxX) / 2).toBeCloseTo(shirtX, -1);   // à 5 px près
  expectNear((spawn.minY + spawn.maxY) / 2, shirtY);
  expect((await backgroundBands(page, pngSpawn)).left).toBe(400);

  // Plus loin dans la carte (x de 213,3 à 554,7 : la vue y est tout entière dans la carte), la caméra le suit : l'avatar reste au centre de
  // l'écran, et l'on ne voit pas un pixel du fond du jeu.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await selfAt(page)).x, { intervals: [50], timeout: WALK_TIMEOUT }).toBeGreaterThanOrEqual(380);
  await page.keyboard.up('KeyD');
  const middleAt = await restingAt(page);
  await expectCameraOn(page, middleAt, canvas, 3);
  const pngMiddle = await screenshot(page, testInfo, 'camera-milieu', HIDE_OVERLAY);
  const middle = await findColor(page, pngMiddle, SHIRT);
  expect((middle.minX + middle.maxX) / 2).toBeCloseTo(shirtX, -1);
  expectNear((middle.minY + middle.maxY) / 2, shirtY, PROFILE_TOLERANCE);
  expect((await readPixels(page, pngMiddle, { fond: BACKGROUND })).counts.fond).toBe(0);

  // Contre le mur est (les pieds en x = 726 : le mur est la colonne 23, de x = 736 à 768, et le corps fait 10 px de chaque côté), la caméra s'est arrêtée à
  // cinq cases au-delà du bord : son centre en 768 + 160 − 213,3 = 714,7. L'avatar est 3 × (726 − 714,7) = 34 px à droite du centre de l'écran, et l'on voit
  // au-delà de la carte le fond du jeu, en bande pleine jusqu'au bord de l'écran : cinq cases à ×3, 480 px (du 29 au 31 octobre, sans bornes : 514 px).
  const rightAt = await holdUntilStopped(page, 'KeyD');
  expect(rightAt.x, 'contre le mur est').toBe(726);
  const stop = await expectCameraOn(page, await restingAt(page), canvas, 3);
  expect(stop.x).toBeCloseTo(768 + 160 - 1280 / 3 / 2, 6);
  const pngRight = await screenshot(page, testInfo, 'camera-bord-droit', HIDE_OVERLAY);
  const right = await findColor(page, pngRight, SHIRT);
  expect((right.minX + right.maxX) / 2).toBeCloseTo(shirtX + 3 * (rightAt.x - stop.x), -1);
  expectNear((right.minY + right.maxY) / 2, shirtY, PROFILE_TOLERANCE);
  expect(await backgroundBandOnTheRight(page, pngRight, 1280, 720)).toBe(3 * 160);
});

test('la caméra continue de suivre l\'avatar quand la fenêtre change de taille', async ({ page }) => {
  test.slow();
  await joinOfficeAlone(page, 'Eva');
  // 200 % : le pourcentage reste le même quand la fenêtre change de taille, le zoom de départ du canevas change.
  await zoomToMax(page);
  // L'avatar s'arrête vers x = 370.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await selfAt(page)).x, { intervals: [50], timeout: WALK_TIMEOUT }).toBeGreaterThanOrEqual(365);
  await page.keyboard.up('KeyD');
  const resting = await restingAt(page);

  const shirtCenter = async () => {
    const shirt = await findColor(page, await page.screenshot({ style: HIDE_OVERLAY }), SHIRT);
    return [(shirt.minX + shirt.maxX) / 2, (shirt.minY + shirt.maxY) / 2];
  };
  // La chemise est au centre de l'écran de cette fenêtre (plus son décalage dans l'image), une fois dessinée à sa taille ; la caméra, sur le
  // milieu de l'avatar.
  const expectShirtAt = async (canvas: { width: number; height: number }, zoom: number) => {
    await expect.poll(() => page.evaluate(() => window.__office!.zoom()), { timeout: WALK_TIMEOUT }).toBeCloseTo(zoom, 9);
    const [x, y] = shirtOnScreen(canvas, zoom);
    await expect.poll(async () => (await shirtCenter())[0], { timeout: WALK_TIMEOUT }).toBeCloseTo(x, -1);
    expectNear((await shirtCenter())[1], y, PROFILE_TOLERANCE);
    await expectCameraOn(page, resting, canvas, zoom);
  };

  // Plus grande, toujours au zoom ×3 (la vue : 466,7 × 266,7 px de carte) : l'avatar est au centre de l'écran, (700, 400).
  await page.setViewportSize({ width: 1400, height: 800 });
  await expectShirtAt({ width: 1400, height: 800 }, 3);

  // Plus petite que 1280 × 720 : le zoom de départ du canevas est ×1, donc ×1,5 à 200 % (la vue : 466,7 × 426,7 px de carte). L'avatar est
  // toujours au centre de l'écran, (350, 320) : la vue dépasse la carte de moins de cinq cases de chaque côté, ses bornes ne l'écartent pas de lui.
  await page.setViewportSize({ width: 700, height: 640 });
  await expectShirtAt({ width: 700, height: 640 }, 1.5);

  // Et il ne s'est pas déplacé pendant ce temps.
  expect(await selfAt(page)).toEqual(resting);
});

test('les pixels restent nets pour un avatar arrêté à x entier, dans une fenêtre de largeur impaire', async ({ page }) => {
  test.slow();
  // 1283 × 727 à 200 % : zoom ×3, et le centre de l'écran est entre deux pixels (641,5). Quand la caméra suit l'avatar à un x entier, un
  // pixel de la carte tombe sur un tiers de pixel de l'écran : sans arrondi à l'affichage, des pixels de 2 et de 4 px de large.
  await page.setViewportSize({ width: 1283, height: 727 });
  await joinOfficeAlone(page, 'Ida');
  await zoomToMax(page);

  // Un x entier, loin des bords de la carte (la vue y est tout entière dans la carte) : l'avatar contre la face est du bureau du milieu (les
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
  const avatar = await colorChanges(page, png, [shirt.minX - 60, shirt.minY - 135, shirt.maxX + 60, shirt.maxY + 105], AVATAR_COLORS, 3);
  // Un coin de l'écran qui n'a que de la carte : ni l'avatar, ni l'étiquette.
  const map = await colorChanges(page, png, [1283 - 420, 40, 1283 - 20, 330], null, 3);

  for (const [name, { x, y }] of Object.entries({ avatar, carte: map })) {
    expect(x.reduce((total, count) => total + count, 0), `${name} : des changements de couleur`).toBeGreaterThan(100);
    expect(onOneResidue(x), `${name}, x modulo 3 : ${x}`).toBe(true);
    expect(onOneResidue(y), `${name}, y modulo 3 : ${y}`).toBe(true);
  }
  expect((await readPixels(page, png, { fond: BACKGROUND })).counts.fond).toBe(0);
});

test('les pixels restent nets quand la caméra suit l\'avatar, même dans une fenêtre de taille impaire', async ({ page }) => {
  test.slow();
  // 1283 × 727 à 200 % : zoom ×3, et le centre de l'écran est entre deux pixels (641,5) : la caméra, qui suit l'avatar à des positions
  // quelconques, n'est presque jamais sur un pixel de l'écran. Les objets de la carte et l'avatar sont arrondis à l'affichage.
  await page.setViewportSize({ width: 1283, height: 727 });
  await joinOfficeAlone(page, 'Ugo');
  await zoomToMax(page);

  // On regarde la marche de x = 330 au mur est (x = 726) : la caméra le suit jusqu'au bout, au centre de l'écran. Au-delà de x = 554, on voit
  // donc à droite le fond du jeu, en bande pleine ; dans la carte, il ne doit pas paraître.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await selfAt(page)).x, { intervals: [20], timeout: WALK_TIMEOUT }).toBeGreaterThan(330);
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(23 + i * 7);
    const png = await page.screenshot({ style: HIDE_OVERLAY });
    const shirt = await findColor(page, png, SHIRT);
    const { x, y } = await colorChanges(page, png, [shirt.minX - 60, shirt.minY - 135, shirt.maxX + 60, shirt.maxY + 105], AVATAR_COLORS, 3);
    expect(x.reduce((total, count) => total + count, 0), 'le personnage a des changements de couleur').toBeGreaterThan(100);
    expect(onOneResidue(x), `x modulo 3 : ${x}`).toBe(true);
    expect(onOneResidue(y), `y modulo 3 : ${y}`).toBe(true);
    // Ni couture entre les tuiles de la carte, qui laisserait voir le fond : le fond n'est qu'au-delà de son bord est, au plus ce que la caméra
    // en montre quand l'avatar est contre le mur (x = 726) : 1283 − (641,5 + 3 × (768 − 726)) = 515,5 px de l'écran.
    expect(await backgroundBandOnTheRight(page, png, 1283, 727)).toBeLessThanOrEqual(516);
  }
  await page.keyboard.up('KeyD');
});

test('à 100 %, au zoom ×1,5, la carte n\'a pas de couture entre ses tuiles quand la caméra suit l\'avatar', async ({ page }) => {
  test.slow();
  // Le zoom de départ n'est pas entier : un pixel de la carte fait tantôt 1, tantôt 2 pixels de l'écran. Aucune couture entre les tuiles
  // ne laisse voir le fond du jeu dans la carte.
  await page.setViewportSize({ width: 1283, height: 727 });
  await joinOfficeAlone(page, 'Léo');
  expect(await page.evaluate(() => window.__office!.zoom())).toBe(1.5);

  // L'avatar marche vers la droite depuis x = 330, et la caméra le suit : la carte (1152 × 768 px à l'écran) bouge avec lui. Le fond du jeu
  // fait des bandes pleines au-delà de ses bords (à gauche ou à droite, la carte étant moins large que l'écran ; en haut, l'avatar près du
  // mur nord) ; entre ces bandes, là où est la carte, pas un pixel de fond (backgroundBands), à aucune des captures.
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await selfAt(page)).x, { intervals: [20], timeout: WALK_TIMEOUT }).toBeGreaterThan(330);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(23 + i * 7);
    const png = await page.screenshot({ style: HIDE_OVERLAY });
    const bands = await backgroundBands(page, png);
    expect(bands.stray, `image ${i} : des pixels de fond dans la carte (${JSON.stringify(bands)})`).toBe(0);
    // Les bandes sont bien celles de la carte : quand ses deux bords sont à l'écran (l'avatar entre x = 340 et 428), 1283 − 1152 = 131 px de
    // fond en largeur, à 1 px près (le bord tombe entre deux pixels) ; plus loin, une seule bande, à droite. Et l'on voit de la carte sur au
    // moins 600 px de large (contre le mur est, elle s'arrête 63 px à droite de l'avatar) et presque toute la hauteur de l'écran (au plus
    // quelques dizaines de rangées de fond en haut).
    if (bands.left > 0 && bands.right > 0) expect(Math.abs(bands.left + bands.right - 131), `image ${i} : ${JSON.stringify(bands)}`).toBeLessThanOrEqual(1);
    expect(1283 - bands.left - bands.right, `image ${i} : ${JSON.stringify(bands)}`).toBeGreaterThan(600);
    expect(727 - bands.top - bands.bottom, `image ${i} : ${JSON.stringify(bands)}`).toBeGreaterThan(600);
    expect((await findColor(page, png, SHIRT)).count, `image ${i} : la chemise est dessinée`).toBeGreaterThan(20);
  }
  await page.keyboard.up('KeyD');
});

test('la marche s\'anime sur place, et l\'avatar immobile ne bouge plus', async ({ page }) => {
  test.slow();
  // La caméra suit l'avatar dans ses bornes (1600 × 1100) : près du coin nord-ouest, elle est arrêtée, et contre le mur, elle ne bouge plus.
  await page.setViewportSize({ width: 1600, height: 1100 });
  await joinOfficeAlone(page, 'Noé');

  // ArrowUp jusqu'au mur (les pieds en (80, 203)), puis la touche reste enfoncée : l'avatar marche sur place.
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => (await selfAt(page)).y, { intervals: [50], timeout: WALK_TIMEOUT }).toBe(203);

  // L'avatar (96 px de haut à ×1,5, ses pieds là où la caméra, arrêtée par ses bornes, les montre), et son ombre : 104 px au-dessus des pieds, 20 au-dessous.
  const camera = await page.evaluate(() => window.__office!.camera());
  const feet = { x: Math.round(800 + 1.5 * (80 - camera.x)), y: Math.round(550 + 1.5 * (203 - camera.y)) };
  const clip = { x: feet.x - 32, y: feet.y - 104, width: 64, height: 124 };
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
