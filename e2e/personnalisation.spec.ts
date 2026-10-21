import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
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
async function arrive(browser: Browser, name: string, desk: 'needed' | 'given back' = 'given back'): Promise<{ page: Page; id: string; account: Account }> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const account = await joinOffice(page, name);
  const panel = await openPanel(page, 'Mon bureau');
  if (desk === 'given back') {
    await expect(panel.getByRole('button', { name: 'Rendre mon bureau' }).or(panel.getByText('Tu n\'as pas de bureau.'))).toBeVisible();
    if (await panel.getByRole('button', { name: 'Rendre mon bureau' }).isVisible()) await panel.getByRole('button', { name: 'Rendre mon bureau' }).click();
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
  // La banque : neuf catégories au plus, le poste de travail d'abord.
  const categories = panel.getByRole('group', { name: 'Catégories' }).getByRole('button');
  expect(await categories.count()).toBeLessThanOrEqual(10);
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

test('la déco du bureau : un élément pris en main se pose dans la pièce, et « Tout vider » puis « Poste par défaut » remplacent le brouillon', async ({ browser }) => {
  const a = await arrive(browser, 'Alex', 'needed');
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  const panel = a.page.getByRole('complementary', { name: 'Décorer mon bureau' });

  await expect(panel.getByText('12 / 80 éléments')).toBeVisible();   // le poste de travail par défaut
  await panel.getByRole('button', { name: 'Tout vider' }).click();
  await expect(panel.getByText('0 / 80 éléments')).toBeVisible();
  await expect(panel.getByText('Modifications non enregistrées.')).toBeVisible();

  await panel.getByRole('button', { name: 'Bureaux & tables' }).click();
  await panel.getByRole('button', { name: 'Bureau bois clair', exact: true }).click();
  await expect(panel.getByText('En main : Bureau bois clair.')).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(panel.getByText('En main :')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Poste par défaut' }).click();
  await expect(panel.getByText('12 / 80 éléments')).toBeVisible();
  // Le brouillon est redevenu ce que le serveur a : plus rien à enregistrer, le bouton ne propose plus que de fermer l'éditeur.
  await expect(panel.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test('la déco du bureau : un clic dans la pièce pose l\'élément tenu, il s\'enregistre et se retrouve après un rechargement', async ({ browser }) => {
  const a = await arrive(browser, 'Anouk', 'needed');
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  const panel = a.page.getByRole('complementary', { name: 'Décorer mon bureau' });
  await expect(panel.getByText('12 / 80 éléments')).toBeVisible();

  await panel.getByRole('button', { name: 'Plantes' }).click();
  await panel.getByRole('button', { name: 'Plante en pot', exact: true }).click();
  // La caméra amène la pièce dans la partie de l'écran que le panneau laisse libre, et s'y arrête : on lit où elle est (le bureau attribué
  // n'est pas toujours le même, et la caméra reste contre le bord de la carte pour les premiers). La case (7, 2) de la pièce est libre dans le
  // poste par défaut.
  const spot = async () => {
    const room = await a.page.evaluate(() => window.__office!.editorRoom());
    if (!room) return null;
    return a.page.evaluate(({ x, y }) => window.__office!.toScreen(x, y), { x: room.x + 7 * 32 + 16, y: room.y + 2 * 32 + 16 });
  };
  await expect.poll(spot, { timeout: 5000 }).not.toBeNull();
  await a.page.waitForTimeout(700);
  const target = (await spot())!;
  await a.page.mouse.click(target.x, target.y);
  await expect(panel.getByText('13 / 80 éléments')).toBeVisible();
  // Un deuxième clic au même endroit ne pose rien de plus : il y a déjà quelque chose, et la personne doit confirmer le remplacement.
  await a.page.mouse.click(target.x, target.y);
  const dialog = a.page.getByRole('alertdialog', { name: 'Remplacer cet élément ?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Voulez-vous vraiment le remplacer par cet élément ?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByText('13 / 80 éléments')).toBeVisible();
  // Confirmé, le nouvel élément prend la place de l'ancien : toujours 13 éléments.
  await a.page.mouse.click(target.x, target.y);
  await dialog.getByRole('button', { name: 'Remplacer' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByText('13 / 80 éléments')).toBeVisible();

  // La gomme efface l'élément visé : on repasse à 12, puis on le repose.
  await panel.getByRole('button', { name: 'Gomme' }).click();
  await expect(panel.getByText('Gomme : clique sur un élément de la pièce pour l\'effacer.')).toBeVisible();
  await a.page.mouse.click(target.x, target.y);
  await expect(panel.getByText('12 / 80 éléments')).toBeVisible();
  await panel.getByRole('button', { name: 'Plante en pot', exact: true }).click();
  await a.page.mouse.click(target.x, target.y);
  await expect(panel.getByText('13 / 80 éléments')).toBeVisible();

  await panel.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(panel.getByText('Déco enregistrée.')).toBeVisible();

  await a.page.reload();
  await enterOffice(a.page);
  await openPanel(a.page, 'Mon bureau');
  await a.page.getByRole('button', { name: 'Décorer mon bureau' }).click();
  await expect(a.page.getByRole('complementary', { name: 'Décorer mon bureau' }).getByText('13 / 80 éléments')).toBeVisible();
});

// Seuls les gros meubles arrêtent : à l'accueil, une petite plante en pot (49, 43) se traverse, et la table basse (47-48, 43-44) qui la suit
// arrête. On part à droite de la plante, on marche vers la gauche.
test('la marche : une petite plante se traverse, un gros meuble arrête', async ({ browser }) => {
  const a = await arrive(browser, 'Alma');
  await a.page.evaluate(() => window.__office!.teleport(51 * 32 + 16, 43 * 32 + 16));
  await expect.poll(async () => (await selfAt(a.page)).x, { timeout: WALK_TIMEOUT }).toBe(51 * 32 + 16);

  await a.page.keyboard.down('ArrowLeft');
  // La plante occupe les x de 1568 à 1600 : l'avatar la traverse, puis butte contre la table (bord à 1568, plus la demi-largeur du corps).
  await expect.poll(async () => (await selfAt(a.page)).x, { timeout: WALK_TIMEOUT }).toBeLessThan(1590);
  await a.page.waitForTimeout(800);
  await a.page.keyboard.up('ArrowLeft');
  const stopped = (await selfAt(a.page)).x;
  expect(stopped).toBeGreaterThanOrEqual(1568 + 9);
  expect(stopped).toBeLessThan(1600);
});

