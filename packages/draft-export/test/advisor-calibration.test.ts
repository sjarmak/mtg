import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { DEFAULT_ADVISOR_WEIGHTS } from '../src/advisor/weights';
import { readAdvisorCalibration } from '../src/advisor/calibration';

const sha = (value: string) => Promise.resolve(createHash('sha256').update(value).digest('hex'));
const identity = { catalogSha256: 'a'.repeat(64), modelSha256: 'b'.repeat(64) };
const body = {
  version: 'legacy-cube-advisor-calibration/v1',
  identity,
  weights: { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'trial/v1', synergy: 1.25 },
  provenance: {
    status: 'provisional',
    transitionSha256: 'c'.repeat(64),
    decisionSha256: 'd'.repeat(64),
    runtimeSha256: 'e'.repeat(64),
    independentHumanValidation: false,
    botValidated: false,
  },
};

it('reads checked portable weights without importing the offline review machinery', async () => {
  const input = { ...body, sha256: await sha(JSON.stringify(body)) };
  const result = await readAdvisorCalibration(input, identity, sha);
  expect(result.weights.synergy).toBe(1.25);
  expect(result.provenance.status).toBe('provisional');
  expect(Object.isFrozen(result.weights)).toBe(true);
});

it('rejects stale identities, modified coefficients, and invented validation claims', async () => {
  const input = { ...body, sha256: await sha(JSON.stringify(body)) };
  await expect(
    readAdvisorCalibration(input, { ...identity, catalogSha256: 'f'.repeat(64) }, sha),
  ).rejects.toThrow(/identity/);
  await expect(
    readAdvisorCalibration({ ...input, weights: DEFAULT_ADVISOR_WEIGHTS }, identity, sha),
  ).rejects.toThrow(/checksum/);
  const dishonest = { ...body, provenance: { ...body.provenance, botValidated: true } };
  await expect(
    readAdvisorCalibration({ ...dishonest, sha256: await sha(JSON.stringify(dishonest)) }, identity, sha),
  ).rejects.toThrow();
});
