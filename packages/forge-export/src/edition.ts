/**
 * Custom-edition file.
 *
 * Format taken from the docs shipped inside the Forge distribution
 * (`docs/Creating-a-custom-Set.md`) and cross-checked against
 * `res/editions/*.txt`:
 *
 *   [metadata]      Code / Name / Date / Type=Custom
 *   [cards]         `<collectorNumber> <rarityCode> <Card Name>`
 *   [CreatureTypes] optional custom creature types, `Singular:Plural`
 *
 * `Type=Custom` is load-bearing: it is what tells Forge to skip image
 * downloads and treat the edition as user content.
 */
import type { Card } from '@mtg/dsl';
import { FORGE_BASIC_LAND_RARITY_CODE, FORGE_RARITY_CODES } from './vocabulary-map';

export interface ForgeEditionOptions {
  /** Human-readable set name shown in Forge's UI. */
  readonly name: string;
  /** Release date, `YYYY-MM-DD`. */
  readonly date: string;
  /** Edition type; `Custom` unless you deliberately want stock-set behavior. */
  readonly type?: string;
  /**
   * Booster recipe, e.g. `10 Common, 3 Uncommon, 1 RareMythic, 1 BasicLand`.
   * Omitted by default — whether Forge honors it for `Type=Custom` editions
   * is the question spike B answers.
   */
  readonly booster?: string;
  /** Custom creature types to register, as `Singular:Plural` pairs. */
  readonly creatureTypes?: ReadonlyArray<readonly [string, string]>;
}

/** Edition rarity code: Basic lands are `L`; nonbasic lands retain their printed rarity. */
export function forgeRarityCode(card: Card): string {
  if (card.kind === 'land' && card.basicLandType !== undefined) return FORGE_BASIC_LAND_RARITY_CODE;
  const code = FORGE_RARITY_CODES[card.rarity];
  if (code === undefined) {
    throw new Error(`no Forge rarity code for rarity "${card.rarity}"`);
  }
  return code;
}

/** Renders the full edition file for a card list, in collector-number order. */
export function renderEdition(setCode: string, cards: readonly Card[], options: ForgeEditionOptions): string {
  const lines = [
    '[metadata]',
    `Code=${setCode}`,
    `Name=${options.name}`,
    `Date=${options.date}`,
    `Type=${options.type ?? 'Custom'}`,
  ];
  if (options.booster !== undefined) lines.push(`Booster=${options.booster}`);
  lines.push('', '[cards]');

  const ordered = [...cards].sort((a, b) => a.set.collectorNumber - b.set.collectorNumber);
  for (const card of ordered) {
    lines.push(`${card.set.collectorNumber} ${forgeRarityCode(card)} ${card.name}`);
  }

  if (options.creatureTypes !== undefined && options.creatureTypes.length > 0) {
    lines.push('', '[CreatureTypes]');
    for (const [singular, plural] of options.creatureTypes) lines.push(`${singular}:${plural}`);
  }
  return `${lines.join('\n')}\n`;
}
