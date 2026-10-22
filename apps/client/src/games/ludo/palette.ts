// Les couleurs des quatre chevaux de chaque couleur (0 rouge, 1 vert, 2 jaune, 3 bleu), celles de l'illustration : elles ne changent ni le jour ni la nuit, le cadre autour suit les
// jetons. `ludo.css` les redit en variables locales (`--ludo-red`…) pour dessiner le plateau : un test vérifie que les deux listes sont les mêmes.
export const SEAT_COLORS = ['#d9453f', '#3d9f5c', '#efb52a', '#3b78d8'] as const;

// La couleur neutre d'une pastille sans siège (un siège qui n'existe pas) : un jeton du cadre, pas une couleur de l'illustration.
export const NEUTRAL_COLOR = 'var(--border-strong)';
