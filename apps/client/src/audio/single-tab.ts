import { useEffect, useState } from 'react';

// Un seul onglet joue du son à la fois : le dernier où la personne a touché quelque chose. Sans cela, deux onglets de l'appli (la page de
// connexion laissée ouverte, un bureau dans l'autre) joueraient chacun leur musique, l'une par-dessus l'autre.
//
// Chaque onglet le dit aux autres (BroadcastChannel) quand on y clique ou y tape ; ceux qui l'apprennent se taisent, et reprennent à leur
// prochain geste. Un onglet qu'on n'a pas touché ne coupe donc personne.
const CHANNEL = 'bureau.audio.owner';
// Les gestes qui font d'un onglet celui qui joue : les mêmes que ceux qui débloquent le son.
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;
// Un onglet qui est déjà le dernier ne le redit pas à chaque touche.
export const CLAIM_EVERY_MS = 2000;

// Vrai quand un autre onglet a pris la main : celui-ci doit se taire (musique et effets).
export function useSingleTab(): boolean {
  const [yielded, setYielded] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const me = Math.random().toString(36).slice(2);
    const channel = new BroadcastChannel(CHANNEL);
    let owner: string | null = null;
    let claimedAt = 0;

    channel.onmessage = (event: MessageEvent<{ owner?: string }>) => {
      const other = event.data?.owner;
      if (typeof other !== 'string' || other === me) return;
      owner = other;
      setYielded(true);
    };

    const claim = () => {
      setYielded(false);
      const now = Date.now();
      if (owner === me && now - claimedAt < CLAIM_EVERY_MS) return;
      owner = me;
      claimedAt = now;
      channel.postMessage({ owner: me });
    };
    for (const type of GESTURES) window.addEventListener(type, claim, { capture: true, passive: true });

    return () => {
      for (const type of GESTURES) window.removeEventListener(type, claim, { capture: true });
      channel.close();
    };
  }, []);

  return yielded;
}
