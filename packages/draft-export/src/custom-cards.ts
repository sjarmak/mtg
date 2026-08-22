/**
 * One DSL card -> one `[CustomCards]` entry.
 *
 * The fields are exactly those `docs/research/prior-art-tooling.md` §1.1 names:
 * `name`, `type` and `mana_cost` are required, and of the optional ones we fill
 * `oracle_text`, `power`/`toughness`, `rarity`, `subtypes`, `colors` and
 * `rating`. Nothing else is emitted. `image`/`image_uris` would need a URL the
 * generated set does not have until the art pipeline has run, `back`, `layout`
 * and `related_cards` describe card shapes the DSL cannot express, and
 * `draft_effects` are conspiracy-style abilities the kernel could not play.
 *
 * Every value is derived: the type line, the subtypes and the oracle text all
 * come from `@mtg/dsl`'s renderer, so a card reads the same here as it does on
 * the rendered face and in the Forge export.
 *
 * The subtypes are derived *twice* — once inside the rendered `type` line and
 * again in `subtypes` — because §1.1 lists the two as separate fields and does
 * not say whether Draftmancer composes its type line from both. If it does,
 * every creature imports as "Creature — Bird Soldier — Bird Soldier". The
 * non-duplicating alternative is one field access away (`typeLineParts` already
 * returns supertypes, types and subtypes apart), so this is a guess and not a
 * constraint: ADR-0003 §3 tables it for the first real import to settle.
 */
import type { Card, Color, Rarity } from '@mtg/dsl';
import {
  formatManaCost,
  isCastable,
  isCreature,
  renderOracleText,
  renderTypeLine,
  sortColors,
  typeLineParts,
} from '@mtg/dsl';
import type { CardRating } from './rating';

/**
 * A Draftmancer custom card. The snake-case field names are the format's, not
 * this repo's, and the key order is the emitted order — the file is compared
 * byte-for-byte against a golden fixture, so it has to be fixed somewhere.
 */
export interface DraftmancerCustomCard {
  readonly name: string;
  readonly mana_cost: string;
  readonly type: string;
  readonly subtypes?: readonly string[];
  readonly rarity: Rarity;
  readonly colors: readonly Color[];
  readonly power?: number;
  readonly toughness?: number;
  readonly oracle_text?: string;
  readonly rating: number;
}

/**
 * Scryfall symbology, e.g. `{2}{G}{G}`. A land gets the empty string Scryfall
 * gives it rather than `{0}`: a land has no mana cost, and `{0}` would say it
 * costs nothing to cast, which is a different card.
 */
function draftmancerManaCost(card: Card): string {
  return isCastable(card) ? formatManaCost(card.manaCost) : '';
}

/** Builds the entry for one already-rated card. */
export function toCustomCard(rated: CardRating): DraftmancerCustomCard {
  const { card } = rated;
  const subtypes = typeLineParts(card).subtypes;
  const oracleText = renderOracleText(card);
  return {
    name: card.name,
    mana_cost: draftmancerManaCost(card),
    type: renderTypeLine(card),
    ...(subtypes.length > 0 ? { subtypes } : {}),
    rarity: card.rarity,
    // WUBRG, whatever order the card declared: the file is byte-compared, so
    // every field it carries has to be canonical and not merely correct.
    colors: sortColors(card.colors),
    ...(isCreature(card) ? { power: card.power, toughness: card.toughness } : {}),
    ...(oracleText.length > 0 ? { oracle_text: oracleText } : {}),
    rating: rated.rating,
  };
}

/** Builds the whole `[CustomCards]` array, in the order it was rated. */
export function toCustomCards(ratings: readonly CardRating[]): readonly DraftmancerCustomCard[] {
  return ratings.map(toCustomCard);
}
