import type { ChatMessage } from '@bureau/shared';
import type { StoreApi } from 'zustand';
import { listenOnBus, type OfficeBus } from '../net/office-connection';
import type { OfficeState } from '../state/office-store';
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

interface SfxDeps {
  bus: OfficeBus;
  store: StoreApi<OfficeState>;
  doc?: Document;
}

// Branche les effets sur ce qui se passe : les clics de l'interface, les arrivées et départs, les messages, les toc toc, la conversation
// qui commence ou finit, l'arrivée au bureau, la connexion qui tombe, un bureau ou un personnage enregistré, la lumière qu'on allume ou
// qu'on éteint. Renvoie la fonction qui débranche tout.
//
// En « Ne pas déranger », ce qui vient des autres (arrivées, messages, toc toc, la lumière) ne sonne pas.
export function bindSfx(engine: SfxTarget, { bus, store, doc = document }: SfxDeps): () => void {
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
    // La lumière du bureau change : le bruit d'un interrupteur, qui s'éteint (`toggle-off`) ou se rallume (`toggle-on`). Celui d'un autre ne
    // sonne pas en « Ne pas déranger » ; le sien, toujours.
    listenOnBus(bus, 'lights:changed', ({ on, by }) => {
      if (by?.id === state().selfId || !quiet()) engine.playSfx(on ? 'toggle-on' : 'toggle-off');
    }),
    listenOnBus(bus, 'net:profile', ({ id }) => {
      if (id === state().selfId) engine.playSfx('success');
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

      // La déco du bureau est enregistrée.
      if (now.decorEditor !== null && before.decorEditor !== null && now.decorEditor.saved !== before.decorEditor.saved) engine.playSfx('success');
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
