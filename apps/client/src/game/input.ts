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

// Ce qu'on tape dans un champ (le chat, bientôt) n'est pas pour l'avatar. `select` en fait partie : les flèches y changent l'option.
// `contenteditable="false"` n'est pas un champ ; `contenteditable=""` et `contenteditable="plaintext-only"` en sont.
const TYPING_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function isTypingField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_FIELD) !== null;
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
