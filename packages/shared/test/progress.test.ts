import { describe, expect, test } from 'vitest';
import {
  MAX_LEVEL,
  MISSION_TIERS,
  XP_PER_LEVEL,
  authorityForLevel,
  authorityOf,
  checkInXp,
  dayIn,
  kuartzonsBetween,
  kuartzonsForLevel,
  gainOf,
  gradeOf,
  levelOf,
  levelProgress,
  levelShare,
  missionGiveSchema,
  missionXp,
  nextStreak,
  previousWorkday,
  rarityOf,
  todoInputSchema,
  todoPatchSchema,
} from '../src';

describe('les paliers des missions', () => {
  test('ceux de la demande : 5 % d\'un niveau à 1, la moitié à 5, cinq niveaux à 10', () => {
    expect(levelShare(missionXp(1))).toBe(0.05);
    expect(levelShare(missionXp(5))).toBe(0.5);
    expect(levelShare(missionXp(10))).toBe(5);
  });

  test('chaque palier rapporte plus que le précédent, d\'un facteur entre 1,5 et 1,9 : une montée exponentielle', () => {
    const xps = MISSION_TIERS.map(missionXp);
    expect(xps).toEqual([50, 90, 160, 280, 500, 800, 1250, 2000, 3150, 5000]);
    for (let i = 1; i < xps.length; i++) {
      const ratio = xps[i]! / xps[i - 1]!;
      expect(ratio).toBeGreaterThan(1.5);
      expect(ratio).toBeLessThan(1.9);
    }
  });
});

describe('le niveau', () => {
  test('1 000 XP par niveau, de 0 à 200, où il s\'arrête', () => {
    expect(XP_PER_LEVEL).toBe(1000);
    expect([0, 999, 1000, 12_340, 199_999, 200_000, 250_000].map(levelOf)).toEqual([0, 0, 1, 12, 199, 200, 200]);
    expect(levelOf(-5)).toBe(0);
  });

  test('la barre : l\'XP faite dans le niveau, sur 1 000 ; pleine au niveau 200', () => {
    expect(levelProgress(12_340)).toEqual({ level: 12, into: 340, size: 1000, ratio: 0.34 });
    expect(levelProgress(0)).toEqual({ level: 0, into: 0, size: 1000, ratio: 0 });
    expect(levelProgress(240_000)).toEqual({ level: MAX_LEVEL, into: 1000, size: 1000, ratio: 1 });
  });

  test('une mission de difficulté 10 fait monter de cinq niveaux, d\'où que l\'on parte', () => {
    for (const start of [0, 37_500, 150_250]) expect(levelOf(start + missionXp(10)) - levelOf(start)).toBe(5);
  });
});

describe('ce que rapporte un niveau', () => {
  test('des kuartzons, de plus en plus : 25 au niveau 1, 70 au 10, 1 020 au 200 ; rien hors des niveaux', () => {
    expect([1, 10, 100, 200].map(kuartzonsForLevel)).toEqual([25, 70, 520, 1020]);
    expect(kuartzonsForLevel(0)).toBe(0);
    expect(kuartzonsForLevel(201)).toBe(0);
  });

  test('les kuartzons cumulés : 475 au niveau 10, 1 450 au 20, 7 375 au 50, 104 500 au 200', () => {
    expect([10, 20, 50, 200].map((level) => kuartzonsBetween(0, level))).toEqual([475, 1450, 7375, 104_500]);
    expect(kuartzonsBetween(10, 12)).toBe(kuartzonsForLevel(11) + kuartzonsForLevel(12));
    expect(kuartzonsBetween(5, 5)).toBe(0);
    expect(kuartzonsBetween(199, 230)).toBe(kuartzonsForLevel(200));
  });

  test('de l\'autorité, de plus en plus : 1 par niveau jusqu\'au 20, puis 2… jusqu\'à 10 par niveau à la fin', () => {
    expect([1, 20, 21, 40, 41, 200].map(authorityForLevel)).toEqual([1, 1, 2, 2, 3, 10]);
    expect([0, 20, 40, 100, 200].map(authorityOf)).toEqual([0, 20, 60, 300, 1100]);
  });

  test('un grade par tranche de 20 niveaux, et « Légende » au 200', () => {
    expect([0, 19, 20, 39, 40, 100, 180, 199, 200].map(gradeOf)).toEqual(['stagiaire', 'stagiaire', 'junior', 'junior', 'specialiste', 'mentor', 'sage', 'sage', 'legende']);
  });

  test('un gain : le niveau avant et après, les kuartzons des niveaux passés, et si le grade change', () => {
    expect(gainOf(19_800, 500)).toEqual({ levelBefore: 19, levelAfter: 20, kuartzons: kuartzonsForLevel(20), gradeChanged: true });
    expect(gainOf(1200, 50)).toEqual({ levelBefore: 1, levelAfter: 1, kuartzons: 0, gradeChanged: false });
  });
});

describe('le pointage et sa série', () => {
  test('20 XP le premier jour, 5 de plus par jour de série, 50 au plus', () => {
    expect([1, 2, 3, 7, 30].map(checkInXp)).toEqual([20, 25, 30, 50, 50]);
  });

  test('le jour ouvré d\'avant : la veille, le vendredi pour un lundi ou un week-end', () => {
    expect(previousWorkday('2026-10-22')).toBe('2026-10-21');   // jeudi → mercredi
    expect(previousWorkday('2026-10-26')).toBe('2026-10-23');   // lundi → vendredi
    expect(previousWorkday('2026-10-25')).toBe('2026-10-23');   // dimanche → vendredi
  });

  test('la série continue d\'un jour ouvré au suivant, même par-dessus un week-end ; un trou la remet à 1', () => {
    expect(nextStreak(null, 0, '2026-10-22')).toBe(1);
    expect(nextStreak('2026-10-21', 3, '2026-10-22')).toBe(4);
    expect(nextStreak('2026-10-23', 3, '2026-10-26')).toBe(4);   // vendredi → lundi
    expect(nextStreak('2026-10-24', 4, '2026-10-26')).toBe(5);   // venu le samedi
    expect(nextStreak('2026-10-20', 3, '2026-10-22')).toBe(1);   // un jour manqué
    expect(nextStreak('2026-10-22', 3, '2026-10-22')).toBe(3);   // déjà pointé
  });

  test('le jour se compte dans le fuseau de la personne', () => {
    const at = new Date('2026-10-22T23:30:00Z');
    expect(dayIn('Europe/Paris', at)).toBe('2026-10-23');
    expect(dayIn('America/Montreal', at)).toBe('2026-10-22');
    expect(dayIn('Pas/Un-Fuseau', at)).toBe('2026-10-23');
  });
});

describe('la boutique', () => {
  test('la rareté d\'après le prix', () => {
    expect([100, 299, 300, 1199, 1200, 4999, 5000, 15_000].map(rarityOf)).toEqual(['commun', 'commun', 'rare', 'rare', 'epique', 'epique', 'legendaire', 'legendaire']);
  });
});

describe('les schémas', () => {
  test('une mission : à qui, un intitulé, une difficulté de 1 à 10', () => {
    expect(missionGiveSchema.safeParse({ to: 'bob', title: '  Refaire le logo  ', tier: 5 }).data).toEqual({ to: 'bob', title: 'Refaire le logo', tier: 5 });
    for (const tier of [0, 11, 2.5, '5']) expect(missionGiveSchema.safeParse({ to: 'bob', title: 'x', tier }).success).toBe(false);
    expect(missionGiveSchema.safeParse({ to: 'bob', title: '   ', tier: 3 }).success).toBe(false);
    expect(missionGiveSchema.safeParse({ to: 'bob', title: 'x'.repeat(121), tier: 3 }).success).toBe(false);
  });

  test('une tâche à soi : un intitulé ; la modifier demande au moins un champ', () => {
    expect(todoInputSchema.safeParse({ title: 'Répondre à Léa' }).success).toBe(true);
    expect(todoPatchSchema.safeParse({}).success).toBe(false);
    expect(todoPatchSchema.safeParse({ notes: '' }).success).toBe(true);
  });
});
