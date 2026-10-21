import type { LightsState, PublicPlayer } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { DEFAULT_TOAST_TTL, DESK_NOTICE_MS, Toasts, useToasts } from './Toasts';

beforeEach(() => {
  useOfficeStore.getState().reset();
  useToasts.getState().clear();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const socket = new FakeSocket();
  socket.serverAccepts();
  render(<Toasts socket={socket.asSocket()} />);
  return socket;
}

test('rien à dire : rien dans la page', () => {
  setup();
  expect(screen.queryByRole('status')).toBeNull();
});

describe('la file des toasts (useToasts)', () => {
  test('un toast s\'affiche avec son icône et son texte, annoncé aux lecteurs d\'écran, puis s\'efface au bout de 3,5 s par défaut', () => {
    vi.useFakeTimers();
    setup();
    act(() => void useToasts.getState().push({ icon: <svg data-testid="icone" />, text: 'Fictif 2 a éteint la lumière' }));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Fictif 2 a éteint la lumière');
    expect(within(status).getByTestId('icone')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_TTL - 1);
    });
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('ttl : la durée se choisit, et null garde le toast jusqu\'à ce qu\'on le retire', () => {
    vi.useFakeTimers();
    setup();
    let stays = '';
    act(() => {
      useToasts.getState().push({ icon: null, text: 'Court', ttl: 1000 });
      stays = useToasts.getState().push({ icon: null, text: 'Reste', ttl: null });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('status').textContent).toBe('Reste');
    act(() => useToasts.getState().dismiss(stays));
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('un toast à portrait montre celui de qui l\'a fait (ses initiales avant que le personnage soit prêt) ; sans avatarKey, pas de portrait', () => {
    setup();
    act(() => {
      useToasts.getState().push({ icon: null, text: 'Avec', avatarKey: null, name: 'Léa Martin', ttl: null });
      useToasts.getState().push({ icon: null, text: 'Sans', ttl: null });
    });
    const rows = screen.getByRole('status').querySelectorAll('.toast');
    expect(rows[0]!.querySelector('.portrait-initials')?.textContent).toBe('LM');
    expect(rows[1]!.querySelector('.portrait')).toBeNull();
  });

  test('une clé remplace le toast de même clé, et repart de zéro', () => {
    vi.useFakeTimers();
    setup();
    act(() => void useToasts.getState().push({ key: 'lumiere', icon: null, text: 'Un', ttl: 1000 }));
    act(() => {
      vi.advanceTimersByTime(900);
    });
    act(() => void useToasts.getState().push({ key: 'lumiere', icon: null, text: 'Deux', ttl: 1000 }));
    expect(screen.getAllByText(/Un|Deux/)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByRole('status').textContent).toBe('Deux');
  });

  test('quitter le bureau (le composant est démonté) vide la file : rien ne reparaît à la prochaine arrivée', () => {
    const socket = new FakeSocket();
    const { unmount } = render(<Toasts socket={socket.asSocket()} />);
    act(() => void useToasts.getState().push({ icon: null, text: 'Reste', ttl: null }));
    unmount();
    expect(useToasts.getState().items).toEqual([]);
  });

  test('six toasts au plus : les plus anciens partent', () => {
    setup();
    act(() => {
      for (let i = 1; i <= 8; i++) useToasts.getState().push({ icon: null, text: `Toast ${i}`, ttl: null });
    });
    expect(useToasts.getState().items.map((item) => item.text)).toEqual(['Toast 3', 'Toast 4', 'Toast 5', 'Toast 6', 'Toast 7', 'Toast 8']);
  });
});

describe('ceux qui toquent', () => {
  test('chacun a son toast, avec « Laisser entrer » (admit) et « Ignorer »', async () => {
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

  test('un toc toc reste jusqu\'à la réponse : il ne s\'efface pas de lui-même', () => {
    vi.useFakeTimers();
    setup();
    act(() => useOfficeStore.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' }));
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByText(t(fr.desk.knockToast, { name: 'Bob' }))).toBeTruthy();
  });

  test('quelqu\'un qui retoque ne double pas sa ligne', () => {
    setup();
    act(() => {
      useOfficeStore.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' });
      useOfficeStore.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' });
    });
    expect(screen.getAllByText(t(fr.desk.knockToast, { name: 'Bob' }))).toHaveLength(1);
  });

  test('un toc toc que le magasin oublie (un autre l\'a ignoré, on repart) disparaît aussi', () => {
    setup();
    act(() => useOfficeStore.getState().addDeskKnock({ key: 'A1', userId: 'bob', name: 'Bob' }));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => useOfficeStore.getState().dismissDeskKnock('bob'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('le message passager', () => {
  test('il s\'affiche, annoncé aux lecteurs d\'écran, puis s\'efface de lui-même', () => {
    vi.useFakeTimers();
    setup();
    act(() => useOfficeStore.getState().setDeskNotice('Porte fermée.'));
    expect(screen.getByRole('status').textContent).toBe('Porte fermée.');
    // Le magasin n'a plus à le garder : la file l'a repris.
    expect(useOfficeStore.getState().deskNotice).toBeNull();
    act(() => {
      vi.advanceTimersByTime(DESK_NOTICE_MS - 1);
    });
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('un nouveau message repart de zéro, et le même message redit s\'affiche de nouveau', () => {
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
    act(() => {
      vi.advanceTimersByTime(DESK_NOTICE_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
    act(() => useOfficeStore.getState().setDeskNotice('Deux.'));
    expect(screen.getByRole('status').textContent).toBe('Deux.');
  });
});

// La lumière du bureau : à chaque `lights:changed` du bus (le magasin est déjà à jour), un toast avec le portrait de qui a appuyé et l'ampoule.
describe('la lumière', () => {
  const player = (id: string, name: string): PublicPlayer => ({
    id,
    name,
    avatarKey: null,
    x: 80,
    y: 240,
    dir: 'down',
    moving: false,
    status: 'available',
    media: { mic: false, cam: false, screen: false },
  });
  const arrive = (lights?: LightsState) =>
    act(() =>
      useOfficeStore.getState().applyInit({ self: player('moi', 'Léa'), players: [player('bob', 'Bob Martin')], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [], lights }),
    );
  const changed = (on: boolean, by: string, name: string, at = 1) => act(() => void emitOnBus(EventBus, 'lights:changed', { on, by: { id: by, name }, at }));
  const icon = () => screen.getByRole('status').querySelector('.toast-icon svg') as SVGElement;

  test('un autre éteint : son nom, son portrait, et l\'ampoule barrée', () => {
    arrive();
    setup();
    changed(false, 'bob', 'Bob Martin');
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(t(fr.lights.off, { name: 'Bob Martin' }));
    expect(status.querySelector('.portrait-initials')?.textContent).toBe('BM');
    expect(icon().classList.contains('lucide-lightbulb-off')).toBe(true);
  });

  test('un autre rallume : « a rallumé la lumière », l\'ampoule', () => {
    arrive();
    setup();
    changed(true, 'bob', 'Bob Martin');
    expect(screen.getByRole('status').textContent).toContain(t(fr.lights.on, { name: 'Bob Martin' }));
    expect(icon().classList.contains('lucide-lightbulb')).toBe(true);
    expect(icon().classList.contains('lucide-lightbulb-off')).toBe(false);
  });

  test('celui qui a appuyé lit « Tu as éteint la lumière », puis « Tu as rallumé la lumière », avec son propre portrait', () => {
    arrive();
    setup();
    changed(false, 'moi', 'Léa');
    expect(screen.getByRole('status').textContent).toContain(fr.lights.selfOff);
    expect(screen.getByRole('status').querySelector('.portrait-initials')?.textContent).toBe('L');
    changed(true, 'moi', 'Léa', 2);
    expect(screen.getByRole('status').textContent).toContain(fr.lights.selfOn);
  });

  test('un interrupteur actionné coup sur coup remplace le toast au lieu de les empiler, et il s\'efface au bout de son temps', () => {
    vi.useFakeTimers();
    arrive();
    setup();
    changed(false, 'bob', 'Bob Martin');
    changed(true, 'moi', 'Léa', 2);
    changed(false, 'bob', 'Bob Martin', 3);
    expect(screen.getByRole('status').querySelectorAll('.toast')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toContain(t(fr.lights.off, { name: 'Bob Martin' }));
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_TTL);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('aucun toast à l\'arrivée, même dans le noir : l\'état d\'un init n\'est pas un changement', () => {
    setup();
    arrive({ on: false, by: { id: 'bob', name: 'Bob Martin' }, at: 5 });
    expect(screen.queryByRole('status')).toBeNull();
    // Le magasin seul (sans événement du bus) n'en fait pas non plus.
    act(() => useOfficeStore.getState().setLights({ on: true, by: { id: 'bob', name: 'Bob Martin' }, at: 6 }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('sans auteur (le serveur le dit toujours), rien à dire', () => {
    arrive();
    setup();
    act(() => void emitOnBus(EventBus, 'lights:changed', { on: false, by: null, at: 1 }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('un auteur qui n\'est plus là (parti, ou inconnu) a quand même son message, avec ses initiales', () => {
    arrive();
    setup();
    changed(false, 'parti', 'Zoé');
    expect(screen.getByRole('status').textContent).toContain(t(fr.lights.off, { name: 'Zoé' }));
    expect(screen.getByRole('status').querySelector('.portrait-initials')?.textContent).toBe('Z');
  });

  test('le composant démonté n\'écoute plus le bus', () => {
    const { unmount } = render(<Toasts socket={null} />);
    expect(EventBus.listenerCount('lights:changed')).toBe(1);
    unmount();
    expect(EventBus.listenerCount('lights:changed')).toBe(0);
  });
});
