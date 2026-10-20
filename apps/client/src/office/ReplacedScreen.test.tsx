import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { ReplacedScreen } from './ReplacedScreen';

test('« Ouvert dans un autre onglet », et le bouton « Utiliser ici »', () => {
  render(<ReplacedScreen onUseHere={() => {}} />);
  expect(screen.getByText(fr.office.replaced)).toBeTruthy();
  expect(screen.getByText('Ouvert dans un autre onglet')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Utiliser ici' })).toBeTruthy();
  expect(screen.getByText(fr.office.replacedHint)).toBeTruthy();
});

test('« Utiliser ici » reprend la main : onUseHere', async () => {
  const onUseHere = vi.fn();
  render(<ReplacedScreen onUseHere={onUseHere} />);
  await userEvent.click(screen.getByRole('button', { name: fr.office.useHere }));
  expect(onUseHere).toHaveBeenCalledTimes(1);
});

test('c\'est une boîte de dialogue modale, nommée par son titre : le reste de la page n\'existe plus pour un lecteur d\'écran', () => {
  render(<ReplacedScreen onUseHere={() => {}} />);
  const dialog = screen.getByRole('dialog', { name: fr.office.replaced });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText(fr.office.replacedHint).id);
});

test('le focus est sur le bouton dès l\'affichage : Entrée suffit', async () => {
  const onUseHere = vi.fn();
  render(<ReplacedScreen onUseHere={onUseHere} />);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.office.useHere }));
  await userEvent.keyboard('{Enter}');
  expect(onUseHere).toHaveBeenCalledTimes(1);
});

test('le bouton reste utilisable après un clic : si la reconnexion échoue, on peut réessayer', async () => {
  const onUseHere = vi.fn();
  render(<ReplacedScreen onUseHere={onUseHere} />);
  const button = screen.getByRole('button', { name: fr.office.useHere }) as HTMLButtonElement;
  await userEvent.click(button);
  expect(button.disabled).toBe(false);
  await userEvent.click(button);
  expect(onUseHere).toHaveBeenCalledTimes(2);
});
