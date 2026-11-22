/** Deterministic coordinate search, not a card-quality judgment or adoption decision. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseAdvisorWeights } from '@mtg/draft-export';
import type { AdvisorWeights } from '@mtg/draft-export';

const FIELDS = [
  'quality',
  'pathSupport',
  'missingPieces',
  'synergy',
  'structure',
  'manaRisk',
  'dependencyRisk',
  'commitment',
  'flexibility',
  'fixing',
] as const satisfies readonly (keyof AdvisorWeights)[];
const searchStep = z.number().finite().positive().max(1);

/** Baseline first gives an explicit conservative tie-break; no coefficient is silently clamped. */
export function proposeCalibrationWeights(input: unknown, step = 0.25): readonly AdvisorWeights[] {
  const baseline = parseAdvisorWeights(input);
  const delta = searchStep.parse(step);
  return [
    baseline,
    ...FIELDS.flatMap((field) =>
      [-delta, delta].flatMap((change) => {
        const value = baseline[field] + change;
        if (value < 0 || value > 4 || value === baseline[field]) return [];
        const coefficients = { ...baseline, [field]: value };
        const digest = createHash('sha256').update(JSON.stringify(coefficients)).digest('hex');
        return [parseAdvisorWeights({ ...coefficients, revision: `proposal/v1/${digest}` })];
      }),
    ),
  ];
}
