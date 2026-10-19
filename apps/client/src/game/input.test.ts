import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { bindKeyboard, DirectionInput } from './input';

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
