/**
 * Multi-pod Draft calibration keeps the exact native-Draft children and uses
 * within-deck, within-opponent exposure contrasts. A strong deck carrying a
 * card is therefore not, by itself, evidence that the card is strong.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { SLICE_BOOSTER } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  DRAFT_CALIBRATION_CAMPAIGN_VERSION,
  DRAFT_COLLATION_VERSION,
  MAX_DRAFT_CAMPAIGN_PODS,
  MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR,
  aggregateDraftCalibrationCampaign,
  parseDraftCalibrationCampaignArgs,
  readDraftCalibrationCampaign,
  runDraftCalibration,
  runDraftCalibrationCampaign,
  stratifiedDraftAssociation,
  writeDraftCalibrationCampaignAtomic,
} from '@mtg/metrics';
import type {
  DraftCalibrationArtifact,
  DraftCalibrationCampaign,
  DraftAssociationSample,
} from '@mtg/metrics';

const SET_PATH = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

function loadSet(): readonly Card[] {
  const value: unknown = JSON.parse(readFileSync(SET_PATH, 'utf8'));
  const cards = (value as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) throw new Error('fixture has no cards');
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();
const COLLATION = { version: DRAFT_COLLATION_VERSION, recipe: SLICE_BOOSTER } as const;
const STRENGTH_FLOOR = {
  minimumContrastingStrata: 1,
  minimumDrawnGames: 1,
  minimumNotDrawnGames: 1,
} as const;
const CHILD_OPTIONS = {
  collation: COLLATION,
  workers: 1,
  gamesPerSeatOrder: 1,
  pairings: [[0, 1]] as const,
  cardFloor: 4,
};

let CHILDREN: readonly DraftCalibrationArtifact[];
let CAMPAIGN: DraftCalibrationCampaign;

beforeAll(async () => {
  CHILDREN = await Promise.all(
    [0, 1].map((pod) =>
      runDraftCalibration(SET, {
        ...CHILD_OPTIONS,
        seed: `campaign/test/pod/${String(pod)}`,
      }),
    ),
  );
  CAMPAIGN = aggregateDraftCalibrationCampaign(CHILDREN, {
    seed: 'campaign/test',
    strengthFloor: STRENGTH_FLOOR,
  });
}, 60_000);

describe('the multi-pod Draft calibration journey', { timeout: 120_000 }, () => {
  it('retains exact independently seeded children and all-card evidence', () => {
    expect(CAMPAIGN.version).toBe(DRAFT_CALIBRATION_CAMPAIGN_VERSION);
    expect(CAMPAIGN.scope).toEqual({
      format: 'Draft',
      automated: true,
      humanEvidence: false,
      sealedEvidence: false,
      claim: 'observationalAssociationNotCausalCardPower',
    });
    expect(CAMPAIGN.pods.map((pod) => pod.artifact.seed)).toEqual([
      'campaign/test/pod/0',
      'campaign/test/pod/1',
    ]);
    expect(CAMPAIGN.pods.map((pod) => pod.artifact)).toEqual(CHILDREN);
    expect(CAMPAIGN.study.setFingerprint).toBe(CAMPAIGN.set.fingerprint);
    expect(CAMPAIGN.study.collationFingerprint).toBe(CAMPAIGN.collationFingerprint);
    expect(new Set(CAMPAIGN.pods.map((pod) => pod.fingerprint)).size).toBe(2);
    expect(JSON.stringify(CAMPAIGN.pods[0]?.artifact.draft)).not.toBe(
      JSON.stringify(CAMPAIGN.pods[1]?.artifact.draft),
    );
    expect(CAMPAIGN.cards).toHaveLength(SET.length);
    expect(CAMPAIGN.cards.every((card) => card.strength.state !== undefined)).toBe(true);
    expect(CAMPAIGN.cards.every((card) => card.openedCopies === card.draftedCopies)).toBe(true);
    expect(
      CAMPAIGN.cards.every((card) => card.includedCopies + card.unusedCopies === card.draftedCopies),
    ).toBe(true);
    expect(
      CAMPAIGN.cards.every(
        (card) =>
          card.gamesDrawn + card.gamesNotDrawn === card.gamesIncluded &&
          card.gamesCast <= card.gamesDrawn &&
          card.gamesResolved <= card.gamesCast,
      ),
    ).toBe(true);
    expect(readDraftCalibrationCampaign(CAMPAIGN, 'fresh campaign')).toEqual(CAMPAIGN);
  });

  it('is byte-identical across child worker widths', async () => {
    const serial = await runDraftCalibrationCampaign(SET, {
      seed: 'campaign/width',
      collation: COLLATION,
      pods: 2,
      workers: 1,
      gamesPerSeatOrder: 1,
      pairings: [[0, 1]],
      childCardFloor: 4,
      strengthFloor: STRENGTH_FLOOR,
    });
    const parallel = await runDraftCalibrationCampaign(SET, {
      seed: 'campaign/width',
      collation: COLLATION,
      pods: 2,
      workers: 2,
      gamesPerSeatOrder: 1,
      pairings: [[0, 1]],
      childCardFloor: 4,
      strengthFloor: STRENGTH_FLOOR,
    });
    expect(JSON.stringify(parallel)).toBe(JSON.stringify(serial));
  });
});

describe('within-deck exposure estimation', () => {
  it('does not turn a winning deck inclusion rate into card strength', () => {
    const samples: readonly DraftAssociationSample[] = Array.from({ length: 20 }, (_unused, index) => ({
      stratum: 'pod/0/deck/7/opponent/2',
      trajectory: `trajectory/${String(index)}`,
      drawn: true,
      won: index < 18,
      symmetric: false,
    }));
    expect(stratifiedDraftAssociation(samples, STRENGTH_FLOOR)).toMatchObject({
      state: 'underSampled',
      reason: 'noContrastingStrata',
      estimate: null,
      interval95: null,
      contrastingDrawnGames: 0,
      contrastingNotDrawnGames: 0,
      decidedDrawnGames: 20,
      decidedNotDrawnGames: 0,
    });
  });

  it('persists the exact floor denominators separately from noncontrasting decided games', () => {
    const drawnOnly = Array.from({ length: 20 }, (_unused, index): DraftAssociationSample => ({
      stratum: 'drawn-only',
      trajectory: `drawn-only/${String(index)}`,
      drawn: true,
      won: index % 2 === 0,
      symmetric: false,
    }));
    const notDrawnOnly = Array.from({ length: 30 }, (_unused, index): DraftAssociationSample => ({
      stratum: 'not-drawn-only',
      trajectory: `not-drawn-only/${String(index)}`,
      drawn: false,
      won: index % 2 === 0,
      symmetric: false,
    }));
    const contrasting: readonly DraftAssociationSample[] = [
      { stratum: 'contrast', trajectory: 'contrast/drawn', drawn: true, won: true, symmetric: false },
      {
        stratum: 'contrast',
        trajectory: 'contrast/not-drawn',
        drawn: false,
        won: false,
        symmetric: false,
      },
    ];

    expect(
      stratifiedDraftAssociation([...drawnOnly, ...notDrawnOnly, ...contrasting], {
        minimumContrastingStrata: 1,
        minimumDrawnGames: 2,
        minimumNotDrawnGames: 1,
      }),
    ).toMatchObject({
      state: 'underSampled',
      reason: 'belowDrawnGameFloor',
      contrastingStrata: 1,
      contrastingDrawnGames: 1,
      contrastingNotDrawnGames: 1,
      decidedDrawnGames: 21,
      decidedNotDrawnGames: 31,
    });
  });

  it('estimates only from distinct, nonsymmetric games in contrasting strata', () => {
    const samples: readonly DraftAssociationSample[] = [
      { stratum: 'a', trajectory: 'a/1', drawn: true, won: true, symmetric: false },
      { stratum: 'a', trajectory: 'a/2', drawn: false, won: false, symmetric: false },
      { stratum: 'b', trajectory: 'b/1', drawn: true, won: true, symmetric: false },
      { stratum: 'b', trajectory: 'b/2', drawn: false, won: false, symmetric: false },
      { stratum: 'b', trajectory: 'b/2', drawn: false, won: false, symmetric: false },
      { stratum: 'c', trajectory: 'c/1', drawn: true, won: true, symmetric: true },
    ];
    expect(stratifiedDraftAssociation(samples, STRENGTH_FLOOR)).toMatchObject({
      state: 'estimated',
      reason: null,
      contrastingStrata: 2,
      contrastingDrawnGames: 2,
      contrastingNotDrawnGames: 2,
      decidedDrawnGames: 2,
      decidedNotDrawnGames: 2,
      duplicateTrajectoriesExcluded: 1,
      symmetricGamesExcluded: 1,
      estimate: 1 / 3,
    });
  });
});

describe('hostile campaign evidence', () => {
  function rejected(label: string, mutate: (copy: DraftCalibrationCampaign) => void): void {
    const copy = structuredClone(CAMPAIGN);
    mutate(copy);
    expect(() => readDraftCalibrationCampaign(copy, `${label}.json`)).toThrow(
      new RegExp(`${label}\\.json`, 'i'),
    );
  }

  it('rejects malformed, duplicate, stale, mixed, and truncated children', () => {
    rejected('duplicate-child', (copy) => {
      const first = copy.pods[0];
      const second = copy.pods[1];
      if (first === undefined || second === undefined) throw new Error('campaign needs two pods');
      second.artifact = structuredClone(first.artifact);
      second.fingerprint = first.fingerprint;
    });
    rejected('stale-child-seed', (copy) => {
      const pod = copy.pods[0];
      if (pod === undefined) throw new Error('campaign has no first pod');
      pod.artifact.seed = 'campaign/different/pod/0';
    });
    rejected('mixed-set', (copy) => {
      const identity = copy.pods[1]?.artifact.set.cardIdentities[0];
      if (identity === undefined) throw new Error('campaign child has no identities');
      identity.cardName = 'Different set identity';
    });
    rejected('mixed-collation', (copy) => {
      const slot = copy.pods[1]?.artifact.collation.recipe[0];
      if (slot === undefined) throw new Error('campaign child has no recipe');
      slot.count += 1;
    });
    rejected('truncated-child', (copy) => {
      const child = copy.pods[0]?.artifact;
      if (child === undefined) throw new Error('campaign has no first child');
      child.games.splice(0, 1);
    });
    rejected('stale-card', (copy) => {
      const card = copy.cards[0];
      if (card === undefined) throw new Error('campaign has no card rows');
      card.gamesDrawn += 1;
    });
    rejected('stale-strength-contrast', (copy) => {
      const card = copy.cards[0];
      if (card === undefined) throw new Error('campaign has no card rows');
      card.strength.contrastingDrawnGames += 1;
    });
    rejected('stale-summary', (copy) => {
      copy.summary.games += 1;
    });
    rejected('stale-pod-fingerprint', (copy) => {
      const pod = copy.pods[0];
      if (pod === undefined) throw new Error('campaign has no first pod');
      pod.fingerprint = '0'.repeat(64);
    });
    rejected('stale-collation-fingerprint', (copy) => {
      copy.collationFingerprint = '0'.repeat(64);
    });
  });

  it('bounds API and CLI inputs and refuses output aliases', async () => {
    expect(() =>
      aggregateDraftCalibrationCampaign(CHILDREN, {
        seed: 'campaign/test',
        strengthFloor: {
          ...STRENGTH_FLOOR,
          minimumDrawnGames: MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR + 1,
        },
      }),
    ).toThrow(/minimum drawn games.*at most/i);
    expect(() =>
      parseDraftCalibrationCampaignArgs([
        '--set',
        'set.json',
        '--collation',
        'collation.json',
        '--seed',
        'campaign',
        '--out',
        'campaign.json',
        '--pods',
        String(MAX_DRAFT_CAMPAIGN_PODS + 1),
      ]),
    ).toThrow(/pods.*at most/i);
    expect(() =>
      parseDraftCalibrationCampaignArgs([
        '--set',
        'set.json',
        '--collation',
        'collation.json',
        '--seed',
        'campaign',
        '--out',
        'campaign.json',
        '--pods',
        '1',
      ]),
    ).toThrow(/pods.*at least 2/i);
    await expect(
      runDraftCalibrationCampaign(SET, {
        seed: '',
        collation: COLLATION,
        pods: 2,
        workers: 1,
        pairings: [[0, 1]],
      }),
    ).rejects.toThrow(/campaign seed.*1-/i);
    expect(() =>
      parseDraftCalibrationCampaignArgs([
        '--set',
        './same.json',
        '--collation',
        'collation.json',
        '--seed',
        'campaign',
        '--out',
        'same.json',
      ]),
    ).toThrow(/--out.*must differ.*--set/i);
  });
});

describe('atomic campaign output', () => {
  it('writes a checked artifact through a same-directory temporary file', () => {
    const root = join(tmpdir(), `mtg-draft-campaign-${String(process.pid)}-${String(Date.now())}`);
    mkdirSync(root);
    try {
      const output = join(root, 'campaign.json');
      writeDraftCalibrationCampaignAtomic(output, CAMPAIGN);
      expect(readDraftCalibrationCampaign(JSON.parse(readFileSync(output, 'utf8')), output)).toEqual(
        CAMPAIGN,
      );
      expect(readdirSync(root)).toEqual(['campaign.json']);
      expect(existsSync(output)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
