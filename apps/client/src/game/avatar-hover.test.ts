import { describe, expect, test } from 'vitest';
import { AVATAR_HOVER_BOX, avatarAt } from './avatar-hover';

describe('l\'avatar sous la souris', () => {
  const avatars = [
    { id: 'tom', x: 100, y: 200 },
    { id: 'zoe', x: 108, y: 230 },
  ];

  test('le corps et la tête, au-dessus des pieds ; pas le vide de part et d\'autre', () => {
    const tom = [avatars[0]!];
    expect(avatarAt({ x: 100, y: 199 }, tom)).toBe('tom');
    expect(avatarAt({ x: 100, y: 200 - AVATAR_HOVER_BOX.height }, tom)).toBe('tom');
    expect(avatarAt({ x: 100, y: 200 - AVATAR_HOVER_BOX.height - 1 }, tom)).toBeNull();
    expect(avatarAt({ x: 100 - AVATAR_HOVER_BOX.halfWidth - 1, y: 190 }, tom)).toBeNull();
    expect(avatarAt({ x: 100, y: 201 }, tom)).toBeNull();
  });

  test('deux avatars l\'un devant l\'autre : celui de devant (le plus bas)', () => {
    expect(avatarAt({ x: 104, y: 195 }, avatars)).toBe('zoe');
    expect(avatarAt({ x: 95, y: 170 }, avatars)).toBe('tom');
  });

  test('personne : rien', () => {
    expect(avatarAt({ x: 0, y: 0 }, [])).toBeNull();
  });
});
