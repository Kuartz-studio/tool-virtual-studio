import type { MediaPrefs } from './media-client';

// Les préférences audio/vidéo, gardées dans le navigateur (localStorage), d'une visite à l'autre.
const KEY = 'bureau.media.v1';

// Sans préférence enregistrée : micro et caméra allumés en entrant, périphériques du système.
export const DEFAULT_PREFS: Readonly<MediaPrefs> = { mic: true, cam: true };

const DEVICE_FIELDS = ['audioInput', 'videoInput', 'audioOutput'] as const;

// Les préférences enregistrées. Ce qui n'est pas lisible (rien d'enregistré, JSON abîmé, valeur d'un autre type) prend sa valeur par
// défaut, champ par champ. Le stockage peut lever (navigation privée, cookies bloqués) : valeurs par défaut.
export function loadPrefs(): MediaPrefs {
  const prefs: MediaPrefs = { ...DEFAULT_PREFS };
  let stored: unknown;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return prefs;
    stored = JSON.parse(raw);
  } catch {
    return prefs;
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return prefs;
  const fields = stored as Record<string, unknown>;
  if (typeof fields.mic === 'boolean') prefs.mic = fields.mic;
  if (typeof fields.cam === 'boolean') prefs.cam = fields.cam;
  for (const field of DEVICE_FIELDS) {
    const value = fields[field];
    if (typeof value === 'string') prefs[field] = value;
  }
  return prefs;
}

// Enregistre les préférences. Un stockage refusé ou plein ne fait rien : elles valent pour cette visite.
export function savePrefs(p: MediaPrefs): void {
  const prefs: MediaPrefs = { mic: p.mic, cam: p.cam };
  for (const field of DEVICE_FIELDS) {
    const value = p[field];
    if (value !== undefined) prefs[field] = value;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // stockage indisponible : rien à faire
  }
}
