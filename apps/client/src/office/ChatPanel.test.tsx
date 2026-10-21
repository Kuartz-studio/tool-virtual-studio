import type { ChatAck, ChatMessage, PublicPlayer } from '@bureau/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bindKeyboard, DirectionInput } from '../game/input';
import { fr } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { FakeSocket } from '../test/fake-socket';
import { ChatPanel } from './ChatPanel';

const NOW = new Date('2026-10-20T12:00:00.000Z');

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

// Un message du chat, par défaut de Bob, « Tout le monde », une heure avant « maintenant ».
const message = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channel: 'all',
  userId: 'bob',
  name: 'Bob',
  text: `message ${id}`,
  sentAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
  ...over,
});

const store = () => useOfficeStore.getState();

// L'heure est figée (seulement Date : les minuteries de user-event et de React tournent normalement).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  store().reset();
});
afterEach(() => {
  vi.useRealTimers();
});

// Le serveur a envoyé l'état de départ : on est Léa, avec Bob, et cet historique du chat.
function arrive(history: ChatMessage[] = []): void {
  act(() => store().applyInit({ self: player('moi', 'Léa'), players: [player('bob', 'Bob')], mapKey: 'dev-office', chatHistory: history, desks: [], closedDesks: [], deskBans: [] }));
}

interface Options {
  room?: string | null;
  history?: ChatMessage[];
  // La connexion n'a pas reçu son init.
  init?: boolean;
  onClose?: () => void;
}

// Le panneau, avec une socket connectée. `rerenderWith` le redessine avec une autre room (la conversation change).
function renderChat({ room = null, history = [], init = true, onClose = () => {} }: Options = {}) {
  const socket = new FakeSocket();
  socket.serverAccepts();
  if (init) arrive(history);
  const panel = (r: string | null) => <ChatPanel id="panneau-chat" socket={socket.asSocket()} room={r} onClose={onClose} />;
  const view = render(panel(room));
  return { socket, ...view, rerenderWith: (r: string | null) => view.rerender(panel(r)) };
}

const tab = (name: string) => screen.getByRole('tab', { name }) as HTMLButtonElement;
const input = () => screen.getByRole('textbox') as HTMLInputElement;
const sendButton = () => screen.getByRole('button', { name: fr.chat.send }) as HTMLButtonElement;
const log = () => screen.getByRole('log');
const texts = () => within(log()).queryAllByRole('listitem').map((item) => item.querySelector('.chat-text')?.textContent);
const reply = (socket: FakeSocket, ack: ChatAck) => act(() => socket.serverAcks('chat:send', ack));

describe('les onglets', () => {
  test('deux onglets, « Tout le monde » d\'abord et choisi ; le panneau a son titre et son nom', () => {
    renderChat();
    expect(screen.getByRole('complementary', { name: fr.chat.title })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: fr.chat.title })).toBeTruthy();
    const tabs = within(screen.getByRole('tablist', { name: fr.chat.tabsLabel })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Tout le monde', 'À proximité']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    // Le panneau de l'onglet choisi est nommé par lui.
    const tabpanel = screen.getByRole('tabpanel');
    expect(tabpanel.getAttribute('aria-labelledby')).toBe(tab('Tout le monde').id);
    expect(tab('Tout le monde').getAttribute('aria-controls')).toBe(tabpanel.id);
  });

  test('onglet À proximité désactivé sans room', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderChat({ room: null });
    expect(tab('À proximité').disabled).toBe(true);
    expect(tab('À proximité').getAttribute('title')).toBe(fr.chat.nearbyUnavailable);
    expect(tab('Tout le monde').disabled).toBe(false);
    // Le clic ne change rien.
    await user.click(tab('À proximité'));
    expect(tab('Tout le monde').getAttribute('aria-selected')).toBe('true');
    expect(tab('À proximité').getAttribute('aria-selected')).toBe('false');

    // Une conversation commence : l'onglet s'ouvre, et on peut le choisir.
    rerenderWith('r1');
    expect(tab('À proximité').disabled).toBe(false);
    expect(tab('À proximité').hasAttribute('title')).toBe(false);
    await user.click(tab('À proximité'));
    expect(tab('À proximité').getAttribute('aria-selected')).toBe('true');
    expect(tab('Tout le monde').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab('À proximité').id);
  });

  test('chaque onglet montre ses messages, et son champ le dit', async () => {
    const user = userEvent.setup();
    renderChat({ room: 'r1', history: [message('a1'), message('a2')] });
    act(() => store().addChatMessage(message('n1', { channel: 'nearby', text: 'psst' })));
    expect(texts()).toEqual(['message a1', 'message a2']);
    expect(log().getAttribute('aria-label')).toBe(fr.chat.log.all);
    expect(input().getAttribute('aria-label')).toBe(fr.chat.input.all);

    await user.click(tab('À proximité'));
    expect(texts()).toEqual(['psst']);
    expect(log().getAttribute('aria-label')).toBe(fr.chat.log.nearby);
    expect(input().getAttribute('aria-label')).toBe(fr.chat.input.nearby);

    await user.click(tab('Tout le monde'));
    expect(texts()).toEqual(['message a1', 'message a2']);
  });

  test('au clavier : ← et → passent d\'un onglet à l\'autre (focus avec lui, Début et Fin aussi) ; un onglet désactivé est sauté', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderChat({ room: null });
    tab('Tout le monde').focus();
    // Seul l'onglet choisi est dans l'ordre de tabulation.
    expect(tab('Tout le monde').tabIndex).toBe(0);
    expect(tab('À proximité').tabIndex).toBe(-1);
    await user.keyboard('{ArrowRight}');
    expect(tab('Tout le monde').getAttribute('aria-selected')).toBe('true');

    rerenderWith('r1');
    await user.keyboard('{ArrowRight}');
    expect(tab('À proximité').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('À proximité'));
    expect(tab('À proximité').tabIndex).toBe(0);
    expect(tab('Tout le monde').tabIndex).toBe(-1);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tab('Tout le monde'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(tab('À proximité'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(tab('Tout le monde'));
    expect(tab('Tout le monde').getAttribute('aria-selected')).toBe('true');
  });

  // Un bouton n'est pas un champ de saisie pour l'avatar (game/input.ts) : le focus laissé sur l'onglet, taper « z » le ferait marcher.
  // Même pour « À proximité » resté choisi après la conversation : on n'y envoie plus, mais le champ (et son brouillon) reste à
  // l'écriture, et c'est là qu'on tape.
  test('cliquer un onglet met le focus dans le champ du message : taper écrit, et l\'avatar ne marche pas', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      const { rerenderWith } = renderChat({ room: 'r1' });
      await user.click(tab('À proximité'));
      expect(document.activeElement).toBe(input());
      await user.keyboard('z[KeyW>]');
      expect(input().value).toBe('zw');
      expect(directions.current()).toBeNull();
      await user.keyboard('[/KeyW]');

      await user.click(tab('Tout le monde'));
      expect(document.activeElement).toBe(input());
      expect(input().getAttribute('aria-label')).toBe(fr.chat.input.all);

      // « À proximité », choisi, après la fin de la conversation.
      await user.click(tab('À proximité'));
      rerenderWith(null);
      input().blur();
      await user.click(tab('À proximité'));
      expect(document.activeElement).toBe(input());
    } finally {
      unbind();
    }
  });

  // Au clavier, le focus reste sur les onglets (motif « tabs ») : les flèches, et aussi Entrée ou Espace sur l'onglet choisi.
  test('au clavier, le focus reste sur les onglets : Entrée et Espace ne l\'emmènent pas dans le champ', async () => {
    const user = userEvent.setup();
    renderChat({ room: 'r1' });
    tab('Tout le monde').focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab('À proximité'));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(tab('À proximité'));
    await user.keyboard(' ');
    expect(document.activeElement).toBe(tab('À proximité'));
    expect(tab('À proximité').getAttribute('aria-selected')).toBe('true');
  });

  // Les flèches sont celles de l'avatar (game/input.ts), qui laisse passer ce qu'un autre écouteur a pris (preventDefault).
  test('les flèches qui changent d\'onglet ne font pas marcher l\'avatar', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      renderChat({ room: 'r1' });
      tab('Tout le monde').focus();
      await user.keyboard('{ArrowRight>}');
      expect(tab('À proximité').getAttribute('aria-selected')).toBe('true');
      expect(directions.current()).toBeNull();
    } finally {
      unbind();
    }
  });

  test('l\'onglet À proximité, choisi, le reste quand la conversation finit : ses messages restent lisibles, mais on n\'y écrit plus', async () => {
    const user = userEvent.setup();
    const { rerenderWith, socket } = renderChat({ room: 'r1' });
    act(() => store().addChatMessage(message('n1', { channel: 'nearby', text: 'le lien est https://a.fr' })));
    await user.click(tab('À proximité'));
    await user.type(input(), 'Un brouillon');

    rerenderWith(null);
    // L'onglet reste là où on était (ni déplacé de force, ni brouillon passé à tout le monde), et lisible.
    expect(tab('À proximité').getAttribute('aria-selected')).toBe('true');
    expect(tab('À proximité').disabled).toBe(false);
    expect(texts()).toEqual(['le lien est https://a.fr']);
    expect(input().value).toBe('Un brouillon');
    // Plus personne à qui écrire : le dit, et l'envoi est inactif.
    expect(screen.getByText(fr.chat.noConversation)).toBeTruthy();
    expect(sendButton().disabled).toBe(true);
    await user.type(input(), '{Enter}');
    expect(socket.sentOf('chat:send')).toEqual([]);

    // Revenir à « Tout le monde » : l'onglet À proximité, lui, ne se rouvre plus sans conversation.
    await user.click(tab('Tout le monde'));
    expect(tab('À proximité').disabled).toBe(true);
    expect(screen.queryByText(fr.chat.noConversation)).toBeNull();
  });
});

describe('les messages', () => {
  test('une liste, dans l\'ordre ; chaque message a son auteur, son heure et son texte', () => {
    renderChat({
      history: [
        message('a1', { name: 'Bob', text: 'Salut', sentAt: '2026-10-20T11:15:00.000Z' }),
        message('a2', { userId: 'moi', name: 'Léa', text: 'Bonjour Bob', sentAt: '2026-10-20T11:16:00.000Z' }),
      ],
    });
    expect(within(log()).getByRole('list')).toBeTruthy();
    const items = within(log()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('.chat-author')?.textContent).toBe('Bob');
    expect(items[0]!.querySelector('.chat-text')?.textContent).toBe('Salut');
    expect(items[1]!.querySelector('.chat-author')?.textContent).toBe('Léa');
    expect(items[1]!.querySelector('.chat-text')?.textContent).toBe('Bonjour Bob');
    // L'heure : un élément <time> daté de l'envoi, écrit « 12:15 » (du jour), avec la date entière en infobulle.
    const time = items[0]!.querySelector('time')!;
    expect(time.getAttribute('datetime')).toBe('2026-10-20T11:15:00.000Z');
    expect(time.textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(time.getAttribute('title')).toBeTruthy();
  });

  test('on se reconnaît : « (toi) » sur ses messages seulement', () => {
    renderChat({ history: [message('a1'), message('a2', { userId: 'moi', name: 'Léa' })] });
    const items = within(log()).getAllByRole('listitem');
    expect(items[0]!.textContent).not.toContain(fr.chat.you);
    expect(items[1]!.textContent).toContain(fr.chat.you);
  });

  test('un message d\'un autre jour porte sa date en plus de l\'heure', () => {
    renderChat({
      history: [
        message('hier', { sentAt: new Date(NOW.getTime() - 30 * 3_600_000).toISOString() }),
        message('aujourdhui', { sentAt: new Date(NOW.getTime() - 3_600_000).toISOString() }),
      ],
    });
    const [yesterday, today] = [...log().querySelectorAll('time')];
    expect(today!.textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(yesterday!.textContent).not.toMatch(/^\d{2}:\d{2}$/);
    expect(yesterday!.textContent).toMatch(/\d{2}:\d{2}$/);
  });

  test('les messages qui arrivent s\'ajoutent à la liste, un seul même s\'il arrive deux fois', () => {
    renderChat({ history: [message('a1')] });
    act(() => store().addChatMessage(message('a2', { text: 'Du nouveau' })));
    act(() => store().addChatMessage(message('a2', { text: 'Du nouveau' })));
    expect(texts()).toEqual(['message a1', 'Du nouveau']);
  });

  test('rien à lire : un mot sur l\'onglet, dit pour chacun', async () => {
    const user = userEvent.setup();
    renderChat({ room: 'r1' });
    expect(screen.getByText(fr.chat.empty.all)).toBeTruthy();
    await user.click(tab('À proximité'));
    expect(screen.getByText(fr.chat.empty.nearby)).toBeTruthy();
    expect(screen.queryByText(fr.chat.empty.all)).toBeNull();
    act(() => store().addChatMessage(message('n1', { channel: 'nearby' })));
    expect(screen.queryByText(fr.chat.empty.nearby)).toBeNull();
  });

  test('les liens http et https sont cliquables, et rien d\'autre n\'est du HTML', () => {
    renderChat({
      history: [
        message('a1', { text: 'voir https://a.fr/page ok' }),
        message('a2', { text: '<b>gras</b> <img src=x onerror=alert(1)> javascript:alert(1)' }),
      ],
    });
    const [first, second] = within(log()).getAllByRole('listitem');
    const link = first!.querySelector('.chat-text a')!;
    expect(link.getAttribute('href')).toBe('https://a.fr/page');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const text = second!.querySelector('.chat-text')!;
    expect(text.childElementCount).toBe(0);
    expect(text.textContent).toBe('<b>gras</b> <img src=x onerror=alert(1)> javascript:alert(1)');
    expect(log().querySelector('b, img')).toBeNull();
  });

  test('la zone des messages est un journal (les nouveaux sont annoncés), nommé, qu\'on atteint au clavier', () => {
    renderChat();
    expect(log().getAttribute('aria-label')).toBe(fr.chat.log.all);
    expect(log().tabIndex).toBe(0);
  });

  // Les flèches sont celles de l'avatar : dans le journal, qu'elles font défiler, elles ne le font pas marcher.
  test('les flèches dans le journal le font défiler et ne font pas marcher l\'avatar', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      renderChat({ history: Array.from({ length: 30 }, (_, i) => message(`m${i}`)) });
      log().focus();
      await user.keyboard('{ArrowDown>}');
      expect(directions.current()).toBeNull();
      await user.keyboard('{/ArrowDown}{ArrowUp>}{/ArrowUp}{ArrowLeft>}{/ArrowLeft}{ArrowRight>}{/ArrowRight}');
      expect(directions.current()).toBeNull();
    } finally {
      unbind();
    }
  });
});

describe('écrire', () => {
  test('Entrée envoie le message à tout le monde, coupé de ses espaces, avec 5 s pour l\'accusé ; le champ ne se vide qu\'à { ok: true }', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat();
    await user.type(input(), '  Bonjour tout le monde  {Enter}');
    expect(socket.sentOf('chat:send')).toEqual([{ channel: 'all', text: 'Bonjour tout le monde' }]);
    expect(socket.pendingAcks[0]!.timeoutMs).toBe(5000);
    // Sans réponse du serveur, le texte reste.
    expect(input().value).toBe('  Bonjour tout le monde  ');
    reply(socket, { ok: true });
    expect(input().value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    // Le focus est resté dans le champ : on enchaîne.
    expect(document.activeElement).toBe(input());
  });

  test('le bouton Envoyer envoie aussi, et rend le focus au champ (pour enchaîner)', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat();
    await user.type(input(), 'Salut');
    await user.click(sendButton());
    expect(socket.sentOf('chat:send')).toEqual([{ channel: 'all', text: 'Salut' }]);
    expect(document.activeElement).toBe(input());
  });

  test('un champ vide, ou fait d\'espaces, n\'envoie rien : le bouton est inactif', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat();
    expect(sendButton().disabled).toBe(true);
    await user.type(input(), '   {Enter}');
    expect(sendButton().disabled).toBe(true);
    expect(socket.sentOf('chat:send')).toEqual([]);
    await user.type(input(), 'a');
    expect(sendButton().disabled).toBe(false);
  });

  test('500 caractères au plus (CHAT_MAX_LENGTH) dans le champ', () => {
    renderChat();
    expect(input().maxLength).toBe(500);
  });

  test('le message envoyé n\'est pas ajouté à la main : il vient du serveur (chat:message), une seule fois', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat();
    await user.type(input(), 'Salut{Enter}');
    reply(socket, { ok: true });
    expect(texts()).toEqual([]);
    // L'émetteur reçoit son propre message, comme les autres.
    act(() => store().addChatMessage(message('m1', { userId: 'moi', name: 'Léa', text: 'Salut' })));
    expect(texts()).toEqual(['Salut']);
  });

  test('pendant l\'attente de l\'accusé, un second Entrée n\'envoie rien de plus', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat();
    await user.type(input(), 'Salut{Enter}{Enter}');
    expect(socket.sentOf('chat:send')).toHaveLength(1);
    expect(sendButton().disabled).toBe(true);
    reply(socket, { ok: true });
    expect(socket.sentOf('chat:send')).toHaveLength(1);
  });

  test('ce qui est tapé pendant l\'attente n\'est pas effacé par l\'accusé', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat();
    await user.type(input(), 'Salut{Enter}');
    await user.type(input(), ' et la suite');
    reply(socket, { ok: true });
    expect(input().value).toBe('Salut et la suite');
  });

  describe('ce qui n\'a pas marché : le texte reste dans le champ, et l\'erreur est dite', () => {
    const cases: Array<[ack: ChatAck, text: string]> = [
      [{ ok: false, error: 'invalid' }, fr.chat.invalid],
      [{ ok: false, error: 'rate_limited' }, fr.chat.rateLimited],
      [{ ok: false, error: 'no_group' }, fr.chat.noGroup],
      [{ ok: false, error: 'unavailable' }, fr.chat.unavailable],
    ];

    test.each(cases)('accusé %j', async (ack, text) => {
      const user = userEvent.setup();
      const { socket } = renderChat({ room: 'r1' });
      await user.type(input(), 'Salut{Enter}');
      reply(socket, ack);
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(text);
      expect(input().value).toBe('Salut');
      // On peut réessayer tout de suite.
      expect(sendButton().disabled).toBe(false);
    });

    test('un accusé rate_limited affiche fr.chat.rateLimited', async () => {
      const user = userEvent.setup();
      const { socket } = renderChat();
      await user.type(input(), 'Salut{Enter}');
      reply(socket, { ok: false, error: 'rate_limited' });
      expect(screen.getByRole('alert').textContent).toBe(fr.chat.rateLimited);
      expect(screen.getByText(fr.chat.rateLimited)).toBeTruthy();
    });

    test('pas d\'accusé dans les 5 s : un message pour ce cas aussi', async () => {
      const user = userEvent.setup();
      const { socket } = renderChat();
      await user.type(input(), 'Salut{Enter}');
      act(() => socket.ackTimesOut('chat:send'));
      expect(screen.getByRole('alert').textContent).toBe(fr.chat.timeout);
      expect(input().value).toBe('Salut');
      expect(sendButton().disabled).toBe(false);
    });

    test('chaque cas a son message, et aucun n\'est vide', () => {
      const messages = [fr.chat.invalid, fr.chat.rateLimited, fr.chat.noGroup, fr.chat.unavailable, fr.chat.timeout];
      expect(new Set(messages).size).toBe(messages.length);
      for (const text of messages) expect(text.length).toBeGreaterThan(10);
    });

    test('on réessaie : l\'erreur s\'efface, le message repart, et l\'accusé ok vide le champ', async () => {
      const user = userEvent.setup();
      const { socket } = renderChat();
      await user.type(input(), 'Salut{Enter}');
      reply(socket, { ok: false, error: 'rate_limited' });
      await user.keyboard('{Enter}');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(socket.sentOf('chat:send')).toEqual([
        { channel: 'all', text: 'Salut' },
        { channel: 'all', text: 'Salut' },
      ]);
      reply(socket, { ok: true });
      expect(input().value).toBe('');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    test('l\'erreur disparaît quand on modifie le texte', async () => {
      const user = userEvent.setup();
      const { socket } = renderChat();
      await user.type(input(), 'Salut{Enter}');
      reply(socket, { ok: false, error: 'rate_limited' });
      expect(screen.getByRole('alert')).toBeTruthy();
      await user.type(input(), '!');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    test('un code que ce client ne connaît pas (un serveur plus récent) : le message du serveur indisponible', async () => {
      const user = userEvent.setup();
      const { socket } = renderChat();
      await user.type(input(), 'Salut{Enter}');
      act(() => socket.serverAcks('chat:send', { ok: false, error: 'autre_chose' }));
      expect(screen.getByRole('alert').textContent).toBe(fr.chat.unavailable);
      expect(input().value).toBe('Salut');
    });

    test('un accusé vide (le serveur n\'a rien répondu de lisible) : le message du délai', async () => {
      const user = userEvent.setup();
      const { socket } = renderChat();
      await user.type(input(), 'Salut{Enter}');
      act(() => socket.serverAcks('chat:send'));
      expect(screen.getByRole('alert').textContent).toBe(fr.chat.timeout);
      expect(input().value).toBe('Salut');
    });

    test('l\'erreur disparaît quand on change d\'onglet', async () => {
      const user = userEvent.setup();
      const { socket } = renderChat({ room: 'r1' });
      await user.type(input(), 'Salut{Enter}');
      reply(socket, { ok: false, error: 'rate_limited' });
      expect(screen.getByRole('alert')).toBeTruthy();
      await user.click(tab('À proximité'));
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  test('À proximité : le message part sur ce canal', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat({ room: 'r1' });
    await user.click(tab('À proximité'));
    await user.type(input(), 'Qui a le lien ?{Enter}');
    expect(socket.sentOf('chat:send')).toEqual([{ channel: 'nearby', text: 'Qui a le lien ?' }]);
    reply(socket, { ok: true });
    expect(input().value).toBe('');
  });

  test('le canal est celui du moment où l\'on envoie : changer d\'onglet pendant l\'attente n\'y change rien', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat({ room: 'r1' });
    await user.type(input(), 'Salut{Enter}');
    await user.click(tab('À proximité'));
    expect(socket.sentOf('chat:send')).toEqual([{ channel: 'all', text: 'Salut' }]);
  });

  test('chaque onglet a son brouillon : ce qu\'on tape pour la conversation ne part jamais à tout le monde en changeant d\'onglet', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat({ room: 'r1' });
    await user.type(input(), 'Pour tout le monde');
    await user.click(tab('À proximité'));
    expect(input().value).toBe('');
    await user.type(input(), 'Entre nous');
    await user.click(tab('Tout le monde'));
    expect(input().value).toBe('Pour tout le monde');
    await user.click(tab('À proximité'));
    expect(input().value).toBe('Entre nous');
    await user.type(input(), '{Enter}');
    expect(socket.sentOf('chat:send')).toEqual([{ channel: 'nearby', text: 'Entre nous' }]);
    reply(socket, { ok: true });
    // L'accusé vide le brouillon de l'onglet envoyé, pas celui de l'autre.
    expect(input().value).toBe('');
    await user.click(tab('Tout le monde'));
    expect(input().value).toBe('Pour tout le monde');
  });

  describe('la connexion n\'est pas prête', () => {
    test('avant l\'init, ou connexion coupée : le bouton et Entrée n\'envoient rien, un mot le dit, et le texte tapé reste', async () => {
      const user = userEvent.setup();
      const { socket } = renderChat();
      act(() => store().setReady(false));
      expect(screen.getByText(fr.chat.reconnecting)).toBeTruthy();
      await user.type(input(), 'Salut{Enter}');
      expect(sendButton().disabled).toBe(true);
      await user.click(sendButton());
      expect(socket.sentOf('chat:send')).toEqual([]);
      expect(input().value).toBe('Salut');

      // La connexion revient (l'init du retour) : on peut envoyer ce qu'on avait tapé.
      arrive();
      expect(screen.queryByText(fr.chat.reconnecting)).toBeNull();
      expect(sendButton().disabled).toBe(false);
      await user.click(sendButton());
      expect(socket.sentOf('chat:send')).toEqual([{ channel: 'all', text: 'Salut' }]);
    });

    test('sans socket, rien ne part (la page ne l\'a pas encore ouverte)', async () => {
      const user = userEvent.setup();
      arrive();
      render(<ChatPanel socket={null} room={null} onClose={() => {}} />);
      await user.type(input(), 'Salut{Enter}');
      expect(sendButton().disabled).toBe(true);
      expect(input().value).toBe('Salut');
    });
  });
});

// happy-dom ne met rien en page : la hauteur de la liste et sa position sont celles que le test donne à l'élément.
describe('la liste suit le dernier message', () => {
  // La liste affichée : 1 000 px de messages dans 300 px, à la position `top` (tenue par le test, comme le ferait le navigateur).
  function measure(list: HTMLElement, top: number) {
    const box = { top };
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 300 });
    Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => box.top, set: (value: number) => void (box.top = value) });
    return box;
  }

  test('un nouveau message la fait défiler jusqu\'en bas ; remontée lire plus haut, elle ne saute pas ; revenue en bas, elle suit de nouveau', () => {
    renderChat({ history: [message('a1')] });
    const box = measure(log(), 0);
    act(() => store().addChatMessage(message('a2')));
    expect(box.top).toBe(1000);

    // On remonte lire : un nouveau message ne ramène pas en bas.
    box.top = 100;
    fireEvent.scroll(log());
    act(() => store().addChatMessage(message('a3')));
    expect(box.top).toBe(100);

    // De retour tout en bas (à 40 px près), la liste suit de nouveau.
    box.top = 680;
    fireEvent.scroll(log());
    act(() => store().addChatMessage(message('a4')));
    expect(box.top).toBe(1000);
  });

  test('envoyer un message ramène en bas, même remonté lire plus haut', async () => {
    const user = userEvent.setup();
    const { socket } = renderChat({ history: [message('a1')] });
    const box = measure(log(), 100);
    fireEvent.scroll(log());
    await user.type(input(), 'Salut{Enter}');
    reply(socket, { ok: true });
    act(() => store().addChatMessage(message('a2', { userId: 'moi', name: 'Léa', text: 'Salut' })));
    expect(box.top).toBe(1000);
  });

  // Un faux ResizeObserver, que le test déclenche quand la taille de la liste « change ».
  function fakeResizeObserver() {
    const observed: Array<{ target: Element; callback: () => void; disconnected: boolean }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly entry: { target: Element; callback: () => void; disconnected: boolean };
        constructor(callback: () => void) {
          this.entry = { target: document.body, callback, disconnected: false };
          observed.push(this.entry);
        }
        observe(target: Element) {
          this.entry.target = target;
        }
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    return { resize: () => act(() => observed.filter((entry) => !entry.disconnected).forEach((entry) => entry.callback())), observed };
  }

  test('redimensionnée (une fenêtre plus basse, un autre panneau, une erreur sous elle), la liste qui suit le bas y reste ; remontée, elle ne bouge pas', () => {
    const observer = fakeResizeObserver();
    renderChat({ history: [message('a1')] });
    expect(observer.observed).toHaveLength(1);
    expect(observer.observed[0]!.target).toBe(log());
    const box = measure(log(), 0);

    observer.resize();
    expect(box.top).toBe(1000);

    box.top = 100;
    fireEvent.scroll(log());
    observer.resize();
    expect(box.top).toBe(100);
  });

  test('la liste est observée tant qu\'elle est là : une nouvelle à chaque onglet, et plus rien au démontage', async () => {
    const user = userEvent.setup();
    const observer = fakeResizeObserver();
    const { unmount } = renderChat({ room: 'r1' });
    await user.click(tab('À proximité'));
    expect(observer.observed.map((entry) => entry.disconnected)).toEqual([true, false]);
    unmount();
    expect(observer.observed.map((entry) => entry.disconnected)).toEqual([true, true]);
  });

  test('chaque onglet repart du bas', async () => {
    const user = userEvent.setup();
    renderChat({ room: 'r1', history: [message('a1')] });
    measure(log(), 100);
    fireEvent.scroll(log());
    await user.click(tab('À proximité'));
    const box = measure(log(), 0);
    act(() => store().addChatMessage(message('n1', { channel: 'nearby' })));
    expect(box.top).toBe(1000);
  });
});

describe('lus et non lus', () => {
  test('l\'onglet Tout le monde, affiché, marque ses messages comme lus, ceux qui arrivent aussi', () => {
    renderChat({ history: [message('a1'), message('a2')] });
    expect(store().chatReadId).toBe('a2');
    act(() => store().addChatMessage(message('a3')));
    expect(store().chatReadId).toBe('a3');
  });

  test('pas pendant qu\'on est sur l\'onglet À proximité : ils restent non lus', async () => {
    const user = userEvent.setup();
    renderChat({ room: 'r1', history: [message('a1')] });
    await user.click(tab('À proximité'));
    act(() => store().addChatMessage(message('a2')));
    expect(store().chatReadId).toBe('a1');
    // Retour sur « Tout le monde » : lus.
    await user.click(tab('Tout le monde'));
    expect(store().chatReadId).toBe('a2');
  });
});

describe('le clavier', () => {
  test('à l\'ouverture, le focus est dans le champ', () => {
    renderChat();
    expect(document.activeElement).toBe(input());
  });

  test('Échap ferme le panneau, du champ comme du reste', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderChat({ onClose });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    tab('Tout le monde').focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('Échap pendant une composition (touche morte, méthode de saisie) l\'annule : il ne ferme pas le panneau', () => {
    const onClose = vi.fn();
    renderChat({ onClose });
    fireEvent.keyDown(input(), { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('le bouton Fermer ferme aussi', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderChat({ onClose });
    await user.click(screen.getByRole('button', { name: fr.chat.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Les touches de l'avatar (ZQSD, WASD et les flèches : game/input.ts) sont ignorées dans un champ de saisie.
  test('taper « zqsd » et les flèches dans le champ ne fait pas marcher l\'avatar, les mêmes touches ailleurs si', async () => {
    const user = userEvent.setup();
    const directions = new DirectionInput();
    const unbind = bindKeyboard(directions);
    try {
      renderChat();
      expect(document.activeElement).toBe(input());
      // Les codes physiques de ZQSD sur un clavier AZERTY : KeyW, KeyA, KeyS, KeyD.
      await user.keyboard('zqsd[KeyW>][KeyA>][KeyS>][KeyD>]{ArrowUp>}{ArrowLeft>}');
      expect(input().value).toBe('zqsdwasd');
      expect(directions.current()).toBeNull();
      await user.keyboard('[/KeyW][/KeyA][/KeyS][/KeyD]{/ArrowUp}{/ArrowLeft}');

      // Le même geste hors du champ fait marcher l'avatar : le test éprouve bien ce qu'il dit.
      input().blur();
      await user.keyboard('[KeyW>]');
      expect(directions.current()).toBe('up');
    } finally {
      unbind();
    }
  });
});
