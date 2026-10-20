import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { linkify } from './linkify';

// Le texte d'un message, rendu comme le fait le chat : dans un <p>, par React, qui n'y met que des nœuds de texte et des liens.
function renderText(text: string) {
  const { container } = render(<p>{linkify(text)}</p>);
  const paragraph = container.querySelector('p')!;
  return { paragraph, links: [...paragraph.querySelectorAll('a')] };
}

test('linkify', () => {
  // « voir https://a.fr ok » : un seul lien, vers cette adresse, qui s'ouvre ailleurs sans rien donner à la page qu'il ouvre.
  const { paragraph, links } = renderText('voir https://a.fr ok');
  expect(links).toHaveLength(1);
  expect(links[0]!.getAttribute('href')).toBe('https://a.fr');
  expect(links[0]!.textContent).toBe('https://a.fr');
  expect(links[0]!.getAttribute('target')).toBe('_blank');
  expect(links[0]!.getAttribute('rel')).toBe('noopener noreferrer');
  // Le texte autour est resté tel quel, dans l'ordre.
  expect(paragraph.textContent).toBe('voir https://a.fr ok');
  expect([...paragraph.childNodes].map((node) => node.nodeType)).toEqual([Node.TEXT_NODE, Node.ELEMENT_NODE, Node.TEXT_NODE]);

  // « javascript:alert(1) » : du texte, pas un lien.
  const script = renderText('javascript:alert(1)');
  expect(script.links).toHaveLength(0);
  expect(script.paragraph.textContent).toBe('javascript:alert(1)');
  expect(script.paragraph.childElementCount).toBe(0);

  // « <b>x</b> » : du texte, aucun élément <b>.
  const markup = renderText('<b>x</b>');
  expect(markup.paragraph.querySelector('b')).toBeNull();
  expect(markup.paragraph.childElementCount).toBe(0);
  expect(markup.paragraph.textContent).toBe('<b>x</b>');
});

describe('les adresses', () => {
  test('seuls http: et https: deviennent des liens : tout autre schéma reste du texte', () => {
    for (const text of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://a.fr/fichier',
      'mailto:moi@a.fr',
      'ws://a.fr',
      // Sans schéma, ce n'est pas une adresse qu'on sache ouvrir sans la deviner.
      'www.a.fr',
      'a.fr/page',
      '//a.fr/page',
    ]) {
      const { paragraph, links } = renderText(text);
      expect(links, text).toHaveLength(0);
      expect(paragraph.childElementCount, text).toBe(0);
      expect(paragraph.textContent, text).toBe(text);
    }
  });

  test('http: et https:, quelle que soit la casse du schéma ; avec port, chemin, requête et ancre', () => {
    for (const url of [
      'http://a.fr',
      'HTTPS://A.FR/Page',
      'https://a.fr:8443/chemin/vers/page.html?x=1&y=2#ancre',
      'http://localhost:3000/',
      'https://user@a.fr/',
      'https://é.fr/ça',
    ]) {
      const { links } = renderText(`voir ${url} ok`);
      expect(links.map((link) => link.getAttribute('href')), url).toEqual([url]);
    }
  });

  test('plusieurs adresses dans un message : chacune son lien, le texte entre elles intact', () => {
    const { paragraph, links } = renderText('a https://a.fr b http://b.fr/x c');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://a.fr', 'http://b.fr/x']);
    expect(paragraph.textContent).toBe('a https://a.fr b http://b.fr/x c');
  });

  test('l\'adresse s\'arrête à l\'espace, et aux fins de ligne', () => {
    const { links } = renderText('avant\nhttps://a.fr\ttab https://b.fr\napres');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://a.fr', 'https://b.fr']);
  });

  test('la ponctuation de la phrase n\'est pas dans le lien', () => {
    const cases: Array<[text: string, href: string]> = [
      ['voir https://a.fr.', 'https://a.fr'],
      ['voir https://a.fr, puis', 'https://a.fr'],
      ['voir https://a.fr/x?', 'https://a.fr/x'],
      ['voir https://a.fr/x!', 'https://a.fr/x'],
      ['voir https://a.fr/x;', 'https://a.fr/x'],
      ['voir https://a.fr/x:', 'https://a.fr/x'],
      ['voir https://a.fr/x...', 'https://a.fr/x'],
      ['voir (https://a.fr/x)', 'https://a.fr/x'],
      ['voir [https://a.fr/x]', 'https://a.fr/x'],
      ['voir "https://a.fr/x"', 'https://a.fr/x'],
      ['voir « https://a.fr/x »', 'https://a.fr/x'],
      ['voir https://a.fr/x»', 'https://a.fr/x'],
      ['voir https://a.fr/x).', 'https://a.fr/x'],
    ];
    for (const [text, href] of cases) {
      const { paragraph, links } = renderText(text);
      expect(links.map((link) => link.getAttribute('href')), text).toEqual([href]);
      expect(links[0]!.textContent, text).toBe(href);
      // Rien n'est perdu : ce qu'on ôte du lien reste dans le texte, après lui.
      expect(paragraph.textContent, text).toBe(text);
    }
  });

  test('une parenthèse fermante appariée fait partie de l\'adresse (Wikipédia)', () => {
    const { paragraph, links } = renderText('voir https://fr.wikipedia.org/wiki/Mot_(sens) et (https://fr.wikipedia.org/wiki/Mot_(sens)).');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://fr.wikipedia.org/wiki/Mot_(sens)', 'https://fr.wikipedia.org/wiki/Mot_(sens)']);
    expect(paragraph.textContent).toBe('voir https://fr.wikipedia.org/wiki/Mot_(sens) et (https://fr.wikipedia.org/wiki/Mot_(sens)).');
  });

  test('un schéma sans adresse après lui n\'est pas un lien', () => {
    for (const text of ['https://', 'http://.', 'voir https:// ok', 'https://...']) {
      const { paragraph, links } = renderText(text);
      expect(links, text).toHaveLength(0);
      expect(paragraph.textContent, text).toBe(text);
    }
  });

  test('un javascript: dans une adresse https reste dans cette adresse : un seul lien, en https', () => {
    const { links } = renderText('voir https://a.fr/?retour=javascript:alert(1)');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://a.fr/?retour=javascript:alert(1)']);
  });
});

describe('le texte n\'est jamais du HTML', () => {
  test('des balises, des entités et des guillemets restent du texte, à la lettre', () => {
    for (const text of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">clic</a>',
      '&lt;b&gt;gras&lt;/b&gt; &amp; &#60;i&#62;',
      '" onmouseover="alert(1)',
      '<!-- commentaire --> <svg onload=alert(1)>',
    ]) {
      const { paragraph, links } = renderText(text);
      expect(paragraph.childElementCount, text).toBe(0);
      expect(links, text).toHaveLength(0);
      expect(paragraph.textContent, text).toBe(text);
    }
  });

  test('des balises autour d\'une adresse : le lien est l\'adresse seule, les balises restent du texte', () => {
    const { paragraph, links } = renderText('<b>https://a.fr</b> et <https://b.fr>');
    // Les chevrons et les guillemets ne font jamais partie d'une adresse (RFC 3986, annexe C : ils la délimitent).
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://a.fr', 'https://b.fr']);
    expect(paragraph.querySelector('b')).toBeNull();
    expect(paragraph.textContent).toBe('<b>https://a.fr</b> et <https://b.fr>');
  });

  test('des guillemets ne sortent pas de l\'attribut href : le lien n\'a que href, target et rel, et le reste est du texte', () => {
    const { paragraph, links } = renderText('https://a.fr/"onmouseover="alert(1) suite');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttributeNames().sort()).toEqual(['href', 'rel', 'target']);
    expect(links[0]!.getAttribute('href')).toBe('https://a.fr/');
    expect(paragraph.textContent).toBe('https://a.fr/"onmouseover="alert(1) suite');
  });
});

describe('ce que linkify rend', () => {
  test('un tableau de nœuds : du texte et des liens, dans l\'ordre ; rien pour un texte vide', () => {
    expect(linkify('')).toEqual([]);
    expect(linkify('bonjour')).toEqual(['bonjour']);
    const nodes = linkify('a https://a.fr b');
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toBe('a ');
    expect(nodes[2]).toBe(' b');
  });

  test('un texte sans adresse ne crée aucun élément', () => {
    const { paragraph } = renderText('Salut, tout va bien ? Oui : merci.');
    expect(paragraph.childElementCount).toBe(0);
    expect(paragraph.textContent).toBe('Salut, tout va bien ? Oui : merci.');
  });

  test('un texte de 500 caractères d\'adresses collées se traite vite', () => {
    const text = 'http://'.repeat(70);
    const start = performance.now();
    const { paragraph } = renderText(text);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(paragraph.textContent).toBe(text);
  });
});
