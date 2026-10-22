import { buildOfficeTiledMap, buildTiledMap, DEV_OFFICE, parseOfficeMap } from '@bureau/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PlacePicker, wrapLabel } from './PlacePicker';

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

// La mini-carte est petite (la salle de sport y fait une cinquantaine de pixels de large) : un nom plus long que sa pièce passait sous la pièce voisine et se lisait « Salle de spor ».
test('le nom d\'une destination passe sur plusieurs lignes, aucune plus longue que la pièce ne le permet', () => {
  render(<PlacePicker map={office} value={undefined} onChange={() => undefined} />);
  const lines = (name: string) => [...screen.getByRole('button', { name }).querySelectorAll('tspan')].map((line) => line.textContent);
  expect(lines('Salle de sport')).toEqual(['Salle de', 'sport']);
  expect(lines('Salle de jeu')).toEqual(['Salle de', 'jeu']);
});

test('wrapLabel : on coupe aux espaces, une ligne ne dépasse pas la largeur donnée sauf un mot plus long qu\'elle', () => {
  expect(wrapLabel('Salle de sport', 8)).toEqual(['Salle de', 'sport']);
  expect(wrapLabel('Salle de jeu', 8)).toEqual(['Salle de', 'jeu']);
  expect(wrapLabel('Gym', 8)).toEqual(['Gym']);
  expect(wrapLabel('Anticonstitutionnellement', 8)).toEqual(['Anticonstitutionnellement']);
  expect(wrapLabel('Un deux trois quatre', 9)).toEqual(['Un deux', 'trois', 'quatre']);
  expect(wrapLabel('', 8)).toEqual(['']);
});

test('les lignes du nom sont centrées sur leur pièce, l\'une sous l\'autre', () => {
  render(<PlacePicker map={office} value={undefined} onChange={() => undefined} />);
  const button = screen.getByRole('button', { name: 'Salle de sport' });
  const room = button.querySelector('rect')!;
  const centerX = Number(room.getAttribute('x')) + Number(room.getAttribute('width')) / 2;
  const centerY = Number(room.getAttribute('y')) + Number(room.getAttribute('height')) / 2;
  const lines = [...button.querySelectorAll('tspan')];
  expect(lines.map((line) => Number(line.getAttribute('x')))).toEqual([centerX, centerX]);
  const [top, bottom] = lines.map((line) => Number(line.getAttribute('y')));
  expect((top! + bottom!) / 2).toBe(centerY);
  expect(bottom!).toBeGreaterThan(top!);
});
