import { CLIENT_MOVE_MAX_HZ, type Direction, type MovePayload } from '@bureau/shared';

// Le délai après lequel un arrêt est renvoyé une fois (voir MoveSender).
export const STOP_RESEND_MS = 500;

// L'état de l'avatar local tel que le serveur le reçoit : ses pieds en pixels entiers, arrondis vers le bas, jamais au plus proche.
// Le serveur place des pieds dans la case floor(x / 32), floor(y / 32) : un entier arrondi vers le bas reste dans la case des vrais
// pieds. Au plus proche, des pieds en y = 479,6 (contre le mur du bas, qui commence en 480) deviendraient 480 : dans le mur, et le
// `move` serait refusé.
export function feetPayload(x: number, y: number, dir: Direction, moving: boolean): MovePayload {
  return { x: Math.floor(x), y: Math.floor(y), dir, moving };
}

// Décide, à chaque image, si l'état de l'avatar local part au serveur (`move`). Les règles :
// - un changement de direction ou de marche part tout de suite (l'arrêt aussi) ;
// - sinon, en marche, une position qui a changé part si 1000 / maxHz ms se sont écoulées depuis le dernier envoi : 10 fois par
//   seconde au plus ;
// - jamais deux charges utiles identiques à la suite : à l'arrêt, ou en marche contre un mur (la position ne change pas), rien ne
//   part ;
// - une seule exception : un arrêt est renvoyé une fois, STOP_RESEND_MS après, si aucun nouvel état n'est parti entre-temps.
//   L'arrêt compte pour les autres (fin de la marche à l'écran, groupes de conversation « à l'arrêt ») : s'il s'est perdu (un
//   `move` de trop, que la limite de débit du serveur a ignoré) ou si le tick qui le portait n'est pas arrivé (`world:tick` est
//   volatile), le renvoi le rattrape.
//
// `now` est en millisecondes, sur l'horloge de l'appelant ; les états sont des entiers (LocalPlayer.movePayload).
export class MoveSender {
  private last: MovePayload | null = null;
  private lastSentAt = 0;
  // L'heure à partir de laquelle le dernier arrêt envoyé repart, ou null : rien à renvoyer.
  private stopResendAt: number | null = null;

  constructor(private readonly maxHz: number = CLIENT_MOVE_MAX_HZ) {}

  // L'état à envoyer maintenant (une copie), ou null.
  next(now: number, s: MovePayload): MovePayload | null {
    const last = this.last;
    if (last === null || s.dir !== last.dir || s.moving !== last.moving) return this.send(now, s);

    const samePlace = s.x === last.x && s.y === last.y;
    if (s.moving && !samePlace && now - this.lastSentAt >= 1000 / this.maxHz) return this.send(now, s);

    if (!s.moving && samePlace && this.stopResendAt !== null && now >= this.stopResendAt) {
      this.stopResendAt = null;
      this.lastSentAt = now;
      return { ...s };
    }
    return null;
  }

  // Oublie le dernier envoi : le prochain état part tout de suite, même s'il est identique. À appeler quand l'avatar a été posé
  // ailleurs que là où il a marché (un `move:correct`, un `init`, une téléportation) : le serveur doit relire son état.
  reset(): void {
    this.last = null;
    this.stopResendAt = null;
  }

  private send(now: number, s: MovePayload): MovePayload {
    this.last = { ...s };
    this.lastSentAt = now;
    this.stopResendAt = s.moving ? null : now + STOP_RESEND_MS;
    return { ...s };
  }
}
