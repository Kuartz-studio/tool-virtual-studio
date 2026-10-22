import { fabricateLudo, type LudoEvent, type LudoState } from '@bureau/shared/games/ludo';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CAPTURE_MS, DICE_FACE_MS, DICE_ROLL_MS, STEP_MS } from './frames';
import { useDie, useShownHorses } from './use-board-motion';

// Les horloges de l'animation : les chevaux qui sautent de case en case, le dé qui roule. Les minuteurs sont faux : le test les fait avancer.

const STABLE = [-1, -1, -1, -1];
const move = (seat: number, horse: number, from: number, to: number): LudoEvent => ({ type: 'move', seat, horse, from, to });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('useShownHorses : ce que le plateau montre des chevaux', () => {
  const before = fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] });
  const after = fabricateLudo({ horses: [[13, -1, -1, -1], [5, -1, -1, -1]], turn: 1 });
  const props = (state: LudoState, events: LudoEvent[], reducedMotion = false) => ({ state, events, reducedMotion });

  test('à l\'ouverture : les chevaux de l\'état, sans minuteur', () => {
    const { result } = renderHook((p) => useShownHorses(p.state, p.events, p.reducedMotion), { initialProps: props(before, []) });
    expect(result.current.horses).toEqual(before.horses);
    expect(result.current.slide).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('un coup qui suit le précédent : le cheval saute case par case, 80 ms chacune, puis l\'état final ; plus aucun minuteur', () => {
    const { result, rerender } = renderHook((p) => useShownHorses(p.state, p.events, p.reducedMotion), { initialProps: props(before, []) });
    rerender(props(after, [move(0, 0, 10, 13), { type: 'turn', seat: 1 }]));
    // La première case tout de suite : l'état final n'est pas montré avant la fin de la danse.
    expect(result.current.horses[0]![0]).toBe(11);
    advance(STEP_MS);
    expect(result.current.horses[0]![0]).toBe(12);
    advance(STEP_MS);
    expect(result.current.horses[0]![0]).toBe(13);
    advance(STEP_MS);
    expect(result.current.horses).toEqual(after.horses);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('mouvement réduit : l\'état final tout de suite, et aucun minuteur n\'est jamais armé', () => {
    const { result, rerender } = renderHook((p) => useShownHorses(p.state, p.events, p.reducedMotion), { initialProps: props(before, [], true) });
    rerender(props(after, [move(0, 0, 10, 13)], true));
    expect(result.current.horses).toEqual(after.horses);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('un saut d\'état (aucun événement : le panneau s\'ouvre, la connexion revient) : l\'état final tout de suite', () => {
    const { result, rerender } = renderHook((p) => useShownHorses(p.state, p.events, p.reducedMotion), { initialProps: props(before, []) });
    rerender(props(after, []));
    expect(result.current.horses).toEqual(after.horses);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('le même état rendu de nouveau (la plateforme redonne une liste d\'événements vide) ne coupe pas la danse en cours', () => {
    const { result, rerender } = renderHook((p) => useShownHorses(p.state, p.events, p.reducedMotion), { initialProps: props(before, []) });
    rerender(props(after, [move(0, 0, 10, 13)]));
    advance(STEP_MS);
    expect(result.current.horses[0]![0]).toBe(12);
    rerender(props(after, []));
    expect(result.current.horses[0]![0]).toBe(12);
    advance(STEP_MS);
    expect(result.current.horses[0]![0]).toBe(13);
    advance(STEP_MS);
    expect(result.current.horses).toEqual(after.horses);
  });

  test('un autre état en pleine danse : elle est coupée, et la nouvelle part de l\'état précédent', () => {
    const next = fabricateLudo({ horses: [[13, -1, -1, -1], [9, -1, -1, -1]], turn: 0 });
    const { result, rerender } = renderHook((p) => useShownHorses(p.state, p.events, p.reducedMotion), { initialProps: props(before, []) });
    rerender(props(after, [move(0, 0, 10, 13)]));
    advance(STEP_MS);
    expect(result.current.horses[0]![0]).toBe(12);
    // Le coup suivant arrive : l'adversaire avance de 5 à 9.
    rerender(props(next, [move(1, 0, 5, 9)]));
    expect(result.current.horses[1]![0]).toBe(6);
    expect(result.current.horses[0]![0]).toBe(13);
    advance(STEP_MS * 4);
    expect(result.current.horses).toEqual(next.horses);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('une prise : la victime est seule à glisser, à l\'image où elle rentre à l\'écurie, qui dure 300 ms', () => {
    const start = fabricateLudo({ horses: [[10, -1, -1, -1], [1, -1, -1, -1], STABLE, STABLE] });
    const end = fabricateLudo({ horses: [[14, -1, -1, -1], STABLE, STABLE, STABLE], turn: 1 });
    const { result, rerender } = renderHook((p) => useShownHorses(p.state, p.events, p.reducedMotion), { initialProps: props(start, []) });
    rerender(props(end, [move(0, 0, 10, 14), { type: 'capture', seat: 0, victim: { seat: 1, horse: 0 } }]));
    expect(result.current.slide).toBeNull();
    advance(STEP_MS * 3);
    expect(result.current.horses[0]![0]).toBe(14);
    expect(result.current.horses[1]![0]).toBe(1);
    advance(STEP_MS);
    expect(result.current.horses[1]![0]).toBe(-1);
    expect(result.current.slide).toEqual({ seat: 1, horse: 0 });
    advance(CAPTURE_MS);
    expect(result.current.horses).toEqual(end.horses);
    expect(result.current.slide).toBeNull();
  });

  test('le plateau démonté n\'a plus de minuteur', () => {
    const { rerender, unmount } = renderHook((p) => useShownHorses(p.state, p.events, p.reducedMotion), { initialProps: props(before, []) });
    rerender(props(after, [move(0, 0, 10, 13)]));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useDie : le dé qui roule', () => {
  const rolling = fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] });
  const decided = fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], die: 4 });
  const props = (state: LudoState, events: LudoEvent[], reducedMotion = false) => ({ state, events, reducedMotion });

  test('à l\'ouverture : en phase move, le dé de l\'état ; en phase roll, pas encore de valeur', () => {
    expect(renderHook((p) => useDie(p.state, p.events, p.reducedMotion), { initialProps: props(decided, []) }).result.current).toEqual({ value: 4, rolling: false, face: null });
    expect(renderHook((p) => useDie(p.state, p.events, p.reducedMotion), { initialProps: props(rolling, []) }).result.current).toEqual({ value: null, rolling: false, face: null });
  });

  test('un lancer : le dé roule 600 ms sur des faces au hasard, puis s\'arrête sur la valeur du serveur', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99).mockReturnValue(0.5);
    const { result, rerender } = renderHook((p) => useDie(p.state, p.events, p.reducedMotion), { initialProps: props(rolling, []) });
    rerender(props(decided, [{ type: 'dice', seat: 0, value: 4 }]));
    expect(result.current.rolling).toBe(true);
    expect(result.current.face).toBe(1);
    advance(DICE_FACE_MS);
    expect(result.current.face).toBe(6);
    advance(DICE_FACE_MS);
    expect(result.current.rolling).toBe(true);
    advance(DICE_ROLL_MS);
    expect(result.current).toEqual({ value: 4, rolling: false, face: null });
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks();
  });

  test('mouvement réduit : la valeur tout de suite, le dé ne roule pas, aucun minuteur', () => {
    const { result, rerender } = renderHook((p) => useDie(p.state, p.events, p.reducedMotion), { initialProps: props(rolling, [], true) });
    rerender(props(decided, [{ type: 'dice', seat: 0, value: 4 }], true));
    expect(result.current).toEqual({ value: 4, rolling: false, face: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('un lancer qui passe le tour (« pas de coup ») montre quand même le dé, puis le dé reste jusqu\'au lancer suivant', () => {
    const passed = fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], turn: 1 });
    const { result, rerender } = renderHook((p) => useDie(p.state, p.events, p.reducedMotion), { initialProps: props(rolling, [], true) });
    rerender(props(passed, [{ type: 'dice', seat: 0, value: 3 }, { type: 'pass', seat: 0, reason: 'no-move' }, { type: 'turn', seat: 1 }], true));
    expect(result.current.value).toBe(3);
    // Un déplacement, sans lancer : le dé garde sa valeur.
    const moved = fabricateLudo({ horses: [[10, -1, -1, -1], [8, -1, -1, -1]], turn: 0 });
    rerender(props(moved, [move(1, 0, 5, 8), { type: 'turn', seat: 0 }], true));
    expect(result.current.value).toBe(3);
  });

  test('un état de saut en phase move redit le dé ; un nouvel état en pleine roulade remet le dé au repos', () => {
    const { result, rerender } = renderHook((p) => useDie(p.state, p.events, p.reducedMotion), { initialProps: props(rolling, []) });
    rerender(props(decided, [{ type: 'dice', seat: 0, value: 4 }]));
    expect(result.current.rolling).toBe(true);
    const later = fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], die: 2 });
    rerender(props(later, []));
    expect(result.current).toEqual({ value: 2, rolling: false, face: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});
