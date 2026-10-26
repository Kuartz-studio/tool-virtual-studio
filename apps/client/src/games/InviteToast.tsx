import { GAME_INVITE_TTL_MS } from '@bureau/shared';
import { useEffect, useRef } from 'react';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { sendGameCommand } from '../net/game-commands';
import { listenOnBus } from '../net/office-connection';
import type { OfficeSocket } from '../net/socket';
import { GamepadIcon } from '../office/icons';
import { useToasts } from '../office/Toasts';
import { useOfficeStore } from '../state/office-store';
import { listOf, rematchAskers } from './table-view';

// Le préfixe de la clé d'un toast d'invitation : `invite:<identifiant>`.
export const INVITE_TOAST = 'invite:';
// Le préfixe de la clé d'un toast de revanche : `rematch:<jeu>:<partie>` (et `rematch:refused`, le refus du serveur).
export const REMATCH_TOAST = 'rematch:';

// Les invitations à une table (celles que dit le magasin), les avis de leurs réponses et les revanches qu'on attend de soi, par la file de toasts :
// - une invitation reçue : « Bastien t'invite aux échecs », qui reste le temps qu'il lui reste à vivre (60 s de départ), avec « Accepter » et « Refuser ». Accepter répond au serveur,
//   qui téléporte près de la table et assoit (ou fait regarder) ; le panneau de la table s'ouvre alors. Le toast disparaît à la réponse, à l'expiration, ou quand le serveur
//   retire l'invitation (l'invitante s'est levée) ;
// - la réponse à ses propres invitations (acceptée, refusée, restée sans réponse, ou l'invitée a quitté le bureau) : un toast de quelques secondes ;
// - assis à une table dont la partie est finie, panneau fermé : quelqu'un d'autre a demandé la revanche, « Bastien veut la revanche aux échecs », avec « Revanche » (on l'accepte,
//   et le panneau s'ouvre) et « Plus tard ». Une fois par partie ; le toast part quand la revanche ne tient plus ou qu'on ouvre le panneau, sinon au bout de 60 s.
export function useGameToasts(socket: OfficeSocket | null): void {
  const invites = useOfficeStore((state) => state.gameInvites);
  const games = useOfficeStore((state) => state.games);
  const gameOpen = useOfficeStore((state) => state.gameOpen);
  const selfId = useOfficeStore((state) => state.selfId);
  // Les revanches déjà dites, par clé : chacune une seule fois, même écartée ou éteinte (une table qui change de nouveau ne la redit pas).
  const toldRematches = useRef(new Set<string>());

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

  useEffect(() => {
    const { push, dismiss, items } = useToasts.getState();
    const wanted = new Set<string>();
    for (const view of Object.values(games)) {
      const askers = rematchAskers(view, selfId);
      if (!view?.match || askers.length === 0 || view.game === gameOpen) continue;
      const key = `${REMATCH_TOAST}${view.game}:${view.match.id}`;
      wanted.add(key);
      if (toldRematches.current.has(key)) continue;
      toldRematches.current.add(key);
      const game = view.game;
      const names = listOf(askers.map((asker) => asker.name));
      const accept = async () => {
        useToasts.getState().dismiss(key);
        useOfficeStore.getState().openGame(game);
        const ack = await sendGameCommand(socket, { type: 'ready', game, ready: true });
        if (!ack.ok && ack.error !== 'stale') useToasts.getState().push({ key: `${REMATCH_TOAST}refused`, icon: <GamepadIcon />, text: fr.games.errors[ack.error] });
      };
      push({
        key,
        icon: <GamepadIcon />,
        avatarKey: askers[0]!.avatarKey,
        name: askers[0]!.name,
        text: t(askers.length > 1 ? fr.games.rematch.toastMany : fr.games.rematch.toast, { names, game: fr.games.invitedTo[game] }),
        ttl: GAME_INVITE_TTL_MS,
        actions: [
          { label: fr.games.actions.rematch, ariaLabel: t(fr.games.rematch.acceptLabel, { names }), onClick: () => void accept() },
          { label: fr.games.rematch.later, onClick: () => useToasts.getState().dismiss(key) },
        ],
      });
    }
    // Une revanche qui ne tient plus (la partie suivante a commencé, la demande est retirée, on s'est levé) ou dont on a ouvert le panneau : son toast part.
    for (const item of items) if (item.id.startsWith(REMATCH_TOAST) && item.id !== `${REMATCH_TOAST}refused` && !wanted.has(item.id)) dismiss(item.id);
  }, [games, gameOpen, selfId, socket]);

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
