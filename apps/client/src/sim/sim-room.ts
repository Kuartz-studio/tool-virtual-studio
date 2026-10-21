import type { SimRoomPayload } from '@bureau/shared';

// Qui est dans la room où l'on est, et quel son ils « disent » : le dernier `sim:room` du serveur (office-connection.ts), que le faux
// transport (sim-transport.ts) lit en rejoignant sa room et suit ensuite. Le serveur envoie ce message avec, ou juste avant, le
// media:join de la room : le message peut arriver avant que le transport existe. Il est donc retenu ici, y compris quand on quitte
// la room : le serveur ne redit pas un message qu'il a déjà envoyé à cette connexion.
let latest: SimRoomPayload | null = null;
const listeners = new Set<(p: SimRoomPayload) => void>();

export function setSimRoom(p: SimRoomPayload): void {
  latest = p;
  for (const listener of [...listeners]) listener(p);
}

// Le dernier message reçu, ou null. Pas forcément celui de la room en cours : l'appelant compare les rooms.
export function getSimRoom(): SimRoomPayload | null {
  return latest;
}

// Appelle cb à chaque message à venir (pas pour celui d'avant). Rend la fonction qui arrête.
export function subscribeSimRoom(cb: (p: SimRoomPayload) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// La connexion au serveur est tombée (office-connection.ts) : le serveur ne dira plus rien, et ni media:leave ni un autre media:join ne
// viendront. Le faux transport quitte alors sa room, comme LiveKit quand il perd la sienne : sans cela, les sons des personnes
// fictives tourneraient en boucle dans la page tant qu'elle reste ouverte (serveur arrêté, redémarré, planté).
const lostListeners = new Set<() => void>();

export function simConnectionLost(): void {
  for (const listener of [...lostListeners]) listener();
}

export function subscribeSimConnectionLost(cb: () => void): () => void {
  lostListeners.add(cb);
  return () => {
    lostListeners.delete(cb);
  };
}

// Oublie le dernier message (les tests ; et une connexion neuve, qui en recevra un autre).
export function resetSimRoom(): void {
  latest = null;
}
