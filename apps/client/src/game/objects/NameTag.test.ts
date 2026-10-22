import { describe, expect, test } from 'vitest';
import { BUBBLE_HEIGHT, bubbleScale, DOT_STEP_MS } from './SpeechBubble';
import { displayName, NAME_MAX_LENGTH, NameTag, SpeakingBubbles } from './NameTag';

test('un nom de 20 caractères au plus est affiché tel quel', () => {
  expect(NAME_MAX_LENGTH).toBe(20);
  expect(displayName('Léa')).toBe('Léa');
  expect(displayName('Marie-Hélène Durand')).toBe('Marie-Hélène Durand');
  expect(displayName('a'.repeat(20))).toBe('a'.repeat(20));
});

test('au-delà, les 20 premiers caractères puis « … »', () => {
  expect(displayName('a'.repeat(21))).toBe(`${'a'.repeat(20)}…`);
  expect(displayName('Jean-Christophe Delacroix-Martin')).toBe('Jean-Christophe Dela…');
});

test('les caractères se comptent comme on les voit : une lettre accentuée décomposée ou un emoji en est un seul', () => {
  const decomposed = 'é'.repeat(25);   // « é » écrit avec un accent combinant
  expect(displayName(decomposed)).toBe(`${'é'.repeat(20)}…`);
  const family = '👩‍👩‍👧';   // un seul emoji, fait de cinq points de code
  expect(displayName(family.repeat(20))).toBe(family.repeat(20));
  expect(displayName(family.repeat(21))).toBe(`${family.repeat(20)}…`);
});

test('pas d\'espace avant « … »', () => {
  expect(displayName(`${'a'.repeat(19)} bcd`)).toBe(`${'a'.repeat(19)}…`);
});

// La bulle de parole des étiquettes suit deux sources : `media:speaking` (qui parle dans la room audio/vidéo, soi-même compris : immédiat) et
// `speaking:changed` du serveur (qui parle, même loin et hors de la conversation). Elle est allumée tant que l'une des deux le dit. La scène donne
// l'objet qui porte l'étiquette de chacun : l'avatar local ou un avatar distant.
describe('SpeakingBubbles', () => {
  // Des étiquettes qui notent leurs changements de bulle.
  function tags(...ids: string[]) {
    const log: string[] = [];
    const shown = new Map(ids.map((id) => [id, { setSpeaking: (on: boolean) => log.push(`${id}:${on ? 'on' : 'off'}`) }]));
    return { log, bubbles: new SpeakingBubbles((id) => shown.get(id)), shown };
  }

  test('la bulle de ceux qui parlent dans la room s\'allume, celle de ceux qui se taisent s\'éteint', () => {
    const { log, bubbles } = tags('moi', 'ana', 'bob');
    bubbles.updateMedia(['ana']);
    bubbles.updateMedia(['ana', 'moi']);
    bubbles.updateMedia(['moi']);
    expect(log).toEqual(['ana:on', 'moi:on', 'ana:off']);
  });

  test('[] (la room quittée) : toutes les bulles venues de la room s\'éteignent', () => {
    const { log, bubbles } = tags('moi', 'ana');
    bubbles.updateMedia(['moi', 'ana']);
    log.splice(0);
    bubbles.updateMedia([]);
    expect(log.sort()).toEqual(['ana:off', 'moi:off']);
  });

  test('rien de changé : les étiquettes ne sont pas retouchées', () => {
    const { log, bubbles } = tags('ana');
    bubbles.updateMedia(['ana']);
    bubbles.updateMedia(['ana']);
    bubbles.setServer('ana', true);
    bubbles.setServer('ana', true);
    expect(log).toEqual(['ana:on']);
  });

  test('quelqu\'un que la scène ne dessine pas (pas encore là, ou parti) : rien ; dessiné ensuite, isSpeaking dit s\'il parle', () => {
    const { log, bubbles, shown } = tags('moi');
    bubbles.updateMedia(['zoe']);
    expect(log).toEqual([]);
    expect(bubbles.isSpeaking('zoe')).toBe(true);
    expect(bubbles.isSpeaking('moi')).toBe(false);
    // Zoé arrive (la scène crée son avatar, et lui donne sa bulle) puis se tait.
    shown.set('zoe', { setSpeaking: (on: boolean) => log.push(`zoe:${on ? 'on' : 'off'}`) });
    bubbles.updateMedia([]);
    expect(log).toEqual(['zoe:off']);
  });

  test('le serveur dit qu\'on parle, loin de soi et hors de la conversation : la bulle s\'allume, puis s\'éteint à son « je me tais »', () => {
    const { log, bubbles } = tags('ana');
    bubbles.setServer('ana', true);
    expect(bubbles.isSpeaking('ana')).toBe(true);
    bubbles.setServer('ana', false);
    expect(bubbles.isSpeaking('ana')).toBe(false);
    expect(log).toEqual(['ana:on', 'ana:off']);
  });

  test('la bulle tient tant que l\'une des deux sources parle : la room qui se tait ne l\'éteint pas si le serveur parle encore, et réciproquement', () => {
    const { log, bubbles } = tags('ana');
    bubbles.updateMedia(['ana']);
    bubbles.setServer('ana', true);
    bubbles.updateMedia([]);
    expect(bubbles.isSpeaking('ana')).toBe(true);
    bubbles.updateMedia(['ana']);
    bubbles.setServer('ana', false);
    expect(bubbles.isSpeaking('ana')).toBe(true);
    bubbles.updateMedia([]);
    expect(bubbles.isSpeaking('ana')).toBe(false);
    expect(log).toEqual(['ana:on', 'ana:off']);
  });

  test('resetServer (un init) remplace tout ce que le serveur avait dit : ceux qu\'il ne cite plus se taisent, ceux qu\'il cite parlent', () => {
    const { log, bubbles } = tags('ana', 'bob', 'cleo');
    bubbles.setServer('ana', true);
    bubbles.setServer('bob', true);
    log.splice(0);
    bubbles.resetServer(['bob', 'cleo']);
    expect(log.sort()).toEqual(['ana:off', 'cleo:on']);
    expect(bubbles.ids().sort()).toEqual(['bob', 'cleo']);
  });

  test('forget : quelqu\'un qui s\'en va n\'a plus de bulle, même si le serveur ne s\'est pas tu', () => {
    const { log, bubbles } = tags('ana');
    bubbles.setServer('ana', true);
    bubbles.forget('ana');
    expect(bubbles.isSpeaking('ana')).toBe(false);
    expect(log).toEqual(['ana:on', 'ana:off']);
  });

  test('ids : ceux dont la bulle est allumée, par l\'une ou l\'autre source', () => {
    const { bubbles } = tags('ana', 'bob', 'cleo');
    bubbles.updateMedia(['ana']);
    bubbles.setServer('bob', true);
    expect(bubbles.ids().sort()).toEqual(['ana', 'bob']);
  });
});

// L'étiquette d'un avatar, avec une scène de poche (Phaser a besoin d'un vrai canevas) : chaque objet note ce qu'on lui demande.
class FakeShape {
  x = 0;
  y = 0;
  width = 1;
  height = 1;
  visible = true;
  scaleX = 1;
  depth = 0;
  originY = 0;
  fill: number | undefined;
  text = '';
  resolution = 1;
  destroyed = false;
  readonly style: { resolution: number };
  readonly children: FakeShape[] = [];
  constructor(
    readonly kind: 'rectangle' | 'circle' | 'text' | 'container' | 'image',
    text = '',
    resolution = 1,
  ) {
    this.text = text;
    this.style = { resolution };
    if (kind === 'text') {
      this.width = 6 * text.length;
      this.height = 12;
    }
  }
  setOrigin(_x: number, y = 0) { this.originY = y; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setSize(width: number, height: number) { this.width = width; this.height = height; return this; }
  setScale(x: number) { this.scaleX = x; return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setFillStyle(fill: number) { this.fill = fill; return this; }
  setVertexRoundMode() { return this; }
  setText(text: string) { this.text = text; this.width = 6 * text.length; return this; }
  setResolution(resolution: number) { this.style.resolution = resolution; return this; }
  destroy() { this.destroyed = true; for (const child of this.children) child.destroy(); }
}

function tagScene() {
  const made: FakeShape[] = [];
  const make = (kind: FakeShape['kind'], text?: string, resolution?: number) => {
    const shape = new FakeShape(kind, text, resolution);
    made.push(shape);
    return shape;
  };
  const textures = { exists: () => true, addCanvas: () => undefined };
  const scene = {
    textures,
    add: {
      rectangle: () => make('rectangle'),
      circle: () => make('circle'),
      image: () => make('image'),
      text: (_x: number, _y: number, text: string, style: { resolution: number }) => make('text', text, style.resolution),
      container: (_x: number, _y: number, children: FakeShape[]) => {
        const container = make('container');
        container.children.push(...children);
        return container;
      },
    },
  } as unknown as Phaser.Scene;
  return { scene, made };
}

describe('NameTag : la bulle de parole', () => {
  function setup(zoom = 1.5) {
    const { scene, made } = tagScene();
    const tag = new NameTag(scene, 'Alice', 'available', zoom);
    const container = made.find((shape) => shape.kind === 'container')!;
    const background = made.find((shape) => shape.kind === 'rectangle' && shape.children.length === 0 && container.children.includes(shape))!;
    const bubbleImage = made.find((shape) => shape.kind === 'image')!;
    const dots = made.filter((shape) => shape.kind === 'rectangle' && shape !== background);
    return { tag, container, background, bubbleImage, dots };
  }

  test('la bulle est dans le conteneur de l\'étiquette, cachée tant que la personne ne parle pas', () => {
    const { container, bubbleImage, dots } = setup();
    expect(container.children).toContain(bubbleImage);
    for (const dot of dots) expect(container.children).toContain(dot);
    expect(bubbleImage.visible).toBe(false);
  });

  test('setSpeaking(true) montre la bulle, false la cache', () => {
    const { tag, bubbleImage, dots } = setup();
    tag.setSpeaking(true);
    expect([bubbleImage, ...dots].every((shape) => shape.visible)).toBe(true);
    tag.setSpeaking(false);
    expect([bubbleImage, ...dots].every((shape) => !shape.visible)).toBe(true);
  });

  test('elle est posée juste au-dessus de la pastille du nom', () => {
    const { background, bubbleImage } = setup();
    // Le haut de la pastille est en background.y (− sa hauteur) ; le bas de la bulle, un pixel au-dessus.
    expect(background.y).toBeLessThan(0);
    expect(bubbleImage.y).toBe(background.y - 1);
    expect(bubbleImage.y).toBeLessThan(background.y);
  });

  test('dézoomé, la bulle grossit pour ne jamais descendre sous 16 px à l\'écran, et reste posée sur la pastille', () => {
    const { tag, background, bubbleImage } = setup(1.5);
    expect(bubbleImage.scaleX).toBe(1);
    tag.setZoom(0.375);
    expect(bubbleImage.scaleX).toBe(bubbleScale(0.375));
    expect(14 * bubbleImage.scaleX * 0.375).toBeGreaterThanOrEqual(16);
    expect(bubbleImage.y).toBe(background.y - 1);
    tag.setZoom(1.5);
    expect(bubbleImage.scaleX).toBe(1);
    // Une étiquette créée dézoomée part déjà à la bonne taille.
    expect(setup(0.375).bubbleImage.scaleX).toBe(bubbleScale(0.375));
  });

  test('tick fait monter les trois points l\'un après l\'autre', () => {
    const { tag, dots } = setup();
    tag.setSpeaking(true);
    const rest = dots.map((dot) => dot.y);
    const lifted = (now: number) => {
      tag.tick(now);
      return dots.map((dot, i) => rest[i]! - dot.y);
    };
    expect(lifted(0)).toEqual([1, 0, 0]);
    expect(lifted(DOT_STEP_MS)).toEqual([0, 1, 0]);
    expect(lifted(2 * DOT_STEP_MS)).toEqual([0, 0, 1]);
    expect(BUBBLE_HEIGHT).toBe(11);
  });

  test('plus d\'anneau autour du point de statut : le point est un simple disque, sans second cercle', () => {
    const { container } = setup();
    expect(container.children.filter((shape) => shape.kind === 'circle')).toHaveLength(1);
  });
});
