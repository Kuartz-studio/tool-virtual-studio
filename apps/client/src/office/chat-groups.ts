import type { ChatMessage } from '@bureau/shared';

// Deux messages du même auteur à moins de ce délai l'un de l'autre sont du même groupe : le portrait et le nom ne sont qu'au premier.
export const GROUP_WINDOW_MS = 3 * 60_000;

// Un message de la liste, et s'il ouvre un groupe (portrait, nom et heure) ou en est la suite.
export interface ChatRow {
  message: ChatMessage;
  first: boolean;
}

// Le message est-il la suite de celui d'avant : même auteur, et pas plus de GROUP_WINDOW_MS entre les deux (d'un message au suivant, non du
// début du groupe : une conversation suivie reste un seul groupe). Une date illisible, ou à rebours, n'est la suite de rien.
function continues(previous: ChatMessage, message: ChatMessage): boolean {
  if (previous.userId !== message.userId) return false;
  const gap = Date.parse(message.sentAt) - Date.parse(previous.sentAt);
  return Number.isFinite(gap) && gap >= 0 && gap <= GROUP_WINDOW_MS;
}

// Les messages du chat, avec pour chacun s'il ouvre un groupe. L'ordre est celui de la liste.
export function groupMessages(messages: readonly ChatMessage[]): ChatRow[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    return { message, first: previous === undefined || !continues(previous, message) };
  });
}
