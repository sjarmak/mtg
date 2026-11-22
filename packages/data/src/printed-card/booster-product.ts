/** Translate publisher UUID weights to exact catalog identities, including auxiliary sets. */
import type { PrintedBoosterProduct } from '@mtg/printed-card';
import { DraftBoosterSchema } from '../reference/schemas';

export interface PrintedProductSource {
  readonly code: string;
  readonly uuidToPhysicalId: ReadonlyMap<string, string>;
}

export function buildPrintedBoosterProduct(
  id: string,
  setCode: string,
  input: unknown,
  sources: readonly PrintedProductSource[],
): PrintedBoosterProduct {
  const booster = DraftBoosterSchema.parse(input);
  if (!booster.sourceSetCodes.includes(setCode)) throw new Error(`missing primary source: ${setCode}`);
  if (booster.boosters.reduce((sum, config) => sum + config.weight, 0) !== booster.boostersTotalWeight) {
    throw new Error(`booster total mismatch: ${id}`);
  }
  const identities = new Map<string, string>();
  for (const code of booster.sourceSetCodes) {
    const matches = sources.filter((source) => source.code === code);
    if (matches.length !== 1) throw new Error(`missing source or duplicate source: ${code}`);
    for (const [uuid, physical] of matches[0]!.uuidToPhysicalId) {
      if (identities.has(uuid)) throw new Error(`ambiguous UUID: ${uuid}`);
      identities.set(uuid, physical);
    }
  }
  const sheets = Object.entries(booster.sheets).map(([name, sheet]) => {
    if (Object.values(sheet.cards).reduce((sum, weight) => sum + weight, 0) !== sheet.totalWeight) {
      throw new Error(`sheet total mismatch: ${id}/${name}`);
    }
    const weights = new Map<string, number>();
    for (const [uuid, weight] of Object.entries(sheet.cards)) {
      const physical = identities.get(uuid);
      if (physical === undefined) throw new Error(`unresolved UUID: ${id}/${name}/${uuid}`);
      weights.set(physical, (weights.get(physical) ?? 0) + weight);
    }
    return {
      name,
      weights: Object.fromEntries(weights),
      foil: sheet.foil,
      ...(sheet.balanceColors === undefined ? {} : { balanceColors: sheet.balanceColors }),
    };
  });
  return {
    id,
    setCode,
    sourceSetCodes: booster.sourceSetCodes,
    collation: { sheets, boosters: booster.boosters },
  };
}
