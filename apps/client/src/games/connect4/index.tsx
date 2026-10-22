import type { Connect4Event, Connect4Move, Connect4State } from '@bureau/shared/games/connect4';
import type { GameUi } from '../types';
import { Board } from './Board';
import './connect4.css';
import { announce, describeResult, rules, seatLabel, sounds } from './ui';

// Le module client du Puissance 4, tel que la plateforme le charge à l'ouverture de sa table (games/game-ui.ts) : son plateau, ses textes, ses sons, son aide.
const ui: GameUi<Connect4State, Connect4Move, Connect4Event> = { Board, seatLabel, describeResult, announce, sounds, rules };

export default ui;
