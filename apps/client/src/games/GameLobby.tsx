import { refusesGameInvites, roomOfTable, type AnyGameDefinition, type GameId, type GameTableView } from '@bureau/shared';
import { useId, useMemo, useState } from 'react';
import { fr, t } from '../i18n/fr';
import { sendGameCommand } from '../net/game-commands';
import type { OfficeSocket } from '../net/socket';
import { useOfficeStore } from '../state/office-store';
import { AvatarPortrait } from '../office/ui/AvatarPortrait';
import { chairOf } from './table-view';

export interface GameLobbyProps {
  game: GameId;
  table: GameTableView;
  // Les règles du jeu, quand le module est là : le nombre de joueurs qu'il faut.
  def: AnyGameDefinition | null;
  selfId: string | null;
  socket: OfficeSocket | null;
  // La partie d'avant est finie : « Prêt » devient « Revanche ».
  rematch: boolean;
  // Un refus (ou un message) à montrer au-dessus du plateau ; null l'efface.
  onMessage(text: string | null): void;
}

// La salle d'attente d'une table : les chaises (qui est assis, qui est prêt, qui est déconnecté), « S'asseoir » et « Se lever », « Prêt » (ou « Revanche »), et, assis, l'invitation
// d'une personne du bureau. Chaque geste est une commande de jeu (`game:do`) : la table ne change qu'à l'annonce du serveur (`game:table`). Une commande refusée dit pourquoi.
export function GameLobby({ game, table, def, selfId, socket, rematch, onMessage }: GameLobbyProps) {
  const titleId = useId();
  const mine = chairOf(table, selfId);
  const seated = table.chairs.flatMap((chair) => (chair ? [chair] : []));
  const waiting = seated.filter((chair) => !chair.ready).map((chair) => chair.name);

  // Une commande : si le serveur la refuse, on dit pourquoi (un coup trop tardif, double clic ou état dépassé, se tait).
  async function send(command: Parameters<typeof sendGameCommand>[1]): Promise<boolean> {
    const ack = await sendGameCommand(socket, command);
    if (ack.ok) {
      onMessage(null);
      return true;
    }
    if (ack.error !== 'stale') onMessage(fr.games.errors[ack.error]);
    return false;
  }

  let hint: string;
  if (mine === null) hint = fr.games.lobby.sitHint;
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
                  <span className="game-chair-state">{!chair.connected ? fr.games.lobby.disconnected : chair.ready ? fr.games.lobby.ready.toLowerCase() : ''}</span>
                  {isMine && (
                    <span className="game-chair-actions">
                      <button
                        type="button"
                        className="bar-button game-ready"
                        aria-pressed={chair.ready}
                        onClick={() => void send({ type: 'ready', game, ready: !chair.ready })}
                      >
                        {rematch ? fr.games.actions.rematch : fr.games.lobby.ready}
                      </button>
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
      <p className="desk-hint game-lobby-hint">{hint}</p>
      {mine !== null && <InvitePicker game={game} table={table} send={send} onMessage={onMessage} />}
    </section>
  );
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
