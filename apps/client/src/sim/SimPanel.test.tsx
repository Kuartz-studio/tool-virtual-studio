import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { fakeApi, json, sentBody } from '../test/fake-api';
import { SimPanel } from './SimPanel';
import type { SimBot, SimState } from './sim-api';

const bot = (id: string, name: string, audio: string | null = null): SimBot => ({ id, name, avatarKey: 'dev-red', audio, x: 80, y: 208, target: null });
const FILES = [
  { file: 'a.mp3', url: '/api/sim/audio/a.mp3', size: 10 },
  { file: 'b.wav', url: '/api/sim/audio/b.wav', size: 20 },
];

// Un faux serveur de faux live : l'état du moment, que les actions changent comme les vraies routes.
function server(initial: Partial<SimState> = {}) {
  const state: SimState = { bots: [], audio: FILES, ...initial };
  const api = fakeApi({
    'GET /api/sim': () => json(200, state),
    'POST /api/sim/bots': () => {
      const created = bot(`sim-${state.bots.length + 1}`, `Fictif ${state.bots.length + 1}`);
      state.bots.push(created);
      return json(201, created);
    },
    'PATCH /api/sim/bots/sim-1': (init) => {
      state.bots[0]!.audio = JSON.parse(String(init?.body)).audio;
      return json(200, state.bots[0]);
    },
    'DELETE /api/sim/bots/sim-1': () => {
      state.bots.splice(0, 1);
      return new Response(null, { status: 204 });
    },
    'POST /api/sim/audio?name=nouveau.mp3': () => {
      state.audio = [...state.audio, { file: 'nouveau.mp3', url: '/api/sim/audio/nouveau.mp3', size: 5 }];
      return json(201, state.audio.at(-1));
    },
  });
  return { state, api };
}

describe('SimPanel', () => {
  test('liste les personnes fictives et les fichiers disponibles', async () => {
    server({ bots: [bot('sim-1', 'Léa', 'a.mp3'), bot('sim-2', 'Zoé')] });
    render(<SimPanel onClose={() => {}} />);
    const lea = await screen.findByRole('combobox', { name: t(fr.sim.audioLabel, { name: 'Léa' }) });
    expect((lea as HTMLSelectElement).value).toBe('a.mp3');
    expect(within(lea).getAllByRole('option').map((o) => o.textContent)).toEqual([fr.sim.silence, 'a.mp3', 'b.wav']);
    expect((screen.getByRole('combobox', { name: t(fr.sim.audioLabel, { name: 'Zoé' }) }) as HTMLSelectElement).value).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: fr.sim.title }));
  });

  test('sans personne ni fichier : les deux indications', async () => {
    server({ audio: [] });
    render(<SimPanel onClose={() => {}} />);
    expect(await screen.findByText(fr.sim.empty)).toBeTruthy();
    expect(screen.getByText(fr.sim.noAudio)).toBeTruthy();
  });

  test('« Ajouter une personne » en fait apparaître une, aussitôt listée', async () => {
    const { api } = server();
    render(<SimPanel onClose={() => {}} />);
    await screen.findByText(fr.sim.empty);
    await userEvent.click(screen.getByRole('button', { name: fr.sim.add }));
    expect(await screen.findByRole('combobox', { name: t(fr.sim.audioLabel, { name: 'Fictif 1' }) })).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/api/sim/bots', expect.objectContaining({ method: 'POST' }));
  });

  test('choisir un fichier l\'attribue à la personne ; « Silence » le retire', async () => {
    const { api } = server({ bots: [bot('sim-1', 'Léa')] });
    render(<SimPanel onClose={() => {}} />);
    const select = await screen.findByRole('combobox', { name: t(fr.sim.audioLabel, { name: 'Léa' }) });
    await userEvent.selectOptions(select, 'b.wav');
    await waitFor(() => expect(sentBody(api, 'PATCH /api/sim/bots/sim-1')).toEqual({ audio: 'b.wav' }));
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('b.wav'));
    await userEvent.selectOptions(select, fr.sim.silence);
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(''));
  });

  test('« Retirer » la retire de la liste', async () => {
    server({ bots: [bot('sim-1', 'Léa')] });
    render(<SimPanel onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: t(fr.sim.remove, { name: 'Léa' }) }));
    expect(await screen.findByText(fr.sim.empty)).toBeTruthy();
  });

  test('importer un fichier l\'envoie au serveur et l\'ajoute aux choix', async () => {
    const { api } = server({ bots: [bot('sim-1', 'Léa')] });
    const { container } = render(<SimPanel onClose={() => {}} />);
    const select = await screen.findByRole('combobox', { name: t(fr.sim.audioLabel, { name: 'Léa' }) });
    const input = container.querySelector('input[type="file"]')!;
    await userEvent.upload(input as HTMLInputElement, new File(['son'], 'nouveau.mp3', { type: 'audio/mpeg' }));
    await waitFor(() => expect(within(select).getByRole('option', { name: 'nouveau.mp3' })).toBeTruthy());
    const upload = api.mock.calls.find(([input]) => String(input) === '/api/sim/audio?name=nouveau.mp3')!;
    expect(upload[1]?.method).toBe('POST');
    expect(new Headers(upload[1]?.headers).get('Content-Type')).toBe('audio/mpeg');
  });

  test('une action qui échoue s\'écrit dans le panneau', async () => {
    fakeApi({
      'GET /api/sim': () => json(200, { bots: [], audio: [] }),
      'POST /api/sim/bots': () => json(500, { error: 'unexpected' }),
    });
    render(<SimPanel onClose={() => {}} />);
    await screen.findByText(fr.sim.empty);
    await userEvent.click(screen.getByRole('button', { name: fr.sim.add }));
    expect(await screen.findByText(fr.sim.actionFailed)).toBeTruthy();
  });

  test('l\'état illisible s\'écrit dans le panneau', async () => {
    fakeApi({ 'GET /api/sim': () => json(401, { error: 'unauthorized' }) });
    render(<SimPanel onClose={() => {}} />);
    expect(await screen.findByText(fr.sim.loadFailed)).toBeTruthy();
  });

  test('Échap et ✕ ferment', async () => {
    server();
    const onClose = vi.fn();
    render(<SimPanel onClose={onClose} />);
    await screen.findByText(fr.sim.empty);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: fr.sim.close }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
