import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { composeAvatar } from '../../game/avatar-compose';
import { AvatarPortrait, clearPortraitCache } from './AvatarPortrait';

vi.mock('../../game/avatar-compose', () => ({ composeAvatar: vi.fn() }));

const compose = vi.mocked(composeAvatar);
const context = { drawImage: vi.fn(), clearRect: vi.fn(), imageSmoothingEnabled: true };
const sheet = { name: 'planche' } as unknown as HTMLCanvasElement;

beforeEach(() => {
  clearPortraitCache();
  compose.mockReset();
  compose.mockResolvedValue(sheet);
  context.drawImage.mockReset();
  context.imageSmoothingEnabled = true;
  // happy-dom n'a pas de canevas 2D : un faux contexte, qui retient ce qu'on y dessine.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('il dessine 32 × 32 px de l\'image 18 de la planche (de face, à l\'arrêt) sur un canevas de la taille demandée, sans lissage', async () => {
  const { container } = render(<AvatarPortrait avatarKey="perso-1" name="Léa Martin" size={38} />);
  await waitFor(() => expect(context.drawImage).toHaveBeenCalledOnce());
  // Image 18 : 18 × 32 = 576 px depuis la gauche ; la tête est à y = 16.
  expect(context.drawImage).toHaveBeenCalledWith(sheet, 576, 16, 32, 32, 0, 0, 38, 38);
  expect(context.imageSmoothingEnabled).toBe(false);
  const canvas = container.querySelector('canvas')!;
  expect([canvas.width, canvas.height]).toEqual([38, 38]);
  expect(canvas.hidden).toBe(false);
  expect(container.querySelector('.portrait-initials')).toBeNull();
});

test('pendant le chargement, ses initiales ; le portrait les remplace une fois dessiné', async () => {
  let ready: (value: HTMLCanvasElement) => void = () => {};
  compose.mockReturnValue(new Promise((resolve) => (ready = resolve)));
  const { container } = render(<AvatarPortrait avatarKey="perso-1" name="Léa Martin" size={28} />);
  expect(container.querySelector('.portrait-initials')?.textContent).toBe('LM');
  expect(container.querySelector('canvas')!.hidden).toBe(true);
  await act(async () => ready(sheet));
  await waitFor(() => expect(container.querySelector('.portrait-initials')).toBeNull());
  expect(container.querySelector('canvas')!.hidden).toBe(false);
});

test('sans personnage choisi (clé nulle), les initiales seules, et rien n\'est assemblé', () => {
  const { container } = render(<AvatarPortrait avatarKey={null} name="Bob" size={28} />);
  expect(container.querySelector('.portrait-initials')?.textContent).toBe('B');
  expect(compose).not.toHaveBeenCalled();
});

test('une planche qui ne vient pas laisse les initiales ; la demande suivante réessaie', async () => {
  compose.mockResolvedValueOnce(null);
  const { container, unmount } = render(<AvatarPortrait avatarKey="inconnu" name="Zoé" size={28} />);
  await waitFor(() => expect(compose).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(container.querySelector('.portrait-initials')?.textContent).toBe('Z');
  unmount();
  render(<AvatarPortrait avatarKey="inconnu" name="Zoé" size={28} />);
  await waitFor(() => expect(compose).toHaveBeenCalledTimes(2));
});

test('la planche d\'une clé est gardée : la même personne affichée deux fois n\'est assemblée qu\'une fois', async () => {
  render(
    <>
      <AvatarPortrait avatarKey="perso-1" name="Léa" size={28} />
      <AvatarPortrait avatarKey="perso-1" name="Léa" size={52} />
    </>,
  );
  await waitFor(() => expect(context.drawImage).toHaveBeenCalledTimes(2));
  expect(compose).toHaveBeenCalledOnce();
});

test('64 planches au plus : la plus ancienne repart la première', async () => {
  for (let i = 0; i < 65; i++) {
    const { unmount } = render(<AvatarPortrait avatarKey={`perso-${i}`} name="X" size={28} />);
    await waitFor(() => expect(compose).toHaveBeenCalledTimes(i + 1));
    unmount();
  }
  // perso-64 est là (la dernière) ; perso-0, la plus ancienne, a été oubliée.
  render(<AvatarPortrait avatarKey="perso-64" name="X" size={28} />);
  expect(compose).toHaveBeenCalledTimes(65);
  render(<AvatarPortrait avatarKey="perso-0" name="X" size={28} />);
  await waitFor(() => expect(compose).toHaveBeenCalledTimes(66));
});

test('status : le point du statut est dit, et il n\'y en a pas sans statut', () => {
  const { container, rerender } = render(<AvatarPortrait avatarKey={null} name="Bob" size={28} status="busy" />);
  expect(container.querySelector('.portrait-dot')?.getAttribute('data-status')).toBe('busy');
  rerender(<AvatarPortrait avatarKey={null} name="Bob" size={28} />);
  expect(container.querySelector('.portrait-dot')).toBeNull();
});

test('il est décoratif : le nom de la personne est écrit à côté', () => {
  const { container } = render(<AvatarPortrait avatarKey={null} name="Bob" size={28} />);
  expect(container.querySelector('.portrait')?.getAttribute('aria-hidden')).toBe('true');
});
