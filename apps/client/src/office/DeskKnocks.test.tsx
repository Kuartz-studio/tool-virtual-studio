import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { DESK_NOTICE_MS, DeskKnocks } from './DeskKnocks';

beforeEach(() => {
  useOfficeStore.getState().reset();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const socket = new FakeSocket();
  socket.serverAccepts();
  render(<DeskKnocks socket={socket.asSocket()} />);
  return socket;
}

test('rien à dire : rien dans la page', () => {
  setup();
  expect(screen.queryByRole('status')).toBeNull();
});

describe('ceux qui toquent', () => {
  test('chacun a sa ligne, avec « Laisser entrer » (admit) et « Ignorer »', async () => {
    const user = userEvent.setup();
    const socket = setup();
    act(() => {
      useOfficeStore.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' });
      useOfficeStore.getState().addDeskKnock({ key: 'A1', userId: 'zoe', name: 'Zoé' });
    });
    expect(screen.getByText(t(fr.desk.knockToast, { name: 'Bob' }))).toBeTruthy();
    expect(screen.getByText(t(fr.desk.knockToast, { name: 'Zoé' }))).toBeTruthy();

    await user.click(screen.getByRole('button', { name: t(fr.desk.admitLabel, { name: 'Bob' }) }));
    expect(socket.sentOf('desk:do')).toEqual([{ type: 'admit', userId: 'bob' }]);
    expect(screen.queryByText(t(fr.desk.knockToast, { name: 'Bob' }))).toBeNull();

    await user.click(screen.getByRole('button', { name: t(fr.desk.ignoreLabel, { name: 'Zoé' }) }));
    expect(socket.sentOf('desk:do')).toHaveLength(1);   // ignorer n'envoie rien
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('quelqu\'un qui retoque ne double pas sa ligne', () => {
    setup();
    act(() => {
      useOfficeStore.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' });
      useOfficeStore.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' });
    });
    expect(screen.getAllByText(t(fr.desk.knockToast, { name: 'Bob' }))).toHaveLength(1);
  });
});

describe('le message passager', () => {
  test('il s\'affiche, annoncé aux lecteurs d\'écran, puis s\'efface de lui-même', () => {
    vi.useFakeTimers();
    setup();
    act(() => useOfficeStore.getState().setDeskNotice('Porte fermée.'));
    expect(screen.getByRole('status').textContent).toBe('Porte fermée.');
    act(() => {
      vi.advanceTimersByTime(DESK_NOTICE_MS - 1);
    });
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(useOfficeStore.getState().deskNotice).toBeNull();
  });

  test('un nouveau message repart de zéro', () => {
    vi.useFakeTimers();
    setup();
    act(() => useOfficeStore.getState().setDeskNotice('Un.'));
    act(() => {
      vi.advanceTimersByTime(DESK_NOTICE_MS - 100);
    });
    act(() => useOfficeStore.getState().setDeskNotice('Deux.'));
    act(() => {
      vi.advanceTimersByTime(DESK_NOTICE_MS - 100);
    });
    expect(screen.getByRole('status').textContent).toBe('Deux.');
  });
});
