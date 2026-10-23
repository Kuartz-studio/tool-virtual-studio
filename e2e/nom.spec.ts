import { expect, test, type BrowserContext } from '@playwright/test';
import { enterOffice, joinOffice, meChip, openMeMenu, openPanel, waitForOffice } from './helpers';

// Changer son nom affiché, depuis le menu « Moi » : la puce suit, les collègues le voient en direct, et il tient après un rechargement.

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

test('changer de nom depuis le menu « Moi »', async ({ browser }) => {
  const [first, second] = [await browser.newContext(), await browser.newContext()];
  contexts.push(first, second);
  const a = await first.newPage();
  const b = await second.newPage();
  await joinOffice(a, 'Camille');
  await joinOffice(b, 'Dominique');
  const suffix = Date.now().toString(36).slice(-4);
  const renamed = `Cam ${suffix}`;

  const menu = await openMeMenu(a);
  await menu.getByRole('menuitem', { name: 'Changer de nom' }).click();
  const editor = a.getByRole('dialog', { name: 'Changer de nom' });
  const field = editor.getByRole('textbox', { name: 'Ton nom' });
  await expect(field).toHaveValue('Camille');

  // Un nom vide ne s'enregistre pas.
  await field.fill('   ');
  await expect(editor.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

  await field.fill(renamed);
  await editor.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(editor).toBeHidden();
  await expect(meChip(a)).toContainText(renamed);

  // Le collègue le voit, sans recharger.
  const people = await openPanel(b, 'Personnes');
  await expect(people).toContainText(renamed);

  // Il tient après un rechargement.
  await a.reload();
  await enterOffice(a);
  await waitForOffice(a);
  await expect(meChip(a)).toContainText(renamed);
});
