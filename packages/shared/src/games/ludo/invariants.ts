import { FORFEIT_REASONS } from '../types';
import { LUDO_COLORS, LUDO_DIE_SIDES, LUDO_HOME, LUDO_HORSES, LUDO_MAX_SIXES, LUDO_MAX_TRIES, LUDO_STABLE, trackCell } from './board';
import type { LudoState } from './model';
import { playableHorses } from './rules';

// Ce qui est vrai de tout état légal des petits chevaux : [] si l'état est légal, sinon une phrase par violation. Les parties au hasard (le harnais) et `debug:game` s'en
// servent pour attraper un état que le moteur n'aurait jamais dû produire, ou qu'un test de bout en bout aurait mal fabriqué. L'argument est `unknown` : `debug:game` y passe
// ce qu'un client a envoyé, et une fonction qui doit juger un état ne lève pas sur un état qui n'en est pas un.

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Les champs ont-ils la bonne forme ? Tant que ce n'est pas le cas, le reste des règles n'a pas de sens : on s'arrête là.
function shapeProblems(state: unknown): string[] {
  if (!isRecord(state)) return ['l\'état n\'est pas un objet'];
  const problems: string[] = [];
  if (!Array.isArray(state.colors) || !state.colors.every(isInteger)) problems.push('colors doit être une liste d\'entiers');
  if (!Array.isArray(state.horses) || !state.horses.every((row) => Array.isArray(row) && row.every(isInteger))) problems.push('horses doit être une liste de listes d\'entiers');
  if (!isInteger(state.turn)) problems.push('turn doit être un entier');
  if (state.phase !== 'roll' && state.phase !== 'move' && state.phase !== 'over') problems.push('phase doit être roll, move ou over');
  if (state.die !== null && !isInteger(state.die)) problems.push('die doit être un entier ou null');
  if (!isInteger(state.sixes)) problems.push('sixes doit être un entier');
  if (!isInteger(state.tries)) problems.push('tries doit être un entier');
  if (!isInteger(state.moves)) problems.push('moves doit être un entier');
  const reasons: readonly unknown[] = FORFEIT_REASONS;
  if (!Array.isArray(state.out) || !state.out.every((entry) => isRecord(entry) && isInteger(entry.seat) && reasons.includes(entry.reason))) {
    problems.push('out doit être une liste de { seat, reason }');
  }
  if (state.last !== null && !(isRecord(state.last) && isInteger(state.last.seat) && isInteger(state.last.horse) && isInteger(state.last.from) && isInteger(state.last.to))) {
    problems.push('last doit être null ou { seat, horse, from, to }');
  }
  if (state.result !== null && !(isRecord(state.result) && Array.isArray(state.result.ranking) && typeof state.result.reason === 'string')) {
    problems.push('result doit être null ou { ranking, reason }');
  }
  return problems;
}

export function ludoInvariants(state: unknown): string[] {
  const shape = shapeProblems(state);
  if (shape.length > 0) return shape;
  const s = state as LudoState;
  const seats = s.horses.length;
  const palette = LUDO_COLORS[seats as keyof typeof LUDO_COLORS];
  if (palette === undefined) return [`${seats} sièges : une partie se joue de 2 à 4 joueurs`];
  const problems: string[] = [];

  if (s.colors.length !== seats || s.colors.some((color, seat) => color !== palette[seat])) {
    problems.push(`les couleurs ${JSON.stringify(s.colors)} ne sont pas celles d'une partie à ${seats} joueurs (${JSON.stringify(palette)})`);
  }

  // Les chevaux : quatre par siège, chacun entre l'écurie et l'arrivée ; jamais deux chevaux d'une couleur à la même avancée sur la piste ou l'allée ; jamais deux chevaux, de
  // quelque couleur que ce soit, sur la même case de piste (un cheval qui s'arrête sur un autre le prend).
  const cells = new Map<number, string>();
  s.horses.forEach((row, seat) => {
    if (row.length !== LUDO_HORSES) problems.push(`le siège ${seat} doit avoir ${LUDO_HORSES} chevaux (il en a ${row.length})`);
    const advances = new Set<number>();
    row.forEach((advance, horse) => {
      if (advance < LUDO_STABLE || advance > LUDO_HOME) {
        problems.push(`le cheval ${horse} du siège ${seat} a l'avancée ${advance} : elle va de ${LUDO_STABLE} à ${LUDO_HOME}`);
        return;
      }
      if (advance !== LUDO_STABLE && advance !== LUDO_HOME) {
        if (advances.has(advance)) problems.push(`le siège ${seat} a deux chevaux à la même avancée (${advance})`);
        advances.add(advance);
      }
      const cell = trackCell(s.colors[seat]!, advance);
      if (cell === null) return;
      const holder = cells.get(cell);
      if (holder !== undefined) problems.push(`deux chevaux sur la case de piste ${cell} : ${holder} et siège ${seat}, cheval ${horse}`);
      else cells.set(cell, `siège ${seat}, cheval ${horse}`);
    });
  });

  // Les sièges sortis : uniques, qui existent, sans plus aucun cheval sur le plateau.
  const gone = new Set<number>();
  for (const entry of s.out) {
    if (entry.seat < 0 || entry.seat >= seats) {
      problems.push(`le siège sorti ${entry.seat} n'existe pas`);
      continue;
    }
    if (gone.has(entry.seat)) problems.push(`le siège ${entry.seat} est sorti plusieurs fois`);
    gone.add(entry.seat);
    if (s.horses[entry.seat]!.some((advance) => advance !== LUDO_STABLE)) problems.push(`le siège ${entry.seat} est sorti mais a encore un cheval sur le plateau`);
  }

  // Le trait : un siège qui existe, et qui n'est pas sorti (sauf une fois la partie finie).
  const turnExists = s.turn >= 0 && s.turn < seats;
  if (!turnExists) problems.push(`le trait est au siège ${s.turn}, qui n'existe pas`);
  else if (s.phase !== 'over' && gone.has(s.turn)) problems.push(`le trait est au siège ${s.turn}, qui est sorti`);

  // La phase et le dé : en phase roll, pas de dé ; en phase move, un dé de 1 à 6 et au moins un cheval à jouer (sinon le tour aurait déjà passé).
  if (s.phase === 'roll' && s.die !== null) problems.push(`en phase roll, die doit être nul (il vaut ${s.die})`);
  if (s.phase === 'move') {
    if (s.die === null || s.die < 1 || s.die > LUDO_DIE_SIDES) {
      problems.push(`en phase move, die doit être un dé de 1 à ${LUDO_DIE_SIDES} (il vaut ${String(s.die)})`);
    } else if (turnExists && playableHorses(s.horses[s.turn]!, s.die).length === 0) {
      problems.push(`en phase move, le siège ${s.turn} n'a aucun coup légal avec le dé ${s.die}`);
    }
  }

  // Les compteurs du tour : le troisième 6 ne reste pas (il fait passer le tour), les essais vont jusqu'à trois.
  if (s.sixes < 0 || s.sixes >= LUDO_MAX_SIXES) problems.push(`sixes vaut ${s.sixes} : de 0 à ${LUDO_MAX_SIXES - 1}`);
  if (s.tries < 0 || s.tries > LUDO_MAX_TRIES) problems.push(`tries vaut ${s.tries} : de 0 à ${LUDO_MAX_TRIES}`);
  if (s.moves < 0) problems.push(`moves vaut ${s.moves} : il ne peut pas être négatif`);

  // La fin : phase over si et seulement s'il y a un résultat ; tant que la partie dure, au moins deux sièges restent en jeu (le dernier resté gagne dès que les autres sortent).
  if (s.phase === 'over' && s.result === null) problems.push('la phase est over mais il n\'y a pas de résultat');
  if (s.phase !== 'over' && s.result !== null) problems.push(`il y a un résultat mais la phase est ${s.phase}, pas over`);
  if (s.phase !== 'over' && seats - gone.size < 2) problems.push('il faut au moins deux sièges en jeu tant que la partie dure');
  return problems;
}
