import { describe, expect, it } from 'vitest';
import {
  REFERENCE_PROFILE_SHA256,
  buildCalibrationProfile,
  deriveCardSetProfile,
  loadCalibrationProfile,
  loadReferenceProfileArtifact,
} from '@mtg/data';
import { calibrationDecisions, evaluateSetCalibration } from '../src/index';

function retarget(id: string, lower: number, upper: number) {
  const artifact = structuredClone(loadReferenceProfileArtifact());
  if (!artifact.primaryCore.metrics.some((candidate) => candidate.id === id))
    throw new Error(`${id} target absent`);
  return buildCalibrationProfile(
    {
      ...artifact,
      primaryCore: {
        ...artifact.primaryCore,
        metrics: artifact.primaryCore.metrics.map((metric) =>
          metric.id === id ? { ...metric, target: { lower, upper } } : metric,
        ),
      },
    },
    REFERENCE_PROFILE_SHA256,
  );
}

type MutableDecisions = {
  profile: { digest: string };
  recommendations: Record<string, Record<string, { lower: number; upper: number }>>;
  constraints: Record<string, Record<string, { lower: number; upper: number }>>;
};

function decisionAxis(
  decisions: MutableDecisions,
  family: 'recommendations' | 'constraints',
  axis: string,
): Record<string, { lower: number; upper: number }> {
  const selected = decisions[family][axis];
  if (selected === undefined) throw new Error(`${family}.${axis} decision family absent`);
  return selected;
}

describe('set generation calibration decisions', () => {
  it('consumes generic targets without branching on a generated set code', () => {
    const profile = loadCalibrationProfile();
    const decisions = calibrationDecisions(profile);
    expect(decisions.profile).toEqual({
      profileVersion: profile.profileVersion,
      harnessVersion: profile.harnessVersion,
      digest: profile.contentAddress.digest,
    });
    expect(decisions.recommendations.curve['mean-mana-value']).toBeDefined();
    expect(decisions.recommendations.interaction['interaction-density']).toBeDefined();
    expect(decisions.constraints.complexity['mean-oracle-words']).toBeDefined();
    expect(decisions.constraints.weakCard['unplayable-risk-proxy']).toBeDefined();
    expect(decisions.constraints.bombCeiling['bomb-risk-proxy']).toBeDefined();
    expect(JSON.stringify(decisions)).not.toMatch(/XMP|M11|M13/);
  });

  it.each([
    ['mean-mana-value', 'recommendations', 'curve'],
    ['interaction-density', 'recommendations', 'interaction'],
    ['mean-oracle-words', 'constraints', 'complexity'],
    ['unplayable-risk-proxy', 'constraints', 'weakCard'],
    ['bomb-risk-proxy', 'constraints', 'bombCeiling'],
  ] as const)('changing %s changes only its intended %s.%s decision', (id, family, axis) => {
    const baseline = calibrationDecisions(loadCalibrationProfile());
    const changed = calibrationDecisions(retarget(id, 0.123, 0.456));
    const baselineCopy = structuredClone(baseline) as unknown as MutableDecisions;
    const changedCopy = structuredClone(changed) as unknown as MutableDecisions;
    expect(decisionAxis(changedCopy, family, axis)[id]).toEqual({ lower: 0.123, upper: 0.456 });
    expect(changedCopy.profile.digest).not.toBe(baselineCopy.profile.digest);
    changedCopy.profile.digest = baselineCopy.profile.digest;
    delete decisionAxis(baselineCopy, family, axis)[id];
    delete decisionAxis(changedCopy, family, axis)[id];
    expect(changedCopy).toStrictEqual(baselineCopy);
  });

  it('evaluates observations against constraints without turning proxies into play claims', () => {
    const subject = deriveCardSetProfile({
      code: 'ANY',
      name: 'Any executable set',
      cards: [
        {
          id: 'blank',
          name: 'Blank Relic',
          rarity: 'common',
          colors: [],
          types: ['Artifact'],
          keywords: [],
          manaValue: 5,
        },
      ],
      provenance: { kind: 'executable-dsl', source: 'unit fixture' },
    });
    const result = evaluateSetCalibration(subject, loadCalibrationProfile());

    expect(result.subject).toEqual({ code: 'ANY', name: 'Any executable set' });
    expect(result.metrics.find((metric) => metric.id === 'unplayable-risk-proxy')).toMatchObject({
      axis: 'weak-card',
      kind: 'constraint',
      status: 'above',
      population: [
        { source: 'M11', count: expect.any(Number), description: expect.any(String) },
        { source: 'M13', count: expect.any(Number), description: expect.any(String) },
      ],
      caveat: expect.stringMatching(/static proxy/i),
    });
    expect(result.profile.digest).toBe(loadCalibrationProfile().contentAddress.digest);
    expect(result.claimsNativePlay).toBe(false);
    expect(result.caveat).toMatch(/static proxy/i);
  });
});
