import { act, render, screen } from '@testing-library/react';
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
  test('un bouton à icône seule, nommé « Musique » : son nom est aussi son infobulle ; la note est barrée, et le bouton en retrait, quand la musique est coupée', () => {
    render(<MusicToggle />);
    const button = screen.getByRole('button', { name: 'Musique' });
    expect(button.querySelector('svg.lucide-music')).not.toBeNull();
    expect(button.querySelector('.icon-tip')?.textContent).toBe('Musique');
    expect(button.querySelector('.icon-struck')).toBeNull();
    expect(button.classList.contains('is-muted')).toBe(false);
    act(() => useAudioStore.getState().setPrefs({ musicOn: false }));
    expect(button.querySelector('.icon-struck')).not.toBeNull();
    expect(button.classList.contains('is-muted')).toBe(true);
  });

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
