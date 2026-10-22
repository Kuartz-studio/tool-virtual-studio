// Les nombres du backgammon. Ce sont des règles du jeu, pas des réglages, mais ils portent un nom : un nombre nu dans un calcul de plateau est la première source de
// bogues (§ 14.7 du document des jeux), et chacun de ceux-ci a un sens qu'un commentaire peut dire.

// Le plateau a 24 points, numérotés de 1 à 24 depuis la maison de chaque joueur.
export const POINT_COUNT = 24;
// Chaque joueur a 15 pions.
export const CHECKERS_PER_SEAT = 15;
// La maison d'un joueur est formée de ses points 1 à 6 : c'est là qu'il doit tout ramener avant de sortir.
export const HOME_SIZE = 6;
// Un dé a six faces.
export const DIE_SIDES = 6;
// On lance deux dés ; un doublé se joue quatre fois.
export const DICE_COUNT = 2;
export const DOUBLET_STEPS = 4;
// La barre est le point 25 de celui à qui sont les pions : un pion qui y est reste à 25 pas de la sortie (la course), et le dé d le fait entrer sur le point 25 − d.
export const BAR_POINT = 25;
// Deux pions adverses (ou plus) sur un point le ferment ; un seul se laisse frapper.
export const BLOCKING_CHECKERS = 2;
// Garde-fou de l'ouverture : on relance les égalités tant qu'il y en a. Avec un vrai générateur, 100 égalités de suite n'arrivent jamais (6⁻¹⁰⁰) ; un générateur
// constant, lui, ferait tourner `create` sans fin, et bloquerait tout le serveur.
export const MAX_OPENING_ROLLS = 100;

// Le départ de chaque joueur, dans sa propre numérotation : point → nombre de pions. Les deux camps se placent de la même façon, chacun vu depuis sa maison.
export const STARTING_LAYOUT: Readonly<Record<number, number>> = { 24: 2, 13: 5, 8: 3, 6: 5 };
