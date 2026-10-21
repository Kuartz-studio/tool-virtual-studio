import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { useAudioStore } from '../audio/audio-store';
import { DEFAULT_AUDIO_PREFS } from '../audio/prefs';
import { fr } from '../i18n/fr';
import { AuthLayout } from './AuthLayout';

beforeEach(() => {
  localStorage.clear();
  useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, status: 'running', playing: null, place: 'lobby' });
});

test('la carte a un en-tête : le nom de l\'appli à gauche, et à droite le bouton de la musique ; puis le titre', () => {
  render(
    <AuthLayout title="Connexion">
      <p>Le formulaire</p>
    </AuthLayout>,
  );
  const card = screen.getByRole('heading', { level: 1, name: 'Connexion' }).closest('.auth-card')!;
  const head = card.querySelector('header.auth-head')!;
  expect(head.querySelector('.auth-brand')?.textContent).toBe(fr.common.appName);
  const music = within(head as HTMLElement).getByRole('button', { name: fr.sound.music.label });
  expect(music.getAttribute('aria-pressed')).toBe('true');
  // L'en-tête vient avant le titre, et le bouton n'est plus posé à part sur la page.
  expect(head.nextElementSibling?.tagName).toBe('H1');
  expect(document.querySelector('main.auth > .music-toggle')).toBeNull();
});

test('le bouton coupe et rallume la musique (le même réglage que le juke-box)', async () => {
  const user = userEvent.setup();
  render(<AuthLayout title="Connexion">{null}</AuthLayout>);
  const music = screen.getByRole('button', { name: fr.sound.music.label });
  await user.click(music);
  expect(useAudioStore.getState().prefs.musicOn).toBe(false);
  expect(music.getAttribute('aria-pressed')).toBe('false');
  await user.click(music);
  expect(useAudioStore.getState().prefs.musicOn).toBe(true);
});
