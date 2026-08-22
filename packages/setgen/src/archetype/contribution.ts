/**
 * One structural view of a card, computed the same way from a planned slot and
 * from the printed card that fills it.
 *
 * Two passes need the same arithmetic. The reservation pass asks "can these
 * slots support ten playable archetypes?" before any model call; the validation
 * pass asks "did the printed set actually do it?". Running both over one shape
 * is what makes a post-generation failure mean the model deviated, rather than
 * meaning the two passes disagreed about what a removal spell is.
 *
 * Nothing here is a quality judgment. Whether a card is *good* is the critique
 * pass's problem (ZFC); this module only answers structural questions the DSL's
 * own vocabulary settles: is it a body, can it answer a body, and can it touch
 * the battlefield at all.
 */
import type { AnyEffectKind, Card, Color, EffectKind } from '@mtg/dsl';
import { cardManaValue, hasAbilityEffects, isPricedEffectKind } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, isRemovalCard } from '@mtg/deckbuild';
import { cardOwnEffects } from '../validate/mechanics';
import type { Slot } from '../slot';

/**
 * Effect primitives that cannot change the battlefield.
 *
 * A countered spell, a drawn card, a milled library and a gained life total all
 * leave the board exactly as they found it, so a spell built only from these
 * resolves and changes nothing an attack step can see. That is a property of the
 * enforceable space, not an opinion about the cards: under the co-design
 * invariant the generator must not print at density what the engine cannot
 * convert into board presence.
 *
 * This list once carried a second sentence, that the engine had no activated,
 * triggered or static abilities and so nothing for these effects to feed into.
 * That stopped being true when the ability model landed. The list survives the
 * premise because it never depended on it — these four effects are inert on
 * their own terms — but the reader should not be told a false thing about the
 * engine on the way to a true thing about the effects.
 */
export const BATTLEFIELD_INERT_EFFECTS: readonly AnyEffectKind[] = [
  'counterSpell',
  'drawCards',
  'gainLife',
  'millCards',
  // Inert on exactly the same terms: a look at the top of the library and a look
  // at a hand both leave the board as they found it. They are listed because the
  // test below reads the *unnarrowed* kind list, so a kind absent from here
  // counts as live -- which is right for `exileTarget` and
  // `returnFromGraveyard`, and wrong for these two. Whether either is priced is
  // a separate question with a separate answer: `mtg-q5yg` promoted `scry` and
  // left `revealHand` where it was, and neither move touched this list.
  'scry',
  'revealHand',
  // A ritual is inert on the same terms and for a reason worth stating: it puts
  // mana in a pool, and a pool is not the battlefield. What the mana then buys
  // is a different card, priced where that card is priced. A mana ability never
  // reaches this list at all -- it is printed on a permanent, and
  // `resolvesAndLeaves` below asks the question only of an instant or a sorcery.
  'addMana',
  // Four of the seven library and graveyard primitives, on the same terms
  // again: a shuffle reorders a hidden zone, a reveal names cards and leaves
  // them where they were, and emptying a graveyard or shuffling it back into
  // its library moves cards between two zones an attack step cannot see. The
  // other three are deliberately absent and are live: `putOnLibrary` takes a
  // permanent off the battlefield, `searchLibrary` may put one onto it, and
  // `chooseFromGraveyard` may reanimate one, so none of them is a blank however
  // its card is filled in. `shuffleGraveyardIntoLibrary` can carry its own
  // source along with `includeSelf`, which does take a permanent off the
  // battlefield -- but only when the source is one, and a permanent is never
  // asked the inert question, so the sentence the list makes about spells holds.
  'shuffleLibrary',
  'revealTopCards',
  'exileGraveyard',
  'shuffleGraveyardIntoLibrary',
  // A discard is `millCards` aimed at the other hidden zone: cards move from a
  // hand to a graveyard, and an attack step sees the same board either way.
  // Listing them is not a claim that a discard spell is weak -- `counterSpell`
  // at the top of this list is the counter-example the whole list is named
  // after -- only that a spell built from nothing else changes no permanent.
  // `chooseDiscard` sits beside `discardCards` rather than beside `revealHand`
  // even though it reveals the hand first, because the reveal is the rider and
  // the discard is the sentence.
  'discardCards',
  'chooseDiscard',
  // The life block, all three of it. `loseLife` and `setLife` are here for
  // `gainLife`'s reason spelled the other way round: a life total is not a
  // permanent, and no arrangement of these two kills a creature or makes one.
  // Life loss is the pair `dealDamage` cannot be swapped for -- damage can
  // point at a body and this cannot -- so the kind that reads like burn is the
  // kind that is inert.
  //
  // `preventCombatDamage` is here on `counterSpell`'s terms rather than on
  // `gainLife`'s: it stops a change instead of making one, and a spell whose
  // whole text is a Fog resolves and leaves the board exactly as it found it.
  // That it saves a blocker is a fact about the attack it was held for, not
  // about the card, which is the same thing already true of a counterspell.
  'loseLife',
  'setLife',
  'preventCombatDamage',
  // `preventCombatDamage`'s reason exactly, aimed rather than blanket: shielding
  // a creature changes nothing about its controller, power, toughness or tapped
  // status, so the board a targeted prevention leaves behind is the board it
  // found, same as the Fog beside it.
  'preventAllDamageToTarget',
];

/** Effect primitives that can answer an opposing creature, before magnitudes. */
export const ANSWER_EFFECTS: readonly EffectKind[] = ['destroyPermanent', 'dealDamage'];

export function isInertEffect(kind: AnyEffectKind): boolean {
  return BATTLEFIELD_INERT_EFFECTS.includes(kind);
}

/**
 * A card that resolves and leaves: the only kind that can be inert.
 *
 * A permanent is on the battlefield by the time anyone could ask the question,
 * so "resolves without touching the battlefield" is a sentence about an instant
 * or a sorcery and about nothing else. Reading it off `kind !== 'creature'`
 * instead is what produced `ARCHETYPE_INERT_GLUT` against every artifact in The
 * flagship set, a Moonblade granting +4/+4 included: an artifact's
 * `effects` list is empty, and `[].every()` is vacuously true, so every
 * noncreature permanent in the set answered yes to a question it should never
 * have been asked.
 */
function resolvesAndLeaves(kind: Card['kind']): boolean {
  return kind === 'instant' || kind === 'sorcery';
}

/**
 * Everything a card does, effect by effect, wherever it is printed.
 *
 * A permanent has no effect list of its own — everything it does is printed
 * inside an ability (`packages/dsl/src/abilities.ts`) — so a reader that walks
 * only `card.effects` sees nothing on any creature or artifact in the set. That
 * is what produced `ARCHETYPE_SIGNPOST_OFF_PLAN` against nine of The Hidden
 * Kingdom's ten signposts at once: each of them prints `createToken` inside a
 * triggered ability, which is exactly what its archetype asked for, and the
 * check could not see any of it.
 *
 * The same hole opens for a modal spell (CR 700.2): its own effects live in
 * `card.modes`, one list per mode, and `card.effects` is empty by
 * construction. `cardOwnEffects` reads whichever the card actually populates.
 */
function allEffectKindsOf(card: Card): AnyEffectKind[] {
  return [
    ...cardOwnEffects(card).map((effect) => effect.kind),
    ...card.abilities.flatMap((ability) =>
      hasAbilityEffects(ability) ? ability.effects.map((effect) => effect.kind) : [],
    ),
  ];
}

/**
 * The same list narrowed to the kinds a *plan* can name.
 *
 * An archetype plan is built out of a brief's mechanics, and a mechanic names a
 * priced effect kind. A hand-authored card printing an unpriced primitive
 * therefore contributes nothing to any plan -- a different sentence from "the
 * engine cannot run it", which is why the narrowing is here and not in the DSL.
 *
 * It is the right list for `subjects` and the wrong one for the inert test, and
 * running both off it was a bug: dropping a kind before an `every` can only make
 * the answer more yes, so a card printing `exileTarget` and `drawCards` had its
 * removal half deleted and then reported as inert. `mtg-bc2.36`'s question was
 * measured against the flagship and no card in it trips this, so the fix lands
 * ahead of the card that would have needed it rather than behind.
 *
 * `mtg-q5yg` then priced `exileTarget`, which emptied the population that fix
 * was for. `mtg-n0to` refilled it: `putOnLibrary` and `searchLibrary` are live
 * and unpriced, so the two readings diverge on a tuck the way they once did on
 * an exile, and the divergence is now the permanent state rather than a gap
 * waiting to be closed. `archetype.test.ts` pins the consequence directly -- a
 * sorcery whose only effect is a tuck is not inert -- rather than asserting
 * that no such kind exists, which is the claim that just stopped being true.
 */
function plannedSubjectsOf(card: Card): EffectKind[] {
  return allEffectKindsOf(card).filter(isPricedEffectKind);
}

/** One card's worth of structure, from either a slot or a printed card. */
export interface Contribution {
  readonly slotId: string;
  /** Empty means colorless: playable in every pair. */
  readonly colors: readonly Color[];
  /** Cheapest and dearest mana value this contribution may occupy. */
  readonly manaValueMin: number;
  readonly manaValueMax: number;
  readonly creature: boolean;
  /** Can answer an opposing creature. */
  readonly removal: boolean;
  /** Resolves without touching the battlefield. */
  readonly inert: boolean;
  /** Color-pair keys this contribution was reserved to support. */
  readonly archetypes: readonly string[];
  readonly signpost: boolean;
  /** Keywords and effect kinds it carries, for payoff checks. */
  readonly subjects: readonly string[];
}

/**
 * The planned view. A slot is judged on what it *may* print: a slot allowed
 * `destroyPermanent` counts as removal here even though the card that fills it
 * might print the tap half of the same role. The card pass catches that, which
 * is the point of running both.
 *
 * `subjects` is the one place the two views cannot agree, and the asymmetry is
 * honest rather than an oversight. A slot allocated an ability kind does not
 * know which effects that ability will print — `abilityKinds` says `triggered`,
 * not `triggered, and it will make a token` — so the planned view reports the
 * keywords and effect kinds it was allocated and nothing else. The card pass is
 * where a printed ability's effects are read, and it is the pass whose verdict
 * gates a set.
 */
export function slotContribution(slot: Slot): Contribution {
  const spell = slot.cardKind !== 'creature';
  return {
    slotId: slot.id,
    colors: slot.color === null ? [] : [slot.color],
    manaValueMin: slot.manaValueMin,
    manaValueMax: slot.manaValueMax,
    creature: !spell,
    removal: spell && slot.effectKinds.some((kind) => ANSWER_EFFECTS.includes(kind)),
    // Same two corrections the card view takes, for the same reasons: a
    // permanent is not the kind of thing that can resolve without touching the
    // battlefield, and an empty list must not answer yes by vacuous truth.
    inert:
      resolvesAndLeaves(slot.cardKind) &&
      slot.effectKinds.length > 0 &&
      slot.effectKinds.every((kind) => isInertEffect(kind)),
    archetypes: slot.archetypes,
    signpost: slot.signpost,
    subjects: [...slot.keywords, ...slot.effectKinds],
  };
}

/**
 * The printed view. Removal reuses `@mtg/deckbuild`'s own predicate, so "this
 * card answers a creature" means exactly what it means to the builder whose
 * decks the balance sim measures — including its damage floor.
 */
export function cardContribution(slot: Slot, card: Card): Contribution {
  const manaValue = cardManaValue(card);
  const effectKinds = allEffectKindsOf(card);
  return {
    slotId: slot.id,
    colors: card.colors,
    manaValueMin: manaValue,
    manaValueMax: manaValue,
    creature: card.kind === 'creature',
    removal: isRemovalCard(card, DEFAULT_SCORE_WEIGHTS),
    // The non-empty guard is redundant today, because `CardSchema` gives an
    // instant and a sorcery at least one effect. It is here because the bug this
    // replaced was a vacuous `every` over an empty list, and a guard that says
    // so is cheaper than the next reader rediscovering it.
    inert:
      resolvesAndLeaves(card.kind) &&
      effectKinds.length > 0 &&
      effectKinds.every((kind) => isInertEffect(kind)),
    archetypes: slot.archetypes,
    signpost: slot.signpost,
    subjects: [...card.keywords, ...plannedSubjectsOf(card)],
  };
}

/** True when every color of the contribution is inside the pair. */
export function playableIn(contribution: Contribution, pair: readonly Color[]): boolean {
  return contribution.colors.every((color) => pair.includes(color));
}

/**
 * True when this contribution is the pair's *own*: castable there and nowhere
 * else among the ten archetypes.
 *
 * `playableIn` is the castability question and it is answered correctly — a
 * mono-white card really is playable in white-blue. It is the wrong question to
 * count a pair by, because the same card is equally playable in white-black,
 * white-red and white-green, and a colorless card is equally playable in all
 * ten. Counting them whole makes a pair's total a fact about the set's color
 * balance: with no gold cards every pair scores the same two mono-color piles
 * plus the same colorless pile, ten times, and the number cannot tell one
 * archetype from another no matter what the cards say.
 *
 * A card with two colors is castable in exactly one pair, and a card with three
 * or more is castable in none, so "castable here and in no other pair" is the
 * two-color case and this predicate is what a pair has that its rivals do not.
 */
export function exclusiveTo(contribution: Contribution, pair: readonly Color[]): boolean {
  return contribution.colors.length > 1 && playableIn(contribution, pair);
}
