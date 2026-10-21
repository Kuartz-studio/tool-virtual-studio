import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { audioEngine } from '../audio/audio';
import { useAudioStore } from '../audio/audio-store';
import { SCENE_IDS } from '../audio/catalog';
import { DEFAULT_AUDIO_PREFS } from '../audio/prefs';
import { fr, t } from '../i18n/fr';
import { COVERS } from './ambiance-covers';
import { SoundPopover } from './SoundPopover';

beforeEach(() => {
  localStorage.clear();
  useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, status: 'running', playing: null, place: 'lobby' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const prefs = () => useAudioStore.getState().prefs;

// Le juke-box, ouvert sur son bouton (l'ancre : le dock en pose un).
function Harness({ open = true, onClose = () => {} }: { open?: boolean; onClose?: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchor} type="button">
        Ancre
      </button>
      <SoundPopover open={open} onClose={onClose} anchorRef={anchor} />
    </>
  );
}

const jukebox = () => screen.getByRole('dialog', { name: fr.sound.toggle });
const musicSwitch = () => screen.getByRole('switch', { name: fr.sound.music.label }) as HTMLInputElement;
const effectsSwitch = () => screen.getByRole('switch', { name: fr.sound.effects.label }) as HTMLInputElement;
const musicVolume = () => screen.getByRole('slider', { name: fr.sound.music.volume }) as HTMLInputElement;
const effectsVolume = () => screen.getByRole('slider', { name: fr.sound.effects.volume }) as HTMLInputElement;
const scene = (id: (typeof SCENE_IDS)[number]) => screen.getByRole('radio', { name: new RegExp(`^${fr.sound.scenes[id].title}`) }) as HTMLInputElement;
const auto = () => screen.getByRole('radio', { name: new RegExp(`^${fr.sound.ambiance.auto}`) }) as HTMLInputElement;

describe('le juke-box', () => {
  test('fermé, il n\'y a rien dans la page ; ouvert, une fenêtre « Musique et ambiances »', () => {
    const { rerender } = render(<Harness open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Harness />);
    expect(jukebox().getAttribute('data-placement')).toBe('top');
    expect(fr.sound.toggle).toBe('Musique et ambiances');
  });

  test('deux interrupteurs, deux volumes, l\'ambiance : les réglages du moment', () => {
    useAudioStore.setState({ prefs: { musicOn: true, musicVolume: 0.25, sfxOn: false, sfxVolume: 1, scene: 'dusk' } });
    render(<Harness />);
    expect(musicSwitch().checked).toBe(true);
    expect(effectsSwitch().checked).toBe(false);
    expect(musicVolume().value).toBe('25');
    expect(musicVolume().getAttribute('aria-valuetext')).toBe('25 %');
    expect(effectsVolume().value).toBe('100');
    expect(scene('dusk').checked).toBe(true);
  });

  test('couper la musique : son volume s\'éteint, la grille reste utilisable (en retrait), les effets ne bougent pas ; le réglage est enregistré', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(musicSwitch());
    expect(prefs().musicOn).toBe(false);
    expect(prefs().sfxOn).toBe(true);
    expect(musicVolume().disabled).toBe(true);
    // La grille n'est pas éteinte : on peut choisir l'ambiance qui jouera au retour de la musique.
    const group = auto().closest('fieldset')!;
    expect(group.disabled).toBe(false);
    expect(group.classList.contains('is-off')).toBe(true);
    await user.click(scene('quest'));
    expect(prefs().scene).toBe('quest');
    expect(prefs().musicOn).toBe(false);
    expect(effectsVolume().disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem('bureau.audio.v1')!).musicOn).toBe(false);
    await user.click(musicSwitch());
    expect(prefs().musicOn).toBe(true);
    expect(musicVolume().disabled).toBe(false);
    expect(group.classList.contains('is-off')).toBe(false);
  });

  test('couper les effets : leur volume et l\'exemple s\'éteignent, la musique ne bouge pas', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(effectsSwitch());
    expect(prefs().sfxOn).toBe(false);
    expect(prefs().musicOn).toBe(true);
    expect(effectsVolume().disabled).toBe(true);
    expect((screen.getByRole('button', { name: fr.sound.effects.test }) as HTMLButtonElement).disabled).toBe(true);
    expect(musicVolume().disabled).toBe(false);
  });

  test('les curseurs règlent chacun leur volume, de 0 à 1', () => {
    render(<Harness />);
    fireEvent.change(musicVolume(), { target: { value: '0' } });
    expect(prefs().musicVolume).toBe(0);
    expect(prefs().sfxVolume).toBe(DEFAULT_AUDIO_PREFS.sfxVolume);
    fireEvent.change(effectsVolume(), { target: { value: '100' } });
    expect(prefs().sfxVolume).toBe(1);
    fireEvent.change(musicVolume(), { target: { value: '35' } });
    expect(prefs().musicVolume).toBe(0.35);
  });
});

describe('les ambiances', () => {
  test('« Selon l\'endroit » et les six cartes sont les boutons radio d\'un seul groupe', () => {
    render(<Harness />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(1 + SCENE_IDS.length);
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(radios[0]!.name).not.toBe('');
    expect(auto().checked).toBe(true);
    // Le groupe a un nom, pour les lecteurs d'écran (sans titre à l'écran : les cartes parlent d'elles-mêmes).
    expect(screen.getByRole('group', { name: fr.sound.ambiance.label })).toBeTruthy();
  });

  test('choisir une ambiance appelle setPrefs({ scene }) : elle joue partout ; « Selon l\'endroit » rend la main au lieu', async () => {
    const user = userEvent.setup();
    const setPrefs = vi.fn(useAudioStore.getState().setPrefs);
    useAudioStore.setState({ setPrefs });
    render(<Harness />);
    await user.click(scene('quest'));
    expect(setPrefs).toHaveBeenLastCalledWith({ scene: 'quest' });
    expect(prefs().scene).toBe('quest');
    expect(scene('quest').checked).toBe(true);
    expect(auto().checked).toBe(false);
    await user.click(auto());
    expect(setPrefs).toHaveBeenLastCalledWith({ scene: 'auto' });
    expect(prefs().scene).toBe('auto');
  });

  test('un clic sur le titre d\'une carte (son libellé) la choisit aussi', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText(fr.sound.scenes.drift.title));
    expect(prefs().scene).toBe('drift');
  });

  test('« Selon l\'endroit » dit l\'ambiance de l\'endroit où l\'on est, avec sa pochette', () => {
    useAudioStore.setState({ place: 'dusk' });
    const { rerender } = render(<Harness />);
    const card = auto().closest('label')!;
    expect(card.textContent).toContain(t(fr.sound.ambiance.autoHere, { scene: fr.sound.scenes.dusk.title }));
    expect(card.querySelector('canvas')?.getAttribute('data-cover')).toBe('dusk');
    // Le lieu change : le sous-titre et la pochette le suivent.
    useAudioStore.setState({ place: 'drift' });
    rerender(<Harness />);
    expect(card.textContent).toContain(t(fr.sound.ambiance.autoHere, { scene: fr.sound.scenes.drift.title }));
    expect(card.querySelector('canvas')?.getAttribute('data-cover')).toBe('drift');
  });

  test('chaque carte : sa pochette (16 × 10) et son titre ; ce qu\'elle évoque et où elle joue sont en infobulle, et décrits aux lecteurs d\'écran', () => {
    render(<Harness />);
    for (const id of SCENE_IDS) {
      const radio = scene(id);
      const card = radio.closest('label')!;
      const canvas = card.querySelector('canvas')!;
      expect(canvas.getAttribute('data-cover')).toBe(id);
      expect([canvas.width, canvas.height]).toEqual([16, 10]);
      expect(card.textContent).toBe(fr.sound.scenes[id].title);
      const description = `${fr.sound.scenes[id].mood} · ${fr.sound.scenes[id].where}`;
      expect(card.getAttribute('title')).toBe(description);
      expect(radio.getAttribute('aria-description')).toBe(description);
    }
    expect(Object.keys(COVERS)).toHaveLength(SCENE_IDS.length);
  });

  test('celle qui joue a son égaliseur ; les autres, non ; on le dit aux lecteurs d\'écran', () => {
    useAudioStore.setState({ playing: 'sunny' });
    render(<Harness />);
    const playing = jukebox().querySelectorAll('.juke-eq');
    expect(playing).toHaveLength(1);
    expect(playing[0]!.closest('label')?.textContent).toBe(fr.sound.scenes.sunny.title);
    expect(playing[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(scene('sunny').getAttribute('aria-description')).toContain(fr.sound.ambiance.playing);
    expect(scene('focus').getAttribute('aria-description')).not.toContain(fr.sound.ambiance.playing);
    expect(jukebox().querySelector('[data-playing="true"]')?.textContent).toBe(fr.sound.scenes.sunny.title);
  });

  test('rien ne joue (musique coupée) : pas d\'égaliseur', () => {
    useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS, musicOn: false }, playing: null });
    render(<Harness />);
    expect(jukebox().querySelector('.juke-eq')).toBeNull();
  });
});

describe('le reste de la fenêtre', () => {
  test('tant que le navigateur n\'a pas laissé le son démarrer, la fenêtre le dit ; sans Web Audio aussi ; sinon rien', () => {
    useAudioStore.setState({ status: 'locked' });
    const { rerender } = render(<Harness />);
    expect(within(jukebox()).getByRole('status').textContent).toBe(fr.sound.status.locked);
    useAudioStore.setState({ status: 'unsupported' });
    rerender(<Harness />);
    expect(within(jukebox()).getByRole('status').textContent).toBe(fr.sound.status.unsupported);
    useAudioStore.setState({ status: 'running' });
    rerender(<Harness />);
    expect(within(jukebox()).queryByRole('status')).toBeNull();
  });

  test('« Écouter un effet » joue un exemple, sans bruit de clic à lui', async () => {
    const play = vi.spyOn(audioEngine, 'playSfx').mockImplementation(() => {});
    render(<Harness />);
    const button = screen.getByRole('button', { name: fr.sound.effects.test });
    expect(button.getAttribute('data-sfx')).toBe('none');
    await userEvent.click(button);
    expect(play).toHaveBeenCalledWith('message');
  });

  test('les crédits de la musique et des effets sont là', () => {
    render(<Harness />);
    expect(screen.getByText(fr.sound.credits)).toBeTruthy();
  });

  test('le focus entre dans la fenêtre à l\'ouverture (l\'interrupteur de la musique) ; Échap la ferme et rend le focus au bouton', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    expect(document.activeElement).toBe(musicSwitch());
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ancre' }));
  });

  test('un clic dehors la ferme ; un clic dedans, non', async () => {
    const onClose = vi.fn();
    render(
      <>
        <p>Ailleurs</p>
        <Harness onClose={onClose} />
      </>,
    );
    await userEvent.click(scene('focus'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Ailleurs'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
