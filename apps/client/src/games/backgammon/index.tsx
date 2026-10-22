import type { BackgammonEvent, BackgammonMove, BackgammonState } from '@bureau/shared/games/backgammon';
import type { GameUi } from '../types';
import './backgammon.css';
import { Board } from './Board';
import { announce, describeResult, rules, seatLabel, sounds } from './text';

// Le module client du backgammon : son plateau, la pastille de chaque siège, la fin de partie, ce que lit l'écran de lecture, les sons, l'aide des règles. La plateforme le charge à
// la demande (games/game-ui.ts), avec sa feuille de style ; ses règles viennent du registre partagé (`@bureau/shared/games/backgammon`).
const ui = { Board, seatLabel, describeResult, announce, sounds, rules } satisfies GameUi<BackgammonState, BackgammonMove, BackgammonEvent>;

export default ui;
