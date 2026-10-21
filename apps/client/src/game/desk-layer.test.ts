import type { DeskInfo } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { fr } from '../i18n/fr';
import { deskLabel, doorView } from './desk-layer';

const free: DeskInfo = { key: 'A1', ownerId: null, ownerName: null, name: null, locked: false, closedByState: false };
const owned = (more: Partial<DeskInfo> = {}): DeskInfo => ({ ...free, ownerId: 'ana', ownerName: 'Ana', ...more });

describe('doorView : la porte, vue de soi', () => {
  test('une place libre, ou ouverte : ouverte', () => {
    expect(doorView(free, [], 'A1')).toBe('open');
    expect(doorView(undefined, [], 'A1')).toBe('open');
    expect(doorView(owned(), [], 'A1')).toBe('open');
  });

  test('fermée pour soi (verrou d\'un autre, état d\'activité, exclusion) : un battant plein qui bloque', () => {
    expect(doorView(owned({ locked: true }), ['A1'], 'A1')).toBe('closed');
    expect(doorView(owned({ closedByState: true }), ['A1'], 'A1')).toBe('closed');
    // Exclu d'une porte ouverte : bloquée aussi.
    expect(doorView(owned(), ['A1'], 'A1')).toBe('closed');
  });

  test('fermée mais pas pour soi (son bureau, ou admis) : un trait clair qui ne bloque pas', () => {
    expect(doorView(owned({ locked: true }), [], 'A1')).toBe('locked-mine');
    expect(doorView(owned({ closedByState: true }), ['A2'], 'A1')).toBe('locked-mine');
  });
});

describe('deskLabel : le texte dans la pièce', () => {
  test('libre : « Libre », discret', () => {
    expect(deskLabel(free)).toEqual({ text: fr.desk.free, free: true });
    expect(deskLabel(undefined)).toEqual({ text: fr.desk.free, free: true });
  });

  test('occupé : le nom du bureau, sinon celui du propriétaire', () => {
    expect(deskLabel(owned())).toEqual({ text: 'Ana', free: false });
    expect(deskLabel(owned({ name: 'Le labo' }))).toEqual({ text: 'Le labo', free: false });
  });

  test('porte fermée (verrou ou état d\'activité) : un cadenas devant', () => {
    expect(deskLabel(owned({ locked: true })).text).toBe('🔒 Ana');
    expect(deskLabel(owned({ closedByState: true, name: 'Focus' })).text).toBe('🔒 Focus');
  });
});
