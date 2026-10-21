import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { Segmented, type SegmentedOption } from './Segmented';

type Id = 'here' | 'all' | 'off';

// Un sélecteur et le panneau qu'il commande : `onSelect` retient comment l'option a été choisie.
function Harness({ options, onSelect }: { options: SegmentedOption<Id>[]; onSelect?: (id: Id, how: 'pointer' | 'keyboard') => void }) {
  const [value, setValue] = useState<Id>('here');
  return (
    <>
      <Segmented
        label="Qui afficher"
        value={value}
        options={options}
        panelId="panneau"
        tabId={(id) => `onglet-${id}`}
        onSelect={(id, how) => {
          setValue(id);
          onSelect?.(id, how);
        }}
      />
      <div id="panneau" role="tabpanel" aria-labelledby={`onglet-${value}`} />
    </>
  );
}

const TWO: SegmentedOption<Id>[] = [
  { id: 'here', label: 'Ici', count: 3 },
  { id: 'all', label: 'Tout le bureau', count: 9 },
];
const tab = (name: string | RegExp) => screen.getByRole('tab', { name }) as HTMLButtonElement;

test('un groupe d\'onglets nommé, dont chacun dit son libellé et son nombre ; le choisi est le seul dans l\'ordre de tabulation', () => {
  render(<Harness options={TWO} />);
  const tabs = screen.getAllByRole('tab');
  expect(screen.getByRole('tablist', { name: 'Qui afficher' })).toBeTruthy();
  expect(tabs.map((t) => t.textContent)).toEqual(['Ici 3', 'Tout le bureau 9']);
  expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1]);
  // Les onglets désignent le panneau, qui est nommé par celui qui est choisi.
  expect(tabs.map((t) => t.getAttribute('aria-controls'))).toEqual(['panneau', 'panneau']);
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab(/^Ici/).id);
  // Le nombre est du texte discret : le nom de l'onglet dit « Ici 3 ».
  expect(tab('Ici 3')).toBeTruthy();
  expect(tabs[0]!.querySelector('.seg-count')?.textContent).toBe('3');
});

test('sans nombre, rien après le libellé', () => {
  render(<Harness options={[{ id: 'here', label: 'Tout le monde' }, { id: 'all', label: 'À proximité' }]} />);
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tout le monde', 'À proximité']);
  expect(document.querySelector('.seg-count')).toBeNull();
});

test('un clic choisit l\'onglet, et dit que c\'est au pointeur ; Entrée sur un onglet, un clic sans pointeur, dit que c\'est au clavier', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<Harness options={TWO} onSelect={onSelect} />);
  await user.click(tab(/^Tout le bureau/));
  expect(onSelect).toHaveBeenLastCalledWith('all', 'pointer');
  expect(tab(/^Tout le bureau/).getAttribute('aria-selected')).toBe('true');

  tab(/^Ici/).focus();
  await user.keyboard('{Enter}');
  expect(onSelect).toHaveBeenLastCalledWith('here', 'keyboard');
  expect(tab(/^Ici/).getAttribute('aria-selected')).toBe('true');
});

test('← et → passent d\'un onglet à l\'autre (le focus avec la sélection), Début et Fin vont aux extrémités, un onglet inactif est sauté', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <Harness
      options={[
        { id: 'here', label: 'Un' },
        { id: 'all', label: 'Deux', disabled: true, title: 'Pas maintenant' },
        { id: 'off', label: 'Trois' },
      ]}
      onSelect={onSelect}
    />,
  );
  expect(tab('Deux').disabled).toBe(true);
  expect(tab('Deux').getAttribute('title')).toBe('Pas maintenant');
  tab('Un').focus();
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(tab('Trois'));
  expect(tab('Trois').getAttribute('aria-selected')).toBe('true');
  expect(tab('Trois').tabIndex).toBe(0);
  expect(onSelect).toHaveBeenLastCalledWith('off', 'keyboard');
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(tab('Un'));
  await user.keyboard('{ArrowLeft}');
  expect(document.activeElement).toBe(tab('Trois'));
  await user.keyboard('{Home}');
  expect(document.activeElement).toBe(tab('Un'));
  await user.keyboard('{End}');
  expect(document.activeElement).toBe(tab('Trois'));
});

test('les flèches prises par le sélecteur ne vont pas plus loin (l\'avatar les ignore quand une touche est déjà traitée)', async () => {
  const user = userEvent.setup();
  const seen = vi.fn();
  document.addEventListener('keydown', seen);
  try {
    render(<Harness options={TWO} />);
    tab(/^Ici/).focus();
    await user.keyboard('{ArrowRight}');
    expect(seen.mock.calls[0]![0].defaultPrevented).toBe(true);
  } finally {
    document.removeEventListener('keydown', seen);
  }
});
