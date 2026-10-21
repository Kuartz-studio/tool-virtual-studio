import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeChannel } from '../test/fake-broadcast-channel';
import { CLAIM_EVERY_MS, useSingleTab } from './single-tab';

// Un onglet : le hook, dont le test lit ce qu'il rend.
function Tab({ onYield }: { onYield(yielded: boolean): void }) {
  onYield(useSingleTab());
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
  FakeChannel.all = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('un seul onglet joue du son', () => {
  test('un onglet qu\'on n\'a pas touché ne dit rien et ne se tait pas', () => {
    const seen: boolean[] = [];
    render(<Tab onYield={(yielded) => seen.push(yielded)} />);
    expect(seen.at(-1)).toBe(false);
    expect(FakeChannel.all[0]!.posted).toEqual([]);
  });

  test('un geste dit aux autres onglets que celui-ci joue : ils se taisent ; quand un autre prend la main, celui-ci se tait, et reprend à son prochain geste', () => {
    const seen: boolean[] = [];
    render(<Tab onYield={(yielded) => seen.push(yielded)} />);
    // L'autre onglet : un canal à lui (dans happy-dom, les deux onglets partageraient la même fenêtre, donc les mêmes gestes).
    const other = new FakeChannel('bureau.audio.owner');
    const heard = vi.fn();
    other.onmessage = heard;

    // Un geste ici : l'autre onglet l'apprend.
    act(() => void fireEvent.pointerDown(document.body));
    expect(seen.at(-1)).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0]![0].data).toMatchObject({ owner: expect.any(String) });

    // Un geste dans l'autre onglet : celui-ci se tait.
    act(() => other.postMessage({ owner: 'un-autre-onglet' }));
    expect(seen.at(-1)).toBe(true);

    // Il reprend la main au premier geste, et le redit tout de suite (même dans le délai de repos : il n'était plus le dernier).
    act(() => void fireEvent.pointerDown(document.body));
    expect(seen.at(-1)).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  test('un onglet qui a déjà la main ne le répète pas à chaque touche, mais le redit après un moment', () => {
    render(<Tab onYield={() => {}} />);
    const [channel] = FakeChannel.all as [FakeChannel];
    act(() => void fireEvent.keyDown(document.body, { key: 'a' }));
    act(() => void fireEvent.keyDown(document.body, { key: 'b' }));
    act(() => void fireEvent.keyDown(document.body, { key: 'c' }));
    expect(channel.posted).toHaveLength(1);
    vi.setSystemTime(Date.now() + CLAIM_EVERY_MS + 1);
    act(() => void fireEvent.keyDown(document.body, { key: 'd' }));
    expect(channel.posted).toHaveLength(2);
  });

  test('son propre message ne le fait pas se taire', () => {
    const seen: boolean[] = [];
    render(<Tab onYield={(yielded) => seen.push(yielded)} />);
    act(() => void fireEvent.pointerDown(document.body));
    expect(seen.at(-1)).toBe(false);
  });

  test('sans BroadcastChannel (un vieux navigateur) : rien ne change, l\'onglet joue', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const seen: boolean[] = [];
    render(<Tab onYield={(yielded) => seen.push(yielded)} />);
    act(() => void fireEvent.pointerDown(document.body));
    expect(seen.at(-1)).toBe(false);
  });

  test('démonté, l\'onglet ferme son canal et n\'écoute plus les gestes', () => {
    const { unmount } = render(<Tab onYield={() => {}} />);
    const [channel] = FakeChannel.all as [FakeChannel];
    unmount();
    expect(FakeChannel.all).toHaveLength(0);
    act(() => void fireEvent.pointerDown(document.body));
    expect(channel.posted).toEqual([]);
  });
});
