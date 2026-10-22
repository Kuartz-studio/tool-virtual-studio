import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bindKeyboard, DirectionInput } from '../../game/input';
import { boardProps, fromFen, play, square, squaresOnScreen, startState } from './chess-test-kit';
import { ChessBoard } from './ChessBoard';

// Le plateau des échecs, monté seul avec les propriétés que la plateforme lui donne (GameBoardProps). Ce qu'il doit à tout plateau (§ 9.5 du document des jeux) est testé point par point :
// la taille, les cibles, le clavier, le lecteur d'écran, le mouvement réduit, les sons, les images, le spectateur ; puis ce qui est propre aux échecs (§ 13.6) : jouer, promouvoir, le dernier coup,
// l'échec, les pièces prises, la liste des coups.

const SCHOLAR = 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('la structure : une grille nommée, soixante-quatre cases-boutons (§ 9.5.3, § 9.5.4)', () => {
  test('une grille « Échiquier » de huit rangées de huit cases, chaque case un bouton', () => {
    render(<ChessBoard {...boardProps()} />);
    const grid = screen.getByRole('grid', { name: 'Échiquier' });
    expect(within(grid).getAllByRole('row')).toHaveLength(8);
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(64);
    expect(within(grid).getAllByRole('button')).toHaveLength(64);
  });

  test('chaque case dit son nom et son contenu : « e2, pion blanc », « e4, vide »', () => {
    render(<ChessBoard {...boardProps()} />);
    expect(square('e2').getAttribute('aria-label')).toBe('e2, pion blanc');
    expect(square('e1').getAttribute('aria-label')).toBe('e1, roi blanc');
    expect(square('d1').getAttribute('aria-label')).toBe('d1, dame blanche');
    expect(square('h1').getAttribute('aria-label')).toBe('h1, tour blanche');
    expect(square('c1').getAttribute('aria-label')).toBe('c1, fou blanc');
    expect(square('b1').getAttribute('aria-label')).toBe('b1, cavalier blanc');
    expect(square('d8').getAttribute('aria-label')).toBe('d8, dame noire');
    expect(square('a8').getAttribute('aria-label')).toBe('a8, tour noire');
    expect(square('g7').getAttribute('aria-label')).toBe('g7, pion noir');
    expect(square('e4').getAttribute('aria-label')).toBe('e4, vide');
  });

  test('une seule case est dans l\'ordre de tabulation (tabindex mobile)', () => {
    render(<ChessBoard {...boardProps()} />);
    const tabbable = screen.getAllByRole('button').filter((button) => button.getAttribute('tabindex') === '0' && button.hasAttribute('data-square'));
    expect(tabbable).toHaveLength(1);
  });

  test('les coordonnées sont dans les cases du bord : les lettres en bas, les chiffres à gauche', () => {
    render(<ChessBoard {...boardProps()} />);
    const files = [...document.querySelectorAll('[data-coord="file"]')].map((element) => [element.closest('button')!.getAttribute('data-square'), element.textContent]);
    expect(files).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((letter) => [`${letter}1`, letter]));
    const ranks = [...document.querySelectorAll('[data-coord="rank"]')].map((element) => [element.closest('button')!.getAttribute('data-square'), element.textContent]);
    expect(ranks).toEqual([8, 7, 6, 5, 4, 3, 2, 1].map((rank) => [`a${rank}`, String(rank)]));
    // Décoratives : le nom de la case les dit déjà.
    for (const element of document.querySelectorAll('[data-coord]')) expect(element.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('l\'orientation : sa couleur en bas, les Blancs en bas pour qui regarde (§ 13.6)', () => {
  test('les Blancs jouent d\'en bas : a8 est la première case à l\'écran, h1 la dernière', () => {
    render(<ChessBoard {...boardProps({ mySeat: 0 })} />);
    const order = squaresOnScreen();
    expect(order[0]).toBe('a8');
    expect(order[7]).toBe('h8');
    expect(order[63]).toBe('h1');
    expect(document.querySelector('.game-chess')!.getAttribute('data-orientation')).toBe('w');
  });

  test('les Noirs jouent d\'en bas : le plateau est retourné (h1 en haut à gauche, a8 en bas à droite), lettres et chiffres aussi', () => {
    render(<ChessBoard {...boardProps({ mySeat: 1 })} />);
    const order = squaresOnScreen();
    expect(order[0]).toBe('h1');
    expect(order[63]).toBe('a8');
    expect(document.querySelector('.game-chess')!.getAttribute('data-orientation')).toBe('b');
    const files = [...document.querySelectorAll('[data-coord="file"]')].map((element) => element.textContent);
    expect(files).toEqual(['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']);
    const ranks = [...document.querySelectorAll('[data-coord="rank"]')].map((element) => element.textContent);
    expect(ranks).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  test('un siège n\'est pas une couleur : avec les Blancs au siège 1, c\'est le siège 1 qui joue d\'en bas, et le siège 0 qui est retourné', () => {
    const state = startState(1);
    const { unmount } = render(<ChessBoard {...boardProps({ state, mySeat: 1 })} />);
    expect(squaresOnScreen()[0]).toBe('a8');
    unmount();
    render(<ChessBoard {...boardProps({ state, mySeat: 0 })} />);
    expect(squaresOnScreen()[0]).toBe('h1');
  });

  test('un spectateur voit les Blancs en bas', () => {
    render(<ChessBoard {...boardProps({ mySeat: null })} />);
    expect(squaresOnScreen()[0]).toBe('a8');
  });
});

describe('jouer à la souris (§ 13.6)', () => {
  test('un clic sur une de ses pièces la sélectionne et montre ses cases d\'arrivée : un point pour un coup, un anneau pour une prise', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps({ state: play(startState(), 'e2e4 d7d5').state })} />);
    await user.click(square('e4'));
    expect(square('e4').getAttribute('aria-label')).toBe('e4, pion blanc, sélectionnée');
    expect(square('e5').getAttribute('aria-label')).toBe('e5, vide, coup possible');
    expect(square('e5').getAttribute('data-hint')).toBe('move');
    expect(square('d5').getAttribute('aria-label')).toBe('d5, pion noir, prise possible, dernier coup');
    expect(square('d5').getAttribute('data-hint')).toBe('capture');
    expect(square('e6').getAttribute('data-hint')).toBeNull();
  });

  test('un clic sur une case d\'arrivée joue le coup, et la sélection tombe', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ onMove })} />);
    await user.click(square('e2'));
    await user.click(square('e4'));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });
    expect(square('e2').getAttribute('aria-label')).toBe('e2, pion blanc');
  });

  test('un clic sur une autre de ses pièces change la sélection ; un clic sur la même la lâche ; ailleurs, la sélection tombe', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ onMove })} />);
    await user.click(square('e2'));
    await user.click(square('g1'));
    expect(square('e2').getAttribute('aria-label')).toBe('e2, pion blanc');
    expect(square('g1').getAttribute('aria-label')).toBe('g1, cavalier blanc, sélectionnée');
    expect(square('f3').getAttribute('data-hint')).toBe('move');
    await user.click(square('g1'));
    expect(square('g1').getAttribute('aria-label')).toBe('g1, cavalier blanc');
    await user.click(square('b1'));
    await user.click(square('e5'));
    expect(square('b1').getAttribute('aria-label')).toBe('b1, cavalier blanc');
    expect(screen.queryAllByRole('button', { name: /sélectionnée/ })).toHaveLength(0);
    await user.click(square('d2'));
    await user.click(square('a8'));
    expect(square('d2').getAttribute('aria-label')).toBe('d2, pion blanc');
    expect(onMove).not.toHaveBeenCalled();
  });

  test('une pièce adverse ne se sélectionne pas', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps()} />);
    await user.click(square('e7'));
    expect(square('e7').getAttribute('aria-label')).toBe('e7, pion noir');
    expect(screen.queryAllByRole('button', { name: /coup possible|prise possible/ })).toHaveLength(0);
  });

  test('le roque se joue en amenant le roi sur g1 (ou c1) : le coup envoyé est celui du roi', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), onMove })} />);
    await user.click(square('e1'));
    expect(square('g1').getAttribute('data-hint')).toBe('move');
    expect(square('c1').getAttribute('data-hint')).toBe('move');
    await user.click(square('g1'));
    expect(onMove).toHaveBeenCalledWith({ from: 'e1', to: 'g1' });
  });

  test('la prise en passant : la case de prise est marquée comme une prise, et le coup arrive sur elle', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: play(startState(), 'e2e4 a7a6 e4e5 d7d5').state, onMove })} />);
    await user.click(square('e5'));
    expect(square('d6').getAttribute('aria-label')).toBe('d6, vide, prise possible');
    expect(square('d6').getAttribute('data-hint')).toBe('capture');
    await user.click(square('d6'));
    expect(onMove).toHaveBeenCalledWith({ from: 'e5', to: 'd6' });
  });

  test('une pièce sans coup se sélectionne quand même, sans rien montrer', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps()} />);
    await user.click(square('a1'));
    expect(square('a1').getAttribute('aria-label')).toBe('a1, tour blanche, sélectionnée');
    expect(screen.queryAllByRole('button', { name: /coup possible|prise possible/ })).toHaveLength(0);
  });

  test('la sélection ne survit pas à un nouveau coup de la partie', async () => {
    const user = userEvent.setup();
    const props = boardProps();
    const { rerender } = render(<ChessBoard {...props} />);
    await user.click(square('g1'));
    rerender(<ChessBoard {...props} state={play(startState(), 'e2e4 e7e5').state} />);
    expect(screen.queryAllByRole('button', { name: /sélectionnée/ })).toHaveLength(0);
  });
});

describe('la promotion (§ 13.6)', () => {
  const PROMOTION = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';

  test('un pion qui arrive au bout ouvre un choix (Dame, Tour, Fou, Cavalier) : rien n\'est envoyé avant le choix, et le focus est sur Dame', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: fromFen(PROMOTION), onMove })} />);
    await user.click(square('a7'));
    await user.click(square('a8'));
    expect(onMove).not.toHaveBeenCalled();
    const choice = screen.getByRole('dialog', { name: 'Promotion : choisis une pièce' });
    expect(within(choice).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Dame', 'Tour', 'Fou', 'Cavalier']);
    expect(document.activeElement).toBe(within(choice).getByRole('button', { name: 'Dame' }));
  });

  test.each([
    ['Dame', 'q'],
    ['Tour', 'r'],
    ['Fou', 'b'],
    ['Cavalier', 'n'],
  ])('choisir %s envoie la promotion « %s », et le choix se ferme', async (label, letter) => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: fromFen(PROMOTION), onMove })} />);
    await user.click(square('a7'));
    await user.click(square('a8'));
    await user.click(screen.getByRole('button', { name: label }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ from: 'a7', to: 'a8', promotion: letter });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('une promotion avec prise passe aussi par le choix', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: fromFen('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1'), onMove })} />);
    await user.click(square('b7'));
    expect(square('a8').getAttribute('data-hint')).toBe('capture');
    expect(square('b8').getAttribute('data-hint')).toBe('move');
    await user.click(square('a8'));
    expect(onMove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Tour' }));
    expect(onMove).toHaveBeenCalledWith({ from: 'b7', to: 'a8', promotion: 'r' });
  });

  test('un pion noir qui promeut propose des pièces noires', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: fromFen('4k3/8/8/8/8/8/p7/4K3 b - - 0 1'), mySeat: 1, onMove })} />);
    await user.click(square('a2'));
    await user.click(square('a1'));
    const choice = screen.getByRole('dialog');
    expect([...choice.querySelectorAll('svg')].map((art) => art.getAttribute('data-color'))).toEqual(['b', 'b', 'b', 'b']);
    await user.click(within(choice).getByRole('button', { name: 'Cavalier' }));
    expect(onMove).toHaveBeenCalledWith({ from: 'a2', to: 'a1', promotion: 'n' });
  });

  test('Échap annule le choix : rien n\'est envoyé, et le focus revient sur la case d\'arrivée', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: fromFen(PROMOTION), onMove })} />);
    await user.click(square('a7'));
    await user.click(square('a8'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(square('a8'));
  });

  test('un clic ailleurs renonce au choix', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: fromFen(PROMOTION), onMove })} />);
    await user.click(square('a7'));
    await user.click(square('a8'));
    await user.click(square('e1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  test('une promotion entièrement au clavier : Entrée sur le pion, les flèches jusqu\'à la case, Entrée, Droite pour choisir le cavalier, Entrée', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: fromFen(PROMOTION), onMove })} />);
    square('a7').focus();
    await user.keyboard('{Enter}');
    expect(square('a7').getAttribute('aria-label')).toBe('a7, pion blanc, sélectionnée');
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(square('a8'));
    await user.keyboard('{Enter}');
    expect(onMove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dame' }));
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cavalier' }));
    // Au bout de la rangée, la flèche s'arrête (ni boucle, ni sortie du choix).
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cavalier' }));
    await user.keyboard('{Enter}');
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ from: 'a7', to: 'a8', promotion: 'n' });
  });

  test('au clavier, Entrée sur Dame, tout de suite : la dame', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ state: fromFen(PROMOTION), onMove })} />);
    square('a7').focus();
    await user.keyboard('{Enter}{ArrowUp}{Enter}{Enter}');
    expect(onMove).toHaveBeenCalledWith({ from: 'a7', to: 'a8', promotion: 'q' });
  });

  test('si la main passe à l\'autre pendant le choix (canAct faux), le choix se ferme sans rien envoyer', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const props = boardProps({ state: fromFen(PROMOTION), onMove });
    const { rerender } = render(<ChessBoard {...props} />);
    await user.click(square('a7'));
    await user.click(square('a8'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    rerender(<ChessBoard {...props} canAct={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('quand on ne peut pas jouer : canAct faux, spectateur, aperçu (§ 9.5.8)', () => {
  test('canAct faux : on ne sélectionne rien et on n\'envoie rien, à la souris comme au clavier', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ canAct: false, onMove })} />);
    await user.click(square('e2'));
    await user.click(square('e4'));
    square('g1').focus();
    await user.keyboard('{Enter}{ArrowUp}{ArrowUp}{Enter}');
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('button', { name: /sélectionnée|coup possible/ })).toHaveLength(0);
  });

  test('la main est reprise après la sélection (le coup attend la réponse du serveur) : le clic sur la case d\'arrivée n\'envoie rien', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const props = boardProps({ onMove });
    const { rerender } = render(<ChessBoard {...props} />);
    await user.click(square('e2'));
    rerender(<ChessBoard {...props} canAct={false} />);
    await user.click(square('e4'));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('button', { name: /sélectionnée|coup possible/ })).toHaveLength(0);
  });

  test('canAct faux, on parcourt quand même l\'échiquier au clavier, et la grille se dit en lecture seule', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps({ canAct: false })} />);
    square('e2').focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(square('e3'));
    expect(screen.getByRole('grid', { name: 'Échiquier' }).getAttribute('aria-readonly')).toBe('true');
    expect(document.querySelector('.game-chess')!.getAttribute('data-interactive')).toBeNull();
  });

  test('un spectateur : rien n\'est sélectionnable ; le dernier coup reste visible', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const { state, events } = play(startState(), 'e2e4 e7e5');
    render(<ChessBoard {...boardProps({ state, events, mySeat: null, canAct: false, onMove })} />);
    await user.click(square('e5'));
    await user.click(square('g1'));
    expect(screen.queryAllByRole('button', { name: /sélectionnée/ })).toHaveLength(0);
    expect(onMove).not.toHaveBeenCalled();
    expect(square('e5').getAttribute('aria-label')).toContain('dernier coup');
    expect(square('e7').getAttribute('aria-label')).toContain('dernier coup');
  });

  test('l\'aperçu d\'avant la première partie : le plateau de départ, rien n\'est cliquable', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ preview: true, mySeat: null, canAct: false, onMove })} />);
    expect(document.querySelector('.game-chess')!.getAttribute('data-preview')).toBe('true');
    await user.click(square('e2'));
    await user.click(square('e4'));
    expect(onMove).not.toHaveBeenCalled();
    expect(square('e2').getAttribute('aria-label')).toBe('e2, pion blanc');
    expect(squaresOnScreen()[0]).toBe('a8');
  });

  test('même avec canAct vrai par erreur, l\'aperçu ne joue pas (rien n\'est cliquable)', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ preview: true, canAct: true, mySeat: 0, onMove })} />);
    await user.click(square('e2'));
    await user.click(square('e4'));
    expect(onMove).not.toHaveBeenCalled();
  });

  test('la partie est finie : on ne joue plus', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const { state } = play(startState(), SCHOLAR);
    render(<ChessBoard {...boardProps({ state, mySeat: 1, canAct: true, onMove })} />);
    await user.click(square('e8'));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('button', { name: /sélectionnée/ })).toHaveLength(0);
  });
});

describe('le clavier : le motif « grid » (§ 9.5.3)', () => {
  test('les flèches suivent l\'écran : haut va vers l\'adversaire de qui regarde (les Blancs en bas)', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps({ mySeat: 0 })} />);
    square('e2').focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(square('e3'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(square('f3'));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(square('f1'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(square('e1'));
  });

  test('retourné, le plateau retourne aussi les flèches : haut va toujours vers l\'adversaire, droite vers la droite de l\'écran', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps({ mySeat: 1 })} />);
    square('e7').focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(square('e6'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(square('d6'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(square('d7'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(square('e7'));
  });

  test('aux bords, la flèche s\'arrête (pas de bouclage)', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps()} />);
    square('a8').focus();
    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(document.activeElement).toBe(square('a8'));
    square('h1').focus();
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(document.activeElement).toBe(square('h1'));
  });

  test('Début et Fin vont aux bouts de la rangée, à l\'écran', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ChessBoard {...boardProps({ mySeat: 0 })} />);
    square('e2').focus();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(square('h2'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(square('a2'));
    unmount();
    render(<ChessBoard {...boardProps({ mySeat: 1 })} />);
    square('e7').focus();
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(square('h7'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(square('a7'));
  });

  test('la case où est le focus est la seule dans l\'ordre de tabulation, et elle suit le focus', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps()} />);
    square('e2').focus();
    await user.keyboard('{ArrowRight}{ArrowUp}');
    const tabbable = screen.getAllByRole('button').filter((button) => button.getAttribute('tabindex') === '0' && button.hasAttribute('data-square'));
    expect(tabbable).toEqual([square('f3')]);
  });

  test('Entrée et Espace agissent : sélectionner, puis jouer', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ChessBoard {...boardProps({ onMove })} />);
    square('g1').focus();
    await user.keyboard('{Enter}');
    expect(square('g1').getAttribute('aria-label')).toContain('sélectionnée');
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowRight}');
    expect(document.activeElement).toBe(square('h3'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(square('g3'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(square('f3'));
    await user.keyboard(' ');
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ from: 'g1', to: 'f3' });
  });

  test('après un coup, le focus reste sur la case d\'arrivée', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps()} />);
    square('e2').focus();
    await user.keyboard('{Enter}{ArrowUp}{ArrowUp}{Enter}');
    expect(document.activeElement).toBe(square('e4'));
    expect(square('e4').getAttribute('tabindex')).toBe('0');
  });

  test('Échap annule la sélection ; sans rien à annuler, il passe (le panneau se ferme)', async () => {
    const user = userEvent.setup();
    const outside = vi.fn();
    render(
      <div onKeyDown={outside}>
        <ChessBoard {...boardProps()} />
      </div>,
    );
    square('e2').focus();
    await user.keyboard('{Enter}');
    expect(square('e2').getAttribute('aria-label')).toContain('sélectionnée');
    await user.keyboard('{Escape}');
    expect(square('e2').getAttribute('aria-label')).toBe('e2, pion blanc');
    expect(outside).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(outside).toHaveBeenCalledTimes(1);
  });

  test('chaque touche prise par le plateau reçoit preventDefault et ne remonte pas ; celles qu\'il n\'utilise pas passent', () => {
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    try {
      render(<ChessBoard {...boardProps()} />);
      const target = square('e2');
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ']) {
        seen.mockClear();
        expect(fireEvent.keyDown(target, { key }), `${key} : preventDefault`).toBe(false);
        expect(seen, `${key} : stopPropagation`).not.toHaveBeenCalled();
      }
      // Échap n'est pris que s'il a quelque chose à annuler.
      seen.mockClear();
      expect(fireEvent.keyDown(target, { key: 'Escape' })).toBe(true);
      expect(seen).toHaveBeenCalledTimes(1);
      // Une touche que le plateau n'utilise pas passe, intacte.
      for (const key of ['x', 'e', 'Tab', 'F5', '+']) {
        seen.mockClear();
        expect(fireEvent.keyDown(target, { key }), `${key} : intacte`).toBe(true);
        expect(seen, `${key} : remonte`).toHaveBeenCalledTimes(1);
      }
    } finally {
      document.removeEventListener('keydown', seen);
    }
  });

  test('les raccourcis du navigateur ne sont pas pris : Alt + flèche (précédent), Ctrl + Début, ⌘ + Entrée passent, et le focus ne bouge pas', () => {
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    try {
      render(<ChessBoard {...boardProps()} />);
      const target = square('e2');
      target.focus();
      for (const modifier of ['altKey', 'ctrlKey', 'metaKey'] as const) {
        for (const key of ['ArrowLeft', 'Home', 'Enter']) {
          seen.mockClear();
          expect(fireEvent.keyDown(target, { key, [modifier]: true }), `${modifier} + ${key} : intacte`).toBe(true);
          expect(seen, `${modifier} + ${key} : remonte`).toHaveBeenCalledTimes(1);
        }
      }
      expect(document.activeElement).toBe(target);
      expect(target.getAttribute('aria-label')).toBe('e2, pion blanc');
    } finally {
      document.removeEventListener('keydown', seen);
    }
  });

  test('Espace agit à l\'enfoncement : son relâchement est arrêté aussi (certains navigateurs en feraient un second clic), celui des autres touches passe', () => {
    const seen = vi.fn();
    document.addEventListener('keyup', seen);
    try {
      render(<ChessBoard {...boardProps()} />);
      const target = square('e2');
      expect(fireEvent.keyUp(target, { key: ' ' })).toBe(false);
      expect(seen).not.toHaveBeenCalled();
      expect(fireEvent.keyUp(target, { key: 'Enter' })).toBe(true);
      expect(fireEvent.keyUp(target, { key: 'a' })).toBe(true);
      expect(seen).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener('keyup', seen);
    }
  });

  test('les flèches sur le plateau ne font pas marcher l\'avatar ; la même touche hors des flèches, si', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      render(<ChessBoard {...boardProps()} />);
      square('e2').focus();
      for (const key of ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown']) {
        await user.keyboard(`{${key}>}`);
        expect(directions.current(), key).toBeNull();
        await user.keyboard(`{/${key}}`);
      }
      // Le plateau ne prend pas les lettres : un D (ZQSD, WASD) fait marcher l'avatar, comme partout ailleurs. Le test éprouve bien ce qu'il dit.
      await user.keyboard('[KeyD>]');
      expect(directions.current()).toBe('right');
      await user.keyboard('[/KeyD]');
    } finally {
      unbind();
    }
  });
});

describe('le dernier coup et l\'échec (§ 13.6)', () => {
  test('le dernier coup teinte ses deux cases, et le dit', () => {
    const { state } = play(startState(), 'e2e4 e7e5 g1f3');
    render(<ChessBoard {...boardProps({ state })} />);
    expect(square('g1').getAttribute('data-last')).toBe('true');
    expect(square('f3').getAttribute('data-last')).toBe('true');
    expect(square('f3').getAttribute('aria-label')).toBe('f3, cavalier blanc, dernier coup');
    expect(square('g1').getAttribute('aria-label')).toBe('g1, vide, dernier coup');
    expect(document.querySelectorAll('[data-last]')).toHaveLength(2);
  });

  test('aucun coup joué : aucune case teintée', () => {
    render(<ChessBoard {...boardProps()} />);
    expect(document.querySelectorAll('[data-last]')).toHaveLength(0);
  });

  test('l\'échec cercle la case du roi, et le dit ; sinon aucune case n\'est cerclée', () => {
    const { state } = play(startState(), SCHOLAR);
    const { unmount } = render(<ChessBoard {...boardProps({ state })} />);
    expect(square('e8').getAttribute('data-check')).toBe('true');
    expect(square('e8').getAttribute('aria-label')).toBe('e8, roi noir, en échec');
    expect(document.querySelectorAll('[data-check]')).toHaveLength(1);
    unmount();
    render(<ChessBoard {...boardProps({ state: play(startState(), 'e2e4').state })} />);
    expect(document.querySelectorAll('[data-check]')).toHaveLength(0);
  });

  test('l\'échec se lit sur la position, pas sur le dernier coup : une position posée à la main, sans coup joué', () => {
    render(<ChessBoard {...boardProps({ state: fromFen('4k3/8/8/8/8/8/8/r3K3 w - - 0 1') })} />);
    expect(square('e1').getAttribute('data-check')).toBe('true');
  });

  test('la sélection, le coup possible et le dernier coup se disent ensemble, dans cet ordre', async () => {
    const user = userEvent.setup();
    const { state } = play(startState(), 'e2e4 d7d5');
    render(<ChessBoard {...boardProps({ state })} />);
    expect(square('d5').getAttribute('aria-label')).toBe('d5, pion noir, dernier coup');
    await user.click(square('e4'));
    expect(square('e4').getAttribute('aria-label')).toBe('e4, pion blanc, sélectionnée');
    expect(square('d5').getAttribute('aria-label')).toBe('d5, pion noir, prise possible, dernier coup');
  });
});

describe('les pièces prises et l\'avance matérielle (§ 13.6)', () => {
  test('en bas ce que j\'ai pris, en haut ce que l\'autre a pris, avec « +3 » pour celui qui mène', () => {
    // Les Noirs ont perdu un fou ; les Blancs un cavalier et une tour : les Noirs mènent de 5.
    render(<ChessBoard {...boardProps({ state: fromFen('rn1qkbnr/pppppppp/8/8/8/8/PPPPPPPP/R1BQKBN1 w KQkq - 0 1') })} />);
    const top = screen.getByRole('group', { name: 'Pièces prises par Bastien' });
    const bottom = screen.getByRole('group', { name: 'Pièces prises par Alice' });
    expect(top.getAttribute('data-side')).toBe('top');
    expect(bottom.getAttribute('data-side')).toBe('bottom');
    expect([...top.querySelectorAll('svg')].map((art) => art.getAttribute('data-type'))).toEqual(['r', 'n']);
    expect([...bottom.querySelectorAll('svg')].map((art) => art.getAttribute('data-type'))).toEqual(['b']);
    expect(within(top).getByText('+5')).toBeTruthy();
    expect(within(bottom).queryByText(/^\+/)).toBeNull();
    // Les pièces prises sont de la couleur de ceux qui les ont perdues.
    expect([...top.querySelectorAll('svg')].map((art) => art.getAttribute('data-color'))).toEqual(['w', 'w']);
    expect([...bottom.querySelectorAll('svg')].map((art) => art.getAttribute('data-color'))).toEqual(['b']);
  });

  test('un lecteur d\'écran lit ce qui a été pris, en mots', () => {
    render(<ChessBoard {...boardProps({ state: fromFen('rn1qkbnr/pppppppp/8/8/8/8/PPPPPPPP/R1BQKBN1 w KQkq - 0 1') })} />);
    expect(screen.getByRole('group', { name: 'Pièces prises par Bastien' }).textContent).toContain('1 tour, 1 cavalier');
    expect(screen.getByRole('group', { name: 'Pièces prises par Bastien' }).textContent).toContain('avance de 5 points');
    expect(screen.getByRole('group', { name: 'Pièces prises par Alice' }).textContent).toContain('1 fou');
  });

  test('au départ, aucune pièce prise, aucune avance', () => {
    render(<ChessBoard {...boardProps()} />);
    for (const group of screen.getAllByRole('group', { name: /Pièces prises par/ })) {
      expect(group.querySelectorAll('svg')).toHaveLength(0);
      expect(within(group).queryByText(/^\+/)).toBeNull();
      expect(group.textContent).toContain('aucune');
    }
  });

  test('retourné, le plateau retourne aussi les bandes : en bas ce que les Noirs ont pris, avec l\'avance de ceux qui mènent', () => {
    render(<ChessBoard {...boardProps({ state: fromFen('rn1qkbnr/pppppppp/8/8/8/8/PPPPPPPP/R1BQKBN1 w KQkq - 0 1'), mySeat: 1 })} />);
    const bottom = screen.getByRole('group', { name: 'Pièces prises par Bastien' });
    const top = screen.getByRole('group', { name: 'Pièces prises par Alice' });
    expect(bottom.getAttribute('data-side')).toBe('bottom');
    expect(top.getAttribute('data-side')).toBe('top');
    expect([...bottom.querySelectorAll('svg')].map((art) => art.getAttribute('data-type'))).toEqual(['r', 'n']);
    expect(within(bottom).getByText('+5')).toBeTruthy();
  });
});

describe('la liste des coups (§ 13.6)', () => {
  test('repliable : un bouton « Coups », la liste numérotée en deux colonnes, en français, le dernier en évidence', async () => {
    const user = userEvent.setup();
    const { state } = play(startState(), 'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1');
    render(<ChessBoard {...boardProps({ state })} />);
    const toggle = screen.getByRole('button', { name: /^Coups/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'Liste des coups' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['1.e4e5', '2.Cf3Cc6', '3.Fb5Cf6', '4.0-0']);
    expect(list.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(list.querySelector('[aria-current="true"]')!.textContent).toBe('0-0');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Liste des coups' })).toBeNull();
    await user.click(toggle);
    expect(screen.getByRole('list', { name: 'Liste des coups' })).toBeTruthy();
  });

  test('numérotée par le compteur du FEN, même quand l\'historique a perdu ses premiers demi-coups (borné à 600)', () => {
    const filler = (index: number) => ({ from: 'a1' as const, to: 'a2' as const, san: `Ra${index}`, piece: 'r' as const });
    const state = { ...fromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 351'), plies: Array.from({ length: 600 }, (_, index) => filler(index)) };
    render(<ChessBoard {...boardProps({ state })} />);
    const rows = within(screen.getByRole('list', { name: 'Liste des coups' })).getAllByRole('listitem');
    expect(rows).toHaveLength(300);
    expect(rows[0]!.textContent).toContain('51.');
    expect(rows.at(-1)!.textContent).toContain('350.');
  });

  test('rien n\'a été joué : pas de liste de coups', () => {
    render(<ChessBoard {...boardProps()} />);
    expect(screen.queryByRole('list', { name: 'Liste des coups' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Coups/ })).toBeNull();
  });

  test('repliée sur téléphone, ouverte ailleurs', () => {
    const { state } = play(startState(), 'e2e4 e7e5');
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('719'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const { unmount } = render(<ChessBoard {...boardProps({ state })} />);
    expect(screen.getByRole('button', { name: /^Coups/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Liste des coups' })).toBeNull();
    unmount();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    render(<ChessBoard {...boardProps({ state })} />);
    expect(screen.getByRole('button', { name: /^Coups/ }).getAttribute('aria-expanded')).toBe('true');
  });
});

describe('le mouvement réduit (§ 9.5.5)', () => {
  const moved = () => play(startState(), 'e2e4');

  test('sans mouvement réduit, la pièce qui vient de jouer glisse de sa case de départ : le décalage est dit en cases', () => {
    const { state, events } = moved();
    render(<ChessBoard {...boardProps({ state, events, reducedMotion: false })} />);
    const sliding = document.querySelectorAll('[data-slide]');
    expect(sliding).toHaveLength(1);
    expect(sliding[0]!.closest('button')!.getAttribute('data-square')).toBe('e4');
    // Elle part deux cases plus bas, à l'écran (les Blancs en bas), dans la même colonne.
    expect((sliding[0] as HTMLElement).style.getPropertyValue('--chess-slide-x')).toBe('0');
    expect((sliding[0] as HTMLElement).style.getPropertyValue('--chess-slide-y')).toBe('2');
  });

  test('avec mouvement réduit : aucun glissement, la pièce est là tout de suite', () => {
    const { state, events } = moved();
    render(<ChessBoard {...boardProps({ state, events, reducedMotion: true })} />);
    expect(document.querySelectorAll('[data-slide]')).toHaveLength(0);
    expect(document.querySelector('.game-chess [style*="slide"]')).toBeNull();
    expect(square('e4').getAttribute('aria-label')).toBe('e4, pion blanc, dernier coup');
  });

  test('un saut d\'état (événements vides : le panneau s\'ouvre, la connexion revient) : l\'état final, sans glisser', () => {
    const { state } = moved();
    render(<ChessBoard {...boardProps({ state, events: [], reducedMotion: false })} />);
    expect(document.querySelectorAll('[data-slide]')).toHaveLength(0);
  });

  test('le roque fait glisser le roi et la tour', () => {
    const start = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const { state, events } = play(start, 'e1g1');
    render(<ChessBoard {...boardProps({ state, events })} />);
    const squares = [...document.querySelectorAll('[data-slide]')].map((element) => element.closest('button')!.getAttribute('data-square')).sort();
    expect(squares).toEqual(['f1', 'g1']);
  });

  test('le décalage est celui de l\'écran : vu des Blancs, un cavalier de g1 à f3 part une case à droite et deux plus bas ; vu des Noirs, une case à gauche et deux plus haut', () => {
    const { state, events } = play(startState(), 'g1f3');
    const { unmount } = render(<ChessBoard {...boardProps({ state, events, mySeat: 0 })} />);
    let sliding = document.querySelector('[data-slide]') as HTMLElement;
    expect(sliding.closest('button')!.getAttribute('data-square')).toBe('f3');
    expect([sliding.style.getPropertyValue('--chess-slide-x'), sliding.style.getPropertyValue('--chess-slide-y')]).toEqual(['1', '2']);
    unmount();
    render(<ChessBoard {...boardProps({ state, events, mySeat: 1 })} />);
    sliding = document.querySelector('[data-slide]') as HTMLElement;
    expect([sliding.style.getPropertyValue('--chess-slide-x'), sliding.style.getPropertyValue('--chess-slide-y')]).toEqual(['-1', '-2']);
  });

  test('aucune minuterie : le plateau ne planifie rien (l\'état final est atteint sans attendre)', () => {
    vi.useFakeTimers();
    try {
      const { state, events } = moved();
      render(<ChessBoard {...boardProps({ state, events, reducedMotion: true })} />);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('la taille : on se mesure sur le conteneur (§ 9.5.1)', () => {
  // Un ResizeObserver qui donne tout de suite la largeur voulue à ce qu'on lui montre.
  function stubWidth(width: number) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
        observe() {
          this.callback([{ contentRect: { width } }]);
        }
        unobserve() {}
        disconnect() {}
      },
    );
  }
  const cellOf = () => (document.querySelector('.game-chess') as HTMLElement).style.getPropertyValue('--chess-cell');
  const pieceSize = () => document.querySelector('svg[data-type="p"]')!.getAttribute('width');

  test('408 px de large : des cases de 51 px, des pièces ×3 (48 px)', () => {
    stubWidth(408);
    render(<ChessBoard {...boardProps()} />);
    expect(cellOf()).toBe('51px');
    expect(pieceSize()).toBe('48');
  });

  test('311 px de large (le téléphone) : des cases de 38 px, des pièces ×2 (32 px)', () => {
    stubWidth(311);
    render(<ChessBoard {...boardProps()} />);
    expect(cellOf()).toBe('38px');
    expect(pieceSize()).toBe('32');
  });

  test('l\'échiquier tient toujours dans la largeur donnée : huit cases entières, jamais de défilement horizontal', () => {
    for (const width of [192, 250, 311, 360, 408, 440, 520]) {
      stubWidth(width);
      const { unmount } = render(<ChessBoard {...boardProps()} />);
      const cell = Number.parseInt(cellOf(), 10);
      expect(cell * 8, `largeur ${width}`).toBeLessThanOrEqual(width);
      expect(cell * 8, `largeur ${width}`).toBeGreaterThan(width - 8);
      unmount();
    }
  });

  test('jamais de case sous 24 px (cible minimale, WCAG 2.5.8), même dans un conteneur étroit', () => {
    stubWidth(100);
    render(<ChessBoard {...boardProps()} />);
    expect(Number.parseInt(cellOf(), 10)).toBe(24);
    expect(pieceSize()).toBe('16');
  });

  test('la mesure suit le conteneur : une nouvelle largeur change la taille des cases', () => {
    let notify: (width: number) => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
          notify = (width) => this.callback([{ contentRect: { width } }]);
        }
        observe() {
          this.callback([{ contentRect: { width: 408 } }]);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    render(<ChessBoard {...boardProps()} />);
    expect(cellOf()).toBe('51px');
    fireEvent.resize(window);
    // Une mesure de la fenêtre n'y change rien ; celle du conteneur, si.
    expect(cellOf()).toBe('51px');
    act(() => notify(311));
    expect(cellOf()).toBe('38px');
  });

  test('sans mesure possible (pas de ResizeObserver), on prend la largeur du panneau : 408 px', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<ChessBoard {...boardProps()} />);
    expect(cellOf()).toBe('51px');
  });
});

describe('les sons, les images, les noms (§ 9.5.4, § 9.5.6, § 9.5.7, § 9.5.11)', () => {
  test('toutes les cases et tous les boutons du plateau portent data-sfx="none" : ni clic, ni son de bascule à chaque sélection (le choix de promotion compris)', async () => {
    const user = userEvent.setup();
    render(<ChessBoard {...boardProps({ state: fromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1') })} />);
    await user.click(square('a7'));
    await user.click(square('a8'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(64);
    for (const button of buttons) expect(button.getAttribute('data-sfx'), button.getAttribute('aria-label') ?? button.textContent ?? '').toBe('none');
  });

  test('les boutons de la liste des coups et des pièces prises sont muets aussi', () => {
    const { state } = play(startState(), 'e2e4 d7d5 e4d5');
    render(<ChessBoard {...boardProps({ state })} />);
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('data-sfx')).toBe('none');
  });

  test('les pièces sont dessinées en code : aucune image, des SVG au trait net, à l\'échelle entière, cachés aux lecteurs d\'écran', () => {
    render(<ChessBoard {...boardProps()} />);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    const arts = document.querySelectorAll('.game-chess-board svg');
    expect(arts).toHaveLength(32);
    for (const art of arts) {
      expect(art.getAttribute('shape-rendering')).toBe('crispEdges');
      expect(art.getAttribute('aria-hidden')).toBe('true');
      expect(art.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(Number.isInteger(Number(art.getAttribute('width')) / 16)).toBe(true);
    }
    expect(document.querySelector('.game-chess')!.innerHTML).not.toMatch(/\.(png|gif|jpg|jpeg|webp|svg|mp3|ogg|wav)/);
  });

  test('tout bouton a un nom accessible', () => {
    render(<ChessBoard {...boardProps({ state: play(startState(), 'e2e4 e7e5').state })} />);
    for (const button of screen.getAllByRole('button')) {
      expect((button.getAttribute('aria-label') ?? button.textContent ?? '').trim(), button.outerHTML).not.toBe('');
    }
  });

  test('aucun style global ni position fixe dans le DOM : le plateau reste dans le panneau qui défile', () => {
    render(<ChessBoard {...boardProps()} />);
    const root = document.querySelector('.game-chess') as HTMLElement;
    expect(root.style.position).not.toBe('fixed');
    for (const element of root.querySelectorAll<HTMLElement>('*')) expect(element.style.position).not.toBe('fixed');
    expect(document.querySelectorAll('style')).toHaveLength(0);
    expect(root.getAttribute('data-orientation')).toBe('w');
  });
});
