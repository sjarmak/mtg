/**
 * Transpile rejections.
 *
 * The transpiler exists to protect the co-design invariant: the set
 * generator's output space must equal the engine's enforceable space. A DSL
 * construct that has no Forge mapping is therefore a *hard failure* with a
 * named code — never a silently dropped line. A card that transpiles to a
 * script missing one of its effects would boot cleanly in Forge and quietly
 * lie about what the oracle enforces, which is the exact failure this gate
 * exists to catch.
 */

export const TRANSPILE_REJECTION_CODES = [
  /** The card is not a legal `@mtg/dsl` card; we never transpile invalid input. */
  'DSL_VIOLATION',
  /** Effect primitive with no Forge effect-API mapping. */
  'UNMAPPED_EFFECT_KIND',
  /** Evergreen keyword with no Forge `K:` mapping. */
  'UNMAPPED_KEYWORD',
  /** Targeting mode with no Forge `ValidTgts$` mapping. */
  'UNMAPPED_TARGET_KIND',
  /** Target legal in the DSL but not mapped for this effect's Forge API. */
  'UNMAPPED_TARGET_FOR_EFFECT',
  /**
   * A target slot's restriction has no Forge selector.
   *
   * Two shapes reach this. A counter whose Forge meaning is more than one
   * counter or none at all has no single type for `counters_GE1_<type>` to
   * name, and a base selector that is a comma-separated union of card types has
   * nowhere to hang a qualifier that would bind to its last member only.
   * Refusing the card is the whole point: the alternative this code shipped
   * with was writing the unrestricted selector, which exports a strictly more
   * permissive card into the artifact that exists to catch us being wrong.
   */
  'UNMAPPED_TARGET_RESTRICTION',
  /** Basic land type with no Forge type-line mapping. */
  'UNMAPPED_BASIC_LAND_TYPE',
  /** A card cost contains X, whose Forge payment syntax is not source-proven here. */
  'UNMAPPED_VARIABLE_MANA',
  /** A creature's printed P/T is a CDA rather than the stored numeric sentinel. */
  'UNMAPPED_CHARACTERISTIC_VALUE',
  /** Nonbasic land entry and mana abilities have no exact Forge script mapping yet. */
  'UNMAPPED_NONBASIC_LAND',
  /**
   * A nonland permanent that enters tapped (`mtg-hgmz`).
   *
   * The clause is the whole price of a cheap mana rock, so a script that
   * dropped it would boot in Forge as a strictly better card than the kernel
   * runs — the exact divergence the header of this file says a rejection
   * exists to prevent. `UNMAPPED_NONBASIC_LAND` already says the same thing
   * for the land arm, and it stays a separate code because it covers a
   * nonbasic land's mana ability too and this one covers only the entry.
   */
  'UNMAPPED_ENTRY_REPLACEMENT',
  /**
   * A printed quantity the card computes at resolution, in a shape this
   * transpiler cannot write.
   *
   * One shape it can: "damage equal to the number of cards exiled this way",
   * where the exile is an earlier clause of the same spell. `remember.ts` writes
   * that as Forge writes it — `RememberChanged$ True` on the exile, the count
   * read back through `SVar:X:Remembered$Amount`, and a `Cleanup` link that
   * empties the list.
   *
   * What still rejects: a count of the board or a graveyard, an X chosen on
   * casting, and a resolution count read before the exile that would feed it
   * (Forge would run that script and deal zero, which is a card that plays one
   * way here and another in the kernel). Rejecting is the honest outcome for
   * all three — a script that dropped the clause would say nothing.
   */
  'UNMAPPED_COMPUTED_AMOUNT',
  /**
   * A one-shot stat change whose magnitude is a rate: Mutilate's "-1/-1 until
   * end of turn for each Swamp you control".
   *
   * Not a variant of `UNMAPPED_COMPUTED_AMOUNT`, and the difference is which
   * half is missing. Forge writes the rate itself: the multiplier goes inside
   * the `Count$` expression (`Count$Valid Enchantment.Other/Times.2` is
   * Ancestral Mask upstream) and the sign goes on the parameter that reads it
   * (`NumAtt$ -X` is Mutilate's own shipped line), so a rate whose tally has a
   * `Valid` spec transpiles. What refuses is the tally: `countWithCounter`,
   * whose part counters decompose into two Forge counter types named after
   * neither the part nor the card's number, and a filter naming two card types
   * or two subtypes, which Forge spells as a comma-separated OR that
   * `board-count.ts` does not write. `UNMAPPED_COMPUTED_AMOUNT`'s message
   * enumerates counts, so it would send whoever read it to a `Count$` grammar
   * that is already written and away from the group being counted.
   */
  'UNMAPPED_RATE_AMOUNT',
  /**
   * A characteristic-defining P/T (CR 613.4a, e.g. Tarmogoyf): the creature's
   * power and toughness are not printed numbers but a live count of some other
   * zone.
   *
   * Forge expresses these too, through a `CharacteristicDefining$ True` static
   * with `SetPower$`/`SetToughness$` reading a `Count$` SVar, and that grammar
   * is not one this transpiler has built. Rejecting is the honest outcome until
   * it does — a script that dropped the clause would print a vanilla 0/0.
   */
  'UNMAPPED_CHARACTERISTIC_DEFINING_PT',
  /** Text that would break Forge's line/pipe-delimited script grammar. */
  'UNSAFE_SCRIPT_TEXT',
  /**
   * Two differently-named tokens in one set collapse onto the same Forge
   * token-script name.
   *
   * This is a fact about Forge's namespace, not the DSL's, and the two are not
   * the same size. A token's DSL identity is its name, exactly as written;
   * `forgeTokenScriptName` maps that name through `slugify` (lowercase,
   * punctuation dropped, spaces to `_`) and then folds away every subtype word
   * the name already spells, so the Forge namespace is strictly coarser.
   * `Glass` with subtype `Shard` and `Glass Shard` with subtype `Shard` are two
   * tokens to the DSL, the kernel, the renderer and the art pipeline, and one
   * file called `c_0_1_glass_shard` to Forge. That is the flagship's
   * own shape rather than a contrived one: its Part tokens all carry the shared
   * subtype `Part` and are told apart by name alone.
   *
   * What it is not for: two tokens that share a *name* and disagree about their
   * shape. `@mtg/dsl`'s `DUPLICATE_TOKEN_NAME` owns that one and reaches it
   * first — `transpileSet` runs `validateSetUniqueness` before it transpiles
   * anything — and it should, because a shared name is already broken for the
   * kernel's card registry and the art manifest, whatever Forge would have done
   * with it. Naming the cause beats naming one downstream consequence. So this
   * code is reachable only for the coarser collision, and a fixture that shares
   * a token name is testing the DSL gate with the export gate's name.
   */
  'DUPLICATE_TOKEN_SCRIPT',
  /** Two cards in one set collapse onto the same card-script file name. */
  'DUPLICATE_SCRIPT_NAME',
  /**
   * CR 700.2's "Choose one —": a modal spell's `card.modes`, printed in place
   * of a fixed `effects` list.
   *
   * `abilityBlock` builds Forge's `A:`/`SubAbility$`/`SVar:` chain from
   * `card.effects` alone, which is empty on a modal card by construction
   * (`checkEffects` refuses a spell that carries both). Forge has its own
   * modal grammar (`Mode$`/chained `DBEffect` sub-abilities selected by a
   * player choice), and this transpiler has not built it — writing the
   * script anyway would either drop every mode silently or transpile only
   * whichever mode happened to be first, both of which boot cleanly in Forge
   * and lie about what the card does. Rejecting is the honest outcome until
   * that grammar exists.
   */
  'UNMAPPED_MODAL_SPELL',
  /**
   * CR 601.2c's "You may": a spell's `card.may`, which asks a player whether
   * the printed effect happens at all.
   *
   * The modal rejection's argument, one step smaller. Forge does have optional
   * spell abilities, but not as one general parameter: `Optional$ True` is a
   * per-API flag on the choice that API makes (`Dig`'s "you may put a card into
   * your hand"), and `OptionalDecider$` belongs to triggers. A spell-wide "you
   * may" is written per effect API, so the mapping is one row per `FORGE_EFFECTS`
   * entry rather than one param, and this transpiler has not built it. Exporting
   * without it writes a card that always does the thing, which boots cleanly and
   * lies. No card in this repo carries `may` yet, so the rejection is a fence
   * around a gap rather than a regression.
   */
  'UNMAPPED_MAY_SPELL',
] as const;

export type TranspileRejectionCode = (typeof TRANSPILE_REJECTION_CODES)[number];

export interface TranspileRejection {
  /** Stable machine code; consumers branch on this, never on the message. */
  readonly code: TranspileRejectionCode;
  /** Card id the rejection belongs to, or `''` for set-level rejections. */
  readonly cardId: string;
  /** Location inside the card record, e.g. `effects[1].target.kind`. */
  readonly path: string;
  /** What has no mapping, and what would be mappable. */
  readonly message: string;
}

export function rejection(
  code: TranspileRejectionCode,
  cardId: string,
  path: string,
  message: string,
): TranspileRejection {
  return { code, cardId, path, message };
}

/** One-line summary for CI output and thrown-error messages. */
export function formatRejections(rejections: readonly TranspileRejection[]): string {
  return rejections
    .map((r) => `${r.code} [${r.cardId || 'set'}${r.path.length > 0 ? `.${r.path}` : ''}]: ${r.message}`)
    .join('; ');
}

export class TranspileError extends Error {
  readonly rejections: readonly TranspileRejection[];

  constructor(rejections: readonly TranspileRejection[], context: string) {
    super(`${context}: ${formatRejections(rejections)}`);
    this.name = 'TranspileError';
    this.rejections = rejections;
  }
}
