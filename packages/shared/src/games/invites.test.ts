import { describe, expect, test } from 'vitest';
import { refusesGameInvites } from './invites';

const mode = (over: { allowEntry?: boolean; place?: string } = {}) => ({ id: 'm', label: 'Mode', color: '#22c55e', allowEntry: true, hear: true, heard: true, ...over });

describe('refusesGameInvites : qui ne veut pas être invité à une table', () => {
  test('« Ne pas déranger » refuse', () => {
    expect(refusesGameInvites({ status: 'dnd' })).toBe(true);
  });

  test('un mode qui ferme la porte (Concentration) refuse', () => {
    expect(refusesGameInvites({ status: 'available', activity: mode({ allowEntry: false }) })).toBe(true);
  });

  test('un mode qui conduit ailleurs (Sport, une salle) refuse', () => {
    expect(refusesGameInvites({ status: 'available', activity: mode({ place: 'gym' }) })).toBe(true);
  });

  test('les autres statuts, un mode qui laisse entrer et ne bouge pas, ou aucun mode : on peut inviter', () => {
    for (const status of ['available', 'busy', 'away'] as const) expect(refusesGameInvites({ status })).toBe(false);
    expect(refusesGameInvites({ status: 'busy', activity: mode() })).toBe(false);
    expect(refusesGameInvites({ status: 'available', activity: null })).toBe(false);
  });
});
