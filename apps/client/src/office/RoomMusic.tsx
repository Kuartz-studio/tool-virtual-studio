import { DESK_PLACE_PREFIX, isOutside, roomSceneOf, type MusicSetPayload, type OfficeMap, type RoomMusic } from '@bureau/shared';
import { useEffect, useRef, useState, type Ref } from 'react';
import { useAudioStore } from '../audio/audio-store';
import type { SceneId } from '../audio/catalog';
import { soundAt } from '../audio/scene-at';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { LockIcon, UsersIcon, VolumeIcon } from './icons';
import { keepArrows, MusicCard, MusicPicker, sceneNote, Switch, useMusicPicking } from './Music';
import { IconButton } from './ui/IconButton';
import { Popover } from './ui/Popover';
import { useFeetValue, useMusicPlace, usePlace } from './use-here';

// La musique de la pièce où l'on est : la même pour tous ceux qui y sont, réglée par eux (le serveur la garde et l'annonce : `music:changed`). Ce module la
// montre et la change, à deux endroits qui ont la même carte : le juke-box du dock (SoundPopover, onglet « La pièce ») et le bouton haut-parleur de la puce
// du lieu (RoomMusicButton). Rien n'y change d'avance : on demande (`local:music`), et la carte montre ce que le serveur annonce.

export interface RoomMusicView {
  // La pièce où l'on règle la musique (elle a une enceinte : `game`, `desk:A1`) ; null là où il n'y en a pas (la rue, la place).
  key: string | null;
  // Le nom du lieu, tel que la puce l'écrit (« Café », « Bureau d'Alice »).
  place: string;
  // La musique que la carte donne à l'endroit, et ce qu'il joue : celle qu'on y a réglée, ou null s'il est éteint.
  defaultScene: SceneId;
  scene: SceneId | null;
  // Le réglage de la pièce (undefined : personne n'y a touché).
  state: RoomMusic | undefined;
  // Peut-on la changer ? Sinon, pourquoi, en clair.
  allowed: boolean;
  reason: string | null;
  ask(request: Omit<MusicSetPayload, 'place'>): void;
}

// L'ambiance par défaut de l'endroit où sont les pieds, et s'ils sont dehors (le jardin, une terrasse : pas d'enceinte, la musique s'y tait).
const readScene = (x: number, y: number, map: OfficeMap): SceneId => soundAt(map, x, y).scene;
const readOutside = (x: number, y: number, map: OfficeMap): boolean => isOutside(map, x, y);

// Ce qu'on sait de la musique de l'endroit où l'on est, et ce qu'on y peut ; null sans carte (le jeu n'est pas encore là). Partout où il y a une enceinte on
// peut la changer, sauf dans le bureau d'un autre (son propriétaire seul y touche) ou dans un bureau libre (personne).
export function useRoomMusic(): RoomMusicView | null {
  const key = useMusicPlace();
  const defaultScene = useFeetValue(readScene);
  const outside = useFeetValue(readOutside) === true;
  const place = usePlace();
  const selfId = useOfficeStore((s) => s.selfId);
  const desks = useOfficeStore((s) => s.desks);
  const state = useOfficeStore((s) => (key === null ? undefined : s.music[key]));
  if (defaultScene === null) return null;

  // Dans un bureau : son propriétaire (null : le bureau est libre).
  const deskKey = key?.startsWith(DESK_PLACE_PREFIX) ? key.slice(DESK_PLACE_PREFIX.length) : null;
  const owner = deskKey === null ? null : (desks.find((desk) => desk.key === deskKey) ?? null);
  const ownerId = owner?.ownerId ?? null;
  const allowed = key !== null && (deskKey === null || (ownerId !== null && ownerId === selfId));
  let reason: string | null = null;
  if (key === null) reason = outside ? fr.roomMusic.locked.outside : fr.roomMusic.locked.noSpeaker;
  else if (!allowed) reason = ownerId === null ? fr.roomMusic.locked.freeDesk : t(fr.roomMusic.locked.desk, { name: owner?.ownerName ?? '' });

  return {
    key,
    place: place ?? '',
    defaultScene,
    scene: key === null ? (outside ? null : defaultScene) : roomSceneOf({ scene: defaultScene, music: true }, state),
    state,
    allowed,
    reason,
    ask: (request) => {
      if (key !== null) emitOnBus(EventBus, 'local:music', { place: key, ...request });
    },
  };
}

// La carte « Musique de la pièce » : pour tout le monde ici, sa vignette et son nom ; là où on peut la changer, la vignette ouvre la liste (`onChange`), et
// l'interrupteur l'allume ou la coupe pour tous, avec qui l'a réglée en dernier. Ailleurs, la carte ne fait que montrer, et dit pourquoi.
// `heard` : est-ce elle qu'on entend (on n'écoute pas sa propre musique) ? Son égaliseur bouge alors.
export function RoomMusicCard({ view, heard, onChange, changeRef }: { view: RoomMusicView; heard: boolean; onChange(): void; changeRef?: Ref<HTMLButtonElement> }) {
  const playing = useAudioStore((s) => s.playing);
  const on = view.state?.on !== false;
  const chosen = view.state?.scene ?? null;
  const note = view.scene === null ? fr.roomMusic.offNote : chosen === null || view.key === null ? fr.roomMusic.default : sceneNote(chosen);
  return (
    <MusicCard
      icon={<UsersIcon />}
      title={fr.roomMusic.title}
      audience={t(fr.roomMusic.audience, { place: view.place })}
      scene={view.scene}
      offTitle={fr.roomMusic.off}
      note={note}
      playing={heard && view.scene !== null && playing === view.scene}
      change={view.allowed ? { label: fr.roomMusic.change, onClick: onChange, buttonRef: changeRef } : undefined}
    >
      {view.allowed ? (
        <>
          <div className="music-card-row">
            <span>{fr.roomMusic.on}</span>
            <Switch checked={on} label={fr.roomMusic.on} onChange={(next) => view.ask({ on: next })} />
          </div>
          {view.state?.by && <p className="music-card-note">{t(fr.roomMusic.by, { name: view.state.by.name })}</p>}
        </>
      ) : (
        <p className="music-card-lock">
          <LockIcon />
          {view.reason}
        </p>
      )}
    </MusicCard>
  );
}

// La liste des musiques de la pièce : « Par défaut de la pièce », puis celles du thème choisi. Choisir une musique dans une pièce éteinte la rallume : on veut
// l'entendre. Ce qui est déjà ainsi ne demande rien.
export function RoomMusicPicker({ view, onBack }: { view: RoomMusicView; onBack(): void }) {
  const playing = useAudioStore((s) => s.playing);
  const on = view.state?.on !== false;
  const chosen = view.state?.scene ?? null;
  return (
    <MusicPicker
      title={fr.roomMusic.title}
      audience={t(fr.roomMusic.audience, { place: view.place })}
      value={chosen}
      defaultScene={view.defaultScene}
      playing={playing}
      onPick={(scene) => {
        if (on && scene === chosen) return;
        view.ask(on ? { scene } : { on: true, scene });
      }}
      onBack={onBack}
    />
  );
}

// Le bouton haut-parleur de la puce du lieu : la musique de la pièce où l'on est, pour ceux qui peuvent la changer (une pièce à enceinte, son propre bureau). Il
// s'ouvre sur la carte de la pièce, la même que dans le juke-box ; sa vignette ouvre la liste. Barré quand la pièce est éteinte. Quand on écoute sa propre
// musique (son casque), la fenêtre rappelle que ce réglage est pour les autres.
export function RoomMusicButton() {
  const view = useRoomMusic();
  const headphones = useAudioStore((s) => s.prefs.scene !== 'auto');
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const { picking, changeButton, pick, back } = useMusicPicking<'room'>(open);
  const allowed = view?.allowed === true;

  // Quitter la pièce (ou ne plus y avoir la main) ferme la fenêtre.
  useEffect(() => {
    if (!allowed) setOpen(false);
  }, [allowed]);
  if (view === null || !allowed) return null;

  const on = view.state?.on !== false;
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
          {picking === 'room' ? (
            <RoomMusicPicker view={view} onBack={back} />
          ) : (
            <>
              <RoomMusicCard view={view} heard={!headphones} onChange={() => pick('room')} changeRef={changeButton} />
              {headphones && <p className="music-card-note">{fr.roomMusic.headphones}</p>}
            </>
          )}
        </div>
      </Popover>
    </>
  );
}
