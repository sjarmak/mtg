import { describe, expect, it } from 'vitest';
import {
  parseBotBenchmarkReport,
  validateBotRun,
  botCommandArgs,
  parseRequestedBotReport,
  BOT_REPORT_PREFIX,
} from '../src/bot-benchmark-protocol';
import { botProbeCoverage, botProbeVariants } from '../src/bot-probe-coverage';

const report = {
  protocolVersion: 2,
  forgeVersion: 'installed-forge',
  botFingerprint: 'Default/hybrid-simulation',
  seed: 42,
  games: [{ index: 0, winner: 'Alpha', turns: 12, outcome: 'AllOpponentsLost', log: ['combat'] }],
  challenges: [],
};

describe('installed Forge bot protocol', () => {
  it('rejects missing, duplicated, wrong-seed, wrong-mode, and failed game reports', () => {
    const run = validateBotRun({ deckA: 'a', deckB: 'b', seed: 42 });
    const line = BOT_REPORT_PREFIX + JSON.stringify(report);
    expect(parseRequestedBotReport(line, run)).toEqual(report);
    for (const text of ['', `${line}\n${line}`, BOT_REPORT_PREFIX + '{invalid']) {
      expect(() => parseRequestedBotReport(text, run)).toThrow();
    }
    for (const altered of [
      { ...report, seed: 43 },
      { ...report, botFingerprint: 'Default/full-simulation' },
      { ...report, games: [] },
      { ...report, games: [{ ...report.games[0], outcome: 'ERROR: rules failure' }] },
      { ...report, games: [{ ...report.games[0], outcome: 'no outcome' }] },
    ])
      expect(() => parseRequestedBotReport(BOT_REPORT_PREFIX + JSON.stringify(altered), run)).toThrow();
    const probe = {
      ...report,
      games: [],
      challenges: [
        { id: 'reanimate', variant: 'default', status: 'unproven', evidence: [], scriptedChoices: false },
      ],
    };
    expect(
      parseRequestedBotReport(BOT_REPORT_PREFIX + JSON.stringify(probe), {
        ...run,
        interaction: 'reanimate',
      }),
    ).toEqual(probe);
    expect(() =>
      parseRequestedBotReport(BOT_REPORT_PREFIX + JSON.stringify(probe), {
        ...run,
        interaction: 'blink-etb',
      }),
    ).toThrow();
    expect(() =>
      parseRequestedBotReport(BOT_REPORT_PREFIX + JSON.stringify(probe), {
        ...run,
        interaction: 'reanimate',
        probeVariant: 'alternate',
      }),
    ).toThrow();
    expect(() => parseRequestedBotReport(BOT_REPORT_PREFIX + JSON.stringify(probe), run)).toThrow();
  });
  it('validates actual results, finite coordinates, and bounded invocations', () => {
    expect(parseBotBenchmarkReport(JSON.stringify(report))).toEqual(report);
    expect(() =>
      parseBotBenchmarkReport(
        JSON.stringify({ ...report, games: [{ ...report.games[0], winner: 'invented' }] }),
      ),
    ).toThrow();
    expect(() => validateBotRun({ deckA: 'a', deckB: 'b', seed: NaN })).toThrow();
    expect(() => validateBotRun({ deckA: 'a', deckB: 'b', seed: -1 })).toThrow();
    expect(() => validateBotRun({ deckA: 'a', deckB: 'b', seed: 1, timeoutMs: 0 })).toThrow();
    expect(() => validateBotRun({ deckA: 'a', deckB: 'b', seed: 42, probeVariant: 'default' })).toThrow();
    expect(
      validateBotRun({
        deckA: 'a',
        deckB: 'b',
        seed: 42,
        interaction: 'cheat-threat',
        probeVariant: 'show-and-tell',
      }),
    ).toMatchObject({ interaction: 'cheat-threat', probeVariant: 'show-and-tell' });
  });

  it('reports every card actually exercised across package variants', () => {
    expect(botProbeVariants('cheat-threat')).toEqual(['show-and-tell', 'sneak-attack']);
    expect(botProbeVariants('spells-density')).toEqual(['young-pyromancer', 'monastery-mentor']);
    expect(botProbeVariants('graveyard-value')).toEqual(['uro-escape', 'bloodghast-landfall']);
    expect(botProbeVariants('tokens-wide')).toEqual(['honor-souls', 'spear-procession']);
    expect(botProbeVariants('opposition-tokens')).toEqual(['opposition-bitterblossom', 'glare-ophiomancer']);
    expect(botProbeVariants('equipment')).toEqual(['wargear-elf', 'fire-ice-wall']);
    expect(botProbeVariants('creature-toolbox')).toEqual(['primal-command', 'birthing-pod']);
    expect(botProbeVariants('land-recursion')).toEqual(['wasteland-replay', 'fetchland-replay']);
    expect(botProbeVariants('upheaval-mana')).toEqual(['monolith-rebuild', 'powerstone-rebuild']);
    expect(botProbeVariants('reanimate')).toEqual(['default']);
    expect(botProbeCoverage('cheat-threat')).toEqual([
      'Show and Tell',
      'Emrakul, the Aeons Torn',
      'Sneak Attack',
      'Griselbrand',
    ]);
    expect(botProbeCoverage('spells-density')).toEqual(['Ponder', 'Young Pyromancer', 'Monastery Mentor']);
    expect(botProbeCoverage('graveyard-value')).toEqual([
      "Uro, Titan of Nature's Wrath",
      'Swamp',
      'Bloodghast',
    ]);
    expect(botProbeCoverage('tokens-wide')).toEqual([
      'Lingering Souls',
      'Honor of the Pure',
      'Spectral Procession',
      'Spear of Heliod',
    ]);
    expect(botProbeCoverage('opposition-tokens')).toEqual([
      'Opposition',
      'Bitterblossom',
      'Glare of Subdual',
      'Ophiomancer',
    ]);
    expect(botProbeCoverage('equipment')).toEqual([
      'Grafted Wargear',
      'Llanowar Elves',
      'Sword of Fire and Ice',
      'Wall of Omens',
    ]);
    expect(botProbeCoverage('creature-toolbox')).toEqual([
      'Primal Command',
      'Craterhoof Behemoth',
      'Birthing Pod',
      'Wall of Blossoms',
      'Llanowar Elves',
    ]);
    expect(botProbeCoverage('land-recursion')).toEqual([
      'Crucible of Worlds',
      'Wasteland',
      "Gaea's Cradle",
      'Flooded Strand',
      'Island',
    ]);
    expect(botProbeCoverage('upheaval-mana')).toEqual([
      'Upheaval',
      'Grim Monolith',
      'Coalition Relic',
      'Basalt Monolith',
      'Worn Powerstone',
      'Chromatic Lantern',
      'Coldsteel Heart',
    ]);
  });

  it('refuses to confuse scripted choices with autonomous competence', () => {
    const challenge = {
      id: 'reanimate',
      variant: 'default',
      status: 'passed',
      evidence: ['zone transition'],
      scriptedChoices: false,
    };
    expect(
      parseBotBenchmarkReport(JSON.stringify({ ...report, challenges: [challenge] })).challenges[0]!
        .scriptedChoices,
    ).toBe(false);
    expect(() =>
      parseBotBenchmarkReport(
        JSON.stringify({ ...report, challenges: [{ ...challenge, scriptedChoices: true }] }),
      ),
    ).toThrow();
    expect(() =>
      parseBotBenchmarkReport(JSON.stringify({ ...report, challenges: [{ ...challenge, evidence: [] }] })),
    ).toThrow();
  });

  it('passes deck paths as arguments, never shell source, and pins the AI mode', () => {
    const args = botCommandArgs(
      '/jar',
      '/classes',
      validateBotRun({ deckA: '/tmp/a space;name', deckB: '/tmp/b', seed: 42 }),
    );
    expect(args).toContain('/tmp/a space;name');
    expect(args.slice(-4)).toEqual(['42', '1', '5000', 'hybrid']);
    expect(
      botCommandArgs(
        '/jar',
        '/classes',
        validateBotRun({ deckA: 'a', deckB: 'b', seed: 42, interaction: 'reanimate' }),
      ).at(-1),
    ).toBe('probe-reanimate:default');
    expect(
      botCommandArgs(
        '/jar',
        '/classes',
        validateBotRun({
          deckA: 'a',
          deckB: 'b',
          seed: 42,
          interaction: 'cheat-threat',
          probeVariant: 'show-and-tell',
        }),
      ).at(-1),
    ).toBe('probe-cheat-threat:show-and-tell');
  });
});
