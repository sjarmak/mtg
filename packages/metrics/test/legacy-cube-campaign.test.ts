import { describe, expect, it } from 'vitest';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import {
  planLegacyCubeCampaign,
  executeLegacyCubeCampaign,
  parseLegacyCubeCalibrationArgs,
} from '../src/legacy-cube-calibration/campaign';

const catalog = parsePrintedCardCatalog(catalogJson);
const options = {
  seed: 'campaign-smoke',
  split: 'tuning' as const,
  pods: 1,
  gamesPerOrder: 1,
  opponents: 1,
  policies: ['power', 'current'] as const,
};

describe('offline Legacy Cube campaign', () => {
  it('requires explicit output and split; rejects accidental unbounded work', () => {
    expect(() => parseLegacyCubeCalibrationArgs([])).toThrow();
    expect(() =>
      parseLegacyCubeCalibrationArgs(['--out', 'x', '--seed', 's', '--split', 'holdout', '--pods', '100000']),
    ).toThrow();
    expect(
      parseLegacyCubeCalibrationArgs(['--out', 'x', '--seed', 's', '--split', 'holdout', '--plan-only']),
    ).toMatchObject({ out: 'x', seed: 's', split: 'holdout', planOnly: true });
  });

  it('pins content, metadata, builder and fixed opponent identities', () => {
    const plan = planLegacyCubeCampaign(catalog, options);
    expect(plan.games).toHaveLength(4);
    expect(plan.provenance.catalog).toBe(catalog.contentSha256);
    expect(plan.provenance.model).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.games[0]!.decks[1]).toEqual(plan.games[2]!.decks[1]);
    expect(plan.games[0]!.seed).toBe(plan.games[2]!.seed);
    expect(planLegacyCubeCampaign(catalog, options)).toEqual(plan);
  });

  it('freezes distinct opponent strategies with content hashes', () => {
    const plan = planLegacyCubeCampaign(catalog, {
      ...options,
      opponents: 2,
      opponentPolicies: ['power', 'pin:aggro'],
    });
    expect(plan.pods[0]!.opponents.map((opponent) => opponent.policy)).toEqual(['power', 'pin:aggro']);
    expect(plan.pods[0]!.opponents.map((opponent) => opponent.artifactSha256)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(new Set(plan.pods[0]!.opponents.map((opponent) => opponent.artifactSha256)).size).toBe(2);
    expect(plan.games).toHaveLength(8);
  });

  it('parses and rejects malformed frozen opponent strategy lists', () => {
    expect(
      parseLegacyCubeCalibrationArgs([
        '--out',
        'x',
        '--seed',
        's',
        '--split',
        'tuning',
        '--opponents',
        '2',
        '--opponent-policies',
        'power,pin:aggro',
      ]),
    ).toMatchObject({ opponentPolicies: ['power', 'pin:aggro'] });
    expect(() =>
      parseLegacyCubeCalibrationArgs([
        '--out',
        'x',
        '--seed',
        's',
        '--split',
        'tuning',
        '--opponents',
        '2',
        '--opponent-policies',
        'power,power',
      ]),
    ).toThrow(/opponent/i);
  });

  it('rejects modified card contents even when a caller preserves the claimed catalog hash', () => {
    const modified = {
      ...catalog,
      cards: catalog.cards.map((c, i) => (i === 0 ? { ...c, manaValue: 100 } : c)),
    };
    expect(() => planLegacyCubeCampaign(modified, options)).toThrow(/hash/);
  });

  it('uses only complete matched cohorts and records draws, losses and wins by candidate seat', async () => {
    const plan = planLegacyCubeCampaign(catalog, options);
    const evidence = ['fundamentals', ...LEGACY_CUBE_ADVISOR_MODEL.packages.map((p) => p.id)].map(
      (interaction) => ({
        interaction,
        bot: 'fixture',
        status: 'passed' as const,
        artifact: 'trusted-fixture',
        seeds: ['a', 'b'],
        coverage: catalog.cards.map((c) => c.correctedName),
      }),
    );
    const result = await executeLegacyCubeCampaign(plan, {
      bot: 'fixture',
      evidence,
      play: async (game) => ({
        status: 'completed',
        winner: game.policy === 'power' ? game.candidateSeat : null,
        artifact: game.id,
      }),
    });
    expect(result.games.every((g) => g.eligible)).toBe(true);
    expect(result.summary.find((s) => s.policy === 'power')!.wins).toBe(2);
    expect(result.summary.find((s) => s.policy === 'current')!.draws).toBe(2);
    const incomplete = await executeLegacyCubeCampaign(plan, {
      bot: 'fixture',
      evidence,
      play: async (game) =>
        game.policy === 'current' && game.candidateSeat === 0
          ? { status: 'incomplete', winner: null, artifact: game.id }
          : { status: 'completed', winner: game.candidateSeat === 0 ? 1 : 0, artifact: game.id },
    });
    expect(incomplete.games.filter((g) => g.eligible)).toHaveLength(2);
    expect(incomplete.summary.every((s) => s.losses === 1)).toBe(true);
    expect(incomplete.summary.find((s) => s.policy === 'current')!.incomplete).toBe(1);
    await expect(
      executeLegacyCubeCampaign(plan, {
        bot: 'fixture',
        evidence,
        play: async () => ({ status: 'completed', winner: null, artifact: '' }),
      }),
    ).rejects.toThrow(/Malformed/);
  });

  it('executes bots through a narrow seam and retains raw failures without counting losses', async () => {
    const plan = planLegacyCubeCampaign(catalog, options);
    const calls: string[] = [];
    const result = await executeLegacyCubeCampaign(plan, {
      bot: 'fixture-bot',
      evidence: [],
      play: async (game) => {
        calls.push(game.id);
        return { status: 'incomplete' as const, winner: null, artifact: `${game.id}.json` };
      },
    });
    expect(calls).toHaveLength(4);
    expect(result.games.every((g) => !g.eligible && g.outcome === 'incomplete')).toBe(true);
    expect(result.summary.every((s) => s.winRate === null)).toBe(true);
    expect(result.games[0]!.missingCompetence.length).toBeGreaterThan(0);
  });

  it('propagates runner errors instead of inventing a result', async () => {
    const plan = planLegacyCubeCampaign(catalog, options);
    await expect(
      executeLegacyCubeCampaign(plan, {
        bot: 'fixture',
        evidence: [],
        play: async () => {
          throw new Error('Bridge disconnected');
        },
      }),
    ).rejects.toThrow('Bridge disconnected');
  });

  it('rejects missing or duplicated scheduled games before calling the bot', async () => {
    const plan = planLegacyCubeCampaign(catalog, options);
    const bot = {
      bot: 'fixture',
      evidence: [],
      play: async () => {
        throw new Error('Must not run');
      },
    };
    await expect(executeLegacyCubeCampaign({ ...plan, games: plan.games.slice(1) }, bot)).rejects.toThrow(
      /schedule/,
    );
    await expect(
      executeLegacyCubeCampaign({ ...plan, games: [plan.games[0]!, ...plan.games.slice(0, -1)] }, bot),
    ).rejects.toThrow(/schedule/);
  });
});
