import type { SceneId } from '../audio/catalog';

// Les pochettes des six ambiances du juke-box (SoundPopover) : de petits tableaux de 16 × 10 pixels, dessinés ici en lettres. Chaque lettre est
// un pixel, dont la couleur est dans la palette de la pochette. L'interface les affiche ×5, sans lissage (`image-rendering: pixelated`) : le
// pixel art ne se floute pas. Ce sont des illustrations, pas des jetons : leurs couleurs sont les leurs, jour comme nuit.
export const COVER_WIDTH = 16;
export const COVER_HEIGHT = 10;

export interface Cover {
  // La couleur (#rrggbb) de chaque lettre des lignes.
  palette: Record<string, string>;
  // COVER_HEIGHT lignes de COVER_WIDTH lettres.
  rows: string[];
}

export const COVERS: Record<SceneId, Cover> = {
  // La salle d'attente : une ville la nuit, ses fenêtres allumées sur une rue.
  lobby: {
    palette: { k: '#141a3a', s: '#23295a', '*': '#e8e6ff', b: '#0b0f24', w: '#ffd27a', r: '#2b2f45', l: '#8a7a4a' },
    rows: [
      'kkk*kkkkkkkkk*kk',
      'kkkkkkkk*kkkkkkk',
      'ssssbbbsssssssss',
      'ssssbwbsssbbbbss',
      'bbbsbbbsssbwbwss',
      'bwbsbwbsbbbbwbss',
      'bbbsbbbsbwbwbbbb',
      'bwbbbwbbbbbbwbwb',
      'rrrrrrrrrrrrrrrr',
      'rrllrrrllrrrllrr',
    ],
  },
  // La concentration : un récif, ses poissons et ses algues sur le sable.
  focus: {
    palette: { c: '#2f8f9a', r: '#5fb8b8', o: '#bfeff0', b: '#1b6b7a', f: '#ffb347', a: '#0f4c5c', g: '#3fbf7f', p: '#ff7a8a', s: '#e7d3a1' },
    rows: [
      'ccrccccccrcccccc',
      'cccrcccccrccccoc',
      'bbbbrbbbbbrbbbbb',
      'bbobbrbbbbbrbbbb',
      'bbbbbbbbbfffbbbb',
      'aaoaaaaaaaaaaaaa',
      'agaaaaaaaaaaapaa',
      'agagaaapaaaapppa',
      'sgsgsspppssspppg',
      'ssssssssssssssss',
    ],
  },
  // Le soleil : une plage, la mer, un parasol et une serviette.
  sunny: {
    palette: { k: '#7cc8f2', o: '#ffb02e', u: '#ffd84a', l: '#b6e3fb', w: '#2f8fd6', f: '#e9f7ff', s: '#f2d38c', r: '#ff5a5a', x: '#fff3e0', p: '#8a5a3c', d: '#e0b96a' },
    rows: [
      'kkkkkkkkkkkouokk',
      'kkkkkkkkkkouuuok',
      'lllllllllllouoll',
      'llllllllllllllll',
      'wwwwwwwwwwwwwwww',
      'wwfwwwwwwfwwwwfw',
      'ssrxrxrsssssssss',
      'sssspssssssddsss',
      'sssspsssssssssss',
      'dddddddddddddddd',
    ],
  },
  // Le crépuscule : un château, ses fenêtres allumées sous un ciel qui tourne au violet.
  dusk: {
    palette: { v: '#3b2a5c', n: '#f3ecd2', m: '#6b3a6e', c: '#1a1426', o: '#e0784a', y: '#f5b85a', w: '#ffcf6b' },
    rows: [
      'vvvvvvvvvvvvnnvv',
      'vvvvvvvvvvvvnnvv',
      'mmmmmmmmmmmmmmmm',
      'mmcmcmmmmmmmmmmm',
      'oocccooooooccooo',
      'yycwcyyyyyyccyyy',
      'cccccccccccccccc',
      'ccccwcccccccwccc',
      'cccccccccccccccc',
      'cccccccccccccccc',
    ],
  },
  // La dérive : l'espace, ses étoiles, une nébuleuse et une planète.
  drift: {
    palette: { d: '#170f2e', '*': '#f0e9ff', n: '#4a2a7a', p: '#b06ad9', q: '#7d3fb0', r: '#ffd27a', e: '#2c1b54' },
    rows: [
      'dd*dddddddd*dddd',
      'dddddnnddddddd*d',
      'd*ddnnddddppdddd',
      'ddddnnnddpppqd*d',
      'deeeeeerrpppqrre',
      'eeeeeeeeepqqqeee',
      'e*eeeeeeeeqqeeee',
      'eeeeennneeeeeeee',
      'eeee*eeeeeeee*ee',
      'eeeeeeeeeeeeeeee',
    ],
  },
  // L'expédition : une oasis au soir, ses palmiers et sa mare dans les dunes.
  quest: {
    palette: { o: '#f08a4b', y: '#f6c26b', g: '#2f8f5b', u: '#fff0b3', t: '#6b4a2f', d: '#d9a25c', w: '#4fb3c8', e: '#b97f3d' },
    rows: [
      'oooooooooooooooo',
      'oooooooooooooooo',
      'yyyyyyyyyyyyyyyy',
      'yyygggyyyyuuuyyy',
      'yyggtggyyuuuuuyy',
      'ddddtddddddddddd',
      'ddwwtwwdddeeeddd',
      'ddeeddddddeeeeed',
      'eeeedddddeeeeeee',
      'dddeeeeeeedddddd',
    ],
  },
};

// Dessine la pochette de cette ambiance sur ce canevas : 16 × 10 pixels, un par lettre. Sans contexte 2D (un navigateur qui n'en donne pas), le
// canevas reste vide : la carte garde son titre.
export function drawCover(canvas: HTMLCanvasElement, id: SceneId): void {
  canvas.width = COVER_WIDTH;
  canvas.height = COVER_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return;
  const { palette, rows } = COVERS[id];
  rows.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      context.fillStyle = palette[letter] ?? 'transparent';
      context.fillRect(x, y, 1, 1);
    });
  });
}
