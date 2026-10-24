import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { CloseIcon, FollowIcon } from './icons';

// La pastille de « Suivre », sous la puce du lieu (et sous celle du café, s'il y en a une) : « Tu suis Tom », et une croix pour arrêter (une touche de
// déplacement l'arrête aussi). Elle n'existe que tant que le jeu suit quelqu'un (le magasin : `following`).
export function FollowPill() {
  const name = useOfficeStore((state) => (state.following === null ? undefined : state.players[state.following]?.name));
  if (name === undefined) return null;
  return (
    <div className="follow-pill" role="status">
      <FollowIcon />
      <span>{t(fr.person.following, { name })}</span>
      <button type="button" className="follow-pill-stop" aria-label={fr.person.stop} title={fr.person.stop} data-sfx="click" onClick={() => emitOnBus(EventBus, 'local:follow', { id: null })}>
        <CloseIcon />
      </button>
    </div>
  );
}
