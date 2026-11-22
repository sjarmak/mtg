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
 * `CountFilter` ORs within a list and ANDs across its axes (`matchesFilter`'s
 * `anyOf`), so `{cardTypes: ['creature','artifact']}` means creature *or*
 * artifact and `{cardTypes: ['creature'], subtypes: ['Monster']}` means both at
 * once. Forge spells the OR as a comma-separated list of whole specs and the
 * AND as a `+` between qualifiers, so a filter with several members on several
 * axes is the cross product: `Count$Valid Wolf.YouCtrl,Werewolf.YouCtrl` and
 * `Count$Valid Artifact.YouCtrl,Enchantment.YouCtrl` are shipped, and 159 lines
 * in 2.0.15's scripts write a comma in this position.
 *
 * The two readings of a comma differ on exactly the card the flagship prints,
 * so the Java rather than the corpus settles it: `CardLists.getValidCardCount`
 * splits the spec on commas and hands the array to a per-card predicate, and
 * `GameObject.isValid(String[])` returns on the first member that matches. Each
 * card is therefore tested once and counted once however many members it
 * satisfies — a sum over members would count Silver Brigand Warchief's own
 * body twice, because it is a Brigand Monster and its trigger counts
 * Brigands and Monsters.
 *
 * A card type that is not a permanent is still refused, and for a blunter
 * reason: the count is of the battlefield, and an instant is never on it. The
 * kernel would count zero and so would Forge, so the two agree — but a card
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
import type {
  CardKind,
  CountFilter,
  CountMatching,
  Effect,
  PermanentTally,
  PumpAmount,
  RatePer,
  StaticModification,
} from '@mtg/dsl';
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
 * One member of a `Valid` list: one card type, one subtype and one name, ANDed.
 *
 * The type token is the card type when the member has one and the subtype when
 * it does not, because Forge's grammar takes a creature type in the same
 * position a card type sits in — `conditionParams` already writes
 * `<subtype>.YouCtrl` for exactly that reason. A member with neither counts
 * every permanent you control, which is `Permanent.YouCtrl`.
 */
function boardCountMember(
  cardType: CardKind | undefined,
  subtype: string | undefined,
  name: string | undefined,
  keywordAbilities: readonly string[],
  options: Pick<CountMatching, 'whose' | 'excludeSource'>,
): string | null {
  let base: string;
  const qualifiers: string[] = [];
  if (cardType === undefined) {
    base = subtype === undefined ? 'Permanent' : subtype;
  } else {
    const type = FORGE_PERMANENT_TYPES[cardType];
    if (type === undefined) return null;
    base = type;
    if (subtype !== undefined) qualifiers.push(subtype);
  }
  if (name !== undefined) qualifiers.push(`named${name}`);
  if (keywordAbilities.includes('defender')) qualifiers.push('withDefender');
  if (options.excludeSource === true) qualifiers.push('Other');
  if (options.whose !== 'each') qualifiers.push('YouCtrl');
  return qualifiers.length === 0 ? base : `${base}.${qualifiers.join('+')}`;
}

/**
 * The `Valid` spec for one filter, or `null` when this transpiler will not
 * write it.
 *
 * An axis that names nothing contributes one `undefined` rather than no
 * members, so the empty filter still spells `Permanent.YouCtrl` and a filter
 * that names three subtypes and no card type spells three members instead of
 * none. The list is the cross product because the axes AND and their members
 * OR; the file header argues why a comma is that OR and not a sum.
 */
export function boardCountValid(
  filter: CountFilter,
  options: Pick<CountMatching, 'whose' | 'excludeSource'> = {},
): string | null {
  const names = filter.names ?? [];
  const keywordAbilities = filter.keywordAbilities ?? [];
  if (names.some((name) => /[,\n|]/u.test(name))) return null;
  const cardTypes: readonly (CardKind | undefined)[] =
    filter.cardTypes === undefined || filter.cardTypes.length === 0 ? [undefined] : filter.cardTypes;
  const subtypes: readonly (string | undefined)[] =
    filter.subtypes === undefined || filter.subtypes.length === 0 ? [undefined] : filter.subtypes;
  const named: readonly (string | undefined)[] = names.length === 0 ? [undefined] : names;

  const members: string[] = [];
  for (const cardType of cardTypes) {
    for (const subtype of subtypes) {
      for (const name of named) {
        const member = boardCountMember(cardType, subtype, name, keywordAbilities, options);
        if (member === null) return null;
        if (!members.includes(member)) members.push(member);
      }
    }
  }
  return members.join(',');
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
      if ('zone' in tally && tally.zone === 'controllerGraveyard') {
        return 'Graveyard Creature.YouOwn';
      }
      return boardCountValid(tally.filter, tally);
    case 'landsWithSubtype':
      return tally.whose === 'each' ? tally.subtype : `${tally.subtype}.YouCtrl`;
    case 'countWithCounter':
      return null;
  }
}

type StatBonusPer = Extract<StaticModification, { readonly kind: 'statBonusPer' }>;

/** Forge values and declarations for one live layer-7c rate. */
interface StatBonusPerValues {
  readonly power: string | undefined;
  readonly toughness: string | undefined;
  readonly supportingLines: readonly string[];
}

function signedSvar(rate: number, name: string): string | undefined {
  if (rate === 0) return undefined;
  return rate < 0 ? `-${name}` : name;
}

function scaledTallyValid(tally: PermanentTally, rate: number): string | null {
  const valid = permanentTallyValid(tally);
  if (valid === null) return null;
  const magnitude = Math.abs(rate);
  return magnitude <= 1 ? valid : `${valid}/Times.${String(magnitude)}`;
}

/**
 * Compiles a live static P/T rate to collision-safe Forge SVar references.
 *
 * Equal nonzero magnitudes share one declaration, matching Timberpack Wolf,
 * Quag Sickness and Ancestral Mask upstream. Different magnitudes get one
 * declaration per P/T axis so neither rate is flattened into the other.
 */
export function statBonusPerValues(modification: StatBonusPer, prefix: string): StatBonusPerValues | null {
  const nonzero = [modification.power, modification.toughness].filter((rate) => rate !== 0);
  if (nonzero.length === 0) {
    return { power: undefined, toughness: undefined, supportingLines: [] };
  }

  const sameMagnitude = new Set(nonzero.map((rate) => Math.abs(rate))).size === 1;
  if (sameMagnitude) {
    const name = `${prefix}Count`;
    const valid = scaledTallyValid(modification.each, nonzero[0] ?? 0);
    if (valid === null) return null;
    return {
      power: signedSvar(modification.power, name),
      toughness: signedSvar(modification.toughness, name),
      supportingLines: [`SVar:${name}:Count$Valid ${valid}`],
    };
  }

  const parts = [
    ['Power', modification.power] as const,
    ['Toughness', modification.toughness] as const,
  ].filter((part) => part[1] !== 0);
  const values = new Map<string, string>();
  const supportingLines: string[] = [];
  for (const [axis, rate] of parts) {
    const valid = scaledTallyValid(modification.each, rate);
    if (valid === null) return null;
    const name = `${prefix}${axis}`;
    values.set(axis, signedSvar(rate, name) ?? name);
    supportingLines.push(`SVar:${name}:Count$Valid ${valid}`);
  }
  return {
    power: values.get('Power'),
    toughness: values.get('Toughness'),
    supportingLines,
  };
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
    if (record.kind === 'countMatching') {
      const count = value as CountMatching;
      found.push(boardCountValid(count.filter, count));
    }
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
  if (
    effects.length === 1 &&
    effects[0]?.kind === 'addMana' &&
    effects[0].distribution === 'anyCombinationOfColors'
  ) {
    return [];
  }
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
