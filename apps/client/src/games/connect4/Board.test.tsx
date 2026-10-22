import { playColumns, type Connect4Event, type Connect4Move, type Connect4State } from '@bureau/shared/games/connect4';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { audioEngine } from '../../audio/audio';
import type { GameBoardProps } from '../types';
import { Board } from './Board';
import { TOKEN_PALETTES } from './sprites';

// Le plateau du Puissance 4, point par point de ce que tout plateau respecte (§ 9.5 du document des jeux) : sa taille se mesure sur son conteneur, ses cibles font 24 px au moins,
// son clavier prend ses touches et laisse passer les autres, chaque colonne dit son contenu, le mouvement réduit pose le jeton tout de suite, un spectateur ne peut rien, et aucun
// son ne vient de lui. Puis ce qui est propre au jeu : le fantôme, la chute, le dernier jeton, la ligne gagnante.

vi.mock('../../audio/audio', () => ({ audioEngine: { playSfx: vi.fn() } }));

type Props = GameBoardProps<Connect4State, Connect4Move, Connect4Event>;
const PLAYERS: Props['players'] = [
  { userId: 'alice', name: 'Alice', avatarKey: null, connected: true },
  { userId: 'bastien', name: 'Bastien', avatarKey: null, connected: true },
];

const drop = (seat: 0 | 1, col: number, row: number): Connect4Event => ({ type: 'drop', seat, col, row });
const columnsOf = (text: string): number[] => text.split(' ').map(Number);
const C4 = columnsOf('3 4 3 4 3 4 3');
const C9 = columnsOf('3 0 2 0 5 0 6 2 0 4 6 1 0 2 6 0 4 1 3 5 4 3 5 2 1 5 6');
const C10 = columnsOf('0 2 2 2 2 2 2 0 0 0 0 0 1 3 3 3 3 3 3 1 1 1 1 1 4 6 6 6 6 6 6 4 4 4 4 4 5 5 5 5 5 5');

// Le plateau monté, avec ce que la plateforme lui donne ; `rerender` change quelques propriétés.
function setup(over: Partial<Props> = {}) {
  const onMove = vi.fn();
  const props: Props = { state: playColumns(0, []), mySeat: 0, players: PLAYERS, events: [], canAct: true, onMove, reducedMotion: false, preview: false, ...over };
  const view = render(<Board {...props} />);
  return {
    ...view,
    onMove,
    rerender: (next: Partial<Props>) => view.rerender(<Board {...props} {...next} />),
    root: view.container.querySelector<HTMLElement>('.game-connect4')!,
  };
}

const columns = (): HTMLButtonElement[] => within(screen.getByRole('group', { name: 'Colonnes' })).getAllByRole('button') as HTMLButtonElement[];
const column = (n: number): HTMLButtonElement => screen.getByRole('button', { name: new RegExp(`^Colonne ${n} :`) }) as HTMLButtonElement;
const token = (root: HTMLElement, col: number, row: number) => root.querySelector<HTMLElement>(`.game-connect4-token[data-col="${col}"][data-row="${row}"]`);
const tokens = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.game-connect4-token')];

// Un conteneur dont on dicte la largeur (happy-dom ne fait pas de mise en page), et un ResizeObserver que le test déclenche.
function measuredAt(initial: number) {
  let width = initial;
  const observers: Array<{ callback: () => void; targets: Element[]; disconnected: boolean }> = [];
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly entry: { callback: () => void; targets: Element[]; disconnected: boolean };
      constructor(callback: () => void) {
        this.entry = { callback, targets: [], disconnected: false };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.push(target);
      }
      disconnect() {
        this.entry.disconnected = true;
      }
    },
  );
  return {
    observers,
    resize(next: number) {
      width = next;
      act(() => observers.filter((observer) => !observer.disconnected).forEach((observer) => observer.callback()));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(audioEngine.playSfx).mockClear();
});

describe('§ 9.5.1 · la taille : celle du conteneur, jamais celle de la fenêtre', () => {
  test('dans le panneau d\'un ordinateur (408 px), les cases font 58 px et les jetons ×4 ; avant toute mesure, c\'est ce qu\'on dessine', () => {
    const { root } = setup();
    expect(root.style.getPropertyValue('--game-connect4-cell')).toBe('58px');
    expect(root.querySelector('svg.game-connect4-slot')?.getAttribute('width')).toBe('52');
  });

  test('sur un téléphone de 375 px (311 px de contenu), les cases font 44 px et les jetons ×3 ; le jeton est centré par un décalage entier', () => {
    measuredAt(311);
    const { root } = setup({ state: playColumns(0, [3]) });
    expect(root.style.getPropertyValue('--game-connect4-cell')).toBe('44px');
    expect(root.style.getPropertyValue('--game-connect4-inset')).toBe('2px');
    for (const svg of root.querySelectorAll('svg')) expect(svg.getAttribute('width'), 'un jeton ou un trou').toBe('39');
  });

  test('le plateau suit son conteneur : on le redimensionne, les cases suivent, et jamais plus large que lui', () => {
    const measure = measuredAt(408);
    const { root } = setup();
    for (const [width, cell] of [[311, 44], [350, 50], [200, 28], [700, 58], [408, 58]] as const) {
      measure.resize(width);
      expect(root.style.getPropertyValue('--game-connect4-cell'), `conteneur de ${width} px`).toBe(`${cell}px`);
      expect(cell * 7, `conteneur de ${width} px`).toBeLessThanOrEqual(width);
    }
  });

  test('il observe son propre conteneur (le ResizeObserver), et arrête de l\'observer en partant', () => {
    const measure = measuredAt(408);
    const { root, unmount } = setup();
    expect(measure.observers).toHaveLength(1);
    expect(measure.observers[0]!.targets).toEqual([root]);
    unmount();
    expect(measure.observers[0]!.disconnected).toBe(true);
  });

  test('la fenêtre ne compte pas : une fenêtre étroite ou large ne change rien à un conteneur qui n\'a pas bougé', () => {
    measuredAt(408);
    for (const innerWidth of [320, 1_920]) {
      vi.stubGlobal('innerWidth', innerWidth);
      const { root, unmount } = setup();
      expect(root.style.getPropertyValue('--game-connect4-cell'), `fenêtre de ${innerWidth} px`).toBe('58px');
      unmount();
    }
  });

  test('sans ResizeObserver (un vieux navigateur), le plateau se dessine quand même, à la taille du conteneur au montage', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, top: 0, left: 0, right: 311, bottom: 0, width: 311, height: 0, toJSON: () => ({}) }));
    const { root } = setup();
    expect(root.style.getPropertyValue('--game-connect4-cell')).toBe('44px');
  });
});

describe('§ 9.5.2 · les cibles : 24 × 24 px au moins', () => {
  test('même dans un conteneur minuscule, une colonne fait 24 px de large au moins (et sept colonnes de haut, bien plus)', () => {
    const measure = measuredAt(120);
    const { root } = setup();
    expect(root.style.getPropertyValue('--game-connect4-cell')).toBe('24px');
    measure.resize(10);
    expect(root.style.getPropertyValue('--game-connect4-cell')).toBe('24px');
  });

  test('chaque colonne est un seul bouton entier (la cible est toute la colonne), et il n\'y a pas d\'autre cible dans le plateau', () => {
    const { root } = setup();
    expect(columns()).toHaveLength(7);
    expect(root.querySelectorAll('button, a, [role="button"], input, select, textarea')).toHaveLength(7);
    for (const button of columns()) expect(button.getAttribute('type')).toBe('button');
  });
});

describe('§ 9.5.3 · le clavier : une colonne dans l\'ordre de tabulation, des flèches, Début et Fin', () => {
  test('une seule colonne a tabindex 0 (la 4e, au milieu, au départ) ; Tab y entre, et un second Tab sort du plateau', async () => {
    setup();
    expect(columns().filter((button) => button.tabIndex === 0)).toEqual([column(4)]);
    expect(columns().filter((button) => button.tabIndex === -1)).toHaveLength(6);
    await userEvent.tab();
    expect(document.activeElement).toBe(column(4));
    await userEvent.tab();
    expect(columns()).not.toContain(document.activeElement);
  });

  test('flèche droite et flèche gauche : la colonne d\'à côté prend le focus et le tabindex 0 ; au bord, rien ne bouge', async () => {
    setup();
    column(4).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(column(5));
    expect(columns().filter((button) => button.tabIndex === 0)).toEqual([column(5)]);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(column(1));
    expect(columns().filter((button) => button.tabIndex === 0)).toEqual([column(1)]);
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(column(7));
  });

  test('Début va à la première colonne, Fin à la dernière', async () => {
    setup();
    column(4).focus();
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(column(7));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(column(1));
    expect(columns().filter((button) => button.tabIndex === 0)).toEqual([column(1)]);
  });

  test('la colonne où l\'on revient par Tab est celle où l\'on s\'est arrêté, et un clic ou un focus à la souris déplace aussi le tabindex', async () => {
    setup();
    column(4).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    (document.activeElement as HTMLElement).blur();
    await userEvent.tab();
    expect(document.activeElement).toBe(column(6));
    await userEvent.click(column(2));
    expect(columns().filter((button) => button.tabIndex === 0)).toEqual([column(2)]);
  });

  test('les flèches, Début et Fin marchent aussi quand on ne peut pas jouer : on lit le plateau colonne par colonne', async () => {
    setup({ canAct: false, mySeat: null });
    column(4).focus();
    await userEvent.keyboard('{ArrowRight}{End}');
    expect(document.activeElement).toBe(column(7));
  });

  // Toute touche que le plateau prend reçoit preventDefault et stopPropagation : le clavier de l'avatar (game/input.ts), la touche E et le zoom, qui écoutent la fenêtre, ne la voient
  // alors pas. Les touches qu'il ne prend pas passent.
  const TAKEN: KeyboardEventInit[] = [
    { key: 'ArrowLeft', code: 'ArrowLeft' },
    { key: 'ArrowRight', code: 'ArrowRight' },
    { key: 'Home', code: 'Home' },
    { key: 'End', code: 'End' },
    { key: 'Enter', code: 'Enter' },
    { key: ' ', code: 'Space' },
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ key: String(n), code: `Digit${n}` })),
    { key: '4', code: 'Numpad4' },
    // Un clavier AZERTY : le 4 sans Maj envoie une apostrophe.
    { key: '\'', code: 'Digit4' },
  ];
  const PASSED: KeyboardEventInit[] = [
    { key: 'ArrowUp', code: 'ArrowUp' },
    { key: 'ArrowDown', code: 'ArrowDown' },
    { key: 'Escape', code: 'Escape' },
    { key: 'Tab', code: 'Tab' },
    { key: 'e', code: 'KeyE' },
    { key: 'a', code: 'KeyA' },
    { key: 'd', code: 'KeyD' },
    { key: 'w', code: 'KeyW' },
    { key: '+', code: 'Equal' },
    { key: '-', code: 'Minus' },
    { key: '0', code: 'Digit0' },
    { key: '8', code: 'Digit8' },
    { key: '9', code: 'Digit9' },
    { key: 'Shift', code: 'ShiftLeft' },
    // Un raccourci du navigateur (Ctrl + 4 change d'onglet, Ctrl + flèche, ⌘ + Début…) n'est pas pour le plateau.
    { key: '4', code: 'Digit4', ctrlKey: true },
    { key: 'ArrowRight', code: 'ArrowRight', altKey: true },
    { key: 'Home', code: 'Home', metaKey: true },
  ];

  test.each([['quand c\'est à soi de jouer', { canAct: true }], ['quand on ne peut pas jouer (tour de l\'autre, aperçu, spectateur)', { canAct: false, mySeat: null }]] as const)(
    'chaque touche prise reçoit preventDefault et stopPropagation, %s',
    (_name, over) => {
      const heard = vi.fn();
      window.addEventListener('keydown', heard);
      try {
        setup(over);
        for (const init of TAKEN) {
          heard.mockClear();
          column(4).focus();
          const notPrevented = fireEvent.keyDown(document.activeElement!, init);
          expect(notPrevented, `${init.key} (${init.code}) devrait être empêchée`).toBe(false);
          expect(heard, `${init.key} (${init.code}) ne devrait pas atteindre la fenêtre`).not.toHaveBeenCalled();
        }
      } finally {
        window.removeEventListener('keydown', heard);
      }
    },
  );

  test('les touches que le plateau n\'utilise pas passent, telles quelles : l\'avatar, la touche E, le zoom et Échap (qui ferme le panneau) les reçoivent', () => {
    const heard = vi.fn();
    window.addEventListener('keydown', heard);
    try {
      setup();
      for (const init of PASSED) {
        heard.mockClear();
        column(4).focus();
        const notPrevented = fireEvent.keyDown(document.activeElement!, init);
        expect(notPrevented, `${init.key} (${init.code}) ne devrait pas être empêchée`).toBe(true);
        expect(heard, `${init.key} (${init.code}) devrait atteindre la fenêtre`).toHaveBeenCalledTimes(1);
      }
    } finally {
      window.removeEventListener('keydown', heard);
    }
  });

  test('Entrée et Espace sont aussi prises au relâchement (sinon le navigateur en fait un clic de plus, et le coup partirait deux fois) ; une flèche relâchée passe, pour que l\'avatar qui marchait s\'arrête', () => {
    setup();
    column(4).focus();
    expect(fireEvent.keyUp(column(4), { key: 'Enter', code: 'Enter' })).toBe(false);
    expect(fireEvent.keyUp(column(4), { key: ' ', code: 'Space' })).toBe(false);
    expect(fireEvent.keyUp(column(4), { key: 'ArrowRight', code: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyUp(column(4), { key: 'a', code: 'KeyA' })).toBe(true);
  });
});

describe('§ 9.5.4 · le lecteur d\'écran : chaque colonne dit son contenu', () => {
  test('les sept colonnes forment un groupe nommé « Colonnes », numérotées de 1 à 7', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Colonnes' })).toBeTruthy();
    expect(columns().map((button) => button.getAttribute('aria-label')?.split(' :')[0])).toEqual(['Colonne 1', 'Colonne 2', 'Colonne 3', 'Colonne 4', 'Colonne 5', 'Colonne 6', 'Colonne 7']);
  });

  test('« Colonne 4 : rouge, jaune, rouge ; 3 places libres » : les jetons de bas en haut, puis ce qu\'il reste', () => {
    setup({ state: playColumns(0, [3, 3, 3]) });
    expect(column(4).getAttribute('aria-label')).toBe('Colonne 4 : rouge, jaune, rouge ; 3 places libres');
    // Les couleurs suivent les sièges, pas l'ordre des coups : le siège 1 commence, ses jetons sont jaunes.
  });

  test('les couleurs sont celles des sièges, quel que soit celui qui a commencé', () => {
    setup({ state: playColumns(1, [2, 2]) });
    expect(column(3).getAttribute('aria-label')).toBe('Colonne 3 : jaune, rouge ; 4 places libres');
  });

  test('une colonne vide, une colonne à une place, une colonne pleine', () => {
    setup({ state: playColumns(0, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]) });
    expect(column(3).getAttribute('aria-label')).toBe('Colonne 3 : vide ; 6 places libres');
    expect(column(1).getAttribute('aria-label')).toBe('Colonne 1 : rouge, jaune, rouge, jaune, rouge ; 1 place libre');
    expect(column(2).getAttribute('aria-label')).toBe('Colonne 2 : jaune, rouge, jaune, rouge, jaune, rouge ; colonne pleine');
  });

  test('chaque jeton et chaque trou sont décoratifs (aria-hidden) : le nom de la colonne dit tout, une seule fois', () => {
    const { root } = setup({ state: playColumns(0, [3, 4]) });
    for (const svg of root.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
    for (const button of columns()) expect(within(button).queryAllByRole('img')).toHaveLength(0);
  });

  test('une colonne qu\'on ne peut pas jouer est dite inactive (aria-disabled), sans cesser d\'être lisible : elle garde le focus', () => {
    setup({ state: playColumns(0, [0, 0, 0, 0, 0, 0]) });
    expect(column(1).getAttribute('aria-disabled')).toBe('true');
    expect(column(1).hasAttribute('disabled')).toBe(false);
    expect(column(2).getAttribute('aria-disabled')).toBe('false');
    column(1).focus();
    expect(document.activeElement).toBe(column(1));
  });

  test('la couleur n\'est jamais seule : le nom de chaque couleur est écrit dans le nom de la colonne, et la fin est dite par la plateforme', () => {
    setup({ state: playColumns(0, C4) });
    expect(column(4).getAttribute('aria-label')).toContain('rouge');
    expect(column(5).getAttribute('aria-label')).toContain('jaune');
  });
});

describe('jouer : un clic, Entrée, Espace ou un chiffre lâche le jeton ; sinon, rien ne part', () => {
  test('un clic sur une colonne la joue, une fois', async () => {
    const { onMove } = setup();
    await userEvent.click(column(5));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ col: 4 });
  });

  test('Entrée et Espace jouent la colonne qui a le focus, une seule fois chacune (pas de clic de plus)', async () => {
    const { onMove } = setup();
    column(6).focus();
    await userEvent.keyboard('{Enter}');
    expect(onMove.mock.calls).toEqual([[{ col: 5 }]]);
    await userEvent.keyboard(' ');
    expect(onMove.mock.calls).toEqual([[{ col: 5 }], [{ col: 5 }]]);
  });

  test('les chiffres de 1 à 7 jouent leur colonne, d\'où que soit le focus dans le plateau ; 0, 8 et 9 ne jouent rien', async () => {
    const { onMove } = setup();
    column(4).focus();
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await userEvent.keyboard(String(n));
    expect(onMove.mock.calls.map(([move]) => move.col)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    onMove.mockClear();
    await userEvent.keyboard('089');
    expect(onMove).not.toHaveBeenCalled();
  });

  test('une touche maintenue enfoncée se répète : elle est prise à chaque fois, mais ne lâche qu\'un jeton', () => {
    const { onMove } = setup();
    column(2).focus();
    expect(fireEvent.keyDown(column(2), { key: 'Enter', code: 'Enter' })).toBe(false);
    for (let repeats = 0; repeats < 5; repeats++) expect(fireEvent.keyDown(column(2), { key: 'Enter', code: 'Enter', repeat: true })).toBe(false);
    fireEvent.keyDown(column(2), { key: '5', code: 'Digit5' });
    for (let repeats = 0; repeats < 5; repeats++) expect(fireEvent.keyDown(column(2), { key: '5', code: 'Digit5', repeat: true })).toBe(false);
    expect(onMove.mock.calls).toEqual([[{ col: 1 }], [{ col: 4 }]]);
  });

  test('un chiffre joue même sur un clavier AZERTY, où la touche du 4 envoie une apostrophe (c\'est la position de la touche qui compte)', () => {
    const { onMove } = setup();
    column(1).focus();
    fireEvent.keyDown(column(1), { key: '\'', code: 'Digit4' });
    expect(onMove).toHaveBeenCalledWith({ col: 3 });
  });

  test('une colonne pleine ne se joue pas (clic, Entrée, chiffre), mais les autres oui', async () => {
    const { onMove } = setup({ state: playColumns(0, [0, 0, 0, 0, 0, 0]) });
    await userEvent.click(column(1));
    column(1).focus();
    await userEvent.keyboard('{Enter}1');
    expect(onMove).not.toHaveBeenCalled();
    await userEvent.click(column(2));
    expect(onMove).toHaveBeenCalledWith({ col: 1 });
  });

  test('ce n\'est pas à soi de jouer (canAct faux) : rien ne part, par aucune voie, et toutes les colonnes se disent inactives', async () => {
    const { onMove } = setup({ canAct: false });
    await userEvent.click(column(4));
    column(4).focus();
    await userEvent.keyboard('{Enter} 4');
    expect(onMove).not.toHaveBeenCalled();
    for (const button of columns()) expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  test('un spectateur (mySeat nul) ne peut rien, même si on lui dit canAct : ni clic, ni touche, et il ne voit pas de fantôme', async () => {
    const { onMove, root } = setup({ mySeat: null, canAct: true });
    await userEvent.click(column(4));
    column(4).focus();
    await userEvent.keyboard('{Enter}4 ');
    expect(onMove).not.toHaveBeenCalled();
    expect(root.querySelector('.game-connect4-ghost')).toBeNull();
    for (const button of columns()) expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  test('l\'aperçu d\'avant la première partie : rien n\'est cliquable, la grille est vide, et il se déclare comme tel', async () => {
    const { onMove, root } = setup({ preview: true, canAct: false, mySeat: null });
    expect(root.dataset.preview).toBe('true');
    await userEvent.click(column(4));
    column(4).focus();
    await userEvent.keyboard('{Enter}4');
    expect(onMove).not.toHaveBeenCalled();
    expect(tokens(root)).toHaveLength(0);
    for (const button of columns()) expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  test('une partie finie ne se joue plus, même si la plateforme laisse canAct (elle ne le fait pas, mais le plateau ne s\'y fie pas)', async () => {
    const { onMove, root } = setup({ state: playColumns(0, C4), canAct: true });
    await userEvent.click(column(1));
    expect(onMove).not.toHaveBeenCalled();
    expect(root.querySelector('.game-connect4-ghost')).toBeNull();
    for (const button of columns()) expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  test('chaque case et chaque bouton du plateau coupe le clic sonore (data-sfx="none") : seuls les jetons font du bruit, par la plateforme', () => {
    setup();
    for (const button of columns()) expect(button.getAttribute('data-sfx')).toBe('none');
  });

  test('le plateau n\'appelle jamais le moteur audio lui-même, quoi qu\'on fasse', async () => {
    setup({ state: playColumns(0, [3]), events: [drop(0, 3, 0)] });
    await userEvent.click(column(2));
    column(2).focus();
    await userEvent.keyboard('{ArrowRight}{Enter}5');
    expect(audioEngine.playSfx).not.toHaveBeenCalled();
  });
});

describe('le fantôme : le jeton qu\'on va lâcher, au-dessus de sa colonne', () => {
  test('quand c\'est à soi de jouer, chaque colonne libre a son fantôme, de la couleur du siège (rouge pour le 0, jaune pour le 1)', () => {
    const { root, unmount } = setup({ mySeat: 0 });
    const ghosts = [...root.querySelectorAll<HTMLElement>('.game-connect4-ghost')];
    expect(ghosts).toHaveLength(7);
    for (const ghost of ghosts) {
      expect(ghost.dataset.seat).toBe('0');
      expect(ghost.getAttribute('aria-hidden')).toBe('true');
      expect(ghost.querySelector(`path[fill="${TOKEN_PALETTES.red.b}"]`)).not.toBeNull();
    }
    unmount();
    const second = setup({ mySeat: 1, state: playColumns(1, []) });
    for (const ghost of second.root.querySelectorAll<HTMLElement>('.game-connect4-ghost')) {
      expect(ghost.dataset.seat).toBe('1');
      expect(ghost.querySelector(`path[fill="${TOKEN_PALETTES.yellow.b}"]`)).not.toBeNull();
    }
  });

  test('une colonne pleine n\'a pas de fantôme ; au tour de l\'autre, aucune colonne n\'en a', () => {
    const full = setup({ state: playColumns(0, [0, 0, 0, 0, 0, 0]) });
    expect(full.root.querySelectorAll('.game-connect4-ghost')).toHaveLength(6);
    expect(column(1).querySelector('.game-connect4-ghost')).toBeNull();
    full.unmount();
    const waiting = setup({ canAct: false });
    expect(waiting.root.querySelectorAll('.game-connect4-ghost')).toHaveLength(0);
  });
});

describe('§ 9.5.5 · la chute et le mouvement réduit', () => {
  test('le jeton qui vient d\'être lâché tombe (data-falling), de la hauteur de la grille : 6 rangées pour le fond, une seule pour le haut', () => {
    const state = playColumns(0, [3, 3, 3, 3, 3, 3]);
    const { root } = setup({ state, events: [drop(1, 3, 5)] });
    const falling = tokens(root).filter((element) => element.hasAttribute('data-falling'));
    expect(falling).toEqual([token(root, 3, 5)]);
    expect(token(root, 3, 5)!.style.getPropertyValue('--game-connect4-fall-rows')).toBe('1');
    const bottom = setup({ state: playColumns(0, [3]), events: [drop(0, 3, 0)] });
    expect(token(bottom.root, 3, 0)!.style.getPropertyValue('--game-connect4-fall-rows')).toBe('6');
  });

  test('seul le jeton qui vient d\'arriver tombe : les autres sont déjà posés', () => {
    const { root } = setup({ state: playColumns(0, [3, 4, 3]), events: [drop(0, 3, 1)] });
    expect(tokens(root)).toHaveLength(3);
    expect(tokens(root).filter((element) => element.hasAttribute('data-falling'))).toEqual([token(root, 3, 1)]);
  });

  test('après un saut d\'état (le panneau s\'ouvre, la connexion revient : aucun événement), rien ne tombe, et rien ne repart quand le plateau se redessine', () => {
    const { root, rerender } = setup({ state: playColumns(0, [3, 4, 3]), events: [] });
    expect(tokens(root).filter((element) => element.hasAttribute('data-falling'))).toHaveLength(0);
    rerender({ state: playColumns(0, [3, 4, 3, 4]), events: [drop(1, 4, 1)] });
    expect(tokens(root).filter((element) => element.hasAttribute('data-falling'))).toEqual([token(root, 4, 1)]);
    rerender({ state: playColumns(0, [3, 4, 3, 4]), events: [] });
    expect(tokens(root).filter((element) => element.hasAttribute('data-falling'))).toHaveLength(0);
  });

  test('les événements qui ne sont pas des jetons (la fin, un abandon) ne font rien tomber', () => {
    const { root } = setup({ state: playColumns(0, C4), events: [{ type: 'end', winner: 0, cells: [18, 19, 20, 21] }, { type: 'forfeit', seat: 1, reason: 'resign' }] });
    expect(tokens(root).filter((element) => element.hasAttribute('data-falling'))).toHaveLength(0);
  });

  test('mouvement réduit : aucun jeton ne tombe, il est posé tout de suite à sa place (même état final, aucune chute à attendre)', () => {
    const state = playColumns(0, [3, 3, 3]);
    const reduced = setup({ state, events: [drop(0, 3, 2)], reducedMotion: true });
    expect(tokens(reduced.root)).toHaveLength(3);
    expect(tokens(reduced.root).filter((element) => element.hasAttribute('data-falling'))).toHaveLength(0);
    expect(tokens(reduced.root).filter((element) => element.style.getPropertyValue('--game-connect4-fall-rows') !== '')).toHaveLength(0);
    const moving = setup({ state, events: [drop(0, 3, 2)], reducedMotion: false });
    // Le même état, à la chute près.
    expect(tokens(moving.root).map((element) => [element.dataset.col, element.dataset.row, element.dataset.seat])).toEqual(
      tokens(reduced.root).map((element) => [element.dataset.col, element.dataset.row, element.dataset.seat]),
    );
  });

  test('mouvement réduit et on demande moins : le plateau ne mène aucune animation lui-même (ni minuteur, ni image par image)', () => {
    vi.useFakeTimers();
    try {
      const timers = vi.spyOn(globalThis, 'setTimeout');
      const frames = typeof globalThis.requestAnimationFrame === 'function' ? vi.spyOn(globalThis, 'requestAnimationFrame') : null;
      const intervals = vi.spyOn(globalThis, 'setInterval');
      const { rerender } = setup({ state: playColumns(0, [3]), events: [drop(0, 3, 0)], reducedMotion: true });
      rerender({ state: playColumns(0, [3, 4]), events: [drop(1, 4, 0)], reducedMotion: true });
      // Rien n'a été armé par le plateau lui-même (React peut en armer pour son propre compte : on ne compte que ce qui vient du plateau, ses appels `setInterval` et image par image).
      expect(frames?.mock.calls ?? []).toHaveLength(0);
      expect(intervals).not.toHaveBeenCalled();
      expect(timers.mock.calls.filter(([, delay]) => typeof delay === 'number' && delay >= 100 && delay <= 600)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('le dernier jeton, cerclé, et la ligne gagnante, soulignée', () => {
  test('le dernier jeton posé est cerclé (data-last), qu\'on ait vu tomber le jeton ou non ; une grille vide n\'en a pas', () => {
    const { root, rerender } = setup({ state: playColumns(0, [3, 4, 2]), events: [] });
    expect(tokens(root).filter((element) => element.hasAttribute('data-last'))).toEqual([token(root, 2, 0)]);
    rerender({ state: playColumns(0, [3, 4, 2, 2]), events: [drop(1, 2, 1)] });
    expect(tokens(root).filter((element) => element.hasAttribute('data-last'))).toEqual([token(root, 2, 1)]);
    rerender({ state: playColumns(0, []), events: [] });
    expect(tokens(root)).toHaveLength(0);
  });

  test('le cerclage est le contour blanc du jeton : le même dessin, une autre palette', () => {
    const { root } = setup({ state: playColumns(0, [3, 4]) });
    const last = token(root, 4, 0)!;
    const other = token(root, 3, 0)!;
    expect(last.querySelector('path[fill="#ffffff"]')).not.toBeNull();
    expect(other.querySelector('path[fill="#ffffff"]')).toBeNull();
    expect(last.querySelectorAll('path').length).toBe(other.querySelectorAll('path').length);
  });

  test('la ligne gagnante : ses jetons sont marqués (data-win), les autres s\'effacent (data-dim) ; le dernier jeton en fait partie', () => {
    const { root } = setup({ state: playColumns(0, C4), canAct: false });
    const winners = tokens(root).filter((element) => element.hasAttribute('data-win'));
    expect(winners.map((element) => [element.dataset.col, element.dataset.row])).toEqual([['3', '3'], ['3', '2'], ['3', '1'], ['3', '0']]);
    expect(tokens(root).filter((element) => element.hasAttribute('data-dim'))).toHaveLength(3);
    expect(token(root, 3, 3)!.hasAttribute('data-last')).toBe(true);
    expect(token(root, 3, 3)!.hasAttribute('data-win')).toBe(true);
  });

  test('deux lignes à la fois : les sept cases sont marquées', () => {
    const { root } = setup({ state: playColumns(0, C9), canAct: false });
    expect(tokens(root).filter((element) => element.hasAttribute('data-win'))).toHaveLength(7);
    expect(tokens(root).filter((element) => element.hasAttribute('data-dim'))).toHaveLength(20);
  });

  test('la grille pleine sans alignement, une partie en cours et un abandon : aucune ligne gagnante, rien ne s\'efface', () => {
    for (const state of [playColumns(0, C10), playColumns(0, [3, 4, 3]), playColumns(0, [])]) {
      const { root, unmount } = setup({ state, canAct: false });
      expect(tokens(root).filter((element) => element.hasAttribute('data-win') || element.hasAttribute('data-dim'))).toHaveLength(0);
      unmount();
    }
  });

  test('la ligne gagnante se voit sans bouger : le marquage est un attribut, que le mouvement réduit garde (le contour épais est dans la feuille de style)', () => {
    const { root } = setup({ state: playColumns(0, C4), canAct: false, reducedMotion: true });
    expect(tokens(root).filter((element) => element.hasAttribute('data-win'))).toHaveLength(4);
  });
});

describe('§ 9.5.6 · les images : du code, pas de fichier', () => {
  test('les jetons et les trous sont des SVG aux bords nets, à l\'échelle entière, de 13 pixels de côté ; aucune image, aucun canevas, aucune adresse', () => {
    const { root } = setup({ state: playColumns(0, [3, 4]) });
    const svgs = [...root.querySelectorAll('svg')];
    // 42 trous, 2 jetons, 7 fantômes.
    expect(svgs).toHaveLength(42 + 2 + 7);
    for (const svg of svgs) {
      expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
      expect(svg.getAttribute('viewBox')).toBe('0 0 13 13');
      expect(Number(svg.getAttribute('width')) % 13).toBe(0);
      expect(svg.getAttribute('height')).toBe(svg.getAttribute('width'));
    }
    expect(root.querySelector('img, image, canvas, video, object, [style*="url("], [src], [href]')).toBeNull();
  });

  test('le rouge est celui du siège 0, le jaune celui du siège 1, dans les jetons comme dans les fantômes', () => {
    const { root } = setup({ state: playColumns(0, [3, 4]), mySeat: 0 });
    expect(token(root, 3, 0)!.dataset.seat).toBe('0');
    expect(token(root, 3, 0)!.querySelector(`path[fill="${TOKEN_PALETTES.red.b}"]`)).not.toBeNull();
    expect(token(root, 4, 0)!.dataset.seat).toBe('1');
    expect(token(root, 4, 0)!.querySelector(`path[fill="${TOKEN_PALETTES.yellow.b}"]`)).not.toBeNull();
  });
});

describe('le plateau : sa structure', () => {
  test('six rangées de sept trous, la rangée du haut de l\'écran en premier : la rangée 5 de l\'état est en haut, la rangée 0 en bas', () => {
    const { root } = setup({ state: playColumns(0, [3, 3]) });
    const cellsOfColumn = [...column(4).querySelectorAll<HTMLElement>('.game-connect4-cell')];
    expect(cellsOfColumn.map((cell) => cell.dataset.row)).toEqual(['5', '4', '3', '2', '1', '0']);
    expect(root.querySelectorAll('.game-connect4-cell')).toHaveLength(42);
    // Les deux jetons sont tout en bas.
    expect(token(root, 3, 0)).not.toBeNull();
    expect(token(root, 3, 1)).not.toBeNull();
    expect(cellsOfColumn[5]!.querySelector('.game-connect4-token')).toBe(token(root, 3, 0));
    expect(cellsOfColumn[4]!.querySelector('.game-connect4-token')).toBe(token(root, 3, 1));
  });

  test('le plateau suit l\'état : chaque jeton à sa colonne et à sa rangée, avec la couleur de son siège', () => {
    const state = playColumns(1, [0, 1, 1, 2]);
    const { root } = setup({ state, mySeat: 1 });
    expect(tokens(root).map((element) => [element.dataset.col, element.dataset.row, element.dataset.seat])).toEqual([
      ['0', '0', '1'],
      // Dans une colonne, le jeton le plus haut de l'écran vient le premier.
      ['1', '1', '1'],
      ['1', '0', '0'],
      ['2', '0', '0'],
    ]);
  });
});
