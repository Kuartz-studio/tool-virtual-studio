import type { ChessEvent, ChessMove, ChessState } from '@bureau/shared/games/chess';
import type { GameResult } from '@bureau/shared';
import { t } from '../../i18n/fr';
import type { GameUi } from '../types';
import { ChessBoard } from './ChessBoard';
import './chess.css';
import { chessFr } from './fr';

// Le module client des échecs (§ 9.4 du document des jeux) : le plateau, le nom et la couleur d'un siège, la phrase d'une fin de partie, ce que le lecteur d'écran entend d'un coup, les effets
// sonores, l'aide. Le plateau et sa feuille de style sont chargés à l'ouverture de la table (game-ui.ts : un fichier à part du build).

// Les Blancs sont au siège que l'état dit : un siège n'est pas une couleur.
function seatLabel(seat: number, state: ChessState): { name: string; color: string } {
  return chessFr.seats[seat === state.white ? 'w' : 'b'];
}

// La fin d'une partie, pour les raisons que le moteur écrit. L'abandon, le délai, le départ et la nulle par accord sont dits par la plateforme.
function describeResult(result: GameResult, names: string[]): string {
  const winner = names[result.ranking[0]?.[0] ?? -1] ?? '';
  switch (result.reason) {
    case 'checkmate':
      return t(chessFr.end.checkmate, { name: winner });
    case 'stalemate':
      return chessFr.end.stalemate;
    case 'insufficient':
      return chessFr.end.insufficient;
    case 'threefold':
      return chessFr.end.threefold;
    case 'fifty':
      return chessFr.end.fifty;
    default:
      return result.ranking.length === 1 ? chessFr.end.draw : t(chessFr.end.winner, { name: winner });
  }
}

// Un coup, en une phrase pour le lecteur d'écran : « Alice : cavalier en f3. », « Bastien : pion e5 prend d6 en passant, échec. », « Alice : petit roque. ».
function sentenceOf(event: Extract<ChessEvent, { type: 'move' }>, names: string[]): string {
  const { ply } = event;
  const words = chessFr.announce;
  let text: string;
  if (ply.castle) {
    text = ply.castle === 'k' ? words.castleShort : words.castleLong;
  } else if (ply.promotion) {
    const piece = chessFr.pieceName(ply.promotion);
    text = ply.captured ? t(words.promotionCapture, { from: ply.from, to: ply.to, piece }) : t(words.promotion, { to: ply.to, piece });
  } else if (ply.captured) {
    text = t(words.capture, { piece: chessFr.pieceName(ply.piece), from: ply.from, to: ply.to });
    if (ply.enPassant) text += ` ${words.enPassant}`;
  } else {
    text = t(words.quiet, { piece: chessFr.pieceName(ply.piece), to: ply.to });
  }
  if (ply.mate) text += `, ${words.mate}`;
  else if (ply.check) text += `, ${words.check}`;
  return t(words.sentence, { name: names[event.seat] ?? '', text });
}

function announce(events: ChessEvent[], _state: ChessState, names: string[]): string | null {
  const sentences = events.flatMap((event) => (event.type === 'move' ? [sentenceOf(event, names)] : []));
  return sentences.length > 0 ? sentences.join(' ') : null;
}

// Un bruit de pièce par coup joué ; l'abandon et la nulle n'en font pas (la victoire a son effet, que la plateforme joue).
function sounds(events: ChessEvent[]): Array<'piece'> {
  return events.flatMap((event) => (event.type === 'move' ? (['piece'] as const) : []));
}

const ui: GameUi<ChessState, ChessMove, ChessEvent> = {
  Board: ChessBoard,
  seatLabel,
  describeResult,
  announce,
  sounds,
  rules: [...chessFr.rules],
};

export default ui;
