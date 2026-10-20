import { useCallback, useSyncExternalStore } from 'react';
import type { OfficeSocket } from './socket';

// La connexion au bureau est-elle ouverte ? (socket.connected, que les événements `connect` et `disconnect` font changer.) Faux sans
// socket. Pour griser ce qui enverrait un message au serveur : Socket.io garde les messages d'une socket coupée et les envoie au
// retour, mais le serveur n'écoute personne avant la fin de l'arrivée (l'`init`), et les ignore.
export function useSocketConnected(socket: OfficeSocket | null): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!socket) return () => {};
      socket.on('connect', notify);
      socket.on('disconnect', notify);
      return () => {
        socket.off('connect', notify);
        socket.off('disconnect', notify);
      };
    },
    [socket],
  );
  return useSyncExternalStore(subscribe, () => socket?.connected ?? false);
}
