import { AsyncLocalStorage } from 'node:async_hooks';

// Le compte dont un admin demande le lien de mot de passe (MAILER=none). Seule la route de l'admin
// (POST /api/admin/members/:id/reset-link) ouvre ce contexte, autour de son appel à requestPasswordReset. Sans e-mail, Better Auth
// ne livre un lien (sendResetPassword, auth.ts) que dans ce contexte, et pour cette adresse : la route publique
// /api/auth/request-password-reset, que tout le monde peut appeler, ne fait rien partir ni rien garder.
export const resetLinkContext = new AsyncLocalStorage<{ email: string }>();
