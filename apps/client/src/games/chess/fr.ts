import type { PieceType } from '@bureau/shared/games/chess';
import { t } from '../../i18n/fr';

// Tous les textes des échecs, côté client (§ 12.3 du document des jeux) : le plateau, ses cases, les pièces, la promotion, les pièces prises, la liste des coups, la fin de partie, les
// annonces du lecteur d'écran, l'aide. Ce qui est commun aux quatre jeux (boutons, onglets, lignes d'état) est dans `i18n/fr.ts`, section `games`, que ce fichier ne modifie pas : il en
// reprend `t` pour remplir les trous (« {name} »).

export type PieceColor = 'w' | 'b';

const PIECES: Record<PieceType, { name: string; plural: string; feminine: boolean }> = {
  p: { name: 'pion', plural: 'pions', feminine: false },
  n: { name: 'cavalier', plural: 'cavaliers', feminine: false },
  b: { name: 'fou', plural: 'fous', feminine: false },
  r: { name: 'tour', plural: 'tours', feminine: true },
  q: { name: 'dame', plural: 'dames', feminine: true },
  k: { name: 'roi', plural: 'rois', feminine: false },
};

// La couleur accordée avec la pièce : « roi blanc », « tour blanche », « dame noire ».
const COLORS: Record<PieceColor, { masculine: string; feminine: string }> = {
  w: { masculine: 'blanc', feminine: 'blanche' },
  b: { masculine: 'noir', feminine: 'noire' },
};

export const chessFr = {
  // Le nom de la grille, lu par les lecteurs d'écran.
  board: 'Échiquier',
  // Le contenu d'une case sans pièce.
  empty: 'vide',
  // Ce qu'une case ajoute à son nom quand elle est dans cet état (§ 9.5.4 : la couleur n'est jamais seule à le dire).
  states: { selected: 'sélectionnée', move: 'coup possible', capture: 'prise possible', last: 'dernier coup', check: 'en échec' },
  // « pion », « tour » (sans couleur), et « pion blanc », « tour blanche ».
  pieceName: (type: PieceType): string => PIECES[type].name,
  piece: (type: PieceType, color: PieceColor): string => `${PIECES[type].name} ${PIECES[type].feminine ? COLORS[color].feminine : COLORS[color].masculine}`,
  // Le nom d'une case, puis son contenu et ses états : « e4, pion blanc, coup possible ».
  square: (name: string, content: string, states: string[]): string => [name, content, ...states].join(', '),

  // La ligne d'un joueur : le nom et la couleur de son siège (la pastille est celle de l'illustration, jour comme nuit).
  seats: { w: { name: 'Blancs', color: '#f2ead8' }, b: { name: 'Noirs', color: '#2b2d38' } },

  // Le choix d'une pièce quand un pion arrive au bout.
  promotion: {
    title: 'Promotion : choisis une pièce',
    options: { q: 'Dame', r: 'Tour', b: 'Fou', n: 'Cavalier' },
  },

  // Les pièces prises, au-dessus et au-dessous du plateau, et l'avance de points.
  captured: {
    label: (name: string): string => t('Pièces prises par {name}', { name }),
    none: 'aucune',
    // « 1 tour, 1 cavalier » : chaque sorte avec son nombre, de la plus forte à la plus faible.
    list: (counts: ReadonlyArray<{ type: PieceType; count: number }>): string => counts.map(({ type, count }) => `${count} ${count > 1 ? PIECES[type].plural : PIECES[type].name}`).join(', '),
    advantage: (points: number): string => (points === 1 ? 'avance de 1 point' : t('avance de {points} points', { points })),
    // L'avance telle qu'on la lit à côté des pièces : « +3 ».
    plus: (points: number): string => `+${points}`,
  },

  // La liste des coups, sous le plateau.
  moves: {
    toggle: 'Coups',
    list: 'Liste des coups',
  },

  // La fin d'une partie, pour les raisons que le jeu écrit (celles de la plateforme sont dans `fr.games.end`).
  end: {
    checkmate: 'Échec et mat : {name} gagne.',
    stalemate: 'Pat : nulle.',
    insufficient: 'Matériel insuffisant : nulle.',
    threefold: 'Triple répétition : nulle.',
    fifty: 'Règle des 50 coups : nulle.',
    // Une raison que ce fichier ne connaît pas : la phrase neutre.
    winner: '{name} gagne.',
    draw: 'Partie nulle.',
  },

  // Ce que le lecteur d'écran entend d'un coup : « Alice : cavalier en f3. », « Bastien : pion e5 prend d6 en passant, échec. », « Alice : petit roque. ».
  announce: {
    sentence: '{name} : {text}.',
    quiet: '{piece} en {to}',
    capture: '{piece} {from} prend {to}',
    enPassant: 'en passant',
    castleShort: 'petit roque',
    castleLong: 'grand roque',
    promotion: 'promotion en {piece} en {to}',
    promotionCapture: 'pion {from} prend {to}, promotion en {piece}',
    check: 'échec',
    mate: 'échec et mat',
  },

  // L'aide du panneau : de quatre à huit phrases courtes.
  rules: [
    'Chaque camp a seize pièces ; les Blancs commencent, puis on joue chacun son tour.',
    'Clique une de tes pièces : les cases où elle peut aller s\'allument ; clique l\'une d\'elles pour jouer.',
    'Le roque se joue en amenant le roi de deux cases vers la tour.',
    'Le but est de faire échec et mat : le roi adverse est attaqué et ne peut plus s\'en sortir.',
    'La promotion : un pion qui arrive au bout de l\'échiquier devient une dame, une tour, un fou ou un cavalier, au choix.',
    'La partie est nulle toute seule en cas de pat, de matériel insuffisant, de trois fois la même position ou de cinquante coups sans pion ni prise.',
    'Tu peux proposer la nulle après un coup de chaque camp ; il n\'y a pas de pendule, mais cinq minutes sans jouer font perdre la partie.',
    'Au clavier : les flèches parcourent l\'échiquier, Entrée choisit une pièce puis une case, Échap annule.',
  ],
} as const;
