import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { audioEngine } from '../audio/audio';
import { useAudioStore } from '../audio/audio-store';
import { SCENE_IDS, SCENES } from '../audio/catalog';
import { fr, t } from '../i18n/fr';
import { MusicIcon, SparklesIcon, CloseIcon } from './icons';

// Un interrupteur : une case à cocher qui se lit et s'annonce comme un interrupteur (role=switch).
export function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange(checked: boolean): void }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

// Un curseur de volume, de 0 à 100 %. Le pourcentage est écrit à côté, et lu par les lecteurs d'écran avec le curseur.
function VolumeSlider({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange(value: number): void }) {
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
      <output className="volume-value" aria-hidden="true">
        {t(fr.sound.percent, { percent })}
      </output>
    </div>
  );
}

// Le panneau Son : la musique et les effets sonores, chacun avec son interrupteur et son volume, et le choix de l'ambiance. La voix des
// autres n'en dépend pas (elle suit le micro et la sortie du système). Les réglages sont enregistrés dans le navigateur.
//
// Le focus va au titre à l'ouverture (le lecteur d'écran l'annonce, et Tab entre dans le panneau) ; Échap ferme.
export function SoundPanel({ id, onClose }: { id?: string; onClose(): void }) {
  const prefs = useAudioStore((state) => state.prefs);
  const playing = useAudioStore((state) => state.playing);
  const status = useAudioStore((state) => state.status);
  const setPrefs = useAudioStore((state) => state.setPrefs);
  const titleId = useId();
  const musicId = useId();
  const effectsId = useId();
  const groupName = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <aside id={id} className="people-panel sound-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="people-panel-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {fr.sound.title}
        </h2>
        <button type="button" className="bar-button" aria-label={fr.sound.close} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="people-lists sound-body">
        {status !== 'running' && (
          <p className="sound-status" role="status">
            {fr.sound.status[status]}
          </p>
        )}

        <section className="sound-section" aria-labelledby={musicId}>
          <div className="sound-row">
            <h3 id={musicId}>
              <MusicIcon off={!prefs.musicOn} />
              {fr.sound.music.label}
            </h3>
            <Switch checked={prefs.musicOn} label={fr.sound.music.label} onChange={(musicOn) => setPrefs({ musicOn })} />
          </div>
          <p className="sound-hint">{fr.sound.music.hint}</p>
          <VolumeSlider label={fr.sound.music.volume} value={prefs.musicVolume} disabled={!prefs.musicOn} onChange={(musicVolume) => setPrefs({ musicVolume })} />

          <fieldset className="sound-scenes" disabled={!prefs.musicOn}>
            <legend>{fr.sound.ambiance.label}</legend>
            <label className="sound-scene">
              <input type="radio" name={groupName} checked={prefs.scene === 'auto'} onChange={() => setPrefs({ scene: 'auto' })} />
              <span className="sound-scene-text">
                <span className="sound-scene-title">{fr.sound.ambiance.auto}</span>
                <span className="sound-scene-mood">{fr.sound.ambiance.autoHint}</span>
              </span>
            </label>
            {SCENE_IDS.map((scene) => (
              <label key={scene} className="sound-scene" title={SCENES[scene].track}>
                <input type="radio" name={groupName} checked={prefs.scene === scene} onChange={() => setPrefs({ scene })} />
                <span className="sound-scene-text">
                  <span className="sound-scene-title">
                    {fr.sound.scenes[scene].title}
                    {playing === scene && <span className="sound-scene-now">{fr.sound.ambiance.playing}</span>}
                  </span>
                  <span className="sound-scene-mood">{fr.sound.scenes[scene].mood}</span>
                  <span className="sound-scene-where">{fr.sound.scenes[scene].where}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>

        <section className="sound-section" aria-labelledby={effectsId}>
          <div className="sound-row">
            <h3 id={effectsId}>
              <SparklesIcon off={!prefs.sfxOn} />
              {fr.sound.effects.label}
            </h3>
            <Switch checked={prefs.sfxOn} label={fr.sound.effects.label} onChange={(sfxOn) => setPrefs({ sfxOn })} />
          </div>
          <p className="sound-hint">{fr.sound.effects.hint}</p>
          <VolumeSlider label={fr.sound.effects.volume} value={prefs.sfxVolume} disabled={!prefs.sfxOn} onChange={(sfxVolume) => setPrefs({ sfxVolume })} />
          {/* Un exemple pour régler le volume : son clic n'a pas de bruit à lui, c'est l'exemple qui sonne. */}
          <button type="button" className="bar-button sound-test" data-sfx="none" disabled={!prefs.sfxOn} onClick={() => audioEngine.playSfx('message')}>
            {fr.sound.effects.test}
          </button>
        </section>

        <p className="sound-credits">{fr.sound.credits}</p>
      </div>
    </aside>
  );
}
