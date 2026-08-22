/**
 * Design templates: how many times one set may print the same card.
 *
 * `mechanicalFingerprint` already refuses two cards that are mechanically
 * identical, and it is exact by construction — it hashes the whole normalized
 * card, every number included, omitting only id, set, oracle text, flavor text,
 * name and rarity. That is the right grain for "this set prints the same card
 * twice" and the wrong grain for the failure this file is about. The Hidden
 * Kingdom's four rare weapons were +7/-2, +6/-3, +4/+1 and +4/+4 with no other
 * printed word between them: four distinct hashes, four identical cards, and
 * `DUPLICATE_MECHANICS` could not have fired on any pair of them.
 *
 * So a template is the same card with its numbers taken out. Names, subtypes,
 * colors, supertypes, mana costs, activation costs, counts and stat magnitudes
 * are all abstracted away; what survives is the clause structure and the
 * identity of anything a player reads as a word rather than a number — an
 * effect's kind and what it points at, an ability's kind, and a granted
 * keyword's name. Keeping keyword identity is deliberate and is the grain
 * `@mtg/dsl`'s own `staticModificationIdentity` already settled on: a stat
 * bonus's numbers are not its identity, and a granted keyword's name is.
 *
 * It is also what makes the check satisfiable. Drop keyword identity and a
 * token-making role has exactly two templates available to it (one clause or
 * two, since `ModelTokenSpecSchema` requires a body and every token a spell can
 * mint is therefore a creature), so a tier with three token-making rares in it
 * could not be built at all. A gate nobody can pass is not a gate.
 *
 * # A budget per tier, not a ban
 *
 * A set is *supposed* to repeat a template at common. A removal cycle is five
 * cards on one template and that is the cycle working, so the gate cannot be
 * "no repeats" at any tier a set prints in bulk. It is a stated budget, and the
 * budget differs because the tiers differ.
 *
 * The bomb tier's budget is one. That tier prints few cards and is the reason a
 * player opens the pack, so a second card built the same way is the tier
 * printing the same card twice. `bombsMinRarity` names it — the same line
 * `rarity.ts` draws for the prompt, read from the profile rather than assumed.
 *
 * Every tier under it gets a budget of five, which is a full cycle: one card per
 * color, the unit of repetition the design language already has a word for. The
 * number is measured, not asserted. Grouping twelve recent premier sets by
 * normalized oracle text, the largest group at any rarity is one or two cards
 * with exactly one exception — Aetherdrift's five vanilla "Tyrant" uncommons,
 * which is a deliberate cycle of five and passes at this budget with nothing to
 * spare. So five is simultaneously the most a shipped set has ever printed on
 * one template and the most this gate allows, and no real set in that sample
 * fails it.
 *
 * The tier is in the key below the bomb tier and is not at the bomb tier. A set
 * may print a common cycle and an uncommon cycle of the same shape and that is
 * two cycles, not ten cards. Above the line the tiers pool instead, because two
 * cards at the top of the set built the same way are the top of the set printed
 * twice whatever their tiers are called; `SLICE_RARITIES` names one tier up
 * there today, so pooling costs nothing now and is right if a second arrives.
 *
 * The two budgets never subsidize each other. A legal cycle at common does not
 * pay for a repeated rare, and a rare does not consume a common's cycle.
 *
 * The role is part of the key rather than the whole of it. Two cards on one
 * template but different roles is a different report ("the roles do not
 * differentiate what they print") and is not this finding; cards on one role and
 * one template are the tier printing the same card repeatedly, which is.
 *
 * # Blank cards
 *
 * `checkBlankCards` is the degenerate case of the same defect and is separate
 * because it needs no budget: a card with no effects, no abilities and no
 * keywords is not a card that repeats a template, it is a card with no template
 * at all. Twenty premier sets print 0 blank noncreatures out of 3,956 cards, so
 * a blank noncreature is a finding at any rarity. A blank *creature* is a real
 * thing sets print — 2.0% of commons, 0.4% of uncommons — so below the bomb tier
 * it is left to the cycle budget above, which is what governs how many of them a
 * set may print. At or above the bomb tier the measured rate is 1 in 1,120
 * rares and 0 in 256 mythics, and it is a finding.
 *
 * # Why the two new checks report and do not regenerate
 *
 * `BOMB_TEMPLATE_REPEATED` is an error and stays one: a handful of rares built
 * the same way is a card-level fix the model can make against slot specs that
 * allow it. The two below it are `warning`, and the reason is measured rather
 * than cautious. `errors()` drives `failingSlotIds`, which is the list the loop
 * re-asks the model for at cost, and neither of these findings names a slot a
 * retry can change.
 *
 * the flagship set's 41 vanilla commons sat in creature slots with no keyword,
 * no effect kind and no ability kind. A slot that permits none of the three has
 * roughly one card in it, so asking the model for a different one is asking for a
 * card that does not exist: the templates repeated because the allocator emitted
 * near-identical specs, not because the model ran out of ideas. Its three blank
 * artifacts were worse — `requiredCard` slots at roles (`manaArtifact`,
 * `landFixing`) the DSL has no vocabulary for at all, since v0 has no
 * mana-producing effect — and `checkSlotConformance` passes a card with no
 * effects against an empty allowlist trivially.
 *
 * Both are true reports whose remedy is in the skeleton, so they are printed and
 * the loop is not sent after them. A gate that bills for a retry round it cannot
 * win is worse than one that says plainly what is wrong. The remedy itself is
 * upstream and is now enforced there: `fillTextlessPermanents` (`allocate.ts`)
 * hands a static ability to a permanent the mechanic passes left textless, and
 * `checkSlotFillability` (`fillable.ts`) refuses a bodiless slot the static never
 * reached before a single card is asked for.
 */
import type { Ability, Card, Effect, StaticModification } from '@mtg/dsl';
import { hasAbilityEffects, hasTarget, isCreatureTokenSpec } from '@mtg/dsl';
import type { SliceRarityRules } from '@mtg/design-data';
import type { Entry } from './composition';
import type { SetFinding } from './findings';
import { finding } from './findings';
import { rarityPolicy } from '../rarity';

function modificationIdentity(modification: StaticModification): string {
  switch (modification.kind) {
    case 'grantKeyword':
      return `grantKeyword:${modification.keyword}`;
    case 'statBonus':
      return 'statBonus';
    case 'definePt':
      return 'definePt';
    // Keyed by what it counts, not by the rate: two cards that both read
    // "for each Mountain you control" are the repeat this check exists to
    // find, whether one prints +0/+1 and the other +1/+1.
    case 'statBonusPer':
      return `statBonusPer:${JSON.stringify(modification.each)}`;
    // Constant, for `statBonus`'s reason: neither doubler carries a parameter,
    // so the kind is the whole of what a player reads. Unreachable from a
    // generated set today — neither is on `ModelStaticModificationSchema` — and
    // still answered here rather than left to a default, because this function
    // is also the duplicate check a hand-authored set goes through.
    case 'doubleDamage':
      return 'doubleDamage';
    case 'doubleLifeGain':
      return 'doubleLifeGain';
    // The seven combat modifications (`static-modification-class.ts`'s
    // `'combat'` class): none carries a parameter but
    // `blockOnlyCreaturesWithKeyword` and `cantBeBlockedBySubtype`,
    // mirroring `staticModificationIdentity` in `@mtg/dsl`'s
    // `validate/abilities.ts`, which this duplicate check is otherwise a second
    // copy of. Unreachable from a generated set today for the same
    // containment reason as the two doublers above.
    case 'cantAttack':
      return 'cantAttack';
    case 'cantBlock':
      return 'cantBlock';
    case 'cantBeBlocked':
      return 'cantBeBlocked';
    case 'attacksEachCombatIfAble':
      return 'attacksEachCombatIfAble';
    case 'mustBeBlockedIfAble':
      return 'mustBeBlockedIfAble';
    case 'blockOnlyCreaturesWithKeyword':
      return `blockOnlyCreaturesWithKeyword:${modification.keyword}`;
    case 'cantBeBlockedBySubtype':
      return `cantBeBlockedBySubtype:${modification.subtype}`;
  }
}

/**
 * One effect, as a player reads it minus the numbers.
 *
 * A token's body is in the identity as "creature" or "artifact" rather than as
 * its stats, and its keywords are in by name: a spell that makes a flier and a
 * spell that makes a trampler are two cards, and a spell that makes a 4/4 and a
 * spell that makes a 5/5 are one.
 */
function effectIdentity(effect: Effect): string {
  const target = hasTarget(effect) ? `@${effect.target.kind}` : '';
  if (effect.kind !== 'createToken') return `${effect.kind}${target}`;
  const body = isCreatureTokenSpec(effect.token) ? 'creature' : 'noncreature';
  const keywords = [...effect.token.keywords].sort().join('+');
  return `createToken:${body}${keywords.length > 0 ? `:${keywords}` : ''}`;
}

function abilityIdentity(ability: Ability): string {
  const effects = hasAbilityEffects(ability) ? ability.effects.map(effectIdentity).join(',') : '';
  switch (ability.kind) {
    case 'static':
      return `static:${ability.scope}:${modificationIdentity(ability.modification)}`;
    case 'triggered':
      return `triggered:${ability.condition}:${effects}`;
    case 'activated': {
      const attach =
        ability.attach === undefined
          ? ''
          : `attach[${ability.attach.modifications.map(modificationIdentity).join(',')}]`;
      return `activated:${attach}${effects}`;
    }
  }
}

/**
 * A card's own effect list, as a player would read it: the fixed list, or —
 * for a modal card (CR 700.2), whose `effects` is empty by construction
 * (`checkEffects` refuses a card that populates both) — every mode's own list,
 * wrapped so the choice survives the abstraction. "Choose one of two clauses"
 * and "print both clauses" read differently at the table and must not collapse
 * to the same template string; flattening the modes into one list the way a
 * fixed-effect census would have done exactly that.
 */
function effectsIdentity(card: Card): string {
  if (card.modes === undefined) return card.effects.map(effectIdentity).join(' | ');
  return `choose[${card.modes.map((mode) => mode.effects.map(effectIdentity).join(' | ')).join(' / ')}]`;
}

/**
 * The card's design template: what it would still read like with every number,
 * name and cost struck out. Order is printed order, because two effects in the
 * other order is a different card to read.
 */
export function designTemplate(card: Card): string {
  const effects = effectsIdentity(card);
  const abilities = card.abilities.map(abilityIdentity).join(' | ');
  const keywords = [...card.keywords].sort().join('+');
  return [card.kind, keywords, effects, abilities].join(' / ');
}

/** How many cards below the bomb tier may share one role and one template. */
export const TEMPLATE_CYCLE_BUDGET = 5;

/**
 * Grouping-key separator: a byte no role, rarity or template can contain.
 *
 * Written as an escape rather than the literal byte. This file carried the only
 * raw NUL in the package, which is invisible in an editor and in a diff, and it
 * sat inside a template literal where a stray one would have silently changed
 * what grouped with what.
 */
const SEP = '\u0000';

interface OverBudget {
  /** Every card on the shared template, in slot order. */
  readonly group: readonly Entry[];
  /** The ones past the budget: what the retry loop is asked to change. */
  readonly over: readonly Entry[];
}

/**
 * Groups by `key` and returns only the groups that spent more than `budget`.
 *
 * The cards past the budget are the ones blamed, so the retry loop regenerates
 * the surplus and leaves a legal cycle printed. Blaming the whole group would
 * throw away cards that are not the problem, and blaming none would report a
 * failure the loop cannot act on.
 */
function overBudget(entries: readonly Entry[], key: (entry: Entry) => string, budget: number): OverBudget[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const group = groups.get(key(entry));
    if (group === undefined) groups.set(key(entry), [entry]);
    else group.push(entry);
  }

  const spent: OverBudget[] = [];
  for (const group of groups.values()) {
    if (group.length <= budget) continue;
    spent.push({ group, over: group.slice(budget) });
  }
  return spent;
}

function namesIn(item: OverBudget): string {
  return item.group.map((entry) => `${entry.slot.id} "${entry.card.name}"`).join(', ');
}

/**
 * Cards sharing a role and a design template, past what their tier may spend.
 *
 * One card at or above `bombsMinRarity`; five below it, which is a cycle. The
 * budgets and the reasoning behind both are in this file's header.
 */
export function checkDesignRepeats(entries: readonly Entry[], rules: SliceRarityRules): SetFinding[] {
  const bombs: Entry[] = [];
  const rest: Entry[] = [];
  for (const entry of entries) {
    if (rarityPolicy(entry.slot.rarity, rules).bomb) bombs.push(entry);
    else rest.push(entry);
  }

  const findings: SetFinding[] = [];
  for (const item of overBudget(bombs, (e) => `${e.slot.role}${SEP}${designTemplate(e.card)}`, 1)) {
    const first = item.group[0];
    if (first === undefined) continue;
    findings.push(
      finding(
        'BOMB_TEMPLATE_REPEATED',
        'error',
        `${namesIn(item)} are all ${first.slot.rarity} ${first.slot.role} slots printed on one ` +
          `template (${designTemplate(first.card)}); with the numbers taken out they are the ` +
          'same card, and this tier is too small to print it more than once. Change what all but ' +
          'the first one does.',
        item.over.map((entry) => entry.slot.id),
      ),
    );
  }
  for (const item of overBudget(
    rest,
    (e) => `${e.slot.rarity}${SEP}${e.slot.role}${SEP}${designTemplate(e.card)}`,
    TEMPLATE_CYCLE_BUDGET,
  )) {
    const first = item.group[0];
    if (first === undefined) continue;
    findings.push(
      finding(
        'TEMPLATE_OVER_CYCLE',
        'warning',
        `${item.group.length} ${first.slot.rarity} ${first.slot.role} slots are printed on one ` +
          `template (${designTemplate(first.card)}), which is more than the ` +
          `${TEMPLATE_CYCLE_BUDGET} a full cycle spends: ${namesIn(item)}. A tier may repeat a ` +
          'template, but past a cycle the set is filling space rather than designing cards. ' +
          'Change what the extras do.',
        item.over.map((entry) => entry.slot.id),
      ),
    );
  }
  return findings;
}

/**
 * No effects, no modes, no abilities, no keywords: a card with nothing printed
 * on it.
 *
 * The `card.modes === undefined` conjunct is the load-bearing one, not a
 * restatement. A modal card (CR 700.2) carries an empty `card.effects` by
 * construction, so it satisfies the first clause the way a genuinely blank card
 * does, and without this one a spell printing two modes was reported as a card
 * with nothing on it. `ModesSchema` then guarantees the rest: at least two
 * modes, each with at least one effect, so a card with modes always has
 * something printed.
 */
export function isBlankCard(card: Card): boolean {
  return (
    card.effects.length === 0 &&
    card.modes === undefined &&
    card.abilities.length === 0 &&
    card.keywords.length === 0
  );
}

/**
 * Blank noncreatures anywhere, and blank creatures at or above the bomb tier.
 *
 * A blank creature below the bomb tier is deliberately not here; this file's
 * header has the measured rates that draw the line where it is.
 */
export function checkBlankCards(entries: readonly Entry[], rules: SliceRarityRules): SetFinding[] {
  const findings: SetFinding[] = [];
  for (const entry of entries) {
    if (!isBlankCard(entry.card)) continue;
    const creature = entry.card.kind === 'creature';
    if (creature && !rarityPolicy(entry.slot.rarity, rules).bomb) continue;
    const why = creature
      ? 'a card at this tier is the reason a player opens the pack, and this one does nothing'
      : 'a noncreature with no printed text is not a card, it is a cost with no payoff';
    findings.push(
      finding(
        'BLANK_CARD',
        'warning',
        `${entry.slot.id} "${entry.card.name}" is a ${entry.slot.rarity} ${entry.card.kind} with ` +
          `no effects, no abilities and no keywords; ${why}. Print something on it.`,
        [entry.slot.id],
      ),
    );
  }
  return findings;
}
