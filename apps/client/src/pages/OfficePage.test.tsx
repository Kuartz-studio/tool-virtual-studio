import { screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetFakeAuth, setFakeSession } from '../test/fake-auth-client';
import { renderRoute } from '../test/render';

vi.mock('../lib/auth-client', () => import('../test/fake-auth-client'));
// Le vrai jeu a besoin d'un vrai canevas (voir test/setup.ts) : ici, un composant qui dit quelle carte on lui demande.
vi.mock('../game/PhaserGame', () => ({
  PhaserGame: ({ mapKey }: { mapKey: string }) => <div data-testid="jeu" data-map-key={mapKey} />,
}));

beforeEach(() => {
  resetFakeAuth();
});

test('le bureau monte le jeu avec la carte de développement, et garde le bonjour par-dessus', async () => {
  setFakeSession({ id: 'u-lea', name: 'Léa', email: 'lea@x.fr' });
  renderRoute('/');

  // Le jeu est chargé à part (React.lazy) : il arrive après le bonjour.
  expect((await screen.findByTestId('jeu')).getAttribute('data-map-key')).toBe('dev-office');
  expect(screen.getByText('Bonjour Léa')).toBeTruthy();
});
