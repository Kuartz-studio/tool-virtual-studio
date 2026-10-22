import type { GameEventBase, GameResult } from '@bureau/shared';
import type { ComponentType } from 'react';
import type { SfxId } from '../audio/catalog';

// Le contrat entre la plateforme des jeux (le cadre du panneau, la salle d'attente, le classement) et le module client d'un jeu (son plateau, ses textes, ses sons). Chaque jeu
// donne un `GameUi` par défaut de `games/<jeu>/index.tsx` ; la plateforme le charge à la demande (game-ui.ts) et lui passe ce qu'elle sait de la table.

// Un joueur, tel que le plateau le voit : par siège.
export interface GamePlayerView {
  userId: string;
  name: string;
  avatarKey: string | null;
  connected: boolean;
}

export interface GameBoardProps<S, M, E> {
  // L'état du jeu (celui des règles, `GameDefinition<S, …>`).
  state: S;
  // Son siège ; null : il regarde, ou c'est l'aperçu d'avant la première partie (rien n'est sélectionnable).
  mySeat: number | null;
  // Les joueurs, par siège.
  players: GamePlayerView[];
  // Ce que le dernier changement de la partie a provoqué, à animer ; [] après un saut d'état (le panneau s'ouvre, la connexion revient, un message a été manqué) : le plateau
  // passe alors tout de suite au nouvel état, sans animer.
  events: E[];
  // C'est à lui de jouer, et aucun coup n'attend la réponse du serveur.
  canAct: boolean;
  // Le coup choisi : la plateforme l'envoie au serveur, avec la version de la table.
  onMove(move: M): void;
  // L'utilisateur demande moins de mouvement (prefers-reduced-motion) : aucune animation menée en JavaScript, l'état final tout de suite.
  reducedMotion: boolean;
  // Avant la première partie d'une table : le plateau de départ, rien n'est cliquable.
  preview: boolean;
}

export interface GameUi<S, M, E extends GameEventBase> {
  Board: ComponentType<GameBoardProps<S, M, E>>;
  // Le nom et la couleur d'un siège (« Blancs », « #f2ead8 ») : la pastille de la ligne du joueur.
  seatLabel(seat: number, state: S): { name: string; color: string };
  // La fin d'une partie, pour les raisons que le jeu écrit lui-même (« Échec et mat », « Gammon »…) ; celles de la plateforme (abandon, délai, départ, accord) sont écrites par elle.
  describeResult(result: GameResult, names: string[], state: S): string;
  // Une phrase pour le lecteur d'écran à propos de ces événements, ou rien.
  announce(events: E[], state: S, names: string[]): string | null;
  // Les effets sonores de ce lot d'événements, dans l'ordre (« dice », « piece »). Le plateau n'appelle jamais le moteur audio lui-même.
  sounds(events: E[], mySeat: number | null): SfxId[];
  // L'aide « Règles » du panneau : de quatre à huit phrases courtes.
  rules: string[];
}

export type AnyGameUi = GameUi<unknown, unknown, GameEventBase>;
