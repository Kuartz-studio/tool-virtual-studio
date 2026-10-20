import { Resend } from 'resend';
import { renderInvitationEmail } from './templates/invitation-email';
import { createResetLinkStore, type ResetLinkStore } from './reset-link-store';
import { renderResetPasswordEmail } from './templates/reset-password-email';

// Les deux méthodes rejettent la promesse quand l'e-mail n'a pas pu partir.
export interface Mailer {
  /** `link` est l'adresse du bouton ; `invitedBy`, le nom affiché de l'admin, ou null quand l'invitation vient de la commande. */
  sendInvitation(i: { to: string; link: string; invitedBy: string | null }): Promise<void>;
  sendPasswordReset(i: { to: string; link: string }): Promise<void>;
}

// Un e-mail tel que le mailer l'a composé : `html` et `text` sont ce que Resend reçoit, `link` l'adresse du bouton.
export interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  link: string;
}

// Les deux mailers passent par ce même chemin : le rendu des modèles est identique, seule la remise de l'e-mail change.
// Ce que le mailer en mémoire garde en test est donc exactement ce que Resend envoie.
function createMailer(deliver: (mail: SentMail) => Promise<void>): Mailer {
  return {
    async sendInvitation({ to, link, invitedBy }) {
      await deliver({ to, link, ...(await renderInvitationEmail({ link, invitedBy })) });
    },
    async sendPasswordReset({ to, link }) {
      await deliver({ to, link, ...(await renderResetPasswordEmail({ link })) });
    },
  };
}

export type MemoryMailer = Mailer & { sent: SentMail[]; last(to?: string): SentMail | undefined };

// Le mailer en mémoire, reconnu à sa méthode `last` : seul lui garde les e-mails envoyés.
export function isMemoryMailer(mailer: Mailer): mailer is MemoryMailer {
  return typeof (mailer as Partial<MemoryMailer>).last === 'function';
}

// Développement et tests : rien ne part, les e-mails restent dans `sent`. `onSend` voit passer chaque e-mail
// (le serveur de développement s'en sert pour journaliser l'objet et le lien).
export function createMemoryMailer(o: { onSend?: (mail: SentMail) => void } = {}): MemoryMailer {
  const sent: SentMail[] = [];
  const mailer = createMailer(async (mail) => {
    sent.push(mail);
    o.onSend?.(mail);
  });
  return {
    ...mailer,
    sent,
    // Le dernier e-mail envoyé, éventuellement à ce destinataire. Les adresses se comparent sans tenir compte de la casse :
    // les comptes et les invitations les enregistrent en minuscules, alors qu'un test peut les écrire autrement.
    last(to) {
      if (to === undefined) return sent.at(-1);
      const wanted = to.toLowerCase();
      return sent.filter((mail) => mail.to.toLowerCase() === wanted).at(-1);
    },
  };
}

export type NoneMailer = Mailer & { resetLinks: ResetLinkStore };

// Le mailer sans e-mail (MAILER=none), reconnu à sa réserve de liens.
export function isNoneMailer(mailer: Mailer): mailer is NoneMailer {
  return typeof (mailer as Partial<NoneMailer>).resetLinks?.take === 'function';
}

// MAILER=none : aucun e-mail ne part, et rien n'est rendu ni envoyé nulle part. Les liens d'invitation sont donnés à l'admin par
// les routes admin (admin-routes.ts) et par la commande admin:invite, qui ne passent pas par `sendInvitation` : il ne fait rien.
// Le lien d'un mot de passe oublié, lui, est créé par Better Auth, qui le confie à `sendPasswordReset` : le mailer le garde dans
// une petite réserve en mémoire (reset-link-store.ts) que la route de l'admin vide aussitôt. Rien n'est écrit dans le journal : le
// jeton du lien ouvre le compte.
export function createNoneMailer(o: { resetLinks?: ResetLinkStore } = {}): NoneMailer {
  const resetLinks = o.resetLinks ?? createResetLinkStore();
  return {
    async sendInvitation() {},
    async sendPasswordReset({ to, link }) {
      resetLinks.put(to, link);
    },
    resetLinks,
  };
}

// Production : envoi par Resend. L'envoi échoue (la promesse est rejetée) quand Resend refuse l'e-mail.
export function createResendMailer(o: { apiKey: string; from: string }): Mailer {
  const resend = new Resend(o.apiKey);
  return createMailer(async (mail) => {
    // Le SDK ne lève pas d'exception quand l'API refuse l'e-mail : il renvoie { data: null, error }.
    const { error } = await resend.emails.send({ from: o.from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
    if (error) {
      // Le message finit dans les journaux : il n'ajoute ni le lien (son jeton ouvre un compte) ni l'adresse du destinataire.
      throw new Error(`Resend n'a pas envoyé l'e-mail « ${mail.subject} » (${error.name}) : ${error.message}`, { cause: error });
    }
  });
}
