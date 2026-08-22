/**
 * "…unless its controller pays {2}" (CR 118.8's alternative cost, printed as a
 * clause on a spell): the affected player is offered a price to stop the spell
 * from doing what it says, and pays it or does not as the spell resolves.
 *
 * ## Why the card carries this at all
 *
 * The audit behind `mtg-3zjg` named it the highest-value single gap in the
 * vocabulary, and the reason is a property of every removal spell this DSL can
 * print rather than a missing keyword. Unconditional removal is a coin already
 * flipped: it resolves, the creature dies, and the player who lost it never had
 * a decision to make. A spell with this clause has a cost curve tied to what it
 * can answer and hands the exchange back for one turn. That is the interactive
 * shape the set's design rule asks for, and it is the same shape `may.ts`
 * reaches from the other side — `may` asks the caster's side of the table
 * whether to do it, this asks the other side whether to stop it.
 *
 * ## Why this is a `Card`-level field and not an `Effect` wrapper
 *
 * `may.ts`'s argument, unchanged. An `Effect`-union member would need rows in
 * the kernel's `EFFECT_EXECUTION` table and the validator's `EFFECT_RULES` for
 * a kind whose resolvability depends on a decision the kernel has not asked
 * when those tables are read, and `applyEffect` is a pure synchronous function
 * with no agent access by design. A `Card`-level field gates the printed effect
 * before `applyEffect` ever walks it, which is one more use of the pause
 * `trigger-choice.ts` already owns rather than a second pause mechanism.
 *
 * ## Why the payer is a word and not a player
 *
 * `@mtg/dsl` has no notion of a player id and a card is authored before any
 * game exists to have players in it, so the field names the *role* the printed
 * English names and the kernel resolves it against the spell's chosen target at
 * resolution. The two roles are the two English cards actually print:
 * `'targetController'` is "its controller", said of a spell aimed at a
 * permanent, and `'targetPlayer'` is "that player", said of one aimed at a
 * person. `'you'` is deliberately absent: a spell that offers its own caster a
 * price to stop it is a card nobody prints, and the caster who did not want the
 * effect would simply not have cast it.
 *
 * ## The bound
 *
 * Legal on spells only, for `may`'s reason (a permanent's effects live inside
 * its abilities), and refused alongside `modes` and alongside `may`: two pauses
 * in one resolution is not a mechanism the kernel has, and a payer derived from
 * *whichever mode was chosen* is a question the mode list cannot answer at
 * authoring time.
 *
 * Refused on a spell printing more than one effect, and that bound is about the
 * printed line rather than the engine. The clause attaches to a sentence — "…
 * unless its controller pays {2}" modifies the thing that would otherwise
 * happen — and a card whose text is two sentences has two candidates and no
 * rule saying which. Every paper printing of this shape prints one effect. A
 * card wanting two is two cards until the renderer is taught which sentence
 * carries the clause.
 *
 * The cost is a fixed mana cost. "Unless its controller pays {0}" is a card
 * written as though it had a clause and played as though it did not, which is
 * the encoding rule `TargetSpecSchema.distinct` states for itself. `{X}` is
 * refused for a different reason: everywhere else in this DSL an X is the X the
 * *caster* announced, and the payer here is the other player, so a card reading
 * "unless its controller pays {X}" names a number nothing on the card chooses. A
 * non-mana price ("unless that player discards a card", "unless they sacrifice
 * a creature") is a real family and is not here: the kernel would have to open
 * a second decision inside the payment, and `@mtg/kernel`'s `cost.ts` prices a
 * mana cost against a state with no further questions asked. That family waits
 * for its own lane.
 */
import { z } from 'zod';
import { formatManaCost, ManaCostSchema } from './mana';

export const UnlessPayerSchema = z.enum(['targetController', 'targetPlayer']);
export type UnlessPayer = z.infer<typeof UnlessPayerSchema>;

export const UnlessClauseSchema = z.strictObject({
  payer: UnlessPayerSchema,
  cost: ManaCostSchema,
});

export type UnlessClause = z.infer<typeof UnlessClauseSchema>;

/**
 * Target kinds each payer word can be read off, and the whole of what makes the
 * clause checkable.
 *
 * `anyTarget` is in neither list on purpose: it names a creature or a player
 * depending on what the caster picked, so a card printing "unless its
 * controller pays" over it would print a sentence that is false half the time.
 * `noTarget` and `triggeringCreature` are in neither because the first names
 * nobody and the second is a referent retained from an event, which a spell
 * does not have. `targetCreatureYouControl` is absent for the reason `'you'` is
 * absent as a payer word: its controller is the caster, who would not have cast
 * it. `targetCreatureDefendingPlayerControls` is absent because
 * `ATTACK_TRIGGER_ONLY_TARGETS` already makes it illegal on a spell, and a
 * second list repeating that would be a second place to forget it.
 */
export const UNLESS_PAYER_TARGETS: Readonly<Record<UnlessPayer, readonly string[]>> = {
  targetController: ['targetCreature', 'targetArtifactOrEnchantment'],
  targetPlayer: ['targetPlayer', 'targetOpponent'],
};

/** The English the clause prints, without the cost: "its controller" / "that player". */
export function unlessPayerPhrase(payer: UnlessPayer): string {
  return payer === 'targetController' ? 'its controller' : 'that player';
}

/**
 * Hangs the clause off the end of the sentence it modifies.
 *
 * It lives beside the schema rather than in `oracle.ts` because two renderers
 * print this line: the card face, and `@mtg/forge-export`'s `SpellDescription$`,
 * which builds its text from `renderEffect` per effect and so cannot reach the
 * card-level clause any other way. A second copy of "trim the full stop, then
 * append" is a second chance for the two to disagree about a card Forge is
 * being asked to play.
 */
export function withUnlessClause(sentence: string, clause: UnlessClause): string {
  const trimmed = sentence.endsWith('.') ? sentence.slice(0, -1) : sentence;
  return `${trimmed} unless ${unlessPayerPhrase(clause.payer)} pays ${formatManaCost(clause.cost)}.`;
}
