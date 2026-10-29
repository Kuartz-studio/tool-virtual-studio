import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from 'react';
import { mediaDebug } from '../game/debug';
import { fr, t } from '../i18n/fr';
import type { MediaClient, MediaParticipant, MediaSnapshot, VideoSource } from '../media/media-client';
import { ChevronLeftIcon, ChevronRightIcon, FullscreenIcon, MicIcon } from './icons';
import { initials } from './ui/initials';

interface VideoStripProps {
  // L'état de l'audio et de la vidéo (useMedia), et le client qui montre les vidéos.
  snapshot: MediaSnapshot;
  client: MediaClient;
  // Les personnes qu'on n'entend plus du tout (trop loin dans un espace ouvert, spatial-audio.ts) : leurs vignettes ne sont pas montrées.
  hidden?: ReadonlySet<string>;
  // « Reconnecter », après un échec de la connexion audio et vidéo : relance la connexion au bureau, et le serveur redit la consigne.
  onReconnect?: () => void;
  // Ce qui se règle pour toute la conversation (le verrou, ConversationLockBar), au-dessus des vignettes : seulement dans une room où l'on
  // n'est pas seul.
  controls?: ReactNode;
}

// Une vignette : la caméra (ou les initiales) d'un participant, ou son partage d'écran.
interface TileSpec {
  key: string;
  participant: MediaParticipant;
  source: VideoSource;
}

// Le délai d'un double-clic. Un clic de souris sur une vignette qui peut passer en plein écran n'agrandit (ou ne réduit) qu'au bout de ce
// délai, s'il n'est pas suivi d'un second clic : le double-clic, qui la met en plein écran. Sans cette attente, le premier clic déplacerait
// déjà la vignette (en grand, ou dans la liste), et le second tomberait sur une autre, ou sur le jeu derrière.
const DOUBLE_CLICK_MS = 250;
// En plein écran, les boutons (quitter, vignette d'avant et d'après) s'effacent après ce temps sans un mouvement de la souris ni une touche,
// pour laisser voir toute la vidéo ; le nom et le micro restent.
const CONTROLS_IDLE_MS = 2500;
const ARROWS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// Les vignettes de la conversation, en haut du bureau : une par participant, la sienne d'abord, avec son nom et l'état de son micro ;
// le partage d'écran de quelqu'un en plus, juste après sa caméra. Une vignette agrandie passe au-dessous de la liste, en grand :
// - un partage d'écran d'un autre s'affiche en grand de lui-même (le sien, non : il se verrait lui-même à l'infini) ;
// - un clic sur une vignette l'agrandit, à la place de ce qui l'était ; un clic sur la vignette agrandie la remet dans la liste.
// Chaque vignette, petite ou agrandie, passe en plein écran (son bouton « Plein écran », au survol ou au focus clavier, ou un double-clic) :
// la caméra (ou les initiales) de n'importe qui, et le partage d'écran d'un autre ; pas le sien, pour la même raison. En plein écran, les
// flèches ← → (et les chevrons) passent à la vignette d'avant ou d'après, et aucune touche ne va au jeu ; Échap ou « Quitter le plein
// écran » en sortent.
// Hors conversation, rien. Au-dessus des vignettes, ce qui ne marche pas : la connexion audio et vidéo (« Reconnecter »), le son
// bloqué par le navigateur (« Activer le son »), le micro ou la caméra refusés ; puis ce qui se règle pour toute la conversation (`controls`).
export function VideoStrip({ snapshot, client, hidden, onReconnect, controls }: VideoStripProps) {
  const { error, audioBlocked, room } = snapshot;
  const withOthers = room !== null && snapshot.participants.some((p) => !p.isLocal);
  const participants = hidden && hidden.size > 0 ? snapshot.participants.filter((p) => p.isLocal || !hidden.has(p.id)) : snapshot.participants;
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

  function toggle(key: string) {
    if (key !== large?.key) setChosen(key);
    else if (key === chosen) setChosen(null);
    else setDismissed(key);
    setRefocus(key);
  }

  // Le plein écran se demande sur une scène toujours là (vide, et cachée hors plein écran) : le navigateur ne le permet que pendant le
  // geste de la personne, et la demande part donc du clic même, avant que la scène montre quoi que ce soit ; elle se remplit juste après,
  // de la vignette choisie. Elle a sa propre vidéo : derrière, les vignettes restent comme elles sont, et LiveKit (adaptiveStream) reçoit
  // la qualité qui convient à la plus grande des deux.
  const scene = useRef<HTMLDivElement>(null);
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // D'où l'on est parti : ce qui avait le focus avant le plein écran (le bouton, ou la vignette double-cliquée), et la vignette mise en plein
  // écran avec la caméra de la même personne, s'il faut un autre point de retour (restoreFocus).
  const opener = useRef<{ element: HTMLElement | null; key: string; cameraKey: string } | null>(null);
  const fullscreenable = fullscreenAvailable() ? tiles.filter(allowsFullscreen) : [];
  const fullscreenKeys = new Set(fullscreenable.map((tile) => tile.key));
  const shown = fullscreenable.find((tile) => tile.key === fullKey) ?? null;

  // Le navigateur dit quand on entre en plein écran ou qu'on en sort (le bouton, Échap, un autre onglet…). En entrant, le focus passe dans
  // la scène (les flèches y changent de vignette) ; en sortant, la scène se vide et le focus revient d'où il était parti (restoreFocus).
  useEffect(() => {
    const sync = () => {
      const element = scene.current;
      const active = element !== null && document.fullscreenElement === element;
      setFullscreen(active);
      if (active) {
        element.focus({ preventScroll: true });
        return;
      }
      setFullKey(null);
      const from = opener.current;
      opener.current = null;
      restoreFocus(element, from);
    };
    // Le focus, à la sortie du plein écran, ne doit pas rester sur la scène : cachée (une boîte de taille nulle), elle ne mènerait les touches
    // nulle part. Il revient à ce qui l'avait avant, toujours dans la page. Sinon :
    // - ce bouton est parti avec sa vignette (la personne a coupé son partage, ou elle est partie) : la même vignette, si elle a seulement
    //   changé de place, ou la caméra de la même personne ;
    // - le focus était sur la page elle-même (Safari et Firefox sur macOS ne le donnent pas au bouton qu'on clique), ou il n'y a plus rien de
    //   cette personne : il quitte la scène, et revient à la page, où les touches vont au jeu.
    function restoreFocus(element: HTMLElement | null, from: typeof opener.current) {
      const back = from?.element;
      const fromPage = !back || back === document.body;
      if (!fromPage && back.isConnected) {
        back.focus({ preventScroll: true });
        return;
      }
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !element?.contains(focused)) return;
      const fallback = fromPage || !from ? undefined : (buttons.current.get(from.key) ?? buttons.current.get(from.cameraKey));
      if (fallback) fallback.focus({ preventScroll: true });
      else focused.blur();
    }
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  // En plein écran sans plus rien à montrer (la personne est partie, a coupé son partage, n'est plus entendue, ou elle l'a fait pendant
  // la demande) : on en sort, plutôt que de laisser un écran noir.
  const nothingShown = shown === null;
  useEffect(() => {
    if (fullscreen && nothingShown) void document.exitFullscreen().catch(() => {});
  }, [fullscreen, nothingShown]);

  function enterFullscreen({ key, participant }: TileSpec) {
    const element = scene.current;
    if (!element) return;
    setFullKey(key);
    if (document.fullscreenElement === element) return;
    opener.current = {
      element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      key,
      cameraKey: `${participant.id}:camera`,
    };
    // Dans le geste même : rien ne doit être attendu avant cet appel. Refusé (une page dans un cadre qui ne le permet pas…), rien ne change.
    element.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
      opener.current = null;
      setFullKey(null);
    });
  }
  function exitFullscreen() {
    if (document.fullscreenElement === scene.current) void document.exitFullscreen().catch(() => {});
  }
  // La vignette d'avant ou d'après, dans l'ordre de la liste (soi d'abord), en faisant le tour.
  function step(delta: -1 | 1) {
    const at = fullscreenable.findIndex((tile) => tile.key === fullKey);
    if (at < 0) return;
    setFullKey(fullscreenable[(at + delta + fullscreenable.length) % fullscreenable.length]!.key);
  }

  // Un clic de souris sur une vignette qui peut passer en plein écran attend DOUBLE_CLICK_MS avant d'agrandir ou de réduire : s'il est
  // suivi d'un second, c'est un double-clic. Le minuteur appelle toggle tel qu'il est à ce moment-là (l'état a pu changer entre-temps).
  const pendingClick = useRef<{ key: string; timer: number } | null>(null);
  const latestToggle = useRef(toggle);
  useLayoutEffect(() => {
    latestToggle.current = toggle;
  });
  useEffect(
    () => () => {
      if (pendingClick.current) window.clearTimeout(pendingClick.current.timer);
    },
    [],
  );
  function clickTile(tile: TileSpec, event: MouseEvent) {
    // Pas de plein écran pour cette vignette : rien à attendre, le clic agrandit ou réduit tout de suite.
    if (!fullscreenKeys.has(tile.key)) {
      toggle(tile.key);
      return;
    }
    const pending = pendingClick.current;
    // Le second clic d'un double-clic (`detail` compte les clics au même endroit) : sur la vignette du premier, toujours en attente, elle
    // passe en plein écran sans changer de place. Sinon, le premier clic a déjà déplacé sa vignette, et celui-ci, tombé sur une autre, ne
    // fait rien.
    if (event.detail >= 2) {
      if (pending?.key === tile.key) {
        window.clearTimeout(pending.timer);
        pendingClick.current = null;
        enterFullscreen(tile);
      }
      return;
    }
    // Un clic sur une autre vignette pendant l'attente : celui d'avant compte, tout de suite.
    if (pending) {
      window.clearTimeout(pending.timer);
      pendingClick.current = null;
      toggle(pending.key);
    }
    // Au clavier (Entrée, Espace : `detail` vaut 0), pas de double-clic à attendre.
    if (event.detail === 0) {
      toggle(tile.key);
      return;
    }
    const timer = window.setTimeout(() => {
      pendingClick.current = null;
      latestToggle.current(tile.key);
    }, DOUBLE_CLICK_MS);
    pendingClick.current = { key: tile.key, timer };
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
      onClick={(event) => clickTile(tile, event)}
      onFullscreen={fullscreenKeys.has(tile.key) ? () => enterFullscreen(tile) : undefined}
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
      {withOthers && controls}
      {small.length > 0 && (
        <ul className="video-tiles" aria-label={fr.media.tiles.label}>
          {small.map((tile) => (
            <li key={tile.key}>{renderTile(tile)}</li>
          ))}
        </ul>
      )}
      {large && <div className="video-stage">{renderTile(large)}</div>}
      {fullscreenAvailable() && (
        <FullscreenScene
          ref={scene}
          tile={shown}
          client={client}
          active={fullscreen}
          onStep={fullscreenable.length > 1 ? step : undefined}
          onExit={exitFullscreen}
        />
      )}
    </div>
  );
}

// Son propre partage d'écran ne passe pas en plein écran : on s'y verrait soi-même, à l'infini. Tout le reste, oui.
function allowsFullscreen(tile: TileSpec): boolean {
  return !(tile.source === 'screen' && tile.participant.isLocal);
}

// Le nom de la personne, « (toi) » en plus pour soi.
function personName(participant: MediaParticipant): string {
  return participant.isLocal ? t(fr.media.tiles.you, { name: participant.name }) : participant.name;
}

// Ce qu'une vignette montre, écrit dessus : la personne, ou son partage d'écran.
function tileName({ participant, source }: TileSpec): string {
  return source === 'screen' ? t(fr.media.tiles.screen, { name: personName(participant) }) : personName(participant);
}

// Son nom pour les lecteurs d'écran, qui dit aussi un micro coupé (une icône, à l'écran).
function tileLabel({ participant, source }: TileSpec): string {
  const name = personName(participant);
  if (source === 'screen') return t(fr.media.tiles.screen, { name });
  return t(participant.mic ? fr.media.tiles.camera : fr.media.tiles.cameraMuted, { name });
}

// Une vignette, et son bouton « Plein écran » quand elle peut y passer, côte à côte dans un même cadre : un bouton ne peut pas en
// contenir un autre. Les attributs data-* (que lisent les tests) sont sur la vignette elle-même.
function Tile({
  ref,
  tile,
  large,
  client,
  onClick,
  onFullscreen,
}: {
  ref: Ref<HTMLButtonElement>;
  tile: TileSpec;
  large: boolean;
  client: MediaClient;
  onClick(event: MouseEvent): void;
  onFullscreen?: () => void;
}) {
  const { participant, source } = tile;
  const showVideo = source === 'screen' || participant.cam;
  return (
    <div className="tile-frame">
      <button
        ref={ref}
        type="button"
        className={`tile tile-${source}`}
        aria-label={tileLabel(tile)}
        aria-pressed={large}
        title={large ? fr.media.tiles.shrink : fr.media.tiles.enlarge}
        data-participant={participant.id}
        data-source={source}
        data-local={participant.isLocal ? '' : undefined}
        data-speaking={source === 'camera' && participant.speaking ? '' : undefined}
        onClick={onClick}
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
              <MicIcon off />
            </span>
          )}
          <span className="tile-name">{tileName(tile)}</span>
        </span>
      </button>
      {onFullscreen && (
        <button
          type="button"
          className="tile-fullscreen"
          aria-label={t(source === 'screen' ? fr.media.fullscreen.screen : fr.media.fullscreen.camera, { name: personName(participant) })}
          title={fr.media.fullscreen.enter}
          onClick={onFullscreen}
        >
          <FullscreenIcon />
        </button>
      )}
    </div>
  );
}

// La scène du plein écran : toujours dans la page, cachée hors plein écran (le CSS), et vide tant qu'aucune vignette n'y est. En plein
// écran : la vidéo en entier sur fond noir (ou les initiales), le nom et le micro en bas à gauche, « Quitter le plein écran » en haut à
// droite et, quand il y a d'autres vignettes, un chevron de chaque côté. Les boutons s'effacent quand la souris ne bouge plus
// (CONTROLS_IDLE_MS) ; un double-clic sur la vidéo sort du plein écran, comme dans un lecteur.
function FullscreenScene({
  ref,
  tile,
  client,
  active,
  onStep,
  onExit,
}: {
  ref: Ref<HTMLDivElement>;
  tile: TileSpec | null;
  client: MediaClient;
  active: boolean;
  onStep?: (delta: -1 | 1) => void;
  onExit(): void;
}) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // Le dernier appui est tombé sur la scène pendant que les boutons étaient effacés (onPointerDown).
  const blindPress = useRef(false);
  function wake() {
    setIdle(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), CONTROLS_IDLE_MS);
  }
  useEffect(() => {
    if (!active) return;
    wake();
    return () => {
      window.clearTimeout(timer.current);
      setIdle(false);
    };
  }, [active]);

  // Le clavier est au plein écran, et à lui seul : aucune touche enfoncée n'en sort (stopPropagation) vers le jeu, qui écoute la fenêtre
  // (game/input.ts). Sinon les flèches et ZQSD feraient marcher l'avatar qu'on ne voit plus (et, s'il quittait la zone, la conversation se
  // déferait, et le plein écran avec elle), E actionnerait ce qui est à portée, + − 0 changeraient le zoom. Les relâchements (keyup), si :
  // une touche enfoncée avant le plein écran est bien relâchée. Tab boucle sur les boutons de la scène, sans aller à ce qui est derrière,
  // qu'on ne voit pas. Hors plein écran, la scène ne prend rien.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!active) return;
    event.stopPropagation();
    wake();
    if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
      const [first, last] = [controls[0], controls[controls.length - 1]];
      const focused = document.activeElement;
      if (!first || !last) event.preventDefault();
      else if (event.shiftKey && (focused === first || focused === event.currentTarget)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (!ARROWS.has(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') onStep?.(-1);
    else if (event.key === 'ArrowRight') onStep?.(1);
  }
  function onDoubleClick(event: MouseEvent) {
    if (!(event.target instanceof Element) || event.target.closest('button') === null) onExit();
  }
  // Un appui sur un bouton effacé ne fait que réveiller les boutons : on ne quitte pas le plein écran (ni ne change de vignette) sans avoir
  // vu le bouton. Effacé, un bouton ne reçoit pas le pointeur (le CSS) : la scène reçoit l'appui (`blindPress`). Mais le navigateur peut
  // donner le clic qui suit au bouton réapparu entre-temps (Chrome le fait pour un toucher) : ce clic-là ne compte pas. Un clic au clavier
  // (`detail` à 0) compte toujours.
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    blindPress.current = active && idle && !(event.target instanceof Element && event.target.closest('button'));
    wake();
  }
  function onClickCapture(event: MouseEvent) {
    if (!blindPress.current || event.detail === 0) return;
    blindPress.current = false;
    if (event.target instanceof Element && event.target.closest('button')) event.stopPropagation();
  }

  const participant = tile?.participant;
  return (
    <div
      ref={ref}
      className="video-fullscreen"
      role={tile ? 'group' : undefined}
      aria-label={tile ? tileLabel(tile) : undefined}
      tabIndex={-1}
      data-idle={active && idle ? '' : undefined}
      // Un toucher sans glisser (un écran tactile) ne fait pas de pointermove : l'appui réveille les boutons aussi.
      onPointerMove={wake}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    >
      {tile && participant && (
        <>
          {tile.source === 'screen' || participant.cam ? (
            <TileVideo
              client={client}
              participantId={participant.id}
              source={tile.source}
              mirrored={participant.isLocal && tile.source === 'camera'}
              className="video-fullscreen-video"
            />
          ) : (
            <span className="video-fullscreen-initials" aria-hidden="true">
              {initials(participant.name)}
            </span>
          )}
          <span className={`video-fullscreen-label${participant.speaking ? ' is-speaking' : ''}`} aria-hidden="true">
            {!participant.mic && (
              <span className="tile-muted">
                <MicIcon off />
              </span>
            )}
            <span className="tile-name">{tileName(tile)}</span>
          </span>
          {onStep && (
            <>
              <button
                type="button"
                className="video-fullscreen-control video-fullscreen-previous"
                aria-label={fr.media.fullscreen.previous}
                aria-keyshortcuts="ArrowLeft"
                title={fr.media.fullscreen.previous}
                onClick={() => onStep(-1)}
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                className="video-fullscreen-control video-fullscreen-next"
                aria-label={fr.media.fullscreen.next}
                aria-keyshortcuts="ArrowRight"
                title={fr.media.fullscreen.next}
                onClick={() => onStep(1)}
              >
                <ChevronRightIcon />
              </button>
            </>
          )}
          <button
            type="button"
            className="video-fullscreen-control video-fullscreen-exit"
            aria-label={fr.media.fullscreen.exit}
            aria-keyshortcuts="Escape"
            title={fr.media.fullscreen.exit}
            onClick={onExit}
          >
            <FullscreenIcon exit />
          </button>
        </>
      )}
    </div>
  );
}

// La vidéo d'une vignette : le client y attache la piste de la personne, avec l'élément (useLayoutEffect : jamais de vignette vide à
// l'écran), et la suit (piste qui arrive, change ou part) jusqu'au démontage, qui la détache. Muette : le son des autres joue dans ses
// propres éléments.
function TileVideo({
  client,
  participantId,
  source,
  mirrored,
  className = 'tile-video',
}: {
  client: MediaClient;
  participantId: string;
  source: VideoSource;
  mirrored: boolean;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = true;
    return client.attach(element, participantId, source);
  }, [client, participantId, source]);
  return <video ref={video} className={mirrored ? `${className} tile-video-mirrored` : className} autoPlay muted playsInline />;
}

// Le navigateur permet-il le plein écran d'un élément ? (Absent de jsdom, et de Safari sur iPhone.)
function fullscreenAvailable(): boolean {
  return document.fullscreenEnabled === true && typeof Element.prototype.requestFullscreen === 'function';
}
