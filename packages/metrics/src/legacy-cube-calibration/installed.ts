/** Fresh local competence evidence and real matches; no imported certification assertions. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  botProbeCoverage,
  botProbeVariants,
  createInstalledForgeBotRunner,
  renderDeck,
} from '@mtg/forge-export';
import type { BotRunInput, InstalledBotResult } from '@mtg/forge-export';
import type { GameplayFactory } from './io';
import { writeCalibrationJson } from './io';
import { competenceForDeck } from './competence';
import type { BotCompetenceEvidence } from './competence';
import type { CalibrationDeck } from './deck';

const PROBE_SEEDS = [42, 43] as const;
const SUPPORTED_PROBES = [
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
  'twin-combo',
  'kiki-combo',
  'sacrifice-loop',
  'mana-ramp',
  'artifact-engine',
] as const;
type Runner = ReturnType<typeof createInstalledForgeBotRunner>;

function gameSeed(seed: string): number {
  if (!/^[a-f0-9]{64}$/u.test(seed)) throw new Error('Expected SHA-256 game seed');
  // Java Random consumes 48 bits. Keep precisely those bits in the recorded seed.
  return Number.parseInt(seed.slice(0, 12), 16);
}

async function writeDeck(directory: string, deck: CalibrationDeck) {
  const text = renderDeck({
    name: 'Legacy Cube calibration',
    entries: deck.ref.cards.map((c) => ({ cardName: c.name, count: c.count })),
  });
  const path = join(directory, `${createHash('sha256').update(text).digest('hex')}.dck`);
  await writeFile(path, text, { flag: 'wx' });
  return path;
}

async function probe(
  runner: Runner,
  interaction: string,
  deck: string,
  directory: string,
  timeoutMs: number,
): Promise<BotCompetenceEvidence> {
  const results: InstalledBotResult[] = [];
  const supported = SUPPORTED_PROBES.find((id) => id === interaction);
  const variants = supported === undefined ? [] : botProbeVariants(interaction);
  if (supported !== undefined) {
    for (const probeVariant of variants) {
      for (const seed of PROBE_SEEDS) {
        process.stdout.write(`Bot competence: ${interaction}/${probeVariant}, seed ${String(seed)}\n`);
        results.push(
          await runner.run({
            deckA: deck,
            deckB: deck,
            seed,
            interaction: supported,
            probeVariant,
            timeoutMs,
          }),
        );
      }
    }
  }
  const passed =
    variants.length > 0 &&
    results.length === PROBE_SEEDS.length * variants.length &&
    results.every(
      (r) =>
        r.status === 'completed' &&
        r.botFingerprint === runner.botFingerprint &&
        r.report?.challenges[0]?.status === 'passed',
    );
  const artifact = join(directory, `${interaction}.json`);
  const coverage = botProbeCoverage(interaction);
  const status = passed
    ? 'passed'
    : results.some((r) => r.report?.challenges[0]?.status === 'failed')
      ? 'failed'
      : 'unproven';
  await writeCalibrationJson(artifact, {
    interaction,
    coverage,
    status,
    bot: runner.botFingerprint,
    seeds: supported ? PROBE_SEEDS : [],
    variants,
    results,
    limitation: supported
      ? 'Only the initialized situations tested here are covered.'
      : 'No autonomous probe implemented for this package.',
  });
  return {
    interaction,
    coverage,
    bot: runner.botFingerprint,
    status,
    artifact,
    seeds: supported ? PROBE_SEEDS.map(String) : [],
  };
}

/** Optional factory is a test seam, never exposed as a CLI option or evidence-file import. */
export async function createInstalledGameplay(
  options: Parameters<GameplayFactory>[0],
  plan: Parameters<GameplayFactory>[1],
  createRunner: typeof createInstalledForgeBotRunner = createInstalledForgeBotRunner,
): ReturnType<GameplayFactory> {
  const runner = createRunner(options.forgeHome === undefined ? {} : { forgeHome: options.forgeHome });
  try {
    const deckDirectory = join(options.out, 'decks');
    const probeDirectory = join(options.out, 'competence');
    const gameDirectory = join(options.out, 'games');
    await Promise.all([deckDirectory, probeDirectory, gameDirectory].map((dir) => mkdir(dir)));
    const decks = [...new Set(plan.games.flatMap((g) => [...g.decks]))];
    // Content-identical decks share a file even when separate policies produced them.
    const paths = new Map<CalibrationDeck, string>();
    const byCards = new Map<string, string>();
    for (const deck of decks) {
      const key = JSON.stringify(deck.ref.cards);
      const path = byCards.get(key) ?? (await writeDeck(deckDirectory, deck));
      byCards.set(key, path);
      paths.set(deck, path);
    }
    const seedMap = new Map<number, string>();
    for (const game of plan.games) {
      const seed = gameSeed(game.seed);
      if (seedMap.has(seed) && seedMap.get(seed) !== game.seed) throw new Error('Forge seed collision');
      seedMap.set(seed, game.seed);
    }
    const required = [
      ...new Set([
        ...SUPPORTED_PROBES,
        ...decks.flatMap((d) => competenceForDeck(d.selected, [], runner.botFingerprint).required),
      ]),
    ];
    const firstDeck = paths.get(decks[0]!);
    if (!firstDeck) throw new Error('No calibration decks');
    const evidence: BotCompetenceEvidence[] = [];
    for (const interaction of required)
      evidence.push(await probe(runner, interaction, firstDeck, probeDirectory, options.timeoutMs));
    return {
      bot: runner.botFingerprint,
      evidence,
      dispose: async () => {
        runner.dispose();
      },
      play: async (game) => {
        const deckA = paths.get(game.decks[0]);
        const deckB = paths.get(game.decks[1]);
        if (!deckA || !deckB) throw new Error('Game deck not in campaign');
        const input: BotRunInput = { deckA, deckB, seed: gameSeed(game.seed), timeoutMs: options.timeoutMs };
        process.stdout.write(`Bot match: ${game.id}\n`);
        const result = await runner.run(input);
        const artifact = join(gameDirectory, `${createHash('sha256').update(game.id).digest('hex')}.json`);
        await writeCalibrationJson(artifact, { id: game.id, seed: game.seed, input, result });
        const winner = result.report?.games[0]?.winner;
        return {
          status: result.status,
          winner: winner === 'Alpha' ? 0 : winner === 'Beta' ? 1 : null,
          artifact,
        };
      },
    };
  } catch (error) {
    runner.dispose();
    throw error;
  }
}
