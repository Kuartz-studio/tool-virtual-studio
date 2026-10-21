import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Drawer } from './Drawer';

test('un panneau nommé par son titre, avec un en-tête (le titre et « Fermer ») et un corps', () => {
  render(
    <Drawer title="Personnes" onClose={() => {}}>
      <p>Le contenu</p>
    </Drawer>,
  );
  const panel = screen.getByRole('complementary', { name: 'Personnes' });
  expect(panel.querySelector('header h2')?.textContent).toBe('Personnes');
  expect(panel.querySelector('.drawer-body')?.textContent).toBe('Le contenu');
  expect(screen.getByRole('button', { name: 'Fermer' })).toBeTruthy();
});

test('le focus va au titre à l\'ouverture ; Fermer et Échap appellent onClose', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <Drawer title="Personnes" onClose={onClose}>
      <p>Le contenu</p>
    </Drawer>,
  );
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Personnes' }));
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('si le contenu a déjà pris le focus (le champ d\'un message), le titre ne le lui reprend pas', () => {
  render(
    <Drawer title="Chat" onClose={() => {}}>
      <input aria-label="Message" autoFocus />
    </Drawer>,
  );
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
});

test('Échap pendant une composition (touche morte, méthode de saisie) l\'annule : il ne ferme pas le panneau', () => {
  const onClose = vi.fn();
  render(
    <Drawer title="Chat" onClose={onClose}>
      <input aria-label="Message" />
    </Drawer>,
  );
  const field = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('une classe de plus pour qui veut un corps à lui (le chat n\'a pas de marge ni de défilement : sa liste défile, son champ reste en bas)', () => {
  render(
    <Drawer title="Chat" className="chat-drawer" onClose={() => {}}>
      <p>Le contenu</p>
    </Drawer>,
  );
  const panel = screen.getByRole('complementary', { name: 'Chat' });
  expect(panel.classList.contains('drawer')).toBe(true);
  expect(panel.classList.contains('chat-drawer')).toBe(true);
});
