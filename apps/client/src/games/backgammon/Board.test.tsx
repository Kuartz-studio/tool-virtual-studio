import { backgammon, backgammonStateFrom, STARTING_LAYOUT, type BackgammonEvent, type BackgammonLayout, type BackgammonMove, type BackgammonState } from '@bureau/shared/games/backgammon';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { GameBoardProps, GamePlayerView } from '../types';
import { Board } from './Board';

// Le plateau du backgammon monté seul, comme la plateforme le monte : avec l'état, le siège, les événements, `canAct`, `onMove`, le mouvement réduit et l'aperçu. Chaque point du
// § 9.5 du document des jeux (largeur du conteneur, cibles de 24 px, clavier, noms accessibles, mouvement réduit, spectateur) a ses tests ici, puis la manière dont un tour se construit.

type Props = GameBoardProps<BackgammonState, BackgammonMove, BackgammonEvent>;

const PLAYERS: GamePlayerView[] = [
  { userId: 'alice', name: 'Alice', avatarKey: null, connected: true },
  { userId: 'bastien', name: 'Bastien', avatarKey: null, connected: true },
];

const position = (layout: BackgammonLayout): BackgammonState => backgammonStateFrom(layout);
// Le départ avec ces dés (phase `move`), ou sans dés (phase `roll`) ; le trait est aux Blancs sauf mention.
const start = (dice?: number[], turn: 0 | 1 = 0): BackgammonState => position({ white: STARTING_LAYOUT, red: STARTING_LAYOUT, turn, ...(dice ? { dice } : {}) });

function propsFor(over: Partial<Props> = {}): Props {
  return { state: start([3, 1]), mySeat: 0, players: PLAYERS, events: [], canAct: true, onMove: vi.fn(), reducedMotion: true, preview: false, ...over };
}
const mount = (over: Partial<Props> = {}) => {
  const props = propsFor(over);
  return { props, ...render(<Board {...props} />) };
};

// Un faux ResizeObserver : le tablier se mesure sur son conteneur. Il donne la largeur à `observe`, comme le navigateur, puis à chaque `resize`.
function fakeResizeObserver(initial: number) {
  const observers = new Set<{ target: Element | null; callback: (entries: Array<{ contentRect: { width: number } }>) => void }>();
  let current = initial;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly entry: { target: Element | null; callback: (entries: Array<{ contentRect: { width: number } }>) => void };
      constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
        this.entry = { target: null, callback };
      }
      observe(target: Element) {
        this.entry.target = target;
        observers.add(this.entry);
        this.entry.callback([{ contentRect: { width: current } }]);
      }
      unobserve() {}
      disconnect() {
        observers.delete(this.entry);
      }
    },
  );
  return {
    observed: () => [...observers].map((entry) => entry.target),
    resize(width: number) {
      current = width;
      act(() => {
        for (const entry of observers) entry.callback([{ contentRect: { width } }]);
      });
    },
  };
}

beforeEach(() => {
  fakeResizeObserver(408);
});
afterEach(() => {
  vi.useRealTimers();
});

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const queryButton = (name: string | RegExp) => screen.queryByRole('button', { name });
const pointButtons = () => screen.getAllByRole('button').filter((element) => /^Point \d+ :/.test(element.getAttribute('aria-label') ?? ''));
const click = (name: string | RegExp) => fireEvent.click(button(name));
const dice = (container: HTMLElement) => container.querySelector('.game-backgammon-dice') as SVGGElement | null;

describe('le dessin : chaque case dit ce qu\'elle porte', () => {
  test('le départ vu des Blancs : 24 points, la barre, la sortie ; chaque case a un nom qui dit son numéro et ses pions', () => {
    mount({ state: start(), canAct: false });
    expect(pointButtons()).toHaveLength(24);
    expect(button('Barre : vide')).toBeTruthy();
    expect(button('Sortie : aucun pion sorti')).toBeTruthy();
    for (const name of [
      'Point 24 : 2 pions blancs',
      'Point 13 : 5 pions blancs',
      'Point 8 : 3 pions blancs',
      'Point 6 : 5 pions blancs',
      'Point 1 : 2 pions rouges',
      'Point 12 : 5 pions rouges',
      'Point 17 : 3 pions rouges',
      'Point 19 : 5 pions rouges',
      'Point 2 : vide',
    ]) {
      expect(button(name), name).toBeTruthy();
    }
  });

  test('vu des Rouges, le même départ est retourné : leurs points sont comptés depuis leur maison', () => {
    mount({ state: start(), mySeat: 1, canAct: false });
    for (const name of ['Point 24 : 2 pions rouges', 'Point 13 : 5 pions rouges', 'Point 8 : 3 pions rouges', 'Point 6 : 5 pions rouges', 'Point 1 : 2 pions blancs', 'Point 12 : 5 pions blancs']) {
      expect(button(name), name).toBeTruthy();
    }
  });

  test('un spectateur voit le plateau des Blancs (leur maison en bas à droite), et rien n\'est jouable pour lui', () => {
    const { container } = mount({ state: start([3, 1]), mySeat: null, canAct: false });
    expect(container.querySelector('.game-backgammon')!.getAttribute('data-view-seat')).toBe('0');
    expect(button('Point 24 : 2 pions blancs')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /jouable/ })).toBeNull();
    expect(queryButton('Lancer les dés')).toBeNull();
    expect(queryButton('Valider')).toBeNull();
  });

  test('la barre et la sortie : ce qu\'elles portent de chaque couleur, et les pions sortis de celui qui regarde', () => {
    const state = position({ white: { 13: 5, 6: 6 }, whiteBar: 1, whiteOff: 3, red: { 11: 5, 6: 5 }, redBar: 2, redOff: 3, dice: [3, 1] });
    mount({ state, canAct: false });
    expect(button('Barre : 1 pion blanc et 2 pions rouges')).toBeTruthy();
    expect(button('Sortie : 3 pions sortis')).toBeTruthy();
  });

  test('une pile montre cinq pions au plus, puis « +n » : huit pions sont cinq dessinés et « +3 »', () => {
    const state = position({ white: { 13: 8, 6: 7 }, red: { 11: 15 } });
    const { container } = mount({ state, canAct: false });
    const stack = container.querySelector('.game-backgammon-stack[data-count="8"]')!;
    expect(stack.querySelectorAll('use')).toHaveLength(5);
    expect(stack.textContent).toBe('+3');
    expect(button('Point 13 : 8 pions blancs')).toBeTruthy();
    expect(container.querySelector('.game-backgammon-stack[data-count="15"]')!.querySelectorAll('use')).toHaveLength(5);
  });

  test('la course est dite sous le tablier, pour soi et pour l\'autre ; un spectateur lit les noms des deux', () => {
    mount({ state: start([3, 1]), canAct: false });
    expect(screen.getByText('Course : toi 167 · Bastien 167')).toBeTruthy();
  });

  test('un spectateur lit les noms des deux joueurs dans la course', () => {
    mount({ state: start([3, 1]), mySeat: null, canAct: false });
    expect(screen.getByText('Course : Alice 167 · Bastien 167')).toBeTruthy();
  });
});

describe('ce que le dessin montre en plus des cases', () => {
  test('les numéros des points sont écrits le long des bords, dans la numérotation de celui qui regarde : 13 à 24 en haut, 12 à 1 en bas', () => {
    for (const mySeat of [0, 1] as const) {
      const { container, unmount } = mount({ mySeat, canAct: false });
      const numbers = [...container.querySelectorAll('.game-backgammon-number')].map((text) => Number(text.textContent));
      expect(numbers).toHaveLength(24);
      expect(numbers.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
      // Les numéros du haut sont ceux de la rangée du haut.
      const top = [...container.querySelectorAll('.game-backgammon-number')].filter((text) => Number(text.getAttribute('y')) < 12).map((text) => Number(text.textContent));
      expect(top.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => index + 13));
      unmount();
    }
  });

  test('chaque arrivée possible porte un point à la place du prochain pion ; sans pion choisi, aucun', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.game-backgammon-dot')).toHaveLength(0);
    click('Point 8 : 3 pions blancs, jouable');
    expect(container.querySelectorAll('.game-backgammon-dot')).toHaveLength(2);
    click('Point 8 : 3 pions blancs, sélectionné');
    expect(container.querySelectorAll('.game-backgammon-dot')).toHaveLength(0);
  });

  test('les pions jouables sont soulignés dans le dessin, le pion choisi est cerclé', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.game-backgammon-underline[data-kind="playable"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.game-backgammon-ring')).toHaveLength(0);
    click('Point 8 : 3 pions blancs, jouable');
    expect(container.querySelectorAll('.game-backgammon-ring')).toHaveLength(1);
  });
});

describe('à moi de jouer : construire le tour', () => {
  test('les pions que je peux prendre sont dits « jouable » ; ceux de l\'adversaire et les cases vides ne le sont pas', () => {
    mount();
    expect(button('Point 13 : 5 pions blancs, jouable')).toBeTruthy();
    expect(button('Point 24 : 2 pions blancs, jouable')).toBeTruthy();
    expect(button('Point 1 : 2 pions rouges')).toBeTruthy();
    expect(button('Point 2 : vide')).toBeTruthy();
  });

  test('prendre un pion éclaire ses arrivées : le point 8 avec le 3 et le 1 s\'éclaire en 5 et en 7', () => {
    mount();
    click('Point 8 : 3 pions blancs, jouable');
    expect(button('Point 8 : 3 pions blancs, sélectionné')).toBeTruthy();
    expect(button('Point 5 : vide, arrivée possible')).toBeTruthy();
    expect(button('Point 7 : vide, arrivée possible')).toBeTruthy();
    // Un point qui n'est pas une arrivée n'est pas éclairé.
    expect(button('Point 2 : vide')).toBeTruthy();
  });

  test('poser le pion sur une arrivée en fait l\'étape en aperçu : le pion bouge, la course baisse, les étapes s\'écrivent sous le plateau', () => {
    const { props } = mount();
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 5 : vide, arrivée possible');
    expect(button(/^Point 8 : 2 pions blancs/)).toBeTruthy();
    expect(button(/^Point 5 : 1 pion blanc/)).toBeTruthy();
    expect(screen.getByText('Ton tour : 8→5')).toBeTruthy();
    expect(screen.getByText('Course : toi 164 · Bastien 167')).toBeTruthy();
    // Rien n'est envoyé tant que le tour n'est pas validé.
    expect(props.onMove).not.toHaveBeenCalled();
  });

  test('un tour complet : « Valider » envoie le `play` entier, en un seul coup, avec toutes les étapes', () => {
    const { props } = mount();
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 5 : vide, arrivée possible');
    expect((button('Valider') as HTMLButtonElement).disabled).toBe(true);
    click(/^Point 6 : 5 pions blancs, jouable/);
    click(/^Point 5 : 1 pion blanc, (jouable, )?arrivée possible/);
    expect(screen.getByText('Ton tour : 8→5, 6→5')).toBeTruthy();
    expect((button('Valider') as HTMLButtonElement).disabled).toBe(false);
    click('Valider');
    expect(props.onMove).toHaveBeenCalledTimes(1);
    expect(props.onMove).toHaveBeenCalledWith({
      type: 'play',
      steps: [
        { from: 8, to: 5, die: 3 },
        { from: 6, to: 5, die: 1 },
      ],
    });
  });

  test('un tour incomplet ne s\'envoie pas : « Valider » est inactif, et un clic dessus ne fait rien', () => {
    const { props } = mount();
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 5 : vide, arrivée possible');
    const confirm = button('Valider') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(props.onMove).not.toHaveBeenCalled();
  });

  test('un double clic sur « Valider » n\'envoie le tour qu\'une fois', () => {
    const { props } = mount();
    for (const name of [/^Point 13 : 5 pions blancs, jouable/, /^Point 10 : vide, arrivée possible/, /^Point 6 : 5 pions blancs, jouable/, /^Point 5 : vide, arrivée possible/]) click(name);
    click('Valider');
    click('Valider');
    expect(props.onMove).toHaveBeenCalledTimes(1);
  });

  test('« Annuler » défait la dernière étape (et seulement elle) ; inactif sans étape', () => {
    mount();
    expect((button('Annuler') as HTMLButtonElement).disabled).toBe(true);
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 5 : vide, arrivée possible');
    click(/^Point 6 : 5 pions blancs, jouable/);
    click(/^Point 5 : 1 pion blanc, (jouable, )?arrivée possible/);
    expect(screen.getByText('Ton tour : 8→5, 6→5')).toBeTruthy();
    click('Annuler');
    expect(screen.getByText('Ton tour : 8→5')).toBeTruthy();
    expect(button(/^Point 6 : 5 pions blancs/)).toBeTruthy();
    click('Annuler');
    expect(screen.queryByText(/^Ton tour/)).toBeNull();
    expect(button('Point 8 : 3 pions blancs, jouable')).toBeTruthy();
    expect((button('Annuler') as HTMLButtonElement).disabled).toBe(true);
  });

  test('cliquer ailleurs qu\'une arrivée renonce au pion pris ; cliquer deux fois le même pion aussi', () => {
    mount();
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 2 : vide');
    expect(button('Point 8 : 3 pions blancs, jouable')).toBeTruthy();
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 8 : 3 pions blancs, sélectionné');
    expect(button('Point 8 : 3 pions blancs, jouable')).toBeTruthy();
  });

  test('prendre un autre pion change le choix', () => {
    mount();
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 13 : 5 pions blancs, jouable');
    expect(button('Point 13 : 5 pions blancs, sélectionné')).toBeTruthy();
    expect(button('Point 8 : 3 pions blancs, jouable')).toBeTruthy();
    expect(button('Point 10 : vide, arrivée possible')).toBeTruthy();
  });

  test('un doublé se joue en quatre étapes : « Valider » n\'est actif qu\'à la quatrième, et le premier dé s\'estompe après la deuxième', () => {
    const { container, props } = mount({ state: start([6, 6]) });
    const play = (from: RegExp, to: RegExp) => {
      click(from);
      click(to);
    };
    play(/^Point 24 : 2 pions blancs, jouable/, /^Point 18 : vide, arrivée possible/);
    expect(dice(container)!.getAttribute('data-used')).toBe('0,0');
    play(/^Point 24 : 1 pion blanc, jouable/, /^Point 18 : 1 pion blanc, (jouable, )?arrivée possible/);
    expect(dice(container)!.getAttribute('data-used')).toBe('1,0');
    play(/^Point 13 : 5 pions blancs, jouable/, /^Point 7 : vide, arrivée possible/);
    expect((button('Valider') as HTMLButtonElement).disabled).toBe(true);
    play(/^Point 13 : 4 pions blancs, jouable/, /^Point 7 : 1 pion blanc, (jouable, )?arrivée possible/);
    expect(dice(container)!.getAttribute('data-used')).toBe('1,1');
    expect((button('Valider') as HTMLButtonElement).disabled).toBe(false);
    click('Valider');
    expect(props.onMove).toHaveBeenCalledWith({
      type: 'play',
      steps: [
        { from: 24, to: 18, die: 6 },
        { from: 24, to: 18, die: 6 },
        { from: 13, to: 7, die: 6 },
        { from: 13, to: 7, die: 6 },
      ],
    });
  });

  test('quand un seul dé peut se jouer, on le dit, et le tour est complet après une étape (le plus grand)', () => {
    const state = position({ white: { 9: 1 }, whiteOff: 14, red: { 24: 2, 6: 13 }, dice: [6, 2] });
    const { props } = mount({ state });
    expect(screen.getByText('Un seul dé peut être joué.')).toBeTruthy();
    // Seul le plus grand dé s'éclaire : 9→3.
    click('Point 9 : 1 pion blanc, jouable');
    expect(button('Point 3 : vide, arrivée possible')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Point 7 : vide, arrivée possible' })).toBeNull();
    click('Point 3 : vide, arrivée possible');
    click('Valider');
    expect(props.onMove).toHaveBeenCalledWith({ type: 'play', steps: [{ from: 9, to: 3, die: 6 }] });
  });

  test('un pion sur la barre est pris tout seul (c\'est le seul coup) : ses arrivées sont éclairées sans cliquer sur la barre', () => {
    const state = position({ white: { 6: 5, 8: 3, 13: 5, 24: 1 }, whiteBar: 1, red: { 6: 5, 8: 3, 13: 5, 24: 2 }, dice: [6, 1] });
    const { props } = mount({ state });
    expect(button('Barre : 1 pion blanc, sélectionnée')).toBeTruthy();
    expect(button(/^Point 24 : 1 pion blanc, arrivée possible/)).toBeTruthy();
    // Les autres pions ne sont pas jouables tant que la barre n'est pas vide.
    expect(button('Point 13 : 5 pions blancs')).toBeTruthy();
    click(/^Point 24 : 1 pion blanc, arrivée possible/);
    click(/^Point 13 : 5 pions blancs, jouable/);
    click(/^Point 7 : vide, arrivée possible/);
    click('Valider');
    expect(props.onMove).toHaveBeenCalledWith({
      type: 'play',
      steps: [
        { from: 'bar', to: 24, die: 1 },
        { from: 13, to: 7, die: 6 },
      ],
    });
  });

  test('la sortie (disposition large) : la zone de sortie s\'éclaire quand le pion choisi peut sortir, et un clic dessus le sort', () => {
    const state = position({ white: { 3: 1, 2: 1 }, whiteOff: 13, red: { 6: 15 }, dice: [6, 5] });
    const { props } = mount({ state });
    click('Point 3 : 1 pion blanc, jouable');
    expect(button('Sortie : 13 pions sortis, arrivée possible')).toBeTruthy();
    expect(queryButton('Sortir')).toBeNull();
    click('Sortie : 13 pions sortis, arrivée possible');
    expect(screen.getByText('Ton tour : 3→sortie')).toBeTruthy();
    click(/^Point 2 : 1 pion blanc, jouable/);
    click(/^Sortie : 14 pions sortis, arrivée possible/);
    click('Valider');
    expect(props.onMove).toHaveBeenCalledWith({
      type: 'play',
      steps: [
        { from: 3, to: 'off', die: 5 },
        { from: 2, to: 'off', die: 6 },
      ],
    });
  });
});

describe('ni à moi de jouer, ni aperçu : rien ne se joue', () => {
  test('`canAct` faux : aucun pion jouable, toutes les cases sont inertes, ni lancer ni validation, et un clic ne fait rien', () => {
    const { props } = mount({ canAct: false });
    expect(screen.queryByRole('button', { name: /jouable/ })).toBeNull();
    for (const element of pointButtons()) expect(element.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button('Point 8 : 3 pions blancs'));
    expect(screen.queryByRole('button', { name: /sélectionné/ })).toBeNull();
    expect((button('Valider') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Annuler') as HTMLButtonElement).disabled).toBe(true);
    expect(props.onMove).not.toHaveBeenCalled();
  });

  test('au tour de l\'adversaire : le plateau est inerte, et il n\'y a ni boutons de tour ni lancer', () => {
    mount({ state: start([4, 2], 1), canAct: false });
    expect(screen.queryByRole('button', { name: /jouable/ })).toBeNull();
    expect(queryButton('Valider')).toBeNull();
    expect(queryButton('Annuler')).toBeNull();
    expect(queryButton('Lancer les dés')).toBeNull();
  });

  test('l\'aperçu d\'avant la première partie : le départ, rien d\'éclairé ni de cliquable, pas de dés, pas de course', () => {
    const { container, props } = mount({ state: start([5, 2]), mySeat: null, canAct: false, preview: true });
    expect(pointButtons()).toHaveLength(24);
    for (const element of pointButtons()) expect(element.getAttribute('aria-disabled')).toBe('true');
    expect(dice(container)).toBeNull();
    expect(screen.queryByText(/^Course/)).toBeNull();
    expect(queryButton('Lancer les dés')).toBeNull();
    fireEvent.click(button('Point 13 : 5 pions blancs'));
    expect(props.onMove).not.toHaveBeenCalled();
  });

  test('une partie finie : le plateau garde la dernière position, inerte, sans dés', () => {
    const over = backgammon.forfeit(start([3, 1]), 1, 'resign').state;
    const { container } = mount({ state: over, canAct: false });
    expect(screen.queryByRole('button', { name: /jouable/ })).toBeNull();
    expect(dice(container)).toBeNull();
    expect(button('Point 24 : 2 pions blancs')).toBeTruthy();
    expect(queryButton('Valider')).toBeNull();
  });

  test('en attente de la réponse du serveur (`canAct` faux après « Valider ») : le plateau garde le tour posé, et rien ne s\'envoie de plus', () => {
    const { props, rerender } = mount();
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 5 : vide, arrivée possible');
    click(/^Point 6 : 5 pions blancs, jouable/);
    click(/^Point 5 : 1 pion blanc, (jouable, )?arrivée possible/);
    click('Valider');
    expect(props.onMove).toHaveBeenCalledTimes(1);
    rerender(<Board {...props} canAct={false} />);
    // Le tour posé reste affiché, les boutons sont inactifs.
    expect(screen.getByText('Ton tour : 8→5, 6→5')).toBeTruthy();
    expect((button('Valider') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /jouable/ })).toBeNull();
    fireEvent.click(button('Valider'));
    expect(props.onMove).toHaveBeenCalledTimes(1);
  });

  test('le serveur répond (nouvel état) : les étapes posées sont oubliées, le tour de l\'autre commence', () => {
    const { props, rerender } = mount();
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 5 : vide, arrivée possible');
    const played = backgammon.apply(start([3, 1]), 0, { type: 'play', steps: [{ from: 8, to: 5, die: 3 }, { from: 6, to: 5, die: 1 }] }, () => 0.5);
    if (!played.ok) throw new Error(played.error);
    rerender(<Board {...props} state={played.state} canAct={false} />);
    expect(screen.queryByText(/^Ton tour/)).toBeNull();
    expect(button('Point 5 : 2 pions blancs')).toBeTruthy();
  });
});

describe('lancer les dés', () => {
  test('en phase `roll`, à mon tour : « Lancer les dés » envoie `roll`, une seule fois ; le bouton disparaît une fois le coup parti (un second clic ne touche pas le tablier dessous)', () => {
    const { props } = mount({ state: start() });
    const roll = button('Lancer les dés');
    fireEvent.click(roll);
    fireEvent.click(roll);
    expect(props.onMove).toHaveBeenCalledTimes(1);
    expect(props.onMove).toHaveBeenCalledWith({ type: 'roll' });
    expect(queryButton('Lancer les dés')).toBeNull();
  });

  test('le serveur refuse le lancer (la main revient sans nouvel état) : le bouton revient, on peut relancer', () => {
    const { props, rerender } = mount({ state: start() });
    click('Lancer les dés');
    rerender(<Board {...props} canAct={false} />);
    expect(queryButton('Lancer les dés')).toBeNull();
    rerender(<Board {...props} canAct />);
    click('Lancer les dés');
    expect(props.onMove).toHaveBeenCalledTimes(2);
  });

  test('pas de bouton quand ce n\'est pas à moi, quand je ne peux pas agir, en phase `move`, en spectateur ou en aperçu', () => {
    mount({ state: start(), canAct: false });
    expect(queryButton('Lancer les dés')).toBeNull();
  });

  test('en phase `move`, le bouton n\'est pas là', () => {
    mount({ state: start([3, 1]) });
    expect(queryButton('Lancer les dés')).toBeNull();
  });

  test('au tour de l\'autre (phase `roll`) : pas de bouton', () => {
    mount({ state: start(undefined, 1) });
    expect(queryButton('Lancer les dés')).toBeNull();
  });

  test('un spectateur ou l\'aperçu : pas de bouton', () => {
    mount({ state: start(), mySeat: null });
    expect(queryButton('Lancer les dés')).toBeNull();
  });
});

describe('les dés', () => {
  test('mouvement réduit : les valeurs du serveur tout de suite, sans rouler (le lancer, comme l\'ouverture)', () => {
    const state = start([5, 2]);
    const { container } = mount({ state, events: [{ type: 'dice', seat: 0, values: [5, 2] }], reducedMotion: true });
    const group = dice(container)!;
    expect(group.getAttribute('data-rolling')).toBe('false');
    expect(group.getAttribute('data-values')).toBe('5,2');
    expect([...group.querySelectorAll('.game-backgammon-die')].map((die) => die.getAttribute('data-value'))).toEqual(['5', '2']);
  });

  test('mouvement réduit, ouverture : les dés aussi sont posés tout de suite', () => {
    const { container } = mount({ state: start([5, 2]), events: [{ type: 'opening', rolls: [[5, 2]], first: 0 }], reducedMotion: true });
    expect(dice(container)!.getAttribute('data-rolling')).toBe('false');
  });

  test('sans mouvement réduit : les dés roulent environ 600 ms (des faces au hasard), puis se posent sur les valeurs du serveur', () => {
    vi.useFakeTimers();
    const state = start([5, 2]);
    const { container } = mount({ state, events: [{ type: 'dice', seat: 0, values: [5, 2] }], reducedMotion: false });
    expect(dice(container)!.getAttribute('data-rolling')).toBe('true');
    act(() => vi.advanceTimersByTime(300));
    expect(dice(container)!.getAttribute('data-rolling')).toBe('true');
    // Pendant qu'ils roulent, ce sont des faces (de 1 à 6) : le serveur n'a pas encore été montré.
    for (const die of container.querySelectorAll('.game-backgammon-die')) expect(Number(die.getAttribute('data-value'))).toBeGreaterThanOrEqual(1);
    act(() => vi.advanceTimersByTime(300));
    const group = dice(container)!;
    expect(group.getAttribute('data-rolling')).toBe('false');
    expect([...group.querySelectorAll('.game-backgammon-die')].map((die) => die.getAttribute('data-value'))).toEqual(['5', '2']);
  });

  test('l\'ouverture roule aussi', () => {
    vi.useFakeTimers();
    const { container } = mount({ state: start([5, 2]), events: [{ type: 'opening', rolls: [[5, 2]], first: 0 }], reducedMotion: false });
    expect(dice(container)!.getAttribute('data-rolling')).toBe('true');
    act(() => vi.advanceTimersByTime(600));
    expect(dice(container)!.getAttribute('data-rolling')).toBe('false');
  });

  test('un saut d\'état (aucun événement) : jamais de roulement, les dés sont posés', () => {
    const { container } = mount({ state: start([5, 2]), events: [], reducedMotion: false });
    expect(dice(container)!.getAttribute('data-rolling')).toBe('false');
  });

  test('un doublé montre « ×2 » une fois posé ; deux dés différents, non', () => {
    const { container, rerender, props } = mount({ state: start([6, 6]) });
    expect(container.querySelector('.game-backgammon-times')!.textContent).toBe('×2');
    rerender(<Board {...props} state={start([6, 5])} />);
    expect(container.querySelector('.game-backgammon-times')).toBeNull();
  });

  test('les dés sont dans la moitié de qui joue : à droite pour celui qui regarde, à gauche pour l\'autre', () => {
    const mine = mount({ state: start([4, 3]) });
    expect(dice(mine.container)!.getAttribute('data-side')).toBe('mine');
    mine.unmount();
    const theirs = mount({ state: start([4, 3], 1), canAct: false });
    expect(dice(theirs.container)!.getAttribute('data-side')).toBe('theirs');
  });

  test('un dé joué s\'estompe : après une étape avec le 3, le dé de 3', () => {
    const { container } = mount();
    click('Point 8 : 3 pions blancs, jouable');
    click('Point 5 : vide, arrivée possible');
    expect(dice(container)!.getAttribute('data-used')).toBe('1,0');
  });

  test('les valeurs des dés sont lisibles au lecteur d\'écran, une fois posés', () => {
    mount({ state: start([5, 2]) });
    expect(screen.getByText('Dés : 5 et 2')).toBeTruthy();
  });
});

describe('le tour de l\'adversaire, rejoué pas à pas', () => {
  // Les Rouges jouent 8→4 (dé 4) et 6→4 (dé 2) : leur point 4 est le point 21 des Blancs, leur point 8 le 17, leur point 6 le 19.
  function redPlay() {
    const before = position({ white: STARTING_LAYOUT, red: STARTING_LAYOUT, turn: 1, dice: [4, 2] });
    const result = backgammon.apply(before, 1, { type: 'play', steps: [{ from: 8, to: 4, die: 4 }, { from: 6, to: 4, die: 2 }] }, () => 0.5);
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  test('mouvement réduit : la position finale tout de suite', () => {
    const { state, events } = redPlay();
    mount({ state, events, canAct: true, reducedMotion: true });
    expect(button('Point 17 : 2 pions rouges')).toBeTruthy();
    expect(button('Point 21 : 2 pions rouges, dernier coup')).toBeTruthy();
  });

  test('sans mouvement réduit : la position d\'avant, puis un pion toutes les 200 ms, jusqu\'à la position finale ; les pions déplacés sont soulignés ensuite', () => {
    vi.useFakeTimers();
    const { state, events } = redPlay();
    mount({ state, events, reducedMotion: false });
    // D'abord la position d'avant le tour : rien n'a bougé.
    expect(button('Point 17 : 3 pions rouges')).toBeTruthy();
    expect(button('Point 21 : vide')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(button('Point 17 : 2 pions rouges')).toBeTruthy();
    expect(button('Point 21 : 1 pion rouge')).toBeTruthy();
    expect(button('Point 19 : 5 pions rouges')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(button('Point 19 : 4 pions rouges')).toBeTruthy();
    expect(button('Point 21 : 2 pions rouges, dernier coup')).toBeTruthy();
  });

  test('un nouveau lot d\'événements (le lancer suivant) coupe le rejeu : la position finale tout de suite', () => {
    vi.useFakeTimers();
    const { state, events } = redPlay();
    const { props, rerender } = mount({ state, events, reducedMotion: false });
    expect(button('Point 21 : vide')).toBeTruthy();
    rerender(<Board {...props} state={{ ...state, phase: 'move', dice: [5, 3] }} events={[{ type: 'dice', seat: 0, values: [5, 3] }]} />);
    expect(button('Point 21 : 2 pions rouges, dernier coup')).toBeTruthy();
  });

  test('mes propres étapes ne sont pas rejouées : je les ai déjà posées en aperçu', () => {
    vi.useFakeTimers();
    const before = start([3, 1]);
    const played = backgammon.apply(before, 0, { type: 'play', steps: [{ from: 8, to: 5, die: 3 }, { from: 6, to: 5, die: 1 }] }, () => 0.5);
    if (!played.ok) throw new Error(played.error);
    mount({ state: played.state, events: played.events, canAct: false, reducedMotion: false });
    expect(button('Point 5 : 2 pions blancs')).toBeTruthy();
  });

  test('un spectateur voit les tours des deux joueurs rejoués', () => {
    vi.useFakeTimers();
    const before = start([3, 1]);
    const played = backgammon.apply(before, 0, { type: 'play', steps: [{ from: 8, to: 5, die: 3 }, { from: 6, to: 5, die: 1 }] }, () => 0.5);
    if (!played.ok) throw new Error(played.error);
    mount({ state: played.state, events: played.events, mySeat: null, canAct: false, reducedMotion: false });
    expect(button('Point 5 : vide')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(button(/^Point 5 : 1 pion blanc/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(button(/^Point 5 : 2 pions blancs/)).toBeTruthy();
  });

  test('les pions que l\'adversaire a déplacés restent soulignés pendant mon tour, jusqu\'à ce qu\'il joue de nouveau', () => {
    const { state, events } = redPlay();
    const { props, rerender } = mount({ state, events, reducedMotion: true });
    expect(button('Point 21 : 2 pions rouges, dernier coup')).toBeTruthy();
    // Je lance : le soulignement reste.
    rerender(<Board {...props} state={{ ...state, phase: 'move', dice: [5, 3] }} events={[{ type: 'dice', seat: 0, values: [5, 3] }]} />);
    expect(button('Point 21 : 2 pions rouges, dernier coup')).toBeTruthy();
    // Je joue (mon dernier tour remplace `last` dans l'état) : toujours là.
    const mine = backgammon.apply({ ...state, phase: 'move', dice: [5, 3] }, 0, { type: 'play', steps: [{ from: 13, to: 8, die: 5 }, { from: 13, to: 10, die: 3 }] }, () => 0.5);
    if (!mine.ok) throw new Error(mine.error);
    rerender(<Board {...props} state={mine.state} canAct={false} events={mine.events} />);
    expect(button(/^Point 21 : 2 pions rouges, dernier coup/)).toBeTruthy();
  });
});

describe('un tour perdu', () => {
  test('mon tour passé : « Aucun coup possible » s\'affiche un instant (1,5 s), avec les dés lancés', () => {
    vi.useFakeTimers();
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 17: 2, 15: 2, 6: 11 }, turn: 1 });
    const { container } = mount({ state, events: [{ type: 'dice', seat: 0, values: [5, 3] }, { type: 'pass', seat: 0 }], canAct: false, reducedMotion: true });
    expect(screen.getByText('Aucun coup possible')).toBeTruthy();
    expect(dice(container)!.getAttribute('data-values')).toBe('5,3');
    act(() => vi.advanceTimersByTime(1400));
    expect(screen.queryByText('Aucun coup possible')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('Aucun coup possible')).toBeNull();
    expect(dice(container)).toBeNull();
  });

  test('le tour passé de l\'adversaire : « Bastien ne peut pas jouer »', () => {
    vi.useFakeTimers();
    const state = position({ white: { 13: 1 }, whiteOff: 14, red: { 17: 2, 15: 2, 6: 11 }, turn: 0 });
    mount({ state, events: [{ type: 'dice', seat: 1, values: [5, 3] }, { type: 'pass', seat: 1 }], canAct: true, reducedMotion: true });
    expect(screen.getByText('Bastien ne peut pas jouer')).toBeTruthy();
    expect(screen.queryByText('Aucun coup possible')).toBeNull();
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByText('Bastien ne peut pas jouer')).toBeNull();
  });

  test('l\'avis n\'est pas une région `aria-live` : c\'est `announce` qui parle', () => {
    const state = start(undefined, 0);
    mount({ state, events: [{ type: 'dice', seat: 0, values: [6, 6] }, { type: 'pass', seat: 0 }], canAct: false });
    expect(document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
  });
});

describe('le clavier : le motif « grille » (§ 9.5.3)', () => {
  const focused = () => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? '';
  // Un écouteur sur la fenêtre, comme celui de l'avatar : il ne doit rien voir des touches que le plateau prend.
  function windowKeys() {
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    return { seen, stop: () => window.removeEventListener('keydown', seen) };
  }

  test('une seule case est dans l\'ordre de tabulation (tabindex mobile), et c\'est la case qui a le focus qui la porte', () => {
    mount();
    const stops = screen.getAllByRole('button').filter((element) => element.getAttribute('tabindex') === '0' && element.closest('[role="grid"]'));
    expect(stops).toHaveLength(1);
    // Une case qu'on a prise au clavier devient l'arrêt.
    const target = button('Point 13 : 5 pions blancs, jouable');
    act(() => target.focus());
    expect(target.getAttribute('tabindex')).toBe('0');
    expect(screen.getAllByRole('button').filter((element) => element.getAttribute('tabindex') === '0' && element.closest('[role="grid"]'))).toHaveLength(1);
  });

  test('les flèches déplacent le focus d\'une case à sa voisine à l\'écran, et ne passent jamais à l\'avatar (preventDefault et stopPropagation)', () => {
    mount();
    const keys = windowKeys();
    act(() => button('Point 13 : 5 pions blancs, jouable').focus());
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })).toBe(false);
    expect(focused()).toBe('Point 14 : vide');
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })).toBe(false);
    expect(focused()).toBe('Point 13 : 5 pions blancs, jouable');
    expect(keys.seen).not.toHaveBeenCalled();
    keys.stop();
  });

  test('haut et bas passent d\'une rangée à l\'autre, à la même colonne à l\'écran', () => {
    mount();
    act(() => button('Point 13 : 5 pions blancs, jouable').focus());
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })).toBe(false);
    expect(focused()).toBe('Point 12 : 5 pions rouges');
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })).toBe(false);
    expect(focused()).toBe('Point 13 : 5 pions blancs, jouable');
  });

  test('Début et Fin vont aux bouts de la rangée ; aux bords, les flèches ne bouclent pas', () => {
    mount();
    act(() => button('Point 15 : vide').focus());
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Home' })).toBe(false);
    expect(focused()).toBe('Point 13 : 5 pions blancs, jouable');
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })).toBe(false);
    expect(focused()).toBe('Point 13 : 5 pions blancs, jouable');
    expect(fireEvent.keyDown(document.activeElement!, { key: 'End' })).toBe(false);
    expect(focused()).toBe('Point 24 : 2 pions blancs, jouable');
  });

  test('dans la rangée du bas, la barre est entre les deux moitiés, et la sortie au bout', () => {
    mount();
    act(() => button('Point 7 : vide').focus());
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(focused()).toBe('Barre : vide');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(focused()).toBe('Point 6 : 5 pions blancs, jouable');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(focused()).toBe('Sortie : aucun pion sorti');
  });

  test('Entrée prend un pion puis le pose ; Espace aussi ; chacune est prise par le plateau', () => {
    const { props } = mount();
    const keys = windowKeys();
    act(() => button('Point 8 : 3 pions blancs, jouable').focus());
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Enter' })).toBe(false);
    expect(button('Point 8 : 3 pions blancs, sélectionné')).toBeTruthy();
    act(() => button('Point 5 : vide, arrivée possible').focus());
    expect(fireEvent.keyDown(document.activeElement!, { key: ' ' })).toBe(false);
    expect(screen.getByText('Ton tour : 8→5')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sélectionné/ })).toBeNull();
    expect(props.onMove).not.toHaveBeenCalled();
    expect(keys.seen).not.toHaveBeenCalled();
    keys.stop();
  });

  test('Entrée au clavier d\'un vrai utilisateur : un seul geste, pas deux (la touche n\'est pas suivie d\'un clic)', async () => {
    const user = userEvent.setup();
    mount();
    act(() => button('Point 8 : 3 pions blancs, jouable').focus());
    await user.keyboard('{Enter}');
    expect(button('Point 8 : 3 pions blancs, sélectionné')).toBeTruthy();
    act(() => button('Point 5 : vide, arrivée possible').focus());
    await user.keyboard(' ');
    expect(screen.getByText('Ton tour : 8→5')).toBeTruthy();
    // Si l'Espace avait aussi fait un clic, le pion posé aurait été repris : aucun pion n'est choisi.
    expect(screen.queryByRole('button', { name: /sélectionné/ })).toBeNull();
  });

  test('Échap annule le choix du pion, et la touche est prise (le panneau ne se ferme pas) ; sans choix, elle passe (le panneau la prend)', () => {
    mount();
    const keys = windowKeys();
    act(() => button('Point 8 : 3 pions blancs, jouable').focus());
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(button('Point 8 : 3 pions blancs, sélectionné')).toBeTruthy();
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Escape' })).toBe(false);
    expect(button('Point 8 : 3 pions blancs, jouable')).toBeTruthy();
    expect(keys.seen).not.toHaveBeenCalled();
    // Rien à annuler : Échap n'est pas pris, il arrive jusqu'à la fenêtre (et au panneau, qui se ferme).
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Escape' })).toBe(true);
    expect(keys.seen).toHaveBeenCalledTimes(1);
    keys.stop();
  });

  test('une touche que le plateau n\'utilise pas passe : la lettre E, le zoom, les lettres de l\'avatar', () => {
    mount();
    const keys = windowKeys();
    act(() => button('Point 13 : 5 pions blancs, jouable').focus());
    for (const key of ['e', 'z', '+', '-', 'Shift']) expect(fireEvent.keyDown(document.activeElement!, { key })).toBe(true);
    expect(keys.seen).toHaveBeenCalledTimes(5);
    keys.stop();
  });

  test('sur un plateau inerte, les flèches se déplacent quand même (on lit le plateau case par case), et Entrée ne joue rien', () => {
    const { props } = mount({ canAct: false });
    act(() => button('Point 13 : 5 pions blancs').focus());
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })).toBe(false);
    expect(focused()).toBe('Point 14 : vide');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(screen.queryByRole('button', { name: /sélectionné/ })).toBeNull();
    expect(props.onMove).not.toHaveBeenCalled();
  });
});

describe('les cibles, les sons et l\'accessibilité', () => {
  test('chaque bouton du plateau est muet (`data-sfx="none"`) : sans cela, chaque sélection ferait « clic »', () => {
    mount();
    for (const element of screen.getAllByRole('button')) expect(element.getAttribute('data-sfx'), element.getAttribute('aria-label') ?? element.textContent ?? '').toBe('none');
  });

  test('le dessin est caché aux lecteurs d\'écran : les cases le disent déjà', () => {
    const { container } = mount();
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  test('la grille a un nom, deux rangées, et chaque case est dans une cellule', () => {
    mount();
    const grid = screen.getByRole('grid', { name: 'Tablier de backgammon' });
    expect(within(grid).getAllByRole('row')).toHaveLength(2);
    expect(within(grid).getAllByRole('gridcell').length).toBe(26);
  });

  test('aucune région d\'annonce de plus : la plateforme n\'en a qu\'une', () => {
    mount({ state: start([3, 1]), events: [{ type: 'dice', seat: 0, values: [3, 1] }] });
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  test('disposition large (408 px) : chaque case fait 24 × 24 px au moins', () => {
    mount();
    for (const cell of screen.getAllByRole('gridcell')) {
      expect(parseFloat(cell.style.width), cell.firstElementChild!.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(24);
      expect(parseFloat(cell.style.height)).toBeGreaterThanOrEqual(24);
      expect(cell.style.pointerEvents).not.toBe('none');
    }
  });

  test('disposition serrée (311 px) : les flèches font 24 px, la barre de 12 px ne se clique pas mais reste au clavier', () => {
    cleanupObserver();
    fakeResizeObserver(311);
    mount();
    for (const cell of screen.getAllByRole('gridcell')) {
      const name = cell.firstElementChild!.getAttribute('aria-label') ?? '';
      if (name.startsWith('Barre')) {
        expect(parseFloat(cell.style.width)).toBe(12);
        expect(cell.style.pointerEvents).toBe('none');
        expect((cell.firstElementChild as HTMLElement).tabIndex).toBeGreaterThanOrEqual(-1);
      } else {
        expect(parseFloat(cell.style.width), name).toBeGreaterThanOrEqual(24);
        expect(parseFloat(cell.style.height), name).toBeGreaterThanOrEqual(24);
        expect(cell.style.pointerEvents, name).not.toBe('none');
      }
    }
  });

  test('les boutons de tour font 24 px au moins de haut (leur classe donne 36 px)', () => {
    mount();
    for (const name of ['Annuler', 'Valider']) expect(button(name).className).toContain('bar-button');
  });
});

describe('la largeur du conteneur (§ 9.5.1)', () => {
  test('le plateau observe son conteneur, et cesse de l\'observer quand il disparaît', () => {
    cleanupObserver();
    const observer = fakeResizeObserver(408);
    const { container, unmount } = mount();
    expect(observer.observed()).toEqual([container.querySelector('.game-backgammon')]);
    unmount();
    expect(observer.observed()).toEqual([]);
  });

  test('408 px : la disposition large, avec sa zone de sortie et sans bouton « Sortir » ; 311 px : la serrée, avec « Sortir » et les pions sortis dits sous le tablier', () => {
    cleanupObserver();
    const observer = fakeResizeObserver(408);
    const { container } = mount();
    expect(container.querySelector('.game-backgammon')!.getAttribute('data-layout')).toBe('wide');
    expect(queryButton(/^Sortie :/)).toBeTruthy();
    expect(queryButton('Sortir')).toBeNull();
    observer.resize(311);
    expect(container.querySelector('.game-backgammon')!.getAttribute('data-layout')).toBe('compact');
    expect(queryButton(/^Sortie :/)).toBeNull();
    expect(queryButton('Sortir')).toBeTruthy();
    expect(screen.getByText('Sortis : toi 0 · Bastien 0')).toBeTruthy();
  });

  test('serré, le bouton « Sortir » est inactif tant qu\'aucun pion choisi ne peut sortir, puis sort le pion', () => {
    cleanupObserver();
    fakeResizeObserver(311);
    const state = position({ white: { 3: 1, 2: 1 }, whiteOff: 13, red: { 6: 15 }, dice: [6, 5] });
    const { props } = mount({ state });
    expect((button('Sortir') as HTMLButtonElement).disabled).toBe(true);
    click('Point 3 : 1 pion blanc, jouable');
    expect((button('Sortir') as HTMLButtonElement).disabled).toBe(false);
    click('Sortir');
    expect(screen.getByText('Ton tour : 3→sortie')).toBeTruthy();
    click(/^Point 2 : 1 pion blanc, jouable/);
    click('Sortir');
    click('Valider');
    expect(props.onMove).toHaveBeenCalledWith({ type: 'play', steps: [{ from: 3, to: 'off', die: 5 }, { from: 2, to: 'off', die: 6 }] });
  });

  test('un conteneur plus étroit que le tablier serré (hors téléphones courants) : le tablier est réduit d\'un bloc pour tenir, jamais de défilement horizontal', () => {
    cleanupObserver();
    fakeResizeObserver(260);
    const { container } = mount();
    const fit = container.querySelector<HTMLElement>('.game-backgammon-fit')!;
    const stage = container.querySelector<HTMLElement>('.game-backgammon-stage')!;
    expect(parseFloat(fit.style.width)).toBeLessThanOrEqual(260);
    expect(stage.style.transform).toMatch(/^scale\(0\.\d+\)$/);
    // À sa largeur, ou plus large, pas de réduction.
    cleanupObserver();
    fakeResizeObserver(311);
    const normal = mount();
    expect(normal.container.querySelector<HTMLElement>('.game-backgammon-stage')!.style.transform).toBe('');
  });

  test('sans ResizeObserver (un navigateur ancien), le plateau se dessine quand même, en disposition large', () => {
    cleanupObserver();
    vi.stubGlobal('ResizeObserver', undefined);
    const { container } = mount();
    expect(container.querySelector('.game-backgammon')!.getAttribute('data-layout')).toBe('wide');
  });
});

// Remplace le faux ResizeObserver du `beforeEach` par un autre (les tests de largeur en règlent un à eux).
function cleanupObserver() {
  vi.unstubAllGlobals();
}
