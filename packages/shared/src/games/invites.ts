import type { ActivityState, Status } from '../protocol';

// Qui ne veut pas être invité à une table : une personne en « Ne pas déranger », ou dans un mode qui ferme sa porte (Concentration) ou qui la conduit ailleurs (Sport, une pièce). Le serveur
// refuse l'invitation (`dnd`) ; le client ne propose pas le bouton. Une personne qui passe dans l'un de ces états après avoir été invitée peut encore accepter : c'est elle qui décide.
export function refusesGameInvites(player: { status: Status; activity?: Pick<ActivityState, 'allowEntry' | 'place'> | null }): boolean {
  return player.status === 'dnd' || player.activity?.allowEntry === false || player.activity?.place !== undefined;
}
