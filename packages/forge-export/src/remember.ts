/**
 * Forge's spelling of a quantity one clause of a spell counts about what an
 * earlier clause did.
 *
 * The DSL has separate counts for cards exiled this way and permanents moved
 * from the battlefield to exile, and no Forge effect API carries either count
 * as a parameter. Forge writes both as
 * a protocol across the chain instead: the ability that moves the cards carries
 * `RememberChanged$ True`, which appends what it moved to the host card's
 * remembered list; a later ability reads the length back as a numeral through
 * `SVar:X:Remembered$Amount`; and a final `DB$ Cleanup | ClearRemembered$ True`
 * empties the list so the next resolution starts from zero. `cinder_seer.txt`
 * is that whole shape in four lines, and `SVar:DBCleanup:DB$ Cleanup |
 * ClearRemembered$ True` appears in 2,304 of Forge 2.0.14's shipped scripts.
 *
 * ## Why the protocol is planned here and not in a row of `FORGE_EFFECTS`
 *
 * It is a property of the whole spell rather than of any one effect. A writer
 * in `effect-script.ts` sees one effect and cannot know whether anything later
 * will count what it did, and the exile that must remember is not the effect
 * that rejects — so a per-row answer would either make every exile remember
 * (a `RememberChanged$` on a card that counts nothing, which is a line no
 * shipped script writes) or make none of them.
 *
 * ## Why two exiles are one count
 *
 * `RememberChanged$` appends, and nothing clears the list between two links of
 * one chain. So a card that exiles a battlefield and then a hand deals damage
 * for both, which is what "exiled this way" means when the printed sentence
 * covers both clauses. That is the flagship mythic this protocol was built
 * for, exactly.
 *
 * ## Why the chain is asked whether it read the count
 *
 * Each effect spelling records whether it actually reads the remembered-card
 * protocol. `card-script.ts` asks those spellings rather than looking for the
 * name `X` in the built abilities, because Condemn legitimately uses the same
 * conventional SVar name for a different quantity. The bit stays beside the
 * function that returns the numeral, so a new numeral slot cannot use the
 * protocol without also declaring that it did.
 */
import type { Effect, PumpAmount } from '@mtg/dsl';
import { isLiteralAmount } from '@mtg/dsl';
import type { ForgeAbility, ForgeParam } from './script-text';

/**
 * The SVar this transpiler binds the resolution count to.
 *
 * `X` because 150 of Forge's own scripts name it that and 42 more name it `Y`
 * only because an `X` was already taken. Nothing else in a script this
 * transpiler writes can claim the name: a castable card with `hasX` is rejected
 * in `transpileCardScript` before its effects are read.
 */
export const RESOLUTION_COUNT_SVAR = 'X';

/** `SVar:X:Remembered$Amount` — the count, read off the remembered list. */
export const RESOLUTION_COUNT_SVAR_LINE = `SVar:${RESOLUTION_COUNT_SVAR}:Remembered$Amount`;

/** Dark Tutelage's shipped declaration for the mana value of one remembered card. */
export const REVEALED_CARD_MANA_VALUE_SVAR_LINE = `SVar:${RESOLUTION_COUNT_SVAR}:Remembered$CardManaCost`;

/** Forge's engine-populated total from earlier `LoseLife` links. */
export const LIFE_LOST_SVAR = 'AFLifeLost';

/** Blood Tithe's shipped declaration for Forge's engine-populated total. */
export const LIFE_LOST_SVAR_LINE = `SVar:${LIFE_LOST_SVAR}:Number$0`;

/** Condemn's last-known target toughness, in Forge's shipped spelling. */
export const TARGETED_TOUGHNESS_SVAR = 'X';
export const TARGETED_TOUGHNESS_SVAR_LINE = `SVar:${TARGETED_TOUGHNESS_SVAR}:Targeted$CardToughness`;

/** Fling's paid creature power, retained by Forge while casting the spell. */
export const PAID_SACRIFICE_POWER_SVAR = 'X';
export const PAID_SACRIFICE_POWER_SVAR_LINE = `SVar:${PAID_SACRIFICE_POWER_SVAR}:Sacrificed$CardPower`;

/** Korozda Guildmage's paid creature toughness, retained by Forge during activation. */
export const PAID_SACRIFICE_TOUGHNESS_SVAR = 'X';
export const PAID_SACRIFICE_TOUGHNESS_SVAR_LINE = `SVar:${PAID_SACRIFICE_TOUGHNESS_SVAR}:Sacrificed$CardToughness`;

/** Mercurial Chemister's engine-populated discarded-card mana value. */
export const PAID_DISCARD_MANA_VALUE_SVAR = 'X';
export const PAID_DISCARD_MANA_VALUE_SVAR_LINE = `SVar:${PAID_DISCARD_MANA_VALUE_SVAR}:Discarded$CardManaCost`;

/** Disciple of Bolas's resolve-time remembered permanent power. */
export const SACRIFICED_PERMANENT_POWER_SVAR = 'X';
export const SACRIFICED_PERMANENT_POWER_SVAR_LINE = `SVar:${SACRIFICED_PERMANENT_POWER_SVAR}:RememberedLKI$CardPower`;

/** Hamletback Goliath's event-retained arriving-creature power. */
export const TRIGGERED_CREATURE_POWER_SVAR = 'TriggeredCreaturePower';
export const TRIGGERED_CREATURE_POWER_SVAR_LINE = `SVar:${TRIGGERED_CREATURE_POWER_SVAR}:TriggeredCard$CardPower`;

/** Trostani's event-retained arriving-creature toughness. */
export const TRIGGERED_CREATURE_TOUGHNESS_SVAR = 'TriggeredCreatureToughness';
export const TRIGGERED_CREATURE_TOUGHNESS_SVAR_LINE = `SVar:${TRIGGERED_CREATURE_TOUGHNESS_SVAR}:TriggeredCard$CardToughness`;

/** `RememberChanged$ True` — what an exile carries so a later link can count it. */
export const REMEMBER_CHANGED: ForgeParam = ['RememberChanged', 'True'];

/**
 * The link that empties the remembered list.
 *
 * Chained after the last effect rather than beside it: a list left populated
 * outlives the resolution, and the next spell on the same card would count this
 * one's exiles as well as its own.
 */
export const RESOLUTION_COUNT_CLEANUP: ForgeAbility = {
  api: 'Cleanup',
  params: [['ClearRemembered', 'True']],
};

/**
 * How one effect spells a quantity it cannot count from its own fields, and
 * whether what it moves must be remembered for a later link to count.
 *
 * Handed to each writer through its context, so the rejection for a quantity
 * with no Forge shape stays where it already is — in the row that writes the
 * numeral — rather than becoming a check somewhere ahead of dispatch that every
 * row would have to trust.
 */
export interface ComputedAmounts {
  /**
   * The Forge numeral for a computed `amount`, or null when there is none.
   *
   * Takes the widened `PumpAmount` rather than `Amount` because the pump's two
   * magnitudes are the one place a rate may be printed, and a rate asks this
   * same question — Forge folds the per-unit multiplier into the `Count$`
   * expression (`board-count.ts`), so what comes back is an SVar name either
   * way and the caller puts the sign on it.
   */
  readonly numeral: (amount: PumpAmount) => string | null;
  /** True when this effect's own moves feed a later count. */
  readonly remembers: boolean;
  /** Declarations required by a numeral this effect reads. */
  readonly supportingLines: readonly string[];
  /** Whether this effect reads the remembered-card protocol's running count. */
  readonly readsRemembered: boolean;
  /** Whether that read needs Forge's `Remembered$Amount` SVar declaration. */
  readonly needsResolutionCountSvar: boolean;
  /** Whether no later effect in this chain reads that running count. */
  readonly isFinalRememberedRead: boolean;
}

/** No protocol: every computed quantity rejects and nothing remembers. */
export const NO_COMPUTED_AMOUNTS: ComputedAmounts = {
  numeral: () => null,
  remembers: false,
  supportingLines: [],
  readsRemembered: false,
  needsResolutionCountSvar: false,
  isFinalRememberedRead: false,
};

/** True when the effect is one whose moved cards `RememberChanged$` would keep. */
function producesRememberedCards(effect: Effect): boolean {
  return effect.kind === 'exileTarget';
}

/** The one writer for Psychic Spiral's remembered graveyard-move count. */
function producesRememberedGraveyardShuffle(effect: Effect): boolean {
  return effect.kind === 'shuffleGraveyardIntoLibrary';
}

/** True when an exile writer moves permanents rather than cards from another zone. */
function producesRememberedPermanents(effect: Effect): boolean {
  return (
    effect.kind === 'exileTarget' &&
    (effect.scope === undefined ||
      effect.scope === 'creaturesThatPlayerControls' ||
      effect.scope === 'permanentsYouControl')
  );
}

/** A resolving sacrifice that may feed a later remembered-LKI amount. */
function producesRememberedSacrifice(effect: Effect): boolean {
  return effect.kind === 'sacrificePermanent';
}

/**
 * The per-effect spellings for one spell's chain, in effect order.
 *
 * `remembers` is the caller's answer, not this function's guess: the first pass
 * asks for the spellings with `remembering` false, and only a chain that turns
 * out to read the count asks again with it true. A card that exiles and counts
 * nothing therefore writes no `RememberChanged$` at all, which is how every
 * exile spell in `res/cardsfolder` that counts nothing is written.
 *
 * The count is only spellable for an effect that has an exile *before* it. A
 * later exile has not happened when the numeral is read, so a card whose damage
 * precedes its exile would deal zero — Forge would run the script and the
 * kernel would not, which is the one failure this transpiler exists to prevent.
 */
export function resolutionCountSpellings(
  effects: readonly Effect[],
  remembering: boolean,
): readonly ComputedAmounts[] {
  const readsKind = (effect: Effect, kind: string): boolean =>
    Object.values(effect).some(
      (value) => typeof value === 'object' && value !== null && 'kind' in value && value.kind === kind,
    );
  const hasExileCount = effects.some((effect) => readsKind(effect, 'exiledThisResolution'));
  const hasPermanentExileCount = effects.some((effect) =>
    readsKind(effect, 'permanentsExiledThisResolution'),
  );
  const hasGraveyardShuffleCount = effects.some((effect) =>
    readsKind(effect, 'cardsShuffledFromGraveyardThisResolution'),
  );
  const hasTargetToughness = effects.some((effect) => readsKind(effect, 'thatCreatureToughness'));
  const hasPaidSacrificePower = effects.some((effect) => readsKind(effect, 'paidSacrificePower'));
  const hasPaidSacrificeToughness = effects.some((effect) => readsKind(effect, 'paidSacrificeToughness'));
  const hasPaidDiscardManaValue = effects.some((effect) => readsKind(effect, 'paidDiscardManaValue'));
  const hasSacrificedPermanentPower = effects.some((effect) =>
    readsKind(effect, 'sacrificedPermanentPowerThisResolution'),
  );
  const hasRevealedCardManaValue = effects.some((effect) =>
    readsKind(effect, 'revealedCardManaValueThisResolution'),
  );
  const hasCopiedCardCast = effects.some(
    (effect) => effect.kind === 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts',
  );
  // These protocols conventionally claim X in Forge's own corpus. Refuse that
  // unprinted combination instead of emitting two declarations for one SVar.
  const svarCollision =
    [
      hasExileCount,
      hasPermanentExileCount,
      hasGraveyardShuffleCount,
      hasTargetToughness,
      hasPaidSacrificePower,
      hasPaidSacrificeToughness,
      hasPaidDiscardManaValue,
      hasSacrificedPermanentPower,
      hasRevealedCardManaValue,
    ].filter(Boolean).length > 1;
  let exiled = false;
  let exiledPermanents = false;
  let shuffledGraveyard = false;
  let revealedCard = false;
  let lostLife = false;
  let sacrificedPermanent = false;
  const spellings: ComputedAmounts[] = [];
  for (const [index, effect] of effects.entries()) {
    const countedExile = exiled;
    const countedPermanentExile = exiledPermanents;
    const countedGraveyardShuffle = shuffledGraveyard;
    const countedLife = lostLife;
    const countedRevealedCard = revealedCard;
    const countedSacrificedPermanent = sacrificedPermanent;
    const readsLifeLost = readsKind(effect, 'lifeLostThisResolution');
    const readsExiled = readsKind(effect, 'exiledThisResolution');
    const readsPermanentExile = readsKind(effect, 'permanentsExiledThisResolution');
    const readsGraveyardShuffle = readsKind(effect, 'cardsShuffledFromGraveyardThisResolution');
    const readsTargetToughness = readsKind(effect, 'thatCreatureToughness');
    const readsPaidSacrificePower = readsKind(effect, 'paidSacrificePower');
    const readsPaidSacrificeToughness = readsKind(effect, 'paidSacrificeToughness');
    const readsPaidDiscardManaValue = readsKind(effect, 'paidDiscardManaValue');
    const readsSacrificedPermanentPower = readsKind(effect, 'sacrificedPermanentPowerThisResolution');
    const readsTriggeringCreaturePower = readsKind(effect, 'triggeringCreaturePower');
    const readsTriggeringCreatureToughness = readsKind(effect, 'triggeringCreatureToughness');
    const readsRevealedCardManaValue = readsKind(effect, 'revealedCardManaValueThisResolution');
    const readsCopiedCards = effect.kind === 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts';
    const readsRemembered =
      ((countedExile && readsExiled) ||
        (countedPermanentExile && readsPermanentExile) ||
        (countedGraveyardShuffle && readsGraveyardShuffle) ||
        (countedRevealedCard && readsRevealedCardManaValue) ||
        (countedSacrificedPermanent && readsSacrificedPermanentPower) ||
        (countedExile && readsCopiedCards)) &&
      !svarCollision;
    const laterReadsRemembered = effects
      .slice(index + 1)
      .some(
        (candidate) =>
          readsKind(candidate, 'exiledThisResolution') ||
          readsKind(candidate, 'permanentsExiledThisResolution') ||
          readsKind(candidate, 'cardsShuffledFromGraveyardThisResolution') ||
          readsKind(candidate, 'revealedCardManaValueThisResolution') ||
          readsKind(candidate, 'sacrificedPermanentPowerThisResolution') ||
          candidate.kind === 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts',
      );
    spellings.push({
      numeral: (amount) => {
        if (isLiteralAmount(amount)) return null;
        if (
          svarCollision &&
          (amount.kind === 'exiledThisResolution' ||
            amount.kind === 'permanentsExiledThisResolution' ||
            amount.kind === 'cardsShuffledFromGraveyardThisResolution' ||
            amount.kind === 'thatCreatureToughness' ||
            amount.kind === 'paidSacrificePower' ||
            amount.kind === 'paidSacrificeToughness' ||
            amount.kind === 'paidDiscardManaValue' ||
            amount.kind === 'sacrificedPermanentPowerThisResolution' ||
            amount.kind === 'revealedCardManaValueThisResolution')
        ) {
          return null;
        }
        if (amount.kind === 'exiledThisResolution' && countedExile) return RESOLUTION_COUNT_SVAR;
        if (amount.kind === 'permanentsExiledThisResolution' && countedPermanentExile) {
          return RESOLUTION_COUNT_SVAR;
        }
        if (amount.kind === 'cardsShuffledFromGraveyardThisResolution' && countedGraveyardShuffle) {
          return RESOLUTION_COUNT_SVAR;
        }
        if (amount.kind === 'lifeLostThisResolution' && countedLife) return LIFE_LOST_SVAR;
        if (amount.kind === 'thatCreatureToughness') return TARGETED_TOUGHNESS_SVAR;
        if (amount.kind === 'paidSacrificePower') return PAID_SACRIFICE_POWER_SVAR;
        if (amount.kind === 'paidSacrificeToughness') return PAID_SACRIFICE_TOUGHNESS_SVAR;
        if (amount.kind === 'paidDiscardManaValue') return PAID_DISCARD_MANA_VALUE_SVAR;
        if (amount.kind === 'sacrificedPermanentPowerThisResolution' && countedSacrificedPermanent) {
          return SACRIFICED_PERMANENT_POWER_SVAR;
        }
        if (amount.kind === 'triggeringCreaturePower') return TRIGGERED_CREATURE_POWER_SVAR;
        if (amount.kind === 'triggeringCreatureToughness') return TRIGGERED_CREATURE_TOUGHNESS_SVAR;
        if (amount.kind === 'revealedCardManaValueThisResolution' && countedRevealedCard) {
          return RESOLUTION_COUNT_SVAR;
        }
        return null;
      },
      remembers:
        remembering &&
        ((hasExileCount && producesRememberedCards(effect)) ||
          (hasCopiedCardCast && producesRememberedCards(effect)) ||
          (hasPermanentExileCount && producesRememberedPermanents(effect)) ||
          (hasGraveyardShuffleCount && producesRememberedGraveyardShuffle(effect)) ||
          (hasSacrificedPermanentPower && producesRememberedSacrifice(effect)) ||
          (hasRevealedCardManaValue && effect.kind === 'revealTopCardToHand')),
      supportingLines: [
        ...(countedLife && readsLifeLost ? [LIFE_LOST_SVAR_LINE] : []),
        ...(readsTargetToughness && !svarCollision ? [TARGETED_TOUGHNESS_SVAR_LINE] : []),
        ...(readsPaidSacrificePower && !svarCollision ? [PAID_SACRIFICE_POWER_SVAR_LINE] : []),
        ...(readsPaidSacrificeToughness && !svarCollision ? [PAID_SACRIFICE_TOUGHNESS_SVAR_LINE] : []),
        ...(readsPaidDiscardManaValue && !svarCollision ? [PAID_DISCARD_MANA_VALUE_SVAR_LINE] : []),
        ...(countedSacrificedPermanent && readsSacrificedPermanentPower && !svarCollision
          ? [SACRIFICED_PERMANENT_POWER_SVAR_LINE]
          : []),
        ...(readsTriggeringCreaturePower ? [TRIGGERED_CREATURE_POWER_SVAR_LINE] : []),
        ...(readsTriggeringCreatureToughness ? [TRIGGERED_CREATURE_TOUGHNESS_SVAR_LINE] : []),
        ...(countedRevealedCard && readsRevealedCardManaValue && !svarCollision
          ? [REVEALED_CARD_MANA_VALUE_SVAR_LINE]
          : []),
      ],
      readsRemembered,
      needsResolutionCountSvar:
        readsRemembered &&
        (readsExiled ||
          readsPermanentExile ||
          readsGraveyardShuffle ||
          readsRevealedCardManaValue ||
          readsSacrificedPermanentPower),
      isFinalRememberedRead: readsRemembered && !laterReadsRemembered,
    });
    if (producesRememberedCards(effect)) exiled = true;
    if (producesRememberedPermanents(effect)) exiledPermanents = true;
    if (producesRememberedGraveyardShuffle(effect)) shuffledGraveyard = true;
    if (effect.kind === 'revealTopCardToHand') revealedCard = true;
    if (effect.kind === 'loseLife') lostLife = true;
    if (producesRememberedSacrifice(effect)) sacrificedPermanent = true;
  }
  return spellings;
}

/** True when any effect spelling in the chain reads the remembered-card count. */
export function readsResolutionCount(spellings: readonly ComputedAmounts[]): boolean {
  return spellings.some((spelling) => spelling.readsRemembered);
}
