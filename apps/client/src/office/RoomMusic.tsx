import { DESK_PLACE_PREFIX, placeByKey, type MusicSetPayload } from '@bureau/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useAudioStore } from '../audio/audio-store';
import { SCENE_IDS, type SceneId } from '../audio/catalog';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { VolumeIcon } from './icons';
import { Cover, keepArrows, Switch } from './SoundPopover';
import { IconButton } from './ui/IconButton';
import { Popover } from './ui/Popover';
import { useMusicPlace } from './use-here';

// Le bouton haut-parleur de la puce du lieu : la musique de la pièce où l'on est, que ceux qui y sont règlent pour tous. Il n'existe que dans une pièce qui a une enceinte (la rue,
// la place, la salle client n'en ont pas), et dans un bureau, que pour son propriétaire. Il s'ouvre sur la même grille d'ambiances que le juke-box, plus « Par défaut » (celle que la
// carte donne à la pièce), et un interrupteur : la musique de la pièce. Il ne change rien d'avance : il demande (`local:music`), et la fenêtre montre ce que le serveur annonce.
// Sa note dit, quand on écoute une ambiance choisie dans le panneau Son (son casque), que ce réglage est pour les autres.
export function RoomMusicButton() {
  const key = useMusicPlace();
  const selfId = useOfficeStore((state) => state.selfId);
  const desks = useOfficeStore((state) => state.desks);
  const map = useOfficeStore((state) => state.officeMap);
  const state = useOfficeStore((s) => (key === null ? undefined : s.music[key]));
  const headphones = useAudioStore((s) => s.prefs.scene !== 'auto');
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const groupName = useId();

  // Dans un bureau, son propriétaire seul règle la musique ; ailleurs, tous ceux qui y sont.
  const allowed = key !== null && (!key.startsWith(DESK_PLACE_PREFIX) || (selfId !== null && desks.find((desk) => desk.key === key.slice(DESK_PLACE_PREFIX.length))?.ownerId === selfId));
  // Quitter la pièce (ou ne plus y avoir la main) ferme la fenêtre.
  useEffect(() => {
    if (!allowed) setOpen(false);
  }, [allowed]);
  if (!allowed || key === null) return null;

  const on = state?.on !== false;
  const chosen = state?.scene ?? null;
  const defaultScene = map === null ? undefined : placeByKey(map, key)?.scene;
  const ask = (request: Omit<MusicSetPayload, 'place'>) => emitOnBus(EventBus, 'local:music', { place: key, ...request });

  // Une carte d'ambiance de la grille : son vrai bouton radio (invisible, sur toute la carte), sa pochette, son titre.
  const card = (scene: SceneId) => (
    <label key={scene} className="juke-card" title={`${fr.sound.scenes[scene].mood} · ${fr.sound.scenes[scene].where}`}>
      <input type="radio" className="juke-radio" name={groupName} checked={chosen === scene} onChange={() => ask({ scene })} />
      <span className="juke-art">
        <Cover scene={scene} />
      </span>
      <span className="juke-name">{fr.sound.scenes[scene].title}</span>
    </label>
  );

  return (
    <>
      <IconButton
        ref={anchor}
        label={fr.roomMusic.button}
        small
        tip="bottom"
        className={on ? 'room-music-button' : 'room-music-button is-muted'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
      >
        <VolumeIcon off={!on} />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} placement="bottom-start" label={fr.roomMusic.title} role="dialog">
        <div className="juke room-music" onKeyDown={keepArrows}>
          <div className="juke-head">
            <div className="juke-row">
              <h3 className="juke-title">
                <VolumeIcon off={!on} />
                {fr.roomMusic.title}
              </h3>
              <Switch checked={on} label={fr.roomMusic.on} onChange={(next) => ask({ on: next })} />
            </div>
          </div>

          <fieldset className={`juke-scenes${on ? '' : ' is-off'}`}>
            <legend className="visually-hidden">{fr.roomMusic.scenes}</legend>
            <label className="juke-auto" title={defaultScene === undefined ? undefined : t(fr.roomMusic.defaultHint, { scene: fr.sound.scenes[defaultScene].title })}>
              <input type="radio" className="juke-radio" name={groupName} checked={chosen === null} onChange={() => ask({ scene: null })} />
              <span className="juke-auto-text">
                <span className="juke-name">{fr.roomMusic.default}</span>
                {defaultScene !== undefined && <small>{fr.sound.scenes[defaultScene].title}</small>}
              </span>
              {defaultScene !== undefined && (
                <span className="juke-art">
                  <Cover scene={defaultScene} />
                </span>
              )}
            </label>
            <div className="juke-grid">{SCENE_IDS.map(card)}</div>
          </fieldset>

          {state?.by && <p className="room-music-by">{t(fr.roomMusic.by, { name: state.by.name })}</p>}
          {headphones && <p className="room-music-note">{fr.roomMusic.headphones}</p>}
        </div>
      </Popover>
    </>
  );
}
