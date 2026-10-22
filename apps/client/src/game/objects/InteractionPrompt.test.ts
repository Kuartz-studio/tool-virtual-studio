import { describe, expect, test } from 'vitest';
import type { Interactable } from '../interactions';
import { DEPTH } from '../map-layers';
import { InteractionPrompt } from './InteractionPrompt';

// Un texte de jeu de poche (Phaser a besoin d'un vrai canevas) : il note ce qu'on lui demande, rien de plus.
class FakeText {
  x: number;
  y: number;
  depth = 0;
  visible = true;
  text: string;
  resolution = 1;
  destroyed = false;
  setTextCalls = 0;
  readonly origin = { x: 0, y: 0 };
  constructor(
    x: number,
    y: number,
    text: string,
    readonly style: Record<string, unknown>,
  ) {
    this.x = x;
    this.y = y;
    this.text = text;
  }
  setOrigin(x: number, y: number) { this.origin.x = x; this.origin.y = y; return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setVertexRoundMode() { return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setText(text: string) { this.text = text; this.setTextCalls++; return this; }
  setResolution(resolution: number) { this.resolution = resolution; return this; }
  destroy() { this.destroyed = true; }
}

function setup() {
  const made: FakeText[] = [];
  const scene = {
    add: {
      text: (x: number, y: number, text: string, style: Record<string, unknown>) => {
        const object = new FakeText(x, y, text, style);
        made.push(object);
        return object;
      },
    },
  } as unknown as Phaser.Scene;
  const prompt = new InteractionPrompt(scene);
  return { prompt, label: () => made[0]!, made };
}

function target(extra: Partial<Interactable> = {}): Interactable {
  return { id: 't', pos: { x: 100, y: 200 }, reachTiles: 3, prompt: () => '[E] Éteindre', use: () => {}, ...extra };
}

describe("l'étiquette « [E] … »", () => {
  test('une seule étiquette, cachée tant qu\'aucune cible n\'est à portée', () => {
    const { label, made } = setup();
    expect(made).toHaveLength(1);
    expect(label().visible).toBe(false);
  });

  test('montre le texte de la cible, le bas au milieu de labelAt, devant tout', () => {
    const { prompt, label } = setup();
    prompt.show(target({ labelAt: { x: 104, y: 180 } }));
    expect(label().visible).toBe(true);
    expect(label().text).toBe('[E] Éteindre');
    expect([label().x, label().y]).toEqual([104, 180]);
    expect(label().origin).toEqual({ x: 0.5, y: 1 });
    expect(label().depth).toBe(DEPTH.nameTags);
  });

  test('sans labelAt, elle se pose sur le centre de la cible', () => {
    const { prompt, label } = setup();
    prompt.show(target());
    expect([label().x, label().y]).toEqual([100, 200]);
  });

  test('elle suit la cible : un autre texte, un autre endroit', () => {
    const { prompt, label } = setup();
    let text = '[E] Éteindre';
    const light = target({ prompt: () => text });
    prompt.show(light);
    text = '[E] Allumer';
    prompt.show(light);
    expect(label().text).toBe('[E] Allumer');
    prompt.show(target({ prompt: () => '[E] Prendre un café', pos: { x: 500, y: 600 } }));
    expect(label().text).toBe('[E] Prendre un café');
    expect([label().x, label().y]).toEqual([500, 600]);
  });

  test('elle disparaît sans cible, ou quand la cible n\'a plus rien à dire', () => {
    const { prompt, label } = setup();
    prompt.show(target());
    prompt.show(null);
    expect(label().visible).toBe(false);
    prompt.show(target());
    expect(label().visible).toBe(true);
    prompt.show(target({ prompt: () => null }));
    expect(label().visible).toBe(false);
  });

  test('un texte inchangé ne redessine rien (Phaser refait le canevas du texte à chaque setText)', () => {
    const { prompt, label } = setup();
    const t = target();
    prompt.show(t);
    prompt.show(t);
    prompt.show(t);
    expect(label().setTextCalls).toBe(1);
  });

  test('dans le style des noms : texte blanc de 10 px sur une pastille sombre translucide', () => {
    const { label } = setup();
    expect(label().style).toMatchObject({ fontSize: '10px', color: '#ffffff', backgroundColor: 'rgba(29, 32, 48, 0.75)', padding: { x: 3, y: 1 } });
  });

  test('setZoom : le texte est dessiné à la taille où on le voit, jamais en dessous de 1', () => {
    const { prompt, label } = setup();
    prompt.setZoom(2);
    expect(label().resolution).toBe(2);
    prompt.setZoom(0.5);
    expect(label().resolution).toBe(1);
  });

  test('destroy : l\'étiquette disparaît', () => {
    const { prompt, label } = setup();
    prompt.destroy();
    expect(label().destroyed).toBe(true);
  });
});
