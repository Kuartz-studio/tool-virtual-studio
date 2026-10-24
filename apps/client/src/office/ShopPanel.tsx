import { DECOR_ITEMS, RARITIES, rarityOf, type DecorItem } from '@bureau/shared';
import { useEffect, useId, useMemo, useState } from 'react';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { ApiError } from '../lib/api';
import { buyItem } from '../lib/progress-api';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { CheckIcon, KuartzonIcon } from './icons';
import { formatNumber, kuartzonsText } from './progress-format';
import { DecorThumb } from './sprites';
import { useToasts } from './Toasts';
import { Drawer } from './ui/Drawer';
import { Segmented, type SegmentedOption } from './ui/Segmented';

type Filter = 'all' | 'affordable' | 'owned';

// Combien de temps « Confirmer » reste proposé après un premier clic sur « Acheter ».
const CONFIRM_MS = 4000;

// Les éléments de la boutique : ceux de la banque qui ont un prix, du moins cher au plus cher.
export const SHOP_ITEMS: readonly DecorItem[] = DECOR_ITEMS.filter((item) => item.price !== undefined).sort((a, b) => a.price! - b.price! || a.name.localeCompare(b.name, 'fr'));

// Acheter un élément : l'appel, puis sa progression au magasin, le bruit des kuartzons et un toast. Rend vrai si c'est fait ; sinon le texte du refus.
export async function purchase(item: DecorItem): Promise<true | string> {
  try {
    useOfficeStore.getState().setProgress(await buyItem(item.id));
    emitOnBus(EventBus, 'shop:bought', { itemId: item.id });
    useToasts.getState().push({ icon: <KuartzonIcon />, text: t(fr.shop.success, { name: item.name }) });
    return true;
  } catch (err) {
    const code = err instanceof ApiError ? err.error : '';
    return code === 'owned' || code === 'too_poor' || code === 'unknown_item' ? fr.shop.errors[code] : fr.shop.errors.failed;
  }
}

// Une carte de la boutique : la vignette, le nom, la rareté (sa couleur), la taille, le prix, et « Acheter » — un premier clic propose « Confirmer » quelques
// secondes ; il manque des kuartzons : le bouton est éteint et dit combien. Acheté : « Acheté ».
function ShopCard({ item, kuartzons, owned }: { item: DecorItem; kuartzons: number; owned: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = item.price!;
  const rarity = rarityOf(price);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  async function buy() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    const done = await purchase(item);
    setBusy(false);
    setConfirming(false);
    if (done !== true) setError(done);
  }

  const missing = price - kuartzons;
  return (
    <li className="shop-card" data-item={item.id} data-rarity={rarity} data-owned={owned || undefined}>
      <span className="shop-thumb">
        <DecorThumb item={item} box={72} />
      </span>
      <span className="shop-name" title={item.name}>
        {item.name}
      </span>
      <span className="shop-meta">
        <span className="shop-rarity">{fr.shop.rarities[rarity]}</span> · {item.w * item.h === 1 ? fr.decor.sizeOne : t(fr.decor.size, { w: item.w, h: item.h })}
      </span>
      {owned ? (
        <span className="shop-owned">
          <CheckIcon />
          {fr.shop.bought}
        </span>
      ) : (
        <button
          type="button"
          className={confirming ? 'bar-button is-primary shop-buy' : 'bar-button shop-buy'}
          disabled={busy || missing > 0}
          title={missing > 0 ? t(fr.shop.missing, { count: formatNumber(missing) }) : undefined}
          aria-label={t(confirming ? fr.shop.confirmLabel : fr.shop.buyLabel, { name: item.name, price: formatNumber(price) })}
          data-sfx={confirming ? 'none' : undefined}
          onClick={() => void buy()}
        >
          <KuartzonIcon />
          {confirming ? fr.shop.confirm : formatNumber(price)}
        </button>
      )}
      {error && <span className="shop-error">{error}</span>}
    </li>
  );
}

// La boutique (auprès d'une administratrice, ou le menu « Plus ») : sa bourse en haut, puis les éléments à vendre, rangés par rareté (Commun, Rare, Épique,
// Légendaire), avec un filtre : tout, ce qui est à sa portée, ce qu'on a acheté. Acheté une fois, un élément est à soi : il se pose depuis « Décorer mon bureau ».
export function ShopPanel({ id, onClose }: { id?: string; onClose(): void }) {
  const progress = useOfficeStore((state) => state.progress);
  const [filter, setFilter] = useState<Filter>('all');
  const uid = useId();
  const kuartzons = progress?.kuartzons ?? 0;
  const owned = useMemo(() => new Set(progress?.owned ?? []), [progress?.owned]);

  const shown = SHOP_ITEMS.filter((item) => (filter === 'owned' ? owned.has(item.id) : filter === 'affordable' ? !owned.has(item.id) && item.price! <= kuartzons : true));
  const options: SegmentedOption<Filter>[] = [
    { id: 'all', label: fr.shop.all },
    { id: 'affordable', label: fr.shop.affordable },
    { id: 'owned', label: fr.shop.owned, count: owned.size },
  ];

  return (
    <Drawer title={fr.shop.title} onClose={onClose} id={id} className="shop-panel">
      <div className="shop-wallet">
        <KuartzonIcon />
        <span>
          <span className="shop-wallet-label">{fr.shop.wallet}</span>
          <span className="shop-wallet-value">{kuartzonsText(kuartzons)}</span>
        </span>
      </div>
      <p className="desk-hint">{fr.shop.intro}</p>
      <Segmented label={fr.shop.filters} value={filter} panelId={`${uid}-panel`} tabId={(which) => `${uid}-tab-${which}`} options={options} onSelect={(which) => setFilter(which)} />
      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${filter}`} className="shop-body">
        {SHOP_ITEMS.length === 0 && <p className="people-empty">{fr.shop.empty}</p>}
        {SHOP_ITEMS.length > 0 && shown.length === 0 && <p className="people-empty">{fr.shop.emptyFilter}</p>}
        {RARITIES.map((rarity) => {
          const items = shown.filter((item) => rarityOf(item.price!) === rarity);
          if (items.length === 0) return null;
          return (
            <section key={rarity} className="shop-section" data-rarity={rarity} aria-label={fr.shop.rarities[rarity]}>
              <h3>{fr.shop.rarities[rarity]}</h3>
              <ul className="shop-grid">
                {items.map((item) => (
                  <ShopCard key={item.id} item={item} kuartzons={kuartzons} owned={owned.has(item.id)} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}
