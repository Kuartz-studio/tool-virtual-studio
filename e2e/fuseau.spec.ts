import { expect, test, type BrowserContext } from '@playwright/test';
import { joinOffice, openMeMenu, openPanel } from './helpers';

// Choisir son fuseau horaire dans le menu « Moi » : la ligne du menu suit, et un collègue voit, au survol de son nom dans le panneau Personnes,
// l'heure qu'il est chez soi. Les navigateurs des deux personnes sont réglés sur des fuseaux différents : l'heure montrée est celle du fuseau
// choisi, pas celle de l'appareil qui regarde.

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

// L'heure qu'il est dans ce fuseau, comme l'appli l'écrit (« 18:42 »), lue par le navigateur de la page.
const timeIn = (zone: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

test('choisir son fuseau horaire ; un collègue voit l\'heure qu\'il est chez soi en survolant son nom', async ({ browser }) => {
  const [first, second] = [await browser.newContext({ timezoneId: 'Europe/Paris' }), await browser.newContext({ timezoneId: 'America/Montreal' })];
  contexts.push(first, second);
  const a = await first.newPage();
  const b = await second.newPage();
  await joinOffice(a, 'Aiko');
  await joinOffice(b, 'Bastien');

  // Par défaut, l'heure de Paris.
  let menu = await openMeMenu(a);
  await expect(menu.getByRole('menuitem', { name: /^Fuseau horaire : Paris, \d\d:\d\d$/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Fuseau horaire/ }).click();
  const editor = a.getByRole('dialog', { name: 'Fuseau horaire' });
  // Sans accent ni majuscule.
  await editor.getByRole('searchbox').fill('japon');
  await editor.getByRole('list', { name: 'Fuseaux horaires' }).getByRole('button', { name: /^Tokyo, Japon/ }).click();
  await expect(editor).toBeHidden();
  menu = a.getByRole('menu', { name: 'Menu de mon profil' });
  await expect(menu.getByRole('menuitem', { name: /^Fuseau horaire : Tokyo, \d\d:\d\d$/ })).toBeVisible();
  await a.keyboard.press('Escape');

  // Le collègue survole son nom : la carte dit l'heure de Tokyo, et l'écart avec la sienne (lui est resté à Paris).
  const people = await openPanel(b, 'Personnes');
  await people.locator('.person', { hasText: 'Aiko' }).hover();
  const card = b.getByRole('tooltip');
  await expect(card).toContainText('Chez Aiko');
  await expect(card).toContainText('Tokyo, Japon');
  await expect(card).toContainText(/d'avance sur toi/);
  await expect.poll(async () => (await card.textContent()) ?? '').toContain(timeIn('Asia/Tokyo'));

  // Au clavier aussi : le focus d'une ligne montre la carte, Échap la ferme sans fermer le panneau.
  await people.locator('.person', { hasText: 'Bastien' }).focus();
  await expect(b.getByRole('tooltip')).toContainText('Chez toi');
  await b.keyboard.press('Escape');
  await expect(b.getByRole('tooltip')).toHaveCount(0);
  await expect(people).toBeVisible();
});
