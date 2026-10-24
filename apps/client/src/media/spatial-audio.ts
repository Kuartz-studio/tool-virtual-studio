import { gainBetween, type OfficeMap } from '@bureau/shared';
import { useEffect, useRef, useState } from 'react';
import { EventBus } from '../game/EventBus';
import { listenOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import type { MediaClient, MediaSnapshot } from './media-client';

// Combien de fois par seconde le volume des autres est recalculé : assez pour suivre quelqu'un qui marche (10 positions par seconde),
// sans refaire le travail à chaque image.
export const SPATIAL_AUDIO_HZ = 10;
// En dessous de ce volume, une personne est inaudible : sa vignette n'est plus montrée (et sa vidéo n'est plus reçue).
export const AUDIBLE_GAIN = 0.02;

// Le volume de chaque autre personne de la conversation, pour qui est en `self` : plein dans une zone (bureau, salle), baissant avec la
// distance dans un espace ouvert (gainBetween). Une personne dont on ne connaît pas encore la place est à plein volume : sa position
// arrive avec le tick qui suit son arrivée. `locked` : les membres de sa conversation verrouillée, à plein volume où qu'ils soient (ils
// restent ensemble à travers le bureau, comme au téléphone).
export function volumesFor(
  map: OfficeMap,
  self: { x: number; y: number },
  others: ReadonlyArray<{ id: string }>,
  positionOf: (id: string) => { x: number; y: number } | undefined,
  locked: ReadonlySet<string> = new Set(),
): Record<string, number> {
  const volumes: Record<string, number> = {};
  for (const { id } of others) {
    const at = positionOf(id);
    // Deux décimales : le volume ne change pas pour un pixel de plus.
    volumes[id] = at === undefined || locked.has(id) ? 1 : Math.round(gainBetween(map, self, at) * 100) / 100;
  }
  return volumes;
}

// Le son des autres baisse avec la distance, hors des bureaux et des salles. Tant qu'on est dans une conversation, ce hook règle le volume
// de chacun (client.setVolumes) dix fois par seconde, d'après ma position (celle que le jeu envoie, `local:move`) et celles des autres
// (le magasin). Il rend les identifiants de ceux qu'on n'entend plus du tout : leurs vignettes sont masquées. Dans une conversation
// verrouillée (le magasin, `conversationLock`), ses membres sont à plein volume, et leurs vignettes restent, où qu'ils aillent.
// Sans carte (le jeu n'est pas démarré), ou hors conversation, rien ne change, et personne n'est masqué.
export function useSpatialAudio(client: MediaClient, snapshot: MediaSnapshot): ReadonlySet<string> {
  const [inaudible, setInaudible] = useState<ReadonlySet<string>>(() => new Set());
  const inRoom = snapshot.room !== null;
  const others = snapshot.participants.filter((p) => !p.isLocal).map((p) => p.id);
  const othersSignature = others.join('\u0000');

  // Un état d'activité où l'on n'entend pas les autres : plus aucune voix, où qu'ils soient.
  const deaf = useOfficeStore((state) => state.self?.activity?.hear === false);

  // Ma position : celle que le jeu envoie à chaque pas (`local:move`), suivie dès l'ouverture du bureau, et non seulement en conversation : on
  // y entre souvent à l'arrêt, là où l'on a marché avant (avant, le volume partait de la position de l'`init`, celle de l'arrivée au bureau,
  // jusqu'au pas suivant : quelqu'un qui venait nous parler restait muet). Avant le premier pas, celle de l'`init`.
  const walked = useRef<{ x: number; y: number } | null>(null);
  useEffect(
    () =>
      listenOnBus(EventBus, 'local:move', (move) => {
        walked.current = { x: move.x, y: move.y };
      }),
    [],
  );

  useEffect(() => {
    if (!inRoom) {
      setInaudible((previous) => (previous.size === 0 ? previous : new Set()));
      return;
    }
    let lastSignature = '';
    const update = () => {
      const { officeMap, positions, conversationLock, self: arrival } = useOfficeStore.getState();
      const self = walked.current ?? arrival;
      if (officeMap === null || self === null) return;
      const locked = new Set(conversationLock?.members ?? []);
      const volumes = volumesFor(officeMap, self, others.map((id) => ({ id })), (id) => positions.get(id), locked);
      const heard = deaf ? Object.fromEntries(others.map((id) => [id, 0])) : volumes;
      const signature = JSON.stringify([heard, volumes]);
      if (signature === lastSignature) return;
      lastSignature = signature;
      client.setVolumes?.(heard);
      // Ceux qu'on n'entend plus parce qu'ils sont loin n'ont plus de vignette ; sourd, on garde celles de tous.
      const silent = new Set(others.filter((id) => (volumes[id] ?? 1) < AUDIBLE_GAIN));
      setInaudible((previous) => (sameSet(previous, silent) ? previous : silent));
    };
    update();
    const timer = setInterval(update, 1000 / SPATIAL_AUDIO_HZ);
    return () => clearInterval(timer);
    // `others` est relu à chaque changement de ses identifiants (othersSignature), pas à chaque rendu.
  }, [client, inRoom, othersSignature, deaf]);

  return inaudible;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}
