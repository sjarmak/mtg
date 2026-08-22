/**
 * The control for bead mtg-bc2.35, as a runnable command:
 *
 *     npx tsx packages/sim/test/support/control-run.ts [gamesPerMatchup]
 *
 * It plays the balance gate's exact schedule under several named bot profiles
 * and prints the three waived gates for each. The point is falsification: if a
 * deliberately more aggressive policy barely moves the long tail, the long tail
 * is a property of the card pool and no amount of bot tuning will fix it.
 *
 * Profiles are built only from knobs that already exist in `GreedyBotConfig`,
 * so the control measures policy settings rather than new code.
 */
import { greedyConfig, withSimPool } from '@mtg/sim';
import type { GreedyBotConfig } from '@mtg/sim';
import { closureStats, formatClosure, sweep, sweepOutcomes } from './closure-sweep';

interface Profile {
  readonly name: string;
  readonly config: GreedyBotConfig;
}

const PROFILES: readonly Profile[] = [
  { name: 'default        ', config: greedyConfig() },
  {
    // Every aggression knob at once: the upper bound on what tuning can buy.
    name: 'all-out        ',
    config: greedyConfig({
      attack: { acceptableTradeLoss: 6, unblockedDamageValue: 3, defensiveThreatRatio: 100 },
      block: { minimumBlockValue: 4, chumpWhenLethal: false },
      target: { faceDamageWeight: 3 },
    }),
  },
  {
    // Attack side only: swing with everything that is not a strict loss.
    name: 'attack-loose   ',
    config: greedyConfig({ attack: { acceptableTradeLoss: 6, unblockedDamageValue: 3 } }),
  },
  {
    // Race guard off: never hold creatures back as blockers.
    name: 'no-holdback    ',
    config: greedyConfig({ attack: { defensiveThreatRatio: 100 } }),
  },
  {
    // Block side only: refuse everything but the most profitable blocks.
    name: 'block-reluctant',
    config: greedyConfig({ block: { minimumBlockValue: 4 } }),
  },
  {
    // Burn goes to the face rather than at creatures.
    name: 'face-burn      ',
    config: greedyConfig({ target: { faceDamageWeight: 3, killBonus: 0 } }),
  },
];

async function main(): Promise<void> {
  const argument = process.argv[2];
  const games = argument === undefined ? undefined : Number(argument);
  if (games !== undefined && (!Number.isInteger(games) || games <= 0)) {
    throw new Error(`gamesPerMatchup must be a positive integer, got ${String(argument)}`);
  }
  await withSimPool({}, async (pool) => {
    for (const profile of PROFILES) {
      const options = games === undefined ? { pool } : { pool, gamesPerMatchup: games };
      const run = await sweep(profile.config, options);
      const stats = closureStats(sweepOutcomes(run));
      process.stdout.write(
        `${formatClosure(profile.name, stats)} (${(run.elapsedMillis / 1000).toFixed(1)}s)\n`,
      );
    }
  });
}

await main();
