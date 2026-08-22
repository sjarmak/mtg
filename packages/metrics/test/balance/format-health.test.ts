/**
 * `npm run test:balance` — the format-health gate.
 *
 * One seeded mass simulation per subject, then one assertion per health
 * question. The separation matters when this is red: a failure names the
 * subject and the band it broke and prints the numbers, so the next step is a
 * design decision about that card pool rather than an argument about the
 * harness.
 *
 * Which sets are measured, and which of them block CI, is `subjects.ts`. The
 * suite below is written once and instantiated per subject, so a set added to
 * the list is judged by exactly the assertions the committed one is judged by;
 * there is no second, laxer path for a new set.
 *
 * Three rules this suite holds itself to:
 *
 *  - **Bands do not move to make the run green.** Every bound is sourced in
 *    `src/config.ts`, and every subject is judged against the same bounds.
 *    A red gate on v0 content is a measurement.
 *  - **Under-sampled is not pass, and neither is inside-the-noise.** Two tests
 *    below fail the run if any gate declined to answer, one per reason, and
 *    they are separate because they are separate instructions to whoever reads
 *    the failure. `underSampled` says this run did not buy enough games, and
 *    the instruction is to buy them: raise `MTG_BALANCE_GAMES`. `withinNoise`
 *    says it bought them and the miss still came out smaller than the seed
 *    deviation at that volume (`src/gates.ts`, `abstainWithinNoise`), so the
 *    band could not be decided either way — and the instruction is the opposite
 *    one, because that status is the single verdict in the set that **cannot**
 *    be answered with games. `scaledSeedDeviation` raises the noise floor for a
 *    thin run and never lowers it for a fat one, so a subject whose true rate
 *    sits on a bound abstains at every volume that exists. Blocking on any
 *    abstention at all therefore asserts something the harness cannot know: that
 *    10,035 games resolves every bound for every pool. It resolves the bounds
 *    this volume was chosen for — a pair's deviation is 0.020 and a spread's is
 *    0.020 — but whether a given pool's rate is far enough from its band to be
 *    decided at that resolution is a fact about the pool, and a content edit can
 *    change it without touching a line of this suite. So an undecidable gate
 *    still blocks, and it stops blocking the same way a red one does: a per
 *    subject entry in `baseline.ts` carrying the measured value, a bead and the
 *    reason. Declared-undecidable is a claim somebody signed; silent is not.
 *  - **A waiver belongs to one set.** Known-red gates are waived per subject in
 *    `baseline.ts`; a set arriving through `MTG_BALANCE_SET` waives nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { FormatHealth, GateResult } from '@mtg/metrics';
import { abilityPool, formatGates, formatHealth, report, verifyJoinCompatibility } from '@mtg/metrics';
import { COLOR_PAIRS, decksFor, gamesPerMatchup, runRoundRobin } from './round-robin';
import type { RoundRobinRun } from './round-robin';
import { DRIFT_TOLERANCE, spreadDrift, unwaivedAbstentions, unwaivedFailures, waiverFor } from './baseline';
import type { BalanceSet } from './set';
import { loadSet } from './set';
import type { BalanceSubject } from './subjects';
import { balanceSubjects } from './subjects';

for (const subject of balanceSubjects()) describeSubject(subject);

function describeSubject(subject: BalanceSubject): void {
  describe(`${subject.id} (${subject.origin})`, () => {
    let run: RoundRobinRun;
    let health: FormatHealth;
    let set: BalanceSet;

    beforeAll(async () => {
      set = loadSet(subject.setPath);
      run = await runRoundRobin(decksFor(set.pool, set.label));
      health = formatHealth(run.logs, {
        // The one input the logs cannot supply, and the reason the usage gate
        // can exist at all: how much of this subject's pool is activatable.
        pool: abilityPool(set.pool),
        label:
          `${COLOR_PAIRS.length} color pairs, ${run.matchups} matchups x ${run.gamesPerMatchup} games, ` +
          `greedy v0 bots on ${set.label}, decks built by @mtg/deckbuild`,
        includeMatchups: true,
      });
      // The report is the artifact of a balance run; printing it is the point.
      process.stdout.write(`\n${subject.id}: ${set.path}\n${report(health)}\n`);
      process.stdout.write(
        `run: ${run.logs.length} games in ${(run.elapsedMillis / 1000).toFixed(1)}s ` +
          `(${run.gamesPerSecond.toFixed(0)} games/s)\n\n`,
      );
    });

    function gatesMatching(predicate: (gate: GateResult) => boolean): readonly GateResult[] {
      return health.gates.filter(predicate);
    }

    /**
     * Fails on any red gate that is not in this subject's known-red baseline.
     * Waived gates are policed separately by the `known-red baseline` suite
     * below, which is what keeps this from being a way to make failures
     * disappear.
     */
    function expectNoUnwaivedFailures(gates: readonly GateResult[]): void {
      expect(gates.length).toBeGreaterThan(0);
      expect(formatGates(unwaivedFailures(subject.waivers, gates)), formatGates(gates)).toBe('(none)');
    }

    describe('balance run', () => {
      it('measured the set this subject names', () => {
        // The subject is the input; the whole value of MTG_BALANCE_SET is that
        // a set named there is the set that gets played. A gate that loads some
        // other path is green and measuring nothing anybody asked for, and it
        // reports under this subject's name while doing it. With one declared
        // subject the two paths are the same string, so this line is only ever
        // load-bearing for a second subject; gate-wiring.test.ts is the same
        // check from outside, where it bites in a default run too.
        expect(set.path).toBe(subject.setPath);
      });

      it('played the full round robin', () => {
        const expected = (COLOR_PAIRS.length * (COLOR_PAIRS.length - 1)) / 2;
        expect(run.matchups).toBe(expected);
        expect(run.logs.length).toBe(expected * gamesPerMatchup());
      });

      it('bought real evidence rather than replaying the same game', () => {
        // Seeded bots are deterministic; if the shuffles were not doing any work
        // the distinct-trajectory count would collapse and every interval below
        // would be a lie (metrics report §10.7).
        expect(health.duplicateShare).toBeLessThan(0.02);
        expect(health.distinctGames).toBeGreaterThanOrEqual(health.games * 0.98);
      });

      it('cleared every sample floor, so no gate had to abstain', () => {
        const abstained = gatesMatching((gate) => gate.status === 'underSampled');
        expect(
          formatGates(abstained),
          'these gates did not buy enough games to be judged; raise MTG_BALANCE_GAMES',
        ).toBe('(none)');
      });

      it('judged every band it has not declared undecidable at this volume', () => {
        // A gate here is not under-sampled — it cleared its floor and produced
        // a number — but the number missed its band by less than the statistic
        // moves on the seed alone at 10,035 games, so this run cannot say which
        // side of the band the set is on. That is a real finding about the
        // pinned sweep and not a reason to look away from it: either the pool's
        // rate has moved onto its bound, or the bound is set inside the noise
        // floor of the measurement. Both are decisions and both belong to a
        // person, which is why the escape is the same declaration a red gate
        // takes — `baseline.ts`, measured value, bead, reason — and not a
        // status the report is allowed to shrug at. Buying games is not an
        // escape from this one, and the suite header says why.
        const abstained = gatesMatching((gate) => gate.status === 'withinNoise');
        expect(formatGates(unwaivedAbstentions(subject.waivers, abstained)), formatGates(abstained)).toBe(
          '(none)',
        );
      });

      it('has no failing gate anywhere in the report that the baseline does not name', () => {
        // The per-metric tests below each filter to one prefix, which is what makes
        // a failure message say which band broke. This one takes the whole gate
        // list, so a gate id that matches none of those prefixes — a newly added
        // metric, say — cannot fail unnoticed.
        expectNoUnwaivedFailures(health.gates);
      });

      it('emits logs that still satisfy the 17lands join contract', () => {
        const first = run.logs[0];
        expect(first).toBeDefined();
        if (first === undefined) return;
        const compatibility = verifyJoinCompatibility(first);
        expect(compatibility.missing).toEqual([]);
        expect(compatibility.unexpected).toEqual([]);
      });
    });

    describe('game shape', () => {
      it('lands the game-length distribution inside the limited window', () => {
        expectNoUnwaivedFailures(gatesMatching((gate) => gate.id.startsWith('length.')));
      });

      it('keeps the on-the-play advantage inside the human band', () => {
        expectNoUnwaivedFailures(gatesMatching((gate) => gate.id === 'onPlay.winRate'));
      });
    });

    describe('mana development', () => {
      it('tracks the Karsten hypergeometric priors', () => {
        expectNoUnwaivedFailures(gatesMatching((gate) => gate.id.startsWith('mana.')));
      });
    });

    describe('decisiveness', () => {
      it('resolves games without stalling against the turn cap', () => {
        expectNoUnwaivedFailures(gatesMatching((gate) => gate.id.startsWith('decisiveness.')));
      });
    });

    describe('balance', () => {
      it('keeps every color pair inside the 40-70% win-rate band', () => {
        expectNoUnwaivedFailures(gatesMatching((gate) => gate.id.startsWith('balance.pair.')));
      });

      it('keeps the spread between the best and worst pair inside the band', () => {
        expectNoUnwaivedFailures(gatesMatching((gate) => gate.id === 'balance.spread'));
      });

      it('finds no dominant strategy', () => {
        expectNoUnwaivedFailures(gatesMatching((gate) => gate.id === 'balance.noDominantStrategy'));
      });

      // The band above is 30% wide, so it passes this subject at 0.117 and at
      // 0.179 alike and says nothing about the two being different trees. This
      // is the check that notices. It is not a second, tighter band — a band is
      // a design bound and lives in `src/config.ts`; this asserts that the
      // reading recorded beside the subject still describes what the harness
      // measures, which is the claim `round-robin.ts` used to make in prose and
      // was wrong about by 50% inside two days with every gate green.
      it('still reads the spread its baseline was recorded against', () => {
        const recorded = subject.spread;
        if (recorded === null) {
          // Only an env subject may skip this, and asserting that here is what
          // stops the escape hatch from widening: a declared subject that lost
          // its reading would otherwise silently opt out of the check.
          expect(subject.origin).toBe('env');
          return;
        }
        const [spread] = gatesMatching((gate) => gate.id === 'balance.spread');
        expect(spread, 'balance.spread is missing from the report').toBeDefined();
        if (spread === undefined) return;
        expect(spreadDrift(recorded, spread)).toBeNull();
      });
    });

    describe('ability usage', () => {
      it('measures the pool it played, so the floor cannot go missing by omission', () => {
        // The gate is emitted only when `formatHealth` is handed a pool
        // (`src/gates.ts`), which makes dropping that one option a silent way
        // to delete the gate. This is the line that makes it loud.
        const usage = gatesMatching((gate) => gate.id === 'abilities.usage');
        expect(formatGates(usage)).not.toBe('(none)');
        expect(usage.length).toBe(1);
      });

      it('fires enough of the pool for the bands above to mean anything', () => {
        // `docs/design/dsl-v1-ability-model.md` §9 risk 3. Red here does not
        // mean a band moved; it means this whole report is about a format
        // whose mechanic never ran, and the bot tier is the thing to fix.
        expectNoUnwaivedFailures(gatesMatching((gate) => gate.id.startsWith('abilities.')));
      });
    });

    describe('known-red baseline', () => {
      it('still fails every waived gate, so no waiver has gone stale', () => {
        // `pass` and not "anything that is not a fail", which is what makes
        // this read correctly against the fifth status: a waived gate that came
        // back `withinNoise` has not started passing, it has stopped being
        // decidable, and deleting its waiver on that basis would drop a
        // known-red gate on the strength of a sample. Now that an entry covers
        // an abstention too, that case is the flagship's actual state rather
        // than a hypothetical, and it is the reason this filter must stay
        // exact: `!== 'fail'` here would delete the one waiver in the file on
        // every run. What still ends a waiver is the gate going green, and the
        // drift test below is what catches it going further red — a waiver is
        // not a license for the number to keep moving.
        const stale = subject.waivers.filter((waiver) => {
          const gate = health.gates.find((candidate) => candidate.id === waiver.gate);
          return gate !== undefined && gate.status === 'pass';
        });
        expect(
          stale.map((waiver) => `${waiver.gate} now passes; delete its waiver (${waiver.bead})`),
          'a waiver that no longer describes reality hides the next regression',
        ).toEqual([]);
      });

      it('names a gate that actually exists for every waiver', () => {
        const unknown = subject.waivers.filter(
          (waiver) => !health.gates.some((gate) => gate.id === waiver.gate),
        );
        expect(unknown.map((waiver) => waiver.gate)).toEqual([]);
      });

      it('holds every waived gate within the drift tolerance of its recorded value', () => {
        const drifted: string[] = [];
        for (const gate of health.gates) {
          const waiver = waiverFor(subject.waivers, gate.id);
          if (waiver === undefined) continue;
          if (gate.observed === null) {
            drifted.push(`${gate.id}: under-sampled, so the baseline cannot be checked`);
            continue;
          }
          if (Math.abs(gate.observed - waiver.measured) > DRIFT_TOLERANCE) {
            drifted.push(`${gate.id}: ${gate.observed.toFixed(3)} vs recorded ${waiver.measured.toFixed(3)}`);
          }
        }
        expect(drifted, 'content or bots moved materially; re-measure the baseline').toEqual([]);
      });
    });
  });
}
