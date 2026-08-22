/**
 * A target is said as its controller's, and the replay route reads that off the
 * frame (`mtg-fyo`).
 *
 * The bead filed this as a missing column on the game record's object table.
 * The table is the wrong home for it: it is one entry per object per game, an
 * owner never changes and a controller does (CR 108.3, CR 109.4), and the value
 * the recorder had to put there is the controller at the final state — right
 * for the last turn and wrong for every other one. Every snapshot already names
 * the controller of everything on the battlefield and on the stack, per step,
 * so the fact was in the file and the log format did not move.
 *
 * These games are hand-built (`support/synthetic-log.ts`) because no recording
 * can hold what they hold: no effect kind in the DSL changes control, which is
 * exactly why this is cheap to get wrong.
 */
import { describe, expect, it } from 'vitest';
import { describeEvent, namesFor } from '../../src/routes/replay/narrate';
import type { LogEvent } from '../../src/routes/replay/log-schema';
import { fixtureLog } from './support/log-fixture';
import { HOST_CARD, OTHER_CARD, SEAT_LABELS, syntheticLog } from './support/synthetic-log';

const DAMAGE: LogEvent = {
  type: 'damageDealt',
  sourceOid: 'o2',
  target: { kind: 'permanent', oid: 'o1' },
  amount: 2,
  deathtouch: false,
  combat: true,
};

function sentenceAt(seq: number, steps: Parameters<typeof syntheticLog>[0]): string {
  const game = syntheticLog(steps).games[0];
  if (game === undefined) throw new Error('the synthetic log lost its game');
  const step = game.steps[seq];
  if (step === undefined) throw new Error(`the synthetic log has no step ${seq}`);
  const names = namesFor(game, seq);
  const event = step.events[0];
  if (event === undefined) throw new Error(`step ${seq} carries no event`);
  return describeEvent(event, names);
}

describe('a target names the seat that controls it', () => {
  it('reads the controller off the frame rather than the owner off the game', () => {
    // Both permanents are owned by seat 0; the second step hands `o1` to seat 1,
    // which is the only thing that differs between the two sentences.
    const steps = [
      { controllers: [0, 0] as const, events: [DAMAGE] },
      { controllers: [1, 0] as const, events: [DAMAGE] },
    ];
    expect(sentenceAt(0, steps)).toContain(`${SEAT_LABELS[0]}'s ${HOST_CARD.name}`);
    expect(sentenceAt(1, steps)).toContain(`${SEAT_LABELS[1]}'s ${HOST_CARD.name}`);
  });

  it('keeps the source unpossessed, which is the other half of the two slots', () => {
    const line = sentenceAt(0, [{ controllers: [0, 0] as const, events: [DAMAGE] }]);
    expect(line.startsWith(OTHER_CARD.name)).toBe(true);
    expect(line).not.toContain(`${SEAT_LABELS[0]}'s ${OTHER_CARD.name}`);
  });

  it('falls back to the frame before, for a permanent the step it narrates killed', () => {
    // A step's snapshot is the board *after* its action, so the creature that
    // died to this damage is already gone from it. Without the second frame the
    // possessive would silently drop off exactly the sentences about deaths.
    const steps = [
      { controllers: [1, 0] as const, events: [] },
      { controllers: [null, 0] as const, events: [DAMAGE] },
    ];
    expect(sentenceAt(1, steps)).toContain(`${SEAT_LABELS[1]}'s ${HOST_CARD.name}`);
  });
});

describe('over the recorded fixture', () => {
  it('possesses every permanent a damage sentence points at', () => {
    const game = fixtureLog().games[0];
    if (game === undefined) throw new Error('the fixture lost its first game');
    const lines: string[] = [];
    for (const step of game.steps) {
      const names = namesFor(game, step.seq);
      for (const event of step.events) {
        if (event.type !== 'damageDealt' || event.target.kind !== 'permanent') continue;
        lines.push(describeEvent(event, names));
      }
    }
    expect(lines.length).toBeGreaterThan(0);
    // Both seats' decks name themselves, so every one of these carries a
    // possessive built out of one of the two labels.
    for (const line of lines) expect(line).toMatch(/ damage to (RW Aggro|UB Control)'s /);
  });

  it("says an ability by its source rather than as somebody's", () => {
    const game = fixtureLog().games[0];
    if (game === undefined) throw new Error('the fixture lost its first game');
    for (const step of game.steps) {
      const names = namesFor(game, step.seq);
      for (const entry of step.state.stack) {
        if (entry.source === null) continue;
        expect(names.target(entry.oid)).toMatch(/'s ability$/);
      }
    }
  });
});
