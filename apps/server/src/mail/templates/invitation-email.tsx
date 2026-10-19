import { EmailLayout, renderMail, type RenderedMail } from './email-layout';

export const invitationSubject = 'Invitation au bureau virtuel';

export interface InvitationEmailProps {
  link: string;
  /** Nom affiché de l'admin qui invite ; null quand l'invitation vient de la commande admin:invite. */
  invitedBy: string | null;
}

export function InvitationEmail({ link, invitedBy }: InvitationEmailProps) {
  // Un nom vide ou blanc ferait une phrase qui commence par une espace : on passe alors à la phrase sans nom.
  const inviter = invitedBy?.trim();
  return (
    <EmailLayout
      title={invitationSubject}
      body={
        inviter
          ? `${inviter} t'invite à rejoindre le bureau virtuel de l'équipe.`
          : "Une invitation t'attend pour rejoindre le bureau virtuel de l'équipe."
      }
      buttonLabel="Créer mon compte"
      link={link}
      // Doit rester égal à INVITATION_TTL_MS (@bureau/shared) : mailer.test.ts le vérifie.
      footer="Ce lien est valable 7 jours."
    />
  );
}

export function renderInvitationEmail(props: InvitationEmailProps): Promise<RenderedMail> {
  return renderMail(invitationSubject, <InvitationEmail {...props} />);
}
