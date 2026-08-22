/**
 * Slot fillability: does the skeleton leave a card to design here at all?
 *
 * Every other check in this directory judges a card against the slot it filled.
 * This one judges the slot, and it is the only check that can run before a single
 * model call, because it reads nothing but the allocation.
 *
 * # The rule, and the one role it exempts
 *
 * A slot's spec is the whole of what the model may print: the keywords it must
 * carry, the effect primitives it may use, the CR 113 ability kinds it may print.
 * With all three empty, the set of legal cards for the slot is not "narrow", it
 * is a mana cost with nothing under it — and `checkSlotConformance` passes that
 * card, because `checkEffectKinds` and `checkAbilityKinds` both return early on
 * an empty allowlist. A card the slot never permitted is caught; a slot that
 * permits nothing is not.
 *
 * The exemption is the creature slot, and it is the reason this rule is stated
 * per card kind rather than as "no empty allowlists". A creature prints a body
 * whether or not it prints a word, so a vanilla creature is a card: real premier
 * sets print blank creatures at 2.0% of commons, and `checkBlankCards` in
 * `template.ts` already declines to fault one below the bomb tier on exactly that
 * census. `allocateGroup` never gives a creature slot an effect kind at all, so a
 * rule that failed every empty allowlist would fail every vanilla common ever
 * printed. That is the opposite error and it is no smaller.
 *
 * Nothing else has a body. In the same census, 20 premier sets print 0 blank
 * noncreatures out of 3,956 cards, and DSL v0 is stricter than the census: a
 * noncreature artifact with no effect and no ability has no power, no toughness
 * and no text, so two such slots in one set are not two cards that resemble each
 * other, they are one card printed twice at different prices.
 *
 * # Two codes, because there are two defects and only one of them has a remedy
 *
 * `ROLE_PROFILES` is the discriminant, and it is read rather than restated: a
 * role in it has an effect vocabulary somebody could write down, and a role
 * absent from it does not, which is exactly what `ARTIFACT_ROLES` is defined as
 * one line below the table.
 *
 * `SLOT_ROLE_UNFILLABLE` is the profileless case, and it is the one the shipped
 * skeleton actually produces. `manaArtifact` and `landFixing` name a function the
 * generator has no verb for — `colorlessEffectKinds` hands them an empty list by
 * design and *no allowlist can be written for them today, empty or otherwise*.
 *
 * **The DSL grew the mana verb and it did not move this.** `addMana` landed with
 * `mtg-nhyv.9` and the kernel runs it, so a hand-authored mana rock is a card this
 * engine plays; what it is not is a card a *slot* can ask for, because `addMana`
 * is deliberately outside `EffectKind` and `@mtg/dsl`'s `vocabulary.ts` argues why
 * at length — a mana ability the model prints wrong is a broken format rather than
 * a weak card, and no per-card check can tell an accelerant from a mistake, since
 * that is a question about the whole set's curve. `ROLE_PROFILES` names effect
 * kinds, so it cannot reach a verb that is not one. Land fetching has no verb at
 * all. Telling a reader to write an allowlist here still sends them to do
 * something impossible, and the second horn `mtg-g84u` offered — "the DSL grows
 * the verb" — is spent: the verb shipped and the role is exactly as unfillable.
 * What is left is the first horn, that the profile stops emitting the role. The
 * slot's one remaining hope of being a
 * card is an ability, and `reserveAbilitySlots` only reaches it when a brief
 * mechanic applies to the colorless pool; `fillTextlessPermanents` is gated on
 * that same `applicable` list, deliberately, so a brief naming no ability kind
 * builds the prompt and JSON Schema bytes it has always built. A brief whose
 * every mechanic names colors therefore allocates blank artifacts and always has.
 *
 * `SLOT_UNFILLABLE` is the profiled case: a role that *has* a vocabulary reached
 * a slot without one. There the instruction "give this slot its role's effect
 * kinds" is a thing a reader can do, so it is the instruction given. Today's
 * allocator cannot produce one — `allowedEffectKinds` throws when a profiled
 * role's on-pie list comes back empty rather than allocating the slot anyway, and
 * a colorless noncreature role is profileless by construction — so this arm is
 * pinned by a hand-built slot rather than by a brief. It is stated because the
 * rule is about slots, not about which slots one allocator happens to emit; the
 * day a pass drops a vocabulary it held, the gate should name the vocabulary
 * rather than the engine.
 *
 * # Why these are errors, and why they may name their slots
 *
 * `TEMPLATE_OVER_CYCLE`, `BLANK_CARD` and `RATE_ABOVE_CURVE` are warnings on
 * purpose: `errors()` builds `failingSlotIds`, which is the list `generateSet`
 * re-asks the model for at cost, and none of those three names a slot whose spec
 * a fix can change, so as errors they bought retry rounds no fixture had recorded.
 * That is the test, and this finding passes it in the only way that matters: the
 * slot is the thing that is wrong, and `generateSet` refuses on it *before the
 * first fill call*, so the retry list is never built from it. Within a run these
 * findings are always empty, because the run stopped when they would not have
 * been. Naming the slots therefore costs no call and is what a reader validating
 * a set on its own needs to see.
 */
import type { SetFinding } from './findings';
import type { FindingCode } from './findings';
import { finding } from './findings';
import { ROLE_PROFILES } from '../roles';
import type { Slot } from '../slot';
import { printsNoText } from '../slot';

/**
 * The slots the allocator emitted that no card can fill, in slot order.
 *
 * Exported beside the findings because two callers need two shapes of the one
 * answer: the report wants a finding per slot, and `generateSet` wants the slots
 * themselves — the ids to refuse with, and the rarity and role that go in the
 * message — before it spends anything.
 */
export function unfillableSlots(slots: readonly Slot[]): Slot[] {
  return slots.filter(isUnfillable);
}

/**
 * One finding per unfillable slot, naming the remedy that role actually has.
 */
export function checkSlotFillability(slots: readonly Slot[]): SetFinding[] {
  return unfillableSlots(slots).map((slot) => finding(codeFor(slot), 'error', message(slot), [slot.id]));
}

/** A slot with nothing to print and no body to print it on. */
function isUnfillable(slot: Slot): boolean {
  return slot.cardKind !== 'creature' && printsNoText(slot);
}

/** Whether the role could hold an effect vocabulary, not whether this slot did. */
function roleIsExpressible(slot: Slot): boolean {
  return ROLE_PROFILES[slot.role] !== undefined;
}

function codeFor(slot: Slot): FindingCode {
  return roleIsExpressible(slot) ? 'SLOT_UNFILLABLE' : 'SLOT_ROLE_UNFILLABLE';
}

function message(slot: Slot): string {
  const subject =
    `${slot.id} is a ${slot.rarity} ${slot.color ?? 'colorless'} ${slot.cardKind} at role ` +
    `"${slot.role}" with no keyword, no effect kind and no ability kind allocated, so the only card ` +
    'it permits is a mana cost with nothing under it. Only a creature slot may print no text, ' +
    'because only a creature prints a body without one. ';
  return roleIsExpressible(slot)
    ? `${subject}The role has an effect vocabulary in ROLE_PROFILES that this slot was not given; ` +
        'allocate it, or allocate the slot to a role it can print.'
    : `${subject}The role has no profile in ROLE_PROFILES and none can be written for it: do not ` +
        'ask for an allowlist here. The DSL grew a mana verb and it did not help — addMana runs in ' +
        'the kernel but is deliberately outside EffectKind, so ROLE_PROFILES cannot name it, and ' +
        'there is still no land fetching at all. The remedy left is that the profile stops emitting ' +
        'this role (mtg-g84u). Until then the slot prints a card only if a brief mechanic that ' +
        'reaches this pool states an ability kind.';
}
