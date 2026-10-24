import { AUDIO_SILENT_DISTANCE_PX, DEFAULT_ROOM_MUSIC, type ChatMessage, type DeskInfo, type InitPayload, type PublicPlayer, type RoomMusic } from '@bureau/shared';
import { EventEmitter } from 'eventemitter3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { emitOnBus } from '../net/office-connection';
import { createOfficeStore } from '../state/office-store';
import type { SfxId } from './catalog';
import type { SfxOptions } from './engine';
import { bindSfx, COFFEE_BOOST_DELAY_MS, LOST_AFTER_MS, uiSoundFor } from './sfx-events';

const player = (id: string, over: Partial<PublicPlayer> = {}): PublicPlayer => ({
  id,
  name: id.toUpperCase(),
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
  ...over,
});
const init = (self: PublicPlayer, players: PublicPlayer[] = [], chatHistory: ChatMessage[] = []): InitPayload => ({
  self,
  players,
  mapKey: 'dev-office',
  chatHistory,
  desks: [],
  closedDesks: [],
  deskBans: [],
});
const message = (id: string, userId: string, channel: 'all' | 'nearby' = 'all'): ChatMessage => ({ id, channel, userId, name: userId, text: 'salut', sentAt: '2026-10-21T10:00:00Z' });

type Played = [id: SfxId, options?: SfxOptions];
let played: Played[];
let store: ReturnType<typeof createOfficeStore>;
let bus: EventEmitter;
let unbind: () => void;
// La pièce réglable où sont les pieds de la personne (celle de l'audio), que les tests posent.
let place: string | null;

const ids = () => played.map(([id]) => id);

beforeEach(() => {
  vi.useFakeTimers();
  played = [];
  place = null;
  store = createOfficeStore();
  bus = new EventEmitter();
  unbind = bindSfx({ playSfx: (id, options) => void played.push(options === undefined ? [id] : [id, options]) }, { bus, store, placeKey: () => place });
});

afterEach(() => {
  unbind();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// Un bouton dans la page, cliqué comme le ferait la personne.
function click(html: string): HTMLElement {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild as HTMLElement;
  element.click();
  return element;
}

describe('la progression', () => {
  const gain = (levelBefore: number, levelAfter: number, source: 'mission' | 'checkin' = 'mission') => ({ amount: 500, source, label: 'x', levelBefore, levelAfter, kuartzons: 0 });

  test('un gain sonne une gemme ; un niveau gagné, sa fanfare ; le pointage de l\'arrivée, rien (l\'arrivée a son air)', () => {
    bus.emit('progress:gain', gain(0, 0));
    bus.emit('progress:gain', gain(0, 1));
    bus.emit('progress:gain', gain(1, 1, 'checkin'));
    expect(ids()).toEqual(['xp', 'level-up']);
  });

  test('une mission reçue : son air ; une mission qu\'on a confiée, accomplie : le succès ; en « Ne pas déranger », ni l\'un ni l\'autre ; un achat : les kuartzons', () => {
    store.getState().applyInit({ self: { id: 'moi', name: 'Moi', avatarKey: null, x: 0, y: 0, dir: 'down', moving: false, status: 'available', media: { mic: false, cam: false, screen: false } }, players: [], mapKey: 'dev-office', chatHistory: [], desks: [], closedDesks: [], deskBans: [] });
    const task = { status: 'done', giver: { id: 'moi', name: 'Moi' } };
    bus.emit('task:assigned', {});
    bus.emit('task:changed', task);
    store.getState().setStatus('moi', 'dnd');
    bus.emit('task:assigned', {});
    bus.emit('task:changed', task);
    bus.emit('shop:bought', { itemId: 'statue' });
    // L'arrivée au bureau (le premier init) a son air, puis la progression.
    expect(ids()).toEqual(['welcome', 'mission', 'success', 'coins']);
  });
});

describe('les clics de l\'interface', () => {
  test('un bouton fait un clic', () => {
    click('<button type="button">Chat</button>');
    expect(ids()).toEqual(['click']);
  });

  test('ce qui est dans un bouton (une icône, un mot) compte comme le bouton', () => {
    document.body.innerHTML = '<button type="button"><svg><path id="p" /></svg>Micro</button>';
    document.getElementById('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ids()).toEqual(['click']);
  });

  test('un bouton qui ouvre ou ferme un panneau : le bruit d\'ouverture, ou de fermeture, d\'après son état avant le clic', () => {
    click('<button type="button" aria-expanded="false">Chat</button>');
    click('<button type="button" aria-expanded="true">Chat</button>');
    expect(ids()).toEqual(['panel-open', 'panel-close']);
  });

  test('un bouton à bascule (micro, caméra) : allumage ou extinction, d\'après son état avant le clic', () => {
    click('<button type="button" aria-pressed="false">Micro</button>');
    click('<button type="button" aria-pressed="true">Micro</button>');
    expect(ids()).toEqual(['toggle-on', 'toggle-off']);
  });

  test('un interrupteur (case à cocher) : le clic l\'a déjà basculé, on entend son état d\'après', () => {
    document.body.innerHTML = '<input type="checkbox" role="switch" id="sw" />';
    document.getElementById('sw')!.click();
    document.getElementById('sw')!.click();
    expect(ids()).toEqual(['toggle-on', 'toggle-off']);
  });

  test('un onglet, un choix de menu : un clic', () => {
    click('<button role="tab">Tout le monde</button>');
    click('<button role="menuitemradio">Occupé</button>');
    expect(ids()).toEqual(['click', 'click']);
  });

  test('data-sfx="none" le rend muet ; data-sfx="cancel" lui donne un autre bruit ; un nom inconnu est ignoré', () => {
    click('<button type="button" data-sfx="none">Muet</button>');
    expect(ids()).toEqual([]);
    click('<button type="button" data-sfx="cancel">Annuler</button>');
    click('<button type="button" data-sfx="inexistant">Autre</button>');
    expect(ids()).toEqual(['cancel', 'click']);
  });

  test('ni un bouton inactif, ni un lien, ni du texte ne font de bruit', () => {
    click('<button type="button" disabled>Inactif</button>');
    click('<button type="button" aria-disabled="true">Occupé</button>');
    click('<a href="#x">Lien</a>');
    click('<p>Texte</p>');
    expect(ids()).toEqual([]);
  });

  test('uiSoundFor ne plante pas sur ce qui n\'est pas un élément', () => {
    expect(uiSoundFor(null)).toBeNull();
    expect(uiSoundFor(window)).toBeNull();
  });
});

describe('ce qui se passe au bureau', () => {
  test('quelqu\'un arrive : une note ; il repart : la même, plus grave et plus douce', () => {
    store.getState().applyInit(init(player('moi')));
    played.length = 0;
    emitOnBus(bus, 'net:joined', player('a'));
    emitOnBus(bus, 'net:left', { id: 'a' });
    expect(played).toEqual([['arrive'], ['arrive', { rate: 0.8, level: 0.6 }]]);
  });

  test('sa propre arrivée ne sonne pas', () => {
    store.getState().applyInit(init(player('moi')));
    played.length = 0;
    emitOnBus(bus, 'net:joined', player('moi'));
    expect(played).toEqual([]);
  });

  test('l\'arrivée au bureau (le premier init) : le jingle de bienvenue, une seule fois ; une reconnexion ne le rejoue pas', () => {
    store.getState().applyInit(init(player('moi')));
    expect(ids()).toEqual(['welcome']);
    store.getState().setReady(false);
    store.getState().applyInit(init(player('moi')));
    expect(ids()).toEqual(['welcome']);
  });

  test('un message des autres : un bruit ; le sien, non ; l\'historique que le serveur redit, non', () => {
    store.getState().applyInit(init(player('moi'), [player('a')], [message('m0', 'a')]));
    played.length = 0;
    store.getState().addChatMessage(message('m1', 'a'));
    store.getState().addChatMessage(message('m2', 'moi'));
    store.getState().addChatMessage(message('m3', 'a', 'nearby'));
    expect(ids()).toEqual(['message', 'message']);
    // Reconnexion : l'historique est remplacé par celui du serveur, il n'y a rien de nouveau à entendre.
    store.getState().setReady(false);
    played.length = 0;
    store.getState().applyInit(init(player('moi'), [player('a')], [message('m0', 'a'), message('m1', 'a'), message('m9', 'a')]));
    expect(ids()).toEqual([]);
  });

  test('« Ne pas déranger » : ni arrivée, ni départ, ni message, ni toc toc ne sonnent', () => {
    store.getState().applyInit(init(player('moi', { status: 'dnd' })));
    played.length = 0;
    emitOnBus(bus, 'net:joined', player('a'));
    emitOnBus(bus, 'net:left', { id: 'a' });
    store.getState().addChatMessage(message('m1', 'a'));
    store.getState().addDeskKnock({ key: 'A1', userId: 'a', name: 'A' });
    expect(ids()).toEqual([]);
    // Ce qui vient de soi sonne toujours.
    emitOnBus(bus, 'local:knock', { key: 'A2' });
    expect(ids()).toEqual(['knock', 'knock']);
  });

  test('un toc toc, à sa porte ou à celle d\'un autre : deux coups', () => {
    store.getState().applyInit(init(player('moi')));
    played.length = 0;
    store.getState().addDeskKnock({ key: 'A1', userId: 'a', name: 'A' });
    expect(played).toEqual([['knock'], ['knock', { delayMs: 220, level: 0.8 }]]);
    played.length = 0;
    emitOnBus(bus, 'local:knock', { key: 'A3' });
    expect(ids()).toEqual(['knock', 'knock']);
  });

  test('écarter un toc toc, ou le voir remplacé par le suivant du même, ne fait pas de bruit en trop', () => {
    store.getState().applyInit(init(player('moi')));
    store.getState().addDeskKnock({ key: 'A1', userId: 'a', name: 'A' });
    store.getState().addDeskKnock({ key: 'A1', userId: 'b', name: 'B' });
    played.length = 0;
    store.getState().dismissDeskKnock('b');
    expect(ids()).toEqual([]);
  });

  test('la conversation : on y entre, on en sort ; la même room redite ne fait rien ; un onglet remplacé ne sonne pas', () => {
    store.getState().applyInit(init(player('moi')));
    played.length = 0;
    const join = { type: 'join', p: { url: 'ws://x', room: 'r1', token: 't' } } as const;
    store.getState().setMediaInstruction(join);
    store.getState().setMediaInstruction({ ...join, p: { ...join.p } });
    store.getState().setMediaInstruction({ type: 'leave' });
    expect(ids()).toEqual(['conversation-start', 'conversation-end']);
    played.length = 0;
    store.getState().setMediaInstruction(join);
    store.getState().setReplaced(true);
    store.getState().setMediaInstruction({ type: 'leave' });
    expect(ids()).toEqual(['conversation-start']);
  });

  test('la connexion qui tombe et ne revient pas : un bruit après un moment ; si elle revient à temps, rien', () => {
    store.getState().applyInit(init(player('moi')));
    played.length = 0;
    store.getState().setReady(false);
    vi.advanceTimersByTime(LOST_AFTER_MS - 1);
    store.getState().applyInit(init(player('moi')));
    vi.advanceTimersByTime(LOST_AFTER_MS * 2);
    expect(ids()).toEqual([]);

    store.getState().setReady(false);
    vi.advanceTimersByTime(LOST_AFTER_MS);
    expect(ids()).toEqual(['lost']);
  });

  test('se déconnecter (le bureau est vidé) ou être remplacé par un autre onglet : pas de « connexion perdue »', () => {
    store.getState().applyInit(init(player('moi')));
    played.length = 0;
    store.getState().setReady(false);
    store.getState().reset();
    vi.advanceTimersByTime(LOST_AFTER_MS * 2);
    expect(ids()).toEqual([]);

    store.getState().applyInit(init(player('moi')));
    played.length = 0;
    store.getState().setReady(false);
    store.getState().setReplaced(true);
    vi.advanceTimersByTime(LOST_AFTER_MS * 2);
    expect(ids()).toEqual([]);
  });

  test('son personnage enregistré (le serveur renvoie son profil) : un bruit de réussite ; celui d\'un autre, non', () => {
    store.getState().applyInit(init(player('moi'), [player('a')]));
    played.length = 0;
    emitOnBus(bus, 'net:profile', { id: 'a', name: 'Alice', avatarKey: null });
    emitOnBus(bus, 'net:profile', { id: 'moi', name: 'Moi', avatarKey: null });
    expect(ids()).toEqual(['success']);
  });

  test('la déco de son bureau enregistrée : un bruit de réussite', () => {
    store.getState().applyInit(init(player('moi')));
    const desk = { key: 'A1', ownerId: 'moi', ownerName: 'Moi', name: null, locked: false, closedByState: false, floor: 'parquet-clair', wall: 'creme', items: [] };
    store.getState().openDecorEditor(desk);
    played.length = 0;
    store.getState().markDecorSaved();
    // Rien n'a changé depuis l'ouverture : « enregistré » est le même brouillon, donc pas de nouveau bruit.
    expect(ids()).toEqual([]);
    store.getState().patchDecorTheme({ floor: 'noyer' });
    store.getState().markDecorSaved();
    expect(ids()).toEqual(['success']);
  });

  test('sa conversation verrouillée : un verrou qui se ferme, puis qui s\'ouvre (déverrouillée, ou plus personne avec soi) ; qui en sort, rien de plus', () => {
    store.getState().applyInit(init(player('moi'), [player('a')]));
    played.length = 0;
    const lock = { id: 'g1', members: ['a', 'moi'], by: { id: 'a', name: 'A' }, at: 1 };
    emitOnBus(bus, 'conversation:lock', { lock, cause: 'locked', by: { id: 'a', name: 'A' } });
    emitOnBus(bus, 'conversation:lock', { lock: null, cause: 'unlocked', by: { id: 'moi', name: 'MOI' } });
    emitOnBus(bus, 'conversation:lock', { lock, cause: 'left', by: { id: 'b', name: 'B' } });
    emitOnBus(bus, 'conversation:lock', { lock: null, cause: 'quit', by: { id: 'moi', name: 'MOI' } });
    emitOnBus(bus, 'conversation:lock', { lock: null, cause: 'ended', by: { id: 'a', name: 'A' } });
    expect(ids()).toEqual(['lock', 'unlock', 'unlock']);
  });

  test('la lumière qui change : le bruit d\'un interrupteur, qui baisse (tamisée, éteinte) ou se rallume, de qui que ce soit', () => {
    store.getState().applyInit(init(player('moi'), [player('a')]));
    played.length = 0;
    emitOnBus(bus, 'lights:changed', { level: 'off', by: { id: 'a', name: 'A' }, at: 1 });
    emitOnBus(bus, 'lights:changed', { level: 'on', by: { id: 'moi', name: 'MOI' }, at: 2 });
    emitOnBus(bus, 'lights:changed', { level: 'dim', by: { id: 'moi', name: 'MOI' }, at: 3 });
    expect(played).toEqual([['toggle-off'], ['toggle-on'], ['toggle-off']]);
  });

  test('l\'état de la lumière à l\'arrivée (l\'init) n\'est pas un changement : aucun bruit', () => {
    store.getState().applyInit({ ...init(player('moi'), [player('a')]), lights: { level: 'off', by: { id: 'a', name: 'A' }, at: 1 } });
    store.getState().setLights({ level: 'on', by: { id: 'a', name: 'A' }, at: 2 });
    expect(ids()).toEqual(['welcome']);
  });

  test('« Ne pas déranger » : la lumière qu\'un autre change ne sonne pas, celle qu\'on change soi-même si', () => {
    store.getState().applyInit(init(player('moi', { status: 'dnd' }), [player('a')]));
    played.length = 0;
    emitOnBus(bus, 'lights:changed', { level: 'off', by: { id: 'a', name: 'A' }, at: 1 });
    expect(ids()).toEqual([]);
    emitOnBus(bus, 'lights:changed', { level: 'on', by: { id: 'moi', name: 'MOI' }, at: 2 });
    expect(ids()).toEqual(['toggle-on']);
  });

  describe('la musique de la pièce où l\'on est', () => {
    const by = (id: string) => ({ id, name: id.toUpperCase() });
    const room = (over: Partial<RoomMusic>, at = 1): RoomMusic => ({ ...DEFAULT_ROOM_MUSIC, by: by('a'), at, ...over });

    beforeEach(() => {
      place = 'game';
      store.getState().applyInit(init(player('moi'), [player('a')]));
      played.length = 0;
    });

    test('un autre la coupe : le bruit d\'un interrupteur qui s\'éteint ; il la relance : celui qui se rallume', () => {
      store.getState().setRoomMusic('game', room({ on: false }));
      store.getState().setRoomMusic('game', room({ on: true }, 2));
      expect(played).toEqual([['toggle-off'], ['toggle-on']]);
    });

    test('un autre change son ambiance, allumée : un clic', () => {
      store.getState().setRoomMusic('game', room({ scene: 'quest' }));
      expect(played).toEqual([['click']]);
    });

    test('éteinte, son ambiance qu\'un autre change ne se voit pas : aucun bruit', () => {
      store.getState().setRoomMusic('game', room({ on: false }));
      played.length = 0;
      store.getState().setRoomMusic('game', room({ on: false, scene: 'quest' }, 2));
      expect(played).toEqual([]);
    });

    test('ce qu\'on règle soi-même ne sonne pas (le clic a déjà son bruit)', () => {
      store.getState().setRoomMusic('game', room({ on: false, by: by('moi') }));
      expect(played).toEqual([]);
    });

    test('la musique d\'une autre pièce que la sienne ne sonne pas', () => {
      store.getState().setRoomMusic('lounge', room({ on: false }));
      expect(played).toEqual([]);
    });

    test('sans pièce réglable sous les pieds (la rue, la place), aucun bruit', () => {
      place = null;
      store.getState().setRoomMusic('game', room({ on: false }));
      expect(played).toEqual([]);
    });

    test('« Ne pas déranger » : la musique qu\'un autre règle ne sonne pas', () => {
      store.getState().applyInit(init(player('moi', { status: 'dnd' }), [player('a')]));
      played.length = 0;
      store.getState().setRoomMusic('game', room({ on: false }));
      expect(played).toEqual([]);
    });

    test('l\'état des pièces à l\'arrivée (l\'init) n\'est pas un changement ; une pièce déjà éteinte qu\'on rallume l\'est', () => {
      store.getState().setReady(false);
      store.getState().applyInit({ ...init(player('moi'), [player('a')]), music: { game: room({ on: false }) } });
      expect(ids()).toEqual([]);
      store.getState().setRoomMusic('game', room({ on: true }, 2));
      expect(played).toEqual([['toggle-on']]);
    });

    test('une demande qui ne change rien (le même état annoncé deux fois) ne sonne qu\'une fois', () => {
      store.getState().setRoomMusic('game', room({ on: false }));
      store.getState().setRoomMusic('game', room({ on: false }, 2));
      expect(played).toEqual([['toggle-off']]);
    });
  });

  test('le café qu\'on se sert : le bruit de la machine, puis le coup de fouet du café un instant après ; celui des autres, et la fin du sien, ne sonnent pas', () => {
    store.getState().applyInit(init(player('moi'), [player('a')]));
    played.length = 0;
    emitOnBus(bus, 'coffee:changed', { id: 'a', ms: 30_000 });
    emitOnBus(bus, 'coffee:changed', { id: 'moi', ms: 0 });
    expect(played).toEqual([]);
    emitOnBus(bus, 'coffee:changed', { id: 'moi', ms: 30_000 });
    expect(played).toEqual([['coffee'], ['boost', { delayMs: COFFEE_BOOST_DELAY_MS }]]);
  });

  test('le café qu\'on se sert sonne même en « Ne pas déranger » : c\'est sa propre action', () => {
    store.getState().applyInit(init(player('moi', { status: 'dnd' }), [player('a')]));
    played.length = 0;
    emitOnBus(bus, 'coffee:changed', { id: 'moi', ms: 30_000 });
    expect(ids()).toEqual(['coffee', 'boost']);
  });

  test('le café de l\'init (on arrive pendant qu\'on en a un) n\'est pas une prise : aucun bruit', () => {
    store.getState().applyInit(init(player('moi', { boost: 12_000 }), [player('a', { boost: 30_000 })]));
    expect(ids()).toEqual(['welcome']);
  });

  test('un voyage voulu (un mode qui conduit à la salle de sport) fait le bruit du saut ; une simple correction ne sonne pas', () => {
    store.getState().applyInit(init(player('moi'), []));
    played.length = 0;
    emitOnBus(bus, 'net:correct', { x: 10, y: 20 });
    expect(played).toEqual([]);
    emitOnBus(bus, 'net:correct', { x: 10, y: 20, reason: 'teleport' });
    expect(played).toEqual([['teleport']]);
  });

  test('débrancher : plus rien ne sonne', () => {
    unbind();
    click('<button type="button">Chat</button>');
    emitOnBus(bus, 'net:joined', player('a'));
    emitOnBus(bus, 'lights:changed', { level: 'off', by: null, at: 1 });
    emitOnBus(bus, 'coffee:changed', { id: 'moi', ms: 30_000 });
    emitOnBus(bus, 'net:correct', { x: 1, y: 2, reason: 'teleport' });
    store.getState().applyInit(init(player('moi')));
    expect(ids()).toEqual([]);
  });
});

describe('les portes des bureaux', () => {
  const door = (over: Partial<{ key: string; open: boolean; ownerId: string | null; distancePx: number }> = {}) => ({ key: 'A1', open: false, ownerId: 'a', distancePx: 0, ...over });
  const level = (index: number) => (played[index]?.[1] as { level: number } | undefined)?.level;

  test('une porte qui se ferme joue door-close, une porte qui s\'ouvre door-open : plein volume de près', () => {
    store.getState().applyInit(init(player('moi'), [player('a')]));
    played.length = 0;
    emitOnBus(bus, 'door:moved', door({ open: false }));
    emitOnBus(bus, 'door:moved', door({ open: true }));
    expect(ids()).toEqual(['door-close', 'door-open']);
    expect([level(0), level(1)]).toEqual([1, 1]);
  });

  test('plus la porte est loin, plus le bruit est faible ; à 14 cases et au-delà, rien', () => {
    store.getState().applyInit(init(player('moi'), [player('a')]));
    played.length = 0;
    emitOnBus(bus, 'door:moved', door({ distancePx: AUDIO_SILENT_DISTANCE_PX - 64 }));
    expect(level(0)).toBeGreaterThan(0);
    expect(level(0)).toBeLessThan(1);
    emitOnBus(bus, 'door:moved', door({ distancePx: AUDIO_SILENT_DISTANCE_PX }));
    emitOnBus(bus, 'door:moved', door({ distancePx: AUDIO_SILENT_DISTANCE_PX * 3 }));
    expect(ids()).toEqual(['door-close']);
  });

  test('« Ne pas déranger » : la porte d\'un autre ne sonne pas, la sienne si', () => {
    store.getState().applyInit(init(player('moi', { status: 'dnd' }), [player('a')]));
    played.length = 0;
    emitOnBus(bus, 'door:moved', door({ ownerId: 'a' }));
    expect(ids()).toEqual([]);
    emitOnBus(bus, 'door:moved', door({ ownerId: 'moi', open: true }));
    expect(ids()).toEqual(['door-open']);
  });

  const desk = (over: Partial<DeskInfo> = {}): DeskInfo => ({ key: 'A1', ownerId: 'moi', ownerName: 'MOI', name: null, locked: false, closedByState: false, floor: 'sable', wall: 'creme', items: [], ...over });

  test('verrouiller son bureau joue lock, le déverrouiller unlock', () => {
    store.getState().applyInit({ ...init(player('moi'), [player('a')]), desks: [desk()] });
    played.length = 0;
    store.getState().setDesk(desk({ locked: true }));
    store.getState().setDesk(desk({ locked: false }));
    expect(ids()).toEqual(['lock', 'unlock']);
  });

  test('le verrou d\'un autre bureau ne sonne pas ; ni un changement de nom, ni l\'arrivée avec un bureau déjà verrouillé', () => {
    store.getState().applyInit({ ...init(player('moi'), [player('a')]), desks: [desk(), desk({ key: 'A2', ownerId: 'a', ownerName: 'A' })] });
    played.length = 0;
    store.getState().setDesk(desk({ key: 'A2', ownerId: 'a', ownerName: 'A', locked: true }));
    store.getState().setDesk(desk({ name: 'Le QG' }));
    expect(ids()).toEqual([]);
    const locked = createOfficeStore();
    const quietBus = new EventEmitter();
    const heard: SfxId[] = [];
    const off = bindSfx({ playSfx: (id) => void heard.push(id) }, { bus: quietBus, store: locked });
    locked.getState().applyInit({ ...init(player('moi'), []), desks: [desk({ locked: true })] });
    expect(heard).toEqual(['welcome']);
    off();
  });
});
