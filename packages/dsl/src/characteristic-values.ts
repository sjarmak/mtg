/** Typed characteristic-defining power/toughness expressions (CR 604.3). */
import { z } from 'zod';

export const CharacteristicPowerToughnessSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('creaturesYouControl') }),
  z.strictObject({ kind: z.literal('controllerLifeTotal') }),
]);

export type CharacteristicPowerToughness = z.infer<typeof CharacteristicPowerToughnessSchema>;
