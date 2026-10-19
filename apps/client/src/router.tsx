import { Navigate, type RouteObject } from 'react-router';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { JoinPage } from './pages/JoinPage';
import { LoginPage } from './pages/LoginPage';
import { OfficePage } from './pages/OfficePage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { RequireSession } from './RequireSession';

// Les pages de l'appli. main.tsx en fait un routeur du navigateur ; les tests, un routeur en mémoire (test/render.tsx).
// Le serveur renvoie index.html pour chacune de ces adresses (apps/server/src/client-files.ts).
export const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <RequireSession>
        <OfficePage />
      </RequireSession>
    ),
  },
  { path: '/connexion', element: <LoginPage /> },
  // Les liens des e-mails : invitation, puis réinitialisation du mot de passe (après son passage par Better Auth).
  { path: '/rejoindre', element: <JoinPage /> },
  { path: '/mot-de-passe-oublie', element: <ForgotPasswordPage /> },
  { path: '/reinitialiser', element: <ResetPasswordPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
];
