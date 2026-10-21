import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { bindKeyboard, bindZoomKeys, DirectionInput } from './input';

describe('DirectionInput', () => {
  test('la dernière touche enfoncée gagne', () => {
    const i = new DirectionInput();
    i.press('ArrowRight'); i.press('KeyW'); expect(i.current()).toBe('up');
    i.release('KeyW'); expect(i.current()).toBe('right');
    i.release('ArrowRight'); expect(i.current()).toBeNull();
  });

  test('touches inconnues ignorées', () => { const i = new DirectionInput(); i.press('KeyP'); expect(i.current()).toBeNull(); });

  test.each([
    ['ArrowUp', 'up'],
    ['KeyW', 'up'],
    ['ArrowDown', 'down'],
    ['KeyS', 'down'],
    ['ArrowLeft', 'left'],
    ['KeyA', 'left'],
    ['ArrowRight', 'right'],
    ['KeyD', 'right'],
  ] as const)('%s va vers %s', (code, direction) => {
    const i = new DirectionInput();
    i.press(code);
    expect(i.current()).toBe(direction);
  });

  test('ce sont des positions du clavier : sur un AZERTY, W et A (lettres) sont aux positions KeyZ et KeyQ, qui ne déplacent pas', () => {
    const i = new DirectionInput();
    i.press('KeyZ');
    i.press('KeyQ');
    expect(i.current()).toBeNull();
  });

  test('deux touches pour une même direction : elle reste tant que l\'une des deux est enfoncée', () => {
    const i = new DirectionInput();
    i.press('ArrowUp'); i.press('KeyW'); i.release('KeyW');
    expect(i.current()).toBe('up');
    i.release('ArrowUp');
    expect(i.current()).toBeNull();
  });

  test('une touche maintenue, dont le clavier répète l\'appui, ne reprend pas la main', () => {
    const i = new DirectionInput();
    i.press('ArrowRight'); i.press('KeyW');
    i.press('ArrowRight');
    expect(i.current()).toBe('up');
    i.release('KeyW');
    expect(i.current()).toBe('right');
  });

  test('deux directions opposées : la dernière gagne, et l\'autre reprend quand on la relâche', () => {
    const i = new DirectionInput();
    i.press('ArrowLeft'); i.press('ArrowRight');
    expect(i.current()).toBe('right');
    i.release('ArrowRight');
    expect(i.current()).toBe('left');
  });

  test('relâcher une touche qui n\'était pas enfoncée ne change rien', () => {
    const i = new DirectionInput();
    i.press('KeyD');
    i.release('KeyA'); i.release('KeyP');
    expect(i.current()).toBe('right');
  });

  test('clear() relâche tout', () => {
    const i = new DirectionInput();
    i.press('KeyD'); i.press('KeyW');
    i.clear();
    expect(i.current()).toBeNull();
    // Et la suite repart de zéro.
    i.press('KeyS');
    expect(i.current()).toBe('down');
  });

  test('Maj : on court tant qu\'elle est enfoncée, et clear() la relâche', () => {
    const i = new DirectionInput();
    expect(i.sprinting()).toBe(false);
    i.setSprint(true);
    expect(i.sprinting()).toBe(true);
    i.clear();
    expect(i.sprinting()).toBe(false);
  });

  test('les noms que tout objet JavaScript hérite ne sont pas des touches', () => {
    const i = new DirectionInput();
    i.press('constructor'); i.press('toString'); i.press('__proto__');
    expect(i.current()).toBeNull();
  });
});

describe('bindKeyboard', () => {
  let input: DirectionInput;
  let unbind: () => void;

  // Une touche, au clavier de la page : l'événement part de `target` (l'élément qui a le focus) et remonte jusqu'à la fenêtre.
  const fire = (target: EventTarget, type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init }));
  const field = (tag: string, attributes: Record<string, string> = {}): HTMLElement => {
    const element = document.body.appendChild(document.createElement(tag));
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.focus();
    return element;
  };

  beforeEach(() => {
    input = new DirectionInput();
    unbind = bindKeyboard(input);
  });
  afterEach(() => {
    unbind();
    document.body.replaceChildren();
  });

  test('appuyer sur une touche de déplacement, puis la relâcher', () => {
    fire(window, 'keydown', 'ArrowLeft');
    expect(input.current()).toBe('left');
    fire(window, 'keyup', 'ArrowLeft');
    expect(input.current()).toBeNull();
  });

  test('la touche compte par sa position (code), pas par la lettre qu\'elle porte', () => {
    // Le Z d'un clavier AZERTY est à la position de KeyW.
    fire(window, 'keydown', 'KeyW', { key: 'z' });
    expect(input.current()).toBe('up');
    fire(window, 'keyup', 'KeyW', { key: 'z' });
    // Le W d'un clavier AZERTY est à la position de KeyZ : il ne déplace pas.
    fire(window, 'keydown', 'KeyZ', { key: 'w' });
    expect(input.current()).toBeNull();
  });

  test('Maj enfoncée : on court, sans changer de direction ; relâchée, on remarche', () => {
    fire(window, 'keydown', 'ArrowRight');
    expect(input.sprinting()).toBe(false);
    fire(window, 'keydown', 'ShiftLeft', { shiftKey: true });
    expect(input.sprinting()).toBe(true);
    expect(input.current()).toBe('right');
    // Une autre touche enfoncée pendant la course : Maj est toujours là.
    fire(window, 'keydown', 'KeyW', { shiftKey: true });
    expect(input.sprinting()).toBe(true);
    expect(input.current()).toBe('up');
    fire(window, 'keyup', 'ShiftRight', { shiftKey: false });
    expect(input.sprinting()).toBe(false);
    expect(input.current()).toBe('up');
  });

  test('Maj déjà enfoncée quand on appuie sur une direction : on court d\'emblée', () => {
    fire(window, 'keydown', 'KeyD', { shiftKey: true });
    expect(input.sprinting()).toBe(true);
  });

  test('le focus dans un champ ou la perte du focus de la fenêtre arrête la course', () => {
    fire(window, 'keydown', 'KeyD', { shiftKey: true });
    window.dispatchEvent(new Event('blur'));
    expect(input.sprinting()).toBe(false);
    fire(window, 'keydown', 'KeyD', { shiftKey: true });
    fire(field('input'), 'keydown', 'KeyA', { shiftKey: true });
    expect(input.sprinting()).toBe(false);
    expect(input.current()).toBeNull();
  });

  test('la répétition automatique d\'une touche maintenue ne change rien', () => {
    fire(window, 'keydown', 'ArrowRight');
    fire(window, 'keydown', 'KeyW');
    fire(window, 'keydown', 'ArrowRight', { repeat: true });
    expect(input.current()).toBe('up');
  });

  test.each(['input', 'textarea', 'select'])('le focus dans un <%s> : les touches sont ignorées, et celles qui étaient enfoncées sont relâchées', (tag) => {
    fire(window, 'keydown', 'KeyD');
    expect(input.current()).toBe('right');

    const typing = field(tag);
    fire(typing, 'keydown', 'KeyA');
    expect(input.current()).toBeNull();
    fire(typing, 'keyup', 'KeyA');
    fire(typing, 'keydown', 'ArrowUp');
    expect(input.current()).toBeNull();
  });

  test('le focus dans un élément contenteditable : de même', () => {
    fire(window, 'keydown', 'KeyD');
    const editable = field('div', { contenteditable: 'true' });
    fire(editable, 'keydown', 'KeyS');
    expect(input.current()).toBeNull();
    // Y compris l'attribut sans valeur, qui veut dire « true ».
    const empty = field('div', { contenteditable: '' });
    fire(empty, 'keydown', 'KeyS');
    expect(input.current()).toBeNull();
  });

  test('un contenteditable="false" n\'est pas un champ de saisie', () => {
    const notEditable = field('div', { contenteditable: 'false' });
    fire(notEditable, 'keydown', 'KeyS');
    expect(input.current()).toBe('down');
  });

  // Seuls les champs où l'on écrit prennent les touches. Une case à cocher, un bouton ou un curseur qui a le focus (après un clic, par
  // exemple) ne doit pas figer l'avatar : le joueur retrouve ses touches sans devoir cliquer ailleurs.
  test.each(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'range', 'color', 'file'])(
    'le focus dans un <input type="%s"> : ce n\'est pas un champ de saisie, l\'avatar se déplace',
    (type) => {
      const control = field('input', { type });
      fire(control, 'keydown', 'KeyD');
      expect(input.current()).toBe('right');
      fire(control, 'keyup', 'KeyD');
      expect(input.current()).toBeNull();
      fire(control, 'keydown', 'ArrowUp');
      expect(input.current()).toBe('up');
    },
  );

  test.each([undefined, 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'])(
    'le focus dans un <input type="%s"> : un champ de saisie, les touches sont ignorées',
    (type) => {
      fire(window, 'keydown', 'KeyD');
      const typing = field('input', type === undefined ? {} : { type });
      fire(typing, 'keydown', 'KeyA');
      expect(input.current()).toBeNull();
    },
  );

  test.each(['foo', '', ' checkbox'])('un type inconnu (« %s ») vaut « text », comme dans le navigateur : un champ de saisie', (type) => {
    const typing = field('input', { type });
    fire(typing, 'keydown', 'KeyA');
    expect(input.current()).toBeNull();
  });

  test('le type s\'écrit comme on veut : CHECKBOX est une case à cocher', () => {
    const control = field('input', { type: 'CHECKBOX' });
    fire(control, 'keydown', 'KeyS');
    expect(input.current()).toBe('down');
  });

  test('un bouton (<button>) qui a le focus n\'est pas un champ de saisie non plus', () => {
    const button = field('button');
    fire(button, 'keydown', 'KeyW');
    expect(input.current()).toBe('up');
  });

  test('une case à cocher dans un texte modifiable : on y écrit, les touches sont ignorées', () => {
    const editable = field('div', { contenteditable: 'true' });
    const checkbox = editable.appendChild(document.createElement('input'));
    checkbox.setAttribute('type', 'checkbox');
    checkbox.focus();
    fire(checkbox, 'keydown', 'KeyD');
    expect(input.current()).toBeNull();
  });

  test('le focus, et non seulement la cible de l\'événement : un champ qui a le focus ignore une touche envoyée à la fenêtre', () => {
    fire(window, 'keydown', 'KeyD');
    field('input');
    fire(window, 'keydown', 'KeyW');
    expect(input.current()).toBeNull();
  });

  test('quand le focus quitte le champ, le clavier marche de nouveau', () => {
    const typing = field('input');
    fire(typing, 'keydown', 'KeyA');
    expect(input.current()).toBeNull();
    typing.blur();
    fire(document.body, 'keydown', 'KeyA');
    expect(input.current()).toBe('left');
  });

  test('la fenêtre perd le focus : plus aucune touche n\'est enfoncée (un relâchement ne lui parviendrait pas)', () => {
    fire(window, 'keydown', 'KeyD');
    fire(window, 'keydown', 'KeyW');
    window.dispatchEvent(new Event('blur'));
    expect(input.current()).toBeNull();
    // Et le clavier marche encore au retour.
    fire(window, 'keydown', 'KeyS');
    expect(input.current()).toBe('down');
  });

  test.each(['ctrlKey', 'metaKey', 'altKey'] as const)('%s : un raccourci du navigateur ne déplace pas, et arrête l\'avatar', (modifier) => {
    fire(window, 'keydown', 'KeyD');
    fire(window, 'keydown', 'KeyS', { [modifier]: true });
    expect(input.current()).toBeNull();
    fire(window, 'keydown', 'ArrowLeft', { [modifier]: true });
    expect(input.current()).toBeNull();
  });

  test('Maj ne gêne pas', () => {
    fire(window, 'keydown', 'KeyD', { shiftKey: true });
    expect(input.current()).toBe('right');
  });

  test('une touche relâchée l\'est toujours, même avec un modificateur enfoncé', () => {
    fire(window, 'keydown', 'KeyD');
    fire(window, 'keyup', 'KeyD', { metaKey: true });
    expect(input.current()).toBeNull();
  });

  test('un appui déjà traité par un autre (preventDefault) n\'est pas pour l\'avatar', () => {
    const taken = (event: Event) => event.preventDefault();
    document.addEventListener('keydown', taken);
    try {
      fire(document.body, 'keydown', 'ArrowDown');
    } finally {
      document.removeEventListener('keydown', taken);
    }
    expect(input.current()).toBeNull();
  });

  test('le débranchement retire tous les écouteurs', () => {
    fire(window, 'keydown', 'KeyD');
    unbind();
    fire(window, 'keyup', 'KeyD');
    expect(input.current()).toBe('right');
    fire(window, 'keydown', 'KeyW');
    expect(input.current()).toBe('right');
    window.dispatchEvent(new Event('blur'));
    expect(input.current()).toBe('right');
  });
});

describe('bindZoomKeys', () => {
  let steps: Array<1 | -1 | 0>;
  let unbind: () => void;
  const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

  beforeEach(() => {
    steps = [];
    unbind = bindZoomKeys((step) => steps.push(step));
  });
  afterEach(() => {
    unbind();
    document.body.replaceChildren();
  });

  test('+ et = rapprochent, - éloigne, 0 rétablit : le caractère compte, pas la position (AZERTY comme QWERTY)', () => {
    press('+', { code: 'Equal', shiftKey: true });
    press('=', { code: 'Equal' });
    press('-', { code: 'Digit6' });
    press('-', { code: 'Minus' });
    press('0', { code: 'Digit0' });
    expect(steps).toEqual([1, 1, -1, -1, 0]);
  });

  test('un « 6 » d\'un QWERTY n\'éloigne pas, une autre touche ne fait rien', () => {
    press('6', { code: 'Digit6' });
    press('a', { code: 'KeyA' });
    expect(steps).toEqual([]);
  });

  test('Ctrl, ⌘ et Alt sont au zoom du navigateur : rien', () => {
    press('+', { ctrlKey: true });
    press('-', { metaKey: true });
    press('0', { altKey: true });
    expect(steps).toEqual([]);
  });

  test('la répétition d\'une touche maintenue ne fait qu\'un cran', () => {
    press('+');
    press('+', { repeat: true });
    expect(steps).toEqual([1]);
  });

  test('dans un champ de saisie, on écrit : rien', () => {
    const field = document.body.appendChild(document.createElement('input'));
    field.focus();
    press('+', {}, field);
    press('-', {}, field);
    expect(steps).toEqual([]);
  });

  test('le débranchement retire l\'écouteur', () => {
    unbind();
    press('+');
    expect(steps).toEqual([]);
  });
});
