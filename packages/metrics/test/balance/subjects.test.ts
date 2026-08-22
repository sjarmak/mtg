/**
 * The gate's input side: which set it measures, and what it refuses.
 *
 * These assertions are arithmetic and file IO, not simulation, so they run in
 * milliseconds next to the sweep they configure. The sweep itself proves the
 * other half, that a different set produces a different verdict, in
 * `broken-set.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GateResult, GateStatus } from '@mtg/metrics';
import type { RecordedSpread } from './baseline';
import { isWaived, unwaivedAbstentions, unwaivedFailures } from './baseline';
// Deliberately a second import from the same module rather than four more names
// on the line above: that line is an exact-match anchor in `@mtg/slice`'s
// public-export edits, and widening it breaks the export rather than this file.
import { DRIFT_TOLERANCE, spreadDrift } from './baseline';
import { loadSet } from './set';
import type { BalanceSubject } from './subjects';
import {
  balanceSubjects,
  COMMITTED_SET_PATH,
  COMMITTED_SUBJECT,
  DECLARED_SUBJECTS,
  SET_ENV_VAR,
} from './subjects';

function inTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-balance-subjects-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The subject `MTG_BALANCE_SET` appended, which is always the last one. */
function appended(env: NodeJS.ProcessEnv): BalanceSubject | undefined {
  const subjects = balanceSubjects(env);
  return subjects[subjects.length - 1];
}

describe('declared subjects', () => {
  it('gates on the committed set, which is the regression control', () => {
    expect(DECLARED_SUBJECTS.map((subject) => subject.id)).toEqual(['tideglass-reach']);
  });

  it('names the prototype fixture as the control subject', () => {
    expect(COMMITTED_SUBJECT.origin).toBe('declared');
    expect(COMMITTED_SUBJECT.setPath).toBe(COMMITTED_SET_PATH);
  });

  it('gives every waiver a bead and a measured number, which is what makes it a declaration', () => {
    // Not "the lists are empty" — and pinning emptiness made the strictest setting the only expressible
    // one. What has to hold is the property that made an empty list safe in the
    // first place: an entry is somebody's signed claim, so it carries the value
    // it was measured at, the bead where that measurement is argued, and a
    // reason in prose. An entry appearing with a placeholder in any of those
    // slots is the failure this asserts against, and it is the same failure
    // whether the list has one entry or ten.
    for (const subject of DECLARED_SUBJECTS) {
      for (const waiver of subject.waivers) {
        expect(
          waiver.gate.length,
          `${subject.id}: a waiver with no gate id waives everything`,
        ).toBeGreaterThan(0);
        expect(
          Number.isFinite(waiver.measured),
          `${subject.id}/${waiver.gate}: measured is not a number`,
        ).toBe(true);
        expect(waiver.bead, `${subject.id}/${waiver.gate}: a waiver without a bead is untracked`).toMatch(
          /^mtg-\S+$/,
        );
        expect(
          waiver.why.length,
          `${subject.id}/${waiver.gate}: a waiver with no reason is an amnesty`,
        ).toBeGreaterThan(40);
      }
    }
  });

  it('records a spread for every declared subject, so none can quietly opt out of the drift check', () => {
    // `spread: null` is the escape hatch for an env subject, which is a set
    // nobody has measured and therefore has nothing to have drifted from. The
    // hatch is one `null` away from also meaning "a declared subject that
    // skipped its measurement", and that is the state this whole field exists
    // to make impossible — a declared subject with no recorded reading is back
    // to the situation where the flagship sat at a stale 0.117 for two days
    // with every gate green. The date and the reason are held to the same
    // standard as a waiver's for the same reason: a re-pin that carries a new
    // number under the old explanation is the drift, not the fix.
    for (const subject of DECLARED_SUBJECTS) {
      const recorded = subject.spread;
      expect(recorded, `${subject.id}: a declared subject with no recorded spread`).not.toBeNull();
      if (recorded === null) continue;
      expect(
        Number.isFinite(recorded.measured) && recorded.measured >= 0,
        `${subject.id}: measured is not a spread`,
      ).toBe(true);
      expect(recorded.when, `${subject.id}: a reading with no date cannot be judged stale`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
      expect(
        recorded.why.length,
        `${subject.id}: a reading with no reason is a number nobody has to defend`,
      ).toBeGreaterThan(40);
    }
  });

  it('is what an empty environment resolves to', () => {
    expect(balanceSubjects({})).toBe(DECLARED_SUBJECTS);
  });
});

/**
 * A gate the report could have emitted, reduced to the three fields the waiver
 * arithmetic reads. Synthetic on purpose: these assertions are about which
 * gates a waiver list swallows, and running a simulation to produce a red gate
 * would make the answer depend on the dice it is meant to be independent of.
 */
function gate(id: string, status: GateStatus): GateResult {
  return {
    id,
    label: id,
    status,
    observed: 0.4,
    bound: '40.0% - 70.0%',
    band: { min: 0.4, max: 0.7 },
    detail: `${id} ${status}`,
    source: 'synthetic',
  };
}

describe('the two blocking verdicts', () => {
  const gates = [
    gate('a.red', 'fail'),
    gate('a.undecided', 'withinNoise'),
    gate('a.green', 'pass'),
    gate('a.thin', 'underSampled'),
    gate('a.absent', 'notApplicable'),
  ] as const;
  const waivers = [{ gate: 'a.red', measured: 0.3, bead: 'mtg-0', why: 'declared red' }] as const;

  it('separates a failure from an abstention, so a waiver cannot swallow the wrong one', () => {
    // The property that makes two functions worth having: each returns exactly
    // its own status and nothing else. A single "not passing" filter would let
    // an entry declared for an undecidable gate silently cover a real
    // regression on the same id, which is the whole hazard of widening the
    // ratchet to a fifth status.
    expect(unwaivedFailures([], gates).map((result) => result.id)).toEqual(['a.red']);
    expect(unwaivedAbstentions([], gates).map((result) => result.id)).toEqual(['a.undecided']);
  });

  it('drops a gate the subject declared and keeps every gate it did not', () => {
    expect(unwaivedFailures(waivers, gates)).toEqual([]);
    expect(unwaivedAbstentions(waivers, gates).map((result) => result.id)).toEqual(['a.undecided']);
    expect(isWaived(waivers, 'a.red')).toBe(true);
    expect(isWaived(waivers, 'a.undecided')).toBe(false);
  });

  it('covers both arms of one gate id from one entry', () => {
    // An entry is a claim about a gate, not about a status: the pair that
    // abstains today failed outright at a slightly different pinned seed, and
    // an entry that stopped applying the moment the verdict flickered would
    // have to be re-filed on a coin flip. The drift check is what keeps this
    // from being a blank check, and it lives in `format-health.test.ts`.
    const declared = [{ gate: 'a.pair', measured: 0.39, bead: 'mtg-0', why: 'on the bound' }] as const;
    expect(unwaivedFailures(declared, [gate('a.pair', 'fail')])).toEqual([]);
    expect(unwaivedAbstentions(declared, [gate('a.pair', 'withinNoise')])).toEqual([]);
  });
});

describe(`${SET_ENV_VAR}`, () => {
  it('appends a named set rather than replacing the declared ones', () => {
    const subjects = balanceSubjects({ [SET_ENV_VAR]: '/sets/candidate.set.json' });
    expect(subjects.map((subject) => subject.id)).toEqual(['tideglass-reach', 'env:candidate']);
    const added = subjects[subjects.length - 1];
    expect(added?.setPath).toBe('/sets/candidate.set.json');
    expect(added?.origin).toBe('env');
  });

  it('judges a named set against no waivers, which is the strictest setting', () => {
    expect(appended({ [SET_ENV_VAR]: '/sets/candidate.set.json' })?.waivers).toEqual([]);
  });

  it('resolves a relative path against the working directory', () => {
    expect(appended({ [SET_ENV_VAR]: 'out/slice/set/set.json' })?.setPath).toBe(
      join(process.cwd(), 'out/slice/set/set.json'),
    );
  });

  it('does not measure a declared set twice when pointed at one', () => {
    expect(balanceSubjects({ [SET_ENV_VAR]: COMMITTED_SET_PATH })).toBe(DECLARED_SUBJECTS);
  });

  it('refuses to be set to nothing', () => {
    expect(() => balanceSubjects({ [SET_ENV_VAR]: '  ' })).toThrow(/set but empty/);
  });
});

describe('loading a set', () => {
  it('reads the committed fixture and labels it with its own code and size', () => {
    const set = loadSet(COMMITTED_SET_PATH);
    expect(set.code).toBe('TGR');
    expect(set.pool.length).toBe(90);
    expect(set.label).toBe('TGR Tideglass Reach (90 cards)');
  });

  it('names the path when the file is missing', () => {
    expect(() => loadSet('/no/such/set.json')).toThrow(/\/no\/such\/set\.json could not be read/);
  });

  it('refuses a file that is JSON but not a set', () => {
    inTempDir((dir) => {
      const path = join(dir, 'not-a-set.json');
      writeFileSync(path, JSON.stringify({ set: { code: 'XXX' } }), 'utf8');
      expect(() => loadSet(path)).toThrow(/has no "cards" array/);
    });
  });

  it('refuses a set with no cards in it', () => {
    inTempDir((dir) => {
      const path = join(dir, 'empty.set.json');
      writeFileSync(path, JSON.stringify({ set: { code: 'XXX' }, cards: [] }), 'utf8');
      expect(() => loadSet(path)).toThrow(/empty "cards" array/);
    });
  });

  it('names the card the DSL rejected', () => {
    inTempDir((dir) => {
      const path = join(dir, 'broken.set.json');
      writeFileSync(path, JSON.stringify({ set: { code: 'XXX' }, cards: [{ id: 'nope' }] }), 'utf8');
      expect(() => loadSet(path)).toThrow(/card 0 is not a DSL card/);
    });
  });
});

/**
 * `spreadDrift` decides whether a recorded reading still describes the tree, and
 * these run it on synthetic gates for the same reason the waiver arithmetic is
 * tested that way: the question is what the comparison does with a number, and
 * sweeping 10,035 games to obtain one would make the answer depend on the dice.
 *
 * The pinned-value objection is worth answering here rather than in prose. These
 * do not assert that any subject's spread is 0.1794 — that literal lives once,
 * beside the pool it was measured on. What they assert is the behavior of the
 * comparison: that it is silent inside the tolerance, loud outside it in both
 * directions, and never silent when the reading has gone missing.
 */
describe('a recorded spread against the tree that is actually there', () => {
  const recorded: RecordedSpread = { measured: 0.16, when: '2026-08-16', why: 'a synthetic reading' };

  function spread(observed: number | null): GateResult {
    return { ...gate('balance.spread', 'pass'), observed };
  }

  it('says nothing when the reading is where it was recorded', () => {
    expect(spreadDrift(recorded, spread(0.16))).toBeNull();
  });

  it('absorbs movement up to the tolerance, which is what stops it being a second band', () => {
    // The gate pins its seed, so a fixed tree reproduces the reading exactly and
    // the dice are not in this margin at all. What it absorbs is content and bot
    // movement, at the width the waiver drift check already absorbs it.
    expect(spreadDrift(recorded, spread(0.16 + DRIFT_TOLERANCE))).toBeNull();
    expect(spreadDrift(recorded, spread(0.16 - DRIFT_TOLERANCE))).toBeNull();
  });

  it('fires in both directions, because a format getting tighter is also a tree that moved', () => {
    // A one-sided check would have caught the flagship going 0.117 to 0.179 and
    // missed it going back, which is the same fixture swap in the other
    // direction and equally something nobody measured.
    expect(
      spreadDrift(recorded, spread(0.19)),
      'a spread that widened past the tolerance passed',
    ).not.toBeNull();
    expect(
      spreadDrift(recorded, spread(0.13)),
      'a spread that tightened past the tolerance passed',
    ).not.toBeNull();
    expect(spreadDrift(recorded, spread(0.19)) ?? '').toContain('balance.spread reads 0.1900');
    expect(spreadDrift(recorded, spread(0.13)) ?? '').toContain('balance.spread reads 0.1300');
  });

  it('names both causes and the constant that tells them apart', () => {
    const message = spreadDrift(recorded, spread(0.19)) ?? '';
    expect(message).toContain('0.1600');
    expect(message).toContain('2026-08-16');
    expect(message).toContain('pool digest');
  });

  it('refuses to pass a gate that has stopped reporting a reading at all', () => {
    // `observed: null` is how an abstention or a not-applicable gate arrives.
    // Silence there would mean a subject could lose its spread measurement
    // entirely and the check would go green, which is the failure in its purest
    // form: nothing red, nothing measured.
    expect(spreadDrift(recorded, spread(null))).toContain('reports no reading now');
  });
});
