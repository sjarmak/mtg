/**
 * Forge's spelling of a quantity one clause of a spell counts about what an
 * earlier clause did.
 *
 * `exiledThisResolution` is the DSL's "the number of cards exiled this way",
 * and no Forge effect API carries that count as a parameter. Forge writes it as
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
 * `readsResolutionCount` inspects the built abilities for the numeral rather
 * than re-deriving which effect kinds carry an `Amount`. The numeral is a whole
 * parameter value and this protocol is the only thing that writes it — a card
 * whose mana cost prints X is rejected before any of this — so the question is
 * answered exactly rather than guessed. It also means the protocol extends to
 * any numeral slot that later learns to hold an SVar, with no second table to
 * keep in step with the first.
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
}

/** No protocol: every computed quantity rejects and nothing remembers. */
export const NO_COMPUTED_AMOUNTS: ComputedAmounts = {
  numeral: () => null,
  remembers: false,
};

/** True when the effect is one whose moved cards `RememberChanged$` would keep. */
function producesRememberedCards(effect: Effect): boolean {
  return effect.kind === 'exileTarget';
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
  let exiled = false;
  const spellings: ComputedAmounts[] = [];
  for (const effect of effects) {
    const counted = exiled;
    spellings.push({
      numeral: (amount) =>
        !isLiteralAmount(amount) && amount.kind === 'exiledThisResolution' && counted
          ? RESOLUTION_COUNT_SVAR
          : null,
      remembers: remembering && producesRememberedCards(effect),
    });
    if (producesRememberedCards(effect)) exiled = true;
  }
  return spellings;
}

/** True when any ability in the built chain reads the resolution count. */
export function readsResolutionCount(abilities: readonly ForgeAbility[]): boolean {
  return abilities.some((ability) => ability.params.some(([, value]) => value === RESOLUTION_COUNT_SVAR));
}
