import { describe, expect, test } from 'vitest';
import { formatNumber, gradeLabel, kuartzonsText, shareText, tierLabel, xpText } from './progress-format';

// Les espaces des milliers, en français, sont des espaces fines insécables : on les compare comme des espaces.
const plain = (text: string) => text.replace(/ | /g, ' ');

describe('les nombres de la progression', () => {
  test('des milliers séparés, des XP et des kuartzons (« 1 kuartzon » au singulier)', () => {
    expect(plain(formatNumber(12_340))).toBe('12 340');
    expect(plain(xpText(1250))).toBe('1 250 XP');
    expect(kuartzonsText(1)).toBe('1 kuartzon');
    expect(plain(kuartzonsText(1450))).toBe('1 450 kuartzons');
  });

  test('une XP en part de niveau : un pourcentage, la moitié, puis des niveaux (le singulier sous deux)', () => {
    expect(shareText(50)).toBe('5 % d\'un niveau');
    expect(shareText(500)).toBe('la moitié d\'un niveau');
    expect(shareText(800)).toBe('80 % d\'un niveau');
    expect(shareText(1250)).toBe('1,25 niveau');
    expect(shareText(2000)).toBe('2 niveaux');
    expect(shareText(3150)).toBe('3,15 niveaux');
    expect(shareText(5000)).toBe('5 niveaux');
  });

  test('le grade et le nom d\'une difficulté', () => {
    expect(gradeLabel(0)).toBe('Stagiaire');
    expect(gradeLabel(26)).toBe('Junior');
    expect(gradeLabel(200)).toBe('Légende');
    expect(tierLabel(10)).toBe('Légendaire');
  });
});
