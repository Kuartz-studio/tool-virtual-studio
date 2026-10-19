import { createAuthClient } from 'better-auth/react';

// Le client de Better Auth : connexion, déconnexion, session, mot de passe oublié. Le serveur le monte sur /api/auth, à la
// même origine que la page (Vite relaie /api en développement).
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
});
