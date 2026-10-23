import { useEffect, useId, useRef, type CSSProperties, type RefObject } from 'react';
import { audioEngine } from '../audio/audio';
import { useAudioStore } from '../audio/audio-store';
import { fr, t } from '../i18n/fr';
import { HeadphonesIcon, MusicIcon, PlayIcon, VolumeIcon } from './icons';
import { keepArrows, MusicCard, MusicPicker, sceneNote, Switch, useMusicPicking } from './Music';
import { RoomMusicCard, RoomMusicPicker, useRoomMusic } from './RoomMusic';
import { IconButton } from './ui/IconButton';
import { Popover } from './ui/Popover';
import { Segmented } from './ui/Segmented';

// Un curseur de volume, de 0 à 100 %. Le pourcentage est lu par les lecteurs d'écran avec le curseur, et écrit à côté (sauf `compact`, où la
// place manque : la ligne des effets).
function VolumeSlider({ label, value, disabled, compact = false, onChange }: { label: string; value: number; disabled?: boolean; compact?: boolean; onChange(value: number): void }) {
  const percent = Math.round(value * 100);
  return (
    <div className="volume">
      <input
        type="range"
        className="volume-slider"
        aria-label={label}
        aria-valuetext={t(fr.sound.percent, { percent })}
        min={0}
        max={100}
        step={1}
        value={percent}
        disabled={disabled}
        style={{ '--volume': `${percent}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      {!compact && (
        <output className="volume-value" aria-hidden="true">
          {t(fr.sound.percent, { percent })}
        </output>
      )}
    </div>
  );
}

// Ce qu'on écoute : la musique de la pièce (`auto` dans les réglages) ou la sienne.
type Source = 'room' | 'mine';

export interface SoundPopoverProps {
  open: boolean;
  onClose(): void;
  // Le bouton « Musique et ambiances » du dock : la fenêtre se pose au-dessus, centrée, et Échap lui rend le focus.
  anchorRef: RefObject<HTMLElement | null>;
  id?: string;
}

// Le juke-box : la musique et les effets sonores de l'appli, dans une fenêtre au-dessus du bouton du dock. La voix des autres n'en dépend pas (elle suit le
// micro et la sortie du système). Les réglages sont ceux de cet appareil, sauf la musique de la pièce, que le serveur garde pour tous.
// - En haut, la musique chez soi : son interrupteur et son volume.
// - Puis « J'écoute » : la pièce ou ma musique, deux onglets, chacun avec sa carte, qui dit pour qui elle joue. « La pièce » : la musique de la pièce
//   où l'on est, la même pour tout le monde ici (RoomMusicCard : sa vignette ouvre la liste pour la changer, là où c'est permis ; ailleurs, la raison).
//   « Ma musique » : celle qu'on n'écoute que pour soi, comme un casque, partout où l'on va (sa vignette ouvre la liste). Passer à « Ma musique » garde ce
//   qu'on entend : on la change ensuite. Musique coupée, tout cela reste utilisable, en retrait.
// - La liste (MusicPicker) remplace la fenêtre le temps du choix : le thème (« Par défaut », « Pirate »), puis ses musiques.
// - En bas, les effets : interrupteur, volume, un exemple à écouter pour le régler ; puis les crédits.
// Le focus va à l'interrupteur de la musique à l'ouverture ; Échap ferme et le rend au bouton du dock (dans la liste, Échap revient d'abord à la fenêtre).
export function SoundPopover({ open, onClose, anchorRef, id }: SoundPopoverProps) {
  const prefs = useAudioStore((state) => state.prefs);
  const playing = useAudioStore((state) => state.playing);
  const status = useAudioStore((state) => state.status);
  const place = useAudioStore((state) => state.place);
  const setPrefs = useAudioStore((state) => state.setPrefs);
  const room = useRoomMusic();
  const musicSwitch = useRef<HTMLInputElement>(null);
  const { picking, changeButton, pick, back } = useMusicPicking<Source>(open);
  const panelId = useId();
  const tabId = (source: Source) => `${panelId}-${source}`;
  const source: Source = prefs.scene === 'auto' ? 'room' : 'mine';

  useEffect(() => {
    if (open) musicSwitch.current?.focus();
  }, [open]);

  // Passer à « Ma musique » garde ce qu'on entend (ou, musique coupée, ce que joue la pièce) : rien ne change à l'oreille avant qu'on en choisisse une autre.
  const listenTo = (next: Source) => {
    if (next === source) return;
    if (next === 'room') setPrefs({ scene: 'auto' });
    else setPrefs({ scene: playing ?? room?.scene ?? place });
  };

  const mine = prefs.scene === 'auto' ? null : prefs.scene;

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} placement="top" label={fr.sound.toggle} role="dialog" id={id}>
      <div className="juke" onKeyDown={keepArrows}>
        {picking === 'room' && room !== null ? (
          <RoomMusicPicker view={room} onBack={back} />
        ) : picking === 'mine' && mine !== null ? (
          <MusicPicker
            title={fr.sound.mine.title}
            audience={fr.sound.mine.audience}
            value={mine}
            playing={playing}
            onPick={(scene) => scene !== null && setPrefs({ scene })}
            onBack={back}
          />
        ) : (
          <>
            {status !== 'running' && (
              <p className="juke-status" role="status">
                {fr.sound.status[status]}
              </p>
            )}

            <div className="juke-head">
              <div className="juke-row">
                <h3 className="juke-title">
                  <MusicIcon off={!prefs.musicOn} />
                  {fr.sound.music.label}
                </h3>
                <Switch inputRef={musicSwitch} checked={prefs.musicOn} label={fr.sound.music.label} onChange={(musicOn) => setPrefs({ musicOn })} />
              </div>
              <div className="juke-volume">
                <VolumeIcon off={!prefs.musicOn} />
                <VolumeSlider label={fr.sound.music.volume} value={prefs.musicVolume} disabled={!prefs.musicOn} onChange={(musicVolume) => setPrefs({ musicVolume })} />
              </div>
            </div>

            <div className={`juke-listen${prefs.musicOn ? '' : ' is-off'}`}>
              <div className="juke-source">
                <span className="juke-source-label" aria-hidden="true">
                  {fr.sound.source.label}
                </span>
                <Segmented
                  label={fr.sound.source.label}
                  value={source}
                  options={[
                    { id: 'room', label: fr.sound.source.room },
                    { id: 'mine', label: fr.sound.source.mine },
                  ]}
                  onSelect={listenTo}
                  panelId={panelId}
                  tabId={tabId}
                />
              </div>
              <div id={panelId} role="tabpanel" aria-labelledby={tabId(source)}>
                {source === 'room'
                  ? room !== null && <RoomMusicCard view={room} heard onChange={() => pick('room')} changeRef={changeButton} />
                  : mine !== null && (
                      <MusicCard
                        icon={<HeadphonesIcon />}
                        title={fr.sound.mine.title}
                        audience={fr.sound.mine.audience}
                        scene={mine}
                        note={sceneNote(mine)}
                        playing={playing === mine}
                        change={{ label: fr.sound.mine.change, onClick: () => pick('mine'), buttonRef: changeButton }}
                      >
                        <p className="music-card-note">{fr.sound.mine.note}</p>
                      </MusicCard>
                    )}
              </div>
            </div>

            <div className="juke-fx">
              <span className="juke-fx-label">{fr.sound.effects.label}</span>
              <Switch checked={prefs.sfxOn} label={fr.sound.effects.label} onChange={(sfxOn) => setPrefs({ sfxOn })} />
              <VolumeSlider compact label={fr.sound.effects.volume} value={prefs.sfxVolume} disabled={!prefs.sfxOn} onChange={(sfxVolume) => setPrefs({ sfxVolume })} />
              {/* Un exemple pour régler le volume : son clic n'a pas de bruit à lui, c'est l'exemple qui sonne. */}
              <IconButton label={fr.sound.effects.test} small tip="top" data-sfx="none" disabled={!prefs.sfxOn} onClick={() => audioEngine.playSfx('message')}>
                <PlayIcon />
              </IconButton>
            </div>

            <p className="juke-credits">{fr.sound.credits}</p>
          </>
        )}
      </div>
    </Popover>
  );
}
