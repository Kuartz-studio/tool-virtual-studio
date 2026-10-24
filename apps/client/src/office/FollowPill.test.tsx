import type { PublicPlayer } from '@bureau/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { listenOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { FollowPill } from './FollowPill';

const player = (id: string, name: string): PublicPlayer => ({ id, name, avatarKey: null, x: 0, y: 0, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } });

const heard: Array<string | null> = [];
let stop = () => {};
beforeEach(() => {
  useOfficeStore.getState().reset();
  act(() => useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [player('bob', 'Bob')], mapKey: 'office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] }));
  heard.length = 0;
  stop = listenOnBus(EventBus, 'local:follow', ({ id }) => heard.push(id));
});
afterEach(() => stop());

test('rien tant qu\'on ne suit personne ; « Tu suis Bob » pendant, et la croix arrête', async () => {
  render(<FollowPill />);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => useOfficeStore.getState().setFollowing('bob'));
  expect(screen.getByRole('status').textContent).toContain(t(fr.person.following, { name: 'Bob' }));
  await userEvent.click(screen.getByRole('button', { name: fr.person.stop }));
  expect(heard).toEqual([null]);
  act(() => useOfficeStore.getState().setFollowing(null));
  expect(screen.queryByRole('status')).toBeNull();
});
