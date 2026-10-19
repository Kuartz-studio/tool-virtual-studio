import type { ClientToServerEvents, ServerToClientEvents } from '@bureau/shared';
import { io, type Socket } from 'socket.io-client';

// La connexion temps réel au bureau, typée par le protocole (paquet partagé).
export type OfficeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Ouvre (plus tard : autoConnect false) la connexion temps réel à la même origine que la page, sur /socket.io : le serveur l'y sert,
// et Vite l'y relaie en développement. Le cookie de session part avec la poignée de main : c'est lui qui dit qui se connecte.
// - autoConnect: false : les écouteurs (connectOffice) sont posés avant le premier message, puis on appelle socket.connect() ;
// - forceNew : une connexion à elle, que socket.disconnect() ferme vraiment (socket.io-client partage sinon le gestionnaire de
//   connexion d'une même adresse, et le garderait en mémoire) ;
// - withCredentials : les cookies partent aussi avec le transport de secours (des requêtes HTTP), même s'il fallait un jour
//   changer d'origine.
export function createOfficeSocket(): OfficeSocket {
  return io({ autoConnect: false, forceNew: true, withCredentials: true });
}
