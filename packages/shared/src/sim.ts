// Le faux live, pour les essais en local (SIM=1 côté serveur, VITE_SIM=1 côté client ; `pnpm dev:sim`). Des personnes fictives, sans
// compte, se promènent dans le vrai monde du serveur : ses groupes, ses zones, ses délais s'appliquent à elles comme à tout le monde.
// À la place de LiveKit, le serveur donne un faux jeton, et le client joue en boucle le fichier audio de chaque fictive de sa room.
// Le serveur refuse SIM=1 en production. Ce fichier ne dépend de rien : le client et le serveur y lisent les mêmes valeurs.

// Le début de l'identifiant d'une personne fictive : aucun compte réel n'en a un (les identifiants de Better Auth sont aléatoires).
export const SIM_BOT_PREFIX = 'sim-';

export function isSimBot(id: string): boolean {
  return id.startsWith(SIM_BOT_PREFIX);
}

// L'adresse que le faux backend donne dans media:join, à la place de celle de LiveKit : le client sait ainsi, à l'adresse seule, qu'il
// n'y a pas de LiveKit derrière.
export const SIM_MEDIA_URL = 'sim://local';

// La vitesse de marche d'une personne fictive, en pixels par seconde : sous WALK_SPEED_PX_PER_S (320), la vitesse d'une vraie personne
// au clavier, pour que le serveur accepte ses pas avec de la marge.
export const SIM_BOT_SPEED_PX_PER_S = 110;

// Les fichiers audio que l'on peut attribuer à une personne fictive : un nom simple (lettres, chiffres, espaces, ., (), +, -, _), sans
// chemin ni point au début, et l'une de ces extensions. Le serveur vérifie ce nom avant de lire ou d'écrire un fichier.
export const SIM_AUDIO_FILE = /^[\p{L}\p{N}_][\p{L}\p{N}_ .()+-]{0,120}\.(mp3|wav|ogg|m4a|aac|flac|webm)$/iu;
export const SIM_AUDIO_MAX_BYTES = 40 * 1024 * 1024;

export function isSimAudioFile(name: string): boolean {
  return SIM_AUDIO_FILE.test(name) && !name.includes('..');
}

// Une personne de la room, telle que le client la rejoue : audio est l'adresse du fichier qu'elle « dit » en boucle, ou null (une vraie
// personne, ou une fictive sans fichier : silence).
export interface SimRoomMember {
  id: string;
  name: string;
  audio: string | null;
}

// Qui est dans une room, avec leur son : le serveur le dit à chaque personne réelle de la room (`sim:room`), à chaque changement.
// Dans LiveKit, c'est la room elle-même qui le sait ; ici, le serveur.
export interface SimRoomPayload {
  room: string;
  members: SimRoomMember[];
}

// Le faux jeton de media:join : l'identité et le nom de la personne, et la room. Du texte lisible, rien de secret : il ne donne accès
// à rien (le son vient du serveur, par une session).
export interface SimToken {
  room: string;
  identity: string;
  name: string;
}

export function encodeSimToken(t: SimToken): string {
  return encodeURIComponent(JSON.stringify(t));
}

// null si le jeton n'est pas un faux jeton valable.
export function decodeSimToken(token: string): SimToken | null {
  try {
    const t: unknown = JSON.parse(decodeURIComponent(token));
    if (typeof t !== 'object' || t === null) return null;
    const { room, identity, name } = t as Record<string, unknown>;
    if (typeof room !== 'string' || typeof identity !== 'string' || typeof name !== 'string') return null;
    return { room, identity, name };
  } catch {
    return null;
  }
}
