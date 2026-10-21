import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { expect, test, vi } from 'vitest';
import { MicIcon } from '../icons';
import { IconButton } from './IconButton';

test('le nom accessible est le libellé, et l\'infobulle dit la même chose', () => {
  render(
    <IconButton label="Micro" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  const button = screen.getByRole('button', { name: 'Micro' });
  expect(button.getAttribute('aria-label')).toBe('Micro');
  expect(button.getAttribute('data-tip')).toBe('Micro');
  // Pas de title : l'infobulle de l'interface remplace celle du navigateur (deux infobulles se superposeraient).
  expect(button.hasAttribute('title')).toBe(false);
  expect(button.getAttribute('type')).toBe('button');
});

test('pressed : aria-pressed suit la valeur ; sans pressed, le bouton n\'est pas une bascule', () => {
  const { rerender } = render(
    <IconButton label="Micro" pressed onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: 'Micro' }).getAttribute('aria-pressed')).toBe('true');
  rerender(
    <IconButton label="Micro" pressed={false} onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: 'Micro' }).getAttribute('aria-pressed')).toBe('false');
  rerender(
    <IconButton label="Micro" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: 'Micro' }).hasAttribute('aria-pressed')).toBe(false);
});

test('badge : la pastille est affichée (décorative), et le nom accessible reste celui que donne l\'appelant', () => {
  render(
    <IconButton label="Chat, 2 nouveaux messages" badge="2" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  const button = screen.getByRole('button', { name: 'Chat, 2 nouveaux messages' });
  const badge = button.querySelector('.icon-badge');
  expect(badge?.textContent).toBe('2');
  expect(badge?.getAttribute('aria-hidden')).toBe('true');
});

test('sans badge, pas de pastille', () => {
  render(
    <IconButton label="Chat" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: 'Chat' }).querySelector('.icon-badge')).toBeNull();
});

test('count : un petit compteur discret, décoratif lui aussi', () => {
  render(
    <IconButton label="Personnes" count={7} onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  const count = screen.getByRole('button', { name: 'Personnes' }).querySelector('.icon-count');
  expect(count?.textContent).toBe('7');
  expect(count?.getAttribute('aria-hidden')).toBe('true');
});

test('tone : danger et accent donnent leur classe, la teinte par défaut aucune', () => {
  const { rerender } = render(
    <IconButton label="Micro" tone="danger" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: 'Micro' }).classList.contains('is-danger')).toBe(true);
  rerender(
    <IconButton label="Micro" tone="accent" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  const button = screen.getByRole('button', { name: 'Micro' });
  expect(button.classList.contains('is-accent')).toBe(true);
  expect(button.classList.contains('is-danger')).toBe(false);
  rerender(
    <IconButton label="Micro" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  const plain = screen.getByRole('button', { name: 'Micro' });
  expect(plain.classList.contains('is-danger')).toBe(false);
  expect(plain.classList.contains('is-accent')).toBe(false);
});

test('shortcut : la touche est un <kbd> dans l\'infobulle ; hint : la phrase en plus est la description du bouton', () => {
  render(
    <IconButton label="Zoom avant" shortcut="+" hint="Jusqu'à 200 %" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  const button = screen.getByRole('button', { name: 'Zoom avant' });
  expect(button.querySelector('.icon-tip kbd')?.textContent).toBe('+');
  expect(screen.getByRole('button', { name: 'Zoom avant', description: 'Jusqu\'à 200 %' })).toBe(button);
});

test('l\'infobulle n\'est pas lue deux fois : le nom vient de aria-label, le texte de l\'infobulle est caché des lecteurs d\'écran', () => {
  render(
    <IconButton label="Micro" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: 'Micro' }).querySelector('.icon-tip')?.getAttribute('aria-hidden')).toBe('true');
});

test('un clic appelle onClick ; inactif, il ne l\'appelle pas ; la ref donne le bouton', async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  const { rerender } = render(
    <IconButton ref={ref} label="Micro" onClick={onClick}>
      <MicIcon />
    </IconButton>,
  );
  await user.click(screen.getByRole('button', { name: 'Micro' }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(ref.current).toBe(screen.getByRole('button', { name: 'Micro' }));
  rerender(
    <IconButton ref={ref} label="Micro" disabled onClick={onClick}>
      <MicIcon />
    </IconButton>,
  );
  await user.click(screen.getByRole('button', { name: 'Micro' }));
  expect(onClick).toHaveBeenCalledOnce();
});

test('les attributs du motif « bouton de menu » passent au bouton (aria-expanded, aria-controls, aria-haspopup)', () => {
  render(
    <IconButton label="Plus" aria-haspopup="menu" aria-expanded={true} aria-controls="menu-plus" onClick={() => {}}>
      <MicIcon />
    </IconButton>,
  );
  const button = screen.getByRole('button', { name: 'Plus' });
  expect(button.getAttribute('aria-haspopup')).toBe('menu');
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(button.getAttribute('aria-controls')).toBe('menu-plus');
});
