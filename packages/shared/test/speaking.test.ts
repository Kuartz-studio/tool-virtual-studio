import { describe, expect, test } from 'vitest';
import { SPEAKING_HEARTBEAT_MS, SPEAKING_RATE, SPEAKING_TTL_MS, speakingSchema } from '../src';

describe('la parole', () => {
  test('« je parle » ou « je me tais » : un booléen, rien d\'autre', () => {
    expect(speakingSchema.safeParse(true)).toEqual({ success: true, data: true });
    expect(speakingSchema.safeParse(false)).toEqual({ success: true, data: false });
    for (const bad of ['true', 1, 0, null, undefined, {}, [], { speaking: true }]) expect(speakingSchema.safeParse(bad).success, String(bad)).toBe(false);
  });

  test('le client redit « je parle » au moins deux fois dans le délai où le serveur éteint la bulle', () => {
    expect(SPEAKING_HEARTBEAT_MS).toBe(3_000);
    expect(SPEAKING_TTL_MS).toBe(6_000);
    // Un message perdu ne coupe pas la bulle : le suivant arrive avant le délai.
    expect(SPEAKING_TTL_MS).toBeGreaterThanOrEqual(2 * SPEAKING_HEARTBEAT_MS);
    expect(SPEAKING_RATE).toEqual({ max: 8, windowMs: 2_000 });
  });
});
