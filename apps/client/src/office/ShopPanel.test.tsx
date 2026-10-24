import { SHOP_WALL_THEMES, type MyProgress } from '@bureau/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fr, t } from '../i18n/fr';
import * as progressApi from '../lib/progress-api';
import { useOfficeStore } from '../state/office-store';
import { formatNumber } from './progress-format';
import { SHOP_ITEMS, ShopPanel } from './ShopPanel';

const progress = (over: Partial<MyProgress> = {}): MyProgress => ({ xp: 0, kuartzons: 0, streak: 0, todoXpLeft: 100, owned: [], ...over });

beforeEach(() => {
  useOfficeStore.getState().reset();
  vi.mocked(progressApi.buyItem).mockReset();
});

describe('la boutique', () => {
  test('deux rayons : les objets d\'abord, puis les murs, chacun rangé par rareté', async () => {
    const user = userEvent.setup();
    render(<ShopPanel onClose={() => {}} />);
    const shelves = screen.getByRole('tablist', { name: fr.shop.shelves });
    expect(within(shelves).getAllByRole('tab').map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(document.querySelectorAll('.shop-card')).toHaveLength(SHOP_ITEMS.length);
    await user.click(within(shelves).getByRole('tab', { name: new RegExp(`^${fr.shop.shelf.walls}`) }));
    const cards = [...document.querySelectorAll<HTMLElement>('.shop-card')];
    expect(cards.map((card) => card.dataset.item)).toEqual(SHOP_WALL_THEMES.map((wall) => wall.id));
    expect(cards[0]!.textContent).toContain(fr.shop.wallMeta);
    expect(screen.getByRole('region', { name: fr.shop.rarities.legendaire })).toBeTruthy();
  });

  test('acheter un mur : « Acheter », puis « Confirmer » ; il est à soi', async () => {
    const user = userEvent.setup();
    const wall = SHOP_WALL_THEMES[0];
    act(() => useOfficeStore.getState().setProgress(progress({ kuartzons: 1000 })));
    vi.mocked(progressApi.buyItem).mockResolvedValueOnce(progress({ kuartzons: 1000 - wall.price, owned: [wall.id] }));
    render(<ShopPanel onClose={() => {}} />);
    await user.click(screen.getByRole('tab', { name: new RegExp(`^${fr.shop.shelf.walls}`) }));
    await user.click(screen.getByRole('button', { name: t(fr.shop.buyLabel, { name: wall.label, price: formatNumber(wall.price) }) }));
    await user.click(screen.getByRole('button', { name: t(fr.shop.confirmLabel, { name: wall.label, price: formatNumber(wall.price) }) }));
    expect(progressApi.buyItem).toHaveBeenCalledWith(wall.id);
    const card = document.querySelector(`[data-item="${wall.id}"]`) as HTMLElement;
    expect(card.textContent).toContain(fr.shop.bought);
    expect(useOfficeStore.getState().progress?.owned).toEqual([wall.id]);
  });

  test('« Mes achats » compte ce qu\'on possède dans le rayon ouvert', async () => {
    const user = userEvent.setup();
    act(() => useOfficeStore.getState().setProgress(progress({ owned: [SHOP_WALL_THEMES[1].id] })));
    render(<ShopPanel onClose={() => {}} />);
    const filters = screen.getByRole('tablist', { name: fr.shop.filters });
    expect(within(filters).getByRole('tab', { name: new RegExp(`^${fr.shop.owned}`) }).textContent).toContain('0');
    await user.click(screen.getByRole('tab', { name: new RegExp(`^${fr.shop.shelf.walls}`) }));
    expect(within(filters).getByRole('tab', { name: new RegExp(`^${fr.shop.owned}`) }).textContent).toContain('1');
  });
});
