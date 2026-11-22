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
  /** A filtered discard activation cost whose Forge Valid grammar is not proven. */
  'UNMAPPED_ACTIVATION_COST_FILTER',
  /** A spell's sacrifice filter whose Forge `Sac` grammar is not proven. */
  'UNMAPPED_SPELL_ADDITIONAL_COST_FILTER',
  /** An alternative casting price whose Forge `Sac` grammar is not proven. */
  'UNMAPPED_SPELL_ALTERNATIVE_COST_FILTER',
  /** A static cast-timing filter whose Forge ValidCard grammar is not proven. */
  'UNMAPPED_CAST_PERMISSION_FILTER',
  /** A card-level player-turn restriction whose Forge counter grammar is not proven. */
  'UNMAPPED_CASTING_RESTRICTION',
  /** A per-additional-target cost other than Fireball's source-proven one generic. */
  'UNMAPPED_TARGET_COST_INCREASE',
  /** A counter-removal activation cost whose counter has no single Forge type. */
  'UNMAPPED_ACTIVATION_COUNTER_COST',
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
   * Forge's `Charm` root selects one named `SVar:` chain per DSL mode. This
   * rejection remains for a mode whose effect list cannot produce even one
   * Forge ability; emitting a choice with no body would boot cleanly and do
   * nothing.
   */
  'UNMAPPED_MODAL_SPELL',
  /**
   * CR 601.2c's "You may": a spell's `card.may`, which asks a player whether
   * the printed effect happens at all.
   *
   * Forge does have optional
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
  /**
   * CR 702.96's Overload: a spell's `card.overload`, a second casting mode with
   * its own cost and its own effects.
   *
   * The modal rejection's argument again, arriving from the other side. There
   * the card had no `effects` for `abilityBlock` to read; here it has one set
   * too many, and the exporter writes only the ordinary one. That is not a card
   * with a clause missing — it is a card with a *casting mode* missing, while
   * `renderOracleText` prints "Overload {cost}" on the Oracle line either way.
   * A boot-legged Cyclonic Rift would advertise a mode Forge could not offer,
   * which is the same lie one layer up.
   *
   * Forge does ship the four RTR overload cards, so the grammar exists in
   * `res/cardsfolder` and is not one this transpiler has read. Writing an
   * alternative cast from first principles is what this package refuses to do
   * everywhere else, so the honest outcome is to refuse the card until somebody
   * reads the spelling off the corpus. `mtg-1mr1`.
   */
  'UNMAPPED_OVERLOAD_SPELL',
  /**
   * Two Forge `SVar:` definitions of one name on one card.
   *
   * Not an unmapped construct: every part of the card mapped, and the parts
   * collided when they were put together. A supporting `SVar:` line is a named
   * definition local to the card, and the effect rows pick their names off the
   * corpus, where a name is a per-card convention rather than a registry --
   * `RPrevent` is the name 89 shipped scripts give a prevention replacement,
   * and none of them defines it twice. Three rows here emit a different
   * definition under it, so a card carrying two prevention effects writes both.
   *
   * Forge reads one definition per name, so such a card boots and enforces
   * whichever definition it read last. That is the failure this whole file
   * exists to prevent, arriving from composition rather than from vocabulary:
   * the card looks complete, the parity oracle disagrees with the kernel, and
   * neither side reports why. The alternative to refusing is renaming, which
   * would put every colliding row off the corpus to fix a card shape that may
   * never be printed. A row may still pick a different name outright where the
   * corpus offers one -- the life-total conditions in `ability-script.ts` are
   * named `YourLife` for that reason -- but that is a fixed choice a row makes
   * alone, not a resolution of a collision it cannot see.
   *
   * Raised by the card writer rather than by a row, because no row can see
   * what another row already wrote (`mtg-9111`).
   */
  'COLLIDING_SVAR_DEFINITION',
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
