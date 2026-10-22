import { SPEAKING_HEARTBEAT_MS } from '@bureau/shared';

// Ce qu'il faut de parole continue pour dire « je parle » au serveur, et de silence continu pour dire « je me tais » : un bruit d'un instant
// n'allume pas la bulle, une respiration entre deux phrases ne l'éteint pas.
export const SPEAKING_ON_DELAY_MS = 150;
export const SPEAKING_OFF_DELAY_MS = 700;

export interface SpeakingReporter {
  // Ce que la détection dit à l'instant : on parle, ou non. À appeler à chaque changement de l'état de la room (aussi souvent qu'il change :
  // redire la même chose ne repousse aucun délai).
  feed(speaking: boolean): void;
  // Plus rien à dire : si l'on parlait, « je me tais » part tout de suite ; plus aucun délai ni battement ensuite.
  stop(): void;
}

// Transforme la détection de parole de l'audio (qui sautille d'un mot à l'autre) en messages au serveur (`speaking:set`) :
// - « je parle » part après SPEAKING_ON_DELAY_MS de parole continue, « je me tais » après SPEAKING_OFF_DELAY_MS de silence continu ;
// - tant que « je parle » est vrai, il est redit toutes les SPEAKING_HEARTBEAT_MS : le serveur éteint seul la bulle d'une personne dont il n'a
//   plus de nouvelles (SPEAKING_TTL_MS), si le client plante ou si un message se perd.
// `send` ne fait rien d'une connexion coupée (l'appelant le sait) : le battement redit « je parle » dès qu'elle est revenue.
export function createSpeakingReporter(send: (speaking: boolean) => void): SpeakingReporter {
  // Ce que le serveur croit, d'après ce qu'on lui a dit.
  let reported = false;
  let stopped = false;
  // L'allumage ou l'extinction en attente de son délai : au plus un, toujours vers la dernière valeur reçue.
  let pending: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const cancelPending = () => {
    clearTimeout(pending);
    pending = undefined;
  };

  const report = (speaking: boolean) => {
    reported = speaking;
    clearInterval(heartbeat);
    heartbeat = speaking ? setInterval(() => send(true), SPEAKING_HEARTBEAT_MS) : undefined;
    send(speaking);
  };

  return {
    feed(speaking) {
      if (stopped) return;
      // Déjà dit : un changement en attente en sens contraire est annulé (un silence court, un bruit d'un instant).
      if (speaking === reported) {
        cancelPending();
        return;
      }
      // Le changement vers cette valeur attend déjà son délai : redire la même chose ne le repousse pas.
      if (pending !== undefined) return;
      pending = setTimeout(
        () => {
          pending = undefined;
          report(speaking);
        },
        speaking ? SPEAKING_ON_DELAY_MS : SPEAKING_OFF_DELAY_MS,
      );
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelPending();
      clearInterval(heartbeat);
      heartbeat = undefined;
      if (reported) {
        reported = false;
        send(false);
      }
    },
  };
}
