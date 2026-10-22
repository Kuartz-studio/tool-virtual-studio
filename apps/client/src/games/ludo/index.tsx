import type { LudoEvent, LudoMove, LudoState } from '@bureau/shared/games/ludo';
import type { GameUi } from '../types';
import { LudoBoard } from './Board';
import './ludo.css';
import { announce, describeResult, ludoRules, seatLabel, sounds } from './ui';

// Le module client des petits chevaux : ce que la plateforme charge à l'ouverture de leur table (games/game-ui.ts). Ses règles sont au registre partagé (`@bureau/shared`), son
// plateau et ses textes sont ici, sa feuille de style avec lui (un fichier à part du build, lu à l'ouverture de la table).
const ludoUi = {
  Board: LudoBoard,
  seatLabel,
  describeResult,
  announce,
  sounds,
  rules: ludoRules,
} satisfies GameUi<LudoState, LudoMove, LudoEvent>;

export default ludoUi;
