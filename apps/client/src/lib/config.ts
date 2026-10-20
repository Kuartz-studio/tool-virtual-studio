import { MAIL_MODES, type MailMode, type PublicConfig } from '@bureau/shared';
import { useEffect, useState } from 'react';
import { api } from './api';

// La configuration publique du serveur (GET /api/config, sans session) : comment les liens d'invitation et de mot de passe parviennent
// aux gens. Lue une seule fois par chargement de la page ; tant qu'elle manque ou si la lecture échoue, les pages gardent leur
// comportement d'avant (celui des e-mails) : une panne de /api/config ne ferme rien.
let loading: Promise<PublicConfig | null> | null = null;
let loaded: PublicConfig | null = null;

function isPublicConfig(body: unknown): body is PublicConfig {
  const mail = (body as { mail?: unknown } | null | undefined)?.mail;
  return typeof body === 'object' && body !== null && (MAIL_MODES as readonly unknown[]).includes(mail);
}

// null si la lecture échoue (serveur injoignable ou en panne, corps inattendu). Un échec n'est pas gardé : la demande suivante
// (la page rouverte) réessaie ; une lecture réussie l'est pour toute la page.
export function loadPublicConfig(): Promise<PublicConfig | null> {
  loading ??= api<unknown>('/api/config').then(
    (body) => {
      if (!isPublicConfig(body)) {
        loading = null;
        return null;
      }
      loaded = { mail: body.mail };
      return loaded;
    },
    () => {
      loading = null;
      return null;
    },
  );
  return loading;
}

// Pour les tests : oublie la configuration lue.
export function resetPublicConfig(): void {
  loading = null;
  loaded = null;
}

// Le mode d'envoi du serveur, ou null tant qu'il est inconnu (en cours de lecture, ou lecture en échec). `enabled: false` ne lit
// rien : le panneau Admin ne demande la configuration qu'à son ouverture.
export function useMailMode(enabled = true): MailMode | null {
  const [mail, setMail] = useState<MailMode | null>(loaded?.mail ?? null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void loadPublicConfig().then((config) => {
      if (current) setMail(config?.mail ?? null);
    });
    return () => {
      current = false;
    };
  }, [enabled]);
  return mail;
}
