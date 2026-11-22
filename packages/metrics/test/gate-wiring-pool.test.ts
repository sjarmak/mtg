/**
 * The nested gate run stays poolless.
 *
 * `balance/gate-wiring.test.ts` proves the gate reads the set it was handed by
 * running it as a child process, which is the point of that file and is not the
 * thing to remove. What was worth removing is the child's own fork pool: one
 * file needs no pool, and vitest pre-sizes one from `maxWorkers` regardless, so
 * the child peaked at 9 direct child processes to run a single test file while
 * the gate inside it brought a sim worker pool as well (`mtg-434`).
 *
 * Asserted by reading the source rather than by running it, because the run it
 * guards costs 4,050 games and belongs to the balance project. A flag deleted
 * from that spawn is silent otherwise: the child still passes, and the only
 * evidence is a process count nobody samples.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./balance/gate-wiring.test.ts', import.meta.url), 'utf8');

describe('the nested gate run', () => {
  it('runs its one file in a single thread rather than starting a fork pool', () => {
    expect(SOURCE).toContain("'--pool=threads'");
    expect(SOURCE).toContain("'--poolOptions.threads.singleThread'");
  });

  it('still runs the gate as its own process, which is what it exists to prove', () => {
    expect(SOURCE).toContain('spawnSync(');
    expect(SOURCE).toContain("'--project',\n      'balance',");
  });
});
