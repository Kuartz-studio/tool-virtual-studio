import type { PublicPlayer, TaskView } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import * as progressApi from '../lib/progress-api';
import { useOfficeStore } from '../state/office-store';
import { fakeApi, json } from '../test/fake-api';
import { FakeSocket } from '../test/fake-socket';
import { ClerkDialog } from './ClerkDialog';

const self: PublicPlayer = { id: 'ana', name: 'Ana', avatarKey: null, x: 80, y: 240, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } };
const MEMBERS = [
  { id: 'ana', name: 'Ana', avatarKey: null, lastSeenAt: null, level: 26 },
  { id: 'bob', name: 'Bob', avatarKey: null, lastSeenAt: null, level: 1 },
  { id: 'eli', name: 'Élise', avatarKey: null, lastSeenAt: null, level: 3 },
];
const given = (over: Partial<TaskView> = {}): TaskView => ({
  id: 'm1',
  kind: 'mission',
  title: 'Refaire le logo',
  notes: null,
  tier: 7,
  xp: 1250,
  status: 'open',
  createdAt: '2026-10-24T08:00:00.000Z',
  doneAt: null,
  owner: { id: 'bob', name: 'Bob' },
  giver: { id: 'ana', name: 'Ana' },
  seen: false,
  ...over,
});

// La conversation est ouverte (le jeu l'a demandée au magasin) ; les répliques s'écrivent d'un coup (mouvement réduit), pour que le test lise tout.
function open(socket: FakeSocket, onOpenPanel = vi.fn()) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
  act(() => {
    useOfficeStore.getState().applyInit({ self, players: [], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] });
    useOfficeStore.getState().openClerk('ines');
  });
  render(<ClerkDialog socket={socket.asSocket()} onOpenPanel={onOpenPanel} />);
  return { onOpenPanel, dialog: () => screen.getByRole('dialog', { name: t(fr.clerks.dialogLabel, { name: 'Inès' }) }) };
}

beforeEach(() => {
  useOfficeStore.getState().reset();
});

describe('la conversation avec une administratrice', () => {
  test('elle salue par son nom, et propose ses réponses ; « Au revoir » la ferme', async () => {
    const socket = new FakeSocket().connect();
    socket.serverAccepts();
    const user = userEvent.setup();
    const { dialog } = open(socket);
    expect(within(dialog()).getByText('Inès')).toBeTruthy();
    expect(dialog().textContent).toContain(t(fr.clerks.greetings.ines, { name: 'Ana' }));
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.menu.bye }));
    expect(useOfficeStore.getState().clerk).toBeNull();
  });

  test('confier une mission : à qui (soi en tête, « Moi »), quoi, quelle difficulté, le récapitulatif, puis l\'envoi par la connexion', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    const socket = new FakeSocket().connect();
    socket.serverAccepts();
    const user = userEvent.setup();
    const { dialog } = open(socket);
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.menu.give }));
    await within(dialog()).findAllByRole('button', { name: /Bob|Élise/ });
    const people = within(dialog()).getAllByRole('listitem').map((item) => item.querySelector('.clerk-person-name')?.textContent);
    expect(people).toEqual([fr.clerks.me, 'Bob', 'Élise']);
    // La recherche ignore les accents.
    await user.type(within(dialog()).getByLabelText(fr.clerks.whoSearchLabel), 'elise');
    expect(within(dialog()).queryByText('Bob')).toBeNull();
    await user.click(within(dialog()).getByRole('button', { name: /Élise/ }));

    await user.type(within(dialog()).getByLabelText(fr.clerks.titleLabel), 'Refaire le logo');
    await user.type(within(dialog()).getByLabelText(fr.clerks.notesLabel), 'Le K en violet');
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.next }));
    await user.click(within(dialog()).getByRole('radio', { name: /^7/ }));
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.next }));
    expect(dialog().textContent).toContain('Je résume : Élise doit « Refaire le logo ». Difficulté 7 sur 10 (Ambitieuse)');
    expect(dialog().textContent).toContain('1,25 niveau');

    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.confirm }));
    expect(socket.sentOf('mission:give')).toEqual([{ to: 'eli', title: 'Refaire le logo', notes: 'Le K en violet', tier: 7 }]);
    await act(async () => socket.serverAcks('mission:give', { ok: true, task: given({ owner: { id: 'eli', name: 'Élise' } }) }));
    expect(dialog().textContent).toContain(t(fr.clerks.sent, { name: 'Élise' }));
    expect(useOfficeStore.getState().given?.map((task) => task.id)).toEqual(['m1']);
  });

  test('se confier une mission : la conversation le dit à la deuxième personne, et elle n\'est pas de celles qu\'on a confiées', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    const socket = new FakeSocket().connect();
    socket.serverAccepts();
    const user = userEvent.setup();
    const { dialog } = open(socket);
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.menu.give }));
    // « moi » trouve soi.
    await within(dialog()).findAllByRole('button', { name: /Bob/ });
    await user.type(within(dialog()).getByLabelText(fr.clerks.whoSearchLabel), 'moi');
    expect(within(dialog()).queryByText('Bob')).toBeNull();
    await user.click(within(dialog()).getByText(fr.clerks.me));

    expect(dialog().textContent).toContain(fr.clerks.whatSelf);
    await user.type(within(dialog()).getByLabelText(fr.clerks.titleLabel), 'Ranger mes fichiers');
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.next }));
    await user.click(within(dialog()).getByRole('radio', { name: /^4/ }));
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.next }));
    expect(dialog().textContent).toContain('Je résume : tu te donnes « Ranger mes fichiers ». Difficulté 4 sur 10');

    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.confirm }));
    expect(socket.sentOf('mission:give')).toEqual([{ to: 'ana', title: 'Ranger mes fichiers', tier: 4 }]);
    await act(async () => socket.serverAcks('mission:give', { ok: true, task: given({ owner: { id: 'ana', name: 'Ana' }, seen: true }) }));
    expect(dialog().textContent).toContain(fr.clerks.sentSelf);
    expect(useOfficeStore.getState().given).toBeNull();
  });

  test('un refus du serveur se dit dans la conversation : trop loin du comptoir', async () => {
    fakeApi({ 'GET /api/members': () => json(200, MEMBERS) });
    const socket = new FakeSocket().connect();
    socket.serverAccepts();
    const user = userEvent.setup();
    const { dialog } = open(socket);
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.menu.give }));
    await user.click(await within(dialog()).findByRole('button', { name: /Bob/ }));
    await user.type(within(dialog()).getByLabelText(fr.clerks.titleLabel), 'Ranger');
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.next }));
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.next }));
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.confirm }));
    await act(async () => socket.serverAcks('mission:give', { ok: false, error: 'too_far' }));
    expect(within(dialog()).getByRole('alert').textContent).toBe(fr.clerks.errors.too_far);
  });

  test('les missions confiées : leur état, et « Retirer » pour celles qui ne sont pas faites', async () => {
    vi.mocked(progressApi.listGivenMissions).mockResolvedValueOnce([given(), given({ id: 'm2', title: 'Appeler le client', status: 'done' })]);
    vi.mocked(progressApi.cancelMission).mockResolvedValueOnce(given({ status: 'cancelled' }));
    const socket = new FakeSocket().connect();
    socket.serverAccepts();
    const user = userEvent.setup();
    const { dialog } = open(socket);
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.menu.given }));
    expect(await within(dialog()).findByText('Refaire le logo')).toBeTruthy();
    expect(within(dialog()).getAllByRole('button', { name: /^Retirer/ })).toHaveLength(1);
    await user.click(within(dialog()).getByRole('button', { name: t(fr.clerks.cancelLabel, { title: 'Refaire le logo' }) }));
    expect(progressApi.cancelMission).toHaveBeenCalledWith('m1');
    expect(within(dialog()).queryAllByRole('button', { name: /^Retirer/ })).toHaveLength(0);
  });

  test('« La boutique » et « Mes caractéristiques » ferment la conversation et ouvrent leur panneau', async () => {
    const socket = new FakeSocket().connect();
    socket.serverAccepts();
    const user = userEvent.setup();
    const { dialog, onOpenPanel } = open(socket);
    await user.click(within(dialog()).getByRole('button', { name: fr.clerks.menu.shop }));
    expect(onOpenPanel).toHaveBeenCalledWith('shop');
    expect(useOfficeStore.getState().clerk).toBeNull();
  });
});
