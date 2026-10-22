// Tous les textes des petits chevaux, côté interface : les couleurs, les noms accessibles du plateau, les coups, les annonces du lecteur d'écran, les fins de partie et l'aide
// « Règles ». Ce qui est commun aux quatre jeux (« À toi de jouer », « Abandonner »…) est dans `i18n/fr.ts`, section `games`, que ce fichier ne modifie pas.
import { t } from '../../i18n/fr';

export { t };

export const ludoFr = {
  // Les couleurs, par numéro de couleur : 0 rouge, 1 vert, 2 jaune, 3 bleu. Le nom, pour la pastille d'un joueur ; le mot, dans une phrase.
  colorNames: ['Rouge', 'Vert', 'Jaune', 'Bleu'],
  colorWords: ['rouge', 'vert', 'jaune', 'bleu'],
  // Quelqu'un dont on ne connaît pas le nom (l'aperçu d'avant la partie).
  someone: 'Quelqu\'un',

  board: {
    label: 'Plateau des petits chevaux',
    // L'équivalent texte du plateau, que le lecteur d'écran lit à la place de l'image.
    positionTitle: 'Position des chevaux',
    positionSeat: '{color}, {name} : {horses}.',
    positionSeatMine: '{color}, {name} (toi) : {horses}.',
    positionOut: '{color}, {name} : a quitté la partie.',
    positionJoin: ' ; ',
    horseStable: 'cheval {n} à l\'écurie',
    horseStart: 'cheval {n} sur sa case de départ',
    horseTrack: 'cheval {n} à {steps} cases de son départ',
    horseTrackOne: 'cheval {n} à 1 case de son départ',
    horseLane: 'cheval {n} dans son allée, case {k} sur 5',
    horseHome: 'cheval {n} arrivé',
    // Dans le dessin : l'écurie d'un siège sorti, et le nombre de chevaux arrivés dans le triangle d'une couleur.
    yardOut: 'sorti',
    homeCount: '{count}',
  },

  die: {
    label: 'Dé : {value}',
    empty: 'Dé : pas encore lancé',
    rolling: 'Le dé roule',
    // Les repères, sous le dé : les 6 déjà tirés dans le tour (le troisième est perdu), les essais qu'il reste pour sortir un cheval.
    sixOnce: '1er six',
    sixTwice: '2e six',
    triesFull: '3 essais pour faire un 6',
    triesLeft: 'encore {count} essais',
    triesLast: 'encore 1 essai',
  },

  roll: 'Lancer le dé',

  moves: {
    label: 'Coups possibles',
    exit: 'Sortir un cheval',
    advance: 'Cheval {n} : avancer de {steps}',
    arrive: 'Cheval {n} : arrivée',
    capture: ', prise !',
  },

  // La fin de la partie : la phrase de la ligne d'état, et le classement complet sous le plateau, avec les avancées.
  end: {
    finished: '{name} a ramené ses quatre chevaux.',
    winner: '{name} gagne.',
    standings: 'Classement de la partie',
    standing: '{rank}. {name}, {color} : {detail}',
    score: 'avancée {score} sur {max}',
    gone: 'a quitté la partie',
  },

  // Ce que dit le lecteur d'écran de chaque événement (une phrase par événement, jointes par un espace).
  announce: {
    dice: '{name} lance un {value}.',
    exit: '{name} sort un cheval.',
    advance: '{name} avance le cheval {n} de {steps}.',
    arrive: '{name} amène le cheval {n} à l\'arrivée.',
    capture: '{name} prend un cheval {victim}.',
    noMove: '{name} ne peut pas jouer.',
    again: 'Encore un lancer.',
    thirdSix: 'Troisième 6 : le tour passe.',
    forfeit: {
      resign: '{name} abandonne : ses chevaux quittent le plateau.',
      timeout: '{name} n\'a pas joué depuis 5 minutes : ses chevaux quittent le plateau.',
      disconnect: '{name} a quitté le bureau : ses chevaux quittent le plateau.',
    },
  },

  // L'aide « Règles » du panneau.
  rules: [
    'Chacun a quatre chevaux, qui font le tour du plateau dans le sens des aiguilles d\'une montre.',
    'Un 6 fait sortir un cheval de l\'écurie, sur ta case de départ, et fait rejouer. Sans cheval en jeu, tu as trois essais pour faire un 6.',
    'À chaque lancer, tu avances un seul cheval, du nombre de points. Si aucun ne peut jouer, tu passes.',
    'Un cheval qui s\'arrête sur un cheval adverse le renvoie à l\'écurie. Aucune case n\'est protégée.',
    'Tu ne peux pas finir sur l\'un de tes chevaux, mais tu peux passer par-dessus tous les chevaux.',
    'Trois 6 de suite : le troisième ne compte pas, et le tour passe.',
    'Pour arriver au centre, il faut le nombre exact.',
    'La partie s\'arrête quand un joueur a ramené ses quatre chevaux : les autres sont classés à leur avancée.',
  ],
} as const;
