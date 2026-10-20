import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fr } from '../i18n/fr';

// Le bureau est affiché pour cette personne : son nom est dans la barre du bas. Renvoie l'élément qui le porte.
export async function findOfficeFor(name: string): Promise<HTMLElement> {
  const bar = await screen.findByRole('group', { name: fr.office.barLabel });
  return within(bar).getByText(name);
}

// La page du bureau s'ouvre sur l'écran d'entrée : « Entrer » (« Entrer quand même » sans micro ni caméra, comme dans happy-dom, qui
// n'en a pas), puis le bureau s'affiche pour cette personne. Renvoie l'élément qui porte son nom.
export async function enterOffice(name: string): Promise<HTMLElement> {
  const enter = await screen.findByRole('button', { name: new RegExp(`^(${fr.media.check.enter}|${fr.media.check.enterAnyway})$`) });
  await userEvent.click(enter);
  return findOfficeFor(name);
}
