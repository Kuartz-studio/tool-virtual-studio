import type { ReactNode } from 'react';

// Un message est du texte, jamais du HTML : linkify le rend en nœuds de texte React (que React échappe) et en liens, seuls éléments qu'il
// crée. Il ne passe donc jamais par dangerouslySetInnerHTML ni par innerHTML.
//
// Une adresse est « http: » ou « https: » (quelle que soit la casse), suivie de tout ce qui n'est ni une espace, ni un chevron, ni un
// guillemet droit : ces trois-là ne font jamais partie d'une adresse écrite dans un texte (RFC 3986, annexe C : ils la délimitent), et
// les laisser dehors garde aussi un guillemet hors de l'attribut `href`. Tout autre schéma (`javascript:`, `data:`, `file:`…), et une
// adresse sans schéma (`www.a.fr`), reste du texte.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]+/gi;

// La ponctuation d'une phrase qui suit l'adresse n'en fait pas partie (« voir https://a.fr. »), ni une parenthèse ou un crochet
// fermant sans ouvrant dans l'adresse (« (voir https://a.fr/x) »). « …/Mot_(sens) », lui, garde la sienne.
const TRAILING_PUNCTUATION = /[.,;:!?'’»”…]+$/u;
const OPENER_OF: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

function count(text: string, char: string): number {
  let found = 0;
  for (const c of text) if (c === char) found++;
  return found;
}

function withoutTrailingPunctuation(raw: string): string {
  let url = raw;
  for (;;) {
    let next = url.replace(TRAILING_PUNCTUATION, '');
    const last = next.at(-1);
    const opener = last === undefined ? undefined : OPENER_OF[last];
    if (last !== undefined && opener !== undefined && count(next, last) > count(next, opener)) next = next.slice(0, -1);
    if (next === url) return url;
    url = next;
  }
}

// Une vraie adresse web : le navigateur la comprend (`https://` seul n'en est pas une), avec l'un des deux schémas permis.
function isWebUrl(candidate: string): boolean {
  try {
    const { protocol } = new URL(candidate);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Le texte d'un message, avec ses adresses web en liens : un tableau de texte et de <a>, dans l'ordre, à poser tel quel dans un élément.
// Le lien s'ouvre dans un autre onglet sans rien donner de la page à celle qu'il ouvre (`noopener`) ni lui dire d'où l'on vient
// (`noreferrer`). Son `href` est l'adresse telle qu'elle est écrite, qui est aussi son texte.
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Ce qui précède cet index est déjà dans `nodes`.
  let done = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = withoutTrailingPunctuation(match[0]);
    if (!isWebUrl(url)) continue;
    if (match.index > done) nodes.push(text.slice(done, match.index));
    nodes.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    done = match.index + url.length;
  }
  if (done < text.length) nodes.push(text.slice(done));
  return nodes;
}
