import { CHARACTER_PARTS, defaultAvatarKey, formatCharacter, formatPremade, parseAvatarKey } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json, sentBody } from '../test/fake-api';
import { CharacterBuilder } from './CharacterBuilder';

function setup(avatarKey: string | null = null) {
  act(() => {
    useOfficeStore.getState().applyInit({
      self: { id: 'moi', name: 'Léa', avatarKey, x: 0, y: 0, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } },
      players: [],
      mapKey: 'office',
      chatHistory: [],
      desks: [],
      closedDesks: [],
      deskBans: [],
    });
  });
  let closed = 0;
  render(<CharacterBuilder onClose={() => closed++} />);
  return { closed: () => closed };
}

beforeEach(() => {
  useOfficeStore.getState().reset();
});

describe('le builder de personnage', () => {
  test('sans avatar choisi, il part du personnage prêt à l\'emploi qu\'on a par défaut ; enregistrer n\'a rien à enregistrer', () => {
    setup();
    const mine = parseAvatarKey(defaultAvatarKey('moi'))!;
    if (mine.kind !== 'premade') throw new Error('attendu : un personnage prêt');
    expect(screen.getByRole('button', { name: t(fr.character.premadeOne, { number: mine.number }) }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: fr.character.save }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('« Prêts à jouer » : un bouton par personnage du pack ; en choisir un autre rend l\'enregistrement possible', async () => {
    const user = userEvent.setup();
    setup(formatPremade(3));
    const group = screen.getByRole('group', { name: fr.character.premadeLabel });
    expect(within(group).getAllByRole('button')).toHaveLength(CHARACTER_PARTS.premade);
    await user.click(screen.getByRole('button', { name: t(fr.character.premadeOne, { number: 9 }) }));
    expect((screen.getByRole('button', { name: fr.character.save }) as HTMLButtonElement).disabled).toBe(false);
  });

  test('Enregistrer envoie la clé du personnage au serveur (PATCH /api/me) et le dit', async () => {
    const user = userEvent.setup();
    const server = fakeApi({ 'PATCH /api/me': () => json(200, { id: 'moi', name: 'Léa', avatarKey: 'p.09' }) });
    setup(formatPremade(3));
    await user.click(screen.getByRole('button', { name: t(fr.character.premadeOne, { number: 9 }) }));
    await user.click(screen.getByRole('button', { name: fr.character.save }));
    expect(sentBody(server, 'PATCH /api/me')).toEqual({ avatarKey: 'p.09' });
    expect(await screen.findByText(fr.character.saved)).toBeTruthy();
  });

  test('une erreur du serveur est dite, sans perdre le choix', async () => {
    const user = userEvent.setup();
    fakeApi({ 'PATCH /api/me': () => json(400, { error: 'invalid' }) });
    setup(formatPremade(3));
    await user.click(screen.getByRole('button', { name: t(fr.character.premadeOne, { number: 9 }) }));
    await user.click(screen.getByRole('button', { name: fr.character.save }));
    expect((await screen.findByRole('alert')).textContent).toBe(fr.character.failed);
    expect(screen.getByRole('button', { name: t(fr.character.premadeOne, { number: 9 }) }).getAttribute('aria-pressed')).toBe('true');
  });

  test('« Créer le mien » : cinq pièces ; chaque choix change la clé enregistrée', async () => {
    const user = userEvent.setup();
    const server = fakeApi({ 'PATCH /api/me': () => json(200, {}) });
    setup(formatPremade(3));
    await user.click(screen.getByRole('tab', { name: fr.character.tabs.build }));
    const parts = within(screen.getByRole('group', { name: fr.character.partsLabel })).getAllByRole('button');
    expect(parts.map((b) => b.textContent)).toEqual([fr.character.parts.body, fr.character.parts.eyes, fr.character.parts.outfit, fr.character.parts.hair, fr.character.parts.accessory]);

    await user.click(screen.getByRole('button', { name: t(fr.character.bodyOne, { number: 4 }) }));
    await user.click(parts[1]!);
    await user.click(screen.getByRole('button', { name: t(fr.character.eyesOne, { number: 3 }) }));
    await user.click(parts[3]!);
    await user.click(screen.getByRole('button', { name: t(fr.character.hairOne, { number: CHARACTER_PARTS.hair[2]!.number }) }));
    await user.click(screen.getByRole('button', { name: t(fr.character.colorOne, { number: 2 }) }));
    await user.click(screen.getByRole('button', { name: fr.character.save }));

    const { avatarKey } = sentBody(server, 'PATCH /api/me') as { avatarKey: string };
    const outfit = CHARACTER_PARTS.outfits[0]!.number;
    expect(avatarKey).toBe(formatCharacter({ body: 4, eyes: 3, outfit: { style: outfit, color: 1 }, hair: { style: CHARACTER_PARTS.hair[2]!.number, color: 2 }, accessory: null }));
  });

  test('« Aucun » enlève la coiffure et l\'accessoire ; la tenue, elle, est obligatoire', async () => {
    const user = userEvent.setup();
    setup(formatCharacter({ body: 1, eyes: 1, outfit: { style: CHARACTER_PARTS.outfits[0]!.number, color: 1 }, hair: { style: CHARACTER_PARTS.hair[0]!.number, color: 1 }, accessory: null }));
    const parts = within(screen.getByRole('group', { name: fr.character.partsLabel })).getAllByRole('button');
    await user.click(parts[2]!);
    expect(screen.queryByRole('button', { name: fr.character.none })).toBeNull();
    await user.click(parts[3]!);
    await user.click(screen.getByRole('button', { name: fr.character.none }));
    expect(screen.getByRole('button', { name: fr.character.none }).getAttribute('aria-pressed')).toBe('true');
  });

  test('« Au hasard » passe à « Créer le mien » avec un personnage valable', async () => {
    const user = userEvent.setup();
    setup(formatPremade(3));
    await user.click(screen.getByRole('button', { name: fr.character.random }));
    expect(screen.getByRole('tab', { name: fr.character.tabs.build }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByRole('button', { name: fr.character.save }) as HTMLButtonElement).disabled).toBe(false);
  });

  test('Échap ferme le panneau', async () => {
    const user = userEvent.setup();
    const { closed } = setup();
    await user.keyboard('{Escape}');
    expect(closed()).toBe(1);
  });
});
