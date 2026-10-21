import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { useAudioStore } from '../audio/audio-store';
import { DEFAULT_AUDIO_PREFS } from '../audio/prefs';
import { fr } from '../i18n/fr';
import { MusicToggle } from './MusicToggle';

beforeEach(() => {
  localStorage.clear();
  useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, status: 'running', playing: null, place: 'lobby' });
});

const prefs = () => useAudioStore.getState().prefs;

describe('l\'interrupteur de la musique des pages de connexion et d\'entrée', () => {
  test('il montre l\'état de la musique, et la coupe ou la rallume comme le juke-box', async () => {
    const user = userEvent.setup();
    render(<MusicToggle />);
    const button = screen.getByRole('button', { name: fr.sound.music.label });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await user.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(prefs().musicOn).toBe(false);
    await user.click(button);
    expect(prefs().musicOn).toBe(true);
  });
});
