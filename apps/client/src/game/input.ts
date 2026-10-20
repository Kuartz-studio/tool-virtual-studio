import type { Direction } from '@bureau/shared';

// Les touches de déplacement, par leur position sur le clavier (KeyboardEvent.code) et non par la lettre qu'elles portent : ZQSD
// sur un clavier AZERTY est au même endroit que WASD sur un QWERTY, et envoie les mêmes codes (KeyW, KeyA, KeyS, KeyD). Les
// flèches ne changent pas d'un clavier à l'autre.
const KEY_DIRECTIONS: ReadonlyMap<string, Direction> = new Map<string, Direction>([
  ['ArrowUp', 'up'],
  ['KeyW', 'up'],
  ['ArrowDown', 'down'],
  ['KeyS', 'down'],
  ['ArrowLeft', 'left'],
  ['KeyA', 'left'],
  ['ArrowRight', 'right'],
  ['KeyD', 'right'],
]);

// La direction que le joueur demande : celle de la dernière touche de déplacement enfoncée qui l'est encore. Sans touche, rien.
// Deux touches peuvent aller dans la même direction (ArrowUp et KeyW) : on retient les touches, pas les directions, pour qu'en
// lâcher une ne coupe pas l'autre.
export class DirectionInput {
  // Les touches de déplacement enfoncées, de la plus ancienne à la plus récente.
  private held: string[] = [];

  press(code: string): void {
    // Une touche maintenue enfoncée se répète : elle ne reprend pas la main sur une touche enfoncée après elle.
    if (!KEY_DIRECTIONS.has(code) || this.held.includes(code)) return;
    this.held.push(code);
  }

  release(code: string): void {
    this.held = this.held.filter((held) => held !== code);
  }

  // Plus aucune touche enfoncée.
  clear(): void {
    this.held = [];
  }

  current(): Direction | null {
    const last = this.held.at(-1);
    return last === undefined ? null : (KEY_DIRECTIONS.get(last) ?? null);
  }
}

// Ce qu'on tape dans un champ (le chat, bientôt) n'est pas pour l'avatar. Un champ de saisie est :
// - un <textarea>, ou un élément modifiable (`contenteditable="false"` n'en est pas un ; `contenteditable=""` et
//   `contenteditable="plaintext-only"` en sont) ;
// - un <select> : les flèches y changent l'option, et les lettres y cherchent une option ;
// - un <input> où l'on écrit : text, search, email, password, number, date… (tout type que le navigateur ne connaît pas vaut « text »).
//   Pas ceux qu'on clique seulement (case à cocher, bouton radio, bouton, curseur, couleur, fichier) : après un clic sur l'un d'eux,
//   il garde le focus, et l'avatar ne doit pas rester figé jusqu'à un clic ailleurs.
const EDITABLE = '[contenteditable]:not([contenteditable="false"])';
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

function isTypingField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // Une case à cocher dans un texte modifiable : on est dans le texte.
  if (target.closest(EDITABLE)) return true;
  const field = target.closest('input, textarea, select');
  // `type` est le type que le navigateur retient : en minuscules, « text » s'il est absent ou inconnu.
  if (field instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(field.type);
  return field !== null;
}

// Branche le clavier de la page sur `input`. Renvoie la fonction qui le débranche.
//
// - La touche enfoncée est reconnue à sa position (`event.code`), pas à la lettre.
// - Quand le focus est dans un champ de saisie, les touches sont ignorées et celles qui étaient enfoncées sont relâchées : un
//   relâchement qui arriverait dans le champ ne serait pas pour nous, et l'avatar continuerait de marcher.
// - Un raccourci du navigateur (Ctrl, Alt ou ⌘ enfoncé) n'est pas un déplacement. Sur macOS, la page ne reçoit pas le
//   relâchement d'une touche pressée sous ⌘ : on arrête l'avatar plutôt que de le laisser filer.
// - Quand la fenêtre perd le focus (changement d'application ou d'onglet), la page ne recevra pas les relâchements : tout est
//   relâché, sinon une touche resterait « enfoncée ».
export function bindKeyboard(input: DirectionInput): () => void {
  const typing = (event: KeyboardEvent) => isTypingField(event.target) || isTypingField(document.activeElement);

  const onKeyDown = (event: KeyboardEvent) => {
    if (typing(event) || event.ctrlKey || event.altKey || event.metaKey) {
      input.clear();
      return;
    }
    // Un autre écouteur a déjà pris cette touche (un menu qui en fait sa navigation, par exemple).
    if (event.defaultPrevented) return;
    input.press(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (typing(event)) {
      input.clear();
      return;
    }
    // Toujours : même sous un modificateur, une touche relâchée n'est plus enfoncée.
    input.release(event.code);
  };
  const onBlur = () => input.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
