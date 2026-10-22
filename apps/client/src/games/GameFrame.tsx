import { GAME_DRAW_OFFER_MIN_MOVES, GAME_TURN_WARNING_MS, seededRng, type GameId, type GameMatchView, type GameTableView } from '@bureau/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { audioEngine } from '../audio/audio';
import type { SfxId } from '../audio/catalog';
import { prefersReducedMotion } from '../game/reduced-motion';
import { fr, t } from '../i18n/fr';
import { sendGameCommand } from '../net/game-commands';
import type { OfficeSocket } from '../net/socket';
import { Alert } from '../pages/AuthLayout';
import { useOfficeStore } from '../state/office-store';
import { AvatarPortrait } from '../office/ui/AvatarPortrait';
import { Segmented } from '../office/ui/Segmented';
import { GameLobby } from './GameLobby';
import { Ladder } from './Ladder';
import { ResignDialog } from './ResignDialog';
import { chairOf, countdownVisible, endText, formatClock, formatDelta, ratingLines, seatOf, soleWinner } from './table-view';
import type { GamePlayerView } from './types';
import type { GameModuleState } from './use-game-module';

// L'espace entre deux sons d'un même lot (un doublet : quatre pions posés l'un après l'autre) : le moteur audio écarte un même effet rejoué avant son délai (120 ms pour un pion).
export const GAME_SOUND_GAP_MS = 200;

export interface GameFrameProps {
  game: GameId;
  socket: OfficeSocket | null;
  module: GameModuleState;
  // Le bouton « Règles » de l'en-tête du panneau est enfoncé : l'aide du jeu s'affiche en haut du cadre.
  rulesOpen: boolean;
}

type Tab = 'match' | 'ladder';

// Le cadre du panneau d'un jeu, commun aux quatre : l'onglet « Partie » (les joueurs, le plateau que fournit le module du jeu, la ligne d'état, les gestes, les spectateurs) et l'onglet
// « Classement ». Avant la première partie de la table, et après chaque fin, la salle d'attente (GameLobby) est au-dessus du plateau.
export function GameFrame({ game, socket, module, rulesOpen }: GameFrameProps) {
  const table = useOfficeStore((state) => state.games[game]);
  const selfId = useOfficeStore((state) => state.selfId);
  const interrupted = useOfficeStore((state) => state.gameInterrupted === game);
  const baseId = useId();
  const [tab, setTab] = useState<Tab>('match');

  if (!table) {
    return (
      <div className="game-frame">
        <p className="desk-hint">{fr.games.soon}</p>
      </div>
    );
  }
  const panelId = `${baseId}-panel`;
  const tabId = (id: Tab) => `${baseId}-tab-${id}`;
  // Le classement est relu quand la partie de cette table change d'état (la fin : les notes viennent de bouger).
  const refreshKey = `${table.match?.id ?? 'aucune'}:${table.match?.status ?? ''}`;

  return (
    <div className="game-frame">
      {interrupted && (
        <div className="game-interrupted" role="alert">
          <p>{fr.games.interrupted}</p>
          <button type="button" className="bar-button" onClick={() => useOfficeStore.getState().dismissGameInterrupted()}>
            {fr.games.dismiss}
          </button>
        </div>
      )}
      {rulesOpen && module.status === 'ready' && (
        <section className="game-rules" aria-label={fr.games.rulesTitle}>
          <h3 className="desk-subtitle">{fr.games.rulesTitle}</h3>
          <ul>
            {module.module.ui.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>
      )}
      <Segmented
        label={fr.games.tabs.label}
        value={tab}
        options={[
          { id: 'match', label: fr.games.tabs.match },
          { id: 'ladder', label: fr.games.tabs.ladder },
        ]}
        onSelect={(id) => setTab(id)}
        panelId={panelId}
        tabId={tabId}
      />
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(tab)} className="game-tabpanel">
        {tab === 'ladder' ? <Ladder game={game} socket={socket} refreshKey={refreshKey} selfId={selfId} /> : <MatchView game={game} table={table} socket={socket} module={module} selfId={selfId} />}
      </div>
    </div>
  );
}

// Le seul changement qui compte pour un « saut » : la table passe à la version qui suit tout juste la précédente (un coup, un événement), ou elle y saute (le panneau vient de
// s'ouvrir, la connexion est revenue, un message a été manqué). Au saut, le plateau ne reçoit aucun événement : il passe à l'état final sans animer.
function useConsecutive(version: number): boolean {
  const [seen, setSeen] = useState<{ version: number; consecutive: boolean } | null>(null);
  if (seen === null || seen.version !== version) setSeen({ version, consecutive: seen !== null && version === seen.version + 1 });
  return seen?.consecutive ?? false;
}

// Une horloge qui bat chaque seconde tant qu'elle est active : de quoi mettre à jour un compte à rebours. Rend l'heure de la page (performance.now).
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function MatchView({ game, table, socket, module, selfId }: { game: GameId; table: GameTableView; socket: OfficeSocket | null; module: GameModuleState; selfId: string | null }) {
  const match: GameMatchView | null = table.match;
  const def = module.status === 'ready' ? module.module.def : null;
  const ui = module.status === 'ready' ? module.module.ui : null;
  const mySeat = seatOf(match, selfId);
  const myChair = chairOf(table, selfId);
  const playing = match?.status === 'playing';
  const consecutive = useConsecutive(table.version);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const warned = useRef<number | null>(null);

  // Le compte à rebours : ce que le serveur a dit en ms restantes (turnMs, reconnectMs) à la réception de cette version, moins ce qui s'est écoulé depuis.
  const tick = useTick(playing);
  const receivedAt = useMemo(() => performance.now(), [table.version]);
  const elapsed = Math.max(0, tick - receivedAt);

  const turn = playing && def && match ? def.turn(match.state) : null;
  const canAct = playing && mySeat !== null && turn === mySeat && !pending;
  const events = consecutive && match ? match.events : [];
  const names = match?.players.map((player) => player.name) ?? [];

  // Le serveur a répondu (la table a une nouvelle version) : plus rien n'attend.
  useEffect(() => {
    setPending(false);
  }, [table.version]);

  // Les sons du lot d'événements (le panneau ouvert, et seulement un changement qui suit le précédent), et celui de la victoire après eux : à la suite les uns des autres, espacés de
  // GAME_SOUND_GAP_MS. Une nouvelle version coupe ce qu'il en reste.
  useEffect(() => {
    if (!consecutive || !match || !ui) return;
    const effects: SfxId[] = ui.sounds(match.events as never[], mySeat);
    if (match.status === 'ended' && mySeat !== null && soleWinner(match.result) === mySeat) effects.push('win');
    // Le premier tout de suite, les autres à la suite.
    const [first, ...later] = effects;
    if (first !== undefined) audioEngine.playSfx(first);
    const timers = later.map((effect, index) => setTimeout(() => audioEngine.playSfx(effect), (index + 1) * GAME_SOUND_GAP_MS));
    return () => timers.forEach(clearTimeout);
    // Seulement à chaque nouvelle version : le reste est la même partie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.version]);

  // Ce que le lecteur d'écran entend : la fin de la partie, ou ce que le jeu annonce de ses événements, et « À toi de jouer » quand le trait lui passe.
  useEffect(() => {
    if (!match) {
      setAnnouncement('');
      return;
    }
    const parts: string[] = [];
    if (match.status === 'ended' && match.result) parts.push(endText(match.result, names, ui ? (r, who) => ui.describeResult(r, who, match.state) : null));
    else if (consecutive && ui) {
      const own = ui.announce(match.events as never[], match.state, names);
      if (own) parts.push(own);
    }
    if (playing && mySeat !== null && turn === mySeat) parts.push(fr.games.status.yourTurn);
    setAnnouncement(parts.join(' '));
    warned.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.version]);

  const turnLeft = match?.turnMs === null || match?.turnMs === undefined ? null : match.turnMs - elapsed;
  // La dernière minute de celui qui doit agir : annoncée une fois au lecteur d'écran, pour lui seul.
  useEffect(() => {
    if (turnLeft === null || turnLeft > GAME_TURN_WARNING_MS || mySeat === null || turn !== mySeat || warned.current === table.version) return;
    warned.current = table.version;
    setAnnouncement((previous) => (previous ? `${previous} ${fr.games.timeWarning}` : fr.games.timeWarning));
  }, [turnLeft, mySeat, turn, table.version]);

  // Une commande : refusée, le serveur dit pourquoi (`stale`, un double clic ou un coup sur un état dépassé, se tait).
  async function send(command: Parameters<typeof sendGameCommand>[1]): Promise<boolean> {
    const ack = await sendGameCommand(socket, command);
    if (ack.ok) {
      setMessage(null);
      return true;
    }
    if (ack.error !== 'stale') setMessage(fr.games.errors[ack.error]);
    return false;
  }

  async function onMove(move: unknown) {
    setPending(true);
    if (!(await send({ type: 'move', game, version: table.version, move }))) setPending(false);
  }

  const players: GamePlayerView[] = match
    ? match.players.map(({ userId, name, avatarKey, connected }) => ({ userId, name, avatarKey, connected }))
    : table.chairs.flatMap((chair) => (chair ? [{ userId: chair.userId, name: chair.name, avatarKey: chair.avatarKey, connected: chair.connected }] : []));

  // Le plateau d'aperçu, avant la première partie : l'état de départ du jeu, pour autant de joueurs qu'il y a d'assis (au moins le minimum).
  const seatedCount = players.length;
  const previewState = useMemo(() => {
    if (!def || match) return null;
    const seats = Math.min(def.maxPlayers, Math.max(def.minPlayers, seatedCount));
    return def.create({ seats, first: 0 }, seededRng(1)).state;
  }, [def, match, seatedCount]);

  const boardState = match ? match.state : previewState;
  let status = '';
  if (!match) status = fr.games.status.waiting;
  else if (match.status === 'ended' && match.result) status = endText(match.result, names, ui ? (r, who) => ui.describeResult(r, who, match.state) : null);
  else if (turn !== null) status = turn === mySeat ? fr.games.status.yourTurn : t(fr.games.status.turnOf, { name: names[turn] ?? '' });
  else if (mySeat === null) status = fr.games.status.watching;

  const lines = match?.status === 'ended' ? ratingLines(match) : [];
  const spectators = table.spectators;
  const offer = match?.drawOffer ?? null;
  // Le serveur refuse la nulle (`too_early`) tant que chaque camp n'a pas joué un coup : le bouton le dit avant, au lieu de laisser cliquer pour recevoir une erreur.
  const drawTooEarly = def && match ? def.countedMoves(match.state) < GAME_DRAW_OFFER_MIN_MOVES : false;

  return (
    <div className="game-match">
      {message && <Alert>{message}</Alert>}
      {match && ui && (
        <ul className="game-players" aria-label={fr.games.tabs.match}>
          {match.players.map((player, seat) => {
            const label = ui.seatLabel(seat, match.state);
            const mine = player.userId === selfId;
            const hasTurn = playing && turn === seat;
            const reconnectLeft = player.reconnectMs === null ? null : player.reconnectMs - elapsed;
            return (
              <li key={player.userId} className="game-player" data-seat={seat} data-turn={hasTurn || undefined} data-mine={mine || undefined}>
                <AvatarPortrait avatarKey={player.avatarKey} name={player.name} size={32} />
                <span className="game-player-name" title={player.name}>
                  {player.name}
                  {mine && <span className="game-you"> ({fr.games.you})</span>}
                </span>
                <span className="game-seat">
                  <i className="game-seat-dot" style={{ background: label.color }} aria-hidden="true" />
                  {label.name}
                </span>
                {hasTurn && <span className="game-turn">{fr.games.turn}</span>}
                {hasTurn && countdownVisible(turnLeft) && <span className="game-clock">{t(fr.games.countdown, { time: formatClock(turnLeft!) })}</span>}
                {!player.connected && <span className="game-clock">{reconnectLeft === null ? fr.games.lobby.disconnected : t(fr.games.reconnect, { time: formatClock(reconnectLeft) })}</span>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="game-board" data-game={game}>
        {module.status === 'loading' && (
          <p className="desk-hint" role="status">
            {fr.games.loading}
          </p>
        )}
        {module.status === 'failed' && <Alert>{fr.games.loadFailed}</Alert>}
        {module.status === 'soon' && (
          <div className="game-soon">
            <strong>{fr.games.soon}</strong>
            <p className="desk-hint">{fr.games.soonHint}</p>
          </div>
        )}
        {ui && boardState !== null && (
          <ui.Board state={boardState} mySeat={match ? mySeat : null} players={players} events={events as never[]} canAct={canAct} onMove={(move) => void onMove(move)} reducedMotion={prefersReducedMotion()} preview={!match} />
        )}
      </div>

      <p className="game-status">{status}</p>
      {match?.status === 'ended' && (
        <div className="game-end">
          {match.ranked === false && <p className="desk-hint">{fr.games.end.unranked}</p>}
          {lines.length > 0 && (
            <ul className="game-ratings">
              {lines.map((line) => (
                <li key={line.userId}>{t(fr.games.end.ratingLine, { name: line.name, before: line.before, after: line.after, delta: formatDelta(line.delta) })}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {playing && mySeat !== null && (
        <div className="game-actions">
          {def?.drawOffers && offer === null && (
            <button
              type="button"
              className="bar-button"
              disabled={drawTooEarly}
              title={drawTooEarly ? fr.games.errors.too_early : undefined}
              onClick={() => void send({ type: 'draw', game, action: 'offer' })}
            >
              {fr.games.draw.offer}
            </button>
          )}
          {offer === mySeat && <p className="desk-hint">{fr.games.draw.offered}</p>}
          {offer !== null && offer !== mySeat && (
            <>
              <p className="desk-hint">{t(fr.games.draw.received, { name: names[offer] ?? '' })}</p>
              <button type="button" className="bar-button" onClick={() => void send({ type: 'draw', game, action: 'accept' })}>
                {fr.games.draw.accept}
              </button>
              <button type="button" className="bar-button" onClick={() => void send({ type: 'draw', game, action: 'decline' })}>
                {fr.games.draw.decline}
              </button>
            </>
          )}
          <button type="button" className="bar-button bar-button-danger" onClick={() => setConfirming(true)}>
            {fr.games.actions.resign}
          </button>
        </div>
      )}
      {confirming && (
        <ResignDialog
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void send({ type: 'resign', game });
          }}
        />
      )}

      {(!match || match.status === 'ended') && <GameLobby game={game} table={table} def={def} selfId={selfId} socket={socket} rematch={match?.status === 'ended'} onMessage={setMessage} />}
      {myChair === null && playing && <p className="desk-hint">{fr.games.status.watching}</p>}

      {spectators.length > 0 && (
        <p className="game-spectators desk-hint">
          {t(spectators.length === 1 ? fr.games.spectators.one : fr.games.spectators.many, { count: spectators.length, names: spectators.map((spectator) => spectator.name).join(', ') })}
        </p>
      )}
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
