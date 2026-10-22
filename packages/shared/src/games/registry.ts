// Le registre des jeux : une ligne par jeu (`export { chess } from './chess';`). `GAMES` (index.ts) est construit sur ses exports : un jeu qui n'y figure pas n'existe pas pour la
// plateforme, et sa table reste fermée (« Bientôt disponible »). Un nouveau jeu s'ajoute ici, avec son dossier `games/<jeu>/` et son interface `apps/client/src/games/<jeu>/`.
export { backgammon } from './backgammon';
export { chess } from './chess';
export { connect4 } from './connect4';
export { ludo } from './ludo';
