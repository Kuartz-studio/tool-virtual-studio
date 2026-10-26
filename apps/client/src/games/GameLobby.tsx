import { refusesGameInvites, roomOfTable, type AnyGameDefinition, type GameId, type GameTableView } from '@bureau/shared';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from '../game/reduced-motion';
import { fr, t } from '../i18n/fr';
import { sendGameCommand } from '../net/game-commands';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { SmallCheckIcon } from '../office/icons';
import { AvatarPortrait } from '../office/ui/AvatarPortrait';
import { chairOf, rematchLine } from './table-view';

// La marge que garde la barre de la revanche au bord du corps du panneau quand il défile pour la montrer.
const REVEAL_MARGIN_PX = 12;

export interface GameLobbyProps {
  game: GameId;
  table: GameTableView;
  // Les règles du jeu, quand le module est là : le nombre de joueurs qu'il faut.
  def: AnyGameDefinition | null;
  selfId: string | null;
  socket: OfficeSocket | null;
  // La partie d'avant est finie : « Prêt » devient « Revanche », dans la barre de la revanche (RematchBar), sous la phrase de fin.
  rematch: boolean;
  // Un refus (ou un message) à montrer au-dessus du plateau ; null l'efface.
  onMessage(text: string | null): void;
}

// Envoie une commande de jeu : si le serveur la refuse, on dit pourquoi (un coup trop tardif, double clic ou état dépassé, se tait) ; acceptée, le message s'efface.
function commandSender(socket: OfficeSocket | null, onMessage: (text: string | null) => void) {
  return async (command: Parameters<typeof sendGameCommand>[1]): Promise<boolean> => {
    const ack = await sendGameCommand(socket, command);
    if (ack.ok) {
      onMessage(null);
      return true;
    }
    if (ack.error !== 'stale') onMessage(fr.games.errors[ack.error]);
    return false;
  };
}

// La salle d'attente d'une table : les chaises (qui est assis, qui est prêt, qui est déconnecté), « S'asseoir » et « Se lever », « Prêt », et, assis, l'invitation d'une personne
// du bureau. Après une partie, « Prêt » est le bouton « Revanche » de la barre de la revanche, plus haut, qui dit aussi qui on attend ; les chaises disent qui l'a acceptée.
// Chaque geste est une commande de jeu (`game:do`) : la table ne change qu'à l'annonce du serveur (`game:table`). Une commande refusée dit pourquoi.
export function GameLobby({ game, table, def, selfId, socket, rematch, onMessage }: GameLobbyProps) {
  const titleId = useId();
  const mine = chairOf(table, selfId);
  const seated = table.chairs.flatMap((chair) => (chair ? [chair] : []));
  const waiting = seated.filter((chair) => !chair.ready).map((chair) => chair.name);
  const send = commandSender(socket, onMessage);

  // Après une partie, assis, la barre de la revanche dit déjà où l'on en est : pas de seconde phrase.
  let hint: string | null;
  if (mine === null) hint = fr.games.lobby.sitHint;
  else if (rematch) hint = null;
  else if (def && seated.length < def.minPlayers) hint = t(fr.games.lobby.needMore, { count: def.minPlayers });
  else if (waiting.length > 0) hint = t(fr.games.lobby.waitingFor, { names: waiting.join(', ') });
  else hint = fr.games.lobby.allReady;

  return (
    <section className="game-lobby" aria-labelledby={titleId}>
      <h3 id={titleId} className="desk-subtitle">
        {fr.games.lobby.title}
      </h3>
      <ul className="game-chairs">
        {table.chairs.map((chair, index) => {
          const isMine = chair !== null && chair.userId === selfId;
          return (
            <li key={index} className="game-chair" data-chair={index} data-mine={isMine || undefined} data-ready={chair?.ready || undefined} data-free={chair === null || undefined}>
              {chair === null ? (
                <>
                  <span className="game-chair-free">
                    {fr.games.lobby.free}
                    <span className="visually-hidden"> — {t(fr.games.lobby.seatLabel, { n: index + 1 })}</span>
                  </span>
                  {mine === null && (
                    <button type="button" className="bar-button" aria-label={t(fr.games.lobby.sitAt, { n: index + 1 })} onClick={() => void send({ type: 'sit', game, chair: index })}>
                      {fr.games.lobby.sit}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <AvatarPortrait avatarKey={chair.avatarKey} name={chair.name} size={32} />
                  <span className="game-chair-name" title={chair.name}>
                    {chair.name}
                    {isMine && <span className="game-you"> ({fr.games.you})</span>}
                  </span>
                  <span className="game-chair-state">
                    {!chair.connected ? fr.games.lobby.disconnected : chair.ready ? (rematch ? fr.games.rematch.accepted : fr.games.lobby.ready.toLowerCase()) : ''}
                  </span>
                  {isMine && (
                    <span className="game-chair-actions">
                      {!rematch && (
                        <button
                          type="button"
                          className="bar-button game-ready"
                          aria-pressed={chair.ready}
                          onClick={() => void send({ type: 'ready', game, ready: !chair.ready })}
                        >
                          {fr.games.lobby.ready}
                        </button>
                      )}
                      <button type="button" className="bar-button" onClick={() => void send({ type: 'stand', game })}>
                        {fr.games.lobby.stand}
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {hint !== null && <p className="desk-hint game-lobby-hint">{hint}</p>}
      {mine !== null && <InvitePicker game={game} table={table} send={send} onMessage={onMessage} />}
    </section>
  );
}

export interface RematchBarProps {
  game: GameId;
  table: GameTableView;
  // Le nombre de joueurs qu'il faut au jeu, quand son module est là.
  minPlayers: number | null;
  selfId: string | null;
  socket: OfficeSocket | null;
  // Le plateau est dessiné (le module du jeu est chargé, ou ne viendra pas) : la barre est à sa place, on peut la montrer.
  settled: boolean;
  onMessage(text: string | null): void;
}

// La revanche, juste sous la phrase de fin, pour une personne assise : le bouton « Revanche » (c'est « prêt » ; enfoncé, la revanche est demandée, et un second clic l'annule) et
// la phrase qui dit qui l'a déjà acceptée et qui on attend. La partie suivante commence dès que toutes les personnes assises l'ont acceptée (le serveur en décide). À la fin d'une
// partie, ou quand le panneau s'ouvre sur une partie finie, le corps du panneau défile juste ce qu'il faut pour la montrer : sous un grand plateau, elle serait sous le pli.
export function RematchBar({ game, table, minPlayers, selfId, socket, settled, onMessage }: RematchBarProps) {
  const root = useRef<HTMLDivElement>(null);
  const matchId = table.match?.id ?? null;
  useLayoutEffect(() => {
    if (!settled) return undefined;
    // Une image plus tard : un plateau qui se mesure à son arrivée (sa largeur, puis sa hauteur) a pris sa taille.
    const frame = requestAnimationFrame(() => {
      if (root.current) revealInPanel(root.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [matchId, settled]);

  const mine = table.chairs.find((chair) => chair?.userId === selfId) ?? null;
  if (mine === null) return null;
  const send = commandSender(socket, onMessage);
  return (
    <div ref={root} className="game-rematch">
      <button
        type="button"
        className="bar-button is-primary game-ready game-rematch-button"
        aria-pressed={mine.ready}
        title={mine.ready ? fr.games.rematch.cancelTip : undefined}
        onClick={() => void send({ type: 'ready', game, ready: !mine.ready })}
      >
        {mine.ready && <SmallCheckIcon />}
        {fr.games.actions.rematch}
      </button>
      <p className="game-rematch-line" role="status">
        {rematchLine(table, selfId, minPlayers)}
      </p>
    </div>
  );
}

// Fait défiler le corps du panneau qui contient cet élément juste ce qu'il faut pour qu'il s'y voie en entier, avec ce qui est juste au-dessus de lui (la phrase de fin) et une
// petite marge ; rien s'il s'y voit déjà. En douceur, sauf en mouvement réduit.
function revealInPanel(element: HTMLElement): void {
  const body = element.closest<HTMLElement>('.drawer-body');
  if (!body) return;
  const box = element.getBoundingClientRect();
  const top = Math.min(box.top, element.previousElementSibling?.getBoundingClientRect().top ?? box.top);
  const view = body.getBoundingClientRect();
  let delta = 0;
  if (box.bottom + REVEAL_MARGIN_PX > view.bottom) delta = box.bottom + REVEAL_MARGIN_PX - view.bottom;
  else if (top - REVEAL_MARGIN_PX < view.top) delta = top - REVEAL_MARGIN_PX - view.top;
  if (delta === 0) return;
  body.scrollTo({ top: body.scrollTop + delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// L'invitation d'une personne du bureau à la table : la liste de ceux qui sont en ligne et ne sont pas assis ici, chacun avec son bouton. Qui ne veut pas être dérangé (« Ne pas
// déranger », un mode qui ferme la porte ou qui conduit ailleurs) n'a pas de bouton : le serveur refuserait.
function InvitePicker({ game, table, send, onMessage }: { game: GameId; table: GameTableView; send: (command: { type: 'invite'; game: GameId; userId: string }) => Promise<boolean>; onMessage(text: string | null): void }) {
  const players = useOfficeStore((state) => state.players);
  // La pièce de la table : un mode dont l'emplacement est cette pièce ne conduit pas ailleurs (voir refusesGameInvites).
  const officeMap = useOfficeStore((state) => state.officeMap);
  const tableRoom = useMemo(() => {
    const placed = officeMap?.tables.find((candidate) => candidate.game === game);
    return officeMap && placed ? (roomOfTable(officeMap, placed)?.key ?? null) : null;
  }, [officeMap, game]);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const listId = useId();
  const seatedIds = new Set(table.chairs.flatMap((chair) => (chair ? [chair.userId] : [])));
  const people = Object.values(players)
    .filter((player) => !seatedIds.has(player.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  async function invite(player: { id: string; name: string }) {
    setSent(null);
    onMessage(null);
    if (await send({ type: 'invite', game, userId: player.id })) setSent(t(fr.games.invite.sent, { name: player.name }));
  }

  return (
    <div className="game-invite">
      <button type="button" className="bar-button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
        {fr.games.invite.toggle}
      </button>
      {open && (
        <div id={listId} className="game-invite-list">
          {people.length === 0 ? (
            <p className="desk-hint">{fr.games.invite.nobody}</p>
          ) : (
            <ul>
              {people.map((player) => {
                const refuses = refusesGameInvites(player, tableRoom);
                return (
                  <li key={player.id} className="game-invite-row">
                    <AvatarPortrait avatarKey={player.avatarKey} name={player.name} size={28} />
                    <span className="game-invite-name" title={player.name}>
                      {player.name}
                    </span>
                    <button
                      type="button"
                      className="bar-button"
                      aria-label={t(fr.games.invite.sendLabel, { name: player.name })}
                      disabled={refuses}
                      title={refuses ? fr.games.errors.dnd : undefined}
                      onClick={() => void invite(player)}
                    >
                      {fr.games.invite.send}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {sent && (
            <p className="desk-hint" role="status">
              {sent}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
