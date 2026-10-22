import { describe, expect, test } from 'vitest';
import { createTeleport } from '../src/teleport';

// Un monde et des sockets de poche : ce que le monde déplace, et ce que chaque socket reçoit.
function setup(accepts = true) {
  const moved: Array<{ id: string; x: number; y: number }> = [];
  const world = {
    teleport: (id: string, x: number, y: number) => {
      moved.push({ id, x, y });
      return accepts;
    },
  };
  const received: Array<{ socket: string; event: string; payload: unknown }> = [];
  const socket = (name: string) => ({ emit: (event: string, payload: unknown) => void received.push({ socket: name, event, payload }) });
  const sockets: Record<string, Array<ReturnType<typeof socket>>> = { ana: [socket('onglet 1'), socket('onglet 2')], bob: [] };
  const teleport = createTeleport({ world: world as never, socketsOf: (id) => (sockets[id] ?? []) as never });
  return { teleport, moved, received };
}

describe('teleport : poser quelqu\'un ailleurs', () => {
  test('le monde le déplace (en pixels entiers), et chacune de ses sockets reçoit `move:correct` : son navigateur s\'y replace', () => {
    const { teleport, moved, received } = setup();
    expect(teleport('ana', { x: 100.4, y: 200.6 })).toBe(true);
    expect(moved).toEqual([{ id: 'ana', x: 100, y: 201 }]);
    expect(received).toEqual([
      { socket: 'onglet 1', event: 'move:correct', payload: { x: 100, y: 201 } },
      { socket: 'onglet 2', event: 'move:correct', payload: { x: 100, y: 201 } },
    ]);
  });

  test('sans raison, c\'est une simple correction : le champ `reason` n\'est pas dans le message', () => {
    const { teleport, received } = setup();
    teleport('ana', { x: 10, y: 20 });
    expect(received[0]!.payload).toEqual({ x: 10, y: 20 });
    expect(Object.keys(received[0]!.payload as object)).toEqual(['x', 'y']);
  });

  test('avec la raison `teleport` (un voyage voulu, un mode), le message la porte : le jeu souligne le saut', () => {
    const { teleport, received } = setup();
    teleport('ana', { x: 10, y: 20 }, 'teleport');
    expect(received.map((r) => r.payload)).toEqual([
      { x: 10, y: 20, reason: 'teleport' },
      { x: 10, y: 20, reason: 'teleport' },
    ]);
  });

  test('le monde refuse (case bloquante, personne inconnue) : faux, et personne n\'est prévenu', () => {
    const { teleport, received } = setup(false);
    expect(teleport('ana', { x: 10, y: 20 }, 'teleport')).toBe(false);
    expect(received).toEqual([]);
  });

  test('quelqu\'un sans socket entrée est déplacé quand même : le monde le sait, personne à qui écrire', () => {
    const { teleport, moved, received } = setup();
    expect(teleport('bob', { x: 5, y: 6 })).toBe(true);
    expect(moved).toEqual([{ id: 'bob', x: 5, y: 6 }]);
    expect(received).toEqual([]);
  });
});
