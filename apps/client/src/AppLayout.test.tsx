import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { fr } from './i18n/fr';
import { reloadPage } from './lib/reload';
import { routes } from './router';
import { resetFakeAuth } from './test/fake-auth-client';
import { renderRoute } from './test/render';

vi.mock('./lib/auth-client', () => import('./test/fake-auth-client'));
vi.mock('./lib/reload', () => ({ reloadPage: vi.fn() }));

beforeEach(() => {
  resetFakeAuth();
  vi.mocked(reloadPage).mockClear();
});

// Ce que Vite fait quand un morceau de l'appli chargé à la demande (le jeu, LiveKit) ne vient pas : après un déploiement, ses fichiers
// ont changé de nom, et l'onglet ouvert avant demande les anciens (404).
function chunkFails(): void {
  const payload = new Error('Failed to fetch dynamically imported module');
  const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload });
  act(() => {
    window.dispatchEvent(event);
  });
}

test('un morceau de l\'appli ne se charge plus (vite:preloadError) : « Nouvelle version disponible », et « Recharger » recharge la page', async () => {
  renderRoute('/connexion');
  await screen.findByRole('heading', { level: 1, name: fr.login.title });
  expect(screen.queryByText(fr.app.newVersion)).toBeNull();

  chunkFails();
  chunkFails();
  expect(screen.getAllByText(fr.app.newVersion)).toHaveLength(1);
  expect(screen.getByRole('alert').textContent).toContain(fr.app.newVersion);
  await userEvent.click(screen.getByRole('button', { name: fr.app.reload }));
  expect(reloadPage).toHaveBeenCalledOnce();
});

// Une page qui ne peut pas s'afficher (le jeu chargé à la demande, absent après un déploiement, fait échouer le rendu) : la page
// d'erreur de l'appli, en français, au lieu de celle, en anglais, de React Router.
test('une page qui ne s\'affiche pas : la page d\'erreur de l\'appli, en français, avec « Recharger »', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    function Broken(): never {
      throw new Error('Failed to fetch dynamically imported module: /assets/PhaserGame-ancien.js');
    }
    // La route racine de l'appli, avec cette page à la place des siennes.
    const [root] = routes;
    const page = { path: '/', element: <Broken /> };
    const router = createMemoryRouter([{ element: root!.element, errorElement: root!.errorElement, children: [page] }], { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { level: 1, name: fr.app.error.title })).toBeTruthy();
    expect(screen.getByText(fr.app.error.message)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: fr.app.reload }));
    expect(reloadPage).toHaveBeenCalledOnce();
  } finally {
    consoleError.mockRestore();
  }
});

test('les textes', () => {
  expect(fr.app.newVersion).toBe('Nouvelle version disponible');
  expect(fr.app.reload).toBe('Recharger');
});
