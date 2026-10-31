import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { ZOOM_DEFAULT_PERCENT, ZOOM_MAX_PERCENT, ZOOM_MIN_PERCENT } from '../game/zoom';
import { fr } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { ZoomDock } from './ZoomDock';

beforeEach(() => {
  act(() => useOfficeStore.getState().reset());
});

const percent = () => useOfficeStore.getState().zoomPercent;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
// Le pourcentage écrit sur le bouton du milieu (et non son infobulle, qui est dans le même bouton).
const readout = () => button(fr.zoom.reset).querySelector('.zoom-value')?.textContent;

test('trois boutons dans un groupe « Zoom » : plus loin, le pourcentage (qui le rétablit), plus près ; au départ on peut aller dans les deux sens', () => {
  render(<ZoomDock />);
  const group = screen.getByRole('group', { name: fr.zoom.group });
  expect([...group.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([fr.zoom.out, fr.zoom.reset, fr.zoom.in]);
  expect(button(fr.zoom.in).disabled).toBe(false);
  expect(button(fr.zoom.out).disabled).toBe(false);
  expect(percent()).toBe(ZOOM_DEFAULT_PERCENT);
});

test('le milieu écrit le pourcentage du moment, et le suit', () => {
  render(<ZoomDock />);
  expect(readout()).toBe('100 %');
  act(() => useOfficeStore.getState().stepZoom(3));
  expect(readout()).toBe('115 %');
  act(() => useOfficeStore.getState().setZoomPercent(ZOOM_MIN_PERCENT));
  expect(readout()).toBe('60 %');
});

test('un clic sur le pourcentage rétablit 100 %', async () => {
  const user = userEvent.setup();
  render(<ZoomDock />);
  act(() => useOfficeStore.getState().setZoomPercent(70));
  await user.click(button(fr.zoom.reset));
  expect(percent()).toBe(ZOOM_DEFAULT_PERCENT);
  expect(readout()).toBe('100 %');
});

test('+ rapproche de 10 % jusqu\'à 200 %, où il s\'éteint ; − éloigne de 10 % jusqu\'à 60 %, où il s\'éteint', async () => {
  const user = userEvent.setup();
  render(<ZoomDock />);
  await user.click(button(fr.zoom.in));
  expect(percent()).toBe(110);
  act(() => useOfficeStore.getState().setZoomPercent(195));
  await user.click(button(fr.zoom.in));
  expect(percent()).toBe(ZOOM_MAX_PERCENT);
  expect(button(fr.zoom.in).disabled).toBe(true);
  expect(button(fr.zoom.out).disabled).toBe(false);

  act(() => useOfficeStore.getState().resetZoom());
  await user.click(button(fr.zoom.out));
  expect(percent()).toBe(90);
  act(() => useOfficeStore.getState().setZoomPercent(70));
  await user.click(button(fr.zoom.out));
  expect(percent()).toBe(ZOOM_MIN_PERCENT);
  expect(button(fr.zoom.out).disabled).toBe(true);
  expect(button(fr.zoom.in).disabled).toBe(false);
});

test('depuis 60 %, + repasse par les dizaines : 70, 80, 90, 100 %', async () => {
  const user = userEvent.setup();
  render(<ZoomDock />);
  act(() => useOfficeStore.getState().setZoomPercent(ZOOM_MIN_PERCENT));
  const seen: number[] = [];
  for (let i = 0; i < 4; i++) {
    await user.click(button(fr.zoom.in));
    seen.push(percent());
  }
  expect(seen).toEqual([70, 80, 90, 100]);
});

test('le niveau vient du magasin : un changement venu d\'ailleurs (molette, clavier) s\'y voit', () => {
  render(<ZoomDock />);
  act(() => useOfficeStore.getState().setZoomPercent(ZOOM_MAX_PERCENT));
  expect(button(fr.zoom.in).disabled).toBe(true);
  act(() => useOfficeStore.getState().resetZoom());
  expect(button(fr.zoom.in).disabled).toBe(false);
});

test('au plancher que le jeu a calculé, − s\'éteint, et le pourcentage s\'écrit arrondi au pour-cent', async () => {
  const user = userEvent.setup();
  render(<ZoomDock />);
  // Le plancher de la vraie carte sur un téléphone de 390 × 844 : 62,8 %.
  act(() => useOfficeStore.getState().setZoomFloor((100 * 844) / 1792 / 0.75));
  act(() => useOfficeStore.getState().setZoomPercent(70));
  await user.click(button(fr.zoom.out));
  expect(readout()).toBe('63 %');
  expect(button(fr.zoom.out).disabled).toBe(true);
  // + repart sur la grille de 10 : 70 %.
  await user.click(button(fr.zoom.in));
  expect(readout()).toBe('70 %');
  expect(button(fr.zoom.out).disabled).toBe(false);
});

test('les touches du clavier sont dites dans l\'infobulle', () => {
  render(<ZoomDock />);
  expect(button(fr.zoom.in).querySelector('.icon-tip kbd')?.textContent).toBe('+');
  expect(button(fr.zoom.out).querySelector('.icon-tip kbd')?.textContent).toBe('−');
  expect(button(fr.zoom.reset).querySelector('.icon-tip kbd')?.textContent).toBe('0');
});
