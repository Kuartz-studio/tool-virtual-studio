import { LUDO_HORSES, LUDO_HOME, LUDO_MAX_TRIES, LUDO_STABLE, horseScore, isInPlay, type LudoEvent, type LudoMove, type LudoState } from '@bureau/shared/games/ludo';
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { GameBoardProps } from '../types';
import { BoardSvg } from './BoardSvg';
import { Die } from './Die';
import { ludoFr, t } from './fr';
import { turnsFor } from './geometry';
import { moveOptions, type MoveOption } from './moves';
import { positionLines, scoreOf } from './position-text';
import { cellSizeFor } from './sizing';
import { useDie, useShownHorses } from './use-board-motion';
import { useContainerWidth } from './use-container-width';

// Le plateau des petits chevaux (`GameUi.Board`) : le dessin (BoardSvg), le dé et ses repères, le bouton « Lancer le dé » ou la liste des coups en boutons, l'équivalent texte du plateau
// et, à la fin, le classement. Il ne règle rien : il montre l'état que la plateforme lui donne, et envoie { type: 'roll' } ou { type: 'move', horse }. Ce que les règles disent jouable
// vient de `legalMoves` du moteur (moves.ts) ; qui peut agir vient de la plateforme (`canAct`), que le plateau recoupe avec l'état (le trait est à soi).

// Les touches que le plateau prend : les flèches et Début et Fin passent d'un bouton de la liste des coups à l'autre. Ce sont aussi celles qui font marcher l'avatar (game/input.ts) :
// le plateau les arrête (preventDefault, stopPropagation) tant que le focus est sur l'un de ses boutons. Entrée et Espace sont l'action native des boutons, Échap ferme le panneau,
// E et le zoom sont à la page : rien de tout cela n'est détourné (§ 9.5.3).
const NAVIGATION_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

// Les repères sous le dé : les 6 déjà tirés dans le tour, et, sans cheval en jeu, les essais qu'il reste pour faire un 6.
function marksOf(state: LudoState): string[] {
  if (state.phase === 'over') return [];
  const marks: string[] = [];
  if (state.sixes === 1) marks.push(ludoFr.die.sixOnce);
  if (state.sixes === 2) marks.push(ludoFr.die.sixTwice);
  const row = state.horses[state.turn];
  if (state.phase === 'roll' && row && !row.some(isInPlay) && row.includes(LUDO_STABLE)) {
    const left = LUDO_MAX_TRIES - state.tries;
    if (left === LUDO_MAX_TRIES) marks.push(ludoFr.die.triesFull);
    else if (left > 1) marks.push(t(ludoFr.die.triesLeft, { count: left }));
    else if (left === 1) marks.push(ludoFr.die.triesLast);
  }
  return marks;
}

// Un bouton inactif pendant une demande (le serveur n'a pas répondu) est `aria-disabled`, comme ceux de la plateforme (bar-button) : il garde le focus, et son clic est ignoré.
// Le focus d'un joueur au clavier ne se perd pas quand le bouton qu'il vient d'actionner disparaît : « Lancer le dé » est remplacé par la liste des coups, et le focus, resté sur un
// élément retiré, tomberait sur la page. Il passe alors au premier bouton qui reste. Rien n'est volé à qui a mis le focus ailleurs.
function useKeepFocus(root: RefObject<HTMLElement | null>, state: LudoState): void {
  const lastFocused = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const onFocusIn = (event: FocusEvent) => {
      lastFocused.current = event.target as Element;
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget) lastFocused.current = null;
    };
    element.addEventListener('focusin', onFocusIn);
    element.addEventListener('focusout', onFocusOut);
    return () => {
      element.removeEventListener('focusin', onFocusIn);
      element.removeEventListener('focusout', onFocusOut);
    };
  }, [root]);
  useLayoutEffect(() => {
    const was = lastFocused.current;
    if (!was || was.isConnected) return;
    lastFocused.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    root.current?.querySelector('button')?.focus();
  }, [root, state]);
}

export function LudoBoard({ state, mySeat, players, events, canAct, onMove, reducedMotion, preview }: GameBoardProps<LudoState, LudoMove, LudoEvent>) {
  const root = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(root);
  const cell = cellSizeFor(width);
  const shown = useShownHorses(state, events, reducedMotion);
  const die = useDie(state, events, reducedMotion);
  const [previewHorse, setPreviewHorse] = useState<number | null>(null);
  const positionId = useId();
  const positionTitleId = useId();
  useKeepFocus(root, state);

  const names = players.map((player) => player.name);
  const turns = turnsFor(mySeat === null ? undefined : state.colors[mySeat]);
  // C'est à soi de décider (lancer, ou jouer un cheval), et la plateforme le permet : aucun coup n'est en attente de réponse. Qui n'a pas le trait n'a rien, même si elle se trompait.
  const myTurn = !preview && mySeat !== null && state.phase !== 'over' && state.turn === mySeat;
  const enabled = myTurn && canAct;
  const options = useMemo(() => (myTurn && mySeat !== null ? moveOptions(state, mySeat) : []), [myTurn, mySeat, state]);
  const playable = useMemo(() => new Map<number, MoveOption>(enabled ? options.map((option) => [option.horse, option]) : []), [enabled, options]);
  const previewed = playable.get(previewHorse ?? -1) ?? null;
  // Les avancées montrées : celles de l'animation, tant qu'elle va avec l'état (un autre nombre de sièges, c'est un autre plateau).
  const horses = shown.horses.length === state.horses.length ? shown.horses : state.horses;

  function pick(option: MoveOption) {
    if (enabled) onMove({ type: 'move', horse: option.horse });
  }

  // Les flèches et Début et Fin d'un bouton du plateau : la liste des coups change de bouton, et la touche ne va pas plus loin (l'avatar ne marche pas).
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!NAVIGATION_KEYS.has(event.key) || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (!target.closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    const list = target.closest('.ludo-moves');
    if (!list) return;
    const buttons = [...list.querySelectorAll('button')];
    const at = buttons.indexOf(target as HTMLButtonElement);
    const last = buttons.length - 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? Math.max(at - 1, 0) : Math.min(at + 1, last);
    buttons[next]?.focus();
  }

  const marks = marksOf(state);
  const lines = positionLines(state, names, mySeat);

  return (
    <div ref={root} className="game-ludo" data-cell={cell} data-turns={turns} data-phase={state.phase} data-preview={preview || undefined} onKeyDown={onKeyDown}>
      <BoardSvg
        state={state}
        horses={horses}
        sliding={shown.slide}
        names={names}
        turns={turns}
        cell={cell}
        describedBy={positionId}
        mySeat={mySeat}
        playable={playable}
        onPick={pick}
        previewed={previewed}
        onPreview={setPreviewHorse}
      />

      {!preview && (
        <div className="ludo-dice-row">
          <Die value={die.value} rolling={die.rolling} face={die.face} />
          {marks.length > 0 && (
            <ul className="ludo-marks">
              {marks.map((mark) => (
                <li key={mark} className="ludo-mark">
                  {mark}
                </li>
              ))}
            </ul>
          )}
          {myTurn && state.phase === 'roll' && (
            <button type="button" className="bar-button ludo-roll" data-sfx="none" aria-disabled={enabled ? undefined : true} onClick={() => enabled && onMove({ type: 'roll' })}>
              {ludoFr.roll}
            </button>
          )}
        </div>
      )}

      {myTurn && options.length > 0 && (
        <div className="ludo-moves" role="group" aria-label={ludoFr.moves.label}>
          {options.map((option) => (
            <button
              key={option.horse}
              type="button"
              className="bar-button ludo-move"
              data-horse={option.horse}
              data-sfx="none"
              aria-disabled={enabled ? undefined : true}
              onClick={() => pick(option)}
              onMouseEnter={() => setPreviewHorse(option.horse)}
              onMouseLeave={() => setPreviewHorse(null)}
              onFocus={() => setPreviewHorse(option.horse)}
              onBlur={() => setPreviewHorse(null)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {state.phase === 'over' && state.result && <Standings state={state} names={names} />}

      <section className="ludo-position visually-hidden" id={positionId} aria-labelledby={positionTitleId}>
        <h4 id={positionTitleId}>{ludoFr.board.positionTitle}</h4>
        <ul>
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// Le classement complet d'une partie finie : le rang de chaque siège (des ex æquo ont le même), son nom et sa couleur, son avancée sur le maximum (4 chevaux arrivés : 228), ou « a quitté
// la partie » pour un siège sorti. L'avancée est celle que le moteur a écrite dans le résultat ; sans elle, elle est recalculée depuis l'état.
function Standings({ state, names }: { state: LudoState; names: readonly string[] }) {
  const result = state.result!;
  const scores = Array.isArray(result.detail?.scores) ? (result.detail.scores as number[]) : state.horses.map(scoreOf);
  const max = LUDO_HORSES * horseScore(LUDO_HOME);
  let rank = 1;
  const rows = result.ranking.flatMap((group) => {
    const groupRank = rank;
    rank += group.length;
    return group.map((seat) => ({ seat, rank: groupRank }));
  });
  return (
    <ol className="ludo-standings" aria-label={ludoFr.end.standings}>
      {rows.map(({ seat, rank: rowRank }) => {
        const color = state.colors[seat]!;
        const gone = state.out.some((entry) => entry.seat === seat);
        const detail = gone ? ludoFr.end.gone : t(ludoFr.end.score, { score: scores[seat] ?? 0, max });
        return (
          <li key={seat} className="ludo-standing" data-seat={seat} data-out={gone || undefined}>
            <i className={`ludo-dot ludo-tone-${color}`} aria-hidden="true" />
            {t(ludoFr.end.standing, { rank: rowRank, name: names[seat] ?? '', color: ludoFr.colorWords[color] ?? '', detail })}
          </li>
        );
      })}
    </ol>
  );
}
