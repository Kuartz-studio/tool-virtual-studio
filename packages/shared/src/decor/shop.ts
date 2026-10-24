import { decorItem } from './catalog';
import { wallPrice } from './themes';

// Le prix, en kuartzons, de ce qu'on achète à la boutique : un élément de décor de la collection à part (DecorItem.price) ou un mur (SHOP_WALL_THEMES). Les
// identifiants ne se confondent pas (ceux des murs commencent par « mur- »). undefined : ce n'est pas à vendre.
export function shopPriceOf(id: string): number | undefined {
  return decorItem(id)?.price ?? wallPrice(id);
}
