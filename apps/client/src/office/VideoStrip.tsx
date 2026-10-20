import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { mediaDebug } from '../game/debug';
import { fr, t } from '../i18n/fr';
import type { MediaClient, MediaParticipant, MediaSnapshot, VideoSource } from '../media/media-client';
import { MicIcon } from './icons';

interface VideoStripProps {
  // L'état de l'audio et de la vidéo (useMedia), et le client qui montre les vidéos.
  snapshot: MediaSnapshot;
  client: MediaClient;
  // « Reconnecter », après un échec de la connexion audio et vidéo : relance la connexion au bureau, et le serveur redit la consigne.
  onReconnect?: () => void;
}

// Une vignette : la caméra (ou les initiales) d'un participant, ou son partage d'écran.
interface TileSpec {
  key: string;
  participant: MediaParticipant;
  source: VideoSource;
}

// Les vignettes de la conversation, en haut du bureau : une par participant, la sienne d'abord, avec son nom et l'état de son micro ;
// le partage d'écran de quelqu'un en plus, juste après sa caméra. Une vignette agrandie passe au-dessous de la liste, en grand :
// - un partage d'écran d'un autre s'affiche en grand de lui-même (le sien, non : il se verrait lui-même à l'infini) ;
// - un clic sur une vignette l'agrandit, à la place de ce qui l'était ; un clic sur la vignette agrandie la remet dans la liste.
// Hors conversation, rien. Au-dessus des vignettes, ce qui ne marche pas : la connexion audio et vidéo (« Reconnecter »), le son
// bloqué par le navigateur (« Activer le son »), le micro ou la caméra refusés.
export function VideoStrip({ snapshot, client, onReconnect }: VideoStripProps) {
  const { participants, error, audioBlocked, room } = snapshot;
  // La vignette que la personne a agrandie, et le partage d'écran (agrandi de lui-même) qu'elle a réduit.
  const [chosen, setChosen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Une vignette agrandie ou réduite change de place (la liste, ou en grand) : le focus la suit, pour qui l'a fait au clavier.
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [refocus, setRefocus] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (refocus === null) return;
    buttons.current.get(refocus)?.focus();
    setRefocus(null);
  }, [refocus]);

  const tiles: TileSpec[] = participants.flatMap((p) => {
    const camera: TileSpec = { key: `${p.id}:camera`, participant: p, source: 'camera' };
    return p.screen ? [camera, { key: `${p.id}:screen`, participant: p, source: 'screen' }] : [camera];
  });
  const keys = new Set(tiles.map((tile) => tile.key));
  const autoLarge = tiles.find((tile) => tile.source === 'screen' && !tile.participant.isLocal && tile.key !== dismissed);
  const large = (chosen !== null && keys.has(chosen) ? tiles.find((tile) => tile.key === chosen) : autoLarge) ?? null;

  // Une vignette partie (la personne, sa caméra ou son partage) n'est plus choisie : revenue, elle revient en petit ; un partage
  // qui reprend s'affiche de nouveau en grand.
  const keysSignature = [...keys].join(' ');
  useEffect(() => {
    if (chosen !== null && !keys.has(chosen)) setChosen(null);
    if (dismissed !== null && !keys.has(dismissed)) setDismissed(null);
    // keysSignature dit tout de `keys`, qui change d'objet à chaque rendu.
  }, [chosen, dismissed, keysSignature]);

  // window.__office.media.tiles, pour les tests de bout en bout : une vignette par participant.
  useEffect(() => {
    mediaDebug.tiles = participants.length;
  }, [participants.length]);
  useEffect(
    () => () => {
      mediaDebug.tiles = 0;
    },
    [],
  );

  function toggle(tile: TileSpec) {
    if (tile.key !== large?.key) setChosen(tile.key);
    else if (tile.key === chosen) setChosen(null);
    else setDismissed(tile.key);
    setRefocus(tile.key);
  }

  const renderTile = (tile: TileSpec) => (
    <Tile
      key={tile.key}
      ref={(button) => {
        if (button) buttons.current.set(tile.key, button);
        else buttons.current.delete(tile.key);
      }}
      tile={tile}
      large={tile.key === large?.key}
      client={client}
      onToggle={() => toggle(tile)}
    />
  );
  const small = tiles.filter((tile) => tile.key !== large?.key);
  const notices = [
    error === 'connection_failed' && (
      <div key="connection" className="video-notice" role="alert">
        <span>{fr.media.connectionFailed}</span>
        {onReconnect && (
          <button type="button" className="bar-button" onClick={onReconnect}>
            {fr.media.reconnect}
          </button>
        )}
      </div>
    ),
    room !== null && audioBlocked && (
      <div key="audio" className="video-notice" role="status">
        <span>{fr.media.audioBlocked}</span>
        {/* Dans le clic même : le navigateur ne laisse lancer le son que pendant un geste de la personne. */}
        <button type="button" className="bar-button" onClick={() => void client.startAudio()}>
          {fr.media.enableAudio}
        </button>
      </div>
    ),
    room !== null && error === 'permission_denied' && (
      <p key="devices" className="video-notice" role="status">
        {fr.media.devicesRefused}
      </p>
    ),
  ].filter(Boolean);

  if (tiles.length === 0 && notices.length === 0) return null;
  return (
    <div className="video-strip">
      {notices}
      {small.length > 0 && (
        <ul className="video-tiles" aria-label={fr.media.tiles.label}>
          {small.map((tile) => (
            <li key={tile.key}>{renderTile(tile)}</li>
          ))}
        </ul>
      )}
      {large && <div className="video-stage">{renderTile(large)}</div>}
    </div>
  );
}

function Tile({
  ref,
  tile,
  large,
  client,
  onToggle,
}: {
  ref: Ref<HTMLButtonElement>;
  tile: TileSpec;
  large: boolean;
  client: MediaClient;
  onToggle(): void;
}) {
  const { participant, source } = tile;
  const name = participant.isLocal ? t(fr.media.tiles.you, { name: participant.name }) : participant.name;
  const label =
    source === 'screen'
      ? t(fr.media.tiles.screen, { name })
      : t(participant.mic ? fr.media.tiles.camera : fr.media.tiles.cameraMuted, { name });
  const showVideo = source === 'screen' || participant.cam;
  return (
    <button
      ref={ref}
      type="button"
      className={`tile tile-${source}`}
      aria-label={label}
      aria-pressed={large}
      title={large ? fr.media.tiles.shrink : fr.media.tiles.enlarge}
      data-participant={participant.id}
      data-source={source}
      data-local={participant.isLocal ? '' : undefined}
      data-speaking={source === 'camera' && participant.speaking ? '' : undefined}
      onClick={onToggle}
    >
      {showVideo ? (
        <TileVideo client={client} participantId={participant.id} source={source} mirrored={participant.isLocal && source === 'camera'} />
      ) : (
        <span className="tile-initials" aria-hidden="true">
          {initials(participant.name)}
        </span>
      )}
      <span className="tile-label" aria-hidden="true">
        {source === 'camera' && !participant.mic && (
          <span className="tile-muted">
            <MicIcon off size={14} />
          </span>
        )}
        <span className="tile-name">{source === 'screen' ? t(fr.media.tiles.screen, { name }) : name}</span>
      </span>
    </button>
  );
}

// La vidéo d'une vignette : le client y attache la piste de la personne, avec l'élément (useLayoutEffect : jamais de vignette vide à
// l'écran), et la suit (piste qui arrive, change ou part) jusqu'au démontage, qui la détache. Muette : le son des autres joue dans ses
// propres éléments.
function TileVideo({ client, participantId, source, mirrored }: { client: MediaClient; participantId: string; source: VideoSource; mirrored: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = true;
    return client.attach(element, participantId, source);
  }, [client, participantId, source]);
  return <video ref={video} className={mirrored ? 'tile-video tile-video-mirrored' : 'tile-video'} autoPlay muted playsInline />;
}

// Les initiales d'un nom : la première lettre de ses deux premiers mots.
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase('fr');
}
