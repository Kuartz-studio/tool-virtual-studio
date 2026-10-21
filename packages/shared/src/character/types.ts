// Le personnage : ce que le builder assemble. Les images viennent du Character Generator de LimeZu, rangées par famille par
// apps/client/scripts/assets (`pnpm gen:assets`) ; la liste de ce qui existe (nombres de familles et de variantes) est générée.

// Une famille de pièces : son numéro (celui du dossier source, à partir de 1), le nombre de variantes (couleurs), et son nom s'il en a un.
export interface CharacterFamily {
  number: number;
  variants: number;
  label?: string;
  // Le numéro de l'imagette de la première variante dans characters/thumbs.png (les suivantes se suivent).
  thumb: number;
}

export interface CharacterParts {
  bodies: number;
  eyes: number;
  premade: number;
  // Les imagettes du builder, en grille de `columns` colonnes de 32 × 64 px : le numéro de la première imagette des corps, des yeux et des
  // personnages prêts (une par corps, par paire d'yeux, par personnage).
  thumbs: { columns: number; bodies: number; eyes: number; premade: number };
  outfits: CharacterFamily[];
  hair: CharacterFamily[];
  accessories: CharacterFamily[];
}

// La planche d'un personnage : 24 images de 32 × 64 px par ligne, 6 pour chacune des 4 directions (dans l'ordre de CHARACTER_SHEET.directions),
// l'immobile sur la première ligne et la marche sur la seconde. Les pieds sont au bas de l'image ; la tête commence à `headTop`.
export const CHARACTER_SHEET = {
  frameWidth: 32,
  frameHeight: 64,
  columns: 24,
  rows: 2,
  framesPerDirection: 6,
  directions: ['right', 'up', 'left', 'down'],
  headTop: 20,
  idleFrameRate: 5,
  walkFrameRate: 10,
} as const;
