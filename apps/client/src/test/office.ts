import { screen, within } from '@testing-library/react';
import { fr } from '../i18n/fr';

// Le bureau est affiché pour cette personne : son nom est dans la barre du bas. Renvoie l'élément qui le porte.
export async function findOfficeFor(name: string): Promise<HTMLElement> {
  const bar = await screen.findByRole('group', { name: fr.office.barLabel });
  return within(bar).getByText(name);
}
