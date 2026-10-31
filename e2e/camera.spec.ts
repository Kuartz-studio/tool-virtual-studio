import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { buildOfficeTiledMap, parseOfficeMap, spotNear } from '../packages/shared/src/index';
import { giveDeskBack, joinOffice, selfAt, teleportTo } from './helpers';

// La caméra suit l'avatar dans ses bornes : la carte et une marge de cinq cases (game/zoom.ts, cameraBounds). Au milieu de la carte, l'avatar est au
// centre de l'écran ; près d'un bord, elle s'arrête, et l'on ne voit jamais plus de cinq cases de fond. Elle se fait glisser à la souris sur la carte (dans
// les mêmes bornes), et revient sur soi quand on se remet à marcher, ou d'un double-clic, qui fait aussi courir l'avatar là où l'on a double-cliqué. Au plus
// loin (le plancher), 60 %, ou plus près si la carte et sa marge tiennent déjà à l'écran (une tablette en hauteur, pour la vraie carte).

// La vraie carte (91 × 56 cases de 32 px) et sa marge (cinq cases), en pixels de la carte.
const officeMap = parseOfficeMap(buildOfficeTiledMap());
const OFFICE = { width: officeMap.widthTiles * officeMap.tileSize, height: officeMap.heightTiles * officeMap.tileSize };
const MARGIN = 5 * 32;

// Au bord est de la vraie carte, à mi-hauteur, et dans son coin sud-est : sur le chemin du jardin, à trois cases du bord (les cases (88, 28) et (88, 53) ;
// la case libre la plus proche, si la carte change). Les pieds de l'avatar, au milieu de la case.
const nearEdge = (tx: number, ty: number) => spotNear(officeMap, { x: tx * 32 + 16, y: ty * 32 + 16 }, { includeStart: true })!;
const EAST_EDGE = nearEdge(officeMap.widthTiles - 3, Math.floor(officeMap.heightTiles / 2));
const SOUTH_EAST = nearEdge(officeMap.widthTiles - 3, officeMap.heightTiles - 3);

// Le zoom de 100 % : ×1,5 à partir de 1280 × 720, ×0,75 en dessous.
const baseZoom = (canvas: { width: number; height: number }) => (canvas.width >= 1280 && canvas.height >= 720 ? 1.5 : 0.75);

// Le zoom du plancher dans ce canevas (zoom.ts, zoomFloorPercent) : 60 %, ou celui où la carte et ses deux marges tiennent tout juste, s'il est plus près.
const floorZoom = (canvas: { width: number; height: number }) =>
  Math.max(0.6 * baseZoom(canvas), canvas.width / (OFFICE.width + 2 * MARGIN), canvas.height / (OFFICE.height + 2 * MARGIN));

// Le zoom au plus près (200 %).
const closestZoom = (canvas: { width: number; height: number }) => 2 * baseZoom(canvas);

// Le centre de la caméra qui vise `center`, à ce zoom, dans ce canevas : ramené dans ses bornes, comme Phaser le fait (zoom.ts, clampToBounds).
function bounded(center: { x: number; y: number }, canvas: { width: number; height: number }, zoom: number): { x: number; y: number } {
  const axis = (value: number, length: number, size: number) => {
    const low = -MARGIN + length / 2 / zoom;
    const high = Math.max(low, size + MARGIN - length / 2 / zoom);
    return Math.min(high, Math.max(low, value));
  };
  return { x: axis(center.x, canvas.width, OFFICE.width), y: axis(center.y, canvas.height, OFFICE.height) };
}

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
// La caméra est en `wanted`, à 1 px près (le relevé attend qu'elle y soit).
async function expectCameraNear(page: Page, wanted: { x: number; y: number }): Promise<void> {
  await expect
    .poll(async () => {
      const camera = await page.evaluate(() => window.__office!.camera());
      return Math.max(Math.abs(camera.x - wanted.x), Math.abs(camera.y - wanted.y));
    })
    .toBeLessThanOrEqual(1);
}
const camerasSeen = (page: Page) => page.evaluate(() => (window as unknown as { __cameraSeen: CameraFrame[] }).__cameraSeen);

// À chaque image relevée, le centre de la caméra est sur le milieu de l'avatar (32 px au-dessus de ses pieds : son image fait 64 px de haut), ramené dans
// ses bornes à son zoom de cette image, à 1 px près.
function expectBoundedOnAvatarEveryFrame(seen: CameraFrame[], canvas: { width: number; height: number }, where: string): void {
  for (const [i, camera] of seen.entries()) {
    const wanted = bounded({ x: camera.self.x, y: camera.self.y - 32 }, canvas, camera.zoom);
    expect(Math.abs(camera.x - wanted.x), `${where}, image ${i}, en x, à ×${camera.zoom.toFixed(3)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(camera.y - wanted.y), `${where}, image ${i}, en y, à ×${camera.zoom.toFixed(3)}`).toBeLessThanOrEqual(1);
  }
}

// À chaque image relevée, la vue est dans la carte élargie de sa marge : jamais plus de cinq cases de fond au-delà d'un bord (1 px près).
function expectViewInBoundsEveryFrame(seen: CameraFrame[], canvas: { width: number; height: number }, where: string): void {
  for (const [i, camera] of seen.entries()) {
    const [halfWidth, halfHeight] = [canvas.width / 2 / camera.zoom, canvas.height / 2 / camera.zoom];
    const label = `${where}, image ${i}, à ×${camera.zoom.toFixed(3)}`;
    expect(camera.x - halfWidth, label).toBeGreaterThanOrEqual(-MARGIN - 1);
    expect(camera.x + halfWidth, label).toBeLessThanOrEqual(OFFICE.width + MARGIN + 1);
    expect(camera.y - halfHeight, label).toBeGreaterThanOrEqual(-MARGIN - 1);
    expect(camera.y + halfHeight, label).toBeLessThanOrEqual(OFFICE.height + MARGIN + 1);
  }
}

// Une molette crantée sur le jeu : `notches` crans (positif : plus loin), un toutes les 60 ms environ.
async function wheelNotches(page: Page, notches: number): Promise<void> {
  for (let i = 0; i < Math.abs(notches); i++) {
    await page.mouse.wheel(0, notches > 0 ? 100 : -100);
    await page.waitForTimeout(60);
  }
}

test('glisser la carte déplace la vue ; le double-clic la recentre, et l\'avatar court là où l\'on a double-cliqué', async ({ page }) => {
  test.slow();   // l'arrivée marche jusqu'au bureau pour le rendre : 30 s ne suffisent pas sur une machine chargée
  await joinOffice(page, 'Paulo');
  // Le bureau reçu à l'arrivée est rendu tout de suite (il n'y en a que six, et d'autres specs en cherchent un de libre) : l'avatar revient à l'accueil.
  await giveDeskBack(page);
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

  // Un double-clic au milieu de l'écran : l'avatar y court (le point de la carte au centre de la caméra glissée, ou la case libre la plus proche), et la caméra
  // le suit, de nouveau sur lui à l'arrivée.
  const target = await page.evaluate(() => window.__office!.camera());
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(() => page.evaluate(() => window.__office!.autoWalking())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__office!.autoWalking()), { timeout: 10_000 }).toBe(false);
  const arrived = await selfAt(page);
  expect(Math.hypot(arrived.x - target.x, arrived.y - target.y)).toBeLessThanOrEqual(2 * 32);
  await expect.poll(async () => Math.abs((await selfOnScreen(page)).x - before.x)).toBeLessThan(3);
  await expect.poll(async () => Math.abs((await selfOnScreen(page)).y - before.y)).toBeLessThan(3);
});

test('après avoir glissé la carte, se remettre à marcher recentre la caméra', async ({ page }) => {
  test.slow();   // l'arrivée marche jusqu'au bureau pour le rendre
  await joinOffice(page, 'Pauline');
  await giveDeskBack(page);
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

test('la caméra libre reste dans la carte et sa marge de cinq cases : contre le coin, du plancher à 200 %, jamais plus de cinq cases de fond', async ({ page }, testInfo) => {
  await joinOffice(page, 'Faustine');
  await giveDeskBack(page);
  const box = await canvasBox(page);
  const canvas = { width: box.width, height: box.height };
  await teleportTo(page, SOUTH_EAST);
  const camera = () => page.evaluate(() => window.__office!.camera());
  const zoom = () => page.evaluate(() => window.__office!.zoom());

  // L'avatar dans le coin sud-est : la caméra qui le suit est déjà contre ses bornes (sur 1280 × 720 à ×1,5, la vue fait 853,3 × 480 px de carte).
  await expectCameraNear(page, bounded({ x: SOUTH_EAST.x, y: SOUTH_EAST.y - 32 }, canvas, 1.5));

  // La carte glissée deux fois vers le haut à gauche : la caméra irait plus loin au sud-est, elle reste au coin de ses bornes. C'était le relevé du 31 octobre :
  // une carte glissée dans un coin, à 80 %, ne laissait voir qu'un quart d'écran de carte au milieu du vide. Les appuis sont au milieu de l'écran.
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const drag = async (dx: number, dy: number) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
    await page.mouse.up();
  };
  await drag(-600, -350);
  await drag(-300, -200);
  const corner = (z: number) => bounded({ x: 1e6, y: 1e6 }, canvas, z);
  await expectCameraNear(page, corner(1.5));

  // Zoomer en caméra libre : à chaque image, de 100 % au plancher (60 %), puis jusqu'à 80 %, puis jusqu'à 200 % (aux touches +), la vue reste dans ses bornes.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await recordCameraPerFrame(page);
  await wheelNotches(page, 10);
  await expect.poll(zoom).toBeCloseTo(floorZoom(canvas), 9);
  await wheelNotches(page, -4);
  await expect.poll(zoom).toBeCloseTo((1.5 * 80) / 100, 9);
  for (let i = 0; i < 15; i++) await page.keyboard.press('+');
  await expect.poll(zoom).toBe(closestZoom(canvas));
  const seen = await camerasSeen(page);
  expect(Math.min(...seen.map((frame) => frame.zoom))).toBeCloseTo(floorZoom(canvas), 9);
  expect(Math.max(...seen.map((frame) => frame.zoom))).toBe(closestZoom(canvas));
  expectViewInBoundsEveryFrame(seen, canvas, 'caméra libre');

  // À 200 %, la carte glissée de nouveau contre le coin (au plancher, la vue plus grande avait ramené la caméra vers l'intérieur : 497 × 280 px de carte, soit
  // quatre glissements de 600 × 350 px de l'écran à ×3) : la carte va jusqu'à cinq cases (160 px de carte, 480 px de l'écran à ×3) du bord droit et du bas
  // de l'écran, et le reste est le fond.
  for (let i = 0; i < 4; i++) await drag(-600, -350);
  await expectCameraNear(page, corner(closestZoom(canvas)));
  const right = box.width - MARGIN * closestZoom(canvas);
  const bottom = box.height - MARGIN * closestZoom(canvas);
  const map = await mapPixels(page, testInfo, 'caméra libre à 200 %, contre le coin sud-est');
  expect([map.minX, map.minY], 'la carte touche le coin supérieur gauche').toEqual([0, 0]);
  expect(Math.abs(map.maxX + 1 - right), `la carte va jusqu'à x = ${map.maxX}`).toBeLessThanOrEqual(1);
  expect(Math.abs(map.maxY + 1 - bottom), `la carte va jusqu'à y = ${map.maxY}`).toBeLessThanOrEqual(1);
  expect(map.count, 'des pixels de carte, pas seulement du fond').toBeGreaterThan(0.75 * right * bottom);
});

test('au bord est et dans un coin, dézoomer jusqu\'au plancher puis rezoomer : la caméra suit l\'avatar dans ses bornes, à chaque image', async ({ page }) => {
  test.slow();
  await joinOffice(page, 'Côme');
  await giveDeskBack(page);
  const box = await canvasBox(page);
  const canvas = { width: box.width, height: box.height };
  const zoom = () => page.evaluate(() => window.__office!.zoom());
  const base = await zoom();
  const lowest = floorZoom(canvas);

  // Sur 1280 × 720, le plancher est à 60 % : depuis 100 %, 8 crans de 5 % (10 donnés, les derniers arrêtés au plancher), puis 8 pour revenir. Du 29 au
  // 31 octobre, la caméra n'avait pas de bornes : l'avatar restait au centre de l'écran, et au bord, la moitié de l'écran montrait le fond. Elle s'arrête
  // désormais à cinq cases au-delà du bord, en glissant avec le zoom, sans sauter.
  for (const [where, spot] of [['au bord est', EAST_EDGE], ['dans le coin sud-est', SOUTH_EAST]] as const) {
    await teleportTo(page, spot);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await recordCameraPerFrame(page);
    await wheelNotches(page, 10);
    await expect.poll(zoom).toBeCloseTo(lowest, 9);
    await wheelNotches(page, -8);
    await expect.poll(zoom).toBeCloseTo(base, 9);
    const seen = await camerasSeen(page);

    // La caméra a bien suivi le zoom jusqu'au plancher, puis jusqu'à 100 %, en glissant (des zooms entre les deux)…
    expect(Math.min(...seen.map((camera) => camera.zoom)), where).toBeCloseTo(lowest, 9);
    expect(seen.at(-1)!.zoom, where).toBeCloseTo(base, 9);
    expect(seen.filter((camera) => camera.zoom > lowest + 1e-6 && camera.zoom < base - 1e-6).length, where).toBeGreaterThanOrEqual(10);
    // … et à chaque image, elle visait le milieu de l'avatar, ramené dans ses bornes : jamais plus de cinq cases de fond.
    expect(seen.every((camera) => camera.self.x === spot.x && camera.self.y === spot.y), where).toBe(true);
    expectBoundedOnAvatarEveryFrame(seen, canvas, where);
    expectViewInBoundsEveryFrame(seen, canvas, where);
    // À l'écran : l'avatar est à droite du centre, contre le bord de la carte, là où la caméra s'est arrêtée.
    const onScreen = await selfOnScreen(page);
    const stop = bounded({ x: spot.x, y: spot.y - 32 }, canvas, base);
    expect(Math.abs(onScreen.x - (box.width / 2 + (spot.x - stop.x) * base)), where).toBeLessThanOrEqual(1);
    expect(onScreen.x, where).toBeGreaterThan(box.width / 2 + 100);
  }
});

test('au plus loin, 60 % : « − » s\'éteint au plancher, la caméra reste dans ses bornes ; sur une tablette en hauteur, le plancher est plus près, où la carte et sa marge tiennent en hauteur', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await joinOffice(page, 'Flore');
  await giveDeskBack(page);
  const box = await canvasBox(page);
  const canvas = { width: box.width, height: box.height };
  const zoom = () => page.evaluate(() => window.__office!.zoom());
  const readout = page.locator('.dock-zoom .zoom-value');
  const zoomOut = page.getByRole('button', { name: 'Zoom arrière' });

  // Dans le coin sud-est, là où la caméra sans bornes montrait le plus de vide.
  await teleportTo(page, SOUTH_EAST);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await recordCameraPerFrame(page);

  // Une molette crantée, bien plus loin que le plancher : 20 crans de 5 % depuis 100 %. Sur 1440 × 900, le plancher est à 60 % (×0,9) : la vue y fait
  // 1600 × 1000 px de carte, moins que la carte et ses marges (3232 × 2112).
  await wheelNotches(page, 20);
  await expect.poll(zoom).toBeCloseTo(floorZoom(canvas), 9);
  expect(floorZoom(canvas)).toBeCloseTo(0.9, 9);
  await expect(readout).toHaveText('60 %');
  await expect(zoomOut).toBeDisabled();
  // Ni la touche -, ni la molette n'y font plus rien.
  await page.keyboard.press('-');
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(300);
  expect(await zoom()).toBeCloseTo(floorZoom(canvas), 9);
  await expect(readout).toHaveText('60 %');
  expectBoundedOnAvatarEveryFrame(await camerasSeen(page), canvas, '1440 × 900');

  // Une tablette en hauteur (768 × 1024) : la carte et sa marge y tiennent en hauteur dès 64,6 %, le plancher ; la caméra, dans le coin, toujours dans ses
  // bornes. (Sur un téléphone, 390 × 844, elles ne tiendraient qu'à 53 % : le plancher y reste à 60 %.)
  await recordCameraPerFrame(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  const tablet = { width: 768, height: 1024 };
  await expect.poll(zoom).toBeCloseTo(floorZoom(tablet), 9);
  expect(floorZoom(tablet)).toBeGreaterThan(0.6 * baseZoom(tablet));
  expect(tablet.height / (await zoom())).toBeCloseTo(OFFICE.height + 2 * MARGIN, 6);
  const seen = (await camerasSeen(page)).filter((camera) => Math.abs(camera.zoom - floorZoom(tablet)) < 1e-9);
  expect(seen.length).toBeGreaterThan(0);
  expectBoundedOnAvatarEveryFrame(seen, tablet, '768 × 1024');
});
