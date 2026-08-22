/**
 * The harness that replays the bank (ADR-0001 §10.7(c), `mtg-zc2o`).
 *
 * `bank.ts` holds the ledger and the entry types and explains why the bank
 * exists; `replays/` holds the scenarios. This file is the join: every ledger
 * record must be either replayed or explicitly marked unreconstructed with a
 * reason, and every entry must name a record. A bank that claims coverage it
 * does not have is worse than a smaller honest one, so the gap is a value in
 * the list rather than an absence from it.
 *
 * Each replay's test title is built from the ledger — the commit and the rule
 * it broke — and the replay's own property, so a red run names the rule that
 * regressed instead of leaving a reader to find it. That is the whole reason
 * `run` is a bare closure rather than an `it` written in the replay file: the
 * title belongs to the join, because the join is what knows the rule.
 */
import { describe, expect, it } from 'vitest';
import type { BankEntry } from './bank';
import { defectOf, LANDED_RULES_DEFECTS } from './bank';
import { ASKING_REPLAYS } from './replays/asking';
import { COMBAT_REPLAYS } from './replays/combat';
import { CONTRACT_REPLAYS } from './replays/contract';
import { COST_REPLAYS } from './replays/costs';
import { STATE_BASED_REPLAYS } from './replays/state-based';
import { TOKEN_REPLAYS } from './replays/tokens';

/**
 * Every entry in the bank, in no particular order.
 *
 * Grouped by subsystem in `replays/` because that is how a reader arrives —
 * with a defect in hand and a guess about which part of the kernel it touches —
 * and flattened here because the ledger is the index and the ledger is flat.
 */
const BANK: readonly BankEntry[] = [
  ...CONTRACT_REPLAYS,
  ...COMBAT_REPLAYS,
  ...ASKING_REPLAYS,
  ...COST_REPLAYS,
  ...STATE_BASED_REPLAYS,
  ...TOKEN_REPLAYS,
];

describe('the kernel regression-fixture bank', () => {
  for (const entry of BANK) {
    const record = defectOf(entry.commit);
    if (entry.kind === 'unreconstructed') {
      it(`${entry.commit} (${record.rule}) is recorded unreplayed: ${entry.reason}`, () => {
        expect(
          entry.reason.trim().length,
          'an unreconstructed entry with no reason is a silent gap',
        ).toBeGreaterThan(0);
      });
      continue;
    }
    it(`${entry.commit} — ${record.rule} — ${entry.property}`, entry.run);
  }
});

describe('the bank covers the ledger it is derived from', () => {
  it('replays or explicitly excuses every landed rules defect', () => {
    const covered = new Set(BANK.map((entry) => entry.commit));
    const missing = LANDED_RULES_DEFECTS.filter((record) => !covered.has(record.commit));
    // Named rather than counted: a count tells a reader that something is
    // uncovered and not which rule stopped being watched.
    expect(missing.map((record) => `${record.commit} (${record.rule})`)).toEqual([]);
  });

  it('has no entry that names a defect the ledger does not carry', () => {
    const known = new Set(LANDED_RULES_DEFECTS.map((record) => record.commit));
    expect(BANK.filter((entry) => !known.has(entry.commit)).map((entry) => entry.commit)).toEqual([]);
  });

  it('never records one defect as both replayed and unreplayed', () => {
    const replayed = new Set(BANK.filter((entry) => entry.kind === 'replayed').map((e) => e.commit));
    const excused = BANK.filter((entry) => entry.kind === 'unreconstructed').map((e) => e.commit);
    expect(excused.filter((commit) => replayed.has(commit))).toEqual([]);
  });

  it('lists each defect once, so a second fix for one rule gets its own record', () => {
    const commits = LANDED_RULES_DEFECTS.map((record) => record.commit);
    expect(commits).toEqual([...new Set(commits)]);
  });

  it('can name the rule and the pre-fix behavior for every record it carries', () => {
    // The bank's claim is that each entry fails on the pre-fix kernel, and this
    // tree cannot check one out to prove it. So the fail direction lives in
    // `preFix`, and a record without one is an entry nobody can falsify by
    // hand. The rule is what a red title has to print.
    const silent = LANDED_RULES_DEFECTS.filter(
      (record) => record.rule.trim() === '' || record.preFix.trim() === '' || record.defect.trim() === '',
    );
    expect(silent.map((record) => record.commit)).toEqual([]);
  });

  it('gives every replay a property phrased as the assertion it makes', () => {
    const unphrased = BANK.filter((entry) => entry.kind === 'replayed' && entry.property.trim() === '');
    expect(unphrased.map((entry) => entry.commit)).toEqual([]);
  });
});
