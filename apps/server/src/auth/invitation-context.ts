import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@bureau/shared';

// L'invitation en cours d'acceptation. Seule la route d'acceptation (invitation-routes.ts) ouvre ce contexte, autour de
// son appel à signUpEmail, après avoir vérifié le jeton. Le crochet de création d'utilisateur de Better Auth (auth.ts)
// refuse toute création hors de ce contexte, ou pour une autre adresse que celle de l'invitation.
export const invitationContext = new AsyncLocalStorage<{ email: string; role: Role }>();
