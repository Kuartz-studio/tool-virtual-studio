import { LUDO_DIE_SIDES, type LudoEvent, type LudoState } from '@bureau/shared/games/ludo';
import { useLayoutEffect, useRef, useState } from 'react';
import { DICE_FACE_MS, DICE_ROLL_MS, planFrames, type Frame } from './frames';

// Les horloges de l'animation des petits chevaux : les chevaux qui sautent de case en case, le dé qui roule. Chacune ne bouge qu'à un NOUVEL état (le plateau reçoit le même état à chaque
// rendu, et une liste d'événements vide qui n'est jamais la même) ; elle lit alors les événements de ce rendu. Avec le mouvement réduit, aucun minuteur n'est jamais armé : l'état
// final, tout de suite. L'animation n'est que visuelle : l'état de la partie est déjà celui d'après le coup, et c'est lui que le plateau montre à la fin, quoi qu'il arrive.

export interface ShownHorses {
  // Les avancées que le plateau montre, par siège.
  horses: number[][];
  // Le cheval qui glisse jusqu'à sa place au lieu d'y sauter (celui qu'on vient de prendre), ou null.
  slide: Frame['slide'];
}

// Les chevaux tels que le plateau les montre : ceux de l'état, ou, pendant un coup qui suit le précédent, les images de planFrames, une à une. L'état précédent est le point de départ
// d'un coup : un état qui arrive en pleine danse coupe la danse en cours (elle va tout de suite à sa fin) et la nouvelle part de là.
export function useShownHorses(state: LudoState, events: readonly LudoEvent[], reducedMotion: boolean): ShownHorses {
  const [shown, setShown] = useState<ShownHorses>(() => ({ horses: state.horses, slide: null }));
  const previous = useRef(state);
  const latest = useRef({ events, reducedMotion });
  useLayoutEffect(() => {
    latest.current = { events, reducedMotion };
  });

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (state === before) return undefined;
    const { events: batch, reducedMotion: reduced } = latest.current;
    const frames = reduced ? [] : planFrames(before.horses, batch);
    if (frames.length === 0) {
      setShown({ horses: state.horses, slide: null });
      return undefined;
    }
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      const frame = frames[index]!;
      setShown({ horses: frame.horses, slide: frame.slide });
      timer = setTimeout(() => {
        index += 1;
        if (index < frames.length) show();
        else setShown({ horses: state.horses, slide: null });
      }, frame.ms);
    };
    show();
    return () => clearTimeout(timer);
  }, [state]);

  return shown;
}

export interface ShownDie {
  // La valeur du dernier lancer (celle du serveur), ou null tant qu'on n'en sait rien.
  value: number | null;
  rolling: boolean;
  // Pendant que le dé roule : la face qu'il montre, au hasard (décoratif : le client peut tirer au hasard ici, jamais dans les règles). Sinon null.
  face: number | null;
}

const randomFace = (): number => 1 + Math.floor(Math.random() * LUDO_DIE_SIDES);

// Le dé tel que le plateau le montre. Un lancer (un événement `dice`) le fait rouler DICE_ROLL_MS sur des faces au hasard, puis il s'arrête sur la valeur du serveur ; avec le mouvement
// réduit, il y est tout de suite. Après un déplacement, le dé garde sa valeur jusqu'au lancer suivant. Un saut d'état en phase `move` redit le dé de l'état, qui le sait.
export function useDie(state: LudoState, events: readonly LudoEvent[], reducedMotion: boolean): ShownDie {
  const [die, setDie] = useState<ShownDie>(() => ({ value: state.phase === 'move' ? state.die : null, rolling: false, face: null }));
  const previous = useRef(state);
  const latest = useRef({ events, reducedMotion });
  useLayoutEffect(() => {
    latest.current = { events, reducedMotion };
  });

  useLayoutEffect(() => {
    if (state === previous.current) return undefined;
    previous.current = state;
    const { events: batch, reducedMotion: reduced } = latest.current;
    const rolls = batch.filter((event): event is Extract<LudoEvent, { type: 'dice' }> => event.type === 'dice');
    const last = rolls[rolls.length - 1];
    if (!last) {
      setDie((current) => ({ value: state.phase === 'move' && state.die !== null ? state.die : current.value, rolling: false, face: null }));
      return undefined;
    }
    if (reduced) {
      setDie({ value: last.value, rolling: false, face: null });
      return undefined;
    }
    setDie({ value: last.value, rolling: true, face: randomFace() });
    const ticker = setInterval(() => {
      const face = randomFace();
      setDie((current) => ({ ...current, face }));
    }, DICE_FACE_MS);
    const done = setTimeout(() => {
      clearInterval(ticker);
      setDie({ value: last.value, rolling: false, face: null });
    }, DICE_ROLL_MS);
    return () => {
      clearInterval(ticker);
      clearTimeout(done);
    };
  }, [state]);

  return die;
}
