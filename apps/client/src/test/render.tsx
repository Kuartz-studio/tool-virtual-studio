import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../router';

// Rend l'appli complète (le vrai routeur) à cette adresse, avec un historique en mémoire. Le routeur renvoyé dit où l'on
// est après une navigation : router.state.location.
export function renderRoute(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  return router;
}
