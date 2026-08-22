/**
 * The pinned slice vocabulary.
 *
 * These literal tuples are the single source of truth for every enumerated
 * value in DSL v0. The kernel enforces exactly what this vocabulary can
 * express (the co-design invariant): nothing outside these lists is
 * generatable, transpilable, or playable.
 */
import { z } from 'zod';

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
export const ColorSchema = z.enum(COLORS);
export type Color = z.infer<typeof ColorSchema>;

/** Mana a source may add. `C` is colorless mana, never a generic cost. */
export const MANA_COLORS = [...COLORS, 'C'] as const;
export const ManaColorSchema = z.enum(MANA_COLORS);
export type ManaColor = z.infer<typeof ManaColorSchema>;

/** WUBRG print order; every color list the DSL emits is sorted by this. */
export const COLOR_ORDER: Readonly<Record<Color, number>> = { W: 0, U: 1, B: 2, R: 3, G: 4 };

export const COLOR_WORDS: Readonly<Record<Color, string>> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

export const KEYWORDS = [
  'flying',
  'vigilance',
  'haste',
  'trample',
  'deathtouch',
  'lifelink',
  'menace',
  'reach',
  'firstStrike',
] as const;
export const KeywordSchema = z.enum(KEYWORDS);
export type Keyword = z.infer<typeof KeywordSchema>;

/** Printed English for each keyword, lowercase; renderers capitalize as needed. */
export const KEYWORD_PRINT_NAMES: Readonly<Record<Keyword, string>> = {
  flying: 'flying',
  vigilance: 'vigilance',
  haste: 'haste',
  trample: 'trample',
  deathtouch: 'deathtouch',
  lifelink: 'lifelink',
  menace: 'menace',
  reach: 'reach',
  firstStrike: 'first strike',
};

/**
 * The six kinds of `card.ts`'s `KeywordAbility` — the keyword-shaped grants
 * whose rules consequences are wider than layer-6's flat evergreen
 * vocabulary above, so they carry their own printed line rather than joining
 * the comma-separated `KEYWORDS` one. This tuple does not derive
 * `KeywordAbilitySchema`, the way `KEYWORDS` derives `KeywordSchema` above:
 * `card.ts` is downstream of this file, so a schema built here would be a
 * schema for a type not yet declared. `exhaustive.ts`'s
 * `KeywordAbilityKindsCovered` is what keeps the two lists honest instead,
 * the same arrangement `STATIC_MODIFICATION_KINDS` already uses for
 * `StaticModification`, which lives one file away for the same reason.
 *
 * Every kind here needs a reminder the day a card can print it —
 * `reminder.ts`'s `ABILITY_LINE_REMINDER_TEXT` and `protectionLineReminder`
 * are where mtg-josx wrote the first five in, and `exhaustiveness.test.ts`
 * is what fails when a kind ships unreminded. `doubleStrike` is the sixth
 * and it arrived that way (`mtg-zd0y`).
 *
 * **`doubleStrike` is here rather than in `KEYWORDS`, and the reason is the
 * generator rather than the rules.** It is a flat layer-6 keyword in real
 * Magic, exactly the way `firstStrike` beside it is, and by rules alone it
 * belongs in the tuple above. What that tuple costs is a color-pie row in
 * `@mtg/design-data`, an entry in every total `Record<Keyword, …>` the deck
 * evaluator holds, and — the one that decides it — a changed model answer
 * schema and a changed fill prompt. `KeywordSchema` reaches the model through
 * `grantKeyword`, so 143 of the 151 recorded calls in
 * `packages/setgen/fixtures/llm/` carry the nine names inside their schema
 * and 144 carry them inside their prompt; the fixture key is
 * `sha256(system, prompt, schema)`, so a tenth name strands every one of them
 * and the bill is a live paid run. Nothing in `KEYWORD_ABILITY_KINDS` is
 * model-visible at all, which is why five keywords already live here and why
 * the sixth does too. Moving it up is a re-record, not an edit.
 */
export const KEYWORD_ABILITY_KINDS = [
  'defender',
  'landwalk',
  'hexproof',
  'indestructible',
  'protection',
  'doubleStrike',
] as const;

/**
 * The keyword abilities a `grantKeyword` modification may name, on top of the
 * nine evergreen `KEYWORDS` above.
 *
 * A printed static ability grants a keyword to somebody *else* — "Other Knight
 * creatures you control get +1/+1 and have indestructible" (M11's Knight
 * Exemplar) — and until `mtg-nhyv.74` the six kinds above could only be printed
 * by a card on itself, because the only field a `grantKeyword` record carries
 * is one name out of `KEYWORDS`. This tuple is the widening, and it is one
 * member rather than six because each of the other five costs something
 * specific:
 *
 *  - `landwalk` and `protection` carry a field of their own — a land type, a
 *    color or a subtype — and a `grantKeyword` record has room for exactly one
 *    name. Granting either is a modification of its own shape, which is what
 *    `card.ts`'s `grantLandwalk` already is.
 *  - `defender` is a drawback, and every evaluator downstream reads a granted
 *    keyword as value accruing to the grant's controller (`@mtg/deckbuild`'s
 *    `keywordValue`, `@mtg/sim`'s `grantKeywordScore`). A lord that handed out
 *    Defender would score as an upgrade, and the fix is a sign table in two
 *    packages rather than a name in this tuple.
 *  - `hexproof` costs only its rows in those two tables and a Forge spelling,
 *    and no card in the M11/M13 slice asks for it. It stays out until one does,
 *    exactly where `putCounters` sits.
 *
 * `doubleStrike` is the second member and it arrived the way the bullet above
 * says a name arrives: a card asked. M13's Cleaver Riot is "creatures you
 * control gain double strike until end of turn", and the whole card was
 * refusable on this enum — `grantKeywordUntilEndOfTurn` already carried the
 * scope, the kernel already ran both combat damage steps (`combat.ts` reads
 * `doubleStrike` at the first-strike check and again at the regular one), and
 * the missing word was this one. Adding it also widens the *printed* static
 * grant to "creatures you control have double strike", which is a real card
 * shape and costs nothing extra: both halves are one CR 613.1f layer-6 record.
 *
 * `exhaustive.ts`'s `GrantableKeywordAbilitiesAreParameterless` is what holds
 * the first bullet to a compile error rather than a convention: a kind added
 * here whose `KeywordAbility` carries a second field fails `npm run typecheck`.
 *
 * Nothing here is model-visible, and that is what makes a member cheap.
 * `ModelStaticModificationSchema` keeps the narrow `KeywordSchema`, and
 * `grantKeywordUntilEndOfTurn` is not inside `generatableEffects` at all, so it
 * reaches `ModelEffectSchema` no more than it reaches the static's. Measured
 * when `doubleStrike` landed: `grantKeywordUntilEndOfTurn` appears in 0 of the
 * 151 recorded calls under `packages/setgen/fixtures/llm/` and `doubleStrike`
 * in 0, so the 143 whose answer schema carries the nine names keep hashing to
 * what they always did and the bill for this tuple's second member is zero.
 */
export const GRANTABLE_KEYWORD_ABILITY_KINDS = ['indestructible', 'doubleStrike'] as const;

export type GrantableKeywordAbilityKind = (typeof GRANTABLE_KEYWORD_ABILITY_KINDS)[number];

/** Everything a `grantKeyword` modification may name: layer 6 plus the above. */
export const GRANTABLE_KEYWORDS = [...KEYWORDS, ...GRANTABLE_KEYWORD_ABILITY_KINDS] as const;
export const GrantableKeywordSchema = z.enum(GRANTABLE_KEYWORDS);
export type GrantableKeyword = z.infer<typeof GrantableKeywordSchema>;

/**
 * Printed English for everything grantable, lowercase, so one renderer prints
 * "have indestructible" from the same table it prints "have flying" from.
 * A second table rather than a widened `KEYWORD_PRINT_NAMES` because that one
 * is a total `Record<Keyword, string>` several callers rely on being exactly
 * the nine.
 */
export const GRANTABLE_KEYWORD_PRINT_NAMES: Readonly<Record<GrantableKeyword, string>> = {
  ...KEYWORD_PRINT_NAMES,
  indestructible: 'indestructible',
  doubleStrike: 'double strike',
};

/**
 * Which half of a permanent's characteristics a granted name lands in.
 *
 * One reader rather than a `KEYWORDS.includes` written out at each site: the
 * kernel splits `Characteristics.keywords` from `Characteristics.keywordAbilities`
 * (their rules consequences differ — the CR 704 sweep reads the second and
 * nothing else), so the decision is made once, here, and every downstream table
 * that prices or spells a grant asks the same question the layer walk asks.
 */
export function isGrantableKeywordAbilityKind(
  keyword: GrantableKeyword,
): keyword is GrantableKeywordAbilityKind {
  return (GRANTABLE_KEYWORD_ABILITY_KINDS as readonly string[]).includes(keyword);
}

/**
 * The effect kinds two tables outside this package are keyed by, and therefore
 * the tuple that cannot grow without their owners.
 *
 * `@mtg/design-data` builds `COLOR_PIE_SUBJECTS` as `[...KEYWORDS,
 * ...EFFECT_KINDS]` and its document schema *refuses to load* without a row per
 * subject, so a name added here is a package that throws on import until
 * somebody researches a sourced color-pie row for it. `@mtg/setgen`'s
 * `EFFECT_RANGES` is a total `Record<EffectKind, string>` of prompt text, so a
 * name added here is also a compile error in the fill prompt and a re-record of
 * every fixture keyed to it.
 *
 * Neither cost is about whether the kernel can run the effect, which is why
 * `UNPRICED_EFFECT_KINDS` below exists rather than this tuple simply growing.
 */
export const EFFECT_KINDS = [
  'dealDamage',
  'destroyPermanent',
  'pumpUntilEndOfTurn',
  'drawCards',
  'gainLife',
  'counterSpell',
  'createToken',
  'tapPermanent',
  'returnToHand',
  'millCards',
  'putCounters',
  /**
   * The three promoted by `mtg-q5yg`, appended in the order they were promoted.
   *
   * They were unpriced for one shared reason and it is recorded below: a pie row
   * and a prompt line, the second of which was believed to re-record every
   * fixture behind it. `mtg-fv5s` retired that half. A per-batch answer tier is
   * shown only to a batch whose slots name the new thing, and `vocabularySection`
   * has always printed a row only for a kind some slot in the batch offers, so a
   * batch that asks for none of this builds the bytes it always did — which
   * `answer-schema-freeze.test.ts` now checks rather than asserts in prose.
   *
   * What did not get cheaper is the pie row, and all three were paid for rather
   * than waived: `color-pie-2021.json` carries a designation line from the
   * source for each. `exileTarget`'s is inferred from the one entry the source
   * has for exiling a permanent on the battlefield, the way `destroyPermanent`'s
   * is inferred from 'Destroy target creature.'
   */
  'exileTarget',
  'scry',
  'returnFromGraveyard',
] as const;

/**
 * Effect kinds the kernel runs that no color-pie row prices and no prompt
 * describes.
 *
 * The split is a statement about two tables, not about the engine. Everything
 * that decides what an effect *does* — the schema union, `applyEffect`,
 * `renderEffect`, `legalTargetsFor`, the Forge mapping — is total over
 * `ALL_EFFECT_KINDS` and cannot tell the halves apart. What the halves decide
 * is whether the mechanical color pie has ruled on the kind and whether the
 * fill prompt has a range line for it. The first is research and the second was
 * believed to be a bill: a range line was thought to re-record every fixture
 * behind it, which made both questions a generation run's rather than a kernel
 * change's.
 *
 * Half of that is no longer true, and `mtg-q5yg` emptied the drawer down to one
 * member by acting on it. A range line is printed per *batch* — `EFFECT_RANGES`
 * is a table and `vocabularySection` prints a row only for a kind some slot in
 * the batch offers — and the answer schema is chosen per batch too, so the cost
 * of a promotion is borne by the batches that use it and by nothing else. What
 * survives is the research: `exileTarget`, `scry` and `returnFromGraveyard` each
 * moved up carrying a designation line from the source, and the one member left
 * here is the one no card wants yet rather than the one nobody researched.
 *
 * Nothing here is generatable. `MODEL_EFFECT_KINDS` is read off
 * `ModelEffectSchema`, which is built from the generatable halves alone, so the
 * exclusion is derived rather than asserted — and the wider
 * `ZoneReachingModelEffectSchema` a promoted kind reaches the model through is
 * still not this list, so promoting a kind and generating it stay two decisions.
 */
export const UNPRICED_EFFECT_KINDS = [
  /**
   * CR 701.16a's action, and the last of the four still waiting.
   *
   * The other three were promoted by `mtg-q5yg` once the per-batch tier made
   * the prompt line affordable; this one was left where it is, and the reason is
   * design rather than cost. A reveal is a rider. What it is a rider *to* — pick
   * one of the cards you just saw and exile it, or make its owner discard it —
   * needs a target kind that names a card in a hand, and no `TargetKind` does.
   * So the generatable form would be a spell whose whole text is "target
   * opponent reveals their hand", which is a blank the model would have to be
   * talked out of printing rather than one it could not print.
   *
   * It is also the one kind whose pie row would be free: the source's 'Looking
   * at opponent's hand' entry reads Primary blue / Secondary black, no
   * inference needed. The row is not written, because a row exists to price a
   * card somebody wants and nobody wants this one yet.
   */
  'revealHand',
  /**
   * CR 701.12's action, and the one member here that is unpriced for a third
   * reason: not cost, not missing research, but that the generator must not
   * reach it.
   *
   * A fight needs a creature body on the battlefield as its first fighter, so
   * it is legal only inside a triggered ability on a creature card, and
   * `RoleProfile.effectKinds` is `readonly EffectKind[]` — leaving it here
   * makes it unnameable in `ROLE_PROFILES` by the type system rather than by
   * discipline. That is the same containment `putCounters` has, arrived at from
   * the other direction: `putCounters` is absent from `ModelEffectSchema`, and
   * this is absent from that *and* from every slot menu that could ask for it.
   *
   * A pie row would not be free here and that is the smaller half of the
   * reason. Green's answer to a creature is a fight (Prey Upon, Epic Confront-
   * ation, Ram Through), and the row that would price it is `destroyPermanent`'s
   * — a row already flagged INFERRED because the primitive is coarser than the
   * canon. A second coarse row is not the way to give green removal; an
   * authored card is (`mtg-nz7r`).
   */
  'fight',
  /**
   * CR 605's mana ability, and the one member here that is unpriced because
   * the color pie has nothing to say about it.
   *
   * Every other kind in this vocabulary is a thing a spell does to the game;
   * this one is a thing that pays for spells. A pie row prices a card against
   * the five colors — "who gets to destroy a creature at common" — and mana
   * production is not a question of that shape: every color taps a land, green
   * and artifacts accelerate, and the rate is a curve decision made per set
   * rather than a color allowance. `EFFECT_RANGES` has the same problem in the
   * other direction: the range that matters is not "how many mana" but "on
   * what body, behind what cost", which is a slot's question.
   *
   * It is also the kind the generator most obviously must not reach. A mana
   * ability the model prints wrong is not a weak card, it is a broken format
   * — `{T}: Add {G}{G}{G}` on a one-drop is every game — and `checkAbilities`
   * cannot tell an accelerant from a mistake because telling them apart is a
   * question about the whole set's curve. So it stays hand-authored, exactly as `fight` does,
   * and for the same reason stated the other way round: `RoleProfile.effectKinds`
   * is `readonly EffectKind[]`, so leaving it here makes it unnameable in
   * `ROLE_PROFILES` by the type system rather than by discipline.
   */
  'addMana',
  /**
   * The library and graveyard vocabulary `mtg-n0to` added, appended as one
   * block in the order it was built.
   *
   * They are here rather than beside the priced halves for the reason the
   * docblock above gives, and for one more that is specific to them: a pie row
   * prices *an effect a card is built around*, and four of these five are
   * riders. A shuffle is what a search ends with, a reveal is what a look
   * begins with, a tuck is what a bounce becomes when the card should not come
   * straight back, and emptying a graveyard is a sideboard card's whole text.
   * Pricing a rider in the same table that prices `destroyPermanent` would put
   * a number on a clause rather than on a card.
   *
   * `searchLibrary` is the exception and it is unpriced for the opposite
   * reason: it is the most powerful primitive in this file — a tutor is a
   * consistency engine, and the color pie's ruling on one depends entirely on
   * what it may find. A row that priced "search your library" without the
   * filter would be a number that means nothing, and the filter is a card's
   * decision rather than a table's. It is also the one effect here that stops a
   * resolution to ask a question (`kernel/src/scry.ts`, named for the first
   * effect that had to pause one and now holding both), so admitting it to
   * the generator would hand the model a card whose cost is a decision space.
   */
  'shuffleLibrary',
  'revealTopCards',
  'putOnLibrary',
  'exileGraveyard',
  /**
   * The graveyard's other direction, unpriced for `searchLibrary`'s first
   * reason rather than its third: it stops no resolution and asks nobody
   * anything, but what it is worth is entirely a property of the deck around
   * it. A shuffle-back is a blank in a deck with no graveyard and the whole
   * engine in a deck built on one, and a single number in a pie row would be
   * wrong in both directions at once.
   */
  'shuffleGraveyardIntoLibrary',
  'searchLibrary',
  /**
   * The hand vocabulary `mtg-avg2` added, appended as one block: a discard the
   * hand's owner chooses, and a discard its opponent chooses after seeing it.
   *
   * They are here rather than beside the priced halves for the third reason
   * `searchLibrary`'s paragraph above states, and both of them have it: each
   * stops a resolution to ask a question, so admitting either to the generator
   * would hand the model a card whose cost is a decision space rather than a
   * number. The rider argument does not cover `discardCards` — Mind Rot is a
   * common in both M11 and M13 and is a card built around exactly this — and the
   * research argument might not either, but neither matters while the pause
   * does.
   *
   * `chooseDiscard` is `revealHand`'s missing second half, and its docblock
   * above names it exactly: "pick one of the cards you just saw and exile it, or
   * make its owner discard it — needs a target kind that names a card in a
   * hand, and no `TargetKind` does". This is that clause, and it is built the
   * way the reveal itself is rather than the way a target is: the card is named
   * by an `Action` the choosing seat submits mid-resolution, so no `TargetKind`
   * has to learn to name a card in a hidden zone and CR 115.1's targeting rules
   * are never involved. The blank `revealHand` would have printed as a generated
   * card is therefore still a blank, and the reason it stays unpriced is
   * unchanged.
   */
  'discardCards',
  'chooseDiscard',
  /**
   * The life vocabulary `mtg-vobp` added, appended as one block: life lost
   * without damage, a life total set outright, and a Fog.
   *
   * Unpriced, and each for a reason of its own rather than for one shared one.
   *
   * `loseLife` is the member the pie *does* rule on — draining is black's, and
   * the source's entry for it would write the row in an afternoon. It stays
   * here because of what the row would do to the generator rather than because
   * of what it would cost: life loss is `dealDamage` with every answer to
   * damage taken away. Protection, a prevention shield and an indestructible
   * blocker all sit between a burn spell and its work, and none of them sits
   * between a drain and its. So the two are not one effect priced twice, and a
   * model shown both at neighboring rates prints the strictly better half every
   * time. Pricing them apart is a set-design decision somebody has to make on
   * purpose; until somebody has, the generator is shown one of the pair.
   *
   * `setLife` is unpriced for `addMana`'s reason: the pie has nothing to say
   * about it. A row prices a card against the five colors, and a life total set
   * to seven is not a question of that shape — the same sentence is a gain at
   * three life and a loss at twenty, so its *sign* is not a property of the
   * card at all. `EFFECT_RANGES` fails on the same point from the other side:
   * the range that matters is not how large the number is but how it compares
   * to a life total nobody has read yet, which no range line can state.
   *
   * `preventCombatDamage` is unpriced because there is nothing here to price.
   * It is the one primitive in this file with no parameter and no target, so a
   * range line would have no range to name, and its whole worth is the moment
   * it is cast on — held for the right attack it is a removal spell, cast in a
   * main phase it is a blank, and neither number is a fact about the card. It
   * is also a kind the generator must not reach, for `addMana`'s sharper
   * reason: a set that prints Fog freely is a format where combat does not
   * resolve, and no per-card check can tell one Fog from six because that is a
   * question about the whole set.
   */
  'loseLife',
  'setLife',
  'preventCombatDamage',
  /**
   * The graveyard's other half, added by `mtg-7260`'s library-and-graveyard
   * lane: one named card leaves a graveyard, chosen by a player rather than by
   * a scope.
   *
   * `returnFromGraveyard` already reaches a graveyard and is the *mass* form —
   * `EFFECT_SCOPES` names a set of cards and the effect applies to every member
   * of it, which is Living Death and not Gravedigger. Every single-card
   * recursion M11 and M13 print is the other shape: Disentomb, Call to
   * Mind, Archaeomancer, Nature's Spiral, Revive, Gravedigger, Vile Rebirth.
   * All seven say *one* card and all seven leave the choosing to a player, and
   * neither half of that sentence is expressible by narrowing a scope.
   *
   * Unpriced for `searchLibrary`'s third reason, stated in its paragraph above
   * and true here word for word: it stops a resolution to ask a question, so
   * admitting it to the generator would hand the model a card whose cost is a
   * decision space rather than a number. The rider argument does not apply —
   * Disentomb's whole text is this clause — and the research argument would not
   * be hard to pay, since the source rules on graveyard recursion plainly
   * enough. The pause is what keeps it here, exactly as it keeps `discardCards`
   * here beside a Mind Rot the pie has no trouble pricing.
   *
   * **It is a choice and not a target, and that is a divergence worth naming.**
   * The printed cards read "target creature card in your graveyard", and a
   * graveyard is a public zone, so CR 115.1 genuinely does let one be targeted
   * — unlike a card in a library or a hand, where `searchLibrary` and
   * `chooseDiscard` use a mid-resolution decision because targeting a concealed
   * object is not a thing the rules allow at all. What the DSL lacks is the
   * word: no `TargetKind` names a card in a graveyard, `TARGET_KINDS` is a
   * frozen tuple two other lanes own, and widening it would have to teach
   * `legalTargetsFor`, the restriction checker and every bot's target policy
   * about an object that is not on the battlefield. So this reuses the
   * machinery that already exists for the concealed zones. What that costs is
   * one interaction: an opponent cannot make the choice illegal in response,
   * because the choice is not made until the effect resolves. In M11 and M13
   * the only cards that could have tried are Haunting Echoes and the
   * sacrificial artifact that exiles a whole graveyard (M13 219), and a set
   * that wants the interaction wants a target kind rather than a looser
   * primitive here.
   */
  'chooseFromGraveyard',

  /**
   * CR 615.1's other printed shape, aimed rather than blanket: "Until end of
   * turn, prevent all damage to target creature" (Dawn Charm's first mode).
   * `preventCombatDamage` above is the life block's Fog primitive and its own
   * docblock in `effects.ts` argues every widening away from it — amount,
   * recipient, the combat restriction. This is not that primitive grown a
   * field; it is the sibling CR 615 actually prints, so the two exist side by
   * side rather than one gaining a target parameter it was deliberately kept
   * without.
   *
   * Unpriced for the same reason `preventCombatDamage` is, sharpened: a
   * targeted, uncapped prevention is card advantage against exactly one
   * removal spell or one combat step, and which spell or which step is a
   * fact about the game state the model is never shown when it drafts a
   * card. A number here would be a number about a game the model cannot see.
   */
  'preventAllDamageToTarget',

  /**
   * CR 701.20a, the action `tapPermanent` has had a name for since the first
   * effect list and its counterpart has not.
   *
   * `effects.ts` argues the shape — why it is a kind and not a rider on the
   * tap, why its space is every permanent rather than every creature, and why
   * it leaves a `doesNotUntap` hold standing. What belongs here is the half
   * this tuple decides, and it is the one kind on this list that no research
   * would move: an untap has no price because its price is the board. The same
   * sentence is a ritual on a mana source, a Fog on a blocker, and nothing at
   * all on a permanent that was not tapped, and the model drafting a card is
   * shown no board. A pie row would have to name one of the three.
   */
  'untapPermanent',

  /**
   * CR 613.1f, layer 6, for one turn: the combat trick the DSL could print the
   * arithmetic of but never the ability.
   *
   * `effects.ts` argues why it is a resolved effect rather than a duration on
   * the `grantKeyword` modification beside it. What this tuple decides is the
   * price, and there is none, for the reason its neighbor `pumpUntilEndOfTurn`
   * has one: two points of power is a magnitude, and a keyword is not. Trample
   * on a 1/1 is worth nothing and on a 7/7 is worth the game; deathtouch is
   * worth almost nothing on a creature nobody blocks and a removal spell on one
   * everybody must; haste is worth a turn or worth zero depending on what else
   * is on the board. Every one of those readings is a fact about a board the
   * model drafting the card is never shown, so a per-unit row on the pie would
   * have to pick one of them and be wrong about the rest.
   */
  'grantKeywordUntilEndOfTurn',

  /**
   * CR 509.1b for one turn, applied by a resolving effect rather than printed
   * as a static: "target creature can't be blocked this turn."
   *
   * The restriction itself already exists as a `StaticModification`
   * (`cantBeBlocked`, `ability-shape.ts`), and this is not a second spelling of
   * it. That one is a property of a permanent for as long as the permanent is
   * there — Tormented Soul is unblockable in every combat of every turn — and
   * this one is a fact about *this* turn that a Goblin tapped to create. The
   * two differ in the field that matters, duration, and duration is not a field
   * on a `StaticModification`: `hasCombatModification` answers by re-reading
   * the printed ability off the battlefield every time it is asked, so there is
   * nowhere in that query for "and only until the end of this turn" to live.
   * The kernel therefore keeps the turn-scoped ones in their own array
   * (`state.turnCombatRules`), cleaned at CR 514.2 beside the layer-6 grants,
   * which is the same relationship `grantKeywordUntilEndOfTurn` two entries up
   * has with the printed `grantKeyword` modification.
   *
   * Unpriced and hand-authored for `grantKeywordUntilEndOfTurn`'s reason: what
   * unblockability is worth is a fact about the body it lands on and the board
   * it lands in, and the model drafting a card is shown neither.
   */
  'cantBeBlockedThisTurn',

  /**
   * CR 508.1d for one turn, with the defender named: "target creature attacks
   * you this turn if able."
   *
   * Alluring Siren's line, and the "you" is what makes it a member of its own
   * rather than a duration on `attacksEachCombatIfAble`. That modification is a
   * requirement to attack *something*, and the creature's controller still
   * picks which of the legal defenders — a planeswalker included. This one
   * names the player: the requirement is satisfied only by an attack aimed at
   * the controller of the ability that imposed it, so a lured creature cannot
   * be pointed at one of that player's own planeswalkers instead. The kernel
   * reads the player live off the imposing source rather than baking a
   * `PlayerId` in, for the reason `ObjectFilter.controllerIsSource` gives about
   * the same question one package over.
   *
   * No unconstrained sibling ("target creature attacks this turn if able",
   * Courtly Provocateur's first line) and no block-side one ("blocks this turn
   * if able", its second): each is a real printed card and neither is reachable
   * yet — the attack-side one only because nothing in this slice needs it
   * without the defender, and the block side because a requirement to block
   * has to be merged into the CR 509.1c joint maximum `legal.ts` computes for
   * `mustBeBlockedIfAble`, which is a lane rather than a member. A widening
   * arrives with the card that needs it, not before.
   */
  'attacksYouThisTurnIfAble',
  /**
   * CR 701.17: the source sacrifices itself. Arc Runner (M11 123) and Ball
   * Lightning print it under a step trigger; Fling and its kin print it as a
   * cost, which is a different thing entirely.
   *
   * **Three fields in this repository are spelled `sacrificeSelf` and this is
   * the only one that is an effect.** The other two are activation *costs*:
   * `ActivationCost.sacrificeSelf` (`ability-shape.ts`), a boolean printed
   * before the colon and paid on activation (CR 601.2h), and the same field
   * pinned to `true` inside `FuseAbilitySchema` (`effects.ts`). A reader who
   * takes this member for one of those will break the cost path, which does
   * not go through the effect union at all.
   *
   * Unpriced rather than priced, for `preventCombatDamage`'s reason: a member
   * of `EFFECT_KINDS` is a slot the fill prompt offers and a row
   * `@mtg/design-data`'s color pie and `@mtg/setgen`'s `EFFECT_RANGES` must
   * price. "Sacrifice this creature" is a drawback rather than a payload, and
   * a generator that could choose it would be a generator that could print a
   * card whose whole text is killing itself.
   */
  'sacrificeSelf',
  /**
   * CR 701.17a: the edict. Not the source, and not the caster's choice — the
   * target player sacrifices one of their own creatures, and which one is a
   * decision the kernel routes to that player (`@mtg/kernel`'s
   * `PendingPermanentSacrifice`, `mtg-4g77`).
   *
   * Unpriced for a different reason than `sacrificeSelf`'s: this one is not a
   * drawback riding on a creature's own ability, it is a removal spell's whole
   * payload, and a color-pie row for it would be earned research like
   * `exileTarget`'s. It stays out of `EFFECT_KINDS` because it stays out of
   * `generatableEffects()` entirely (`validate/effects.ts`'s `EFFECT_RULES`
   * entry says so directly): `mtg-4g77`'s containment cut kept this hand-
   * authored only, the same cut `discardCards` v. `chooseDiscard` draws
   * elsewhere, so no fill prompt reads a range line for it yet and no batch
   * pays the pie-row bill until one asks to print it.
   */
  'sacrificePermanent',
  /**
   * CR 613.4b: the target creature's base power and toughness *become* the
   * printed numbers until end of turn. Diminish (M11 52) is the whole reason
   * this kind exists, and the reason it cannot be spelled as a pump is the
   * layer: a delta applies in 7c over whatever 7b left behind, so "base 1/1"
   * on a 5/5 is not `-4/-4`, and the two spellings diverge the moment a second
   * effect touches the creature. A 5/5 given base 1/1 and then +2/+2 is 3/3;
   * the same board written as `-4/-4` plus `+2/+2` is also 3/3 by accident,
   * and a 5/5 given base 1/1 and a lord's +1/+1 while a `statBonusPer` static
   * counts something is not. `packages/kernel/test/base-pt-layer.test.ts`
   * measures the divergence rather than asserting the layer.
   *
   * Unpriced, for `sacrificePermanent`'s reason rather than `sacrificeSelf`'s:
   * a member of `EFFECT_KINDS` is a slot the fill prompt offers and a row
   * `@mtg/design-data`'s color pie and `@mtg/setgen`'s `EFFECT_RANGES` must
   * price, and nothing has asked the generator to print a characteristic-
   * setting spell. Hand-authored only keeps every model-facing schema byte-
   * identical, which is what keeps the recorded LLM fixtures keyed
   * (`sha256(system, prompt, schema)`) and costs nothing to ship.
   */
  'setBasePtUntilEndOfTurn',
] as const;

/** Every effect kind the engine can run. Appended to, never inserted into. */
export const ALL_EFFECT_KINDS = [...EFFECT_KINDS, ...UNPRICED_EFFECT_KINDS] as const;

/**
 * The enum a *brief* names an effect kind with, and deliberately the priced
 * tuple rather than all of them.
 *
 * A brief's mechanics and a slot's menu are instructions to the generator, so a
 * mechanic that named `exileTarget` would be a slot the model cannot answer.
 * The union a card's effect carries is `EffectSchema`'s discriminant, which is
 * total over `ALL_EFFECT_KINDS`; this schema is not that union and is not
 * trying to be.
 */
export const EffectKindSchema = z.enum(EFFECT_KINDS);

/**
 * Counter kinds are the one enumerated value this file does not own.
 *
 * Each kind carries a declaration of what it does, typed as
 * `StaticModification`, which lives in `abilities.ts`, which imports this file.
 * The table therefore lives in `counters.ts` and derives its own tuple, schema
 * and union from itself. `COUNTER_KINDS` is exported from the package index
 * alongside the tuples above.
 */

/**
 * Where a targeted effect may point.
 *
 * `targetCreatureYouControl` is appended rather than inserted, and the position
 * is the whole reason this tuple has a docblock. `z.enum` emits its members in
 * tuple order, `@mtg/setgen` hashes the JSON Schema it shows the model, and
 * `MODEL_TARGET_KINDS` below is this tuple's first four members in this order —
 * so appending leaves the bytes every recorded fixture was keyed against
 * untouched, and inserting would rename all of them.
 *
 * The fifth member is Fuse's printed text. the set design document
 * carried it as an owed row for as long as the vocabulary had no word for a
 * controller: a part that reads "target creature you control" and enforces
 * "target creature" says one thing and does another, in the kernel and in the
 * Forge export alike. It is legal on `putCounters` and on nothing else, which
 * is `LEGAL_TARGETS`' decision and follows the rule the rest of this file
 * follows — a widening arrives with the card that needs it, not before.
 *
 * The sixth is CR 115.4's other restriction, "target opponent". Every player-
 * naming row in `LEGAL_TARGETS` could say *a* player and none could say
 * *which*, so "target player draws two cards" is a card that helps whoever the
 * caster points it at, including the caster. In a two-player game the space has
 * exactly one member, so the enumeration does not grow and the kernel's only
 * new work is one case in each of the two places a target kind is read.
 */
export const TARGET_KINDS = [
  'anyTarget',
  'targetCreature',
  'targetPlayer',
  'noTarget',
  'targetCreatureYouControl',
  'targetOpponent',
  /** A retained trigger referent, not a target chosen under CR 115. */
  'triggeringCreature',
  /**
   * CR 506.2's defending player, one step in: the creatures they control.
   *
   * The eighth, appended for the same reason the fifth and sixth were. It is
   * legal only on a triggered ability whose condition is `selfAttacks`
   * (`checkTriggeredAbility`), and that restriction is what makes the phrase
   * mean something: "defending player" has no referent outside a combat this
   * source is attacking in, so a spell or an activated ability naming it would
   * print a word the board cannot answer. The validator refuses those rather
   * than leaving the kernel to discover it at resolution.
   */
  'targetCreatureDefendingPlayerControls',
  /**
   * The one board answer this vocabulary could not print: "target artifact or
   * enchantment".
   *
   * The ninth, appended for the reason the fifth through eighth were. Two role
   * profiles carried a `substitution:` note about its absence —
   * `removalArtifactEnchantment` printed a tap and `artifactDestructionModal`
   * collapsed to direct damage — so a set whose board held an artifact had
   * nothing that answered it, and every color's answer to a permanent was the
   * same three words.
   *
   * One kind rather than two, because the printed card is one card: Disenchant
   * and Naturalize both read "target artifact or enchantment", and 177 cards in
   * Forge's 2.0.14 `res/cardsfolder` write it as the single selector
   * `ValidTgts$ Artifact,Enchantment`. Splitting it into an artifact kind and an
   * enchantment kind would double every table keyed by `TargetKind` to express a
   * distinction no common-slot answer makes.
   */
  'targetArtifactOrEnchantment',
  /**
   * The exact complement of the fifth member: "target creature you don't
   * control".
   *
   * The tenth, appended for the reason the fifth through ninth were. It arrives
   * with `fight`, which is the card that needs it: a creature that fights on
   * arrival must name a creature it is not on the same side as, and every kind
   * above either says *a* creature or says the wrong side of the board.
   *
   * `targetCreatureDefendingPlayerControls` enumerates the same set in a
   * two-player game, and is not this. That kind is legal only inside an attack
   * trigger, because "defending player" has no referent outside a combat this
   * source is attacking in; this one is legal wherever a creature can be named.
   * The two differ in legality context rather than in membership, which is why
   * neither is the other spelled differently.
   *
   * Spelled after the printed card rather than after Forge's selector: Foe-Razer
   * Regent, Affectionate Indrik and Kogla all read "target creature you don't
   * control", and 158 cards in 2.0.14's `res/cardsfolder` write
   * `Creature.YouDontCtrl`. `targetOpponent` already owns the word "opponent"
   * in this tuple, for a player.
   */
  'targetCreatureYouDontControl',
  /**
   * "Target permanent", and the one kind in this tuple that names a space wider
   * than a single card type.
   *
   * The eleventh, appended for the reason the fifth through tenth were. It
   * arrives with `TargetFilterSchema` (`targets.ts`) and the two are one
   * decision: M11 and M13 print "destroy target land" (Craterize), "destroy
   * target artifact or land" (Demolish), "destroy target artifact,
   * enchantment, or land" (Acidic Slime) and "exile target black or red
   * permanent" (Celestial Purge), and a kind per printed selector would be four
   * more rows in every table keyed by `TargetKind` for four cards that differ
   * only in which types they admit. So the *space* is every permanent and the
   * filter says which of them, which is how the kernel has always written this
   * question (`ObjectFilter`, `@mtg/kernel`'s `continuous.ts`).
   *
   * `targetArtifactOrEnchantment` is not folded into it and is not a duplicate
   * of it either: that kind predates the filter, 177 cards in Forge 2.0.14's
   * `res/cardsfolder` write its selector as one string, and every committed
   * card that answers a permanent names it. `checkTargetFilter` refuses the
   * filter spelling of exactly that pair, so the two encodings cannot both be
   * written for one card.
   */
  'targetPermanent',
  /**
   * The current Oracle wording of every "target player" damage spell printed
   * before planeswalkers were folded into the damage rules: "target player or
   * planeswalker".
   *
   * The twelfth. It is a kind rather than a filter on `targetPlayer` because a
   * planeswalker is not a player — the slot draws from two spaces at once, the
   * way `anyTarget` does, and a filter narrows within one space rather than
   * unioning two. M13's Lava Axe and Chandra's Fury both read it, and neither
   * is expressible as `anyTarget` (which admits a creature) or as
   * `targetPlayer` (which prints a card that reads one way and plays another
   * against a board with a planeswalker on it).
   */
  'targetPlayerOrPlaneswalker',
  /**
   * "This creature" — the ability's own source, named without a choice.
   *
   * The thirteenth. CR 115.6a is explicit that an object referring to itself is
   * not targeting itself, so this kind carries none of `targetCreature`'s
   * apparatus: no restriction fits it and no filter narrows it, because
   * `TARGET_SPACES` gives it nothing to draw from — `triggeringCreature`'s own
   * entry is the precedent, and for the identical reason, CR 115 does not
   * target a self-reference either.
   *
   * It differs from that kind in *how* the referent is retained.
   * `triggeringCreature` is filled from the event that put the ability on the
   * stack (`TriggerContext`, which is `null` for an activation), so the DSL
   * admits it under exactly two trigger conditions. This kind is filled from
   * the ability's own `sourceOid`, which every ability on the stack carries
   * whether a trigger put it there or a player activated it — so the
   * permission it needs is a fact about the card, not about the condition:
   * `card.kind === 'creature'` (`validate/abilities.ts`), checked once for
   * both ability kinds instead of once per condition.
   *
   * M11's Fiery Hellhound ("{R}: This creature gets +1/+0 until end of turn.")
   * is an activated ability with no trigger to retain anything from; M13's
   * Griffin Protector ("Whenever Griffin Protector attacks, this creature gets
   * +1/+1 until end of turn.") prints the identical self-pump on a triggered
   * ability instead. One kind admits both because the retained fact is "the
   * source", not "the event" — confirmed against `reference-sets-v1.json`'s
   * Oracle text for both before this kind was added, not assumed from the
   * printed card.
   */
  'selfCreature',
  /**
   * "This permanent" — the same source the kind above names, with the creature
   * word taken out of the phrase and out of the permission.
   *
   * The fourteenth, appended for the reason the fifth through thirteenth were.
   * It arrives with the flagship set's Trisigil cycle (`mtg-rji`): three
   * `Legendary Artifact — Trisigil` cards, each of which puts a counter on
   * itself every upkeep until the third one lands. Before this member the
   * vocabulary could not print any of the three, and the gap was two
   * independent walls — `putCounters` named no kind that reaches the source at
   * all, and `selfCreature` is refused on a card that is not a creature
   * (`checkSelfCreatureTarget`) because the phrase it prints says "creature".
   *
   * It is a member rather than a widening of `selfCreature`, because the two
   * print different sentences and each sentence has to be true of the card
   * printing it. Widening that kind would have made "this creature" the
   * rendered text of an artifact's own ability, which is text and behavior
   * disagreeing — the one failure this vocabulary is written to refuse.
   *
   * What it needs that `selfCreature` needs too: an empty `TARGET_SPACES` row
   * (nothing is chosen, so nothing collides, and neither a restriction nor a
   * filter narrows it), a place in `SOURCE_BODY_ONLY_TARGETS` so a spell's own
   * effect list refuses it, and exclusion from `effectChoosesTarget` so CR
   * 603.3d never asks a trigger printing it for a target.
   *
   * What it does *not* need is the card-kind gate its sibling carries, and the
   * reason is a rule that was already there: `checkPlacement`
   * (`validate/abilities.ts`) refuses an ability on an instant or a sorcery,
   * so every card that can print this kind inside an ability is already a
   * permanent. The sibling's gate asserts something strictly narrower than
   * that — creature, not merely permanent — which is why it exists and why
   * this member has no analog of it.
   *
   * The kernel needed nothing at all. `planResolution` fills a source-body
   * slot from `StackEntry.ability.sourceOid` and `placeCounters` writes a
   * counter onto whatever object it is handed, neither of which ever asked
   * what card type the object is; the two walls were both in the validator.
   */
  'selfPermanent',
  /**
   * "That creature" — the object an earlier effect on this same card already
   * chose, named again rather than chosen a second time.
   *
   * The fifteenth, appended for the reason the fifth through fourteenth were,
   * and the first member of this tuple that refers to a *sibling slot*. Every
   * kind above it either names a space the caster picks from or retains a
   * referent from outside the effect list — the triggering event, the ability's
   * own source. This one reads what an earlier slot of this same list chose,
   * which is the one relationship the kernel could not express:
   * `targetChoicesForEffects` is an `effects.map`, so two `targetCreature`
   * slots on one card choose independently and the kernel enumerated a Stabbing
   * Pain (M11 #118, "Target creature gets -1/-1 until end of turn. Tap that
   * creature.") that shrinks one creature and taps a different one. That card
   * validated clean and played wrong, which is the exact failure this
   * vocabulary exists to refuse (`mtg-nhyv.75`).
   *
   * *Which* sibling is derived rather than written down: `referentSourceIndex`
   * (`effects.ts`) takes the one earlier slot that chooses from the space this
   * phrase needs, and `checkReferentTargets` refuses the card outright when
   * there is no such slot or more than one. An index field on `TargetSpec` was
   * the alternative and it is worse in both directions — a number in the JSON
   * that can point at a slot choosing nothing, and one more thing every
   * generated card has to get right — where a derived answer either has exactly
   * one reading or is refused.
   *
   * Forge writes this referent `Defined$ Targeted`: 1,188 lines across 1,025
   * cards in 2.0.14's `res/cardsfolder`, Stabbing Pain's own
   * `SVar:DBTap:DB$ Tap | Defined$ Targeted` among them. One word there for
   * both this kind and `thatPlayer` below, because Forge's referent carries no
   * type. This tuple splits them because the printed noun differs and
   * `targetNounPhrase` prints one fixed phrase per kind.
   */
  'thatCreature',
  /**
   * "That player" — the same back-reference one space over.
   *
   * The sixteenth. It is a separate member rather than a widening of the kind
   * above for the reason `selfPermanent` is separate from `selfCreature`: the
   * two print different nouns, and a noun printed on a card has to be true of
   * what the card does. The mechanism is shared down to the line —
   * `referentSourceIndex` asks for a player-naming earlier slot instead of a
   * creature-naming one, and every table below treats the two identically.
   *
   * Sign in Blood (M11 #117, M13 #110) is the card that needs it. Its printed
   * text is one sentence, "Target player draws two cards and loses 2 life", and
   * the DSL says it as two effects, so before this member the second effect
   * carried its own `targetPlayer` slot and the kernel offered a cast that drew
   * for one player and drained the other. Forge says the same thing this kind
   * says, with the same word it uses for `thatCreature`:
   * `SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 2 | Defined$ Targeted`.
   *
   * The rendered text is "Target player draws two cards. That player loses 2
   * life", which is not the printed card's wording and is deliberately not
   * chased. `renderEffectList` prints one sentence per effect, and a DSL card
   * prints its own oracle text rather than a reproduction of a real printing —
   * what the member fixes is the kernel offering two different people.
   */
  'thatPlayer',
  /**
   * "That creature's controller" — a *player* derived from an object an earlier
   * slot chose, and the only kind in this tuple that changes space between what
   * was chosen and what is named.
   *
   * The seventeenth, and the one the whole burn-plus-drain template wants.
   * Chandra's Outrage (M11 #128) reads "deals 4 damage to target creature and 2
   * damage to that creature's controller", and before this member the second
   * half was written `targetPlayer` — a slot the caster aims, so the kernel
   * offered a cast that burned the opponent's creature and then dealt the 2 to
   * the caster's opponent or to the caster, whichever the enumeration produced.
   * With one creature on the board the kernel offered two option-sets where the
   * card has one.
   *
   * It is not `thatCreature` with a projection applied at the effect, because
   * the effect must not have to know: `dealDamage` takes a `Target` and CR
   * 120.3 lets that be a player or an object, so the projection belongs where
   * the referent is filled (`planResolution`, `@mtg/kernel`) and the effect
   * arms stay untouched. Doing it the other way would put "read the controller
   * off this object" into every primitive that can name a player.
   *
   * Forge agrees that this is its own referent rather than a modifier on the
   * first: `Defined$ TargetedController`, 175 lines across 167 cards in
   * 2.0.14's `res/cardsfolder`, and Chandra's Outrage's own second line is
   * `SVar:DBDealDamage:DB$ DealDamage | Defined$ TargetedController | NumDmg$ 2`.
   */
  'thatCreaturesController',
] as const;
export const TargetKindSchema = z.enum(TARGET_KINDS);

/**
 * The combat status a target filter may name (CR 506.4, CR 509.1).
 *
 * Three members rather than two, because "attacking or blocking" is one printed
 * selector and not a disjunction a card assembles: Divine Verdict reads
 * "destroy target attacking or blocking creature" and Forge writes it as the
 * single qualifier `attacking,blocking`. Encoding it as two filters would need
 * a filter field that is a *list* of statuses, and a list admits
 * `['attacking', 'attacking']` and `[]`, which are a second spelling of one
 * status and a second spelling of no constraint.
 *
 * A combat status is not a characteristic (CR 506.4 makes it a property of the
 * combat, not of the object), which is why `matchesFilter` cannot answer it and
 * `@mtg/kernel`'s `target-filter.ts` reads `state.combat` beside the
 * characteristics half.
 */
export const TARGET_COMBAT_ROLES = ['attacking', 'blocking', 'attackingOrBlocking'] as const;
export const TargetCombatRoleSchema = z.enum(TARGET_COMBAT_ROLES);
export type TargetCombatRole = z.infer<typeof TargetCombatRoleSchema>;

/**
 * The target kinds the set generator may choose from, frozen at the four this
 * tuple held before the fifth arrived.
 *
 * Written out rather than sliced off `TARGET_KINDS`, because the freeze is the
 * point and a slice would follow the tuple it exists to stop following.
 * `ModelTargetKindsAreTargetKinds` (`exhaustive.ts`) proves the containment at
 * compile time, so a typo here is a build failure rather than a generated card
 * naming a kind the engine has never heard of.
 *
 * A generated card therefore prints "target creature" where a hand-written one
 * may print "target creature you control". The generator reaches the fifth kind
 * in exactly one place, and not by choosing it: a part token's Fuse ability
 * names it as a literal, because which creature a part may be fused onto is the
 * mechanic rather than a design decision (`FuseAbilitySchema`, `effects.ts`).
 */
export const MODEL_TARGET_KINDS = ['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget'] as const;
export const ModelTargetKindSchema = z.enum(MODEL_TARGET_KINDS);

/**
 * CR 113 ability kinds the DSL can express.
 *
 * Three members, and they arrived one commit apart on purpose.
 * `AbilityKindsCovered` (`exhaustive.ts`) and the kernel's `assertNever` over
 * `Ability['kind']` are what keep the generator's output space equal to the
 * engine's enforceable space, and they only do that if this tuple and the
 * schema union grow together — one kind per commit. This slice is the widest
 * point of `mtg-bc2.132`: the DSL can now say every shape the kernel can run.
 *
 * The order is the printed order: a static ability describes the permanent, a
 * trigger waits on it, and an activated ability prints last because it is the
 * one line the player has to pay for. `sortAbilities` keys the fingerprints on
 * this tuple's index, so a kind is appended rather than inserted: a card
 * printed before this commit hashes after it exactly as it did before.
 */
export const ABILITY_KINDS = ['static', 'triggered', 'activated'] as const;
export const AbilityKindSchema = z.enum(ABILITY_KINDS);
export type AbilityKind = z.infer<typeof AbilityKindSchema>;

/**
 * Which permanents a static ability reaches. Compiles to one kernel
 * `ObjectFilter`; scopes that reach an opponent's permanents, or noncreature
 * permanents, are deliberately outside DSL v1.
 */
export const STATIC_SCOPES = ['self', 'creaturesYouControl', 'otherCreaturesYouControl'] as const;
export const StaticScopeSchema = z.enum(STATIC_SCOPES);
export type StaticScope = z.infer<typeof StaticScopeSchema>;

/**
 * Which permanents a **one-shot** effect reaches when it reaches more than one.
 *
 * A separate tuple from `STATIC_SCOPES` rather than a widening of it, and the
 * reason is that the two words are evaluated at different moments and by
 * different machinery. A static scope is re-evaluated continuously by the CR
 * 613 layer walk; a one-shot scope is evaluated once, as the spell resolves,
 * and CR 609.2 then fixes the set for the rest of the resolution. The members
 * that make sense are not the same either — `self` is meaningless on a sorcery
 * and this tuple's member is meaningless on an anthem — so two tuples keep both
 * exhaustive switches total, which is the only thing that makes them worth
 * having.
 *
 * The first three members read their player off the effect's own target, which
 * is why the card that needed this needed `targetOpponent` first. That also
 * settles CR 115.1: the *player* is targeted and the objects are not, so the
 * enumeration still offers one choice per effect and an object that arrives
 * mid-resolution is not in the set.
 *
 * The second member is the one that made this a vocabulary rather than a flag.
 * `creaturesThatPlayerControls` says *which* objects and the battlefield is
 * assumed; `creatureCardsInPlayerHand` has to say *where* as well, because a
 * hand is a different zone with different contents and a different word for
 * what lives there — permanents on one side, cards on the other. Every reader
 * asks the scope for both halves rather than assuming the battlefield.
 *
 * The third member is the hand member's own reasoning applied to a graveyard:
 * CR 613 does not reach there either (CR 611.2c), so `creatureCardsInPlayerGraveyard`
 * reads printed values exactly as the hand scope does — `@mtg/kernel`'s
 * `zone-filter.ts` is what both could share, and only the graveyard arm is
 * wired up there today.
 *
 * The last three are the **untargeted** half, appended by `mtg-9u18` for the
 * sweepers M11 and M13 actually print. M11's four-mana white wrath, Pyroclasm,
 * Planar Cleansing, Back to Nature, Trumpet Blast, Rain of Blades, Glorious
 * Charge, Inspired Charge and Cower in Fear say a region of the board and no
 * player at all, and none of the three members above can hold one: each of those reads a
 * targeted player, and "destroy all creatures" targets nobody. So a scope names
 * a *space* and the objects inside it are chosen by a `scopeFilter`
 * (`effects.ts`) rather than by the scope word — which is why these three say
 * "permanents" where the three above say "creatures". The card type is the
 * filter's to say, and it has to be, because the nine cards above name four
 * different ones between them.
 *
 * Appended rather than inserted, and named rather than expressed as
 * "creaturesThatPlayerControls with a filter", because the subject differs:
 * `EFFECT_SCOPE_SUBJECT` below is the whole of that distinction and every
 * reader consults it instead of re-deriving it from the member's spelling.
 *
 * `permanentsOpponentsControl` is plural because that is what Magic prints
 * (Cower in Fear), and it reduces to the one opponent in this two-player
 * kernel; `@mtg/kernel`'s `opponentOf` is where the reduction happens, so a
 * kernel that ever seats three players changes there and not here.
 */
export const EFFECT_SCOPES = [
  'creaturesThatPlayerControls',
  'creatureCardsInPlayerHand',
  'creatureCardsInPlayerGraveyard',
  'allPermanents',
  'permanentsYouControl',
  'permanentsOpponentsControl',
] as const;
export const EffectScopeSchema = z.enum(EFFECT_SCOPES);
export type EffectScope = z.infer<typeof EffectScopeSchema>;

/**
 * Whom a one-shot scope reads its group off: the player the effect targeted, or
 * the player resolving it.
 *
 * The two words a card prints for a group differ in exactly this and in nothing
 * else. "All creatures target player controls" names a player, chooses it, and
 * the group falls out of the choice; "destroy all creatures" chooses nothing
 * (CR 115.1) and the group is a region of the board read as the spell resolves.
 * A validator that let the two mix would admit "destroy all creatures target
 * player controls" printed with no target slot, and a resolution that guessed
 * would sweep whichever board it happened to find.
 *
 * A total record rather than a predicate over the member's spelling, so a scope
 * appended tomorrow has to answer the question rather than inherit an answer
 * from how it was named. `checkEffectScope` (`validate/effects.ts`), the
 * renderer and `@mtg/kernel`'s `scopedGroup` all read this one table.
 */
export type EffectScopeSubject = 'targetedPlayer' | 'resolvingController';

export const EFFECT_SCOPE_SUBJECT = {
  creaturesThatPlayerControls: 'targetedPlayer',
  creatureCardsInPlayerHand: 'targetedPlayer',
  creatureCardsInPlayerGraveyard: 'targetedPlayer',
  allPermanents: 'resolvingController',
  permanentsYouControl: 'resolvingController',
  permanentsOpponentsControl: 'resolvingController',
} as const satisfies Readonly<Record<EffectScope, EffectScopeSubject>>;

/**
 * The two halves of `EFFECT_SCOPES`, as types, read off the table above rather
 * than spelled out a second time.
 *
 * A consumer that can only handle one half says so in its signature and gets
 * the other half refused at compile time — `@mtg/forge-export`'s zone-move
 * tables are keyed `TargetedPlayerScope`, because `ChangeZoneAll` needs an
 * `Origin$` and a space scope has no zone to name. Written as a mapped type
 * over the const table so that appending a scope to `EFFECT_SCOPES` and
 * answering the subject question puts it in exactly one of these two, and every
 * table keyed by them fails to compile until it says what the new member does.
 * That is the whole reason the table above is `as const satisfies` rather than
 * annotated: an annotation would widen every value to `EffectScopeSubject` and
 * these two would both come out `never`.
 */
export type ScopesWithSubject<S extends EffectScopeSubject> = {
  [K in EffectScope]: (typeof EFFECT_SCOPE_SUBJECT)[K] extends S ? K : never;
}[EffectScope];

export type TargetedPlayerScope = ScopesWithSubject<'targetedPlayer'>;
export type SpaceScope = ScopesWithSubject<'resolvingController'>;

/**
 * The narrowing the type above describes, at run time.
 *
 * TypeScript does not narrow a key from a lookup into its own table, so a
 * caller holding an `EffectScope` and needing a `SpaceScope` needs this
 * predicate rather than a comparison. It reads the same table the type is
 * derived from, so the two cannot disagree.
 */
export function isSpaceScope(scope: EffectScope): scope is SpaceScope {
  return EFFECT_SCOPE_SUBJECT[scope] === 'resolvingController';
}

/**
 * Which players an untargeted effect reaches when it reaches more than one.
 *
 * Two members, because two *sets of seats* are what the population names.
 * `eachPlayer` is "each player draws a card" (Temple Bell, M11 217; Jace
 * Beleren's +2, M11 58) and "each player loses 3 life" (Howling Banshee, M11
 * 100); `eachOpponent` is "each opponent discards a card" (Liliana's Specter,
 * M11 104). Neither is an `EffectScope` — that vocabulary names *objects* and
 * every reader of it asks which zone and which bodies — and neither is a
 * `TargetKind` either, because "each player" chooses nothing (CR 115.1) and a
 * target kind is a choice the kernel has to enumerate and record.
 *
 * A tuple rather than a boolean for `PT_COUNT_SOURCES`' reason, and the second
 * member is why: "each opponent" is a different set and not the negation of
 * the first, so a flag would have had to be renamed to admit it. It is also
 * not `targetOpponent` spelled loosely. This kernel seats two players, so the
 * two phrases pick out the same seat, and they are still different cards —
 * a target is chosen (CR 115.1), so hexproof answers it and CR 608.2b takes
 * the whole ability when the chosen seat stops being legal; a scope chooses
 * nothing, so neither happens. Ravenous Rats (M13 106) prints the targeted
 * twin of the Specter's line in the same corpus, and giving two printed
 * identities one DSL sentence is what this member exists to avoid.
 *
 * `GRAVEYARD_OWNERS` (`effects.ts`) is the same shape one field over — an
 * untargeted "whose", resolved against the effect's own controller.
 */
export const PLAYER_SCOPES = ['eachPlayer', 'eachOpponent'] as const;
export const PlayerScopeSchema = z.enum(PLAYER_SCOPES);
export type PlayerScope = z.infer<typeof PlayerScopeSchema>;

/**
 * What a static ability does: P/T (CR 613.4c, layer 7c), a keyword (CR 613.1f,
 * layer 6), a characteristic-defining P/T (CR 613.4a, layer 7a), one of the
 * two doublers, or one of the six combat restrictions `mtg-t3ik` appended.
 *
 * The first three are layers, and for as long as they were the only members
 * this tuple could say so: each compiles to one `ContinuousEffect` and the
 * CR 613 walk resolves it. The two appended by `mtg-vobp` are not layers and
 * are not modifications of anything in a scope — CR 614 replacement effects
 * change an event before it happens, which the layer system never sees. They
 * live here anyway because a static ability is exactly where Magic prints them
 * (Furnace of Rath, Rhox Faithmender) and because the alternative was a fourth
 * ability kind whose only difference from `static` is which kernel array it
 * registers into. `packages/kernel/src/static-replacements.ts` is that array's
 * registration, written beside `registerStatics` rather than inside it for the
 * reason `cost.ts` gives about the same seam.
 *
 * Two members rather than one carrying an event name, because every consumer
 * of this tuple would have had to switch on that name anyway: the sentence, the
 * Forge form, the replaced event and the price all differ between them, so a
 * shared member would have bought one arm and paid for it with an inner switch
 * in each.
 *
 * `cantAttack`, `cantBlock` and `cantBeBlocked` already existed as
 * `AuraModification`s (`card.ts`) — Pacifism's whole shape is "this
 * restriction, attached to something", queried live off the attachment
 * relation. M11/M13 needed the same three restrictions printed directly on a
 * creature's own static, with no Aura anywhere on the board, so `mtg-t3ik`
 * widened this tuple with the same three kinds a second way and gave the
 * kernel a second live query, over printed statics instead of the attachment
 * relation (`packages/kernel/src/combat.ts`'s `hasCombatModification`). Also
 * hand-authored is `attacksEachCombatIfAble` (CR 508.1d), `mustBeBlockedIfAble`
 * (CR 509.1c) and `blockOnlyCreaturesWithKeyword` (CR 509.1b's own worked
 * example is "this creature can block only creatures with flying").
 * `cantBeBlockedBySubtype` (`mtg-nhyv.57`) is the seventh, Juggernaut's "can't
 * be blocked by Walls", and it is the one CR 509.1b restriction whose second
 * permanent no scope on this ability can reach — `ability-shape.ts` argues why
 * it carries a field where five of its neighbors do not. None of the seven
 * compiles to a `ContinuousEffect` — none changes a printed characteristic, so
 * there is no layer to put it in — and none is a CR 614 replacement either, so
 * `classifyStaticModification` (`static-modification-class.ts`) sorts all seven
 * into a third class, `'combat'`, that the kernel's attack- and
 * block-declaration legality reads directly rather than through the layer walk
 * or `state.replacements`.
 *
 * Hand-authored only, deliberately absent from `ModelStaticModificationSchema`
 * (`ability-shape.ts`): the containment invariant is that the generator's
 * output space stays inside the engine's, and a set whose generator could
 * print "this creature must be blocked if able" on every rare would print a
 * format where combat math stops being the player's decision, exactly the
 * failure mode `doubleDamage`/`doubleLifeGain` are kept off that schema for.
 */
export const STATIC_MODIFICATION_KINDS = [
  'statBonus',
  'grantKeyword',
  'definePt',
  'statBonusPer',
  'doubleDamage',
  'doubleLifeGain',
  'cantAttack',
  'cantBlock',
  'cantBeBlocked',
  'attacksEachCombatIfAble',
  'mustBeBlockedIfAble',
  'blockOnlyCreaturesWithKeyword',
  'cantBeBlockedBySubtype',
] as const;
export const StaticModificationKindSchema = z.enum(STATIC_MODIFICATION_KINDS);
export type StaticModificationKind = z.infer<typeof StaticModificationKindSchema>;

/**
 * What a characteristic-defining P/T (CR 613.4a) counts.
 *
 * One member, the shape Tarmogoyf needs — "the number of card types among
 * cards in all graveyards" — a *distinct-value* count read from printed
 * cards, not a battlefield `ObjectFilter` cardinality. A widening arrives
 * with the card that needs it, not before, the same discipline
 * `EFFECT_SCOPES` states for its own third member: a self-referential
 * battlefield CDA ("this creature's power equals the number of Zombies you
 * control") is a real card too, but nothing in this slice prints one yet, so
 * it stays out until one does.
 */
export const PT_COUNT_SOURCES = ['graveyardCardTypesEach'] as const;
export const PtCountSourceSchema = z.enum(PT_COUNT_SOURCES);
export type PtCountSource = z.infer<typeof PtCountSourceSchema>;

/** Printed English for what a `PtCountSource` counts; `oracle.ts` reads this. */
export const PT_COUNT_PRINT_TEXT: Readonly<Record<PtCountSource, string>> = {
  graveyardCardTypesEach: 'the number of card types among cards in all graveyards',
};

/**
 * CR 603 trigger conditions: what a printed trigger watches for.
 *
 * The first three watch the source itself. The rest scan a board or an event
 * that is not the source's own arrival, attack or death — a step beginning,
 * another permanent's arrival, a spell being cast, combat damage to a player,
 * a block being declared, life being gained. Every member is answered by an
 * event the kernel already emits: `permanentEntered`, `zoneChanged` out of the
 * battlefield, `attackersDeclared`, `stepBegan`, `spellCast`, `damageDealt`,
 * `blockersDeclared` and `lifeChanged` (`packages/kernel/src/triggers.ts`
 * names which event answers which condition).
 *
 * Several conditions come in a broad member and a narrower filtered sibling —
 * "another permanent enters" beside "another creature enters", "you cast a
 * spell" beside "you cast an instant or sorcery" — because the tuple is a flat
 * string enum with no structured filter field: `abilitiesOver`'s condition
 * parameter is a bare `ZodType` over string literals (`ability-shape.ts`), so
 * a filter is a second named member rather than a payload on the first. That
 * is the choice `selfDies` / `selfDiesNotSacrificed` already made, not a new
 * one.
 */
export const TRIGGER_CONDITIONS = [
  'selfEnters',
  'selfAttacks',
  'selfDies',
  'controlledCreatureAttacksAlone',
  /** CR 603.6b: the beginning of your upkeep step. */
  'beginningOfYourUpkeep',
  /** CR 603.6b: the beginning of your end step. */
  'beginningOfYourEndStep',
  /**
   * CR 603.6e: another permanent you control enters the battlefield.
   *
   * "Another" is the id comparison `conditionsFrom` already needs for every
   * scan-the-board condition (the source is never the entering permanent
   * itself), and CR 603.6e is explicit that simultaneous arrivals still see
   * each other — a token doubling spell that makes two tokens at once still
   * fires this on both, which is why the exclusion is by id and not by "was
   * anything else already on the battlefield".
   */
  'anotherControlledPermanentEnters',
  /**
   * The creature-filtered sibling of `anotherControlledPermanentEnters`. Most
   * printed cards asking "another creature enters" mean exactly that and not
   * "another permanent", so the narrower member exists for the same reason
   * `selfDiesNotSacrificed` exists beside `selfDies`: a filter a card actually
   * wants, named rather than left unreachable.
   */
  'anotherControlledCreatureEnters',
  /** CR 601.2i: you cast a spell, of any kind. */
  'youCastSpell',
  /**
   * The instant/sorcery-filtered sibling of `youCastSpell`, for the "whenever
   * you cast an instant or sorcery spell" cards a creature or enchantment
   * prints far more often than the unfiltered version.
   */
  'youCastInstantOrSorcery',
  /**
   * CR 510.1c: the source dealt combat damage, and a player took it.
   *
   * The player-recipient half of what `selfDealsCombatDamageToCreature`
   * already narrows `damageDealt` down to; the two are siblings on the same
   * event rather than one condition with a recipient filter, for the same
   * reason every other pair in this tuple is two members. Unlike the creature
   * arm, a damaged player is not a retained referent: none of the effects this
   * slice expresses target "the player this creature just hit", so
   * `triggeringOid` stays absent here and `TriggerContextKind` stays
   * unwidened.
   */
  'selfDealsCombatDamageToPlayer',
  /**
   * CR 509.1h / CR 603.6: the source was declared as a blocker.
   *
   * `blockersDeclared` carries the whole set of blocks in one event
   * (`packages/kernel/src/events.ts`), one entry per attacker with its
   * assigned blockers, so the source's id has to be searched for inside every
   * block's blocker list rather than read off a single field the way
   * `selfAttacks` reads `attack.oid`.
   */
  'selfBlocks',
  /**
   * CR 119.3 / CR 702.15e: the controller gained life, lifelink included.
   *
   * `damage.ts`'s `gainLife` is the single function that ever emits
   * `lifeChanged` with a positive delta, under `reason: 'gainLife'` or
   * `reason: 'lifelink'` — the two are one trigger condition, not two, because
   * CR 702.15e already settled that lifelink is a way of gaining life and not
   * a kind of its own. Every function that takes life away reports a reason
   * this member is not — `damage.ts`'s own life-loss half reports `'damage'`
   * and `life.ts`'s `loseLife` reports `'lifeLoss'` — so no negative-delta
   * event answers it. A life total *set* upward is not the exception it looks
   * like: CR 118.5 says the player gains the difference, so `setLife` routes
   * through `gainLife` and this trigger fires, which is what the printed cards
   * do.
   */
  'youGainLife',
  /**
   * CR 701.17b: dying, but not by having been sacrificed.
   *
   * A trigger condition rather than a `Condition`, and the choice is the whole
   * reason this member has a docblock. `Condition` (`condition.ts`) asks the
   * board a question — how many Merfolk do you control — and is re-asked
   * continuously by the layer walk. "It wasn't sacrificed" is not a question
   * about the board at all: nothing on any battlefield, in any graveyard, at
   * any moment, distinguishes a creature that was destroyed from one its
   * controller ate. It is a question about *how the event that fired this
   * trigger happened*, and a trigger condition is already exactly that — the
   * tuple's other members name events too, and `controlledCreatureAttacksAlone`
   * is already a compound event description rather than a bare one. Putting it
   * on `Condition` would also have asked every one of `Condition`'s
   * `switch`/`assertNever` readers (`condition.ts` names all five) to grow a
   * dispatch case they do not need for it.
   *
   * Hand-authored only: it is deliberately absent from
   * `MODEL_TRIGGER_CONDITIONS`, so the generator's space stays inside the
   * engine's. The card that asked for it is the flagship set's Gloom Hands,
   * whose token must not be payable by sacrificing it.
   */
  'selfDiesNotSacrificed',
  /**
   * CR 510.1: the source dealt combat damage, and a creature took it.
   *
   * A trigger condition rather than a `Condition` for the same reason
   * `selfDiesNotSacrificed` is one, and the reason is sharper here. `Condition`
   * asks the board a standing question and is re-asked by every layer walk; no
   * standing question about any board distinguishes a creature that took two
   * damage in combat from one that took two off a burn spell. Damage marked on
   * a permanent records an amount, not a cause, and by the time anything could
   * read it the combat damage step has ended. The cause is a property of the
   * event, and a trigger condition is a description of an event — the tuple's
   * other members already name compound ones.
   *
   * The damaged creature is the referent, and it is the *existing*
   * `triggeringCreature` target kind rather than a second one: a retained
   * referent from the triggering event is exactly what that kind already means,
   * and CR 115 does not target it here either. `packages/kernel/src/triggers.ts`
   * reads it off the `damageDealt` event's recipient.
   *
   * Hand-authored only: deliberately absent from `MODEL_TRIGGER_CONDITIONS`, so
   * the generator's output space stays inside the engine's enforceable space.
   * The generator has no way to name the referent — `MODEL_TARGET_KINDS` does
   * not carry `triggeringCreature` — so a condition it could print would be a
   * trigger it could not aim.
   *
   * the flagship set's Gloom N is the ability word on it (`gloomAbility`),
   * Toxic's shape with the counters landing on the creature rather than on a
   * player. The condition stays shared rather than reserved, the way Flurry
   * rush's below is: the set's white-green legend grows himself off the same
   * event, and only the exact envelope earns the word.
   */
  'selfDealsCombatDamageToCreature',
  /**
   * CR 509.1a / CR 509.1h, both halves of one block, filtered by power: the
   * source blocked a creature with greater power, or a creature with greater
   * power blocked it.
   *
   * the flagship set's Flurry rush is the mechanic that asked for it, and the
   * design intent is the whole reason the two halves are one condition rather
   * than two: the ability word rewards winning a combat through timing rather
   * than through raw size, so it has to read the *pairing* — this creature and
   * a bigger one, whichever of them chose the fight. A card printing only the
   * blocking half would go blank the moment its controller stopped attacking
   * into it, which is exactly the board state the mechanic exists to make
   * interesting.
   *
   * "Greater power" is compared once, when blockers are declared, against the
   * characteristics both creatures have at that moment — a pump spell cast
   * afterward in the declare-blockers step does not retroactively fire or unfire
   * it, the same way CR 509.1a's own legality checks are made at declaration.
   * The comparison is strict: an equal-power blocker is not greater, which is
   * what keeps a 3/3 from triggering off another 3/3.
   *
   * One trigger per qualifying creature, not per block. A double block by two
   * larger creatures is two triggering events under CR 603.2, because the
   * condition names a creature and two creatures satisfy it, and the retained
   * referent differs between them.
   *
   * The referent is the *existing* `triggeringCreature` target kind rather than
   * a second one, for `selfDealsCombatDamageToCreature`'s reason: a retained
   * referent from the triggering event is what that kind already means, and CR
   * 115 does not target it here either.
   *
   * Hand-authored only: deliberately absent from `MODEL_TRIGGER_CONDITIONS`, so
   * the generator's output space stays inside the engine's enforceable space.
   * The generator has no way to name the referent — `MODEL_TARGET_KINDS` does
   * not carry `triggeringCreature` — so a condition it could print would be a
   * trigger it could not aim.
   */
  'selfBlocksOrIsBlockedByGreaterPower',
  /**
   * CR 603.6e and CR 508.1, as one printed condition: the source entered the
   * battlefield, or it was declared as an attacker.
   *
   * `selfBlocksOrIsBlockedByGreaterPower`'s shape, and the argument for one
   * member rather than two abilities is the same one Magic itself makes by
   * printing the line this way. The M11 Titan cycle is five mythics whose whole
   * design is that the payoff arrives twice — once when the body lands and once
   * every combat afterwards — and a card printing the two halves as two
   * abilities is a different card: CR 603.2 would fire both the turn a Titan
   * entered untapped and attacked, which is not what any of the five do.
   *
   * The kernel answers it from the two events the two halves already emit
   * (`permanentEntered` and `attackersDeclared`, `packages/kernel/src/
   * triggers.ts`), one match per event, so an entering attacker that somehow
   * did both inside one scan window fires it once per event and never twice on
   * one.
   *
   * No referent is retained. Neither half names a body nobody chose — the
   * source is the source in both — so this member stays off
   * `TRIGGERING_CREATURE_CONDITIONS` and `TriggerContextKind` stays unwidened.
   *
   * Hand-authored only: deliberately absent from `MODEL_TRIGGER_CONDITIONS`, so
   * the generator's output space stays inside the engine's enforceable space
   * and every recorded fixture key still replays.
   */
  'selfEntersOrAttacks',
  /**
   * CR 601.2i and CR 105.2, as five members rather than one member with a color
   * field: a player cast a spell of this color.
   *
   * M11 prints the cycle as five two-mana artifacts, one per color, each of
   * which may gain its controller a life, and two things about the printed line
   * decide the shape. The first is *whose* spell. The line says "a player", not
   * "you", so the trigger watches the whole table and `conditionsFrom` scans the
   * entire battlefield rather than the caster's half of it — the only condition
   * in this tuple that does. `youCastSpell` and `youCastInstantOrSorcery` are
   * not wider versions of this with a color dropped; they are the
   * controller-filtered readings of the same event and stay separate for that
   * reason rather than for a color one.
   *
   * The second is the color, and it is five members because a `TriggerCondition`
   * is an enum every reader dispatches on by name. A color field on the
   * triggered ability would have to be printed by `TRIGGER_PRINT_TEMPLATES`,
   * compiled by `@mtg/forge-export`'s `FORGE_TRIGGER_MODES`, and priced by
   * `@mtg/sim`'s `DEFAULT_TRIGGER_VALUE` and `@mtg/deckbuild`'s
   * `DEFAULT_TRIGGER_FIRE_COUNT` — four `Record`s that are already total over
   * this tuple — so the parameter would buy one member and owe four hand-written
   * five-way switches keyed on it. `COLOR_CAST_TRIGGER_CONDITIONS` below is the
   * single map from a color to its member, so nothing assembles a member name by
   * concatenating a letter onto a prefix.
   *
   * A multicolored spell answers each of its colors exactly once (CR 105.2b),
   * which is what the printed cards do: one white-blue spell gains a life off a
   * Feather and a life off an Eye, and neither of them twice.
   *
   * Hand-authored only: deliberately absent from `MODEL_TRIGGER_CONDITIONS`, so
   * the generator's output space stays inside the engine's enforceable space and
   * every recorded fixture key still replays.
   */
  'aPlayerCastsWhiteSpell',
  /** Blue's member of the cycle `aPlayerCastsWhiteSpell` argues for. */
  'aPlayerCastsBlueSpell',
  /** Black's member of the cycle `aPlayerCastsWhiteSpell` argues for. */
  'aPlayerCastsBlackSpell',
  /** Red's member of the cycle `aPlayerCastsWhiteSpell` argues for. */
  'aPlayerCastsRedSpell',
  /** Green's member of the cycle `aPlayerCastsWhiteSpell` argues for. */
  'aPlayerCastsGreenSpell',
  /**
   * CR 119.3 read from across the table: an opponent of this permanent's
   * controller was dealt damage that was not combat damage.
   *
   * M11's red 1/3 flying Elemental prints it. `combat` is the flag `applyDamage`
   * carries through the replacement pipeline, so this member is the exact
   * complement on the `damageDealt` event of what `selfDealsCombatDamageToPlayer`
   * reads there, and no single event can answer both.
   *
   * "An opponent" rather than "a player" is the whole of the controller test,
   * and it is why this scan runs with an inverted filter. Every other
   * board-scanning condition in this tuple enumerates the permanents of the
   * player the event names; this one enumerates the permanents of everybody who
   * is *not* that player, because the seat that took the damage is the seat that
   * must not fire. The source is not part of the condition at all — the printed
   * line never says who dealt it, so a burn spell, a tapped creature's ability
   * and an opponent's own artifact hurting them are one event to this member.
   *
   * No referent is retained. The damaged player is not a body any effect in this
   * vocabulary aims at, so `triggeringOid` stays absent and `TriggerContextKind`
   * stays unwidened, for the reason `selfDealsCombatDamageToPlayer` gives.
   *
   * Hand-authored only: deliberately absent from `MODEL_TRIGGER_CONDITIONS`, so
   * the generator's output space stays inside the engine's enforceable space.
   */
  'opponentDealtNoncombatDamage',
  /**
   * The power-filtered sibling of `anotherControlledCreatureEnters`: another
   * creature you control entered, and its power is 3 or greater.
   *
   * Garruk's Packleader (M11 177, M13 175) prints it, and the threshold is in
   * this member's name because it is in the card's. "Power 3 or greater" is a
   * printed constant rather than a parameter any card in this population varies,
   * and a numeric field on the triggered ability would owe the same four total
   * `Record`s the color cycle above declines to owe. `TRIGGER_POWER_THRESHOLD`
   * below is the one place the number is written, so the printed line and the
   * kernel's comparison cannot drift.
   *
   * Power is read at the moment the arrival is scanned, through the layer system
   * (`characteristicsOf`), which is CR 603.2's reading: the condition is checked
   * against the game as it exists immediately after the event, and
   * `permanentEntered` is emitted with the object already on the battlefield. So
   * a 2/2 arriving under an anthem fires it and a 4/4 arriving under a -2/-0
   * effect does not.
   *
   * A filter on the wider member and never a replacement for it, the way
   * `selfDiesNotSacrificed` filters `selfDies`: an arriving 4/4 answers this
   * condition and `anotherControlledCreatureEnters` and
   * `anotherControlledPermanentEnters` alike, and a card fires on the one it
   * printed.
   *
   * Hand-authored only: deliberately absent from `MODEL_TRIGGER_CONDITIONS`, so
   * the generator's output space stays inside the engine's enforceable space.
   */
  'anotherControlledCreatureWithPowerThreeOrGreaterEnters',
  /**
   * CR 603.6b again, and the unfiltered reading of it: the end step began, on
   * anybody's turn.
   *
   * `beginningOfYourEndStep` is fifteen members above and is *not* this one.
   * That member reads "your", so `conditionsFrom` narrows the `stepBegan` scan
   * to the permanents the active player controls; this member reads "the", so
   * it scans the whole battlefield. Arc Runner (M11 123) and Ball Lightning
   * print the unfiltered word, and on an opponent's turn the difference is the
   * whole card: the filtered member would leave a borrowed creature alive
   * through the turn it was meant to die in.
   *
   * A second member rather than a controller flag on the first, for the reason
   * the tuple's own header gives: `abilitiesOver`'s condition parameter is a
   * bare enum with no payload, so a filter is a named member. It is the same
   * split `selfDies` / `selfDiesNotSacrificed` already made.
   *
   * Hand-authored only: deliberately absent from `MODEL_TRIGGER_CONDITIONS`, so
   * the generator's output space stays inside the engine's enforceable space.
   */
  'beginningOfEndStep',
] as const;
export const TriggerConditionSchema = z.enum(TRIGGER_CONDITIONS);
export type TriggerCondition = z.infer<typeof TriggerConditionSchema>;

/**
 * The conditions that retain a creature from their own triggering event.
 *
 * Each of the three names a body nobody chose: exalted's lone attacker,
 * the creature a `selfDealsCombatDamageToCreature` trigger just damaged, and
 * the larger creature a `selfBlocksOrIsBlockedByGreaterPower` trigger just met
 * in a block. CR 115 targets none of them, which is why `triggeringCreature` is
 * a retained referent rather than a target kind a spell may choose.
 *
 * It is one list because three places have to agree on it and two of them
 * already drifted. `validate/abilities.ts` decides which abilities may print a
 * `triggeringCreature` target, `@mtg/kernel`'s `TriggerContext` carries the
 * referent on the stack, and `@mtg/ui`'s replay log schema parses it back out
 * of a file. The schema restated the list as a literal, the kernel gained
 * `selfBlocksOrIsBlockedByGreaterPower`, and the first game that put one on the
 * stack failed to load with a zod error naming two accepted kinds. The list
 * lives here, in the package all three already depend on, because the replay
 * route may not import `@mtg/kernel` at all — a viewer that can reach the
 * engine is a second engine that can disagree with the first.
 *
 * What is *not* here is exalted's extra clause: the condition retains its
 * attacker only inside the one canonical envelope `isExaltedAbility` checks,
 * while the other two retain one on every ability that prints them. That is a
 * fact about an ability rather than about a condition, so it stays at the call
 * site that has the ability in hand.
 */
export const TRIGGERING_CREATURE_CONDITIONS = [
  'controlledCreatureAttacksAlone',
  'selfDealsCombatDamageToCreature',
  'selfBlocksOrIsBlockedByGreaterPower',
] as const satisfies readonly TriggerCondition[];

export type TriggeringCreatureCondition = (typeof TRIGGERING_CREATURE_CONDITIONS)[number];

/**
 * Conditions exposed to the set generator, frozen before exalted widened the
 * hand-authored engine vocabulary. Fixture keys hash this enum's JSON Schema.
 */
export const MODEL_TRIGGER_CONDITIONS = ['selfEnters', 'selfAttacks', 'selfDies'] as const;
export const ModelTriggerConditionSchema = z.enum(MODEL_TRIGGER_CONDITIONS);
export type ModelTriggerCondition = z.infer<typeof ModelTriggerConditionSchema>;

/**
 * Printed English for each condition, up to and including the comma; `{name}`
 * is the card's name. A total `Record`, the same device as
 * `KEYWORD_PRINT_NAMES`: a condition added without a print rule is a compile
 * error rather than a card that renders half a sentence.
 */
export const TRIGGER_PRINT_TEMPLATES: Readonly<Record<TriggerCondition, string>> = {
  selfEnters: 'When {name} enters the battlefield,',
  selfAttacks: 'Whenever {name} attacks,',
  selfDies: 'When {name} dies,',
  controlledCreatureAttacksAlone: 'Whenever a creature you control attacks alone,',
  selfDiesNotSacrificed: "When {name} dies, if it wasn't sacrificed,",
  selfDealsCombatDamageToCreature: 'Whenever {name} deals combat damage to a creature,',
  beginningOfYourUpkeep: 'At the beginning of your upkeep,',
  beginningOfYourEndStep: 'At the beginning of your end step,',
  beginningOfEndStep: 'At the beginning of the end step,',
  anotherControlledPermanentEnters: 'Whenever another permanent you control enters the battlefield,',
  anotherControlledCreatureEnters: 'Whenever another creature you control enters the battlefield,',
  youCastSpell: 'Whenever you cast a spell,',
  youCastInstantOrSorcery: 'Whenever you cast an instant or sorcery spell,',
  selfDealsCombatDamageToPlayer: 'Whenever {name} deals combat damage to a player,',
  selfBlocks: 'Whenever {name} blocks,',
  youGainLife: 'Whenever you gain life,',
  selfBlocksOrIsBlockedByGreaterPower:
    'Whenever {name} blocks or becomes blocked by a creature with greater power,',
  selfEntersOrAttacks: 'Whenever {name} enters or attacks,',
  aPlayerCastsWhiteSpell: 'Whenever a player casts a white spell,',
  aPlayerCastsBlueSpell: 'Whenever a player casts a blue spell,',
  aPlayerCastsBlackSpell: 'Whenever a player casts a black spell,',
  aPlayerCastsRedSpell: 'Whenever a player casts a red spell,',
  aPlayerCastsGreenSpell: 'Whenever a player casts a green spell,',
  opponentDealtNoncombatDamage: 'Whenever an opponent is dealt noncombat damage,',
  anotherControlledCreatureWithPowerThreeOrGreaterEnters:
    'Whenever another creature you control with power 3 or greater enters the battlefield,',
};

/**
 * The condition each color's cast trigger is, as a total `Record`.
 *
 * The device `BASIC_LAND_COLOR` uses one file over, and for its reason: the
 * kernel reads a cast spell's colors and needs the member each one names, and
 * the alternative is assembling `aPlayerCasts${color}Spell` from a letter, which
 * types as `string` and fails at the moment a color is renamed rather than at
 * the moment somebody compiles. Total over `Color`, so a sixth color is a
 * compile error here rather than a spell that quietly triggers nothing.
 */
export const COLOR_CAST_TRIGGER_CONDITIONS: Readonly<Record<Color, TriggerCondition>> = {
  W: 'aPlayerCastsWhiteSpell',
  U: 'aPlayerCastsBlueSpell',
  B: 'aPlayerCastsBlackSpell',
  R: 'aPlayerCastsRedSpell',
  G: 'aPlayerCastsGreenSpell',
};

/**
 * The printed power `anotherControlledCreatureWithPowerThreeOrGreaterEnters`
 * names, written once so the sentence and the comparison cannot disagree.
 */
export const TRIGGER_POWER_THRESHOLD = 3;

export const CARD_KINDS = [
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'land',
  'enchantment',
  'planeswalker',
] as const;
export const CardKindSchema = z.enum(CARD_KINDS);
export type CardKind = z.infer<typeof CardKindSchema>;

export const RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const;
export const RaritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof RaritySchema>;

export const SUPERTYPES = ['basic', 'legendary'] as const;
export const SupertypeSchema = z.enum(SUPERTYPES);
export type Supertype = z.infer<typeof SupertypeSchema>;

export const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
export const BasicLandTypeSchema = z.enum(BASIC_LAND_TYPES);
export type BasicLandType = z.infer<typeof BasicLandTypeSchema>;

export const BASIC_LAND_COLOR: Readonly<Record<BasicLandType, Color>> = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
};

/**
 * The inverse of `BASIC_LAND_COLOR`, for the many places that hold a color and
 * need to print or look up its basic. Derived rather than written out a second
 * time: two hand-maintained copies of the same five-way mapping are two chances
 * to swap Swamp and Island in one of them.
 */
export const BASIC_LAND_FOR_COLOR: Readonly<Record<Color, BasicLandType>> = Object.fromEntries(
  BASIC_LAND_TYPES.map((type) => [BASIC_LAND_COLOR[type], type]),
) as Readonly<Record<Color, BasicLandType>>;

/** Card kinds that stay on the battlefield once resolved. */
export const PERMANENT_CARD_KINDS: readonly CardKind[] = [
  'creature',
  'artifact',
  'land',
  'enchantment',
  'planeswalker',
];

/** Card kinds that use the stack and then go to the graveyard. */
export const SPELL_CARD_KINDS: readonly CardKind[] = ['instant', 'sorcery'];

/** Subtype words: capitalized, letters plus apostrophe/hyphen (e.g. `Djinn`, `Kor`). */
export const SUBTYPE_PATTERN = /^[A-Z][A-Za-z'-]*$/;

/**
 * A token's printed name: capitalized words, apostrophes and hyphens, nothing
 * else. `Reaper's Scythe` and `Trophy-Horn Construct` pass; a name carrying a
 * colon, a dash used as punctuation, a bracket, a slash or a line break is rules
 * text that ended up in the name field, which is what a live generation of The
 * flagship set produced (`Wyrmhead Horn`, then its whole activated ability).
 *
 * The shape is only half of "this is a name". A sentence written in plain words
 * satisfies every character class here, so the pattern is paired with
 * `TOKEN_NAME_MAX_LENGTH` and neither is the check on its own.
 *
 * **The comma is refused deliberately**, and it is the mark that decides what
 * this pattern is worth (`mtg-arg`). Of the 910 single-face token printings in
 * the card store, 55 are refused, and 38 of those are not game tokens at all:
 * 24 are one collector product's player bio, decklist and advertisement cards,
 * and 14 more are one crossover's minigame, each named `Event:` and then its
 * scene. Seventeen carry a comma, and eleven of the seventeen are that same
 * crossover's character tokens. So the whole of what admitting the comma
 * would buy is **six printings out of 910**: the ordinary legendary-style
 * titles, of which `Primo, the Indivisible` is one.
 *
 * What it would cost was measured the same way and is larger. Take the store's
 * 35,106 rules-text openings, trim each to the characters `TOKEN_NAME_MAX_LENGTH`
 * allows, and ask how many read as a name under this pattern: 41.8% already do,
 * and admitting the comma takes that to 60.1%. Those 6,433 further sentences are
 * nearly all one shape, the clause a trigger opens with, whose only punctuation
 * inside 40 characters is the comma that ends it.
 *
 * The obvious narrowing does not work, and that is the finding rather than the
 * guess. Admitting a comma only before a title-cased appositive — the actual
 * grammar of `Primo, the Indivisible` — admits `Horn, Sacrifice This` just as
 * readily, because an imperative packed into a name field is title-cased too,
 * and that is the exact string a repair produces when it is told to shorten a
 * name and nothing tells it to stop writing rules. Against those same openings
 * title-cased, which is how a model writes into a name field, the appositive
 * grammar costs 41.8% to 56.4% and refuses nothing the plain widening admits. It
 * also misdescribes what it claims to model: it turns away 224 of the 3,125
 * comma-bearing card names that fit the cap, and each repair grows a hardcoded
 * list of English function words. Separating a title from an imperative means
 * knowing that one word is an adjective and the other is a verb, which is a
 * reading of what the words mean. Readings go to a model, and this validator
 * runs without one.
 *
 * Letters outside ASCII are a separate axis, refused for a separate reason. All
 * twelve non-ASCII token names in the store belong to that same collector
 * product and are real people's surnames, so the population offers no evidence
 * that a game token wants one; and `tokenSlug` maps every character outside
 * `[a-z0-9]` to a separator, so an accented name would be keyed into the art
 * manifest, the renderer and the Forge script under an id that has dropped the
 * letter. Widening that is a change to `token.ts`, not to a character class
 * here.
 */
export const TOKEN_NAME_PATTERN = /^[A-Z][A-Za-z0-9'’-]*(?: [A-Za-z0-9'’-]+)*$/;

/**
 * The longest a token may be named, measured rather than picked.
 *
 * Two independent readings land on the same number. Every one of the 910
 * single-face token printings in the card store is 34 characters or shorter
 * (median 9, 99th percentile 28); the only token names past that are the
 * `A // B` composites of a double-faced token, which one `TokenSpec` cannot
 * express anyway. And `@mtg/setgen`'s `CARD_NAME_MAX_LENGTH` is 40, which is
 * what `@mtg/ui`'s name-fit ladder is calibrated against — a token is drawn on
 * that same face, because `tokenCard` builds a real `Card` for it, so a token
 * name longer than a card name would clip on a bar no card name can reach.
 *
 * So 40 is the card face's own bound with six characters of headroom over the
 * longest token Magic has printed. It is deliberately not `TokenSpecSchema`'s
 * 80: that cap is a schema guard against an unbounded string, and a 71-character
 * name of ordinary capitalized words passed both it and the pattern until this
 * constant existed.
 */
export const TOKEN_NAME_MAX_LENGTH = 40;

/**
 * The longest a card's flavor text may be, measured rather than picked — the
 * same two-reading argument `TOKEN_NAME_MAX_LENGTH` above makes.
 *
 * **What real Magic prints.** Of the 13,554 printings since 2015 in the card
 * store that carry flavor text, the median is 80 characters, the 90th percentile
 * 132 and the 95th 149; 155 of them exceed 180 and the longest is 448.
 *
 * **What this lab's card face can hold.** The rules box of a full face is
 * costed in CSS pixels against an 87px budget, 18.85px to a line at the top of
 * the fit ladder — 4.6 lines — and a line holds about 34 characters there
 * (`@mtg/ui`'s `anatomy.ts`), so about 157 characters is the whole box — every
 * word of rules text, every reminder and the flavor text together. Flavor text
 * alone longer than that could never be drawn even on a vanilla creature whose
 * box holds nothing else, which is Vastwood Gorger's shape and the one this
 * bound has to clear.
 *
 * 160 is under the box and over the 95th percentile of what Magic prints. It is
 * a schema guard rather than a layout promise: a card whose rules text leaves no
 * room prints no flavor text at all, and that decision is
 * `@mtg/ui`'s `textBoxBlocks` rather than this number.
 */
export const FLAVOR_TEXT_MAX_LENGTH = 160;

/**
 * What flavor text may not contain: a line break, or a brace token.
 *
 * A line break, because a face lays the flavor text out as one paragraph and the
 * fit arithmetic counts it as one; an authored break would be counted as part of
 * the same paragraph and then wrap somewhere else entirely. Real Magic uses the
 * break almost only for an attribution line ("—Speaker"), which 3,169 of the
 * 3,209 broken flavor texts since 2015 are, so refusing the break costs
 * attributions and nothing else. They are outside DSL v1 deliberately.
 *
 * A brace token, because `{T}` in a rules line is painted as a mana symbol by
 * both renderers and flavor text is prose that is never painted. A card whose
 * flavor mentions a brace would print an unresolvable symbol on one face and a
 * literal brace on the other.
 */
export const FLAVOR_TEXT_FORBIDDEN = /[\n{}]/;

/** Card ids are stable lowercase slugs (`slc-lightning-lash`). */
export const CARD_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Set codes are 3-5 uppercase alphanumerics, matching Scryfall's shape. */
export const SET_CODE_PATTERN = /^[A-Z0-9]{3,5}$/;

/**
 * Compile-time exhaustiveness guard for discriminated-union switches.
 * Reaching it at runtime means input bypassed schema validation.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: unhandled variant ${JSON.stringify(value)}`);
}

/** Sorts colors into WUBRG print order without mutating the input. */
export function sortColors(colors: readonly Color[]): Color[] {
  return [...colors].sort((a, b) => COLOR_ORDER[a] - COLOR_ORDER[b]);
}

/** Sorts keywords into the canonical vocabulary order without mutating the input. */
export function sortKeywords(keywords: readonly Keyword[]): Keyword[] {
  return [...keywords].sort((a, b) => KEYWORDS.indexOf(a) - KEYWORDS.indexOf(b));
}
