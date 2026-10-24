import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fr, t } from '../i18n/fr';
import { useOfficeStore } from '../state/office-store';
import { KuartzonIcon } from './icons';
import { formatNumber } from './progress-format';
import { purchase } from './ShopPanel';

// L'achat sur place, sous une grille (un élément du sélecteur de décor, un mur de la boutique) : l'imagette, le nom, le prix (ou pourquoi l'achat a
// échoué), et « Acheter pour N kuartzons », éteint s'il en manque (son infobulle dit combien). Acheté : `onBought`, et c'est à soi.
export function BuyOffer({ id, name, price, thumb, onBought }: { id: string; name: string; price: number; thumb: ReactNode; onBought(): void }) {
  const kuartzons = useOfficeStore((state) => state.progress?.kuartzons ?? 0);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // L'offre s'ouvre parfois sous le pli d'une liste qui défile (les murs, sous « Murs et sol ») : elle vient à l'écran. Rien n'est rendu à React : un
  // navigateur récent fait renvoyer une promesse à scrollIntoView, que React prendrait pour le nettoyage de l'effet.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  async function buy() {
    setBuying(true);
    setError(null);
    const done = await purchase({ id, name });
    setBuying(false);
    if (done !== true) {
      setError(done);
      return;
    }
    onBought();
  }

  return (
    <div ref={box} className="decor-offer" role="group" aria-label={name}>
      <span className="decor-peek-thumb">{thumb}</span>
      <span className="decor-peek-text">
        <span className="decor-peek-name">{name}</span>
        <span className="decor-peek-meta">{error ?? t(fr.shop.locked, { price: formatNumber(price) })}</span>
      </span>
      <button
        type="button"
        className="bar-button is-primary"
        disabled={buying || kuartzons < price}
        title={kuartzons < price ? t(fr.shop.missing, { count: formatNumber(price - kuartzons) }) : undefined}
        data-sfx="none"
        onClick={() => void buy()}
      >
        <KuartzonIcon />
        {t(fr.shop.buyHere, { price: formatNumber(price) })}
      </button>
    </div>
  );
}
