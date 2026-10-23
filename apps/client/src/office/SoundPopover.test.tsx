import { buildOfficeTiledMap, parseOfficeMap, placeByKey, type PublicPlayer } from '@bureau/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { audioEngine } from '../audio/audio';
import { useAudioStore } from '../audio/audio-store';
import { scenesOfTheme, type SceneId } from '../audio/catalog';
import { DEFAULT_AUDIO_PREFS } from '../audio/prefs';
import { bindKeyboard, DirectionInput } from '../game/input';
import { fr } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { SoundPopover } from './SoundPopover';

// La grande carte : on est dans la salle de jeu (son ambiance par défaut : le crépuscule).
const map = parseOfficeMap(buildOfficeTiledMap());
const game = placeByKey(map, 'game')!.rects[0]!;
const me: PublicPlayer = { id: 'moi', name: 'Moi', avatarKey: null, x: game.x + game.width / 2, y: game.y + game.height / 2, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } };

beforeEach(() => {
  localStorage.clear();
  useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS }, status: 'running', playing: null, place: 'dusk', placeKey: 'game' });
  useOfficeStore.getState().reset();
  act(() => {
    useOfficeStore.getState().applyInit({ self: me, players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] });
    useOfficeStore.getState().setOfficeMap(map);
  });
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
const sourceTab = (source: 'room' | 'mine') => screen.getByRole('tab', { name: fr.sound.source[source] });
const card = (title: string) => screen.getByRole('region', { name: title });
const changeMine = () => screen.getByRole('button', { name: new RegExp(`^${fr.sound.mine.change}`) });
const row = (id: SceneId) => screen.getByRole('button', { name: new RegExp(`^${fr.sound.scenes[id].title}`) });

describe('le juke-box', () => {
  test('fermé, il n\'y a rien dans la page ; ouvert, une fenêtre « Musique et ambiances »', () => {
    const { rerender } = render(<Harness open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Harness />);
    expect(jukebox().getAttribute('data-placement')).toBe('top');
  });

  test('deux interrupteurs, deux volumes : les réglages du moment', () => {
    useAudioStore.setState({ prefs: { musicOn: true, musicVolume: 0.25, sfxOn: false, sfxVolume: 1, scene: 'dusk' } });
    render(<Harness />);
    expect(musicSwitch().checked).toBe(true);
    expect(effectsSwitch().checked).toBe(false);
    expect(musicVolume().value).toBe('25');
    expect(musicVolume().getAttribute('aria-valuetext')).toBe('25 %');
    expect(effectsVolume().value).toBe('100');
  });

  test('couper la musique : son volume s\'éteint, « J\'écoute » reste utilisable (en retrait), les effets ne bougent pas ; le réglage est enregistré', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(musicSwitch());
    expect(prefs().musicOn).toBe(false);
    expect(musicVolume().disabled).toBe(true);
    const listen = sourceTab('room').closest('.juke-listen')!;
    expect(listen.classList.contains('is-off')).toBe(true);
    await user.click(sourceTab('mine'));
    expect(prefs().scene).not.toBe('auto');
    expect(effectsVolume().disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem('bureau.audio.v1')!).musicOn).toBe(false);
    await user.click(musicSwitch());
    expect(musicVolume().disabled).toBe(false);
    expect(listen.classList.contains('is-off')).toBe(false);
  });

  test('couper les effets : leur volume et l\'exemple s\'éteignent, la musique ne bouge pas', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(effectsSwitch());
    expect(prefs().sfxOn).toBe(false);
    expect(prefs().musicOn).toBe(true);
    expect(effectsVolume().disabled).toBe(true);
    expect((screen.getByRole('button', { name: fr.sound.effects.test }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('les curseurs règlent chacun leur volume, de 0 à 1', () => {
    render(<Harness />);
    fireEvent.change(musicVolume(), { target: { value: '0' } });
    expect(prefs().musicVolume).toBe(0);
    expect(prefs().sfxVolume).toBe(DEFAULT_AUDIO_PREFS.sfxVolume);
    fireEvent.change(effectsVolume(), { target: { value: '35' } });
    expect(prefs().sfxVolume).toBe(0.35);
  });
});

describe('« J\'écoute » : la pièce ou ma musique', () => {
  test('par défaut, la pièce : sa carte dit pour qui elle joue et ce qu\'elle joue, et sa vignette ouvre la liste', () => {
    render(<Harness />);
    expect(sourceTab('room').getAttribute('aria-selected')).toBe('true');
    const room = card(fr.roomMusic.title);
    expect(room.textContent).toContain('pour tout le monde ici');
    expect(room.textContent).toContain(fr.sound.scenes.dusk.title);
    expect(room.textContent).toContain(fr.roomMusic.default);
    expect(room.querySelector('canvas')?.getAttribute('data-cover')).toBe('dusk');
    expect(within(room).getByRole('button', { name: `${fr.roomMusic.change} : ${fr.sound.scenes.dusk.title}` })).toBeTruthy();
    expect(screen.queryByRole('region', { name: fr.sound.mine.title })).toBeNull();
  });

  test('passer à « Ma musique » garde ce qu\'on entend ; sa carte dit qu\'elle n\'est que pour soi ; revenir à la pièce rend la main au lieu', async () => {
    const user = userEvent.setup();
    useAudioStore.setState({ playing: 'dusk' });
    render(<Harness />);
    await user.click(sourceTab('mine'));
    expect(prefs().scene).toBe('dusk');
    const mine = card(fr.sound.mine.title);
    expect(mine.textContent).toContain(fr.sound.mine.audience);
    expect(mine.textContent).toContain(fr.sound.mine.note);
    expect(screen.queryByRole('region', { name: fr.roomMusic.title })).toBeNull();
    await user.click(sourceTab('room'));
    expect(prefs().scene).toBe('auto');
  });

  test('l\'égaliseur est sur la vignette de ce qu\'on entend', () => {
    useAudioStore.setState({ playing: 'dusk' });
    render(<Harness />);
    expect(card(fr.roomMusic.title).querySelectorAll('.juke-eq')).toHaveLength(1);
    act(() => useAudioStore.setState({ playing: null }));
    expect(jukebox().querySelector('.juke-eq')).toBeNull();
  });
});

describe('la liste des musiques', () => {
  test('la vignette de « Ma musique » ouvre la liste sur le thème de la musique en cours ; le thème n\'affiche que ses musiques', async () => {
    const user = userEvent.setup();
    useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS, scene: 'tempest-call' } });
    render(<Harness />);
    await user.click(changeMine());
    expect(screen.getByRole('tab', { name: fr.sound.themes.pirate }).getAttribute('aria-selected')).toBe('true');
    expect(row('tempest-call').getAttribute('aria-current')).toBe('true');
    const list = screen.getByRole('tabpanel');
    expect(within(list).getAllByRole('button')).toHaveLength(scenesOfTheme('pirate').length);
    expect(within(list).queryByRole('button', { name: new RegExp(`^${fr.sound.scenes.dusk.title}`) })).toBeNull();
    // Pas de « Par défaut de la pièce » pour sa musique à soi.
    expect(screen.queryByRole('button', { name: new RegExp(`^${fr.roomMusic.default}`) })).toBeNull();

    await user.click(screen.getByRole('tab', { name: fr.sound.themes.default }));
    expect(within(screen.getByRole('tabpanel')).getAllByRole('button')).toHaveLength(scenesOfTheme('default').length);
    expect(row('dusk')).toBeTruthy();
  });

  test('une ligne choisit sa musique tout de suite, et la liste reste ouverte ; « Retour » ramène à la fenêtre, le focus sur la vignette', async () => {
    const user = userEvent.setup();
    useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS, scene: 'quest' } });
    render(<Harness />);
    await user.click(changeMine());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: fr.sound.picker.back }));
    await user.click(screen.getByRole('tab', { name: fr.sound.themes.pirate }));
    await user.click(row('silent-harbor'));
    expect(prefs().scene).toBe('silent-harbor');
    expect(row('silent-harbor').getAttribute('aria-current')).toBe('true');
    expect(row('silent-harbor').querySelector('svg.lucide')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: fr.sound.picker.back }));
    expect(document.activeElement).toBe(changeMine());
    expect(changeMine().getAttribute('aria-label')).toBe(`${fr.sound.mine.change} : ${fr.sound.scenes['silent-harbor'].title}`);
  });

  test('Échap dans la liste revient à la fenêtre sans la fermer ; un second Échap la ferme', async () => {
    const onClose = vi.fn();
    useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS, scene: 'quest' } });
    render(<Harness onClose={onClose} />);
    await userEvent.click(changeMine());
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(card(fr.sound.mine.title)).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('chaque ligne : sa pochette et son nom ; ce que la musique évoque (et, pour les ambiances du bureau, où elle joue) en infobulle ; celle qu\'on entend est dite', async () => {
    useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS, scene: 'sunny' }, playing: 'sunny' });
    render(<Harness />);
    await userEvent.click(changeMine());
    expect(row('sunny').querySelector('canvas')?.getAttribute('data-cover')).toBe('sunny');
    expect(row('sunny').getAttribute('title')).toBe(`${fr.sound.scenes.sunny.mood} · ${fr.sound.scenes.sunny.where}`);
    expect(row('sunny').getAttribute('aria-description')).toContain(fr.sound.picker.playing);
    expect(row('focus').getAttribute('aria-description')).not.toContain(fr.sound.picker.playing);
    await userEvent.click(screen.getByRole('tab', { name: fr.sound.themes.pirate }));
    expect(row('foggy-shores').getAttribute('title')).toBe(fr.sound.scenes['foggy-shores'].mood);
  });

  test('fermer la fenêtre pendant le choix : elle se rouvre sur ses cartes', async () => {
    useAudioStore.setState({ prefs: { ...DEFAULT_AUDIO_PREFS, scene: 'quest' } });
    const { rerender } = render(<Harness />);
    await userEvent.click(changeMine());
    rerender(<Harness open={false} />);
    rerender(<Harness />);
    expect(card(fr.sound.mine.title)).toBeTruthy();
  });
});

// Les flèches sont aussi celles de l'avatar (game/input.ts), qui ne les ignore que dans un champ où l'on écrit : un onglet ou un curseur de volume, qui
// les prennent pour eux, ne le sont pas. Dans le juke-box, elles ne vont pas jusqu'à lui.
describe('le clavier', () => {
  test('les flèches dans le juke-box (onglets, curseurs, interrupteurs) ne font pas marcher l\'avatar ; hors de lui, si', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      render(<Harness />);
      // « J'écoute » : → passe à « Ma musique ».
      sourceTab('room').focus();
      await user.keyboard('{ArrowRight>}');
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowRight}');
      expect(sourceTab('mine').getAttribute('aria-selected')).toBe('true');
      musicVolume().focus();
      await user.keyboard('{ArrowLeft>}');
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowLeft}');
      musicSwitch().focus();
      await user.keyboard('{ArrowDown>}');
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowDown}');

      // Le même geste hors du juke-box (sur le bouton qui l'ouvre) fait marcher l'avatar : le test éprouve bien ce qu'il dit.
      screen.getByRole('button', { name: 'Ancre' }).focus();
      await user.keyboard('{ArrowRight>}');
      expect(directions.current()).toBe('right');
    } finally {
      unbind();
    }
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
    await userEvent.click(sourceTab('mine'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Ailleurs'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
