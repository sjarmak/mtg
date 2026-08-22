import { readFileSync } from 'node:fs';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import {
  REFERENCE_PROFILE_PATH,
  REFERENCE_SET_CODES,
  ReferenceProfileArtifactSchema,
  buildPrimaryCoreEnvelope,
  buildReferenceProfileArtifact,
  deriveCardSetProfile,
  loadReferenceCorpus,
  loadReferenceProfileArtifact,
  profileScalarDiff,
} from '../src/index';

const corpus = loadReferenceCorpus();
const artifact = buildReferenceProfileArtifact(corpus);

describe('reference static profiles', () => {
  it('derives every reference set deterministically and keeps its role visible', () => {
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.profileVersion).toBe('reference-static-v1');
    expect(artifact.profiles.map((profile) => profile.set.code)).toEqual(REFERENCE_SET_CODES);
    expect(artifact.profiles.map((profile) => profile.role)).toEqual([
      'primary-core',
      'primary-core',
      'secondary-core',
      'secondary-core',
      'secondary-core',
      'expansion',
      'expansion',
      'expansion',
      'expansion',
      'expansion',
      'expansion',
      'stress-only',
    ]);
    expect(buildReferenceProfileArtifact(corpus)).toStrictEqual(artifact);
  });

  it('records source and population provenance on every metric denominator', () => {
    for (const profile of artifact.profiles) {
      expect(profile.provenance).toMatchObject({
        provider: 'MTGJSON',
        sourceVersion: corpus.source.version,
        builtDate: corpus.source.builtDate,
        sourceUrl: expect.stringContaining(`${profile.set.code}.json`),
        sourceSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        oracleSemantics: 'current',
      });
      expect(profile.evidence.kind).toBe('static-proxy');
      expect(profile.evidence.claimsGameplay).toBe(false);
      expect(profile.evidence.claimsHumanEvidence).toBe(false);

      const populations = Object.values(profile.populations);
      expect(populations.every((population) => population.count >= 0)).toBe(true);
      expect(populations.every((population) => population.description.length > 20)).toBe(true);
      expect(profile.populations.mainCards.count).toBe(profile.set.mainSetSize);

      for (const rate of [
        profile.creatureRate,
        profile.removalDensity,
        profile.interactionDensity,
        profile.fixingDensity,
        profile.riskProxies.bombRisk,
        profile.riskProxies.unplayableRisk,
      ]) {
        expect(rate.numerator).toBeGreaterThanOrEqual(0);
        expect(rate.numerator).toBeLessThanOrEqual(rate.denominator.count);
        expect(rate.denominator.description.length).toBeGreaterThan(20);
        expect(rate.share).toBe(rate.denominator.count === 0 ? 0 : rate.numerator / rate.denominator.count);
      }

      expect(Object.values(profile.raritySkeleton.counts).reduce((sum, count) => sum + count, 0)).toBe(
        profile.raritySkeleton.denominator.count,
      );
      expect(Object.values(profile.colorSkeleton.counts).reduce((sum, count) => sum + count, 0)).toBe(
        profile.colorSkeleton.denominator.count,
      );
      expect(Object.values(profile.manaCurve.counts).reduce((sum, count) => sum + count, 0)).toBe(
        profile.manaCurve.denominator.count,
      );
      expect(profile.mechanicAsFan.status).toBe('available');
      if (profile.mechanicAsFan.status !== 'available')
        throw new Error(`${profile.set.code} lacks collation`);
      expect(profile.mechanicAsFan.denominator.expectedCardsPerBooster).toBeGreaterThan(0);
      expect(profile.mechanicAsFan.mechanics.every((metric) => metric.expectedCardsPerBooster >= 0)).toBe(
        true,
      );
      expect(profile.archetypeSupport.pairs).toHaveLength(10);
    }
  });

  it('uses collector positions rather than double-faced card faces as the census population', () => {
    const innistrad = artifact.profiles.find((profile) => profile.set.code === 'ISD');
    expect(innistrad?.set.cardFaceRecords).toBe(284);
    expect(innistrad?.populations.mainCards.count).toBe(264);
    expect(innistrad?.provenance.populationRule).toMatch(/back faces/i);
  });

  it('keeps mechanic exposure on the weighted booster denominator', () => {
    const m11 = artifact.profiles.find((profile) => profile.set.code === 'M11');
    if (m11 === undefined || m11.mechanicAsFan.status !== 'available')
      throw new Error('M11 collation absent');
    expect(m11.mechanicAsFan.denominator).toMatchObject({
      kind: 'expected-draft-booster-cards',
      expectedCardsPerBooster: 15,
      boosterVariants: 2,
    });
    expect(m11.mechanicAsFan.methodology).toMatch(/sheet weight/i);
  });

  it('builds the primary envelope from M11 and M13 only', () => {
    expect(artifact.primaryCore.anchorCodes).toEqual(['M11', 'M13']);
    expect(artifact.primaryCore.precedence).toBe('M13');
    expect(artifact.primaryCore.excluded).toEqual({
      secondaryCore: ['M15', 'M20', 'ORI'],
      expansions: ['ISD', 'RTR', 'RAV', 'ROE', 'SOM', 'KTK'],
      stressOnly: ['MH2'],
    });
    expect(artifact.primaryCore.metrics.length).toBeGreaterThan(15);
    for (const metric of artifact.primaryCore.metrics) {
      expect(metric.anchors.map((anchor) => anchor.setCode)).toEqual(['M11', 'M13']);
      expect(metric.resolution === 'intersection' || metric.resolution === 'precedence').toBe(true);
      expect(metric.rationale.length).toBeGreaterThan(30);
      if (metric.resolution === 'intersection') {
        expect(metric.target.lower).toBeGreaterThanOrEqual(metric.anchors[0]?.band.lower ?? -Infinity);
        expect(metric.target.lower).toBeGreaterThanOrEqual(metric.anchors[1]?.band.lower ?? -Infinity);
        expect(metric.target.upper).toBeLessThanOrEqual(metric.anchors[0]?.band.upper ?? Infinity);
        expect(metric.target.upper).toBeLessThanOrEqual(metric.anchors[1]?.band.upper ?? Infinity);
      } else {
        expect(metric.selectedSet).toBe('M13');
        expect(metric.target).toEqual(metric.anchors[1]?.band);
      }
    }
  });

  it('makes precedence reversible data and retains both anchors on conflicts', () => {
    const m11 = artifact.profiles.find((profile) => profile.set.code === 'M11');
    const m13 = artifact.profiles.find((profile) => profile.set.code === 'M13');
    if (m11 === undefined || m13 === undefined) throw new Error('primary profiles absent');
    const narrow = { shareHalfWidth: 0, meanRelativeHalfWidth: 0, meanMinimumHalfWidth: 0 };
    const m13First = buildPrimaryCoreEnvelope(m11, m13, { precedence: 'M13', tolerance: narrow });
    const m11First = buildPrimaryCoreEnvelope(m11, m13, { precedence: 'M11', tolerance: narrow });
    const conflict = m13First.metrics.find((metric) => metric.resolution === 'precedence');
    expect(conflict).toBeDefined();
    const inverse = m11First.metrics.find((metric) => metric.id === conflict?.id);
    expect(conflict?.anchors).toHaveLength(2);
    expect(conflict?.selectedSet).toBe('M13');
    expect(inverse?.selectedSet).toBe('M11');
    expect(inverse?.target).toEqual(inverse?.anchors[0]?.band);
  });

  it('loads a checked, committed profile artifact equal to a fresh derivation', async () => {
    expect(loadReferenceProfileArtifact()).toStrictEqual(artifact);
    expect(readFileSync(REFERENCE_PROFILE_PATH, 'utf8')).toBe(
      await format(JSON.stringify(artifact), { parser: 'json', printWidth: 110 }),
    );
  });

  it('rejects corruption inside a nested metric rather than only checking the document header', () => {
    const corrupt = JSON.parse(JSON.stringify(artifact)) as {
      profiles: { creatureRate: { denominator: { count: number } } }[];
    };
    const first = corrupt.profiles[0];
    if (first === undefined) throw new Error('profile artifact unexpectedly empty');
    first.creatureRate.denominator.count = -1;
    expect(ReferenceProfileArtifactSchema.safeParse(corrupt).success).toBe(false);
  });
});

describe('executable-set comparison seam', () => {
  const subject = deriveCardSetProfile({
    code: 'TST',
    name: 'Executable test set',
    cards: [
      {
        id: 'one-drop',
        name: 'One Drop',
        rarity: 'common',
        colors: ['W'],
        types: ['Creature'],
        keywords: ['Flying'],
        text: 'Flying',
        manaValue: 1,
        power: 1,
        toughness: 1,
      },
      {
        id: 'answer',
        name: 'Answer',
        rarity: 'uncommon',
        colors: ['B'],
        types: ['Instant'],
        keywords: [],
        text: 'Destroy target creature.',
        manaValue: 2,
      },
    ],
    provenance: { kind: 'executable-dsl', source: 'test fixture' },
  });

  it('diffs a static executable profile against every labeled reference and the target envelope', () => {
    const diff = profileScalarDiff(subject, artifact);
    expect(diff.subject).toEqual({ code: 'TST', name: 'Executable test set' });
    expect(diff.references.map((entry) => entry.targetCode)).toEqual(REFERENCE_SET_CODES);
    expect(diff.references.every((entry) => entry.metrics.length > 15)).toBe(true);
    expect(diff.primaryCore.metrics.length).toBe(artifact.primaryCore.metrics.length);
    expect(
      diff.primaryCore.metrics.every((metric) => ['below', 'inside', 'above'].includes(metric.status)),
    ).toBe(true);
    expect(diff.caveat).toMatch(/static proxies/i);
    expect(diff.caveat).toMatch(/not gameplay|does not establish gameplay/i);
  });

  it('marks booster-only mechanics unavailable instead of inventing a collation denominator', () => {
    expect(subject.mechanicAsFan.status).toBe('unavailable');
    if (subject.mechanicAsFan.status !== 'unavailable') throw new Error('subject unexpectedly has collation');
    expect(subject.mechanicAsFan.reason).toMatch(/booster/i);
  });

  it('warns on a cheap blank noncreature without calling a vanilla creature unplayable', () => {
    const warningProfile = deriveCardSetProfile({
      code: 'TST',
      name: 'Weak-card proxy regression',
      cards: [
        {
          id: 'blank-bauble',
          name: 'Blank Bauble',
          rarity: 'common',
          colors: [],
          types: ['Artifact'],
          keywords: [],
          text: '',
          manaValue: 1,
        },
        {
          id: 'vanilla-bear',
          name: 'Vanilla Bear',
          rarity: 'common',
          colors: ['G'],
          types: ['Creature'],
          keywords: [],
          text: '',
          manaValue: 2,
          power: 2,
          toughness: 2,
        },
      ],
      provenance: { kind: 'executable-dsl', source: 'regression fixture' },
    });

    expect(warningProfile.riskProxies.unplayableRisk).toMatchObject({
      numerator: 1,
      denominator: { count: 2 },
      share: 0.5,
    });
    expect(warningProfile.riskProxies.unplayableRisk.methodology).toMatch(/no rules text/i);
    expect(warningProfile.evidence.claimsGameplay).toBe(false);
  });
});
