import type { ConversationCommand } from '@bureau/shared';
import { useState } from 'react';
import { fr, t } from '../i18n/fr';
import { sendConversationCommand } from '../net/conversation-commands';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { LockIcon, LockOpenIcon } from './icons';
import { useToasts } from './Toasts';

// Le verrou de la conversation, au-dessus de ses vignettes (VideoStrip). Verrouiller garde la conversation telle qu'elle est, pour tous ses
// membres : le serveur les garde ensemble où qu'ils aillent (à plein volume), et personne d'autre n'y entre. Verrouillée, le bouton le dit
// (« Verrouillée par Léa ») et la déverrouille pour tous d'un clic ; « Quitter » en sort seul. Le bouton est une bascule (aria-pressed) dont
// le nom est son texte : « Verrouiller », ou qui l'a verrouillée.
//
// Le serveur fait foi : l'état montré est celui qu'il annonce (`conversation:lock`, au magasin), jamais celui du clic. Une commande refusée
// (plus de conversation, trop de clics, pas de réponse) le dit en message passager. Le bruit du verrou vient de l'annonce, chez tous les
// membres : le clic n'en fait pas un de plus (`data-sfx="none"`).
export function ConversationLockBar({ socket }: { socket: OfficeSocket | null }) {
  const lock = useOfficeStore((state) => state.conversationLock);
  const selfId = useOfficeStore((state) => state.selfId);
  const [busy, setBusy] = useState(false);

  async function run(command: ConversationCommand) {
    setBusy(true);
    const ack = await sendConversationCommand(socket, command);
    setBusy(false);
    if (!ack.ok) useToasts.getState().push({ key: 'conversation-lock', icon: <LockIcon />, text: fr.media.lock.errors[ack.error] });
  }

  const label = lock === null ? fr.media.lock.lock : lock.by.id === selfId ? fr.media.lock.lockedBySelf : t(fr.media.lock.lockedBy, { name: lock.by.name });
  return (
    <div className="dock conversation-lock" role="group" aria-label={fr.media.lock.label}>
      <button
        type="button"
        className="conversation-lock-toggle"
        aria-pressed={lock !== null}
        title={lock === null ? fr.media.lock.lockHint : fr.media.lock.unlockLabel}
        disabled={busy}
        data-sfx="none"
        onClick={() => void run({ type: lock === null ? 'lock' : 'unlock' })}
      >
        {lock === null ? <LockOpenIcon /> : <LockIcon />}
        <span>{label}</span>
      </button>
      {lock !== null && (
        <button type="button" className="conversation-lock-leave" title={fr.media.lock.leaveLabel} disabled={busy} onClick={() => void run({ type: 'leave' })}>
          {fr.media.lock.leave}
        </button>
      )}
    </div>
  );
}
