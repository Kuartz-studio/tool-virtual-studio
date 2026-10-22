import { buildOfficeTiledMap, buildTiledMap, DEV_OFFICE, parseOfficeMap } from '@bureau/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PlacePicker } from './PlacePicker';

const office = parseOfficeMap(buildOfficeTiledMap());
const small = parseOfficeMap(buildTiledMap({ ...DEV_OFFICE, tileset: { name: 'dev', image: 'tiles.png' } }));

const pieces = () => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

test('une mini-carte : un bouton par destination de la carte (la salle de sport, la salle de jeu), et aucun pour les autres pièces', () => {
  render(<PlacePicker map={office} value={undefined} onChange={() => undefined} />);
  expect(pieces().sort()).toEqual(['Salle de jeu', 'Salle de sport']);
});

test('l\'emplacement choisi est enfoncé, les autres non', () => {
  render(<PlacePicker map={office} value="gym" onChange={() => undefined} />);
  expect(screen.getByRole('button', { name: 'Salle de sport' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Salle de jeu' }).getAttribute('aria-pressed')).toBe('false');
});

test('un clic choisit la pièce ; un clic sur celle qui est choisie la retire (aucun emplacement : on ne bouge pas)', async () => {
  const onChange = vi.fn();
  const { rerender } = render(<PlacePicker map={office} value={undefined} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Salle de sport' }));
  expect(onChange).toHaveBeenLastCalledWith('gym');
  rerender(<PlacePicker map={office} value="gym" onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Salle de sport' }));
  expect(onChange).toHaveBeenLastCalledWith(undefined);
  await userEvent.click(screen.getByRole('button', { name: 'Salle de jeu' }));
  expect(onChange).toHaveBeenLastCalledWith('game');
});

test('au clavier : Entrée et Espace choisissent, comme un clic', async () => {
  const onChange = vi.fn();
  render(<PlacePicker map={office} value={undefined} onChange={onChange} />);
  screen.getByRole('button', { name: 'Salle de jeu' }).focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.keyboard(' ');
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenCalledWith('game');
});

test('sans carte, ou sur une carte sans destination (celle des tests) : rien à choisir', () => {
  const { container, rerender } = render(<PlacePicker map={null} value={undefined} onChange={() => undefined} />);
  expect(container.firstChild).toBeNull();
  rerender(<PlacePicker map={small} value={undefined} onChange={() => undefined} />);
  expect(container.firstChild).toBeNull();
});

test('un emplacement que la carte n\'a plus (une clé périmée) : aucun bouton n\'est enfoncé, et on peut en choisir un autre', async () => {
  const onChange = vi.fn();
  render(<PlacePicker map={office} value="piscine-disparue" onChange={onChange} />);
  expect(screen.getAllByRole('button').every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Salle de sport' }));
  expect(onChange).toHaveBeenCalledWith('gym');
});
