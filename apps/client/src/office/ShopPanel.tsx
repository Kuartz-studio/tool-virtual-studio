import { DECOR_ITEMS, RARITIES, SHOP_WALL_THEMES, rarityOf, type DecorItem } from '@bureau/shared';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { EventBus } from '../game/EventBus';
import { fr, t } from '../i18n/fr';
import { ApiError } from '../lib/api';
import { buyItem } from '../lib/progress-api';
import { emitOnBus } from '../net/office-connection';
import { useOfficeStore } from '../state/office-store';
import { CheckIcon, KuartzonIcon } from './icons';
import { formatNumber, kuartzonsText } from './progress-format';
import { DecorThumb, WallPreview } from './sprites';
import { useToasts } from './Toasts';
import { Drawer } from './ui/Drawer';
import { Segmented, type SegmentedOption } from './ui/Segmented';

type Filter = 'all' | 'affordable' | 'owned';
// Les rayons de la boutique : les objets de la collection à part, et les murs.
type Shelf = 'decor' | 'walls';

// Combien de temps « Confirmer » reste proposé après un premier clic sur « Acheter ».
const CONFIRM_MS = 4000;

// Les éléments de la boutique : ceux de la banque qui ont un prix, du moins cher au plus cher.
export const SHOP_ITEMS: readonly DecorItem[] = DECOR_ITEMS.filter((item) => item.price !== undefined).sort((a, b) => a.price! - b.price! || a.name.localeCompare(b.name, 'fr'));

// Ce qu'on vend, d'un rayon ou de l'autre : son identifiant (celui de l'achat), son nom, son prix, son imagette et ce qu'on en dit sous le nom.
interface Product {
  id: string;
  name: string;
  price: number;
  thumb: ReactNode;
  meta: string;
}

const PRODUCTS: Readonly<Record<Shelf, readonly Product[]>> = {
  decor: SHOP_ITEMS.map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price!,
    thumb: <DecorThumb item={item} box={72} />,
    meta: item.w * item.h === 1 ? fr.decor.sizeOne : t(fr.decor.size, { w: item.w, h: item.h }),
  })),
  walls: SHOP_WALL_THEMES.map((wall) => ({ id: wall.id, name: wall.label, price: wall.price, thumb: <WallPreview top={wall.top} bottom={wall.bottom} />, meta: fr.shop.wallMeta })),
};

// Acheter quelque chose (un élément, un mur) : l'appel, puis sa progression au magasin, le bruit des kuartzons et un toast. Rend vrai si c'est fait ; sinon le
// texte du refus.
export async function purchase(item: { id: string; name: string }): Promise<true | string> {
  try {
    // La réponse ne remplace pas une progression plus récente, arrivée par le temps réel pendant l'achat.
    const seq = useOfficeStore.getState().progressSeq;
    useOfficeStore.getState().setProgressSince(await buyItem(item.id), seq);
    emitOnBus(EventBus, 'shop:bought', { itemId: item.id });
    useToasts.getState().push({ icon: <KuartzonIcon />, text: t(fr.shop.success, { name: item.name }) });
    return true;
  } catch (err) {
    const code = err instanceof ApiError ? err.error : '';
    return code === 'owned' || code === 'too_poor' || code === 'unknown_item' ? fr.shop.errors[code] : fr.shop.errors.failed;
  }
}

// Une carte de la boutique : la vignette, le nom, la rareté (sa couleur), la taille (ou « Mur de la pièce »), le prix, et « Acheter » — un premier clic propose
// « Confirmer » quelques secondes ; il manque des kuartzons : le bouton est éteint et dit combien. Acheté : « Acheté ».
function ShopCard({ item, kuartzons, owned }: { item: Product; kuartzons: number; owned: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = item.price;
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
      <span className="shop-thumb">{item.thumb}</span>
      <span className="shop-name" title={item.name}>
        {item.name}
      </span>
      <span className="shop-meta">
        <span className="shop-rarity">{fr.shop.rarities[rarity]}</span> · {item.meta}
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

// La boutique (auprès d'une administratrice, ou le menu « Plus ») : sa bourse en haut, deux rayons (les objets, les murs), puis ce qui est à vendre, rangé par
// rareté (Commun, Rare, Épique, Légendaire), avec un filtre : tout, ce qui est à sa portée, ce qu'on a acheté. Acheté une fois, c'est à soi : un objet se pose
// depuis « Décorer mon bureau », un mur s'y choisit sous « Murs et sol ».
export function ShopPanel({ id, onClose }: { id?: string; onClose(): void }) {
  const progress = useOfficeStore((state) => state.progress);
  const [shelf, setShelf] = useState<Shelf>('decor');
  const [filter, setFilter] = useState<Filter>('all');
  const uid = useId();
  const kuartzons = progress?.kuartzons ?? 0;
  const owned = useMemo(() => new Set(progress?.owned ?? []), [progress?.owned]);

  const products = PRODUCTS[shelf];
  const shown = products.filter((item) => (filter === 'owned' ? owned.has(item.id) : filter === 'affordable' ? !owned.has(item.id) && item.price <= kuartzons : true));
  const shelves: SegmentedOption<Shelf>[] = [
    { id: 'decor', label: fr.shop.shelf.decor, count: PRODUCTS.decor.length },
    { id: 'walls', label: fr.shop.shelf.walls, count: PRODUCTS.walls.length },
  ];
  const options: SegmentedOption<Filter>[] = [
    { id: 'all', label: fr.shop.all },
    { id: 'affordable', label: fr.shop.affordable },
    { id: 'owned', label: fr.shop.owned, count: products.filter((item) => owned.has(item.id)).length },
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
      <Segmented label={fr.shop.shelves} value={shelf} panelId={`${uid}-shelf`} tabId={(which) => `${uid}-shelf-${which}`} options={shelves} onSelect={(which) => setShelf(which)} />
      <div id={`${uid}-shelf`} role="tabpanel" aria-labelledby={`${uid}-shelf-${shelf}`} className="shop-shelf">
        <Segmented label={fr.shop.filters} value={filter} panelId={`${uid}-panel`} tabId={(which) => `${uid}-tab-${which}`} options={options} onSelect={(which) => setFilter(which)} />
        <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${filter}`} className="shop-body">
          {products.length === 0 && <p className="people-empty">{fr.shop.empty}</p>}
          {products.length > 0 && shown.length === 0 && <p className="people-empty">{fr.shop.emptyFilter}</p>}
          {RARITIES.map((rarity) => {
            const items = shown.filter((item) => rarityOf(item.price) === rarity);
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
      </div>
    </Drawer>
  );
}
