import { z } from 'zod';
import type { InvitationService } from '../auth/invitations';
import type { Env } from '../env';
import type { Mailer } from '../mail/mailer';

// Une adresse e-mail telle qu'on la saisit : espaces retirés, passée en minuscules (les comptes et les invitations les
// enregistrent ainsi), au plus 254 caractères.
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

// Le lien de l'e-mail d'invitation. La page « Rejoindre » du client lit le jeton dans la requête.
export function invitationLink(env: Pick<Env, 'APP_URL'>, token: string): string {
  return `${env.APP_URL}/rejoindre?token=${encodeURIComponent(token)}`;
}

// Invitation admin sans passer par un admin : la commande admin:invite crée ainsi le premier admin. Elle n'a pas d'admin qui
// invite (invitedBy vaut null, et l'e-mail n'a pas de nom). Si l'e-mail ne peut pas partir, l'erreur remonte et l'invitation
// reste en attente.
export async function inviteAdmin(
  email: string,
  d: { invitations: InvitationService; mailer: Mailer; env: Pick<Env, 'APP_URL'> },
): Promise<{ link: string }> {
  const { invitation, token } = await d.invitations.create({ email, role: 'admin', invitedBy: null });
  const link = invitationLink(d.env, token);
  await d.mailer.sendInvitation({ to: invitation.email, link, invitedBy: null });
  return { link };
}
