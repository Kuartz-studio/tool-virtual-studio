import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { avatarsOf, enterOffice, expectInOffice, joinOffice, openPanel, playerSeenBy, selfAt, signIn, WALK_TIMEOUT, type Account } from './helpers';
import { TEST_AVATAR_KEY } from './pixels';

// Le personnage et le bureau de chacun : le builder (le nouveau personnage est vu par les autres, sans recharger) et l'éditeur de déco
// (la déco s'enregistre, et se retrouve à la reconnexion).

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// Il n'y a que six bureaux, et le serveur en donne un à chaque arrivant : ceux qui n'ont pas besoin du leur le rendent tout de suite, et ceux
// qui en ont besoin (la déco) prennent la première place libre, quand il y en a une.
// Le nombre d'éléments que dit le panneau « Décorer mon bureau » (« 12 / 80 éléments »).
async function itemCount(panel: Locator): Promise<number> {
  const text = panel.getByText(/^\d+ \/ 80 éléments$/);
  await expect(text).toBeVisible();
  return Number((await text.textContent())!.split(' ')[0]);
}

async function arrive(browser: Browser, name: string, desk: 'needed' | 'given back' = 'given back'): Promise<{ page: Page; id: string; account: Account }> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const account = await joinOffice(page, name);
  const panel = await openPanel(page, 'Mon bureau');
  if (desk === 'given back') {
    await expect(panel.getByRole('button', { name: 'Rendre mon bureau' }).or(panel.getByText('Tu n\'as pas de bureau.'))).toBeVisible();
    if (await panel.getByRole('button', { name: 'Rendre mon bureau' }).isVisible()) {
      await panel.getByRole('button', { name: 'Rendre mon bureau' }).click();
      await panel.getByRole('button', { name: 'Oui, le rendre' }).click();   // la confirmation
    }
    await expect(panel.getByText('Tu n\'as pas de bureau.')).toBeVisible();
  } else {
    await expect(async () => {
      if (await panel.getByRole('button', { name: 'Décorer mon bureau' }).isVisible()) return;
      await panel.getByRole('button', { name: /^Prendre la place/ }).first().click({ timeout: 1000 });
      await expect(panel.getByRole('button', { name: 'Décorer mon bureau' })).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
  }
  await panel.getByRole('button', { name: 'Fermer le panneau Mon bureau' }).click();
  await expect(panel).toHaveCount(0);
  return { page, id: (await selfAt(page)).id, account };
}

// Rend, à la fin d'un test, le bureau qu'il a pris pour sa déco (l'avatar y est encore : pas de marche) : les specs qui passent après lui sur ce
// serveur (les portes, suivre…) ont besoin d'une place libre, et il n'y en a que six.
async function giveBack(page: Page): Promise<void> {
  const editor = page.getByRole('complementary', { name: 'Décorer mon bureau' });
  if (await editor.isVisible()) await editor.getByRole('button', { name: 'Fermer l\'éditeur de déco' }).click();
  const panel = await openPanel(page, 'Mon bureau');
  await panel.getByRole('button', { name: 'Rendre mon bureau' }).click();
  await panel.getByRole('button', { name: 'Oui, le rendre' }).click();
  await expect(panel.getByText('Tu n\'as pas de bureau.')).toBeVisible();
}

test('le builder : A choisit un autre personnage prêt à jouer, B le voit tout de suite, et A le retrouve après un rechargement', async ({ browser }) => {
  test.slow();   // deux personnes dans deux navigateurs : plus de 20 s sur une machine chargée
  const a = await arrive(browser, 'Ambre');
  const b = await arrive(browser, 'Basile');
  await expect.poll(() => avatarsOf(b.page, a.id), { timeout: WALK_TIMEOUT }).toBe(1);
  await expect.poll(async () => (await playerSeenBy(b.page, a.id))?.avatarKey).toBe(TEST_AVATAR_KEY);

  const panel = await openPanel(a.page, 'Personnage');
  // Les 20 personnages prêts à jouer, dont celui qu'on a est enfoncé.
  await expect(panel.getByRole('group', { name: 'Personnages prêts à jouer' }).getByRole('button')).toHaveCount(20);
  await expect(panel.getByRole('button', { name: 'Personnage 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const save = panel.getByRole('button', { name: 'Enregistrer' });
  await expect(save).toBeDisabled();

  await panel.getByRole('button', { name: 'Personnage 12', exact: true }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.getByText('Personnage enregistré.')).toBeVisible();

  // B voit le nouveau personnage, sans recharger ; A aussi, sur lui-même.
  await expect.poll(async () => (await playerSeenBy(b.page, a.id))?.avatarKey, { timeout: WALK_TIMEOUT }).toBe('p.12');
  await a.page.waitForFunction(() => window.__office?.selfAvatar()?.shown === 'p.12');

  // Après un rechargement, le serveur redit « p.12 » : A le garde.
  await a.page.reload();
  await enterOffice(a.page);
  await a.page.waitForFunction(() => window.__office?.selfAvatar()?.shown === 'p.12');
});

test('le builder : « Créer le mien » assemble un personnage pièce par pièce, que B voit', async ({ browser }) => {
  test.slow();   // deux personnes dans deux navigateurs : plus de 20 s sur une machine chargée
  const a = await arrive(browser, 'Alix');
  const b = await arrive(browser, 'Bruno');
  await expect.poll(() => avatarsOf(b.page, a.id), { timeout: WALK_TIMEOUT }).toBe(1);

  const panel = await openPanel(a.page, 'Personnage');
  await panel.getByRole('tab', { name: 'Créer le mien' }).click();
  await panel.getByRole('button', { name: 'Peau', exact: true }).click();
  await panel.getByRole('button', { name: 'Peau 3', exact: true }).click();
  await panel.getByRole('button', { name: 'Coiffure', exact: true }).click();
  await panel.getByRole('button', { name: 'Coiffure 5', exact: true }).click();
  await panel.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(panel.getByText('Personnage enregistré.')).toBeVisible();

  const built = async (page: Page, id: string) => (await playerSeenBy(page, id))?.avatarKey ?? '';
  await expect.poll(() => built(b.page, a.id), { timeout: WALK_TIMEOUT }).toMatch(/^c\.3\.1\.1-1\.5-1\.0$/);
  // Le jeu de B assemble ce personnage (il n'est plus la silhouette).
  await expect.poll(async () => (await b.page.evaluate(() => window.__office?.selfAvatar()))?.wanted).toBeTruthy();
});

test('la déco du bureau : le sol et les murs se règlent, s\'enregistrent, et se retrouvent après une reconnexion', async ({ browser }) => {
  const a = await arrive(browser, 'Ambre', 'needed');
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();

  const panel = a.page.getByRole('complementary', { name: 'Décorer mon bureau' });
  await expect(panel).toBeVisible();
  // La banque : un onglet à icône par catégorie (son nom pour les lecteurs d'écran), le poste de travail d'abord, la collection à part (Boutique) en dernier ;
  // pas encore de récents.
  const categories = panel.getByRole('group', { name: 'Catégories' }).getByRole('button');
  expect(await categories.count()).toBeLessThanOrEqual(11);
  await expect(categories.first()).toHaveText('Écrans & informatique');
  const save = panel.getByRole('button', { name: 'Enregistrer' });
  await expect(save).toBeDisabled();

  await panel.getByRole('tab', { name: 'Murs et sol' }).click();
  await panel.getByRole('button', { name: 'Noyer' }).click();
  await panel.getByRole('button', { name: 'Bleu ciel' }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.getByText('Déco enregistrée.')).toBeVisible();

  // On se reconnecte : la déco est là (le serveur l'a gardée), l'éditeur s'ouvre dessus.
  await a.page.context().clearCookies();
  await a.page.goto('/connexion');
  await signIn(a.page, a.account);
  await expectInOffice(a.page, 'Ambre');
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  const again = a.page.getByRole('complementary', { name: 'Décorer mon bureau' });
  await again.getByRole('tab', { name: 'Murs et sol' }).click();
  await expect(again.getByRole('button', { name: 'Noyer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(again.getByRole('button', { name: 'Bleu ciel' })).toHaveAttribute('aria-pressed', 'true');
});

test('la déco du bureau : le sélecteur de matière filtre les sols et les murs, et un sol et un mur noirs, gratuits, s\'enregistrent', async ({ browser }) => {
  const a = await arrive(browser, 'Anouk', 'needed');
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  const panel = a.page.getByRole('complementary', { name: 'Décorer mon bureau' });
  await panel.getByRole('tab', { name: 'Murs et sol' }).click();

  // Les listes sont rangées par couleur ; « Moquette » ne garde que les moquettes, la noire comprise.
  const materials = panel.getByRole('group', { name: 'Matière', exact: true });
  const floors = panel.getByRole('group', { name: 'Sol', exact: true });
  const walls = panel.getByRole('group', { name: 'Murs', exact: true });
  await expect(floors.getByRole('group', { name: 'Noir', exact: true })).toBeVisible();
  await materials.getByRole('button', { name: 'Moquette', exact: true }).click();
  await expect(floors.getByRole('button', { name: 'Noyer' })).toHaveCount(0);
  await floors.getByRole('button', { name: 'Moquette noire' }).click();
  await materials.getByRole('button', { name: 'Brique', exact: true }).click();
  await walls.getByRole('button', { name: 'Brique noire' }).click();

  // Gratuits : rien à acheter, l'enregistrement passe tout de suite.
  await panel.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(panel.getByText('Déco enregistrée.')).toBeVisible();
  await materials.getByRole('button', { name: 'Toutes', exact: true }).click();
  await expect(floors.getByRole('button', { name: 'Moquette noire' })).toHaveAttribute('aria-pressed', 'true');
  await expect(walls.getByRole('button', { name: 'Brique noire' })).toHaveAttribute('aria-pressed', 'true');
  await giveBack(a.page);
});

test('la déco du bureau : un élément pris en main se pose dans la pièce, et « Tout vider » puis « Poste par défaut » remplacent le brouillon', async ({ browser }) => {
  const a = await arrive(browser, 'Alex', 'needed');
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  const panel = a.page.getByRole('complementary', { name: 'Décorer mon bureau' });

  // Le poste de travail par défaut : celui de la pièce attribuée (12 éléments dans une pièce standard, 8 dans une compacte).
  const initial = await itemCount(panel);
  expect(initial).toBeGreaterThanOrEqual(8);
  await panel.getByRole('button', { name: 'Tout vider' }).click();
  await expect(panel.getByText('0 / 80 éléments')).toBeVisible();
  await expect(panel.getByText('Modifications non enregistrées.')).toBeVisible();

  await panel.getByRole('button', { name: 'Bureaux & tables' }).click();
  await panel.getByRole('button', { name: 'Bureau bois clair', exact: true }).click();
  await expect(panel.getByText('En main : Bureau bois clair')).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(panel.getByText('En main :')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Poste par défaut' }).click();
  await expect(panel.getByText(`${initial} / 80 éléments`)).toBeVisible();
  // Le brouillon est redevenu ce que le serveur a : plus rien à enregistrer. La croix de l'en-tête ferme l'éditeur.
  await expect(panel.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Fermer l\'éditeur de déco' }).click();
  await expect(panel).toHaveCount(0);
});

test('la déco du bureau : un clic dans la pièce pose l\'élément tenu, il s\'enregistre et se retrouve après un rechargement', async ({ browser }) => {
  const a = await arrive(browser, 'Anouk', 'needed');
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  const panel = a.page.getByRole('complementary', { name: 'Décorer mon bureau' });
  const initial = await itemCount(panel);
  expect(initial).toBeGreaterThanOrEqual(8);

  await panel.getByRole('button', { name: 'Plantes' }).click();
  await panel.getByRole('button', { name: 'Plante en pot', exact: true }).click();
  // La caméra amène la pièce dans la partie de l'écran que le panneau laisse libre, et s'y arrête : on lit où elle est (le bureau attribué
  // n'est pas toujours le même, et la caméra reste contre le bord de la carte pour les premiers).
  const spotAt = async (column: number, row: number) => {
    const room = await a.page.evaluate(() => window.__office!.editorRoom());
    if (!room) return null;
    return a.page.evaluate(({ x, y }) => window.__office!.toScreen(x, y), { x: room.x + column * 32 + 16, y: room.y + row * 32 + 16 });
  };
  await expect.poll(() => spotAt(7, 2), { timeout: 5000 }).not.toBeNull();
  await a.page.waitForTimeout(700);
  // Une case libre : les pièces n'ont pas toutes le même poste par défaut (porte au sud ou au nord, taille). On essaie quelques cases de la pièce, la
  // première où la plante se pose (ailleurs, c'est le remplacement ou un refus, qu'on écarte).
  let target: { x: number; y: number } | null = null;
  for (const [column, row] of [[5, 2], [5, 4], [1, 2], [3, 3], [5, 5]] as const) {
    const where = (await spotAt(column, row))!;
    await a.page.mouse.click(where.x, where.y);
    if (await panel.getByText(`${initial + 1} / 80 éléments`).isVisible({ timeout: 1500 }).catch(() => false)) {
      target = where;
      break;
    }
    const dialog = a.page.getByRole('alertdialog', { name: 'Remplacer cet élément ?' });
    if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Annuler' }).click();
  }
  expect(target, 'une case libre dans la pièce').not.toBeNull();
  await expect(panel.getByText(`${initial + 1} / 80 éléments`)).toBeVisible();
  // Un deuxième clic au même endroit ne pose rien de plus : il y a déjà quelque chose, et la personne doit confirmer le remplacement.
  await a.page.mouse.click(target!.x, target!.y);
  const dialog = a.page.getByRole('alertdialog', { name: 'Remplacer cet élément ?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Voulez-vous vraiment le remplacer par cet élément ?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByText(`${initial + 1} / 80 éléments`)).toBeVisible();
  // Confirmé, le nouvel élément prend la place de l'ancien : toujours un élément de plus qu'au départ.
  await a.page.mouse.click(target!.x, target!.y);
  await dialog.getByRole('button', { name: 'Remplacer' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByText(`${initial + 1} / 80 éléments`)).toBeVisible();

  // La gomme efface l'élément visé : on revient au départ, puis on le repose.
  await panel.getByRole('button', { name: 'Gomme' }).click();
  await expect(panel.getByText('Gomme : clique sur un élément pour l\'effacer.')).toBeVisible();
  await a.page.mouse.click(target!.x, target!.y);
  await expect(panel.getByText(`${initial} / 80 éléments`)).toBeVisible();
  await panel.getByRole('button', { name: 'Plante en pot', exact: true }).click();
  await a.page.mouse.click(target!.x, target!.y);
  await expect(panel.getByText(`${initial + 1} / 80 éléments`)).toBeVisible();

  await panel.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(panel.getByText('Déco enregistrée.')).toBeVisible();

  await a.page.reload();
  await enterOffice(a.page);
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  await expect(a.page.getByRole('complementary', { name: 'Décorer mon bureau' }).getByText(`${initial + 1} / 80 éléments`)).toBeVisible();
});

test('la déco du bureau : un pot devant sa pièce, sur la rangée de la rue, s\'enregistre et se retrouve après un rechargement', async ({ browser }) => {
  const a = await arrive(browser, 'Nina', 'needed');
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  const panel = a.page.getByRole('complementary', { name: 'Décorer mon bureau' });
  const initial = await itemCount(panel);
  await panel.getByRole('button', { name: 'Plantes' }).click();
  await panel.getByRole('button', { name: 'Plante en pot', exact: true }).click();

  // La rangée du dehors : sous la pièce (7 rangées), sa bande de mur sud (rangées 7 et 8), puis la rue, rangée 9. On lit où la caméra a mis la pièce.
  const spotAt = async (column: number, row: number) => {
    const room = await a.page.evaluate(() => window.__office!.editorRoom());
    if (!room) return null;
    return a.page.evaluate(({ x, y }) => window.__office!.toScreen(x, y), { x: room.x + column * 32 + 16, y: room.y + row * 32 + 16 });
  };
  await expect.poll(() => spotAt(2, 9), { timeout: 5000 }).not.toBeNull();
  await a.page.waitForTimeout(700);
  const viewport = a.page.viewportSize()!;
  // Une case libre de la rangée : le dehors par défaut a des plantes et une fontaine, le mur l'interrupteur ou le panneau de sortie, selon la pièce.
  let placed = false;
  for (const column of [2, 4, 3, 5, 6]) {
    const where = (await spotAt(column, 9))!;
    expect(where.y, 'la rangée du dehors est à l\'écran').toBeLessThan(viewport.height);
    await a.page.mouse.click(where.x, where.y);
    if (await panel.getByText(`${initial + 1} / 80 éléments`).isVisible({ timeout: 1500 }).catch(() => false)) {
      placed = true;
      break;
    }
    const dialog = a.page.getByRole('alertdialog', { name: 'Remplacer cet élément ?' });
    if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Annuler' }).click();
  }
  expect(placed, 'une case libre devant la pièce').toBe(true);
  await panel.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(panel.getByText('Déco enregistrée.')).toBeVisible();

  await a.page.reload();
  await enterOffice(a.page);
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  await expect(a.page.getByRole('complementary', { name: 'Décorer mon bureau' }).getByText(`${initial + 1} / 80 éléments`)).toBeVisible();
  await giveBack(a.page);
});

// Seuls les gros meubles arrêtent : dans la rue nord, loin des bureaux (devant eux, la rangée de la rue est leur dehors, que chacun décore), un arbuste
// (68, 11) se traverse, et la fontaine à eau (63, 11) qui le suit arrête (le test « les fontaines à eau » de office.test.ts garde ces deux positions).
// On part à droite de l'arbuste, on marche vers la gauche.
test('la marche : une petite plante se traverse, un gros meuble arrête', async ({ browser }) => {
  test.slow();   // l'arrivée marche jusqu'au bureau libre, qui peut être à l'autre bout de la carte : 30 s ne suffisent pas sur une machine chargée
  const a = await arrive(browser, 'Alma');
  await a.page.evaluate(() => window.__office!.teleport(70 * 32 + 16, 11 * 32 + 16));
  await expect.poll(async () => (await selfAt(a.page)).x, { timeout: WALK_TIMEOUT }).toBe(70 * 32 + 16);

  await a.page.keyboard.down('ArrowLeft');
  // L'arbuste occupe les x de 2176 à 2208 : l'avatar le traverse, puis bute contre la fontaine (bord droit à 2048, plus la demi-largeur du corps).
  await expect.poll(async () => (await selfAt(a.page)).x, { timeout: WALK_TIMEOUT }).toBeLessThan(2170);
  await a.page.waitForTimeout(800);
  await a.page.keyboard.up('ArrowLeft');
  const stopped = (await selfAt(a.page)).x;
  expect(stopped).toBeGreaterThanOrEqual(2048 + 9);
  expect(stopped).toBeLessThan(2170);
});

