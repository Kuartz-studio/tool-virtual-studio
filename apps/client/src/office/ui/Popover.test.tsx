import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { expect, test, vi } from 'vitest';
import { Popover, placeOver, type PopoverPlacement } from './Popover';

function Harness({ open = true, onClose, placement }: { open?: boolean; onClose: () => void; placement?: PopoverPlacement }) {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchor} type="button">
        Ancre
      </button>
      <p>Ailleurs</p>
      <Popover open={open} onClose={onClose} anchorRef={anchor} placement={placement} label="Plus d'options" role="menu">
        <button type="button" role="menuitem">
          Un
        </button>
      </Popover>
    </>
  );
}

test('fermé, il n\'y a rien dans la page', () => {
  render(<Harness open={false} onClose={() => {}} />);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('ouvert : le rôle est celui que l\'appelant a choisi, le nom est le libellé, et la place est dite', () => {
  render(<Harness onClose={() => {}} placement="top-end" />);
  const menu = screen.getByRole('menu', { name: 'Plus d\'options' });
  expect(menu.getAttribute('data-placement')).toBe('top-end');
  expect(screen.getByRole('menuitem', { name: 'Un' })).toBeTruthy();
});

test('sous l\'ancre (`bottom-start`) : la place est dite, et la fenêtre se pose sous le bouton', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(anchorAt(24) as DOMRect);
  Object.defineProperty(document.documentElement, 'clientWidth', { value: VIEWPORT.width, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: VIEWPORT.height, configurable: true });
  render(<Harness onClose={() => {}} placement="bottom-start" />);
  const menu = screen.getByRole('menu');
  expect(menu.getAttribute('data-placement')).toBe('bottom-start');
  expect(menu.style.top).toBe('754px');
  expect(menu.style.left).toBe('24px');
  expect(menu.style.bottom).toBe('');
  vi.restoreAllMocks();
});

test('par défaut il s\'ouvre en haut, aligné à gauche de l\'ancre', () => {
  render(<Harness onClose={() => {}} />);
  expect(screen.getByRole('menu').getAttribute('data-placement')).toBe('top-start');
});

test('Échap appelle onClose et rend le focus à l\'ancre', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  screen.getByRole('menuitem', { name: 'Un' }).focus();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ancre' }));
});

test('un clic dehors appelle onClose ; un clic dedans, ou sur l\'ancre (qui s\'occupe d\'elle-même), non', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  await user.click(screen.getByRole('menuitem', { name: 'Un' }));
  await user.click(screen.getByRole('button', { name: 'Ancre' }));
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByText('Ailleurs'));
  expect(onClose).toHaveBeenCalledOnce();
});

test('fermé, il n\'écoute plus rien : ni Échap, ni les clics', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Harness open={false} onClose={onClose} />);
  await user.keyboard('{Escape}');
  await user.click(screen.getByText('Ailleurs'));
  expect(onClose).not.toHaveBeenCalled();
});

// Les coordonnées de la page : 1000 × 800, et une ancre de 40 px de large dont le haut est à 700.
const VIEWPORT = { width: 1000, height: 800 };
const anchorAt = (left: number) => ({ left, right: left + 40, top: 700, bottom: 740, width: 40 });

test('placeOver : alignée à gauche ou à droite de l\'ancre, ou centrée sur elle', () => {
  expect(placeOver(anchorAt(300), VIEWPORT, 'top-start', 320)).toEqual({ bottom: 114, left: 300 });
  expect(placeOver(anchorAt(300), VIEWPORT, 'top-end', 320)).toEqual({ bottom: 114, right: 660 });
  // Centrée : le milieu de l'ancre (320), que le CSS ramène à la moitié de la fenêtre.
  expect(placeOver(anchorAt(300), VIEWPORT, 'top', 320)).toEqual({ bottom: 114, left: 320 });
});

test('placeOver : sous l\'ancre (`bottom-start`), alignée sur son bord gauche : le haut de la fenêtre est sous le bas de l\'ancre', () => {
  expect(placeOver(anchorAt(300), VIEWPORT, 'bottom-start', 320)).toEqual({ top: 754, left: 300 });
});

test('placeOver : sous l\'ancre, alignée sur son bord droit (`bottom-end`, le menu « … » d\'une ligne)', () => {
  expect(placeOver(anchorAt(300), VIEWPORT, 'bottom-end', 320)).toEqual({ top: 754, right: 660 });
});

test('placeOver : centrée, la fenêtre ne sort pas de la page', () => {
  // Près du bord gauche : sa moitié (160) et 16 px de marge.
  expect(placeOver(anchorAt(10), VIEWPORT, 'top', 320).left).toBe(176);
  // Près du bord droit : de même.
  expect(placeOver(anchorAt(950), VIEWPORT, 'top', 320).left).toBe(824);
});

// Sur un téléphone (375 px), le bouton de la musique de la pièce est à 88 px du bord gauche : la fenêtre, alignée sur lui, sortait de la page.
test('placeOver : alignée sur le bord gauche de l\'ancre, la fenêtre ne sort pas de la page (marge de 16 px), au-dessus comme au-dessous', () => {
  const phone = { width: 375, height: 812 };
  const anchor = { left: 88, right: 128, top: 16, bottom: 56, width: 40 };
  // 375 − 16 − 340 = 19 : la fenêtre est ramenée vers la gauche.
  expect(placeOver(anchor, phone, 'bottom-start', 340).left).toBe(19);
  expect(placeOver(anchor, phone, 'top-start', 340).left).toBe(19);
  // Elle ne passe pas non plus à gauche de la marge, même si elle est plus large que la page.
  expect(placeOver(anchor, phone, 'bottom-start', 400).left).toBe(16);
  // Assez de place : l'alignement sur l'ancre ne change pas.
  expect(placeOver({ ...anchor, left: 20 }, phone, 'bottom-start', 300).left).toBe(20);
  // Pas encore mesurée (largeur 0) : seule la marge de droite la retient.
  expect(placeOver(anchor, phone, 'bottom-start', 0).left).toBe(88);
  expect(placeOver({ ...anchor, left: 500 }, phone, 'bottom-start', 0).left).toBe(359);
});

test('centrée (`top`), elle dit sa place, et se pose sur le milieu de l\'ancre', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(anchorAt(300) as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);
  Object.defineProperty(document.documentElement, 'clientWidth', { value: VIEWPORT.width, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: VIEWPORT.height, configurable: true });
  render(<Harness onClose={() => {}} placement="top" />);
  const menu = screen.getByRole('menu');
  expect(menu.getAttribute('data-placement')).toBe('top');
  expect(menu.style.left).toBe('320px');
  expect(menu.style.bottom).toBe('114px');
  vi.restoreAllMocks();
});
