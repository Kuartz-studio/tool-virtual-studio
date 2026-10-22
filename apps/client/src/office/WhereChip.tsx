import { fr, t } from '../i18n/fr';
import { PlaceIcon } from './icons';
import { RoomMusicButton } from './RoomMusic';
import { usePeopleHere } from './use-here';
import { AvatarPortrait } from './ui/AvatarPortrait';

// Combien de portraits la puce montre : au-delà, « +N ».
const PORTRAITS = 3;

// La puce en haut à gauche : le nom du lieu où l'on est (`place`, que la coque suit : OfficeShell), et jusqu'à trois portraits de ceux qui y sont,
// puis « +N », et le bouton haut-parleur de la musique de la pièce quand on peut la régler (RoomMusicButton). Sans carte (le jeu n'est pas encore là :
// `place` est nul), rien.
export function WhereChip({ place }: { place: string | null }) {
  const here = usePeopleHere(place);
  if (place === null) return null;
  const extra = here.length - PORTRAITS;
  return (
    <div className="dock dock-where" role="group" aria-label={fr.office.where.label}>
      <PlaceIcon />
      <span className="where-name">{place}</span>
      {here.length > 0 && (
        <span className="where-stack">
          {here.slice(0, PORTRAITS).map((player) => (
            <AvatarPortrait key={player.id} avatarKey={player.avatarKey} name={player.name} size={22} />
          ))}
          {extra > 0 && (
            <em className="where-more" aria-hidden="true">
              +{extra}
            </em>
          )}
          <span className="visually-hidden">{here.length === 1 ? fr.office.where.onePerson : t(fr.office.where.manyPeople, { count: here.length })}</span>
        </span>
      )}
      <RoomMusicButton />
    </div>
  );
}
