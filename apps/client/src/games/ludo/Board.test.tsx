import { fabricateLudo, ludo, type LudoEvent, type LudoMove, type LudoState } from '@bureau/shared/games/ludo';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { GameBoardProps } from '../types';
import { LudoBoard } from './Board';
import { DICE_ROLL_MS, STEP_MS } from './frames';

// Le plateau des petits chevaux, monté seul (sans le panneau) : ce que la plateforme lui donne (`GameBoardProps`), et ce qu'il dessine et envoie. Les points du § 9.5 du document des
// jeux sont numérotés dans les titres. Le dessin lui-même est jugé sur des captures (e2e/jeux-ludo.spec.ts) ; ici, sa structure, ses états et ce qui est cliquable.

const STABLE = [-1, -1, -1, -1];
const people = [
  { userId: 'alice', name: 'Alice', avatarKey: null, connected: true },
  { userId: 'bastien', name: 'Bastien', avatarKey: null, connected: true },
  { userId: 'claire', name: 'Claire', avatarKey: null, connected: true },
  { userId: 'dan', name: 'Dan', avatarKey: null, connected: true },
];

type Props = GameBoardProps<LudoState, LudoMove, LudoEvent>;

// Le plateau monté : par défaut le siège 0, c'est à lui de jouer, mouvement réduit (aucun minuteur) ; chaque test dit ce qui change.
function mount(state: LudoState, over: Partial<Props> = {}) {
  const onMove = vi.fn();
  const props: Props = { state, mySeat: 0, players: people.slice(0, state.horses.length), events: [], canAct: true, onMove, reducedMotion: true, preview: false, ...over };
  const view = render(<LudoBoard {...props} />);
  return {
    ...view,
    onMove,
    props,
    update: (next: Partial<Props>) => view.rerender(<LudoBoard {...props} {...next} />),
  };
}

const svg = (container: HTMLElement) => container.querySelector('svg.ludo-board') as SVGSVGElement;
const horses = (container: HTMLElement) => [...container.querySelectorAll<SVGGElement>('.ludo-horse')];
const horse = (container: HTMLElement, seat: number, index: number) => container.querySelector<SVGGElement>(`.ludo-horse[data-seat="${seat}"][data-horse="${index}"]`)!;
const yard = (container: HTMLElement, color: number) => container.querySelector<SVGGElement>(`.ludo-yard[data-color="${color}"]`)!;

// Un faux ResizeObserver : le test donne la largeur du conteneur, comme le navigateur le ferait.
function stubResizeObserver() {
  const watchers: Array<{ callback: ResizeObserverCallback; target: Element | null }> = [];
  class FakeResizeObserver {
    private readonly entry: { callback: ResizeObserverCallback; target: Element | null };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, target: null };
      watchers.push(this.entry);
    }
    observe(target: Element) {
      this.entry.target = target;
    }
    unobserve() {}
    disconnect() {
      watchers.splice(watchers.indexOf(this.entry), 1);
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    resizeTo(width: number) {
      act(() => {
        for (const watcher of watchers) watcher.callback([{ target: watcher.target, contentRect: { width, height: 0 } } as unknown as ResizeObserverEntry], watcher as unknown as ResizeObserver);
      });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('§ 9.5.1 la taille : le plateau se mesure sur son conteneur', () => {
  test('sans mesure, la largeur d\'un panneau de jeu (408 px) : quinze cases entières de 27 px, un plateau carré de 405 px', () => {
    const { container } = mount(ludo.create({ seats: 2, first: 0 }, () => 0.5).state);
    expect(svg(container).getAttribute('width')).toBe('405');
    expect(svg(container).getAttribute('height')).toBe('405');
    expect(container.querySelector('.game-ludo')?.getAttribute('data-cell')).toBe('27');
  });

  test('sur téléphone (311 px de contenu) : 300 px, quinze cases de 20 px, et moins de 380 px de haut', () => {
    const observer = stubResizeObserver();
    const { container } = mount(ludo.create({ seats: 2, first: 0 }, () => 0.5).state);
    observer.resizeTo(311);
    expect(svg(container).getAttribute('width')).toBe('300');
    expect(Number(svg(container).getAttribute('height'))).toBeLessThanOrEqual(380);
  });

  test('il suit son conteneur quand celui-ci change, jamais la fenêtre', () => {
    const observer = stubResizeObserver();
    const windowWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
    try {
      const { container } = mount(ludo.create({ seats: 2, first: 0 }, () => 0.5).state);
      observer.resizeTo(360);
      expect(svg(container).getAttribute('width')).toBe('360');
      observer.resizeTo(440);
      expect(svg(container).getAttribute('width')).toBe('435');
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: windowWidth, configurable: true });
    }
  });

  test('jamais plus large que son conteneur : cases entières, aucune largeur ne déborde (donc jamais de défilement horizontal)', () => {
    const observer = stubResizeObserver();
    const { container } = mount(ludo.create({ seats: 2, first: 0 }, () => 0.5).state);
    for (let width = 180; width <= 640; width += 7) {
      observer.resizeTo(width);
      const drawn = Number(svg(container).getAttribute('width'));
      expect(drawn, `conteneur de ${width} px`).toBeLessThanOrEqual(width);
      expect(drawn % 15).toBe(0);
    }
  });
});

describe('§ 9.5.2 les cibles : tout ce qui se clique fait 24 px au moins', () => {
  test('un cheval jouable se clique sur une zone d\'au moins 24 px, même sur téléphone (cases de 20 px)', () => {
    const observer = stubResizeObserver();
    const { container } = mount(fabricateLudo({ horses: [[10, 20, -1, -1], [5, -1, -1, -1]], die: 3 }));
    for (const width of [408, 311]) {
      observer.resizeTo(width);
      const cell = Number(container.querySelector('.game-ludo')!.getAttribute('data-cell'));
      const hits = [...container.querySelectorAll<SVGRectElement>('.ludo-hit')];
      expect(hits).toHaveLength(2);
      for (const hit of hits) {
        expect(Number(hit.getAttribute('width')) * cell).toBeGreaterThanOrEqual(24);
        expect(Number(hit.getAttribute('height')) * cell).toBeGreaterThanOrEqual(24);
      }
    }
  });

  test('les boutons du lancer et des coups ont un nom en toutes lettres : aucun bouton à icône seule', () => {
    const roll = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }));
    for (const button of roll.container.querySelectorAll('button')) expect(button.textContent!.trim().length).toBeGreaterThan(3);
    roll.unmount();
    const moves = mount(fabricateLudo({ horses: [[-1, 10, 50, -1], [5, -1, -1, -1]], die: 6 }));
    expect(moves.container.querySelectorAll('button')).toHaveLength(3);
    for (const button of moves.container.querySelectorAll('button')) expect(button.textContent!.trim().length).toBeGreaterThan(3);
  });
});

describe('§ 9.5.3 le clavier : la liste des coups est le chemin du clavier ; les cases ne se focalisent pas une à une', () => {
  const state = fabricateLudo({ horses: [[-1, 10, 50, -1], [5, -1, -1, -1]], die: 6 });

  // Une touche envoyée à ce bouton, et ce qu'en savent la page (le clavier de l'avatar écoute `window`) et le navigateur (l'action par défaut).
  function press(target: HTMLElement, key: string) {
    const onWindow = vi.fn();
    window.addEventListener('keydown', onWindow);
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => void target.dispatchEvent(event));
    window.removeEventListener('keydown', onWindow);
    return { prevented: event.defaultPrevented, reachedWindow: onWindow.mock.calls.length > 0 };
  }

  test('le dessin n\'a aucun élément focalisable : ni bouton, ni lien, ni tabindex dans le SVG', () => {
    const { container } = mount(state);
    expect(svg(container).querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
  });

  test('les flèches et Début et Fin passent d\'un coup à l\'autre ; ces touches sont prises (preventDefault, stopPropagation) : l\'avatar ne marche pas', () => {
    const { container } = mount(state);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.ludo-move')];
    expect(buttons).toHaveLength(3);
    buttons[0]!.focus();
    for (const [key, expectedIndex] of [['ArrowDown', 1], ['ArrowRight', 2], ['ArrowUp', 1], ['ArrowLeft', 0], ['End', 2], ['Home', 0]] as const) {
      const { prevented, reachedWindow } = press(document.activeElement as HTMLElement, key);
      expect(prevented, key).toBe(true);
      expect(reachedWindow, key).toBe(false);
      expect(document.activeElement, key).toBe(buttons[expectedIndex]);
    }
    // Aux bouts, le focus reste : il ne boucle pas, et la touche est prise quand même.
    expect(press(buttons[0]!, 'ArrowUp').prevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  test('le bouton « Lancer le dé » prend aussi les flèches : l\'avatar ne s\'en va pas pendant qu\'on joue', () => {
    const { container } = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }));
    const roll = container.querySelector<HTMLButtonElement>('.ludo-roll')!;
    roll.focus();
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      const { prevented, reachedWindow } = press(roll, key);
      expect(prevented, key).toBe(true);
      expect(reachedWindow, key).toBe(false);
    }
  });

  test('les touches que le plateau n\'utilise pas passent : E, ZQSD, le zoom, Échap (qui ferme le panneau), Tab', () => {
    const { container } = mount(state);
    const button = container.querySelector<HTMLButtonElement>('.ludo-move')!;
    for (const key of ['e', 'z', 'q', 's', 'd', '+', '-', '0', 'Escape', 'Tab']) {
      const { prevented, reachedWindow } = press(button, key);
      expect(prevented, key).toBe(false);
      expect(reachedWindow, key).toBe(true);
    }
  });

  test('Entrée et Espace jouent le coup (l\'action native du bouton : la touche n\'est pas détournée)', async () => {
    const { container, onMove } = mount(state);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.ludo-move')];
    buttons[1]!.focus();
    await userEvent.keyboard('{Enter}');
    expect(onMove).toHaveBeenLastCalledWith({ type: 'move', horse: 1 });
    buttons[2]!.focus();
    await userEvent.keyboard(' ');
    expect(onMove).toHaveBeenLastCalledWith({ type: 'move', horse: 2 });
  });
});

describe('§ 9.5.4 le lecteur d\'écran : un plateau nommé, un équivalent texte, des boutons qui disent le coup', () => {
  test('le plateau est une image nommée, décrite par « Position des chevaux » : par couleur, l\'écurie, les cases, les arrivés', () => {
    const state = fabricateLudo({ horses: [[-1, 10, 52, 56], [0, 33, -1, -1]], turn: 1 });
    const { container } = mount(state, { mySeat: 0, canAct: false });
    const board = screen.getByRole('img', { name: 'Plateau des petits chevaux' });
    const region = screen.getByRole('region', { name: 'Position des chevaux' });
    expect(board.getAttribute('aria-describedby')).toBe(region.id);
    const lines = within(region).getAllByRole('listitem').map((item) => item.textContent);
    expect(lines).toEqual([
      'Rouge, Alice (toi) : cheval 1 à l\'écurie ; cheval 2 à 10 cases de son départ ; cheval 3 dans son allée, case 2 sur 5 ; cheval 4 arrivé.',
      'Jaune, Bastien : cheval 1 sur sa case de départ ; cheval 2 à 33 cases de son départ ; cheval 3 à l\'écurie ; cheval 4 à l\'écurie.',
    ]);
    expect(container.querySelector('.ludo-position')!.classList.contains('visually-hidden')).toBe(true);
  });

  test('« 1 case » au singulier, et un siège sorti n\'a plus de chevaux à dire', () => {
    const state = fabricateLudo({ horses: [[1, -1, -1, -1], STABLE, [3, -1, -1, -1]], out: [{ seat: 1, reason: 'resign' }] });
    mount(state, { mySeat: 0, canAct: false });
    const lines = within(screen.getByRole('region', { name: 'Position des chevaux' })).getAllByRole('listitem').map((item) => item.textContent);
    expect(lines[0]).toContain('cheval 1 à 1 case de son départ');
    expect(lines[1]).toBe('Vert, Bastien : a quitté la partie.');
  });

  test('chaque coup est un bouton dont le nom dit le coup : sortir, avancer (avec la prise), arriver', () => {
    const state = fabricateLudo({ horses: [[-1, 10, 50, -1], [39, -1, -1, -1], STABLE], die: 6 });
    mount(state);
    expect(screen.getByRole('group', { name: 'Coups possibles' })).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Sortir un cheval, prise !', 'Cheval 2 : avancer de 6', 'Cheval 3 : arrivée']);
  });

  test('« Cheval 2 : avancer de 4, prise ! » : la prise est dite dans le nom du bouton', () => {
    mount(fabricateLudo({ horses: [[-1, 10, -1, -1], [1, -1, -1, -1], STABLE, STABLE], die: 4 }));
    expect(screen.getByRole('button', { name: 'Cheval 2 : avancer de 4, prise !' })).toBeTruthy();
  });

  test('« Sortir un cheval » sans prise, quand personne n\'est sur la case de départ', () => {
    mount(fabricateLudo({ horses: [[-1, -1, -1, -1], [5, -1, -1, -1]], die: 6 }));
    expect(screen.getByRole('button', { name: 'Sortir un cheval' })).toBeTruthy();
  });

  test('le dé est une image nommée : « Dé : 4 », ou « pas encore lancé »', () => {
    mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], die: 4 }));
    expect(screen.getByRole('img', { name: 'Dé : 4' })).toBeTruthy();
  });

  test('le dé d\'une partie qu\'on rejoint en phase de lancer n\'a pas encore de valeur', () => {
    mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }));
    expect(screen.getByRole('img', { name: 'Dé : pas encore lancé' })).toBeTruthy();
  });

  test('la couleur n\'est jamais seule : le nom du joueur est écrit dans son écurie, et « sorti » dans celle d\'un siège sorti', () => {
    const state = fabricateLudo({ horses: [[10, -1, -1, -1], STABLE, [3, -1, -1, -1]], out: [{ seat: 1, reason: 'timeout' }] });
    const { container } = mount(state, { mySeat: null, canAct: false });
    expect(yard(container, 0).textContent).toContain('Alice');
    expect(yard(container, 1).textContent).toContain('Bastien');
    expect(yard(container, 1).textContent).toContain('sorti');
    expect(yard(container, 1).getAttribute('data-out')).toBe('true');
    expect(yard(container, 2).textContent).toContain('Claire');
    expect(yard(container, 2).getAttribute('data-out')).toBeNull();
  });
});

describe('§ 9.5.5 le mouvement réduit : l\'état final tout de suite, pour le dé et les sauts', () => {
  const before = fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] });
  const after = fabricateLudo({ horses: [[13, -1, -1, -1], [5, -1, -1, -1]], turn: 1 });
  const hop: LudoEvent[] = [{ type: 'move', seat: 0, horse: 0, from: 10, to: 13 }, { type: 'turn', seat: 1 }];

  test('avec le mouvement réduit : le cheval est à son arrivée tout de suite, aucun minuteur n\'est armé', () => {
    vi.useFakeTimers();
    const { container, update } = mount(before, { reducedMotion: true });
    update({ state: after, events: hop });
    expect(horse(container, 0, 0).getAttribute('data-advance')).toBe('13');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('avec le mouvement réduit : le dé a sa valeur tout de suite, il ne roule pas', () => {
    vi.useFakeTimers();
    const { container, update } = mount(before, { reducedMotion: true });
    update({ state: fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], die: 5 }), events: [{ type: 'dice', seat: 0, value: 5 }] });
    expect(screen.getByRole('img', { name: 'Dé : 5' })).toBeTruthy();
    expect(container.querySelector('.ludo-die')!.getAttribute('data-rolling')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('sans mouvement réduit : le cheval saute de case en case (80 ms par case), puis il est à son arrivée', () => {
    vi.useFakeTimers();
    const { container, update } = mount(before, { reducedMotion: false });
    update({ state: after, events: hop });
    expect(horse(container, 0, 0).getAttribute('data-advance')).toBe('11');
    act(() => void vi.advanceTimersByTime(STEP_MS));
    expect(horse(container, 0, 0).getAttribute('data-advance')).toBe('12');
    act(() => void vi.advanceTimersByTime(STEP_MS * 2));
    expect(horse(container, 0, 0).getAttribute('data-advance')).toBe('13');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('sans mouvement réduit : le dé roule, puis s\'arrête sur la valeur du serveur', () => {
    vi.useFakeTimers();
    const { container, update } = mount(before, { reducedMotion: false });
    update({ state: fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], die: 5 }), events: [{ type: 'dice', seat: 0, value: 5 }] });
    const die = container.querySelector('.ludo-die')!;
    expect(die.getAttribute('data-rolling')).toBe('true');
    expect(screen.getByRole('img', { name: 'Le dé roule' })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(DICE_ROLL_MS));
    expect(die.getAttribute('data-rolling')).toBeNull();
    expect(screen.getByRole('img', { name: 'Dé : 5' })).toBeTruthy();
  });

  test('un cheval pris glisse jusqu\'à son écurie : seul le cheval pris porte la marque de glissement', () => {
    vi.useFakeTimers();
    const start = fabricateLudo({ horses: [[10, -1, -1, -1], [1, -1, -1, -1], STABLE, STABLE] });
    const end = fabricateLudo({ horses: [[14, -1, -1, -1], STABLE, STABLE, STABLE], turn: 1 });
    const { container, update } = mount(start, { reducedMotion: false });
    update({ state: end, events: [{ type: 'move', seat: 0, horse: 0, from: 10, to: 14 }, { type: 'capture', seat: 0, victim: { seat: 1, horse: 0 } }] });
    act(() => void vi.advanceTimersByTime(STEP_MS * 4));
    expect(horse(container, 1, 0).getAttribute('data-sliding')).toBe('true');
    expect(horse(container, 0, 0).getAttribute('data-sliding')).toBeNull();
    expect(horse(container, 1, 0).getAttribute('data-advance')).toBe('-1');
  });
});

describe('§ 9.5.6 les images : tout est dessiné en code', () => {
  test('aucune image : ni <img>, ni <canvas>, ni url() ; le plateau est un SVG aux bords nets', () => {
    const { container } = mount(fabricateLudo({ horses: [[10, 20, -1, -1], [5, 56, -1, -1]], die: 3 }));
    expect(container.querySelectorAll('img, canvas, image, foreignObject')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('url(');
    expect(svg(container).getAttribute('shape-rendering')).toBe('crispEdges');
  });

  test('seize chevaux au plus, en pixel art : chacun est un groupe de chemins, un par lettre de la grille', () => {
    const { container } = mount(ludo.create({ seats: 4, first: 0 }, () => 0.5).state, { mySeat: null, canAct: false });
    expect(horses(container)).toHaveLength(16);
    for (const element of horses(container)) expect(element.querySelectorAll('path')).toHaveLength(7);
  });
});

describe('§ 9.5.7 les sons : aucun clic de plus', () => {
  test('tous les boutons portent data-sfx="none" : la plateforme joue ses propres sons', () => {
    const roll = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }));
    for (const button of roll.container.querySelectorAll('button')) expect(button.getAttribute('data-sfx')).toBe('none');
    roll.unmount();
    const moves = mount(fabricateLudo({ horses: [[-1, 10, 50, -1], [5, -1, -1, -1]], die: 6 }));
    expect(moves.container.querySelectorAll('button').length).toBeGreaterThan(0);
    for (const button of moves.container.querySelectorAll('button')) expect(button.getAttribute('data-sfx')).toBe('none');
  });
});

describe('§ 9.5.8 le spectateur : rien n\'est cliquable, le plateau ne tourne pas', () => {
  const state = fabricateLudo({ horses: [[10, 20, -1, -1], [5, -1, -1, -1]], turn: 0, die: 3, last: { seat: 1, horse: 0, from: 2, to: 5 } });

  test('sans siège : ni bouton, ni zone cliquable sur le plateau', () => {
    const { container } = mount(state, { mySeat: null, canAct: false });
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('.ludo-hit')).toHaveLength(0);
  });

  test('orientation du siège 0 : le plateau ne tourne pas, l\'écurie rouge reste en haut à gauche', () => {
    const { container } = mount(state, { mySeat: null, canAct: false });
    expect(container.querySelector('.game-ludo')!.getAttribute('data-turns')).toBe('0');
    const rect = yard(container, 0).querySelector('rect')!;
    expect([Number(rect.getAttribute('x')), Number(rect.getAttribute('y'))]).toEqual([0, 0]);
  });

  test('le dernier coup et le dé restent visibles', () => {
    const { container } = mount(state, { mySeat: null, canAct: false });
    expect(container.querySelector('.ludo-last')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Dé : 3' })).toBeTruthy();
  });

  test('l\'aperçu d\'avant la première partie : tous les chevaux à l\'écurie, rien n\'est cliquable', () => {
    const preview = ludo.create({ seats: 2, first: 0 }, () => 0.5).state;
    const { container } = mount(preview, { mySeat: null, canAct: false, preview: true });
    expect(horses(container)).toHaveLength(8);
    expect(horses(container).every((element) => element.getAttribute('data-advance') === '-1')).toBe(true);
    expect(container.querySelectorAll('button, .ludo-hit')).toHaveLength(0);
    expect(container.querySelector('.game-ludo')!.getAttribute('data-preview')).toBe('true');
  });
});

describe('le lancer, et les coups : ce que le plateau envoie', () => {
  test('à moi de lancer : « Lancer le dé » envoie { type: \'roll\' } ; aucun coup n\'est proposé', async () => {
    const { container, onMove } = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }));
    expect(container.querySelector('.ludo-moves')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Lancer le dé' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'roll' });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  test('le lancer n\'est jamais proposé hors de la phase de lancer : en phase de coup, il n\'y a que les coups', () => {
    const { container } = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], die: 3 }));
    expect(screen.queryByRole('button', { name: 'Lancer le dé' })).toBeNull();
    expect(container.querySelectorAll('.ludo-roll')).toHaveLength(0);
    expect(container.querySelectorAll('.ludo-move')).toHaveLength(1);
  });

  test('un coup : le bouton envoie { type: \'move\', horse } ; le cheval joué n\'est pas toujours le premier', async () => {
    const { onMove } = mount(fabricateLudo({ horses: [[-1, 10, 50, -1], [5, -1, -1, -1]], die: 6 }));
    await userEvent.click(screen.getByRole('button', { name: 'Cheval 3 : arrivée' }));
    expect(onMove).toHaveBeenLastCalledWith({ type: 'move', horse: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Sortir un cheval' }));
    expect(onMove).toHaveBeenLastCalledWith({ type: 'move', horse: 0 });
  });

  test('un clic sur un cheval jouable, sur le plateau, joue son coup ; un cheval qui ne peut pas jouer n\'a pas de zone cliquable', async () => {
    const { container, onMove } = mount(fabricateLudo({ horses: [[10, 20, 30, -1], [5, -1, -1, -1]], die: 3 }));
    // 10 + 3 = 13 est libre, 20 + 3 = 23 aussi, 30 + 3 = 33 aussi : trois chevaux jouables.
    expect(container.querySelectorAll('.ludo-hit')).toHaveLength(3);
    await userEvent.click(horse(container, 0, 1).querySelector('.ludo-hit')!);
    expect(onMove).toHaveBeenCalledWith({ type: 'move', horse: 1 });
    // Le cheval 3 (à l'écurie) ne sort pas avec un 3.
    expect(horse(container, 0, 3).querySelector('.ludo-hit')).toBeNull();
  });

  test('c\'est à moi mais le serveur n\'a pas répondu (canAct faux) : les boutons sont inactifs (aria-disabled, comme ceux de la plateforme : ils gardent le focus), et rien n\'est envoyé', async () => {
    const roll = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }), { canAct: false });
    const button = screen.getByRole('button', { name: 'Lancer le dé' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.focus();
    expect(document.activeElement).toBe(button);
    await userEvent.click(button);
    fireEvent.click(button);
    expect(roll.onMove).not.toHaveBeenCalled();
    roll.unmount();

    const moves = mount(fabricateLudo({ horses: [[10, 20, -1, -1], [5, -1, -1, -1]], die: 3 }), { canAct: false });
    for (const move of screen.getAllByRole('button')) expect(move.getAttribute('aria-disabled')).toBe('true');
    for (const target of moves.container.querySelectorAll('.ludo-hit, .ludo-move')) fireEvent.click(target);
    expect(moves.onMove).not.toHaveBeenCalled();
    // Rien n'est cliquable sur le plateau non plus : pas de zone, pas de chevaux soulignés.
    expect(moves.container.querySelectorAll('.ludo-hit, .ludo-underline')).toHaveLength(0);
  });

  test('quand c\'est à moi et que tout est permis, les boutons ne sont pas inactifs', () => {
    mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }));
    expect(screen.getByRole('button', { name: 'Lancer le dé' }).getAttribute('aria-disabled')).toBeNull();
  });

  test('ce n\'est pas à moi de jouer : ni lancer, ni coups, même si la plateforme se trompait (canAct vrai)', () => {
    const { container, onMove } = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], turn: 1 }), { mySeat: 0, canAct: true });
    expect(container.querySelectorAll('button, .ludo-hit')).toHaveLength(0);
    expect(onMove).not.toHaveBeenCalled();
  });

  test('la partie est finie : plus rien à jouer', () => {
    const ended = ludo.forfeit(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }), 1, 'resign').state;
    const { container } = mount(ended, { canAct: true });
    expect(container.querySelectorAll('button, .ludo-hit')).toHaveLength(0);
  });
});

describe('les chevaux jouables, l\'aperçu d\'un coup', () => {
  test('les chevaux jouables sont soulignés et numérotés (le numéro du bouton) ; les autres non', () => {
    const { container } = mount(fabricateLudo({ horses: [[-1, 10, 50, -1], [5, -1, -1, -1]], die: 6 }));
    const playable = horses(container).filter((element) => element.getAttribute('data-playable') === 'true');
    expect(playable.map((element) => [element.getAttribute('data-seat'), element.getAttribute('data-horse')])).toEqual([['0', '0'], ['0', '1'], ['0', '2']]);
    expect(playable.map((element) => element.querySelector('.ludo-horse-number')?.textContent)).toEqual(['1', '2', '3']);
    expect(horse(container, 0, 3).getAttribute('data-playable')).toBeNull();
    expect(horse(container, 1, 0).getAttribute('data-playable')).toBeNull();
  });

  test('survoler ou viser un coup marque sa case d\'arrivée ; la prise se voit ; quitter l\'efface', async () => {
    const { container } = mount(fabricateLudo({ horses: [[-1, 10, -1, -1], [1, -1, -1, -1], STABLE, STABLE], die: 4 }));
    expect(container.querySelector('.ludo-target')).toBeNull();
    const button = screen.getByRole('button', { name: 'Cheval 2 : avancer de 4, prise !' });
    await userEvent.hover(button);
    const target = container.querySelector('.ludo-target')!;
    expect(target).toBeTruthy();
    expect(target.getAttribute('data-capture')).toBe('true');
    expect(target.getAttribute('data-horse')).toBe('1');
    await userEvent.unhover(button);
    expect(container.querySelector('.ludo-target')).toBeNull();
    act(() => button.focus());
    expect(container.querySelector('.ludo-target')).toBeTruthy();
    act(() => button.blur());
    expect(container.querySelector('.ludo-target')).toBeNull();
  });

  test('survoler un cheval jouable sur le plateau marque aussi sa case d\'arrivée', async () => {
    const { container } = mount(fabricateLudo({ horses: [[10, 20, -1, -1], [5, -1, -1, -1]], die: 3 }));
    await userEvent.hover(horse(container, 0, 0).querySelector('.ludo-hit')!);
    expect(container.querySelector('.ludo-target')?.getAttribute('data-horse')).toBe('0');
    expect(container.querySelector('.ludo-target')?.getAttribute('data-capture')).toBeNull();
  });

  test('la case marquée est celle où le cheval arrivera (le centre de sa case), la même que celle où il sera dessiné', () => {
    const state = fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], die: 3 });
    const { container } = mount(state);
    fireEvent.mouseEnter(container.querySelector('.ludo-move')!);
    const target = container.querySelector('.ludo-target')!;
    const [cx, cy] = [Number(target.getAttribute('cx')), Number(target.getAttribute('cy'))];
    const moved = mount(fabricateLudo({ horses: [[13, -1, -1, -1], [5, -1, -1, -1]], turn: 1 }), { mySeat: 0, canAct: false });
    const arrival = horse(moved.container, 0, 0);
    expect([Number(arrival.getAttribute('data-x')), Number(arrival.getAttribute('data-y'))]).toEqual([cx, cy]);
  });
});

describe('l\'orientation : son écurie en bas à gauche', () => {
  const four = ludo.create({ seats: 4, first: 0 }, () => 0.5).state;

  test.each([
    [0, 'rouge', 3],
    [1, 'vert', 2],
    [2, 'jaune', 1],
    [3, 'bleu', 0],
  ])('le siège %i (%s) : %i quarts de tour, et son écurie est en bas à gauche, les autres ailleurs', (seat, _name, turns) => {
    const { container } = mount(four, { mySeat: seat, canAct: false });
    expect(container.querySelector('.game-ludo')!.getAttribute('data-turns')).toBe(String(turns));
    const center = (color: number) => {
      const rect = yard(container, color).querySelector('rect')!;
      return { x: Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2, y: Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2 };
    };
    expect(center(seat).x).toBeLessThan(7.5);
    expect(center(seat).y).toBeGreaterThan(7.5);
    // Quatre écuries, quatre coins : une seule en bas à gauche.
    const corners = [0, 1, 2, 3].map((color) => `${center(color).x < 7.5 ? 'gauche' : 'droite'}-${center(color).y < 7.5 ? 'haut' : 'bas'}`);
    expect(new Set(corners).size).toBe(4);
  });

  test('à deux joueurs, le siège 1 est jaune : il joue avec son écurie en bas à gauche, et voit l\'écurie rouge en haut à droite', () => {
    const { container } = mount(fabricateLudo({ horses: [STABLE, STABLE], turn: 1 }), { mySeat: 1, canAct: false });
    expect(container.querySelector('.game-ludo')!.getAttribute('data-turns')).toBe('1');
    const rect = yard(container, 0).querySelector('rect')!;
    expect(Number(rect.getAttribute('x'))).toBeGreaterThan(7.5);
    expect(Number(rect.getAttribute('y'))).toBeLessThan(7.5);
  });

  test('le texte reste droit : les noms des joueurs ne sont jamais tournés', () => {
    const { container } = mount(four, { mySeat: 0, canAct: false });
    for (const label of container.querySelectorAll('text')) expect(label.getAttribute('transform')).toBeNull();
  });
});

describe('les repères du dé et les chevaux arrivés', () => {
  test('« 1er six », « 2e six » : les 6 déjà tirés dans le tour', () => {
    const one = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], sixes: 1 }));
    expect([...one.container.querySelectorAll('.ludo-mark')].map((mark) => mark.textContent)).toEqual(['1er six']);
    one.unmount();
    const two = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]], sixes: 2 }));
    expect([...two.container.querySelectorAll('.ludo-mark')].map((mark) => mark.textContent)).toEqual(['2e six']);
  });

  test('sans cheval en jeu : « 3 essais pour faire un 6 », puis « encore 2 essais », « encore 1 essai »', () => {
    const marks = (tries: number) => {
      const view = mount(fabricateLudo({ horses: [STABLE, [5, -1, -1, -1]], tries }));
      const text = [...view.container.querySelectorAll('.ludo-mark')].map((mark) => mark.textContent);
      view.unmount();
      return text;
    };
    expect(marks(0)).toEqual(['3 essais pour faire un 6']);
    expect(marks(1)).toEqual(['encore 2 essais']);
    expect(marks(2)).toEqual(['encore 1 essai']);
  });

  test('avec un cheval en jeu, ou quand ce n\'est pas le moment de lancer : pas de repère d\'essais', () => {
    const inPlay = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }));
    expect(inPlay.container.querySelectorAll('.ludo-mark')).toHaveLength(0);
    inPlay.unmount();
    const moving = mount(fabricateLudo({ horses: [STABLE, [5, -1, -1, -1]], die: 6, tries: 1 }));
    expect(moving.container.querySelectorAll('.ludo-mark')).toHaveLength(0);
  });

  test('les chevaux arrivés ne sont plus des chevaux à l\'écurie : ils sont comptés dans le triangle de leur couleur', () => {
    const { container } = mount(fabricateLudo({ horses: [[56, 56, 56, 10], [56, -1, -1, -1]], turn: 1 }), { mySeat: null, canAct: false });
    const arrived = [...container.querySelectorAll('.ludo-arrived')];
    expect(arrived.map((element) => [element.getAttribute('data-color'), element.getAttribute('data-count')])).toEqual([['0', '3'], ['2', '1']]);
    expect(arrived[0]!.textContent).toBe('3');
    // Chevaux dessinés : un en piste pour le rouge, trois à l'écurie pour le jaune ; les arrivés sont dans les triangles.
    expect(horses(container).map((element) => `${element.getAttribute('data-seat')}-${element.getAttribute('data-horse')}`)).toEqual(['0-3', '1-1', '1-2', '1-3']);
  });
});

describe('le dessin : la taille des chevaux, les chevaux arrivés, le dé, le trait', () => {
  // La taille d'une tête de cheval à l'écran, en pixels : l'échelle de son dessin (12 × 12), fois la case.
  const horsePixels = (container: HTMLElement): number => {
    const sprite = container.querySelector('.ludo-horse > g')!;
    const scale = Number(/scale\(([\d.]+)\)/.exec(sprite.getAttribute('transform')!)![1]);
    return scale * 12 * Number(container.querySelector('.game-ludo')!.getAttribute('data-cell'));
  };

  test('une tête de cheval fait 24 px sur un panneau de 408 px (deux pixels d\'écran par pixel du dessin, des bords nets) et 16 px sur téléphone', () => {
    const observer = stubResizeObserver();
    const { container } = mount(ludo.create({ seats: 2, first: 0 }, () => 0.5).state, { mySeat: null, canAct: false });
    expect(horsePixels(container)).toBeCloseTo(24);
    observer.resizeTo(311);
    expect(horsePixels(container)).toBeCloseTo(16);
  });

  test('les nombres de chevaux arrivés restent chacun dans le triangle de leur couleur, loin des autres chevaux et des autres nombres', () => {
    const state = fabricateLudo({ horses: [[56, 56, 56, 10], [56, 56, -1, -1], [56, -1, -1, -1], [56, 56, 56, -1]], turn: 0 });
    const { container } = mount(state, { mySeat: null, canAct: false });
    const point = (element: Element) => ({ x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')) });
    const triangle = (color: number) => (container.querySelector(`.ludo-home[data-color="${color}"]`)!.getAttribute('points')!.split(' ').map((pair) => pair.split(',').map(Number)) as number[][]);
    const inside = (p: { x: number; y: number }, [a, b, c]: number[][]) => {
      const side = (u: number[], v: number[]) => (v[0]! - u[0]!) * (p.y - u[1]!) - (v[1]! - u[1]!) * (p.x - u[0]!);
      const signs = [side(a!, b!), side(b!, c!), side(c!, a!)];
      return signs.every((value) => value >= 0) || signs.every((value) => value <= 0);
    };
    const groups = [...container.querySelectorAll('.ludo-arrived')];
    expect(groups).toHaveLength(4);
    const digits = groups.map((group) => point(group.querySelector('.ludo-arrived-count')!));
    const sprites = groups.map((group) => {
      const [, x, y] = /translate\(([\d.-]+) ([\d.-]+)\)/.exec(group.firstElementChild!.getAttribute('transform')!)!.map(Number);
      return { x: x!, y: y! };
    });
    groups.forEach((group, i) => {
      const color = Number(group.getAttribute('data-color'));
      expect(inside(digits[i]!, triangle(color)), `le nombre de la couleur ${color}`).toBe(true);
      expect(inside(sprites[i]!, triangle(color)), `le cheval de la couleur ${color}`).toBe(true);
      for (let j = 0; j < groups.length; j++) {
        if (j === i) continue;
        expect(Math.hypot(digits[i]!.x - digits[j]!.x, digits[i]!.y - digits[j]!.y), `nombres ${i} et ${j}`).toBeGreaterThan(0.9);
        expect(Math.hypot(digits[i]!.x - sprites[j]!.x, digits[i]!.y - sprites[j]!.y), `nombre ${i}, cheval ${j}`).toBeGreaterThan(0.8);
      }
    });
  });

  test('un dé sans valeur est dessiné sans point ; en fin de partie, sans valeur, il n\'est plus dessiné du tout', () => {
    const waiting = mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }));
    const die = waiting.container.querySelector('.ludo-die')!;
    expect(die.getAttribute('data-value')).toBeNull();
    expect(die.querySelectorAll('.ludo-die-pip')).toHaveLength(0);
    waiting.unmount();
    const ended = ludo.forfeit(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }), 1, 'resign').state;
    const over = mount(ended, { mySeat: 0, canAct: false });
    expect(over.container.querySelector('.ludo-die')).toBeNull();
  });

  test('le siège qui a le trait a son écurie marquée, et personne n\'en a plus à la fin', () => {
    const four = ludo.create({ seats: 4, first: 2 }, () => 0.5).state;
    const { container, unmount } = mount(four, { mySeat: null, canAct: false });
    expect([0, 1, 2, 3].map((color) => yard(container, color).getAttribute('data-turn'))).toEqual([null, null, 'true', null]);
    unmount();
    const ended = ludo.forfeit(fabricateLudo({ horses: [STABLE, STABLE] }), 1, 'resign').state;
    const over = mount(ended, { mySeat: null, canAct: false });
    expect(over.container.querySelectorAll('.ludo-yard[data-turn]')).toHaveLength(0);
  });
});

describe('un siège sorti, la fin de la partie', () => {
  test('un siège sorti : son écurie est grisée, ses chevaux ne sont plus dessinés', () => {
    const state = fabricateLudo({ horses: [[10, -1, -1, -1], STABLE, [3, -1, -1, -1]], out: [{ seat: 1, reason: 'resign' }] });
    const { container } = mount(state, { mySeat: null, canAct: false });
    expect(horses(container).filter((element) => element.getAttribute('data-seat') === '1')).toHaveLength(0);
    expect(yard(container, 1).getAttribute('data-out')).toBe('true');
  });

  test('la partie finie : le classement complet, du premier au dernier, avec les avancées, et les sortis marqués', () => {
    const start = fabricateLudo({ horses: [[56, 56, 56, 55], [20, 21, -1, -1], STABLE, [5, -1, -1, -1]], out: [{ seat: 2, reason: 'resign' }], die: 1 });
    const out = ludo.apply(start, 0, { type: 'move', horse: 3 }, () => 0.5);
    if (!out.ok) throw new Error('coup refusé');
    const { container } = mount(out.state, { mySeat: 0, canAct: false });
    const standings = screen.getByRole('list', { name: 'Classement de la partie' });
    const rows = within(standings).getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual([
      '1. Alice, rouge : avancée 228 sur 228',
      '2. Bastien, vert : avancée 43 sur 228',
      '3. Dan, bleu : avancée 6 sur 228',
      '4. Claire, jaune : a quitté la partie',
    ]);
    expect(container.querySelector('.game-ludo')!.getAttribute('data-phase')).toBe('over');
  });

  test('des ex æquo ont le même rang', () => {
    const start = fabricateLudo({ horses: [[56, 56, 56, 55], [20, 21, -1, -1], [42, -1, -1, -1]], die: 1 });
    const out = ludo.apply(start, 0, { type: 'move', horse: 3 }, () => 0.5);
    if (!out.ok) throw new Error('coup refusé');
    mount(out.state, { mySeat: null, canAct: false });
    const rows = within(screen.getByRole('list', { name: 'Classement de la partie' })).getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual(['1. Alice, rouge : avancée 228 sur 228', '2. Bastien, vert : avancée 43 sur 228', '2. Claire, jaune : avancée 43 sur 228']);
  });

  test('pas de classement pendant la partie', () => {
    mount(fabricateLudo({ horses: [[10, -1, -1, -1], [5, -1, -1, -1]] }));
    expect(screen.queryByRole('list', { name: 'Classement de la partie' })).toBeNull();
  });

  test('le dernier coup est marqué sur le plateau : la case où le cheval vient d\'arriver', () => {
    const { container } = mount(fabricateLudo({ horses: [[14, -1, -1, -1], STABLE], turn: 1, last: { seat: 0, horse: 0, from: 10, to: 14 } }), { mySeat: 1, canAct: false });
    const last = container.querySelector('.ludo-last')!;
    expect(last).toBeTruthy();
    const arrival = horse(container, 0, 0);
    expect([Number(last.getAttribute('data-x')), Number(last.getAttribute('data-y'))]).toEqual([Number(arrival.getAttribute('data-x')), Number(arrival.getAttribute('data-y'))]);
  });
});
