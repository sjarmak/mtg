/**
 * `describeIntent`: the design-intent prose shown to both the critic and
 * The playtester's adjudication tool. Exercises what it draws from the slot, the
 * brief's mechanics, a required-card direction, and applied-only revisions.
 */
import { describe, expect, it } from 'vitest';
import type { RevisionRecord, SetBrief } from '@mtg/setgen';
import { describeSlot, parseBrief } from '@mtg/setgen';
import { appliedRevisionSlotIds, appliedRevisionsFor, describeIntent } from '../../src/critic/intent';
import { testEntry, testSlot } from './support';
import { TEST_BRIEF } from '../helpers';

const brief: SetBrief = parseBrief(TEST_BRIEF);

function revision(overrides: Partial<RevisionRecord> = {}): RevisionRecord {
  return {
    slotId: 'CW01',
    category: 'cohesion',
    observation: 'observed thing',
    instruction: 'instructed change',
    outcome: 'applied',
    ...overrides,
  };
}

describe('describeIntent', () => {
  it('is just the slot line when there is no mechanic, required card or revision', () => {
    const entry = testEntry({ mechanics: [] });
    expect(describeIntent(entry, brief, [])).toBe(describeSlot(entry.slot));
  });

  it('adds one line per brief mechanic the slot supports', () => {
    const entry = testEntry({ mechanics: ['Skywake'] });
    const lines = describeIntent(entry, brief, []).split('\n');
    expect(lines).toContain('Mechanic "Skywake": Evasive fliers hold the air while the ground stalls.');
  });

  it('names only the mechanics the slot actually supports, not every brief mechanic', () => {
    const entry = testEntry({ mechanics: ['Skywake'] });
    const text = describeIntent(entry, brief, []);
    expect(text).toContain('Skywake');
    expect(text).not.toContain('Glasscut');
    expect(text).not.toContain('Rootbound');
  });

  it('adds the required-card direction when the slot carries one', () => {
    const entry = testEntry({
      requiredCard: {
        name: 'Test Required Card',
        flavorDirection: 'Reads as ice.',
        equipment: false,
        legendary: false,
      },
    });
    expect(describeIntent(entry, brief, [])).toContain('Required-card direction: Reads as ice.');
  });

  it('omits the required-card line when the required card has no flavor direction', () => {
    const entry = testEntry({
      requiredCard: { name: 'Test Required Card', equipment: false, legendary: false },
    });
    expect(describeIntent(entry, brief, [])).not.toContain('Required-card direction');
  });

  it('includes an applied revision on this slot', () => {
    const entry = testEntry({ id: 'CW01' });
    const revisions = [revision({ slotId: 'CW01', outcome: 'applied' })];
    expect(describeIntent(entry, brief, revisions)).toContain(
      'Critique revision kept: observed thing Change asked for: instructed change',
    );
  });

  it('excludes a reverted revision on the same slot', () => {
    const entry = testEntry({ id: 'CW01' });
    const revisions = [revision({ slotId: 'CW01', outcome: 'reverted', reason: 'broke curve' })];
    expect(describeIntent(entry, brief, revisions)).not.toContain('Critique revision kept');
  });

  it('excludes an applied revision on a different slot', () => {
    const entry = testEntry({ id: 'CW01' });
    const revisions = [revision({ slotId: 'CU02', outcome: 'applied' })];
    expect(describeIntent(entry, brief, revisions)).not.toContain('Critique revision kept');
  });

  it('includes every applied revision on the slot, in order', () => {
    const entry = testEntry({ id: 'CW01' });
    const revisions = [
      revision({ slotId: 'CW01', outcome: 'applied', observation: 'first obs', instruction: 'first change' }),
      revision({
        slotId: 'CW01',
        outcome: 'applied',
        observation: 'second obs',
        instruction: 'second change',
      }),
    ];
    const lines = describeIntent(entry, brief, revisions).split('\n');
    const revisionLines = lines.filter((line) => line.startsWith('Critique revision kept'));
    expect(revisionLines).toStrictEqual([
      'Critique revision kept: first obs Change asked for: first change',
      'Critique revision kept: second obs Change asked for: second change',
    ]);
  });
});

describe('appliedRevisionsFor', () => {
  it('returns only applied revisions for the given slot, preserving order', () => {
    const revisions = [
      revision({ slotId: 'CW01', outcome: 'applied', observation: 'a' }),
      revision({ slotId: 'CU02', outcome: 'applied', observation: 'b' }),
      revision({ slotId: 'CW01', outcome: 'reverted', observation: 'c' }),
      revision({ slotId: 'CW01', outcome: 'applied', observation: 'd' }),
    ];
    expect(appliedRevisionsFor('CW01', revisions).map((r) => r.observation)).toStrictEqual(['a', 'd']);
  });
});

describe('appliedRevisionSlotIds', () => {
  it('collects slot ids with at least one applied revision, deduplicated', () => {
    const revisions = [
      revision({ slotId: 'CW01', outcome: 'applied' }),
      revision({ slotId: 'CW01', outcome: 'applied' }),
      revision({ slotId: 'CU02', outcome: 'reverted' }),
      revision({ slotId: 'CB03', outcome: 'unfilled' }),
    ];
    expect(appliedRevisionSlotIds(revisions)).toStrictEqual(new Set(['CW01']));
  });
});

// Sanity: testSlot() itself must be a legal Slot the way describeSlot reads it.
describe('testSlot', () => {
  it('builds a slot describeSlot can summarize without throwing', () => {
    expect(() => describeSlot(testSlot())).not.toThrow();
  });
});
