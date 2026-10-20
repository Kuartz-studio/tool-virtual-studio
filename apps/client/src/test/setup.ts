import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetPublicConfig } from '../lib/config';

// Sans les globals de Vitest, Testing Library ne démonte pas tout seul ce qu'un test a rendu : on le fait ici.
afterEach(() => {
  cleanup();
  // La configuration du serveur, lue une fois par page (lib/config.ts), ne passe pas d'un test à l'autre.
  resetPublicConfig();
});

// Phaser a besoin d'un vrai canevas (WebGL ou 2D), que happy-dom n'a pas : il plante dès son chargement. Pour les tests qui
// rendent le bureau (OfficePage), le jeu est un composant vide ; la carte elle-même est vérifiée par les tests de bout en bout.
vi.mock('../game/PhaserGame', () => ({ PhaserGame: () => null }));
