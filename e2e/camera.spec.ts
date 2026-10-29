import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { giveDeskBack, joinOffice, selfAt, teleportTo } from './helpers';

// La caméra suit l'avatar sans bornes : il reste au centre de l'écran partout sur la carte, au bord et dans les coins, et le zoom se fait autour
// de lui. Elle se fait glisser à la souris sur la carte (son centre reste dans la carte élargie de cinq cases au plus, sans que la carte quitte
// l'écran, même à 200 %), et revient sur soi d'un double-clic, ou quand on se remet à marcher. Au plus loin (le plancher), la carte et sa marge
// de cinq cases tiennent tout juste à l'écran.

// La vraie carte (81 × 46 cases de 32 px) et sa marge (cinq cases), en pixels de la carte.
const OFFICE = { width: 81 * 32, height: 46 * 32 };
const MARGIN = 5 * 32;

// Au bord est de la vraie carte, à mi-hauteur (la case (79, 22), dans le couloir), et dans son coin sud-est (la case (79, 43), dans la détente),
// hors des bureaux et de l'octogone : les pieds de l'avatar, au milieu de la case.
const EAST_EDGE = { x: 79 * 32 + 16, y: 22 * 32 + 16 };
const SOUTH_EAST = { x: 79 * 32 + 16, y: 43 * 32 + 16 };

// Le zoom du plancher dans ce canevas (zoom.ts, zoomFloorPercent) : la carte et ses deux marges y tiennent tout juste, sur l'axe qui limite.
const floorZoom = (canvas: { width: number; height: number }) => Math.max(canvas.width / (OFFICE.width + 2 * MARGIN), canvas.height / (OFFICE.height + 2 * MARGIN));

// Le zoom au plus près (200 %) : ×3 à partir de 1280 × 720, ×1,5 en dessous.
const closestZoom = (canvas: { width: number; height: number }) => (canvas.width >= 1280 && canvas.height >= 720 ? 3 : 1.5);

// Jusqu'où le centre de la caméra libre va au-delà de chaque bord de la carte, dans ce canevas (zoom.ts, freeCameraReach) : la marge, ou moins,
// pour que la vue au plus près garde une case de carte (32 px).
const freeReach = (canvas: { width: number; height: number }) => {
  const axis = (length: number) => Math.min(MARGIN, length / 2 / closestZoom(canvas) - 32);
  return { x: axis(canvas.width), y: axis(canvas.height) };
};

// La barre du bas, les panneaux et les vignettes (office/OfficeShell.tsx) sont posés sur la carte et cachent ce qui est dessous.
const HIDE_OVERLAY = '.office-ui { visibility: hidden }';

// Les pixels de la carte dans une capture du canevas, les commandes du bureau cachées : ceux qui n'ont pas la couleur du fond du jeu, lue au
// pixel du coin inférieur droit (au-delà de la carte quand la caméra est au-delà de son coin sud-est) ; combien, et le rectangle qui les
// contient (maxX = −1 s'il n'y en a pas). La capture est jointe au rapport du test.
async function mapPixels(page: Page, testInfo: TestInfo, name: string): Promise<{ count: number; minX: number; maxX: number; minY: number; maxY: number }> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const path = testInfo.outputPath(`${name}.png`);
  const png = await page.screenshot({ path, clip: await canvasBox(page), style: HIDE_OVERLAY });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  return page.evaluate(async (base64) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    const fond = data.length - 4;
    const found = { count: 0, minX: Infinity, maxX: -1, minY: Infinity, maxY: -1 };
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        if (data[i] === data[fond] && data[i + 1] === data[fond + 1] && data[i + 2] === data[fond + 2]) continue;
        found.count++;
        found.minX = Math.min(found.minX, x);
        found.maxX = Math.max(found.maxX, x);
        found.minY = Math.min(found.minY, y);
        found.maxY = Math.max(found.maxY, y);
      }
    }
    return found;
  }, png.toString('base64'));
}

// Où l'avatar local est dessiné à l'écran (en pixels du canevas).
async function selfOnScreen(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const self = window.__office!.self!;
    return window.__office!.toScreen(self.x, self.y);
  });
}

async function canvasBox(page: Page) {
  const box = await page.locator('#game-container canvas').boundingBox();
  if (!box) throw new Error('Pas de canevas.');
  return box;
}

// Ce que la caméra montre à chaque image, depuis cet appel (window.__cameraSeen) : le point de la carte au centre de la vue, le zoom, les pieds de
// l'avatar local et l'heure de l'image (ms). Relevé juste après que le jeu a dessiné l'image : Phaser demande chaque image au navigateur avant ce
// relevé, et le navigateur les sert dans cet ordre à chaque image.
interface CameraFrame {
  x: number;
  y: number;
  zoom: number;
  t: number;
  self: { x: number; y: number };
}
async function recordCameraPerFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: CameraFrame[] = [];
    (window as unknown as { __cameraSeen: CameraFrame[] }).__cameraSeen = seen;
    const tick = (t: number) => {
      const self = window.__office!.self!;
      seen.push({ ...window.__office!.camera(), t, self: { x: self.x, y: self.y } });
      requestAnimationFrame(tick);
    };
    tick(performance.now());
  });
}
const camerasSeen = (page: Page) => page.evaluate(() => (window as unknown as { __cameraSeen: CameraFrame[] }).__cameraSeen);

// À chaque image relevée, le centre de la caméra est sur le milieu de l'avatar (32 px au-dessus de ses pieds : son image fait 64 px de haut), à
// 1 px près.
function expectOnAvatarEveryFrame(seen: CameraFrame[], where: string): void {
  for (const [i, camera] of seen.entries()) {
    expect(Math.abs(camera.x - camera.self.x), `${where}, image ${i}, en x, à ×${camera.zoom.toFixed(3)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(camera.y - (camera.self.y - 32)), `${where}, image ${i}, en y, à ×${camera.zoom.toFixed(3)}`).toBeLessThanOrEqual(1);
  }
}

// Une molette crantée sur le jeu : `notches` crans (positif : plus loin), un toutes les 60 ms environ.
async function wheelNotches(page: Page, notches: number): Promise<void> {
  for (let i = 0; i < Math.abs(notches); i++) {
    await page.mouse.wheel(0, notches > 0 ? 100 : -100);
    await page.waitForTimeout(60);
  }
}

test('glisser la carte déplace la vue, le double-clic la recentre', async ({ page }) => {
  await joinOffice(page, 'Paulo');
  const box = await canvasBox(page);
  const before = await selfOnScreen(page);
  const feet = await selfAt(page);

  // Un appui à un quart du canevas, glissé de 200 px vers la gauche et 120 px vers le haut.
  const from = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 100, from.y - 60, { steps: 5 });
  await page.mouse.move(from.x - 200, from.y - 120, { steps: 5 });
  await page.mouse.up();

  // La vue a suivi la souris : l'avatar est dessiné plus à gauche et plus haut ; lui n'a pas bougé.
  const dragged = await selfOnScreen(page);
  expect(dragged.x).toBeLessThan(before.x - 50);
  expect(dragged.y).toBeLessThan(before.y - 30);
  expect(await selfAt(page)).toMatchObject({ x: feet.x, y: feet.y });

  // Un simple clic ne fait pas glisser la carte.
  await page.mouse.click(from.x, from.y);
  const clicked = await selfOnScreen(page);
  expect(Math.abs(clicked.x - dragged.x)).toBeLessThan(2);

  // Un double-clic la recentre sur l'avatar.
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(async () => Math.abs((await selfOnScreen(page)).x - before.x)).toBeLessThan(3);
  await expect.poll(async () => Math.abs((await selfOnScreen(page)).y - before.y)).toBeLessThan(3);
});

test('après avoir glissé la carte, se remettre à marcher recentre la caméra', async ({ page }) => {
  await joinOffice(page, 'Pauline');
  const box = await canvasBox(page);
  const from = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 220, from.y + 80, { steps: 8 });
  await page.mouse.up();
  const centre = { x: box.width / 2, y: box.height / 2 };
  const far = await selfOnScreen(page);
  expect(Math.abs(far.x - centre.x)).toBeGreaterThan(100);

  await recordCameraPerFrame(page);
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.up('ArrowDown');
  await expect.poll(async () => Math.abs((await selfOnScreen(page)).x - centre.x), { timeout: 3000 }).toBeLessThan(40);

  // Elle y revient en glissant, sans se poser d'un coup sur l'avatar à la fin : d'une image à l'autre, elle ne fait jamais plus que le pas de
  // l'avatar, plus celui du retour (350 ms en Sine.easeInOut, depuis l'écart du départ : au plus π/2 × écart × Δt / 350 ms, compté double pour
  // l'horloge du jeu, qui lisse ses pas). Avant, elle visait l'endroit où il était au départ, puis sautait d'un coup de tout le chemin qu'il avait
  // fait pendant le retour. 1 px : les arrondis.
  const seen = await camerasSeen(page);
  const first = seen[0]!;
  // Le milieu de l'avatar : 32 px au-dessus de ses pieds (son image fait 64 px de haut).
  const gap = Math.hypot(first.self.x - first.x, first.self.y - 32 - first.y);
  for (let i = 1; i < seen.length; i++) {
    const [before, after] = [seen[i - 1]!, seen[i]!];
    const walked = Math.hypot(after.self.x - before.self.x, after.self.y - before.self.y);
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    expect(moved, `image ${i}`).toBeLessThanOrEqual(walked + ((Math.PI / 2) * gap * 2 * (after.t - before.t)) / 350 + 1);
  }
});

test('la caméra libre : son centre reste dans la carte élargie de cinq cases au plus, la carte ne quitte jamais l\'écran, même à 200 %, le zoom se fait autour du centre de l\'écran, et le double-clic la ramène', async ({ page }, testInfo) => {
  await joinOffice(page, 'Faustine');
  await giveDeskBack(page);
  const box = await canvasBox(page);
  const canvas = { width: box.width, height: box.height };
  await teleportTo(page, SOUTH_EAST);
  const camera = () => page.evaluate(() => window.__office!.camera());
  const zoom = () => page.evaluate(() => window.__office!.zoom());

  // Sur 1280 × 720, au plus près (×3), la vue fait 426,7 × 240 px de carte : le centre de la caméra libre va jusqu'à toute la marge (160 px) au-delà
  // des bords est et ouest, mais 88 px seulement au-delà des bords nord et sud (la moitié de la vue, 120 px, moins une case). Avant, il allait à
  // 160 px sous la carte, et à 200 % l'écran ne montrait plus que le fond.
  const reach = freeReach(canvas);
  expect(reach).toEqual({ x: MARGIN, y: 88 });
  const corner = { x: OFFICE.width + reach.x, y: OFFICE.height + reach.y };

  // La carte glissée deux fois vers le haut à gauche, de 900 px et de 550 px en tout, à ×1,5 : la caméra irait 600 et 367 px de carte plus loin
  // vers le sud-est, au-delà de sa limite (le milieu de l'avatar est à 208 et 200 px de carte du coin de cette limite) ; elle s'arrête à ce coin,
  // (2592 + 160, 1472 + 88), exactement. Les appuis sont au-delà de la carte (le fond), loin des commandes du bureau.
  const from = { x: box.x + 1000, y: box.y + 500 };
  const drag = async (dx: number, dy: number) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
    await page.mouse.up();
  };
  await drag(-600, -350);
  await drag(-300, -200);
  await expect.poll(camera).toMatchObject(corner);

  // Zoomer en caméra libre se fait autour du centre de l'écran : à chaque image, de 100 % au plancher, puis jusqu'à 45 %, puis jusqu'à 200 % (aux
  // touches +), la caméra reste où elle est, sans sauter, ni revenir à l'avatar, ni être tirée vers la carte.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await recordCameraPerFrame(page);
  await wheelNotches(page, 20);
  await expect.poll(zoom).toBeCloseTo(floorZoom(canvas), 9);
  await wheelNotches(page, -4);
  await expect.poll(zoom).toBeCloseTo((1.5 * 45) / 100, 9);
  for (let i = 0; i < 20; i++) await page.keyboard.press('+');
  await expect.poll(zoom).toBe(closestZoom(canvas));
  const seen = await camerasSeen(page);
  expect(Math.min(...seen.map((frame) => frame.zoom))).toBeCloseTo(floorZoom(canvas), 9);
  expect(Math.max(...seen.map((frame) => frame.zoom))).toBe(closestZoom(canvas));
  for (const [i, frame] of seen.entries()) expect({ x: frame.x, y: frame.y }, `image ${i}, à ×${frame.zoom.toFixed(3)}`).toEqual(corner);

  // À 200 %, la carte glissée plus loin encore : la caméra reste au coin de sa limite.
  await drag(-300, -200);
  await expect.poll(camera).toMatchObject(corner);

  // Et la carte est encore à l'écran : en haut à gauche, sa dernière case en hauteur (32 px de carte, 96 px de l'écran) et 53,3 px de carte en
  // largeur (160 px de l'écran) ; le reste est le fond.
  const right = (OFFICE.width - (corner.x - box.width / 2 / closestZoom(canvas))) * closestZoom(canvas);
  const bottom = (OFFICE.height - (corner.y - box.height / 2 / closestZoom(canvas))) * closestZoom(canvas);
  expect([right, bottom]).toEqual([expect.closeTo(160, 6), expect.closeTo(96, 6)]);
  const map = await mapPixels(page, testInfo, 'caméra libre à 200 %, au coin de sa limite');
  expect([map.minX, map.minY], 'la carte touche le coin supérieur gauche').toEqual([0, 0]);
  expect(Math.abs(map.maxX + 1 - right), `la carte va jusqu'à x = ${map.maxX}`).toBeLessThanOrEqual(1);
  expect(Math.abs(map.maxY + 1 - bottom), `la carte va jusqu'à y = ${map.maxY}`).toBeLessThanOrEqual(1);
  expect(map.count, 'des pixels de carte, pas seulement du fond').toBeGreaterThan(0.75 * right * bottom);

  // Le double-clic la ramène sur l'avatar, en glissant.
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const self = await selfAt(page);
  await expect.poll(async () => Math.abs((await camera()).x - self.x)).toBeLessThanOrEqual(1);
  await expect.poll(async () => Math.abs((await camera()).y - (self.y - 32))).toBeLessThanOrEqual(1);
});

test('au bord est et dans un coin, dézoomer jusqu\'au plancher puis rezoomer : l\'avatar reste au centre de l\'écran à chaque image', async ({ page }) => {
  test.slow();
  await joinOffice(page, 'Côme');
  await giveDeskBack(page);
  const box = await canvasBox(page);
  const zoom = () => page.evaluate(() => window.__office!.zoom());
  const base = await zoom();
  const lowest = floorZoom({ width: box.width, height: box.height });

  // Sur 1280 × 720, le plancher est à 29,3 % (la vue y fait la carte et ses deux marges en largeur) : depuis 100 %, 15 crans de 5 % (le dernier
  // arrêté au plancher), puis 15 pour revenir (30, 35 … 100). Avant le 29 octobre, la caméra était tenue dans la carte et une marge de cinq cases :
  // au bord, en dézoomant, elle glissait vers le milieu de la carte, et l'avatar hors du centre de l'écran (au plancher, au bord est, la carte
  // tenait en largeur, au milieu : l'avatar était à 1 248 px de carte du centre, 549 px de l'écran). Elle reste désormais sur lui : le zoom se
  // fait autour de l'avatar, qui ne bouge pas d'un pixel à l'écran.
  for (const [where, spot] of [['au bord est', EAST_EDGE], ['dans le coin sud-est', SOUTH_EAST]] as const) {
    await teleportTo(page, spot);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await recordCameraPerFrame(page);
    await wheelNotches(page, 15);
    await expect.poll(zoom).toBeCloseTo(lowest, 9);
    await wheelNotches(page, -15);
    await expect.poll(zoom).toBeCloseTo(base, 9);
    const seen = await camerasSeen(page);

    // La caméra a bien suivi le zoom jusqu'au plancher, puis jusqu'à 100 %, en glissant (des zooms entre les deux)…
    expect(Math.min(...seen.map((camera) => camera.zoom)), where).toBeCloseTo(lowest, 9);
    expect(seen.at(-1)!.zoom, where).toBeCloseTo(base, 9);
    expect(seen.filter((camera) => camera.zoom > lowest + 1e-6 && camera.zoom < base - 1e-6).length, where).toBeGreaterThanOrEqual(10);
    // … et à chaque image, son centre était sur le milieu de l'avatar (là où il est, contre le bord : la vue montre le fond au-delà de la
    // carte, autant qu'il faut).
    expect(seen.every((camera) => camera.self.x === spot.x && camera.self.y === spot.y), where).toBe(true);
    expectOnAvatarEveryFrame(seen, where);
    // À l'écran : au centre du canevas.
    const onScreen = await selfOnScreen(page);
    expect(Math.abs(onScreen.x - box.width / 2), where).toBeLessThanOrEqual(1);
    expect(Math.abs(onScreen.y - 32 * base - box.height / 2), where).toBeLessThanOrEqual(1);
  }
});

test('au plus loin, la carte et sa marge de cinq cases tiennent tout juste à l\'écran, « − » s\'éteint au plancher, qui suit la fenêtre, et l\'avatar reste au centre', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await joinOffice(page, 'Flore');
  await giveDeskBack(page);
  const box = await canvasBox(page);
  const canvas = { width: box.width, height: box.height };
  const zoom = () => page.evaluate(() => window.__office!.zoom());
  const readout = page.locator('.dock-zoom .zoom-value');
  const zoomOut = page.getByRole('button', { name: 'Zoom arrière' });

  // Dans le coin sud-est, là où la caméra d'avant montrait le plus de vide, et où elle reste désormais sur l'avatar.
  await teleportTo(page, SOUTH_EAST);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await recordCameraPerFrame(page);

  // Une molette crantée, bien plus loin que le plancher : 20 crans de 5 % depuis 100 %. Sur 1440 × 900, le plancher est à 33,5 %, où la vue
  // fait la carte et ses deux marges en hauteur (1792 px), l'axe qui limite, et moins en largeur.
  await wheelNotches(page, 20);
  await expect.poll(zoom).toBeCloseTo(floorZoom(canvas), 9);
  await expect(readout).toHaveText('33 %');
  await expect(zoomOut).toBeDisabled();
  expect(canvas.height / (await zoom())).toBeCloseTo(OFFICE.height + 2 * MARGIN, 6);
  expect(canvas.width / (await zoom())).toBeLessThan(OFFICE.width + 2 * MARGIN);
  // Ni la touche -, ni la molette n'y font plus rien.
  await page.keyboard.press('-');
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(300);
  expect(await zoom()).toBeCloseTo(floorZoom(canvas), 9);
  await expect(readout).toHaveText('33 %');
  expectOnAvatarEveryFrame(await camerasSeen(page), '1440 × 900');

  // Une fenêtre plus large relève le plancher (44 % sur 1920 × 1080, où la largeur limite) : le zoom y remonte en glissant, sans sauter, « − »
  // reste éteint, et la caméra reste sur l'avatar à chaque image.
  await recordCameraPerFrame(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const wide = { width: 1920, height: 1080 };
  await expect.poll(zoom).toBeCloseTo(floorZoom(wide), 9);
  await expect(readout).toHaveText('44 %');
  await expect(zoomOut).toBeDisabled();
  expect(wide.width / (await zoom())).toBeCloseTo(OFFICE.width + 2 * MARGIN, 6);
  const widened = await camerasSeen(page);
  expect(widened.filter((camera) => camera.zoom > floorZoom(canvas) + 1e-6 && camera.zoom < floorZoom(wide) - 1e-6).length, 'des zooms entre les deux planchers').toBeGreaterThanOrEqual(3);
  expectOnAvatarEveryFrame(widened, '1920 × 1080');

  // Un téléphone (390 × 844) : la hauteur limite (62,8 %) ; l'avatar, dans son coin, toujours au centre.
  await recordCameraPerFrame(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = { width: 390, height: 844 };
  await expect.poll(zoom).toBeCloseTo(floorZoom(phone), 9);
  expect(phone.height / (await zoom())).toBeCloseTo(OFFICE.height + 2 * MARGIN, 6);
  expectOnAvatarEveryFrame(await camerasSeen(page), '390 × 844');
});
