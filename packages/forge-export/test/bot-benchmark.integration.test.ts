import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInstalledForgeBotRunner } from '../src/bot-benchmark';
import { botProbeVariants } from '../src/bot-probe-coverage';
import { renderDeck } from '../src/deck';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BOTS'] === '1' ? it : it.skip;

const interactions = [
  'fundamentals',
  'reanimate',
  'cheat-threat',
  'spells-density',
  'graveyard-value',
  'tokens-wide',
  'opposition-tokens',
  'equipment',
  'creature-toolbox',
  'land-recursion',
  'upheaval-mana',
  'blink-etb',
  'natural-order',
  'green-suns-zenith',
  'twin-combo',
  'kiki-combo',
  'sacrifice-loop',
  'mana-ramp',
  'artifact-engine',
] as const;

describe.sequential('installed Forge bot competence probes', () => {
  let root: string;
  let deck: string;
  let runner: ReturnType<typeof createInstalledForgeBotRunner>;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mtg-forge-bot-integration-'));
    deck = join(root, 'basic.dck');
    await writeFile(
      deck,
      renderDeck({ name: 'Probe bootstrap', entries: [{ cardName: 'Swamp', count: 40 }] }),
    );
    runner = createInstalledForgeBotRunner();
  });

  afterAll(async () => {
    runner?.dispose();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  for (const interaction of interactions) {
    for (const probeVariant of botProbeVariants(interaction)) {
      for (const seed of [42, 43]) {
        forgeIt(
          `autonomously executes ${interaction}/${probeVariant} at seed ${String(seed)}`,
          async () => {
            const result = await runner.run({
              deckA: deck,
              deckB: deck,
              seed,
              interaction,
              probeVariant,
            });
            expect(result.status, result.error ?? result.stderr).toBe('completed');
            const challenge = result.report?.challenges[0];
            expect(challenge?.status, JSON.stringify(challenge)).toBe('passed');
            expect(challenge?.variant).toBe(probeVariant);
            expect(challenge?.scriptedChoices).toBe(false);
            expect(challenge?.evidence).toContain(
              'Exact initial hands, libraries, battlefields, graveyards and life verified',
            );
            expect(
              challenge?.evidence.some((line) => line.startsWith('Verified autonomous objective:')),
            ).toBe(true);
          },
          30000,
        );
      }
    }
  }
});
