import type { ActivityInput } from '../protocol';

// Les modes par défaut, que chaque compte reçoit à sa création (la migration 0010 les a donnés aux comptes qui existaient déjà). Ce sont des modes comme ceux
// qu'on crée, à soi, en base : on les modifie et on les supprime de la même façon. « Disponible » n'en est pas un : c'est l'absence de mode, la première ligne
// du menu, qui ne se modifie ni ne se supprime. Leurs couleurs évitent celles des statuts (vert, orange, gris, rouge), qu'on ne les confonde pas.
// - Manger : on n'entend ni n'est entendu, la porte reste ouverte ;
// - Sport : de même, et le serveur vous conduit à la salle de sport (`place`), puis vous ramène au bureau quand vous en sortez ;
// - Concentration : la porte du bureau se ferme, le reste ne change pas (on entend, on est entendu).
export const DEFAULT_MODES: readonly ActivityInput[] = [
  { label: 'Manger', color: '#ec4899', icon: 'utensils', allowEntry: true, hear: false, heard: false },
  { label: 'Sport', color: '#f97316', icon: 'dumbbell', allowEntry: true, hear: false, heard: false, place: 'gym' },
  { label: 'Concentration', color: '#6d28d9', icon: 'headphones', allowEntry: false, hear: true, heard: true },
];
