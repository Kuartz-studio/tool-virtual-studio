import type { SceneId } from '../audio/catalog';

// Les pochettes des ambiances du juke-box (SoundPopover, MusicPicker), de tous les thèmes : de petits tableaux de 16 × 10 pixels, dessinés ici en
// lettres. Chaque lettre est un pixel, dont la couleur est dans la palette de la pochette. L'interface les affiche agrandies, sans lissage
// (`image-rendering: pixelated`) : le pixel art ne se floute pas. Ce sont des illustrations, pas des jetons : leurs couleurs sont les leurs, jour
// comme nuit. Celles du thème Pirate partagent la mer, le bois des coques et le noir du pavillon.
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

  // ---- Pirate ----

  // Le port endormi : un navire à quai sous la lune, sa lanterne, et leurs reflets dans l'eau calme.
  'silent-harbor': {
    palette: { k: '#16203f', '*': '#cfd6ff', m: '#f2ecc8', p: '#8a93b8', s: '#0b0f1e', l: '#ffcf6b', w: '#1f3a63', r: '#3e6aa0', d: '#5a3b24' },
    rows: [
      'kk*kkkkkkkkkmmkk',
      'kkkkkkkpkkkkmmk*',
      'k*kkkkpppkkkkkkk',
      'kkkkkkppppkkkkkk',
      'kkkkkkpppppk*kkk',
      'kkkslsssssssskkk',
      'wwwwssssssssswww',
      'wwrwwwwwwwwwrwww',
      'ddddwwrwwwwwwwrw',
      'ddddwwwwwrwwwwww',
    ],
  },
  // Le trésor : un coffre plein d'or sur le sable, la croix de la carte à côté.
  'hidden-booty': {
    palette: { s: '#86cfee', w: '#2f8fd6', f: '#e9f7ff', a: '#f2d38c', d: '#d9ae62', b: '#7a4a26', g: '#ffd23f', y: '#fff6c2', x: '#c8312f' },
    rows: [
      'ssssssssssssssss',
      'ssssssssssssssss',
      'wwwwwwwwwwwwwwww',
      'wwfwwwwwfwwwwwfw',
      'aaaaaaaaaaaaaaaa',
      'aaaaagygggaaaaaa',
      'aaaabgggggbaxaxa',
      'aaaabbbbbbbaaxaa',
      'adaabbgbbbbaxaxa',
      'dddddddddddddddd',
    ],
  },
  // La houle du large : deux tentacules sortent de l'eau, de part et d'autre d'un navire.
  'oceans-grasp': {
    palette: { k: '#1d2b4a', t: '#8e3f8f', p: '#e7a1d0', l: '#e8dcc0', s: '#4a2f1e', w: '#1f4f7a', f: '#bfe3f2', v: '#143a5c' },
    rows: [
      'kkkkkkkkkkkkkkkk',
      'kttkkkkklkkkkttk',
      'tkktkkkkllkkktkk',
      'kkktkkkklllkktkk',
      'kkptkkkkllllktpk',
      'kkktkssssssssktk',
      'wwwtwwssssssswtw',
      'wfwtpwwwwwwwwptw',
      'vvvvtvvvfvvvtvvv',
      'vvvvvvvvvvvvvvvv',
    ],
  },
  // La taverne : deux chopes de bière mousseuse sur la table, sous les lampes.
  'drunken-sailors': {
    palette: { b: '#5a3a24', l: '#ffcf6b', f: '#fffaf0', a: '#f0a530', g: '#c9873a', t: '#8a5a34', d: '#3e2716' },
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bbbllbbbbbbbbllb',
      'bbbllbbbbbbbbllb',
      'bbbbbbbbbbbbbbbb',
      'bbffffbbbbffffbb',
      'bbaaaagbbbaaaagb',
      'bbaaaagbbbaaaagb',
      'bbaaaabbbbaaaabb',
      'tttttttttttttttt',
      'dddddddddddddddd',
    ],
  },
  // La marée noire : un navire sombre sous un ciel rouge, le soleil bas, la mer d'encre.
  'blackened-tide': {
    palette: { r: '#3a1c2c', k: '#050507', o: '#8c2f39', s: '#e0574a', b: '#0e0f16', w: '#2a2d3d', f: '#6b7088' },
    rows: [
      'rrrrrrrrrrrrrrrr',
      'rrrrrrrrrkrrrrrr',
      'rrrrrrrrrkkrrrrr',
      'oooooooookkkoooo',
      'oooossoookkkkooo',
      'oooossokkkkkkkko',
      'bbbbbbbbbbbbbbbb',
      'bwwbbbbwwbbbbwwb',
      'bbbfwbbbbbfwbbbb',
      'bbbbbbbbbbbbbbbb',
    ],
  },
  // La poursuite : un petit navire en chasse un grand, voiles pleines, dans le vent.
  'windward-chase': {
    palette: { k: '#7cc8f2', r: '#d94a3d', c: '#e9f7ff', l: '#fbf4e2', s: '#7a4a26', w: '#2f8fd6', f: '#d8f0ff' },
    rows: [
      'kkkkkkkkkkrkkkkk',
      'kcckkkkkkkllkkkk',
      'kkkkkkkkkklllkcc',
      'kkkrkkkkkkllllkk',
      'kcclkkkkkklllllk',
      'kkkllkkkssssssss',
      'wwssssswwsssssww',
      'wfwwwwwwwwwwwfww',
      'wwwwfwwwwwfwwwww',
      'wwwwwwwwwwwwwwww',
    ],
  },
  // Les loups de mer : un loup hurle à la lune, sur la falaise au-dessus des vagues.
  'sea-wolves': {
    palette: { k: '#1b2440', m: '#e8e4cf', n: '#c9c3a6', s: '#0a0d18', w: '#24406a', f: '#8fb3d9' },
    rows: [
      'kkkkkkkkkkkkmmkk',
      'kkkskkkkkkkmmmmk',
      'kkssskkkkkkmmnmk',
      'kkkssskkkkkkmmkk',
      'kkkssssskkkkkkkk',
      'kkssssssskkkkkkk',
      'ksssssssssswwwww',
      'sssssssssswwfwww',
      'ssssssssswwwwwfw',
      'sssssssssswwwwww',
    ],
  },
  // Le pavillon noir : une tête de mort sur ses os croisés, hissée au mât.
  'black-flag-rise': {
    palette: { k: '#4a6fa5', p: '#6b4a2f', b: '#15161c', w: '#f2f0e6', l: '#7fa3d1', g: '#5a3b24' },
    rows: [
      'kkkkkkkkkkkkkkkk',
      'kkkpbbbbbbbbkkkk',
      'kkkpbbbwwwbbbkkk',
      'kkkpbbwbwbwbbkkk',
      'kkkpbbbwwwbbbkkk',
      'kkkpbbwbbbwbbkkk',
      'kkkpbbbbbbbbbkkk',
      'llkpkkkkkllkkkkk',
      'kkkpkkkkkkkkkkll',
      'gggggggggggggggg',
    ],
  },
  // La tempête : un éclair jaune sous les nuages, et les vagues qui se dressent.
  'tempest-call': {
    palette: { c: '#4a5468', k: '#2b3242', y: '#ffe066', f: '#cfe3f0', w: '#2c4d6e', d: '#1a2f45' },
    rows: [
      'cccccckkcccccccc',
      'kcccckkkkccccckk',
      'kkkkkkyykkkkkkkk',
      'kkkkkyykkkkkkkkk',
      'kkkkkkyykkkkkkkk',
      'kkkkkkkykkkkkfkk',
      'kkfkkkkkkkkkfwfk',
      'kfwfkkkkkfkfwwwf',
      'fwwwfwwwfwfwwwww',
      'dddddddddddddddd',
    ],
  },
  // La côte dans la brume : un phare et son faisceau, au-dessus des rochers et de la mer grise.
  'foggy-shores': {
    palette: { g: '#b8c2c9', r: '#c84b3c', h: '#d5dde2', l: '#ffe9a8', w: '#f1efe8', k: '#5c6670', s: '#7d97a8' },
    rows: [
      'ggggggggggggrrgg',
      'hhhhhllllllllllh',
      'ggggggggggggwwgg',
      'hhhhhhhhhhhhrrhh',
      'ggggggggggggwwgg',
      'hhhhhhhhhhhrrrrh',
      'gggggggggggkkkkk',
      'ssssssssskkkkkkk',
      'ssgggsssssssskks',
      'ssssssssgggsssss',
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
