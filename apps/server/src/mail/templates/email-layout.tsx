import type { CSSProperties, ReactElement } from 'react';
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text, render, toPlainText } from 'react-email';

// Les deux e-mails (invitation, réinitialisation) ont la même forme : un titre, une phrase, un bouton, un pied de page.
// La mise en page vit ici, une seule fois ; chaque modèle n'apporte que ses textes.
export interface EmailLayoutProps {
  /** Titre de l'e-mail, identique à son objet. */
  title: string;
  /** La phrase au-dessus du bouton. Elle sert aussi d'aperçu dans la boîte de réception. */
  body: string;
  buttonLabel: string;
  /** Adresse du bouton. */
  link: string;
  footer: string;
}

// Styles en ligne : les clients de messagerie ignorent la plupart des feuilles de style. Ni rem, ni flex, ni media query.
// Contraste des textes sur fond blanc (WCAG AA : 4,5 au moins) : titre 17,7 ; phrase 10,4 ; pied de page 4,8 ; bouton 17,7.
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const styles = {
  page: { backgroundColor: '#f4f4f5', fontFamily: FONT_FAMILY, margin: 0, padding: '32px 16px' },
  card: { backgroundColor: '#ffffff', borderRadius: '8px', margin: '0 auto', maxWidth: '480px', padding: '32px' },
  title: { color: '#18181b', fontSize: '22px', fontWeight: 600, lineHeight: '28px', margin: '0 0 16px' },
  paragraph: { color: '#3f3f46', fontSize: '16px', lineHeight: '24px', margin: '0 0 24px' },
  button: {
    backgroundColor: '#18181b',
    borderRadius: '6px',
    boxSizing: 'border-box',
    color: '#ffffff',
    display: 'block',
    fontSize: '16px',
    fontWeight: 600,
    lineHeight: '24px',
    padding: '12px 20px',
    textAlign: 'center',
    textDecoration: 'none',
  },
  rule: { margin: '32px 0 16px' },
  footer: { color: '#71717a', fontSize: '13px', lineHeight: '20px', margin: 0 },
} satisfies Record<string, CSSProperties>;

export function EmailLayout({ title, body, buttonLabel, link, footer }: EmailLayoutProps) {
  // Html et Body déclarent chacun leur langue (« en » par défaut) : sans lang="fr" sur Body, le contenu serait lu en anglais.
  return (
    <Html lang="fr">
      <Head>
        <title>{title}</title>
      </Head>
      <Body lang="fr" style={styles.page}>
        {/* Par défaut, Preview écrit son texte dans <title> ; le titre du document est déjà celui de l'e-mail. */}
        <Preview useTitleTag={false}>{body}</Preview>
        <Container style={styles.card}>
          <Heading as="h1" style={styles.title}>
            {title}
          </Heading>
          <Text style={styles.paragraph}>{body}</Text>
          <Button href={link} style={styles.button}>
            {buttonLabel}
          </Button>
          <Hr style={styles.rule} />
          <Text style={styles.footer}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

// Le texte brut est tiré du HTML déjà rendu : les deux versions disent toujours la même chose.
// html-to-text met les titres en capitales par défaut ; on garde les mots de l'objet tels qu'ils sont écrits.
const PLAIN_TEXT_OPTIONS = { selectors: [{ selector: 'h1', options: { uppercase: false } }] };

export async function renderMail(subject: string, email: ReactElement): Promise<RenderedMail> {
  const html = await render(email);
  return { subject, html, text: toPlainText(html, PLAIN_TEXT_OPTIONS) };
}
