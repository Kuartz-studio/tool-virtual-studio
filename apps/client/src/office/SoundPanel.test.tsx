import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { audioEngine } from '../audio/audio';
import { useAudioStore } from '../audio/audio-store';
import { SCENE_IDS } from '../audio/catalog';
import { DEFAULT_AUDIO_PREFS } from '../audio/prefs';
import { fr } from '../i18n/fr';
import { MusicToggle } from './MusicToggle';
import { SoundPanel } from './SoundPanel';

beforeEach(() => {
  localStorage.clear();
  useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, status: 'running', playing: null, place: 'lobby' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const prefs = () => useAudioStore.getState().prefs;
const musicSwitch = () => screen.getByRole('switch', { name: fr.sound.music.label }) as HTMLInputElement;
const effectsSwitch = () => screen.getByRole('switch', { name: fr.sound.effects.label }) as HTMLInputElement;
const musicVolume = () => screen.getByRole('slider', { name: fr.sound.music.volume }) as HTMLInputElement;
const effectsVolume = () => screen.getByRole('slider', { name: fr.sound.effects.volume }) as HTMLInputElement;

describe('le panneau Son', () => {
  test('deux interrupteurs, deux volumes, l\'ambiance : les réglages du moment', () => {
    useAudioStore.setState({ prefs: { musicOn: true, musicVolume: 0.25, sfxOn: false, sfxVolume: 1, scene: 'dusk' } });
    render(<SoundPanel onClose={() => {}} />);
    expect(screen.getByRole('complementary', { name: fr.sound.title })).toBeTruthy();
    expect(musicSwitch().checked).toBe(true);
    expect(effectsSwitch().checked).toBe(false);
    expect(musicVolume().value).toBe('25');
    expect(musicVolume().getAttribute('aria-valuetext')).toBe('25 %');
    expect(effectsVolume().value).toBe('100');
    expect((screen.getByRole('radio', { name: new RegExp(fr.sound.scenes.dusk.title) }) as HTMLInputElement).checked).toBe(true);
  });

  test('couper la musique : le volume et le choix de l\'ambiance s\'éteignent, les effets ne bougent pas ; le réglage est enregistré', async () => {
    const user = userEvent.setup();
    render(<SoundPanel onClose={() => {}} />);
    await user.click(musicSwitch());
    expect(prefs().musicOn).toBe(false);
    expect(prefs().sfxOn).toBe(true);
    expect(musicVolume().disabled).toBe(true);
    // Le choix de l'ambiance est un groupe (fieldset) que la musique coupée désactive en bloc.
    expect(screen.getAllByRole('radio')[0]!.closest('fieldset')!.disabled).toBe(true);
    expect(effectsVolume().disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem('bureau.audio.v1')!).musicOn).toBe(false);
    await user.click(musicSwitch());
    expect(prefs().musicOn).toBe(true);
    expect(musicVolume().disabled).toBe(false);
  });

  test('couper les effets : leur volume et l\'exemple s\'éteignent, la musique ne bouge pas', async () => {
    const user = userEvent.setup();
    render(<SoundPanel onClose={() => {}} />);
    await user.click(effectsSwitch());
    expect(prefs().sfxOn).toBe(false);
    expect(prefs().musicOn).toBe(true);
    expect(effectsVolume().disabled).toBe(true);
    expect((screen.getByRole('button', { name: fr.sound.effects.test }) as HTMLButtonElement).disabled).toBe(true);
    expect(musicVolume().disabled).toBe(false);
  });

  test('les curseurs règlent chacun leur volume, de 0 à 1', () => {
    render(<SoundPanel onClose={() => {}} />);
    fireEvent.change(musicVolume(), { target: { value: '0' } });
    expect(prefs().musicVolume).toBe(0);
    expect(prefs().sfxVolume).toBe(DEFAULT_AUDIO_PREFS.sfxVolume);
    fireEvent.change(effectsVolume(), { target: { value: '100' } });
    expect(prefs().sfxVolume).toBe(1);
    fireEvent.change(musicVolume(), { target: { value: '35' } });
    expect(prefs().musicVolume).toBe(0.35);
  });

  test('les six ambiances et « Selon l\'endroit » : en choisir une la joue partout, « Selon l\'endroit » rend la main au lieu', async () => {
    const user = userEvent.setup();
    render(<SoundPanel onClose={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(1 + SCENE_IDS.length);
    expect((screen.getByRole('radio', { name: new RegExp(fr.sound.ambiance.auto) }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('radio', { name: new RegExp(fr.sound.scenes.quest.title) }));
    expect(prefs().scene).toBe('quest');
    await user.click(screen.getByRole('radio', { name: new RegExp(fr.sound.ambiance.auto) }));
    expect(prefs().scene).toBe('auto');
  });

  test('chaque ambiance dit ce qu\'elle évoque et où elle joue ; celle qui joue est marquée « En cours »', () => {
    useAudioStore.setState({ playing: 'sunny' });
    render(<SoundPanel onClose={() => {}} />);
    for (const scene of SCENE_IDS) {
      const radio = screen.getByRole('radio', { name: new RegExp(fr.sound.scenes[scene].title) });
      expect(radio.closest('label')?.textContent).toContain(fr.sound.scenes[scene].mood);
      expect(radio.closest('label')?.textContent).toContain(fr.sound.scenes[scene].where);
    }
    const marked = screen.getAllByText(fr.sound.ambiance.playing);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.closest('label')?.textContent).toContain(fr.sound.scenes.sunny.title);
  });

  test('tant que le navigateur n\'a pas laissé le son démarrer, le panneau le dit ; sans Web Audio aussi ; sinon rien', () => {
    useAudioStore.setState({ status: 'locked' });
    const { rerender } = render(<SoundPanel onClose={() => {}} />);
    expect(screen.getByRole('status').textContent).toBe(fr.sound.status.locked);
    useAudioStore.setState({ status: 'unsupported' });
    rerender(<SoundPanel onClose={() => {}} />);
    expect(screen.getByRole('status').textContent).toBe(fr.sound.status.unsupported);
    useAudioStore.setState({ status: 'running' });
    rerender(<SoundPanel onClose={() => {}} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('« Écouter un effet » joue un exemple', async () => {
    const play = vi.spyOn(audioEngine, 'playSfx').mockImplementation(() => {});
    render(<SoundPanel onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: fr.sound.effects.test }));
    expect(play).toHaveBeenCalledWith('message');
  });

  test('Échap et le bouton Fermer ferment le panneau', async () => {
    const onClose = vi.fn();
    render(<SoundPanel onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: fr.sound.title }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: fr.sound.close }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('les crédits de la musique et des effets sont là', () => {
    render(<SoundPanel onClose={() => {}} />);
    expect(screen.getByText(fr.sound.credits)).toBeTruthy();
  });
});

describe('l\'interrupteur de la musique des pages de connexion et d\'entrée', () => {
  test('il montre l\'état de la musique, et la coupe ou la rallume comme le panneau Son', async () => {
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
