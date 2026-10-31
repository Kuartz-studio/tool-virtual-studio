import { expect, test, type Page } from '@playwright/test';
import { enterOffice, joinOffice, meMenuEntry, selfAt, waitForOffice } from './helpers';

// La fenêtre « Quoi de neuf ? » (docs/nouveautes.md) : un compte d'avant les nouveautés (sa dernière version vue remise à nul par la route des tests) la
// voit en entrant au bureau, après l'écran d'entrée et jamais par-dessus ; la fermer l'enregistre sur le compte, et elle ne revient pas au rechargement.
// Les comptes créés maintenant partent à jour : ils ne la voient pas (sinon elle couvrirait le bureau de tous les autres tests).

const TITLE = 'Quoi de neuf ?';
const whatsNew = (page: Page) => page.getByRole('dialog', { name: TITLE });

// Le temps de laisser la fenêtre s'ouvrir si elle devait le faire (elle attend une demi-seconde après l'arrivée : updates/WhatsNew.tsx).
async function settle(page: Page): Promise<void> {
  await waitForOffice(page);
  await page.waitForTimeout(1200);
}

test('« Quoi de neuf ? » une fois en entrant, puis plus, et sur demande depuis le menu « Moi »', async ({ page }) => {
  const account = await joinOffice(page, 'Noémie');
  // Un compte neuf est à jour : rien ne s'ouvre.
  await settle(page);
  await expect(whatsNew(page)).toHaveCount(0);

  // Comme un compte d'avant la mise à jour.
  const reset = await page.request.post('/api/test/release-seen/reset', { data: { email: account.email } });
  expect(reset.status(), await reset.text()).toBe(204);
  await page.reload();
  // L'écran d'entrée d'abord, sans la fenêtre par-dessus.
  await expect(page.getByRole('button', { name: /^Entrer( quand même)?$/ })).toBeVisible();
  await expect(whatsNew(page)).toHaveCount(0);
  await enterOffice(page);

  const dialog = whatsNew(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('v1.01 · 31 octobre 2026');
  await expect(dialog).toContainText('Un nouveau bureau, avec jardin');
  await expect(dialog.getByRole('button', { name: 'C\'est parti' })).toBeFocused();

  // Le clavier reste dans la fenêtre : l'avatar ne marche pas derrière.
  await waitForOffice(page);
  const before = await selfAt(page);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  expect(await selfAt(page)).toMatchObject({ x: before.x, y: before.y });

  const saved = page.waitForResponse((response) => response.url().endsWith('/api/me/release-seen') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'C\'est parti' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await saved).status()).toBe(200);

  // Une fois par compte : rechargée, la page ne la montre plus.
  await page.reload();
  await enterOffice(page);
  await settle(page);
  await expect(whatsNew(page)).toHaveCount(0);

  // La revoir quand on veut : « Nouveautés » dans le menu « Moi », qui porte le numéro de la version. Échap la ferme.
  await (await meMenuEntry(page, 'Nouveautés, version 1.01')).click();
  await expect(whatsNew(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(whatsNew(page)).toHaveCount(0);
});
