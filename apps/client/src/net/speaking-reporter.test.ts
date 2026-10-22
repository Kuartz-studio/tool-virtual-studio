import { SPEAKING_HEARTBEAT_MS } from '@bureau/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSpeakingReporter, SPEAKING_OFF_DELAY_MS, SPEAKING_ON_DELAY_MS } from './speaking-reporter';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const sent: boolean[] = [];
  const reporter = createSpeakingReporter((speaking) => sent.push(speaking));
  return { sent, reporter };
}

describe('allumer et éteindre', () => {
  test('les délais : 150 ms de parole allument, 700 ms de silence éteignent', () => {
    expect([SPEAKING_ON_DELAY_MS, SPEAKING_OFF_DELAY_MS]).toEqual([150, 700]);
  });

  test('« je parle » part après 150 ms de parole continue, pas avant', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([true]);
  });

  test('« je me tais » part après 700 ms de silence, pas avant', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS);
    reporter.feed(false);
    vi.advanceTimersByTime(SPEAKING_OFF_DELAY_MS - 1);
    expect(sent).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([true, false]);
  });

  test('un bruit plus court que 150 ms n\'allume rien', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(100);
    reporter.feed(false);
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
  });

  test('un silence plus court que 700 ms ne coupe pas la bulle', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS);
    reporter.feed(false);
    vi.advanceTimersByTime(500);
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_OFF_DELAY_MS * 3);
    // Ni « je me tais », ni second « je parle » : la bulle est restée allumée.
    expect(sent).toEqual([true]);
  });

  test('redire la même chose ne repousse pas le délai : feed est appelé à chaque changement de la room', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(100);
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS - 100);
    expect(sent).toEqual([true]);

    reporter.feed(false);
    vi.advanceTimersByTime(500);
    reporter.feed(false);
    vi.advanceTimersByTime(SPEAKING_OFF_DELAY_MS - 500);
    expect(sent).toEqual([true, false]);
  });

  test('se taire sans avoir rien dit, ou redire « je parle » une fois allumé : rien de plus ne part', () => {
    const { reporter, sent } = setup();
    reporter.feed(false);
    reporter.feed(false);
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([]);
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS);
    reporter.feed(true);
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_HEARTBEAT_MS - 1);
    expect(sent).toEqual([true]);
  });

  test('on peut reparler après s\'être tu : un nouveau cycle', () => {
    const { reporter, sent } = setup();
    for (let i = 0; i < 3; i++) {
      reporter.feed(true);
      vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS);
      reporter.feed(false);
      vi.advanceTimersByTime(SPEAKING_OFF_DELAY_MS);
    }
    expect(sent).toEqual([true, false, true, false, true, false]);
  });
});

describe('le battement', () => {
  test('tant qu\'on parle, « je parle » est redit toutes les 3 s', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS);
    expect(sent).toEqual([true]);
    vi.advanceTimersByTime(SPEAKING_HEARTBEAT_MS - 1);
    expect(sent).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([true, true]);
    vi.advanceTimersByTime(2 * SPEAKING_HEARTBEAT_MS);
    expect(sent).toEqual([true, true, true, true]);
  });

  test('éteint, plus de battement', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS);
    reporter.feed(false);
    vi.advanceTimersByTime(SPEAKING_OFF_DELAY_MS);
    expect(sent).toEqual([true, false]);
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([true, false]);
  });

  test('un silence entre deux battements ne les décale pas, et ne coupe pas la bulle', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS);
    vi.advanceTimersByTime(2_000);
    reporter.feed(false);
    vi.advanceTimersByTime(300);
    reporter.feed(true);
    // 150 + 3 000 ms depuis le début : le battement tombe à l'heure.
    vi.advanceTimersByTime(SPEAKING_HEARTBEAT_MS - 2_300);
    expect(sent).toEqual([true, true]);
  });
});

describe('stop', () => {
  test('en parlant : « je me tais » part tout de suite, puis plus rien (ni battement, ni délai en attente)', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS);
    reporter.feed(false);
    reporter.stop();
    expect(sent).toEqual([true, false]);
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([true, false]);
  });

  test('sans avoir parlé : rien ne part, et l\'allumage en attente est annulé', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    reporter.stop();
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
  });

  test('arrêté, le reporter ne fait plus rien, même si on lui parle encore ; stop deux fois n\'envoie qu\'une extinction', () => {
    const { reporter, sent } = setup();
    reporter.feed(true);
    vi.advanceTimersByTime(SPEAKING_ON_DELAY_MS);
    reporter.stop();
    reporter.stop();
    reporter.feed(true);
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([true, false]);
  });
});
