import type { GameId, LadderAck, LadderRow } from '@bureau/shared';
import { useCallback, useEffect, useState } from 'react';
import { fr, t } from '../i18n/fr';
import { fetchLadder } from '../net/game-commands';
import type { OfficeSocket } from '../net/socket';

// Le classement d'un jeu : les dix premiers (rang, nom, note, parties, victoires, nulles, défaites), et sa propre ligne, avec son vrai rang, quand elle est au-delà. Lu à l'ouverture
// de l'onglet, et relu à chaque fois que `refreshKey` change (la fin d'une partie à cette table : les notes viennent de bouger). Les ex æquo partagent le rang du serveur.
type State = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; top: LadderRow[]; me: LadderRow | null };

function Row({ row, mine }: { row: LadderRow; mine: boolean }) {
  return (
    <tr className="ladder-row" data-mine={mine || undefined} aria-current={mine ? 'true' : undefined}>
      <td className="ladder-rank">{row.rank}</td>
      <th scope="row" className="ladder-name">
        {row.name}
        {mine && <span className="ladder-you"> ({fr.games.you})</span>}
      </th>
      <td className="ladder-rating">{row.rating}</td>
      <td>{row.games}</td>
      <td className="ladder-record">
        {row.wins} / {row.draws} / {row.losses}
      </td>
    </tr>
  );
}

export function Ladder({ game, socket, refreshKey, selfId }: { game: GameId; socket: OfficeSocket | null; refreshKey: string; selfId: string | null }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  // Un rechargement demandé (« Réessayer »).
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let current = true;
    void fetchLadder(socket, game).then((answer: LadderAck) => {
      if (!current) return;
      setState(answer.ok ? { status: 'ready', top: answer.top, me: answer.me } : { status: 'failed' });
    });
    return () => {
      current = false;
    };
  }, [socket, game, refreshKey, attempt]);

  if (state.status === 'loading') {
    return (
      <p className="desk-hint" role="status">
        {fr.games.ladder.loading}
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <div className="game-ladder">
        <p className="desk-hint" role="alert">
          {fr.games.ladder.failed}
        </p>
        <button type="button" className="bar-button" onClick={load}>
          {fr.games.ladder.retry}
        </button>
      </div>
    );
  }
  if (state.top.length === 0) {
    return <p className="desk-hint">{fr.games.ladder.empty}</p>;
  }
  const meBeyond = state.me !== null && !state.top.some((row) => row.userId === state.me!.userId);
  return (
    <div className="game-ladder">
      <table className="ladder">
        <caption className="visually-hidden">{t(fr.games.ladder.table, { game: fr.games.names[game] })}</caption>
        <thead>
          <tr>
            <th scope="col">{fr.games.ladder.rank}</th>
            <th scope="col">{fr.games.ladder.player}</th>
            <th scope="col">{fr.games.ladder.rating}</th>
            <th scope="col">{fr.games.ladder.games}</th>
            <th scope="col">{fr.games.ladder.record}</th>
          </tr>
        </thead>
        <tbody>
          {state.top.map((row) => (
            <Row key={row.userId} row={row} mine={row.userId === selfId} />
          ))}
        </tbody>
        {meBeyond && (
          <tbody className="ladder-me">
            <tr className="ladder-gap" aria-hidden="true">
              <td colSpan={5}>…</td>
            </tr>
            <Row row={state.me!} mine />
          </tbody>
        )}
      </table>
    </div>
  );
}
