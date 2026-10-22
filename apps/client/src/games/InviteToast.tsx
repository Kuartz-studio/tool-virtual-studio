import { useEffect } from 'react';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { sendGameCommand } from '../net/game-commands';
import { listenOnBus } from '../net/office-connection';
import type { OfficeSocket } from '../net/socket';
import { GamepadIcon } from '../office/icons';
import { useToasts } from '../office/Toasts';
import { useOfficeStore } from '../state/office-store';

// Le préfixe de la clé d'un toast d'invitation : `invite:<identifiant>`.
export const INVITE_TOAST = 'invite:';

// Les invitations à une table (celles que dit le magasin) et les avis de leurs réponses, par la file de toasts :
// - une invitation reçue : « Bastien t'invite aux échecs », qui reste le temps qu'il lui reste à vivre (60 s de départ), avec « Accepter » et « Refuser ». Accepter répond au serveur,
//   qui téléporte près de la table et assoit (ou fait regarder) ; le panneau de la table s'ouvre alors. Le toast disparaît à la réponse, à l'expiration, ou quand le serveur
//   retire l'invitation (l'invitante s'est levée) ;
// - la réponse à ses propres invitations (acceptée, refusée, restée sans réponse, ou l'invitée a quitté le bureau) : un toast de quelques secondes.
export function useGameToasts(socket: OfficeSocket | null): void {
  const invites = useOfficeStore((state) => state.gameInvites);

  useEffect(() => {
    const { push, dismiss, items } = useToasts.getState();
    const waiting = new Set(invites.map((invite) => `${INVITE_TOAST}${invite.id}`));
    for (const item of items) if (item.id.startsWith(INVITE_TOAST) && !waiting.has(item.id)) dismiss(item.id);
    for (const invite of invites) {
      const key = `${INVITE_TOAST}${invite.id}`;
      if (items.some((item) => item.id === key)) continue;
      const answer = async (accept: boolean) => {
        useOfficeStore.getState().removeGameInvite(invite.id);
        const ack = await sendGameCommand(socket, { type: 'answer', invite: invite.id, accept });
        if (ack.ok && accept) useOfficeStore.getState().openGame(invite.game);
        else if (!ack.ok && ack.error !== 'stale') useToasts.getState().push({ key: `${INVITE_TOAST}refused`, icon: <GamepadIcon />, text: fr.games.errors[ack.error] });
      };
      push({
        key,
        icon: <GamepadIcon />,
        avatarKey: invite.from.avatarKey,
        name: invite.from.name,
        text: t(fr.games.invitation, { name: invite.from.name, game: fr.games.invitedTo[invite.game] }),
        // Le serveur dit ce qu'il reste à vivre à l'invitation (le magasin en fait une échéance) : le toast part avec elle.
        ttl: Math.max(0, invite.until - performance.now()),
        actions: [
          { label: fr.games.accept, ariaLabel: t(fr.games.acceptLabel, { name: invite.from.name }), onClick: () => void answer(true) },
          { label: fr.games.decline, ariaLabel: t(fr.games.declineLabel, { name: invite.from.name }), onClick: () => void answer(false) },
        ],
      });
    }
  }, [invites, socket]);

  // Une invitation dont le temps est écoulé (son toast s'est éteint de lui-même) : le magasin ne la garde pas non plus. L'échéance est absolue : une autre invitation qui arrive ne
  // lui rend pas du temps.
  useEffect(() => {
    const timers = invites.map((invite) => setTimeout(() => useOfficeStore.getState().removeGameInvite(invite.id), Math.max(0, invite.until - performance.now())));
    return () => timers.forEach(clearTimeout);
  }, [invites]);

  useEffect(
    () =>
      listenOnBus(EventBus, 'game:notice', (notice) => {
        useToasts.getState().push({
          key: `${INVITE_TOAST}notice:${notice.user.id}`,
          icon: <GamepadIcon />,
          avatarKey: useOfficeStore.getState().players[notice.user.id]?.avatarKey ?? null,
          name: notice.user.name,
          text: t(fr.games.notice[notice.kind], { name: notice.user.name, game: fr.games.names[notice.game] }),
        });
      }),
    [],
  );
}
