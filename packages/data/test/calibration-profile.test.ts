import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_HARNESS_VERSION,
  CALIBRATION_PROFILE_VERSION,
  REFERENCE_PROFILE_PATH,
  REFERENCE_PROFILE_SHA256,
  buildCalibrationProfile,
  loadCalibrationProfile,
  loadReferenceProfileArtifact,
  verifyCalibrationProfile,
} from '../src/index';

function sha256(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('versioned calibration profile consumer boundary', () => {
  it('addresses the committed reference artifact and preserves evidence provenance', () => {
    const profile = loadCalibrationProfile();

    expect(profile).toMatchObject({
      schemaVersion: 1,
      profileVersion: CALIBRATION_PROFILE_VERSION,
      harnessVersion: CALIBRATION_HARNESS_VERSION,
      source: {
        artifactSha256: REFERENCE_PROFILE_SHA256,
        corpus: { provider: 'MTGJSON', version: '5.3.0+20260814', builtDate: '2026-08-14' },
      },
      evidence: {
        kind: 'static-proxy',
        claimsNativePlay: false,
        claimsHumanEvidence: false,
      },
      derivation: {
        builtDate: '2026-08-14',
        builtDateSemantics: 'source-snapshot-date',
        seedPolicy: { applicability: 'not-applicable', seeds: [] },
      },
      precedence: { default: 'M13', strategy: 'intersection-else-precedence' },
      contentAddress: { algorithm: 'sha256', digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(profile.source.sets).toEqual([
      {
        code: 'M11',
        sourceSha256: 'a089ef3dcc8d8c0830a07a3012c4d3343d86969721e22fe9232788091956e60f',
        population: 249,
      },
      {
        code: 'M13',
        sourceSha256: 'aec28319d5e501bc1f0572b8460b5a419fb9b2c18c37262b8f1b14eac8f9f7f3',
        population: 249,
      },
    ]);
    expect(profile.targets.length).toBeGreaterThan(10);
    expect(profile.targets.every((target) => target.provenance.anchors.length === 2)).toBe(true);
    expect(profile.targets.every((target) => target.population.length === 2)).toBe(true);
    expect(
      profile.targets.every((target) =>
        target.population.every((population) => population.count > 0 && population.description.length > 0),
      ),
    ).toBe(true);
    expect(profile.targets.every((target) => /static proxy/i.test(target.caveat))).toBe(true);
    expect(verifyCalibrationProfile(profile)).toStrictEqual(profile);
  });

  it('keeps recommendations, constraints, and native-play claims as separate facts', () => {
    const profile = loadCalibrationProfile();
    const recommendations = profile.targets.filter((target) => target.kind === 'recommendation');
    const constraints = profile.targets.filter((target) => target.kind === 'constraint');

    expect(new Set(recommendations.map((target) => target.axis))).toEqual(new Set(['curve', 'interaction']));
    expect(new Set(constraints.map((target) => target.axis))).toEqual(
      new Set(['complexity', 'weak-card', 'bomb-ceiling']),
    );
    expect(profile.evidence.caveat).toMatch(/not native-play|does not establish native/i);
  });

  it('fails clearly for missing, checksum-mismatched, stale, and incompatible artifacts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'calibration-profile-'));
    expect(() => loadCalibrationProfile({ path: join(directory, 'missing.json') })).toThrow(
      /calibration profile.*missing\.json/i,
    );

    const source = readFileSync(REFERENCE_PROFILE_PATH, 'utf8');
    const copyPath = join(directory, 'copy.json');
    writeFileSync(copyPath, `${source}\n`);
    expect(() => loadCalibrationProfile({ path: copyPath })).toThrow(/checksum.*expected.*received/i);

    expect(() => loadCalibrationProfile({ expectedCorpusVersion: '5.3.0+20990101' })).toThrow(
      /stale.*corpus version/i,
    );

    const incompatible = JSON.parse(source) as Record<string, unknown>;
    incompatible.profileVersion = 'reference-static-v999';
    const incompatibleText = JSON.stringify(incompatible);
    const incompatiblePath = join(directory, 'incompatible.json');
    writeFileSync(incompatiblePath, incompatibleText);
    expect(() =>
      loadCalibrationProfile({
        path: incompatiblePath,
        expectedArtifactSha256: sha256(incompatibleText),
      }),
    ).toThrow(/incompatible.*reference-static-v999/i);
  });

  it('detects a tampered consumer document by its own content address', () => {
    const original = loadCalibrationProfile();
    const tampered = {
      ...original,
      targets: original.targets.map((target) =>
        target.id === 'interaction-density' ? { ...target, target: { ...target.target, lower: 0 } } : target,
      ),
    };
    expect(() => verifyCalibrationProfile(tampered)).toThrow(/content checksum mismatch/i);
  });

  it('derives the same addressed profile from the checked reference artifact', () => {
    const reference = loadReferenceProfileArtifact();
    expect(buildCalibrationProfile(reference, REFERENCE_PROFILE_SHA256)).toStrictEqual(
      loadCalibrationProfile(),
    );
  });

  it('rejects a semantically incompatible target document while deriving it', () => {
    const reference = loadReferenceProfileArtifact();
    const interaction = reference.primaryCore.metrics.find((metric) => metric.id === 'interaction-density');
    if (interaction === undefined) throw new Error('interaction target absent');
    expect(() =>
      buildCalibrationProfile(
        {
          ...reference,
          primaryCore: {
            ...reference.primaryCore,
            metrics: [...reference.primaryCore.metrics, interaction],
          },
        },
        REFERENCE_PROFILE_SHA256,
      ),
    ).toThrow(/incompatible consumer document:[\s\S]*duplicate target id interaction-density/i);
  });
});
