import type { MediaJoinPayload, MediaState } from '@bureau/shared';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { mediaDebug } from '../game/debug';
import { EventBus } from '../game/EventBus';
import { emitOnBus } from '../net/office-connection';
import type { OfficeSocket } from '../net/socket';
import { createSpeakingReporter } from '../net/speaking-reporter';
import { useOfficeStore } from '../state/office-store';
import type { MediaClient, MediaSnapshot } from './media-client';

// Relie le client média à la connexion au bureau, et rend son état (à jour à chaque changement) :
// - les consignes du serveur : media:join → client.join, media:leave → client.leave. Et session:replaced (un autre onglet a pris la
//   place) → client.leave : le serveur ne dira plus rien à cet onglet, qui garderait sinon micro et caméra ouverts ;
// - au montage, la dernière consigne reçue avant lui, s'il y en a une : la page ouvre la connexion à « Entrer », et monte ce hook
//   dans le même rendu, mais par sûreté (une consigne qui arriverait avant ses écouteurs) : le serveur ne redit pas une consigne. La
//   connexion la retient (mediaInstruction, au magasin), il la rejoue ;
// - l'état local part au serveur (media:state), qui le montre à tous : au montage, après chaque init (le serveur ne retient l'état
//   qu'une fois la personne placée, et l'oublie quand elle revient après le délai de grâce), puis à chaque changement, jamais deux fois
//   le même de suite, et rien pendant une coupure (l'init du retour le renverra) ;
// - qui parle part au jeu, sur le bus (media:speaking), à chaque changement ;
// - ma propre parole part au serveur (speaking:set, via le reporter : délais, battement), qui la montre à tout le bureau, même loin de moi et
//   hors de ma conversation : la bulle au-dessus de l'avatar ;
// - la room va dans window.__office.media.room, pour les tests de bout en bout (mediaDebug).
// Démonté (ou pour un autre client), il quitte la room : c'est lui qui y faisait entrer. Une autre socket, en revanche, ne fait pas
// quitter la room : après son init, le serveur redira la même consigne, qui ne coupera rien.
//
// client et socket doivent garder la même identité d'un rendu à l'autre (créés une fois par la page).
export function useMedia(client: MediaClient, socket: OfficeSocket | null): MediaSnapshot {
  const subscribe = useCallback((notify: () => void) => client.subscribe(() => notify()), [client]);
  const snapshot = useSyncExternalStore(subscribe, () => client.getSnapshot());

  // Les consignes du serveur.
  useEffect(() => {
    if (!socket) return;
    const join = (p: MediaJoinPayload) => void client.join(p);
    const leave = () => void client.leave();
    const missed = useOfficeStore.getState().mediaInstruction;
    if (missed?.type === 'join') join(missed.p);
    else if (missed?.type === 'leave') leave();
    socket.on('media:join', join);
    socket.on('media:leave', leave);
    socket.on('session:replaced', leave);
    return () => {
      socket.off('media:join', join);
      socket.off('media:leave', leave);
      socket.off('session:replaced', leave);
    };
  }, [client, socket]);

  // L'état local, au serveur.
  useEffect(() => {
    if (!socket) return;
    // Le dernier état envoyé sur cette connexion ; oublié à chaque init (le serveur a pu repartir de zéro).
    let sent: MediaState | null = null;
    const send = () => {
      if (!socket.connected) return;
      const { local } = client.getSnapshot();
      if (sent !== null && sameMediaState(sent, local)) return;
      sent = { mic: local.mic, cam: local.cam, screen: local.screen };
      socket.emit('media:state', sent);
    };
    const onInit = () => {
      sent = null;
      send();
    };
    socket.on('init', onInit);
    const unsubscribe = client.subscribe(send);
    return () => {
      socket.off('init', onInit);
      unsubscribe();
    };
  }, [client, socket]);

  // Qui parle, au jeu ; la room, aux tests de bout en bout.
  useEffect(() => {
    let speaking: string[] = [];
    const unsubscribe = client.subscribe((s) => {
      mediaDebug.room = s.room;
      const now = s.participants.filter((p) => p.speaking).map((p) => p.id);
      if (sameIds(now, speaking)) return;
      speaking = now;
      emitOnBus(EventBus, 'media:speaking', now);
    });
    return () => {
      unsubscribe();
      mediaDebug.room = null;
      if (speaking.length > 0) emitOnBus(EventBus, 'media:speaking', []);
    };
  }, [client]);

  // Ma parole, au serveur. Il ne reçoit rien d'une connexion coupée : le battement du reporter redit « je parle » à son retour.
  useEffect(() => {
    if (!socket) return;
    const reporter = createSpeakingReporter((mine) => {
      if (socket.connected) socket.emit('speaking:set', mine);
    });
    // `forced` : window.__office.media.speak (tests de bout en bout) fait parler l'avatar local sans voix dans une room.
    let forced = false;
    const feed = (s: MediaSnapshot) => reporter.feed(forced || s.participants.some((p) => p.isLocal && p.speaking));
    mediaDebug.speak = (on) => {
      forced = on;
      // Comme si la room entendait l'avatar local : sa bulle s'allume tout de suite, sans attendre le serveur.
      const { selfId } = useOfficeStore.getState();
      emitOnBus(EventBus, 'media:speaking', on && selfId !== null ? [selfId] : []);
      feed(client.getSnapshot());
    };
    feed(client.getSnapshot());
    const unsubscribe = client.subscribe(feed);
    return () => {
      unsubscribe();
      mediaDebug.speak = () => {};
      reporter.stop();
    };
  }, [client, socket]);

  // Le bureau est ouvert : on charge livekit-client maintenant, pour que la première conversation ne l'attende pas.
  useEffect(() => {
    client.warmUp?.();
  }, [client]);

  // Démonté, ou un autre client : celui-ci quitte sa room.
  useEffect(() => () => void client.leave(), [client]);

  return snapshot;
}

function sameMediaState(a: MediaState, b: MediaState): boolean {
  return a.mic === b.mic && a.cam === b.cam && a.screen === b.screen;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
