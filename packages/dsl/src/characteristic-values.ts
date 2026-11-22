/** Typed characteristic-defining power/toughness expressions (CR 604.3). */
import { z } from 'zod';

export const CharacteristicPowerToughnessSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('creaturesYouControl') }),
  z.strictObject({ kind: z.literal('controllerLifeTotal') }),
  z.strictObject({ kind: z.literal('controlledSubtype'), subtype: z.string().min(1) }),
]);

export type CharacteristicPowerToughness = z.infer<typeof CharacteristicPowerToughnessSchema>;
