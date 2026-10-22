import { deepFreeze } from '../conformance';
import { pickIndex, scriptedRng, seededRng } from '../rng';
import { chess, positionKey, START_FEN, type ChessMove, type ChessState, type Promotion, type Square } from './index';

// Les aides des tests des échecs. Ce fichier n'est importé que par les tests : le moteur ne le voit jamais.

// Les échecs n'ont aucun hasard : un générateur qui lève dès qu'on le tire le prouve à chaque test.
export const noRandom = scriptedRng([]);

// L'environnement des tests (JEUX_FUZZ, JEUX_LONG). Les types de Node ne sont pas chargés dans ce paquet, dont le code tourne aussi dans le navigateur : on lit
// `process.env` sans le typer, et on rend un objet vide là où `process` n'existe pas.
export const env: Record<string, string | undefined> = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

// « e2e4 » → { from: 'e2', to: 'e4' } ; « a7a8q » → avec la pièce de promotion (la notation des cas nommés du document).
export function moveOf(text: string): ChessMove {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)) throw new Error(`coup mal écrit : « ${text} »`);
  const move: ChessMove = { from: text.slice(0, 2) as Square, to: text.slice(2, 4) as Square };
  if (text.length === 5) move.promotion = text[4] as Promotion;
  return move;
}

// L'inverse : un coup devient « e2e4 » ou « a7a8q ».
export function textOf(move: ChessMove): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

// Les coups légaux du camp au trait, écrits en texte et triés : on compare des ensembles, pas un ordre que le moteur ne promet pas.
export function legalTexts(state: ChessState): string[] {
  const seat = chess.turn(state);
  return seat === null ? [] : chess.legalMoves(state, seat).map(textOf).sort();
}

// Un état posé à la main à partir d'un FEN, sans passer par le moteur pour fabriquer ce qu'il doit ensuite juger : la clé de répétition seule vient de lui.
export function stateOf(fen: string, white = 0): ChessState {
  return deepFreeze({ fen, white, plies: [], positions: { [positionKey(fen)]: 1 }, result: null });
}

// La partie du début, gelée comme le fait le harnais : toute fonction qui modifierait un état déjà rendu lèverait une erreur.
export function startState(first = 0): ChessState {
  return deepFreeze(chess.create({ seats: 2, first }, noRandom).state);
}

// Joue des coups à la suite (« e2e4 e7e5 »), chacun par le siège qui a le trait, et rend l'état final. Un coup refusé lève une erreur qui dit où.
export function play(state: ChessState, moves: string): ChessState {
  let current = state;
  for (const word of moves.split(/\s+/).filter((entry) => entry !== '')) {
    const seat = chess.turn(current);
    if (seat === null) throw new Error(`la partie est finie avant ${word}`);
    const out = chess.apply(current, seat, moveOf(word), noRandom);
    if (!out.ok) throw new Error(`coup refusé : ${word} (${out.error}) dans ${current.fen}`);
    current = deepFreeze(out.state);
  }
  return current;
}

// Les n premiers champs d'un FEN : 3 = placement, trait, roques (la position hors case de prise en passant) ; 4 = avec la case de prise en passant.
export function fields(fen: string, count: number): string {
  return fen.split(' ').slice(0, count).join(' ');
}

// Une partie au hasard, de la graine donnée : chaque coup légal est tiré avec le générateur à graine, jusqu'à la fin ou jusqu'à `maxPlies` demi-coups. Rend tous les
// états traversés, le premier compris.
export function randomPlayout(seed: number, first = 0, maxPlies = 12_000): ChessState[] {
  const choice = seededRng(seed);
  let state = startState(first);
  const states = [state];
  while (chess.turn(state) !== null && states.length <= maxPlies) {
    const seat = chess.turn(state)!;
    const legal = chess.legalMoves(state, seat);
    const out = chess.apply(state, seat, legal[pickIndex(choice, legal.length)]!, noRandom);
    if (!out.ok) throw new Error(`un coup légal est refusé : ${out.error}`);
    state = deepFreeze(out.state);
    states.push(state);
  }
  return states;
}

export { START_FEN };
