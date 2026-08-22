/**
 * Forge's spelling of a quantity read off the battlefield.
 *
 * `countMatching` is the DSL's "the number of Monsters you control", and
 * unlike `exiledThisResolution` it needs no protocol across the chain: Forge
 * reads a board count straight out of an SVar, `SVar:Y:Count$Valid
 * Creature.Monster+YouCtrl`, and any numeral slot in any link can name it.
 * `Count$Valid` appears in 2,580 of Forge 2.0.14's 33,587 shipped scripts and
 * the restriction grammar is the one `FORGE_STATIC_AFFECTED` and
 * `conditionParams` already write: `Creature.YouCtrl` 411 times,
 * `Permanent.YouCtrl` 66, and a bare creature type in the same position —
 * `Elf.YouCtrl` 16, `Zombie.YouCtrl` 7, `Goblin.YouCtrl` 6 — which is why
 * `conditionParams` writing `<subtype>.YouCtrl` was right to.
 *
 * ## Why `Y` and not `X`
 *
 * `X` is the resolution count's name (`remember.ts`) and a card may print both
 * — an exile-and-count chain that also draws for its board is one card, not
 * two. `Y` is what Forge's own corpus reaches for when an `X` is already taken,
 * 1,058 scripts of it, so the two protocols can never collide by name and
 * neither has to know the other exists.
 *
 * ## What is spellable, and what is refused
 *
 * `CountFilter` ORs within a list and ANDs across the two (`matchesFilter`'s
 * `anyOf`), so `{cardTypes: ['creature','artifact']}` means creature *or*
 * artifact. Forge spells an OR as a comma-separated list of whole specs, which
 * is a shape this transpiler does not write and which nothing has asked it to:
 * every `countMatching` in the tree names at most one card type and at most one
 * subtype. So one of each is spelled and anything wider is refused by name.
 * A refusal costs a card; a guess costs a card that transpiles clean and counts
 * a different number in Forge than it counts in the kernel, which is the one
 * failure this transpiler exists to prevent.
 *
 * A card type that is not a permanent is refused for the same reason and a
 * blunter one: the count is of the battlefield, and an instant is never on it.
 * The kernel would count zero and so would Forge, so the two agree — but a card
 * that always counts zero is a design mistake, not a translation, and this is
 * where it is cheapest to see.
 *
 * ## `countWithCounter` is refused, and not for lack of grammar
 *
 * Forge can spell a counter narrowing: `Count$Valid Creature.YouCtrl+counters_GE1_P1P1`
 * is a shape its corpus writes. What it cannot spell is *which* counter, and
 * that is the whole of this refusal. A part counter in this DSL is a
 * declaration, not a token — `horn` is +1/+1 *and* first strike
 * (`COUNTER_DECLARATIONS`) — so `FORGE_COUNTER_TYPES` decomposes it into two of
 * Forge's counter types, and neither of them is "horn". A count written
 * `counters_GE1_P1P1` would count every creature carrying any +1/+1 counter,
 * which on a board where +1/+1 counters are minted 53 cards' worth is not the
 * printed card's number even slightly.
 *
 * That is `forgeTargetRestriction`'s own precedent, made once already for
 * `withCounter`: a decomposition of more than one type is refused rather than
 * approximated, because a transpile that counts a different number is worse
 * than no transpile. The refusal names the shape (`effect-script.ts`'s
 * `UNMAPPED_COMPUTED_AMOUNT`), so a card carrying one leaves the export with a
 * reason attached rather than a silent zero.
 */
import type { CardKind, CountFilter, Effect, PermanentTally, PumpAmount, RatePer } from '@mtg/dsl';
import { isLiteralAmount, isRateAmount } from '@mtg/dsl';
import type { ComputedAmounts } from './remember';

/** The SVar this transpiler binds a board count to. */
export const BOARD_COUNT_SVAR = 'Y';

/**
 * Forge's type token for each DSL card kind that can be on a battlefield.
 *
 * The four non-permanent kinds are absent rather than mapped to something: a
 * lookup that misses is the refusal, and a table with `instant: 'Instant'` in
 * it would spell a count of instants on the battlefield, which is always zero.
 */
const FORGE_PERMANENT_TYPES: Partial<Readonly<Record<CardKind, string>>> = {
  creature: 'Creature',
  artifact: 'Artifact',
  enchantment: 'Enchantment',
  land: 'Land',
  planeswalker: 'Planeswalker',
};

/**
 * The `Valid` spec for one filter, or `null` when this transpiler will not
 * write it.
 *
 * The type token is the card type when the filter names one and the subtype
 * when it does not, because Forge's grammar takes a creature type in the same
 * position a card type sits in — `conditionParams` already writes
 * `<subtype>.YouCtrl` for exactly that reason. A filter that names neither
 * counts every permanent you control, which is `Permanent.YouCtrl`.
 */
export function boardCountValid(filter: CountFilter): string | null {
  const cardTypes = filter.cardTypes ?? [];
  const subtypes = filter.subtypes ?? [];
  if (cardTypes.length > 1 || subtypes.length > 1) return null;

  const [cardType] = cardTypes;
  const [subtype] = subtypes;
  if (cardType === undefined) {
    return subtype === undefined ? 'Permanent.YouCtrl' : `${subtype}.YouCtrl`;
  }
  const type = FORGE_PERMANENT_TYPES[cardType];
  if (type === undefined) return null;
  return subtype === undefined ? `${type}.YouCtrl` : `${type}.${subtype}+YouCtrl`;
}

/**
 * The `Valid` spec for a group of permanents a rate is charged per.
 *
 * `countMatching` is `boardCountValid`'s question asked again, so it is asked
 * there. The land subtype is the one this function adds, and Forge's corpus
 * writes it in the same position a card type sits in: `Count$Valid
 * Swamp.YouCtrl` appears 27 times in 2.0.14's scripts (Mutilate's own line is
 * one of them) and the unqualified `Count$Valid Swamp` four more, for the
 * "on the battlefield" reading — Swampbenders and Coiling Woodworm are two of
 * those, and both print "the number of Swamps on the battlefield".
 *
 * `countWithCounter` is refused here for the reason this file's header gives it
 * everywhere else: a part counter decomposes into two Forge counter types and
 * neither is named after the part, so no `counters_GE1_` restriction counts the
 * permanents the card means.
 */
function permanentTallyValid(tally: PermanentTally): string | null {
  switch (tally.kind) {
    case 'countMatching':
      return boardCountValid(tally.filter);
    case 'landsWithSubtype':
      return tally.whose === 'each' ? tally.subtype : `${tally.subtype}.YouCtrl`;
    case 'countWithCounter':
      return null;
  }
}

/**
 * The `Valid` spec for a rate, multiplier and all.
 *
 * Forge folds the per-unit number into the count rather than into the API that
 * reads it: `SVar:X:Count$Valid Enchantment.Other/Times.2` is Ancestral Mask's
 * "+2/+2 for each other enchantment", and the `AddPower$ X` above it carries no
 * arithmetic. So a rate of one is the bare spec and a rate of two is the spec
 * with `/Times.2` on it, and the *sign* stays where Forge keeps it, on the
 * `NumAtt$`/`NumDef$` value (`NumAtt$ -X` is Mutilate's own line).
 *
 * A rate of zero never reaches here: zero times a board is zero however the
 * board reads, so `effect-script.ts` writes the numeral and asks for no SVar at
 * all.
 */
function rateValid(rate: RatePer): string | null {
  const base = permanentTallyValid(rate.each);
  if (base === null) return null;
  const magnitude = Math.abs(rate.rate);
  return magnitude === 1 ? base : `${base}/Times.${magnitude}`;
}

/**
 * Every board-count spec one spell's chain reads, in effect order, or `null`
 * for one it reads and cannot write.
 *
 * A rate is taken whole and its subtree is not walked again. Descending into it
 * would find the tally underneath and offer a second spec — `Swamp.YouCtrl`
 * beside the `Swamp.YouCtrl/Times.2` the rate actually wants — and `soleValid`
 * would refuse a card that reads one number twice.
 */
function specsIn(effects: readonly Effect[]): readonly (string | null)[] {
  const found: (string | null)[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as { readonly kind?: unknown; readonly filter?: unknown };
    if (record.kind === 'ratePer') {
      const rate = value as RatePer;
      if (rate.rate !== 0) found.push(rateValid(rate));
      return;
    }
    if (record.kind === 'countMatching') found.push(boardCountValid(record.filter as CountFilter));
    for (const item of Object.values(value)) walk(item);
  };
  walk(effects);
  return found;
}

/**
 * The one spec a chain reads, or `null` when it reads none or reads two.
 *
 * Two different specs would both want `Y`, and naming them `Y` and `Y2` would
 * be a numbering scheme with exactly one card behind it. Until a card wants
 * two, a chain that reads two is refused whole, and the refusal names the
 * quantity rather than the scheme.
 */
function soleValid(effects: readonly Effect[]): string | null {
  const specs = specsIn(effects);
  if (specs.length === 0 || specs.some((spec) => spec === null)) return null;
  const distinct = new Set(specs);
  return distinct.size === 1 ? (specs[0] ?? null) : null;
}

/** The `SVar:` line a chain that reads a board count carries, if it does. */
export function boardCountSvarLines(effects: readonly Effect[]): readonly string[] {
  const valid = soleValid(effects);
  return valid === null ? [] : [`SVar:${BOARD_COUNT_SVAR}:Count$Valid ${valid}`];
}

/**
 * The chain's spellings, with the board count folded in behind the resolution
 * count.
 *
 * Composed rather than merged into `resolutionCountSpellings`: the two
 * protocols answer different questions about different halves of a card, and a
 * single function that knew both would be the place every later protocol gets
 * added to. Each writer still asks its own `ComputedAmounts` and each still
 * rejects in the row that writes the numeral.
 */
export function withBoardCounts(
  spellings: readonly ComputedAmounts[],
  effects: readonly Effect[],
): readonly ComputedAmounts[] {
  const valid = soleValid(effects);
  if (valid === null) return spellings;
  return spellings.map((spelling) => ({
    ...spelling,
    numeral: (amount: PumpAmount) => {
      // A rate answers the same SVar as a count, because the multiplier is
      // inside the SVar and the sign is on the parameter that reads it.
      if (isRateAmount(amount)) return amount.rate === 0 ? null : BOARD_COUNT_SVAR;
      const spelled = spelling.numeral(amount);
      if (spelled !== null) return spelled;
      return !isLiteralAmount(amount) && amount.kind === 'countMatching' ? BOARD_COUNT_SVAR : null;
    },
  }));
}
