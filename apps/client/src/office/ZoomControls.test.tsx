import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { DEFAULT_ZOOM_LEVEL, MAX_ZOOM_LEVEL } from '../game/zoom';
import { fr } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { ZoomControls } from './ZoomControls';

beforeEach(() => {
  act(() => useOfficeStore.getState().reset());
});

const level = () => useOfficeStore.getState().zoomLevel;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

test('au départ : 100 %, et on peut aller plus près comme plus loin', () => {
  render(<ZoomControls />);
  expect(button(fr.zoom.reset).textContent).toBe('100 %');
  expect(button(fr.zoom.in).disabled).toBe(false);
  expect(button(fr.zoom.out).disabled).toBe(false);
});

test('+ rapproche jusqu\'à 200 %, où il s\'éteint ; − éloigne jusqu\'à 25 %, où il s\'éteint', async () => {
  const user = userEvent.setup();
  render(<ZoomControls />);
  await user.click(button(fr.zoom.in));
  expect(button(fr.zoom.reset).textContent).toBe('200 %');
  expect(button(fr.zoom.in).disabled).toBe(true);
  expect(level()).toBe(MAX_ZOOM_LEVEL);

  await user.click(button(fr.zoom.reset));
  expect(level()).toBe(DEFAULT_ZOOM_LEVEL);

  await user.click(button(fr.zoom.out));
  await user.click(button(fr.zoom.out));
  expect(button(fr.zoom.reset).textContent).toBe('25 %');
  expect(button(fr.zoom.out).disabled).toBe(true);
});

test('le niveau vient du magasin : un changement venu d\'ailleurs (molette, clavier) se voit', () => {
  render(<ZoomControls />);
  act(() => useOfficeStore.getState().stepZoom(-1));
  expect(button(fr.zoom.reset).textContent).toBe('50 %');
});
