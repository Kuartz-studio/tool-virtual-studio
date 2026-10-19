import type { ZoneInput } from './build-tiled';

// La carte de développement : 24 × 16 cases, le plan de la spec. Légende : `#` mur (bloquant), `.` sol, `T` bureau (bloquant).
// Trois pièces en haut (la salle de réunion au milieu, entre les colonnes 8 et 13), un open space en bas avec trois bureaux.
// Les zones sont en cases : x, y, largeur, hauteur. L'ordre fixe leurs identifiants (1 à 6).
export const DEV_OFFICE: { ascii: string[]; zones: ZoneInput[] } = {
  ascii: [
    '########################',
    '#......#......#........#',
    '#......#......#........#',
    '#......#......#........#',
    '#......#......#........#',
    '###.######.#######.#####',
    '#......................#',
    '#......................#',
    '#......................#',
    '#...TT.....TT.....TT...#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '########################',
  ],
  zones: [
    { type: 'private', name: 'Salle de réunion', x: 8, y: 1, w: 6, h: 4 },
    { type: 'desk', x: 3, y: 10, w: 4, h: 3 },
    { type: 'desk', x: 10, y: 10, w: 4, h: 3 },
    { type: 'desk', x: 17, y: 10, w: 4, h: 3 },
    { type: 'label', text: 'DEV TEAM', x: 9, y: 8, w: 6, h: 1 },
    { type: 'spawn', x: 2, y: 7, w: 1, h: 1 },
  ],
};
