import { DEFAULT_ROOM_MUSIC, type ChatMessage } from '@bureau/shared';
import type { StoreApi } from 'zustand';
import { doorSoundLevel } from '../game/door-state';
import { listenOnBus, type OfficeBus } from '../net/office-connection';
import { selectDeskOf, type OfficeState } from '../state/office-store';
import { SFX, type SfxId } from './catalog';
import type { SfxOptions } from './engine';

// Quel effet pour quel geste ou quel événement. Le moteur (engine.ts) sait jouer ; ici on décide quand. Tout ce qui n'est pas de la
// musique passe par là : si la personne coupe les effets, rien de tout cela ne sonne.

export interface SfxTarget {
  playSfx(id: SfxId, options?: SfxOptions): void;
}

// Les commandes qui font un petit bruit quand on les actionne.
const CONTROLS = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="switch"], input[type="checkbox"], input[type="radio"]';

const isSfxId = (value: string): value is SfxId => Object.hasOwn(SFX, value);

// L'effet d'un clic sur cet élément, ou null s'il n'en fait pas. À appeler au clic, avant que l'interface ait réagi :
//   - `data-sfx="none"` le rend muet, `data-sfx="<effet>"` lui en donne un précis ;
//   - un bouton qui ouvre ou ferme quelque chose (aria-expanded) : l'effet d'ouverture ou de fermeture ;
//   - un bouton à bascule (aria-pressed), un interrupteur ou une case à cocher : l'effet d'allumage ou d'extinction, d'après ce que
//     le clic va faire (pour un bouton, son état d'avant ; une case à cocher a déjà basculé quand le clic arrive) ;
//   - tout autre bouton : un clic.
export function uiSoundFor(target: EventTarget | null): SfxId | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(CONTROLS);
  if (control === null || control.matches(':disabled, [aria-disabled="true"]')) return null;

  const wanted = control.getAttribute('data-sfx');
  if (wanted === 'none') return null;
  if (wanted !== null && isSfxId(wanted)) return wanted;

  if (control instanceof HTMLInputElement && control.type === 'checkbox') return control.checked ? 'toggle-on' : 'toggle-off';
  const expanded = control.getAttribute('aria-expanded');
  if (expanded !== null) return expanded === 'true' ? 'panel-close' : 'panel-open';
  const pressed = control.getAttribute('aria-pressed') ?? control.getAttribute('aria-checked');
  if (pressed !== null) return pressed === 'true' ? 'toggle-off' : 'toggle-on';
  return 'click';
}

// Le dernier message d'une liste qui vient d'arriver, ou undefined : l'identifiant du dernier n'était pas dans la liste d'avant.
function arrivedIn(next: readonly ChatMessage[], previous: readonly ChatMessage[]): ChatMessage | undefined {
  const last = next.at(-1);
  if (last === undefined || previous.some((message) => message.id === last.id)) return undefined;
  return last;
}

// Combien de temps la connexion doit être restée coupée pour qu'on le dise : un bref accroc, ou la personne qui se déconnecte, ne sonne pas.
export const LOST_AFTER_MS = 1500;
// Le temps entre les deux coups d'un « toc toc ».
const KNOCK_GAP_MS = 220;
// Le café qu'on se sert : le bruit de la machine (`coffee`, 1 s), puis le coup de fouet du café (`boost`) à la fin de la gorgée.
export const COFFEE_BOOST_DELAY_MS = 850;

interface SfxDeps {
  bus: OfficeBus;
  store: StoreApi<OfficeState>;
  doc?: Document;
  // La pièce réglable où sont les pieds de la personne (celle de l'audio : `placeKey`), ou null ; sans elle, la musique des pièces ne sonne pas.
  placeKey?: () => string | null;
}

// Branche les effets sur ce qui se passe : les clics de l'interface, les arrivées et départs, les messages, les toc toc, la conversation
// qui commence ou finit, l'arrivée au bureau, la connexion qui tombe, un bureau ou un personnage enregistré, la lumière qu'on allume ou
// qu'on éteint, le café qu'on se sert, la musique que quelqu'un d'autre règle dans la pièce où l'on est, le voyage d'un mode, le verrou de sa
// conversation. Renvoie la fonction qui débranche tout.
//
// En « Ne pas déranger », ce qui vient des autres (arrivées, messages, toc toc, la lumière, la musique) ne sonne pas.
export function bindSfx(engine: SfxTarget, { bus, store, doc = document, placeKey = () => null }: SfxDeps): () => void {
  const state = () => store.getState();
  const quiet = () => state().self?.status === 'dnd';
  const knock = () => {
    engine.playSfx('knock');
    engine.playSfx('knock', { delayMs: KNOCK_GAP_MS, level: 0.8 });
  };

  // Au clic, en phase de capture : l'interface n'a pas encore réagi, l'état lu est celui d'avant.
  const onClick = (event: Event) => {
    const id = uiSoundFor(event.target);
    if (id !== null) engine.playSfx(id);
  };
  doc.addEventListener('click', onClick, true);

  let lostTimer: ReturnType<typeof setTimeout> | undefined;
  const offs = [
    () => doc.removeEventListener('click', onClick, true),
    () => clearTimeout(lostTimer),
    listenOnBus(bus, 'net:joined', (player) => {
      if (player.id !== state().selfId && !quiet()) engine.playSfx('arrive');
    }),
    // Un départ est la même note, plus grave et plus douce.
    listenOnBus(bus, 'net:left', () => {
      if (!quiet()) engine.playSfx('arrive', { rate: 0.8, level: 0.6 });
    }),
    listenOnBus(bus, 'local:knock', knock),
    // Un voyage voulu (un mode qui nous conduit à la salle de sport, ou nous ramène au bureau) : le bruit du saut. Une correction ordinaire (un mur, une porte) ne sonne pas.
    listenOnBus(bus, 'net:correct', ({ reason }) => {
      if (reason === 'teleport') engine.playSfx('teleport');
    }),
    // Une porte de bureau se met en mouvement : le bruit d'une porte qui s'ouvre ou se ferme, plus faible avec la distance (le silence à 14 cases). Celui
    // d'un autre ne sonne pas en « Ne pas déranger » ; celui de son propre bureau, toujours.
    listenOnBus(bus, 'door:moved', ({ open, ownerId, distancePx }) => {
      if (ownerId !== state().selfId && quiet()) return;
      const level = doorSoundLevel(distancePx);
      if (level > 0) engine.playSfx(open ? 'door-open' : 'door-close', { level });
    }),
    // La lumière du bureau change : le bruit d'un interrupteur, qui s'éteint (`toggle-off`) ou se rallume (`toggle-on`). Celui d'un autre ne
    // sonne pas en « Ne pas déranger » ; le sien, toujours.
    listenOnBus(bus, 'lights:changed', ({ on, by }) => {
      if (by?.id === state().selfId || !quiet()) engine.playSfx(on ? 'toggle-on' : 'toggle-off');
    }),
    // On se sert un café : le bruit de la machine, puis le coup de fouet du café un instant après, même en « Ne pas déranger » (c'est sa propre action). Le
    // café des autres, et la fin du sien, ne sonnent pas.
    listenOnBus(bus, 'coffee:changed', ({ id, ms }) => {
      if (id !== state().selfId || ms <= 0) return;
      engine.playSfx('coffee');
      engine.playSfx('boost', { delayMs: COFFEE_BOOST_DELAY_MS });
    }),
    listenOnBus(bus, 'net:profile', ({ id }) => {
      if (id === state().selfId) engine.playSfx('success');
    }),
    // La progression : un niveau gagné, sa fanfare ; un gain sans niveau, une gemme ramassée (pas pour le pointage de l'arrivée, qui a déjà son air). Une mission
    // reçue, son air de mystère, et une mission qu'on a confiée accomplie, l'air du succès (des autres : pas en « Ne pas déranger »). Un achat, le bruit des kuartzons.
    listenOnBus(bus, 'progress:gain', ({ source, levelBefore, levelAfter }) => {
      if (levelAfter > levelBefore) engine.playSfx('level-up');
      else if (source !== 'checkin') engine.playSfx('xp');
    }),
    listenOnBus(bus, 'task:assigned', () => {
      if (!quiet()) engine.playSfx('mission');
    }),
    listenOnBus(bus, 'task:changed', (task) => {
      if (task.status === 'done' && task.giver?.id === state().selfId && !quiet()) engine.playSfx('success');
    }),
    listenOnBus(bus, 'shop:bought', () => engine.playSfx('coins')),
    // Sa conversation verrouillée : le bruit d'un verrou qui se ferme (verrouillée) ou qui s'ouvre (déverrouillée, ou plus personne avec soi),
    // chez tous ses membres, celui qui a cliqué compris (son clic est muet). Qui en sort a déjà la fin de la conversation (media:leave).
    listenOnBus(bus, 'conversation:lock', ({ cause }) => {
      if (cause === 'locked') engine.playSfx('lock');
      else if (cause === 'unlocked' || cause === 'ended') engine.playSfx('unlock');
    }),
    store.subscribe((now, before) => {
      // L'arrivée au bureau, la première fois (le premier `init`) ; la connexion qui tombe, si elle ne revient pas tout de suite.
      if (now.ready && !before.ready) {
        clearTimeout(lostTimer);
        if (before.selfId === null) engine.playSfx('welcome');
      }
      if (!now.ready && before.ready) {
        clearTimeout(lostTimer);
        lostTimer = setTimeout(() => {
          const current = state();
          // Pas pour un onglet remplacé, ni pour une personne qui se déconnecte (le bureau est alors vidé : self est null).
          if (!current.ready && current.self !== null && !current.replaced) engine.playSfx('lost');
        }, LOST_AFTER_MS);
      }

      // Un message des autres, hors de l'historique que le serveur redit à la connexion.
      if (now.ready && before.ready && (now.chatAll !== before.chatAll || now.chatNearby !== before.chatNearby)) {
        const message = arrivedIn(now.chatAll, before.chatAll) ?? arrivedIn(now.chatNearby, before.chatNearby);
        if (message !== undefined && message.userId !== now.selfId && !quiet()) engine.playSfx('message');
      }

      // La musique de la pièce où l'on est, qu'un autre règle : le bruit d'un interrupteur qui s'éteint ou se rallume, ou un clic pour une autre ambiance (la pièce éteinte
      // n'en joue aucune). Ce qu'on règle soi-même a déjà le bruit de son clic ; l'état de l'init n'est pas un changement ; celui d'un autre ne sonne pas en « Ne pas déranger ».
      const roomKey = placeKey();
      if (roomKey !== null && now.ready && before.ready && now.music[roomKey] !== before.music[roomKey] && !quiet()) {
        const next = now.music[roomKey] ?? DEFAULT_ROOM_MUSIC;
        const previous = before.music[roomKey] ?? DEFAULT_ROOM_MUSIC;
        if (next.by?.id !== now.selfId) {
          if (next.on !== previous.on) engine.playSfx(next.on ? 'toggle-on' : 'toggle-off');
          else if (next.on && next.scene !== previous.scene) engine.playSfx('click');
        }
      }

      // Quelqu'un toque à la porte de mon bureau (et non : un toc toc qu'on écarte, qui raccourcit la liste).
      if (now.deskKnocks !== before.deskKnocks) {
        const latest = now.deskKnocks.at(-1);
        if (latest !== undefined && latest !== before.deskKnocks.at(-1) && now.deskKnocks.length >= before.deskKnocks.length && !quiet()) knock();
      }

      // La conversation audio/vidéo : on y entre, on en sort.
      if (now.mediaInstruction !== before.mediaInstruction) {
        const next = now.mediaInstruction;
        const previous = before.mediaInstruction;
        if (next?.type === 'join' && !(previous?.type === 'join' && previous.p.room === next.p.room)) engine.playSfx('conversation-start');
        else if (next?.type === 'leave' && previous?.type === 'join' && !now.replaced) engine.playSfx('conversation-end');
      }

      // Le verrou de son propre bureau : on le ferme (`lock`) ou on le rouvre (`unlock`) ; celui d'un autre bureau, ou un bureau déjà verrouillé à
      // l'arrivée, ne sonne pas.
      const mine = selectDeskOf(now, now.selfId);
      const mineBefore = selectDeskOf(before, before.selfId);
      if (mine !== undefined && mineBefore !== undefined && mine.key === mineBefore.key && mine.locked !== mineBefore.locked) engine.playSfx(mine.locked ? 'lock' : 'unlock');

      // La déco du bureau est enregistrée.
      if (now.decorEditor !== null && before.decorEditor !== null && now.decorEditor.saved !== before.decorEditor.saved) engine.playSfx('success');
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
