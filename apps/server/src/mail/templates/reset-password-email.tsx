import { EmailLayout, renderMail, type RenderedMail } from './email-layout';

export const resetPasswordSubject = 'Réinitialiser ton mot de passe';

export interface ResetPasswordEmailProps {
  link: string;
}

export function ResetPasswordEmail({ link }: ResetPasswordEmailProps) {
  return (
    <EmailLayout
      title={resetPasswordSubject}
      body="Clique sur le bouton pour choisir un nouveau mot de passe."
      buttonLabel="Choisir un nouveau mot de passe"
      link={link}
      footer="Si tu n'as rien demandé, ignore cet e-mail."
    />
  );
}

export function renderResetPasswordEmail(props: ResetPasswordEmailProps): Promise<RenderedMail> {
  return renderMail(resetPasswordSubject, <ResetPasswordEmail {...props} />);
}
