import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { inviteAndJoin, uniqueEmail } from './helpers';

type Rgb = readonly [number, number, number];

// Les couleurs des tuiles de la carte de développement (apps/client/scripts/gen-dev-assets.ts), et celle du texte de l'étiquette
// (map-layers.ts). Les pixels sont dessinés sans lissage : un pixel de l'écran a exactement la couleur d'un pixel de la tuile.
const MAP_COLORS: Record<string, Rgb> = {
  sol: [222, 216, 202],
  mur: [74, 84, 110],
  bureau: [170, 128, 84],
  'sol de la salle de réunion': [172, 192, 218],
  'sol d\'un espace de bureau': [208, 226, 202],
  'texte de l\'étiquette': [59, 66, 86],
};
// Le fond du jeu (config.ts), autour de la carte.
const BACKGROUND: Rgb = [29, 32, 48];
// La couleur du message d'échec du chargement (Preloader.ts), qui n'est pas celle de la barre de chargement, blanche.
const ERROR_TEXT: Rgb = [255, 180, 180];

// Le bonjour provisoire, en haut à gauche de la page, cache ce qui est dessous.
const HIDE_OVERLAY = '.office-overlay { visibility: hidden }';

// Attend que le jeu ait dessiné au moins deux images : celle de la scène qui vient d'être prête, et la suivante.
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

// Une capture de la page, jointe au rapport du test (test-results/…/<nom>.png).
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<Buffer> {
  await nextFrames(page);
  const path = testInfo.outputPath(`${name}.png`);
  const png = await page.screenshot({ path });
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

// Un point de la carte, juste dedans puis juste dehors, de chaque côté : x et y sont ceux du pixel dedans, dx et dy la direction
// de la sortie. Loin du bonjour provisoire, qui cache ce qui est dessous.
const edge = (x: number, y: number, dx: number, dy: number): [[number, number], [number, number]] => [[x, y], [x + dx, y + dy]];

test('la carte s\'affiche', async ({ page }, testInfo) => {
  // 1600 × 1100 : assez grand pour le zoom ×2 et pour voir toute la carte (24 × 16 cases de 32 px : 1536 × 1024 px à l'écran).
  await page.setViewportSize({ width: 1600, height: 1100 });
  await inviteAndJoin(page, { email: uniqueEmail('carla'), name: 'Carla', password: 'motdepasse-de-carla' });
  await page.waitForFunction(() => window.__office?.ready);

  // Le canevas remplit la fenêtre (scale.mode RESIZE).
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.boundingBox()).toMatchObject({ x: 0, y: 0, width: 1600, height: 1100 });
  // Et le bonjour provisoire reste par-dessus.
  await expect(page.getByText('Bonjour Carla')).toBeVisible();

  // Zoom ×2, la carte au milieu : 32 px de marge à gauche et à droite, 38 en haut et en bas.
  const edgesX2 = [edge(32, 600, -1, 0), edge(1567, 600, 1, 0), edge(800, 38, 0, -1), edge(800, 1061, 0, 1)];
  const x2 = await readPixels(page, await screenshot(page, testInfo, 'carte-zoom-x2'), MAP_COLORS, edgesX2.flat());
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
  const x1 = await readPixels(page, await screenshot(page, testInfo, 'carte-zoom-x1'), MAP_COLORS, edgesX1.flat());
  edgesX1.forEach((_, side) => {
    expect(x1.at[side * 2], `dedans, bord ${side}`).not.toEqual(BACKGROUND);
    expect(x1.at[side * 2 + 1], `dehors, bord ${side}`).toEqual(BACKGROUND);
  });
});

test('carte introuvable : un message à la place de la carte', async ({ page }) => {
  await page.route('**/assets/maps/dev-office.json', (route) => route.fulfill({ status: 404, body: 'introuvable' }));
  await inviteAndJoin(page, { email: uniqueEmail('anouk'), name: 'Anouk', password: 'motdepasse-d-anouk' });
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
});
