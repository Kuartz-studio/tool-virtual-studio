import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { audioEngine } from '../audio/audio';
import { useAudioStore } from '../audio/audio-store';
import { SCENE_IDS, type SceneId } from '../audio/catalog';
import { fr, t } from '../i18n/fr';
import { COVER_HEIGHT, COVER_WIDTH, drawCover } from './ambiance-covers';
import { MusicIcon, PlaceIcon, PlayIcon, VolumeIcon } from './icons';
import { IconButton } from './ui/IconButton';
import { Popover } from './ui/Popover';

// Un interrupteur : une case à cocher qui se lit et s'annonce comme un interrupteur (role=switch).
export function Switch({ checked, label, onChange, inputRef }: { checked: boolean; label: string; onChange(checked: boolean): void; inputRef?: RefObject<HTMLInputElement | null> }) {
  return (
    <label className="switch">
      <input ref={inputRef} type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

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

// La pochette d'une ambiance : 16 × 10 pixels (ambiance-covers.ts), que le CSS agrandit ×5 sans lissage. Décorative : le titre est écrit à côté.
// `data-cover` dit laquelle (les tests, et le suivi du lieu de « Selon l'endroit »).
function Cover({ scene }: { scene: SceneId }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) drawCover(canvas.current, scene);
  }, [scene]);
  return <canvas ref={canvas} className="juke-cover" width={COVER_WIDTH} height={COVER_HEIGHT} data-cover={scene} aria-hidden="true" />;
}

const ARROWS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// Les flèches sont à ce qu'elles règlent (une carte, un volume) : elles ne vont pas jusqu'à l'avatar, dont le clavier (game/input.ts) ne les ignore que
// dans un champ où l'on écrit, et non sur un bouton radio ou un curseur.
function keepArrows(event: KeyboardEvent<HTMLElement>): void {
  if (ARROWS.has(event.key)) event.stopPropagation();
}

export interface SoundPopoverProps {
  open: boolean;
  onClose(): void;
  // Le bouton « Musique et ambiances » du dock : la fenêtre se pose au-dessus, centrée, et Échap lui rend le focus.
  anchorRef: RefObject<HTMLElement | null>;
  id?: string;
}

// Le juke-box (spec de la tâche 11a) : la musique et les effets sonores de l'appli, dans une fenêtre de 320 px au-dessus du bouton du dock. La
// voix des autres n'en dépend pas (elle suit le micro et la sortie du système). Les réglages sont enregistrés dans le navigateur.
// - En haut, la musique : son interrupteur, son volume, et le choix de l'ambiance : « Selon l'endroit » (celle du lieu où l'on est, avec sa
//   pochette), puis six cartes, chacune avec sa pochette en pixel art. Ce sont de vrais boutons radio (un seul groupe, au clavier : les flèches),
//   cachés dans leur carte ; ce que l'ambiance évoque et où elle joue sont en infobulle (`title`) et décrits aux lecteurs d'écran
//   (`aria-description`), avec « En cours » pour celle qu'on entend. Musique coupée, la grille reste utilisable, en retrait : le choix est gardé
//   pour quand elle reviendra.
// - En bas, les effets : interrupteur, volume, un exemple à écouter pour le régler ; puis les crédits.
// Le focus va à l'interrupteur de la musique à l'ouverture ; Échap ferme et le rend au bouton du dock. Les flèches règlent les cartes et les volumes,
// sans faire marcher l'avatar.
export function SoundPopover({ open, onClose, anchorRef, id }: SoundPopoverProps) {
  const prefs = useAudioStore((state) => state.prefs);
  const playing = useAudioStore((state) => state.playing);
  const place = useAudioStore((state) => state.place);
  const status = useAudioStore((state) => state.status);
  const setPrefs = useAudioStore((state) => state.setPrefs);
  const groupName = useId();
  const musicSwitch = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) musicSwitch.current?.focus();
  }, [open]);

  // Une carte de la grille : le bouton radio (invisible, sur toute la carte), la pochette, le titre ; et, pour celle qu'on entend, l'égaliseur.
  const card = (scene: SceneId) => {
    const { title, mood, where } = fr.sound.scenes[scene];
    const isPlaying = playing === scene;
    const description = `${mood} · ${where}`;
    return (
      <label key={scene} className="juke-card" title={description} data-playing={isPlaying ? 'true' : undefined}>
        <input
          type="radio"
          className="juke-radio"
          name={groupName}
          checked={prefs.scene === scene}
          aria-description={isPlaying ? `${description} · ${fr.sound.ambiance.playing}` : description}
          onChange={() => setPrefs({ scene })}
        />
        <span className="juke-art">
          <Cover scene={scene} />
          {isPlaying && (
            <span className="juke-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </span>
        <span className="juke-name">{title}</span>
      </label>
    );
  };

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} placement="top" label={fr.sound.toggle} role="dialog" id={id}>
      <div className="juke" onKeyDown={keepArrows}>
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

        <fieldset className={`juke-scenes${prefs.musicOn ? '' : ' is-off'}`}>
          <legend className="visually-hidden">{fr.sound.ambiance.label}</legend>
          <label className="juke-auto" title={fr.sound.ambiance.autoHint}>
            <input
              type="radio"
              className="juke-radio"
              name={groupName}
              checked={prefs.scene === 'auto'}
              aria-description={fr.sound.ambiance.autoHint}
              onChange={() => setPrefs({ scene: 'auto' })}
            />
            <PlaceIcon />
            <span className="juke-auto-text">
              <span className="juke-name">{fr.sound.ambiance.auto}</span>
              <small>{t(fr.sound.ambiance.autoHere, { scene: fr.sound.scenes[place].title })}</small>
            </span>
            <span className="juke-art">
              <Cover scene={place} />
            </span>
          </label>
          <div className="juke-grid">{SCENE_IDS.map(card)}</div>
        </fieldset>

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
      </div>
    </Popover>
  );
}
