import { checkersAt, diceToPlay, maxPlayableSteps, nextSteps, pipCount, previewSteps, type BackgammonEvent, type BackgammonMove, type BackgammonState, type BgPosition, type BgStep } from '@bureau/shared/games/backgammon';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { t } from '../../i18n/fr';
import type { GameBoardProps } from '../types';
import { BoardSvg, type CellMarks } from './BoardSvg';
import { useRolling, type DiceProps } from './Dice';
import { fr } from './fr';
import { cellsOf, diceCentre, layoutFor, toViewPoint, type Cell, type CellId } from './geometry';
import { applyStepEvent, stepEvents, undoStepEvents } from './replay';
import { barLabel, diceLabel, offLabel, offText, pointLabel, raceText, stepsText } from './text';
import { diceUsed, isTurnComplete, pickStep, sourcesOf, targetsFrom, turnKey, type Source, type Target } from './turn';

// Le plateau du backgammon (§ 14.6 du document des jeux). Il dessine l'état que la plateforme lui donne, et construit le tour pas à pas : un clic prend un pion jouable, ses arrivées
// s'éclairent (`nextSteps`), un clic sur l'une fait l'étape en aperçu (`previewSteps`) ; « Valider » envoie le tour entier d'un coup, quand il est complet. Rien n'est tiré ici : les
// dés viennent du serveur, et ceux qui roulent à l'écran ne sont qu'un décor.

// Le temps d'un pion du tour de l'adversaire, rejoué étape par étape.
const STEP_MS = 200;
// Combien de temps « Aucun coup possible » reste affiché.
const NOTICE_MS = 1500;

const NO_STEPS: BgStep[] = [];

const cellIdOf = (source: Source): CellId => (source === 'bar' ? 'bar' : `p${source}`);

// Se mesure sur son conteneur (§ 9.5.1), jamais sur la fenêtre : la largeur du panneau (408 px) ou de la feuille d'un téléphone (311 px). Rend la référence à poser sur le
// conteneur et sa largeur ; 0 tant qu'elle est inconnue (sans ResizeObserver, ou avant la première mesure).
function useContainerWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(Math.floor(element.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      setWidth(Math.floor(entry ? entry.contentRect.width : element.getBoundingClientRect().width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// Le tour de l'adversaire rejoué pion par pion : la position d'avant (celle d'après dont on défait les étapes des événements), puis une étape toutes les 200 ms. Les étapes de
// celui qui regarde ne sont pas rejouées : il les a posées lui-même en aperçu. Un saut d'état (aucun événement), ou un lot sans étape, coupe le rejeu : la position finale. En mouvement
// réduit, elle est là tout de suite.
function useReplay(events: BackgammonEvent[], final: BgPosition, mySeat: number | null, reducedMotion: boolean): { position: BgPosition; animating: boolean } {
  const [replay, setReplay] = useState<{ events: BackgammonEvent[]; shown: number } | null>(null);
  const theirs = useMemo(() => stepEvents(events).filter((step) => mySeat === null || step.seat !== mySeat), [events, mySeat]);
  if (events.length > 0 && replay?.events !== events) {
    if (theirs.length > 0 && !reducedMotion) setReplay({ events, shown: 0 });
    else if (replay !== null) setReplay(null);
  } else if (events.length === 0 && replay !== null) setReplay(null);

  const shown = replay?.events === events ? replay.shown : theirs.length;
  const animating = replay !== null && replay.events === events && shown < theirs.length;
  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => setReplay((current) => (current ? { ...current, shown: current.shown + 1 } : current)), STEP_MS);
    return () => clearTimeout(timer);
  }, [animating, shown]);

  const position = useMemo(() => {
    if (replay === null || replay.events !== events || theirs.length === 0) return final;
    return theirs.slice(0, shown).reduce(applyStepEvent, undoStepEvents(final, theirs));
  }, [replay, events, theirs, shown, final]);
  return { position, animating };
}

type Notice = { seat: 0 | 1; values: [number, number] | null };

// « Aucun coup possible » : le tour passé (événement `pass`) s'affiche 1,5 s, avec les dés qui n'ont rien donné.
function usePassNotice(events: BackgammonEvent[]): Notice | null {
  const [seen, setSeen] = useState<BackgammonEvent[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  if (events.length > 0 && events !== seen) {
    setSeen(events);
    const pass = events.find((event): event is Extract<BackgammonEvent, { type: 'pass' }> => event.type === 'pass');
    if (pass) {
      const roll = events.find((event): event is Extract<BackgammonEvent, { type: 'dice' }> => event.type === 'dice' && event.seat === pass.seat);
      setNotice({ seat: pass.seat, values: roll ? roll.values : null });
    } else if (notice !== null) setNotice(null);
  } else if (events.length === 0 && (seen !== null || notice !== null)) {
    setSeen(null);
    setNotice(null);
  }
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return notice;
}

interface Draft {
  key: string;
  done: BgStep[];
  selected: Source | null;
  // Le coup est parti : on attend la réponse du serveur.
  sent: boolean;
}

export function Board({ state, mySeat, players, events, canAct, onMove, reducedMotion, preview }: GameBoardProps<BackgammonState, BackgammonMove, BackgammonEvent>) {
  const [rootRef, width] = useContainerWidth();
  const layout = useMemo(() => layoutFor(width), [width]);
  const cells = useMemo(() => cellsOf(layout), [layout]);
  // Sa maison est en bas à droite ; un spectateur (et l'aperçu) voit celle des Blancs.
  const viewSeat: 0 | 1 = mySeat === 1 ? 1 : 0;
  const names = [players[0]?.name ?? fr.seats.white, players[1]?.name ?? fr.seats.red];

  // Le tour qu'on construit : valable pour cette clé (le trait, la phase, les dés, les tours joués). Quand le serveur répond, la clé change et tout repart de zéro.
  const key = turnKey(state);
  const [stored, setStored] = useState<Draft>({ key, done: NO_STEPS, selected: null, sent: false });
  const draft: Draft = stored.key === key ? stored : { key, done: NO_STEPS, selected: null, sent: false };
  const myMove = !preview && mySeat !== null && state.phase === 'move' && state.turn === mySeat;
  const myRoll = !preview && mySeat !== null && state.phase === 'roll' && state.turn === mySeat;
  const done = myMove ? draft.done : NO_STEPS;
  const interactive = canAct && myMove;
  // Le serveur a refusé le coup (la main revient sans nouvel état) : on peut le renvoyer.
  useEffect(() => {
    if (canAct) setStored((current) => (current.sent ? { ...current, sent: false } : current));
  }, [canAct]);

  const available = useMemo(() => (myMove ? nextSteps(state, done) : NO_STEPS), [myMove, state, done]);
  const sources = interactive ? sourcesOf(available) : [];
  // Un pion sur la barre doit rentrer avant tout autre coup : c'est le seul pion jouable, on le prend tout seul (la barre est trop étroite pour s'y cliquer sur un téléphone).
  const autoBar = sources.length === 1 && sources[0] === 'bar';
  const manual = draft.selected !== null && sources.includes(draft.selected) ? draft.selected : null;
  const selected: Source | null = manual ?? (autoBar ? 'bar' : null);
  const targets: Target[] = selected !== null ? targetsFrom(available, selected) : [];
  const complete = myMove && isTurnComplete(state, done);
  const playableDice = useMemo(() => (myMove ? maxPlayableSteps(state) : 0), [myMove, state]);

  // La position montrée : celle de l'état, avec les étapes posées en aperçu, puis le tour de l'adversaire rejoué.
  const previewed = useMemo<BgPosition>(() => (done.length > 0 ? (previewSteps(state, done) ?? state) : state), [state, done]);
  const { position: shown, animating } = useReplay(events, previewed, mySeat, reducedMotion);

  // Les pions que l'adversaire a déplacés en dernier restent soulignés jusqu'à ce qu'il joue de nouveau (mon propre tour ne les efface pas).
  const [lastSeen, setLastSeen] = useState<BackgammonState['last']>(null);
  const [theirLast, setTheirLast] = useState<BackgammonState['last']>(null);
  if (state.last !== lastSeen) {
    setLastSeen(state.last);
    if (state.last === null) setTheirLast(null);
    else if (mySeat === null || state.last.seat !== mySeat) setTheirLast(state.last);
  }
  const movedPoints = useMemo(() => {
    const found = new Set<CellId>();
    if (theirLast === null || animating) return found;
    for (const step of theirLast.steps) {
      // Un pion sorti de l'adversaire n'a pas de case chez celui qui regarde (sa zone de sortie est en haut, sans bouton) ; celui d'un siège regardé (spectateur) souligne la sortie.
      if (step.to === 'off') {
        if (theirLast.seat === viewSeat) found.add('off');
      } else found.add(`p${toViewPoint(viewSeat, theirLast.seat, step.to)}`);
    }
    return found;
  }, [theirLast, animating, viewSeat]);

  const rolling = useRolling(events, reducedMotion);
  const passNotice = usePassNotice(events);

  // Ce qui s'éclaire, case par case.
  const marks = useMemo(() => {
    const map = new Map<CellId, CellMarks>();
    for (const cell of cells) {
      const source: Source | null = cell.kind === 'bar' ? 'bar' : cell.kind === 'point' ? cell.point! : null;
      const target: Target | null = cell.kind === 'off' ? 'off' : cell.kind === 'point' ? cell.point! : null;
      map.set(cell.id, {
        playable: source !== null && sources.includes(source),
        selected: source !== null && selected === source,
        target: target !== null && targets.includes(target),
        moved: movedPoints.has(cell.id),
      });
    }
    return map;
    // `sources` et `targets` sont recalculés à chaque rendu : on suit leurs contenus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, sources.join(), selected, targets.join(), movedPoints]);

  // Les dés montrés : ceux du tour en cours, ou — un instant — ceux d'un tour passé. Jamais dans l'aperçu ni une fois la partie finie.
  const diceView: DiceProps | null = useMemo(() => {
    if (preview || state.phase === 'over') return null;
    let seat: 0 | 1;
    let values: [number, number];
    // Les dés d'un tour passé n'ont rien donné : ils s'estompent comme des dés joués.
    let passed = false;
    if (state.phase === 'move' && state.dice.length === 2) {
      seat = state.turn;
      values = [state.dice[0]!, state.dice[1]!];
    } else if (passNotice?.values) {
      seat = passNotice.seat;
      values = passNotice.values;
      passed = true;
    } else return null;
    const side = seat === viewSeat ? 'mine' : 'theirs';
    const centre = diceCentre(layout, side);
    const used = passed ? ([true, true] as const) : seat === mySeat && myMove ? diceUsed(state, done) : ([false, false] as const);
    return { values, x: centre.x, y: centre.y, artPixel: layout.artPixel, used, rolling, side };
  }, [preview, state, passNotice, viewSeat, layout, mySeat, myMove, done, rolling]);

  // ─── Les gestes ───
  const [active, setActive] = useState<CellId | null>(null);
  const stop: CellId = active ?? (interactive && sources.length > 0 ? cellIdOf(sources[0]!) : 'p13');
  const buttons = useRef(new Map<CellId, HTMLButtonElement>());

  function update(next: Partial<Draft>) {
    setStored({ ...draft, ...next });
  }

  function perform(step: BgStep | null) {
    if (step === null) return;
    update({ done: [...done, step], selected: null, sent: false });
  }

  function activate(id: CellId) {
    if (!interactive) return;
    const cell = cells.find((candidate) => candidate.id === id);
    if (!cell) return;
    const asSource: Source | null = cell.kind === 'bar' ? 'bar' : cell.kind === 'point' ? cell.point! : null;
    const asTarget: Target | null = cell.kind === 'off' ? 'off' : cell.kind === 'point' ? cell.point! : null;
    if (selected !== null && asTarget !== null && targets.includes(asTarget)) {
      perform(pickStep(available, selected, asTarget));
      return;
    }
    if (asSource !== null && sources.includes(asSource)) {
      if (selected === asSource) {
        if (manual !== null) update({ selected: null });
      } else update({ selected: asSource });
      return;
    }
    if (manual !== null) update({ selected: null });
  }

  function bearOff() {
    if (interactive && selected !== null) perform(pickStep(available, selected, 'off'));
  }

  function undo() {
    if (interactive && done.length > 0 && !draft.sent) update({ done: done.slice(0, -1), selected: null, sent: false });
  }

  function confirm() {
    if (!interactive || !complete || draft.sent) return;
    update({ sent: true });
    onMove({ type: 'play', steps: done });
  }

  function roll() {
    if (!canAct || !myRoll || draft.sent) return;
    update({ sent: true });
    onMove({ type: 'roll' });
  }

  // ─── Le clavier : le motif « grille » (§ 9.5.3) ───
  const rows = useMemo(
    () => ({
      top: cells.filter((cell) => cell.row === 'top').sort((a, b) => a.x - b.x),
      bottom: cells.filter((cell) => cell.row === 'bottom').sort((a, b) => a.x - b.x),
    }),
    [cells],
  );

  function focusCell(id: CellId) {
    setActive(id);
    buttons.current.get(id)?.focus();
  }

  function neighbour(id: CellId, key: string): CellId {
    const cell = cells.find((candidate) => candidate.id === id)!;
    const row = rows[cell.row];
    const index = row.findIndex((candidate) => candidate.id === id);
    switch (key) {
      case 'ArrowLeft':
        return row[Math.max(0, index - 1)]!.id;
      case 'ArrowRight':
        return row[Math.min(row.length - 1, index + 1)]!.id;
      case 'Home':
        return row[0]!.id;
      case 'End':
        return row[row.length - 1]!.id;
      default: {
        // Haut et bas : l'autre rangée, la case la plus proche à l'écran.
        const goal = key === 'ArrowUp' ? 'top' : 'bottom';
        if (cell.row === goal) return id;
        const centre = cell.x + cell.width / 2;
        return rows[goal].reduce((best, candidate) => (Math.abs(candidate.x + candidate.width / 2 - centre) < Math.abs(best.x + best.width / 2 - centre) ? candidate : best)).id;
      }
    }
  }

  // Toute touche que le plateau prend reçoit preventDefault et stopPropagation (sinon les flèches font marcher l'avatar). Entrée et Espace font l'étape elles-mêmes, et leur clic
  // natif est écarté (keyup de l'Espace compris) : un geste, pas deux. Échap n'est prise que s'il y a un choix à annuler ; sinon elle passe, et le panneau se ferme.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell as CellId | undefined;
    if (!id || event.ctrlKey || event.altKey || event.metaKey) return;
    const take = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
      case 'Home':
      case 'End':
        take();
        focusCell(neighbour(id, event.key));
        return;
      case 'Enter':
      case ' ':
        take();
        activate(id);
        return;
      case 'Escape':
        if (manual !== null) {
          take();
          update({ selected: null });
        }
        return;
    }
  }

  function onKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    if (!(event.target as HTMLElement).closest('[data-cell]')) return;
    event.preventDefault();
    event.stopPropagation();
  }

  // ─── Le dessin ───
  const labelOf = (cell: Cell): string => {
    const mark = marks.get(cell.id) ?? {};
    if (cell.kind === 'bar') return barLabel({ white: shown.bar[0], red: shown.bar[1] }, mark);
    if (cell.kind === 'off') return offLabel(shown.off[viewSeat], mark);
    const { owner, count } = checkersAt(shown, viewSeat, cell.point!);
    return pointLabel(cell.point!, owner, count, mark);
  };

  const scale = width > 0 && width < layout.width ? width / layout.width : 1;
  const compact = layout.mode === 'compact';
  const showActions = myMove;
  const pips = (seat: number) => pipCount(shown, seat);
  // Les deux camps, dans l'ordre où on les lit : soi puis l'autre (« toi 142 · Bastien 156 »), ou les Blancs puis les Rouges pour un spectateur.
  const sides =
    mySeat !== null
      ? [
          { seat: mySeat, name: fr.you },
          { seat: 1 - mySeat, name: names[1 - mySeat]! },
        ]
      : [
          { seat: 0, name: names[0]! },
          { seat: 1, name: names[1]! },
        ];
  const noticeText = passNotice === null ? null : passNotice.seat === mySeat ? fr.noMove : t(fr.cantMove, { name: names[passNotice.seat]! });
  const diceText = diceView && !rolling ? diceLabel(diceView.values) : null;
  // L'avis se pose dans l'autre moitié du tablier que les dés, pour ne pas les cacher.
  const noticeCentre = diceView ? diceCentre(layout, diceView.side === 'mine' ? 'theirs' : 'mine') : { x: layout.width / 2, y: layout.height / 2 };

  const renderCell = (cell: Cell) => (
    <div
      key={cell.id}
      role="gridcell"
      className="game-backgammon-cell"
      data-kind={cell.kind}
      style={{ left: cell.x, top: cell.y + layout.band, width: cell.width, height: cell.height, ...(cell.pointer ? {} : { pointerEvents: 'none' as const }) }}
    >
      <button
        ref={(element) => {
          if (element) buttons.current.set(cell.id, element);
          else buttons.current.delete(cell.id);
        }}
        type="button"
        className="game-backgammon-button"
        data-cell={cell.id}
        data-sfx="none"
        tabIndex={cell.id === stop ? 0 : -1}
        aria-label={labelOf(cell)}
        aria-disabled={interactive ? undefined : true}
        onFocus={() => setActive(cell.id)}
        onClick={() => activate(cell.id)}
      />
    </div>
  );

  return (
    <div ref={rootRef} className="game-backgammon" data-layout={layout.mode} data-view-seat={viewSeat} data-phase={state.phase} data-interactive={interactive || undefined}>
      <div className="game-backgammon-fit" style={{ width: layout.width * scale, height: layout.stageHeight * scale }}>
        <div className="game-backgammon-stage" style={{ width: layout.width, height: layout.stageHeight, ...(scale < 1 ? { transform: `scale(${scale})` } : {}) }}>
          <BoardSvg layout={layout} viewSeat={viewSeat} position={shown} marks={marks} dice={diceView} />
          {canAct && myRoll && !draft.sent && (
            <button
              type="button"
              className="bar-button game-backgammon-roll"
              data-sfx="none"
              style={{ left: diceCentre(layout, 'mine').x, top: diceCentre(layout, 'mine').y + layout.band }}
              onClick={roll}
            >
              {fr.roll}
            </button>
          )}
          <div role="grid" aria-label={fr.board} className="game-backgammon-grid" onKeyDown={onKeyDown} onKeyUp={onKeyUp}>
            <div role="row" aria-label={fr.rows.top} className="game-backgammon-row">
              {rows.top.map(renderCell)}
            </div>
            <div role="row" aria-label={fr.rows.bottom} className="game-backgammon-row">
              {rows.bottom.map(renderCell)}
            </div>
          </div>
          {noticeText !== null && (
            <div className="game-backgammon-notice" style={{ left: noticeCentre.x, top: noticeCentre.y + layout.band }}>
              {noticeText}
            </div>
          )}
        </div>
      </div>

      <div className="game-backgammon-info">
        {myMove && <p className="game-backgammon-steps">{done.length > 0 ? t(fr.steps, { steps: stepsText(done) }) : fr.stepsHint}</p>}
        {myMove && complete && done.length > 0 && <p className="game-backgammon-note">{fr.stepsDone}</p>}
        {myMove && playableDice < diceToPlay(state.dice).length && (
          <p className="game-backgammon-note">{playableDice === 1 ? fr.onlyOne : t(fr.onlySome, { count: playableDice })}</p>
        )}
        {!preview && <p className="game-backgammon-race">{raceText(sides.map(({ seat, name }) => ({ name, pips: pips(seat) })))}</p>}
        {!preview && compact && <p className="game-backgammon-race">{offText(sides.map(({ seat, name }) => ({ name, off: shown.off[seat]! })))}</p>}
        {diceText !== null && <p className="visually-hidden">{diceText}</p>}
      </div>

      {showActions && (
        <div className="game-backgammon-actions">
          <button type="button" className="bar-button game-backgammon-undo" data-sfx="none" disabled={!(interactive && done.length > 0 && !draft.sent)} onClick={undo}>
            {fr.undo}
          </button>
          {compact && (
            <button type="button" className="bar-button game-backgammon-bear" data-sfx="none" disabled={!(interactive && selected !== null && targets.includes('off'))} onClick={bearOff}>
              {fr.bearOff}
            </button>
          )}
          <button type="button" className="bar-button game-backgammon-confirm" data-sfx="none" disabled={!(interactive && complete && !draft.sent)} onClick={confirm}>
            {fr.confirm}
          </button>
        </div>
      )}
    </div>
  );
}
