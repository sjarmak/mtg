/**
 * Proof that a pool which trips a band measures as tripping it.
 *
 * A gate that takes a set as an input has a new way to be useless: it can take
 * the input, ignore it, and stay green. The argument "of course a bad set would
 * fail" is not evidence, so this file builds one and runs it.
 *
 * What this file does not prove is that `format-health.test.ts`, the file
 * `npm run test:balance` runs, reads the subject it was given: the measurement
 * below goes through `measure()` here, not through the gate. Swapping the gate's
 * own `loadSet` argument left this file green. `gate-wiring.test.ts` is the one
 * that catches that, by running the gate as a child process.
 *
 * The broken set is the committed set with every red creature given +6/+6 and
 * nothing else changed (`boosted-set.ts`, which states why the deformation lives
 * in code). That makes the comparison below a controlled one: same harness, same
 * seed, same volume, same bands, one pool boosted and one not.
 *
 * Volume is 30 games per matchup rather than the pinned 223. That is 1,350
 * games, so every color pair plays 270 and clears the 200-distinct-game floor
 * for the win-rate gates; the control run below asserts that nothing abstained,
 * which is what stops this from being a demonstration that small samples fail.
 * Measured on this hardware: about 2.2 s per sweep, so roughly 5 s for the pair.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FormatHealth } from '@mtg/metrics';
import { formatGates, formatHealth } from '@mtg/metrics';
import { unwaivedFailures } from './baseline';
import { writeBoostedSet } from './boosted-set';
import { decksFor, runRoundRobin } from './round-robin';
import { loadSet } from './set';
import type { BalanceSubject } from './subjects';
import { balanceSubjects, COMMITTED_SUBJECT, SET_ENV_VAR } from './subjects';

/** 1,350 games: 270 per color pair, above the 200-distinct-game win-rate floor. */
const GAMES_PER_MATCHUP = 30;

async function measure(subject: BalanceSubject): Promise<FormatHealth> {
  const set = loadSet(subject.setPath);
  const run = await runRoundRobin(decksFor(set.pool, set.label), GAMES_PER_MATCHUP);
  return formatHealth(run.logs, { label: `${subject.id}: ${set.label}` });
}

describe('a set that trips a band fails the gate', () => {
  let directory: string;
  let boostedCards: number;
  let brokenSubject: BalanceSubject;
  let control: FormatHealth;
  let broken: FormatHealth;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'mtg-balance-broken-'));
    const brokenPath = join(directory, 'boosted-red.set.json');
    boostedCards = writeBoostedSet(COMMITTED_SUBJECT.setPath, brokenPath);

    // Resolved through the same path a human uses to measure a candidate set,
    // so this proves the env entry point rather than a private back door.
    const subjects = balanceSubjects({ [SET_ENV_VAR]: brokenPath });
    const added = subjects.at(-1);
    if (added === undefined || added.origin !== 'env') {
      throw new Error(`${SET_ENV_VAR}=${brokenPath} did not add a subject`);
    }
    brokenSubject = added;

    control = await measure(COMMITTED_SUBJECT);
    broken = await measure(brokenSubject);
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('boosted a meaningful number of cards, so the two pools really differ', () => {
    expect(boostedCards).toBeGreaterThanOrEqual(10);
  });

  it('measured both sets at the same volume', () => {
    expect(broken.games).toBe(control.games);
    expect(control.games).toBe(45 * GAMES_PER_MATCHUP);
  });

  it('passes the committed set at this volume, with nothing abstaining', () => {
    const abstained = control.gates.filter((gate) => gate.status === 'underSampled');
    expect(formatGates(abstained)).toBe('(none)');
    expect(formatGates(unwaivedFailures(COMMITTED_SUBJECT.waivers, control.gates))).toBe('(none)');
  });

  it('fails the boosted set on the win-rate band and the spread', () => {
    const failures = unwaivedFailures(brokenSubject.waivers, broken.gates);
    const ids = failures.map((gate) => gate.id);
    expect(ids, formatGates(broken.gates)).toContain('balance.spread');
    expect(ids.filter((id) => id.startsWith('balance.pair.')).length).toBeGreaterThanOrEqual(3);
  });

  it('reports how far outside the band the boosted set is', () => {
    const spread = broken.gates.find((gate) => gate.id === 'balance.spread');
    expect(spread?.status).toBe('fail');
    expect(spread?.observed ?? 0).toBeGreaterThan(broken.config.balance.maxWinRateSpread);
  });
});
