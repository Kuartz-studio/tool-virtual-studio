import type { ActivityState, Status } from '../protocol';

// Qui ne veut pas être invité à une table : une personne en « Ne pas déranger », ou dans un mode qui ferme sa porte (Concentration) ou qui la conduit ailleurs (Sport, une pièce). Le serveur
// refuse l'invitation (`dnd`) ; le client ne propose pas le bouton. Une personne qui passe dans l'un de ces états après avoir été invitée peut encore accepter : c'est elle qui décide.
// `tableRoom` : la clé de la pièce de la table. Un mode dont l'emplacement est cette pièce (un mode « Jeux » qui conduit à la salle de jeu) ne conduit pas « ailleurs » : l'invitation
// l'amène là où il voulait être, elle ne l'arrache à rien.
export function refusesGameInvites(player: { status: Status; activity?: Pick<ActivityState, 'allowEntry' | 'place'> | null }, tableRoom: string | null = null): boolean {
  const place = player.activity?.place;
  const leadsElsewhere = place !== undefined && place !== tableRoom;
  return player.status === 'dnd' || player.activity?.allowEntry === false || leadsElsewhere;
}
