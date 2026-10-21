import type { ActivityState } from '@bureau/shared';
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ActivityMark } from './ActivityMark';

const focus: ActivityState = { id: 's1', label: 'En focus', color: '#6d28d9', allowEntry: false, hear: true, heard: false };

test('avec une icône : l\'icône de Lucide, cachée aux lecteurs d\'écran (le nom de l\'état est écrit à côté), et pas de point', () => {
  const { container } = render(<ActivityMark activity={{ ...focus, icon: 'headphones' }} />);
  const icon = container.querySelector('svg')!;
  expect(icon.classList.contains('lucide-headphones')).toBe(true);
  expect(icon.classList.contains('activity-icon')).toBe(true);
  expect(icon.getAttribute('aria-hidden')).toBe('true');
  expect(icon.getAttribute('data-activity')).toBe('s1');
  expect(container.querySelector('.status-dot')).toBeNull();
});

test('sans icône : le point de la couleur de l\'état, comme avant', () => {
  const { container } = render(<ActivityMark activity={focus} />);
  const dot = container.querySelector('.status-dot') as HTMLElement;
  expect(dot.getAttribute('data-activity')).toBe('s1');
  expect(dot.style.backgroundColor).toMatch(/^(#6d28d9|rgb\(109, 40, 217\))$/i);
  expect(container.querySelector('svg')).toBeNull();
});

test('une icône que le client ne connaît pas (une liste qui a changé) : le point', () => {
  const unknown = { ...focus, icon: 'ancienne-icone' } as unknown as ActivityState;
  const { container } = render(<ActivityMark activity={unknown} />);
  expect(container.querySelector('.status-dot')).toBeTruthy();
  expect(container.querySelector('svg')).toBeNull();
});
