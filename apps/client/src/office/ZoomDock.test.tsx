import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { DEFAULT_ZOOM_LEVEL, MAX_ZOOM_LEVEL } from '../game/zoom';
import { fr } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { ZoomDock } from './ZoomDock';

beforeEach(() => {
  act(() => useOfficeStore.getState().reset());
});

const level = () => useOfficeStore.getState().zoomLevel;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

test('deux boutons dans un groupe « Zoom » : plus loin, puis plus près ; au départ on peut aller dans les deux sens', () => {
  render(<ZoomDock />);
  const group = screen.getByRole('group', { name: fr.zoom.group });
  expect([...group.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([fr.zoom.out, fr.zoom.in]);
  expect(button(fr.zoom.in).disabled).toBe(false);
  expect(button(fr.zoom.out).disabled).toBe(false);
  expect(level()).toBe(DEFAULT_ZOOM_LEVEL);
});

test('+ rapproche jusqu\'à 200 %, où il s\'éteint ; − éloigne jusqu\'à 25 %, où il s\'éteint', async () => {
  const user = userEvent.setup();
  render(<ZoomDock />);
  await user.click(button(fr.zoom.in));
  expect(level()).toBe(MAX_ZOOM_LEVEL);
  expect(button(fr.zoom.in).disabled).toBe(true);

  act(() => useOfficeStore.getState().resetZoom());
  await user.click(button(fr.zoom.out));
  await user.click(button(fr.zoom.out));
  expect(level()).toBe(0);
  expect(button(fr.zoom.out).disabled).toBe(true);
});

test('le niveau vient du magasin : un changement venu d\'ailleurs (molette, clavier) s\'y voit', () => {
  render(<ZoomDock />);
  act(() => useOfficeStore.getState().stepZoom(1));
  expect(button(fr.zoom.in).disabled).toBe(true);
  act(() => useOfficeStore.getState().resetZoom());
  expect(button(fr.zoom.in).disabled).toBe(false);
});

test('les touches du clavier sont dites dans l\'infobulle', () => {
  render(<ZoomDock />);
  expect(button(fr.zoom.in).querySelector('.icon-tip kbd')?.textContent).toBe('+');
  expect(button(fr.zoom.out).querySelector('.icon-tip kbd')?.textContent).toBe('−');
});
