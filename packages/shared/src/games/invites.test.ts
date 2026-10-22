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

  // Un mode « Jeux » dont l'emplacement est la salle de jeu : l'invitation le conduit là où il voulait être, elle ne l'arrache à rien.
  test('un mode qui conduit à la salle même de la table (son emplacement) laisse inviter ; un autre emplacement, non', () => {
    expect(refusesGameInvites({ status: 'available', activity: mode({ place: 'game' }) }, 'game')).toBe(false);
    expect(refusesGameInvites({ status: 'available', activity: mode({ place: 'gym' }) }, 'game')).toBe(true);
    // Sans salle connue (la table n'est dans aucune), un emplacement refuse toujours.
    expect(refusesGameInvites({ status: 'available', activity: mode({ place: 'game' }) }, null)).toBe(true);
    expect(refusesGameInvites({ status: 'available', activity: mode({ place: 'game' }) })).toBe(true);
  });

  test('l\'emplacement de la salle de la table ne lève ni « Ne pas déranger » ni la porte fermée', () => {
    expect(refusesGameInvites({ status: 'dnd', activity: mode({ place: 'game' }) }, 'game')).toBe(true);
    expect(refusesGameInvites({ status: 'available', activity: mode({ place: 'game', allowEntry: false }) }, 'game')).toBe(true);
  });

  test('les autres statuts, un mode qui laisse entrer et ne bouge pas, ou aucun mode : on peut inviter', () => {
    for (const status of ['available', 'busy', 'away'] as const) expect(refusesGameInvites({ status })).toBe(false);
    expect(refusesGameInvites({ status: 'busy', activity: mode() })).toBe(false);
    expect(refusesGameInvites({ status: 'available', activity: null })).toBe(false);
  });
});
