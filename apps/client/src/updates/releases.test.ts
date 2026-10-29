import { CURRENT_RELEASE, compareReleases, isReleaseVersion } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { entriesFor, formatReleaseDate, groupsFor, hasNotesFor, releasesToShow, RELEASE_KINDS, RELEASE_TEXT_MAX, RELEASE_TITLE_MAX, RELEASES, type Release } from './releases';

// Des notes inventées, pour les règles de releasesToShow (les vraies n'ont qu'une version pour l'instant) : une nouveauté chacune, pour tout le monde.
const note = (version: string): Release => ({
  version,
  date: '2026-10-29',
  tagline: `La ${version}`,
  entries: [{ kind: 'new', icon: 'zoom', title: `Nouveau en ${version}`, text: 'Pour tout le monde.' }],
});
const NOTES = [note('1.10'), note('1.09'), note('1.01'), note('1.00')];
const versions = (releases: Release[]) => releases.map((release) => release.version);

describe('les notes de version', () => {
  test('la plus récente est la version en cours, les numéros sont bien formés, uniques et rangés du plus récent au plus ancien', () => {
    expect(RELEASES[0]?.version).toBe(CURRENT_RELEASE);
    const all = RELEASES.map((release) => release.version);
    for (const version of all) expect(isReleaseVersion(version), version).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    for (let i = 1; i < all.length; i++) expect(compareReleases(all[i - 1]!, all[i]!), `${all[i - 1]} avant ${all[i]}`).toBeGreaterThan(0);
  });

  test('chaque note a une date réelle (AAAA-MM-JJ), une accroche et au moins une nouveauté, toutes avec un titre et un texte', () => {
    for (const release of RELEASES) {
      expect(release.date, release.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(`${release.date}T00:00:00Z`).getTime()), release.version).toBe(false);
      expect(release.tagline.trim(), release.version).not.toBe('');
      expect(release.entries.length, release.version).toBeGreaterThan(0);
      for (const entry of release.entries) {
        expect(entry.title.trim(), release.version).not.toBe('');
        expect(entry.text.trim(), entry.title).not.toBe('');
      }
    }
  });

  test('la règle de la surprise : aucune note ne parle de ce qui n\'est pas encore annoncé', () => {
    const words = /\b(xp|niveaux?|missions?|boutique|kuartzons?|caractéristiques?)\b/i;
    for (const release of RELEASES) {
      const texts = [release.tagline, ...release.entries.flatMap((entry) => [entry.title, entry.text])];
      for (const text of texts) expect(text, release.version).not.toMatch(words);
    }
  });

  test('chaque nouveauté tient sur une ligne : un titre et un texte courts', () => {
    for (const entry of RELEASES.flatMap((release) => release.entries)) {
      expect(entry.title.length, entry.title).toBeLessThanOrEqual(RELEASE_TITLE_MAX);
      expect(entry.text.length, entry.text).toBeLessThanOrEqual(RELEASE_TEXT_MAX);
    }
  });

  test('la 1.00 est datée du 29 octobre 2026 ; le premier du mois s\'écrit « 1er »', () => {
    expect(RELEASES.find((release) => release.version === '1.00')?.date).toBe('2026-10-29');
    expect(formatReleaseDate('2026-10-29')).toBe('29 octobre 2026');
    expect(formatReleaseDate('2027-01-01')).toBe('1er janvier 2027');
    expect(formatReleaseDate('2027-03-11')).toBe('11 mars 2027');
  });
});

describe('releasesToShow', () => {
  test('les versions manquées, de la plus récente à la dernière vue (exclue)', () => {
    expect(versions(releasesToShow('1.01', false, 'member', NOTES, '1.10'))).toEqual(['1.10', '1.09']);
    expect(versions(releasesToShow('1.09', false, 'member', NOTES, '1.10'))).toEqual(['1.10']);
    expect(versions(releasesToShow('1.10', false, 'member', NOTES, '1.10'))).toEqual([]);
  });

  test('aucune version vue (ou une valeur abîmée) : seulement la version en cours', () => {
    expect(versions(releasesToShow(null, false, 'member', NOTES, '1.10'))).toEqual(['1.10']);
    expect(versions(releasesToShow('n\'importe quoi', false, 'member', NOTES, '1.10'))).toEqual(['1.10']);
  });

  test('tout l\'historique sur demande ; jamais une note plus récente que la version en cours (le filet de sécurité)', () => {
    expect(versions(releasesToShow('1.10', true, 'member', NOTES, '1.10'))).toEqual(['1.10', '1.09', '1.01', '1.00']);
    expect(versions(releasesToShow(null, true, 'member', NOTES, '1.09'))).toEqual(['1.09', '1.01', '1.00']);
    expect(versions(releasesToShow('1.00', false, 'member', NOTES, '1.09'))).toEqual(['1.09', '1.01']);
  });

  test('une version qui n\'a rien pour les membres (que des nouveautés d\'admins) ne leur est pas montrée', () => {
    const forAdmins: Release = { ...note('1.11'), entries: [{ kind: 'improved', icon: 'admin', title: 'Pour les admins', text: 'Les admins.', adminsOnly: true }] };
    const notes = [forAdmins, ...NOTES];
    expect(hasNotesFor(forAdmins, 'member')).toBe(false);
    expect(hasNotesFor(forAdmins, 'admin')).toBe(true);
    // Un membre en retard de cette seule version n'a pas de fenêtre ; en retard de plus, il voit les autres ; l'admin la voit.
    expect(versions(releasesToShow('1.10', false, 'member', notes, '1.11'))).toEqual([]);
    expect(versions(releasesToShow('1.09', false, 'member', notes, '1.11'))).toEqual(['1.10']);
    expect(versions(releasesToShow('1.10', false, 'admin', notes, '1.11'))).toEqual(['1.11']);
    expect(versions(releasesToShow(null, true, 'member', notes, '1.11'))).toEqual(['1.10', '1.09', '1.01', '1.00']);
  });

  test('les nouveautés réservées aux admins ne sont montrées qu\'aux admins', () => {
    const release: Release = {
      ...note('1.00'),
      entries: [
        { kind: 'new', icon: 'zoom', title: 'Pour tous', text: 'Tout le monde.' },
        { kind: 'improved', icon: 'admin', title: 'Pour les admins', text: 'Les admins.', adminsOnly: true },
      ],
    };
    expect(entriesFor(release, 'member').map((entry) => entry.title)).toEqual(['Pour tous']);
    expect(entriesFor(release, 'admin').map((entry) => entry.title)).toEqual(['Pour tous', 'Pour les admins']);
  });

  test('groupsFor range les nouveautés par genre, dans l\'ordre Nouveautés, Améliorations, Corrections, Suppressions, sans groupe vide', () => {
    const release: Release = {
      ...note('1.00'),
      entries: [
        { kind: 'fixed', icon: 'statusDot', title: 'Corrigé A', text: 'a' },
        { kind: 'removed', icon: 'decor', title: 'Retiré', text: 'r' },
        { kind: 'new', icon: 'zoom', title: 'Nouveau A', text: 'n' },
        { kind: 'fixed', icon: 'statusDot', title: 'Corrigé B', text: 'b' },
        { kind: 'new', icon: 'admin', title: 'Nouveau admin', text: 'n', adminsOnly: true },
      ],
    };
    expect(RELEASE_KINDS).toEqual(['new', 'improved', 'fixed', 'removed']);
    const titles = (role: 'member' | 'admin') => groupsFor(release, role).map(({ kind, entries }) => [kind, entries.map((entry) => entry.title)]);
    expect(titles('member')).toEqual([
      ['new', ['Nouveau A']],
      ['fixed', ['Corrigé A', 'Corrigé B']],
      ['removed', ['Retiré']],
    ]);
    expect(titles('admin')[0]).toEqual(['new', ['Nouveau A', 'Nouveau admin']]);
  });
});
