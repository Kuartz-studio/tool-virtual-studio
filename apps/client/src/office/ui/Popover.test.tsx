import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { expect, test, vi } from 'vitest';
import { Popover } from './Popover';

function Harness({ open = true, onClose, placement }: { open?: boolean; onClose: () => void; placement?: 'top-start' | 'top-end' }) {
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
