import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fr } from '../i18n/fr';
import { DevicePreview, type PreviewState } from '../media/device-preview';
import type { MediaPrefs } from '../media/media-client';
import { loadPrefs, savePrefs } from '../media/prefs';
import { CameraIcon, MicIcon } from './icons';

// Les pseudo-périphériques de Chrome (« Par défaut », « Communications ») : « Celui du système » les remplace.
const PSEUDO_DEVICES = new Set(['default', 'communications']);

// L'écran d'entrée, avant le bureau : l'aperçu de sa caméra, le niveau de son micro, et le choix des périphériques. La personne y
// règle le micro et la caméra allumés en entrant ; ses choix sont gardés pour la prochaine visite (savePrefs).
//
// « Entrer » ouvre le bureau (onEnter, avec les préférences de la conversation à venir). Ce clic est aussi le geste qui permet au
// navigateur de jouer le son des autres (la page appelle startAudio dedans). Les pistes de l'aperçu s'arrêtent à l'entrée : LiveKit
// demandera les siennes dans la première conversation.
//
// Micro ou caméra refusés ou absents : un message le dit, et le bouton devient « Entrer quand même ». On entre alors sans eux (rien ne
// sera redemandé dans les conversations, tant que la personne ne les rallume pas), mais le refus n'est pas gardé : à la prochaine
// visite, ils seront de nouveau demandés.
export function DeviceCheck({ onEnter }: { onEnter(prefs: MediaPrefs): void }) {
  const [prefs, setPrefs] = useState<MediaPrefs>(loadPrefs);
  // Ce qui est voulu est demandé dès le montage : en attente d'emblée.
  const [state, setState] = useState<PreviewState>(() => ({
    audio: null,
    video: null,
    mic: prefs.mic ? 'pending' : 'off',
    cam: prefs.cam ? 'pending' : 'off',
  }));
  const preview = useRef<DevicePreview | null>(null);
  const devices = useDeviceList(state.mic === 'on' || state.cam === 'on');

  // L'aperçu vit avec l'écran : ouvert au montage, fermé au démontage (et à l'entrée).
  useEffect(() => {
    const opened = new DevicePreview(navigator.mediaDevices as MediaDevices | undefined, navigator.permissions as Permissions | undefined, setState);
    preview.current = opened;
    return () => {
      opened.close();
      preview.current = null;
    };
  }, []);

  useEffect(() => {
    preview.current?.want({ mic: prefs.mic, cam: prefs.cam, audioInput: prefs.audioInput, videoInput: prefs.videoInput });
  }, [prefs.mic, prefs.cam, prefs.audioInput, prefs.videoInput]);

  function update(patch: Partial<MediaPrefs>) {
    const next: MediaPrefs = { ...prefs, ...patch };
    for (const field of ['audioInput', 'videoInput', 'audioOutput'] as const) {
      if (next[field] === undefined || next[field] === '') delete next[field];
    }
    setPrefs(next);
    savePrefs(next);
  }

  const micFailed = prefs.mic && state.mic === 'failed';
  const camFailed = prefs.cam && state.cam === 'failed';
  const refused = micFailed || camFailed;
  const message = !refused
    ? null
    : (micFailed || !prefs.mic) && (camFailed || !prefs.cam)
      ? fr.media.permissionDenied
      : micFailed
        ? fr.media.micDenied
        : fr.media.camDenied;
  const asking = state.mic === 'pending' || state.cam === 'pending';

  function enter() {
    preview.current?.close();
    onEnter({ ...prefs, mic: prefs.mic && !micFailed, cam: prefs.cam && !camFailed });
  }

  const canChooseOutput = 'setSinkId' in HTMLMediaElement.prototype;

  return (
    <main className="device-check">
      <div className="device-check-card">
        <p className="auth-brand">{fr.common.appName}</p>
        <h1>{fr.media.check.title}</h1>
        <p className="device-check-intro">{fr.media.check.intro}</p>

        {/* Deux colonnes sur un écran large : l'aperçu à gauche, les réglages et « Entrer » à droite, sans avoir à faire défiler. */}
        <div className="device-check-body">
          <div className="device-check-media">
            <div className="device-preview">
              {state.video ? (
                <PreviewVideo track={state.video} />
              ) : (
                <p className="device-preview-placeholder">
                  {!prefs.cam ? fr.media.check.camOff : camFailed ? fr.media.check.camUnavailable : ''}
                </p>
              )}
            </div>
            <MicMeter track={state.audio} />
            {asking && <p className="device-check-hint">{fr.media.check.asking}</p>}
          </div>

          <div className="device-check-settings">
            <div className="device-toggles">
              <button type="button" className="bar-button media-button" aria-pressed={prefs.mic} onClick={() => update({ mic: !prefs.mic })}>
                <MicIcon off={!prefs.mic} />
                <span>{fr.media.check.mic}</span>
              </button>
              <button type="button" className="bar-button media-button" aria-pressed={prefs.cam} onClick={() => update({ cam: !prefs.cam })}>
                <CameraIcon off={!prefs.cam} />
                <span>{fr.media.check.cam}</span>
              </button>
            </div>

            <div className="device-selects">
              <DeviceSelect
                label={fr.media.check.audioInput}
                devices={devices}
                kind="audioinput"
                value={prefs.audioInput}
                onChange={(audioInput) => update({ audioInput })}
              />
              <DeviceSelect
                label={fr.media.check.videoInput}
                devices={devices}
                kind="videoinput"
                value={prefs.videoInput}
                onChange={(videoInput) => update({ videoInput })}
              />
              {canChooseOutput && (
                <DeviceSelect
                  label={fr.media.check.audioOutput}
                  devices={devices}
                  kind="audiooutput"
                  value={prefs.audioOutput}
                  onChange={(audioOutput) => update({ audioOutput })}
                />
              )}
            </div>

            {message && (
              <p className="device-check-message" role="status">
                {message}
              </p>
            )}
            <button type="button" className="button device-check-enter" onClick={enter}>
              {refused ? fr.media.check.enterAnyway : fr.media.check.enter}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

// Les périphériques du système, relus quand l'accès est accordé (leurs noms n'arrivent qu'avec lui) et quand on en branche ou
// débranche un.
function useDeviceList(granted: boolean): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const media = navigator.mediaDevices as MediaDevices | undefined;
    if (!media?.enumerateDevices) return;
    let active = true;
    const refresh = () => {
      media.enumerateDevices().then(
        (list) => {
          if (active) setDevices(list);
        },
        () => {
          // la liste reste celle d'avant
        },
      );
    };
    refresh();
    media.addEventListener?.('devicechange', refresh);
    return () => {
      active = false;
      media.removeEventListener?.('devicechange', refresh);
    };
  }, [granted]);
  return devices;
}

// Une liste de périphériques d'un genre : « Celui du système », puis ceux qui ont un nom (le navigateur n'en donne qu'avec l'accès).
function DeviceSelect({
  label,
  devices,
  kind,
  value,
  onChange,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  kind: MediaDeviceKind;
  value: string | undefined;
  onChange(deviceId: string): void;
}) {
  const id = useId();
  const options = devices.filter((d) => d.kind === kind && d.deviceId !== '' && d.label !== '' && !PSEUDO_DEVICES.has(d.deviceId));
  // Un périphérique choisi puis débranché : « Celui du système », qui le remplace aussi pour LiveKit.
  const selected = value !== undefined && options.some((d) => d.deviceId === value) ? value : '';
  return (
    <div className="field device-select">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={selected} disabled={options.length === 0} onChange={(event) => onChange(event.target.value)}>
        <option value="">{fr.media.check.systemDefault}</option>
        {options.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// L'aperçu de sa caméra, vu en miroir comme dans une glace, et muet. Le flux est posé avec l'élément (useLayoutEffect) : jamais de vidéo
// vide à l'écran.
function PreviewVideo({ track }: { track: MediaStreamTrack }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useMemo(() => new MediaStream([track]), [track]);
  useLayoutEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = true;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  return <video ref={video} className="device-preview-video device-preview-mirrored" aria-label={fr.media.check.preview} autoPlay muted playsInline />;
}

// Le niveau du micro : une barre qui suit le volume, de -60 dB (rien) à -10 dB (une voix forte). Décorative pour les lecteurs
// d'écran : un niveau qui change 60 fois par seconde ne se lit pas.
function MicMeter({ track }: { track: MediaStreamTrack | null }) {
  const level = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = level.current;
    if (!element || !track || typeof AudioContext === 'undefined') return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    const draw = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const decibels = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-6);
      element.style.transform = `scaleX(${Math.min(1, Math.max(0, (decibels + 60) / 50))})`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    // Sans geste de la personne (une page rechargée), le navigateur garde le contexte en pause jusqu'au premier clic ou à la première
    // touche.
    const resume = () => {
      if (context.state === 'suspended') void context.resume();
    };
    resume();
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      source.disconnect();
      void context.close();
      element.style.transform = 'scaleX(0)';
    };
  }, [track]);
  return (
    <div className="device-meter" aria-hidden="true">
      <span className="device-meter-label">{fr.media.check.micLevel}</span>
      <span className="device-meter-bar">
        <span ref={level} className="device-meter-level" />
      </span>
    </div>
  );
}
