/**
 * Prompt construction for the two model-facing steps: slot fill and design
 * critique.
 *
 * Prompts are built here and nowhere else, for two reasons. First, fixture keys
 * are a hash of (system, prompt, schema), so a recorded run only replays if the
 * bytes are reproducible — every section below is derived deterministically from
 * the allocation and the cards already printed. Second, the failure modes this
 * has to defend against are documented (prior-art mtg-ai section 5.1: invented
 * keywords, incomplete mechanics, power absurdity, color-pie violations); the
 * structured schema kills the first two by construction and these sections carry
 * the rest.
 */
import type { AbilityKind, CardKind, Color, EffectKind, Keyword, ModelAuraModificationKind } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import {
  AURA_MODIFICATION_KINDS,
  BASIC_LAND_TYPES,
  EQUIPMENT_SUBTYPE,
  formatManaCost,
  KEYWORDS,
  LEGAL_TARGETS,
  MODEL_EFFECT_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  renderCard,
  renderTypeLine,
  STATIC_SCOPES,
  ZoneReachingModelEffectSchema,
} from '@mtg/dsl';
import { classify } from '@mtg/design-data';
import type { SliceRarityRules } from '@mtg/design-data';
import type { ArchetypePlan } from './archetype/index';
import type { SetBrief } from './brief';
import {
  batchWantsEquip,
  batchWantsMechanics,
  LOYALTY_ABILITY_LIMITS,
  STARTING_LOYALTY_LIMITS,
} from './filled';
import type { RarityPolicy } from './rarity';
import { hasRarityInstruction, rarityPolicy } from './rarity';
import type { Slot } from './slot';
import { describeSlot } from './slot';
import { roleProfile } from './roles';
import { COLORLESS_ALLOWED_EFFECTS } from './validate/pie';

export const FILL_SYSTEM = [
  'You are a Magic: The Gathering set designer filling slots in a design skeleton.',
  '',
  'You emit structured card data, never rules text. The rules text is rendered from',
  'the structure you emit, so anything you cannot express in the given schema does',
  'not exist in this set. Design inside the schema rather than around it.',
  '',
  'Hard rules:',
  '- Fill exactly the slots you are given, one card each, echoing each slotId verbatim.',
  '- Respect every constraint on a slot: card kind, mana value window, colour, allowed effects.',
  '- A card in a coloured slot must have at least one coloured mana pip of that colour and no other colour.',
  '- Colourless slots take a mana cost of generic mana only.',
  '- Never invent keywords, effects, costs, or card types. The schema is the whole vocabulary.',
  '- Names must be evocative, unique across the set, and 40 characters or fewer.',
  '- Power and toughness must be normal for the mana value; a two-mana 5/5 is a bug, not a design.',
].join('\n');

export const CRITIQUE_SYSTEM = [
  'You are a Magic: The Gathering design reviewer giving notes on a finished draft set.',
  '',
  'Every card you are shown is already legal and already conforms to the design skeleton:',
  'curve, colour pie, rarity mix and complexity budget were checked deterministically before',
  'you were called. Do not re-check them. Your job is the judgement code cannot make -',
  'set cohesion, draft archetype support, flavour consistency, and power-level outliers.',
  '',
  'Be specific and sparing. Request a revision only where the set is genuinely worse without it,',
  'and phrase each instruction so a designer could act on it without seeing your reasoning.',
].join('\n');

/**
 * Numeric ranges the DSL validators enforce, restated for the model so ordinary
 * designs do not burn a retry. `prompts.test.ts` asserts each boundary still
 * validates, so this text cannot drift away from the validators.
 */
export const EFFECT_RANGES: Readonly<Record<EffectKind, string>> = {
  dealDamage: 'amount 1-12',
  destroyPermanent: 'no parameters',
  pumpUntilEndOfTurn: 'power and toughness deltas -8..+8, not both zero',
  drawCards: 'count 1-6',
  gainLife: 'amount 1-20',
  counterSpell: 'no parameters and no target',
  createToken: 'count 1-8, token power 0-12, toughness 1-12, subtypes capitalised',
  tapPermanent: 'no parameters',
  returnToHand: 'no parameters',
  millCards: 'count 1-20',
  putCounters: 'count 1-4, counter one of the declared kinds',
  exileTarget: 'no parameters',
  scry: 'count 1-4',
  returnFromGraveyard:
    'no count; print scope exactly "creatureCardsInPlayerGraveyard", and note this returns every creature card in that graveyard rather than one',
};

/**
 * Effect kinds carrying a parameter of their own, read off the DSL's own
 * discriminated union instead of listed here by hand.
 *
 * `kind` is the discriminant and `target` is the targeting slot, whose
 * variability is exactly `LEGAL_TARGETS` because a `TargetSpec` is a single
 * target-kind field. Every other field on a variant — `dealDamage.amount`,
 * `pumpUntilEndOfTurn.power`, `drawCards.count`, `createToken.token` — is
 * something the model can vary, so two entries of that kind can differ. A
 * primitive added to the model's vocabulary classifies itself here; there is no
 * second place to remember.
 *
 * Read off the **model's** schema rather than the engine's, and the difference
 * is not cosmetic. `EffectSchema` carries fields the generator is never shown —
 * `scope`, today — so reading it here answered a question about the model with
 * a fact about the kernel: `destroyPermanent` and `tapPermanent` became
 * "parameterized" the day the sweeper was added, their budget sentence flipped
 * from "exactly 1 entry" to "1-2 entries", and every recorded fixture went
 * looking for a key that no longer existed. The prompt describes the space the
 * model answers in, so it reads the schema that defines that space.
 *
 * The space is the *widest* model-facing union rather than the default one,
 * because a slot allowed a zone-reaching kind still has to be told how many
 * entries it may print, and `ModelEffectSchema` has no member to classify
 * `scry` by. Reading the wider union changes nothing for the ten kinds both
 * unions share: they are built from the same list, by the same call.
 *
 * A field pinned to one literal is not a parameter, and the check says so
 * outright. `returnFromGraveyard` carries `scope`, and the generatable form
 * pins it to a single value, so two entries of that kind still cannot differ —
 * counting it would have flipped a one-effect slot's budget sentence to "1-2
 * entries" over a field the model has no choice about, which is `scope`
 * stranding every fixture a second time by a slightly different route.
 */
const PARAMETERIZED_EFFECT_KINDS: ReadonlySet<EffectKind> = new Set(
  ZoneReachingModelEffectSchema.options
    .filter((option) =>
      Object.entries(option.shape).some(
        ([field, schema]) => field !== 'kind' && field !== 'target' && schema.def.type !== 'literal',
      ),
    )
    .map((option) => option.shape.kind.value),
);

/** Whether a slot's allowed kinds can express two entries that differ at all. */
function admitsTwoDistinctEffects(kinds: readonly EffectKind[]): boolean {
  if (kinds.length > 1) return true;
  const only = kinds[0];
  if (only === undefined) return false;
  return PARAMETERIZED_EFFECT_KINDS.has(only) || LEGAL_TARGETS[only].length > 1;
}

/**
 * The effect budget a slot is actually offered.
 *
 * Asking for "1-2 entries" of a kind that has no parameters and one legal target
 * is asking for a card the DSL rejects: the only second entry available is a
 * byte-identical copy of the first, and `DUPLICATE_EFFECT` says a repeat is not
 * two effects. The recorded Tideglass Reach run shows the model complying with
 * the contradiction on two such slots (UA02, UU04) rather than ignoring it, so
 * the frame is what was wrong, not the answer. A slot with room keeps the choice
 * of one entry or two; a slot without room is told the truth.
 */
function effectBudgetLine(kinds: readonly EffectKind[]): string {
  if (admitsTwoDistinctEffects(kinds)) {
    return `  effects: 1-2 entries, each of kind ${kinds.join(' or ')}`;
  }
  return `  effects: exactly 1 entry, of kind ${kinds.join(' or ')} - a second entry could only repeat the first, which the DSL rejects`;
}

function briefSection(brief: SetBrief): string {
  const mechanics = brief.mechanics
    .map((mechanic) => {
      const vocabulary = [
        mechanic.keywords.length > 0 ? `keywords: ${mechanic.keywords.join(', ')}` : '',
        mechanic.effectKinds.length > 0 ? `effects: ${mechanic.effectKinds.join(', ')}` : '',
        mechanic.abilityKinds.length > 0 ? `abilities: ${mechanic.abilityKinds.join(', ')}` : '',
        mechanic.colors.length > 0 ? `colours: ${mechanic.colors.join('')}` : 'colours: any',
      ]
        .filter((part) => part.length > 0)
        .join('; ');
      return `- ${mechanic.name}: ${mechanic.description} (${vocabulary})`;
    })
    .join('\n');
  const archetypes =
    brief.archetypeNotes.length > 0
      ? `\nArchetype intent:\n${brief.archetypeNotes.map((note) => `- ${note}`).join('\n')}`
      : '';
  return [
    '<set_brief>',
    `Set: ${brief.setName} (${brief.setCode}), ${brief.targetSize} cards.`,
    `Theme: ${brief.theme}`,
    'Mechanics:',
    mechanics,
    archetypes,
    '</set_brief>',
  ].join('\n');
}

/**
 * The effect primitives an ability printed in this pool may use.
 *
 * Derived from the same two rules a spell slot obeys, rather than restated: the
 * model's own effect vocabulary, minus whatever the mechanical color pie places
 * off-pie in this color. Off-pie is a design error whichever line of the card it
 * is printed on, and `cardSubjects` now reads a card's abilities, so a menu that
 * ignored the pie would be offering designs `checkCardPie` rejects.
 *
 * The colorless pool has no color to justify anything, so it gets the same
 * allowance the colorless spell slots get and nothing more.
 */
/**
 * Whether an effect can be printed in an ability that chooses nothing.
 *
 * Written when a trigger could not choose targets at all: `checkTriggeredEffectTarget`
 * refused every triggered effect that was not `noTarget`, so offering one to a
 * batch whose only effect-bearing kind is the trigger spent a regeneration round
 * on a card the validator was always going to reject.
 *
 * **That validator is gone.** `10c72ed` deleted the check and added
 * `triggerChoosesTargets`, and the kernel now stops for the decision, removes an
 * ability with no legal target, and tracks an entry on the stack that still owes
 * an answer. An artifact whose `selfEnters` trigger destroys target creature
 * validates clean today, which `test/substitution-notes.test.ts` prints and
 * checks. So this filter no longer stands on the engine; it stands on nothing
 * yet, and lifting it is a design change with a fixture cost, because it widens
 * `<effect_vocabulary>` for every batch whose slots carry a trigger and only a
 * trigger. `mtg-lr0z` corrected the sentence `roles.ts` was printing about the
 * same removed limit and deliberately left this one alone.
 *
 * The rule is read off `LEGAL_TARGETS`, the same table the validator used to
 * read, so a primitive added there classifies itself. It was named instead — one
 * effect, `counterSpell` — and `destroyPermanent` has the identical property and
 * was missed, which left the colorless triggered menu holding exactly one effect
 * that could never be printed.
 *
 * `counterSpell` is still named, because the table is the wrong place to look
 * for it: it carries no `TargetSpec` at all, which reads here as choosing
 * nothing, while the validator refuses it by name for naming a spell on the
 * stack.
 */
function choosesNothing(kind: EffectKind): boolean {
  if (kind === 'counterSpell') return false;
  const targets = LEGAL_TARGETS[kind];
  return targets.length === 0 || targets.includes('noTarget');
}

function abilityEffectKinds(color: Color | null, offered: readonly AbilityKind[]): readonly EffectKind[] {
  const usable = offered.includes('activated')
    ? MODEL_EFFECT_KINDS
    : MODEL_EFFECT_KINDS.filter((kind) => choosesNothing(kind));
  if (color === null) return usable.filter((kind) => COLORLESS_ALLOWED_EFFECTS.includes(kind));
  return usable.filter((kind) => classify(kind, color).verdict !== 'fail');
}

/** The keywords a static ability in this pool may grant; the same pie filter. */
function grantableKeywords(color: Color | null): readonly Keyword[] {
  if (color === null) return [];
  return KEYWORDS.filter((keyword) => classify(keyword, color).verdict !== 'fail');
}

/**
 * The magnitude a printed stat bonus may state, per tier.
 *
 * Eight is what every batch was told before any tier was told anything else, and
 * it stays the bound for a card the profile does not allow to be a bomb: a
 * common that turns a creature into a nine-power threat is the New World Order
 * problem, not a design.
 *
 * Ninety-nine is not a number chosen here. It is `@mtg/dsl`'s own
 * `statBonusDelta` ceiling, split off from the one-shot pump ceiling and widened
 * on purpose so a weapon could print a bonus that makes any creature lethal —
 * and then never told to the generator, so for as long as both numbers have
 * existed the model has been held to the smaller one at every rarity and the
 * card that motivated the widening was outside its reach. A bomb tier is told
 * the validator's number, for the reason `EFFECT_RANGES` restates the other
 * ranges: a design the validator would accept should not cost a retry. Both ends
 * are printed onto a card and run through `validateCard` in `prompts.test.ts`,
 * so this cannot drift away from the validator that has to accept it.
 */
export const STAT_BONUS_LIMIT = 8;
export const BOMB_STAT_BONUS_LIMIT = 99;

/** One `<ability_vocabulary>` line per kind this batch is actually offered. */
function abilityKindLines(kind: AbilityKind, color: Color | null, statBonus: number): string[] {
  switch (kind) {
    case 'static': {
      const keywords = grantableKeywords(color);
      const modifications = [
        `{"kind":"statBonus","power":P,"toughness":T} with P and T between -${String(statBonus)} and ${String(statBonus)} and not both 0`,
        keywords.length === 0
          ? null
          : `{"kind":"grantKeyword","keyword":K} with K one of ${keywords.join(' | ')}`,
      ].filter((text): text is string => text !== null);
      return [
        `- static: a continuous effect the permanent has while it is on the battlefield. Fields: scope (${STATIC_SCOPES.join(' | ')}), subtype, modification.`,
        `  modification is ${modifications.join('; or ')}.`,
        '  subtype is null, or one capitalised creature type, and only a group scope may name one: "self" is already exactly one permanent.',
        '  A "self" scope changes the source\'s own power, toughness or keywords, so it may only be printed on a creature.',
      ];
    }
    case 'triggered':
      return [
        `- triggered: goes on the stack when its condition happens. Fields: condition (${MODEL_TRIGGER_CONDITIONS.join(' | ')}), effects (1-2 entries).`,
        '  A triggered ability chooses nothing, so every effect must use target.kind "noTarget" or carry no target field at all, and counterSpell may not appear in one.',
      ];
    case 'activated':
      return [
        '- activated: a line the player pays for. Fields: cost, effects (1-2 entries).',
        '  cost is {"mana":<mana cost object>,"tapSelf":true|false,"sacrificeSelf":true|false}.',
        '  It may not be free and repeatable: state a mana cost, or tapSelf, or sacrificeSelf, or a combination. Sacrificing the source is enough on its own, because it can only be paid once.',
        '  An activated ability chooses its targets when it is activated, so its effects may target exactly where the effect vocabulary says they may.',
      ];
  }
}

/**
 * What an ability is, printed only for a batch that was allocated one.
 *
 * The gate is the same one `requiredLines` uses and for the same reason: a batch
 * with no ability slot builds the bytes it always did, so every fixture recorded
 * before the generator could ask for an ability keeps replaying.
 */
function abilitySection(slots: readonly Slot[], statBonus: number): string {
  const offered = [...new Set(slots.flatMap((slot) => slot.abilityKinds))];
  if (offered.length === 0) return '';
  const color = slots[0]?.color ?? null;
  const kinds = ABILITY_PRINT_ORDER.filter((kind) => offered.includes(kind));
  return [
    '<ability_vocabulary>',
    'An ability is printed on the permanent itself and stays with it. It is not a spell’s effect list, and a permanent has no effect list of its own: everything a permanent does is printed inside one of these.',
    ...kinds.flatMap((kind) => abilityKindLines(kind, color, statBonus)),
    'The same ability twice, or the same effect twice inside one ability, is one ability printed twice; say it once with the larger number.',
    '</ability_vocabulary>',
  ].join('\n');
}

/** Printed order, matching `ABILITY_KINDS`; a set is stable, a filter is not. */
const ABILITY_PRINT_ORDER: readonly AbilityKind[] = ['static', 'triggered', 'activated'];

/**
 * CR 702.6b's equip clause, printed only for a batch holding a weapon.
 *
 * The gate is `batchWantsEquip`, the same predicate `fillSchemaFor` uses, so the
 * section and the field it explains arrive together or not at all. That is the
 * rule this package keeps: a field the prompt does not explain is a field the
 * model fills by guessing, and the first evidence would be a live run that costs
 * money. Every batch without a weapon builds the bytes it always did.
 *
 * Below the bomb tier the modification is a stat bonus and nothing else.
 * `grantableKeywords` answers the empty list for the colorless pool, because
 * `@mtg/design-data` has no colorless keyword pie to filter against, and every
 * weapon in the flagship set is colorless. Naming the bound out loud beats
 * offering a shape the model would fill and the pie check would send back.
 *
 * At the bomb tier that bound is lifted, and `mtg-bfj6` is why. A tier that
 * prints four weapons and can express one modification prints one weapon four
 * times: the flagship set's rare gear came back as +7/-2, +6/-3, +4/+1 and
 * +4/+4, which is four numbers, not four cards. The keyword list is the DSL's
 * whole `KEYWORDS` rather than a pie filter, because an equip grant is ruled on
 * as a colorless allowance (`validate/pie.ts`) rather than against a color that
 * a weapon does not have. The offer is bomb-gated, so every batch a fixture ever
 * recorded builds the bytes it always did.
 *
 * The singular `"modification"` below is current, not stale. The engine's clause
 * became a list of up to two on 2026-08-13 (`@mtg/dsl`'s `AttachSchema`) and the
 * model's did not: this text and the schema beside it are hashed into the
 * fixture key, so a word changed here strands the eight recorded pairs in
 * `fixtures/llm/` and the bill is a live run. `abilityFromModel` carries the one
 * modification the model states into the list the engine holds, which leaves
 * containment where it has always been — the generator expresses less than the
 * DSL, never more. Teaching the model the second modification is a change to
 * this section, `ModelAttachSchema` and a re-record, together.
 */
function equipSection(slots: readonly Slot[], statBonus: number, bomb: boolean): string {
  if (!batchWantsEquip(slots)) return '';
  const bounds = `with P and T between -${String(statBonus)} and ${String(statBonus)} and not both 0`;
  const attach = bomb
    ? [
        '- attach is {"modification":M}. That is what the creature holding the weapon gets, and M is one of two shapes:',
        `  - {"kind":"statBonus","power":P,"toughness":T}, ${bounds}.`,
        `  - {"kind":"grantKeyword","keyword":K} with K one of ${KEYWORDS.join(' | ')}. The creature keeps the keyword for as long as it is holding the weapon.`,
        '  Two weapons whose whole clause is a stat bonus are one weapon printed twice, however far apart the numbers are. Spend at most one of this batch’s weapons on raw stats.',
      ]
    : [
        `- attach is {"modification":{"kind":"statBonus","power":P,"toughness":T}}, ${bounds}. That is what the creature holding the weapon gets.`,
      ];
  return [
    '<equip>',
    `A slot marked as Equipment prints a weapon. Give it the subtype "${EQUIPMENT_SUBTYPE}" and exactly one activated ability carrying an "attach" field:`,
    ...attach,
    '- effects is [] on that ability. Attaching is the whole of what it does, and an equip ability that also printed an effect would be two cards in one line.',
    '- cost is the price of moving the weapon onto a creature. State a mana cost; do not set tapSelf or sacrificeSelf, because a weapon that taps or dies to equip cannot be moved again.',
    '- Do not write "Activate only as a sorcery" anywhere. The rule is CR 702.6b and the engine already enforces it; the printed line is rendered from the structure.',
    'Two lines are rendered from that one ability - what the equipped creature gets, and what equip costs - so print the clause once and let the renderer say it twice.',
    'Price it as gear: the bonus is only worth anything once a creature is holding it, and the same weapon can move to the next creature after this one dies.',
    '</equip>',
  ].join('\n');
}

/** True when this batch holds a slot of that card kind; the two gates below. */
function batchHolds(slots: readonly Slot[], kind: CardKind): boolean {
  return slots.some((slot) => slot.cardKind === kind);
}

/** One `<enchantment>` line per Aura modification this batch was allocated. */
function auraModificationLines(
  kind: ModelAuraModificationKind,
  color: Color | null,
  statBonus: number,
): string[] {
  switch (kind) {
    case 'statBonus':
      return [
        `  - {"kind":"statBonus","power":P,"toughness":T} with P and T between -${String(statBonus)} and ${String(statBonus)} and not both 0. A negative Aura is cast on a creature an opponent controls; a positive one on your own, and it is a card you lose when that creature dies.`,
      ];
    case 'grantKeyword': {
      const keywords = grantableKeywords(color);
      return keywords.length === 0
        ? []
        : [
            `  - {"kind":"grantKeyword","keyword":K} with K one of ${keywords.join(' | ')}. The enchanted creature has it for as long as the Aura is attached.`,
          ];
    }
    case 'cantAttack':
      return ['  - {"kind":"cantAttack"}: the enchanted creature cannot attack.'];
    case 'cantBlock':
      return ['  - {"kind":"cantBlock"}: the enchanted creature cannot block.'];
    case 'cantBeBlocked':
      return ['  - {"kind":"cantBeBlocked"}: the enchanted creature cannot be blocked.'];
    case 'grantLandwalk':
      return [
        `  - {"kind":"grantLandwalk","landType":L} with L one of ${BASIC_LAND_TYPES.join(' | ')}: the enchanted creature cannot be blocked while the defending player controls a land of that type.`,
      ];
    case 'gainControl':
      return [
        '  - {"kind":"gainControl"}: you take control of the enchanted creature for as long as the Aura stays attached, and it untaps and attacks for you. Cast it on the best creature an opponent controls; it is the only clause here that answers a creature and gains you one in the same card, so price it like a bomb and give it no second clause.',
      ];
  }
}

/**
 * What an enchantment is, printed only for a batch holding one.
 *
 * The gate is the same shape every other optional section uses, so a batch with
 * no enchantment slot builds the bytes it always did and every fixture recorded
 * before the generator could ask for one keeps replaying.
 *
 * The modification menu is the slot's rather than the schema's. `AuraSchema`
 * admits all seven kinds and the slot names the one to three its role is for, so
 * an Aura role that exists to answer a creature is not also offered the pump
 * clause that would turn it into a different card. `checkAuraModifications`
 * reads the printed card back against that same list, which is the pairing this
 * package keeps everywhere: what the prompt offers and what the validator
 * accepts come off one statement on the slot.
 */
function enchantmentSection(slots: readonly Slot[], statBonus: number): string {
  if (!batchHolds(slots, 'enchantment')) return '';
  const offered = [...new Set(slots.flatMap((slot) => slot.auraModifications))];
  const color = slots[0]?.color ?? null;
  const kinds = AURA_MODIFICATION_KINDS.filter((kind) => offered.includes(kind));
  const aura =
    kinds.length === 0
      ? []
      : [
          'A slot whose line says "aura modifies" prints an Aura. Give it an "aura" field and nothing else: {"enchant":"creature","modifications":[...]}.',
          '- The Aura targets a creature as it is cast and enters attached to it. Price it under a spell that does the same thing once, and remember it is two cards lost when that creature dies.',
          '- modifications is 1 or 2 entries, and only from what the slot line names:',
          ...kinds.flatMap((kind) => auraModificationLines(kind, color, statBonus)),
          '- Two modifications on one Aura are one idea said once, not two cards stapled together.',
        ];
  return [
    '<enchantment>',
    'A slot marked enchantment prints a noncreature enchantment. It has no effect list and no keywords of its own: an enchantment does what it does by being on the battlefield, and everything it does is printed in the field below.',
    ...aura,
    'A slot whose line names an ability instead prints an enchantment with no "aura" field: leave it out and print what the card does inside the ability, as <ability_vocabulary> says. That is a card that changes the board for as long as it is there, so state the scope it changes rather than a creature it is attached to.',
    '</enchantment>',
  ].join('\n');
}

/**
 * What a planeswalker is, printed only for a batch holding one.
 *
 * Same gate and same reason as the section above it. The numbers are the schema
 * beside it (`FilledPlaneswalkerSchema`) rather than the DSL's outer bounds: the
 * validator accepts a loyalty between 1 and 20 and a cost between -20 and 20,
 * and a Limited-legal walker lives in a much smaller box than that. Saying the
 * small box out loud is cheaper than a regeneration round for a card the schema
 * would have refused anyway.
 */
function planeswalkerSection(slots: readonly Slot[]): string {
  if (!batchHolds(slots, 'planeswalker')) return '';
  return [
    '<planeswalker>',
    'A slot marked planeswalker prints a planeswalker. It has no effect list and no keywords: everything it does is printed inside "loyaltyAbilities", and those abilities are the whole card.',
    '- subtype is what the character is called, one capitalised word, and it is the name the card is known by rather than a title or a species.',
    `- startingLoyalty is what it arrives with, between ${String(STARTING_LOYALTY_LIMITS.min)} and ${String(STARTING_LOYALTY_LIMITS.max)}.`,
    `- loyaltyAbilities is ${String(LOYALTY_ABILITY_LIMITS.min)} or ${String(LOYALTY_ABILITY_LIMITS.max)} entries. Each is {"loyaltyCost":N,"effects":[...]} and carries no cost field: the signed loyalty change is the entire cost (CR 606.2), so state no mana, no tap and no sacrifice.`,
    '- N is signed. A positive ability adds that much loyalty and is the line the card lives on; a negative one spends loyalty and is the line it is played for. Print at least one of each, and keep the largest minus payable within a turn or two of the card arriving.',
    '- Each ability states 1 or 2 effects from <effect_vocabulary>. A loyalty ability is activated at sorcery speed and once per turn, so price each line against a whole turn rather than against an instant.',
    '- The abilities have to be different cards, not one card at three sizes. A walker that protects itself, builds an advantage and threatens to end the game is three decisions; the same effect at three magnitudes is one.',
    '</planeswalker>',
  ].join('\n');
}

/**
 * The set's own two mechanics, printed only for a batch that was reserved one.
 *
 * The gate is `batchWantsMechanics`, the same predicate `fillSchemaFor` uses,
 * so the section and the fields it explains arrive together or not at all.
 *
 * Both mechanics are described in full and neither is described twice. A part is
 * the harder half: the token is bodiless, its one ability is pinned to the shape
 * `FuseAbilitySchema` accepts, and the only judgment left is what Fuse costs and
 * what the part is called. Saying that plainly is cheaper than letting the model
 * discover it by having three cards rejected.
 */
function mechanicsSection(slots: readonly Slot[]): string {
  if (!batchWantsMechanics(slots)) return '';
  return [
    '<set_mechanics>',
    'A slot marked with a part drops a part token. A part is an artifact token with no body: state no power and no toughness, and give it exactly one activated ability, which is the whole of what a part does.',
    '- cost is {"mana":{...},"sacrificeSelf":true}. The part is spent to place its counter, so it sacrifices itself and nothing taps.',
    '- effects is one entry: {"kind":"putCounters","counter":"<the counter the slot names>","count":1,"target":{"kind":"targetCreatureYouControl"}}. The counter kind is the slot\'s, not yours; the target is the mechanic and has no other setting.',
    "- The token still needs a name, and it is the part: what the creature lost, in this world's words. Give it a subtype if the set uses one.",
    'A slot marked with a sacrifice subtype prints a card that is opened rather than cast twice. Give it one activated ability whose cost carries "sacrificeOther": {"count":N,"subtype":"<the subtype the slot names>"}.',
    "- N is the price and is yours to set. The subtype is the slot's, and a cost naming any other subtype is a card that never opens.",
    '- The source is never one of the permanents eaten, so the count is what the player has to have brought.',
    '- Put the mana half of the cost where it belongs: a card that eats two permanents and four mana is a card nobody opens.',
    'A slot marked with a dropped subtype leaves that permanent behind. Print an ability that creates a token carrying the named subtype exactly as written, because the cards that spend it name it by that word.',
    '</set_mechanics>',
  ].join('\n');
}

function vocabularySection(slots: readonly Slot[]): string {
  const offered = [...new Set(slots.flatMap((slot) => slot.abilityKinds))];
  const abilityEffects = offered.some((kind) => kind !== 'static')
    ? abilityEffectKinds(slots[0]?.color ?? null, offered)
    : [];
  const kinds = [...new Set([...slots.flatMap((slot) => slot.effectKinds), ...abilityEffects])].sort();
  if (kinds.length === 0) return '';
  const lines = kinds.map((kind) => {
    const targets = LEGAL_TARGETS[kind];
    const targetText = targets.length === 0 ? 'takes no target field' : `target.kind: ${targets.join(' | ')}`;
    return `- ${kind}: ${EFFECT_RANGES[kind]}; ${targetText}`;
  });
  return ['<effect_vocabulary>', ...lines, '</effect_vocabulary>'].join('\n');
}

/**
 * What a slot reserved for a required card tells the model.
 *
 * Only a reserved slot gets these lines, so a brief that requires nothing
 * builds the same prompt bytes it always did, and since a fixture key is a hash
 * of the prompt, every recorded run keeps replaying.
 */
function requiredLines(slot: Slot): string[] {
  const required = slot.requiredCard;
  if (required === undefined) return [];
  const lines = [
    `  name: exactly "${required.name}" - the brief requires this card by name; print it here and do not rename it`,
  ];
  if (required.equipment) lines.push('  equipment: this is a weapon; print it as <equip> below says');
  if (required.partCounter !== undefined) {
    lines.push(
      `  part: this card puts a "${required.partCounter}" counter into play on a part token; print it as <set_mechanics> below says`,
    );
  }
  if (required.sacrificeSubtype !== undefined) {
    lines.push(
      `  opens by sacrificing: "${required.sacrificeSubtype}" permanents; print it as <set_mechanics> below says`,
    );
  }
  if (required.suppliesSubtype !== undefined) {
    lines.push(
      `  drops: a token with the subtype "${required.suppliesSubtype}"; print it as <set_mechanics> below says`,
    );
  }
  if (required.flavorDirection !== undefined) lines.push(`  flavour: ${required.flavorDirection}`);
  return lines;
}

/**
 * What a slot the allocator gave an ability tells the model.
 *
 * Empty on every other slot, which is what keeps a brief that names no ability
 * kind building the prompt bytes it always did. The mechanic is named on the
 * line because that is why the slot exists: `checkMechanicCoverage` reads the
 * finished set back for it, and a slot told to print an ability without being
 * told which mechanic it carries is a slot whose card can satisfy the schema and
 * miss the point.
 *
 * The second line is the condition the mechanic stated, and it is the only way
 * anything but the model decides which CR 603 condition a trigger watches for.
 * `<ability_vocabulary>` lists all three for the batch; this narrows one slot to
 * what its brief asked for, and `checkSlotConformance` reads it back. A mechanic
 * that states none - every mechanic in this tree - prints no second line, so the
 * bytes are the bytes every recorded fixture was keyed against.
 */
function abilityLines(slot: Slot): string[] {
  if (slot.abilityKinds.length === 0) return [];
  const mechanics =
    slot.mechanics.length === 0 ? '' : ` - this is where "${slot.mechanics.join('", "')}" is printed`;
  const lines = [`  abilities: exactly 1 entry, of kind ${slot.abilityKinds.join(' or ')}${mechanics}`];
  if (slot.triggerConditions.length > 0) {
    lines.push(
      `  trigger condition: ${slot.triggerConditions.join(' or ')} - the mechanic states when it happens, so a triggered ability here watches for that and nothing else`,
    );
  }
  return lines;
}

function slotSection(slots: readonly Slot[]): string {
  const blocks = slots.map((slot) => {
    const lines = [describeSlot(slot), ...requiredLines(slot)];
    if (slot.cardKind === 'creature') {
      lines.push(
        slot.keywords.length === 0
          ? '  keywords: none - print a vanilla body with a strong name and creature types'
          : `  keywords: exactly [${slot.keywords.join(', ')}], applied by the skeleton; design the body around them`,
      );
      lines.push(...abilityLines(slot));
    } else if (slot.cardKind === 'planeswalker') {
      lines.push(
        `  loyaltyAbilities: ${LOYALTY_ABILITY_LIMITS.min} or ${LOYALTY_ABILITY_LIMITS.max} entries; print it as <planeswalker> below says`,
      );
    } else if (slot.cardKind === 'enchantment') {
      lines.push(
        slot.auraModifications.length > 0
          ? '  aura: exactly the modification kinds this slot names, and print it as <enchantment> below says'
          : '  no aura: this enchantment is not attached to anything; print it as <enchantment> below says',
      );
      lines.push(...abilityLines(slot));
    } else if (slot.effectKinds.length > 0) {
      const profile = roleProfile(slot.role);
      lines.push(effectBudgetLine(slot.effectKinds));
      if (profile.substitution !== undefined) lines.push(`  note: ${profile.substitution}`);
    } else if (slot.abilityKinds.length > 0) {
      lines.push(...abilityLines(slot));
    } else {
      lines.push(
        '  no rules text: DSL v0 artifacts are vanilla permanents; give it a name, cost and subtype',
      );
    }
    return lines.join('\n');
  });
  return ['<slots>', ...blocks, '</slots>'].join('\n');
}

/**
 * The batch's rarity policy: the union of what its slots' rarities are for.
 *
 * A batch is one rarity by construction (`batchSlots` groups by rarity and
 * color), so under any profile this is one tier's policy. It is computed as a
 * union rather than read off the first slot because `buildFillPrompt` is
 * exported and a caller may hand it a mixed list, and a mixed list should be
 * told the truth about every slot in it rather than about whichever one landed
 * first.
 */
function batchRarityPolicy(slots: readonly Slot[], rules: SliceRarityRules): RarityPolicy {
  const policies = slots.map((slot) => rarityPolicy(slot.rarity, rules));
  return {
    bomb: policies.some((policy) => policy.bomb),
    complexityHome: policies.some((policy) => policy.complexityHome),
  };
}

/**
 * What a tier the profile singles out is for, printed only for a batch holding
 * one of its slots.
 *
 * The gate is what keeps the replayed fixtures replaying, and the reason is
 * measurable rather than assumed: under the shipped play-booster profile only
 * `rare` is at or above `bombsMinRarity`, and no brief in `briefs/` builds a
 * single bomb-tier batch at its own committed size (Tideglass Reach at 90,
 * Hearthglass Vigil at 20, the flagship set at 75 - the rare tier only exists
 * above a size floor the three of them sit under). The two corpora CI replays
 * are those first two, so every batch CI ever asks for builds the bytes it
 * always did, and the first batch to see this section is the first batch
 * actually holding a bomb slot.
 *
 * The flagship *was* recorded at 249 cards on 2026-08-14, and those nine rare
 * batches did see this section. That run no longer replays at all, and not
 * because of anything here: ability slots landed afterwards, so its very first
 * common batch now builds a different slot line and a different schema, and the
 * whole recording is orphaned from its first call onward. It is kept because the
 * responses are real model output, not because a replay reaches them.
 *
 * # Why the words are these words
 *
 * The failure this is written against is not a weak card, it is a *near* card:
 * asked for a rare with no further instruction, a designer fills the slot with
 * the uncommon it would have written anyway and charges one more mana for it.
 * So the section spends its length on the distinction rather than on synonyms
 * for "powerful" — what the card has to do, the test it has to pass, and the
 * explicit statement that cost is not the lever.
 *
 * It names no effect and no ability kind, which is deliberate and is the one
 * property to preserve when it is edited. The vocabulary a batch may spend is
 * already stated exactly once, in `<effect_vocabulary>` and
 * `<ability_vocabulary>`, and both are derived from what the slot was allocated;
 * a second list here would be a second answer that goes stale the day a
 * primitive lands. Written this way, a widened vocabulary makes these
 * instructions reach further with no edit at all.
 */
function raritySection(slots: readonly Slot[], rules: SliceRarityRules): string {
  const qualifying = slots.filter((slot) => hasRarityInstruction(rarityPolicy(slot.rarity, rules)));
  if (qualifying.length === 0) return '';
  const policy = batchRarityPolicy(qualifying, rules);
  const tiers = [...new Set(qualifying.map((slot) => slot.rarity))].join(' or ');
  const ids = qualifying.map((slot) => slot.id).join(', ');
  const lines = [
    '<rarity>',
    `${ids} are ${tiers} slots. This set prints few of them, and they are the cards a player hopes to open.`,
  ];
  if (policy.bomb) {
    lines.push(
      `A ${tiers} is allowed to be the best card in any game it appears in, and should be. Design each one so that a player who resolves it and is not answered is visibly winning a turn or two later: a body nothing across the table blocks or kills profitably, a permanent that hands its controller something every turn it survives, or one spell that undoes several turns of the other player's work.`,
      `The test every card in this batch has to pass: printed at the tier below with one less mana, would it read as a reasonable card there? If it would, it is not a ${tiers} yet. Change what it does, not what it costs - a card priced one mana above the same design is the mistake this instruction exists to prevent.`,
      'Costing a lot is fine when the card pays for it. A card that ends a game for seven mana beats an efficient one for four here, and it is the one worth building a deck around.',
      `A number at the far end of a range the vocabulary above states is a ${tiers}'s to spend; the tiers below it should not be reaching there. The ranges are the same everywhere, and which cards may sit at the end of one is the difference.`,
      'Make each card in this batch a different kind of threat - a body, a board, a reset, a permanent that turns a small creature into a large one. Several cards built on one idea are one card printed several times, and this tier is too small to spend that way.',
    );
  }
  if (policy.complexityHome) {
    lines.push(
      `The set's most complicated cards belong at ${tiers} and nowhere else, so this batch may spend more printed text on one card than anywhere else in the set. Spend it on a card that does one large thing clearly rather than on a card that does three small things.`,
    );
  }
  lines.push('</rarity>');
  return lines.join('\n');
}

/**
 * What the reserved slots in this batch are for.
 *
 * Only slots the allocator actually reserved appear: an ordinary white common is
 * playable in all four white pairs and needs no instruction, while a signpost
 * has one job and should be told what it is. The set derives no multicolor
 * slots, so the card this asks for is mono-colored and the *report* declines to
 * call it a signpost (`archetype/viability.ts`). The instruction below still
 * does, and deliberately: every recorded fixture is keyed on this text, and
 * asking for the card a pair wants first is the right ask even when the pie
 * cannot make it exclusive.
 */
function archetypeSection(slots: readonly Slot[], plans: readonly ArchetypePlan[]): string {
  const reserved = slots.filter((slot) => slot.archetypes.length > 0);
  if (reserved.length === 0) return '';
  const wanted = new Set(reserved.flatMap((slot) => slot.archetypes));
  const identities = plans.filter((plan) => wanted.has(plan.pair)).map((plan) => `- ${plan.identity}`);
  const lines = reserved.map((slot) => {
    if (slot.signpost) {
      const pair = slot.archetypes.join('/');
      return `${slot.id} is the ${pair} signpost: the uncommon that advertises the ${pair} plan. Make it above rate for its cost and obviously the card a ${pair} drafter wants first.`;
    }
    return `${slot.id} exists so ${slot.archetypes.join(', ')} have a playable body at this cost; design it as a solid, unglamorous Limited card.`;
  });
  return ['<archetypes>', ...identities, ...lines, '</archetypes>'].join('\n');
}

function printedSection(priorNames: readonly string[], sameColor: readonly Card[]): string {
  const sections: string[] = [];
  if (priorNames.length > 0) {
    sections.push(`Names already used (do not repeat, do not echo): ${priorNames.join(', ')}`);
  }
  if (sameColor.length > 0) {
    sections.push(
      [
        'Cards already printed in this colour, for cohesion and to avoid near-duplicates:',
        ...sameColor.map(renderCard),
      ].join('\n\n'),
    );
  }
  if (sections.length === 0) return '';
  return ['<already_printed>', sections.join('\n\n'), '</already_printed>'].join('\n');
}

/**
 * What the rest of the tier has already printed, for a batch at the bomb tier.
 *
 * `batchSlots` keys on `(rarity, color)`, so a bomb-tier batch is one colour's
 * rares and the "make each card a different kind of threat" line in `<rarity>`
 * above could only ever mean *within this batch*. The other four colours were
 * invisible to it, which asks the model to avoid a collision it cannot see;
 * `checkDesignRepeats` then fails the set for a repeat across colours, which is
 * the safety net catching something the prompt never gave the model a chance to
 * avoid. This section is that chance.
 *
 * The list is the earlier batches' bomb-tier cards in *other* colours only.
 * Same-colour cards are already rendered in full under `<already_printed>`, and
 * printing them twice would spend prompt on nothing. Which cards those are is a
 * fact `fillSlots` already has: batches run strictly in sequence and each one
 * accumulates into `printed`, so by the time the second colour's rares are asked
 * for, the first colour's are cards rather than a promise.
 *
 * Empty means no section, so the first bomb batch in a run - which has no tier
 * behind it - builds exactly the bytes it built before this existed.
 */
function tierSection(slots: readonly Slot[], rules: SliceRarityRules, tierCards: readonly Card[]): string {
  if (tierCards.length === 0) return '';
  const qualifying = slots.filter((slot) => rarityPolicy(slot.rarity, rules).bomb);
  if (qualifying.length === 0) return '';
  const tiers = [...new Set(qualifying.map((slot) => slot.rarity))].join(' or ');
  return [
    '<tier_so_far>',
    `${tiers} cards this set has already printed, in the other colours:`,
    '',
    tierCards.map(renderCard).join('\n\n'),
    '',
    `The instruction above about not building several cards on one idea is about the whole ${tiers} tier, not only this batch. A card here has to be a different kind of threat from every card listed here as well as from the others beside it, and a repeat is rejected whichever colour printed it first - two cards that read the same once the numbers are struck out are one card, and the tier is too small to spend that way.`,
    '</tier_so_far>',
  ].join('\n');
}

function correctionSection(corrections: ReadonlyMap<string, readonly string[]>): string {
  if (corrections.size === 0) return '';
  const blocks = [...corrections.entries()].map(
    ([slotId, messages]) => `${slotId}:\n${messages.map((message) => `  - ${message}`).join('\n')}`,
  );
  return [
    '<corrections>',
    'A previous attempt at these slots was rejected by the deterministic validators.',
    'Fix exactly these problems; keep everything that was already fine.',
    ...blocks,
    '</corrections>',
  ].join('\n');
}

export interface FillPromptInput {
  readonly brief: SetBrief;
  readonly slots: readonly Slot[];
  /**
   * The profile's two rarity rules, which decide what this batch's tier is for.
   *
   * Required rather than optional, and carried from the allocation's own profile
   * rather than defaulted here. A default would be this file quietly deciding
   * where a set's bombs live, which is the profile's decision and was already
   * written down in it.
   */
  readonly rarityRules: SliceRarityRules;
  /** The ten color-pair plans, for the slots in this batch that were reserved. */
  readonly archetypes: readonly ArchetypePlan[];
  /** Every card name printed so far, for dedup. */
  readonly priorNames: readonly string[];
  /** Cards already printed in this batch's color, for cohesion. */
  readonly sameColorCards: readonly Card[];
  /**
   * Cards already printed at this batch's tier in the *other* colors, so a
   * bomb-tier batch can see the designs it must not repeat.
   *
   * Required rather than optional, and for the same reason `rarityRules` is: a
   * caller that forgets it gets a prompt that quietly stops carrying the
   * anti-repeat rule across colors, and the only signal would be a set failing
   * `checkDesignRepeats` weeks later. Empty is a fine answer and the common one;
   * every batch below the bomb tier ignores it.
   */
  readonly tierCards: readonly Card[];
  /** Validator messages per slot from a rejected attempt, empty on the first pass. */
  readonly corrections: ReadonlyMap<string, readonly string[]>;
  /** Design-review instructions per slot, used by the critique revision pass. */
  readonly revisions: ReadonlyMap<string, string>;
}

export function buildFillPrompt(input: FillPromptInput): string {
  const revisions =
    input.revisions.size === 0
      ? ''
      : [
          '<design_review>',
          'A design reviewer asked for these changes; apply them while keeping every slot constraint.',
          ...[...input.revisions.entries()].map(([slotId, note]) => `${slotId}: ${note}`),
          '</design_review>',
        ].join('\n');

  const bomb = batchRarityPolicy(input.slots, input.rarityRules).bomb;
  const statBonus = bomb ? BOMB_STAT_BONUS_LIMIT : STAT_BONUS_LIMIT;

  return [
    briefSection(input.brief),
    slotSection(input.slots),
    vocabularySection(input.slots),
    abilitySection(input.slots, statBonus),
    equipSection(input.slots, statBonus, bomb),
    enchantmentSection(input.slots, statBonus),
    planeswalkerSection(input.slots),
    mechanicsSection(input.slots),
    raritySection(input.slots, input.rarityRules),
    archetypeSection(input.slots, input.archetypes),
    printedSection(input.priorNames, input.sameColorCards),
    tierSection(input.slots, input.rarityRules, input.tierCards),
    correctionSection(input.corrections),
    revisions,
    `<task>Design ${input.slots.length} card(s), one per slot listed above, in slot order.</task>`,
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
}

/** Compact printed form used in the critique prompt: one card, four lines max. */
function critiqueLine(slot: Slot, card: Card): string {
  const cost = card.kind === 'land' ? '' : ` ${formatManaCost(card.manaCost)}`;
  const stats = card.kind === 'creature' ? ` [${card.power}/${card.toughness}]` : '';
  const text = (card.oracleText ?? '').replace(/\n/g, ' / ');
  return `${slot.id} ${card.name}${cost} (${card.rarity})${stats}${text.length > 0 ? ` | ${text}` : ''}`;
}

export interface CritiquePromptInput {
  readonly brief: SetBrief;
  readonly entries: ReadonlyArray<{ readonly slot: Slot; readonly card: Card }>;
  readonly archetypePairs: readonly string[];
}

export function buildCritiquePrompt(input: CritiquePromptInput): string {
  const byPool = new Map<string, string[]>();
  for (const entry of input.entries) {
    const pool = entry.slot.color ?? 'Colourless';
    const bucket = byPool.get(pool);
    const line = critiqueLine(entry.slot, entry.card);
    if (bucket === undefined) byPool.set(pool, [line]);
    else bucket.push(line);
  }
  const listing = [...byPool.entries()]
    .map(([pool, lines]) => [`## ${pool}`, ...lines].join('\n'))
    .join('\n\n');

  return [
    briefSection(input.brief),
    `<draft_archetypes>The balance sim runs these colour pairs: ${input.archetypePairs.join(', ')}. The set prints no gold cards, so archetype support has to come from mono-coloured cards that two pairs both want.</draft_archetypes>`,
    ['<set>', listing, '</set>'].join('\n'),
    [
      '<task>',
      'Review this set and report:',
      '- cohesion: does it read as one set built from the stated mechanics?',
      '- archetypeSupport: which colour pairs have a plan and which are starved?',
      '- flavorConsistency: do names and creature types belong to the stated world?',
      '- powerOutliers: which specific cards are over- or under-costed for Limited?',
      'Then list targeted revisions by slot id. Ask for a revision only where it matters;',
      'an empty list is a valid answer for a set that needs no changes.',
      '</task>',
    ].join('\n'),
  ].join('\n\n');
}

export const FLAVOR_SYSTEM = [
  'You are a Magic: The Gathering flavor-text writer working on a finished set.',
  '',
  'Every card you are shown is already legal, already named and already illustrated in prose by',
  'its rules text. You are writing the italic line at the foot of the text box: one or two',
  'sentences of the world speaking, never a restatement of what the card does.',
  '',
  'The rules for a line:',
  '- Under 160 characters, counting spaces. A line that does not fit the box is not printed.',
  '- One paragraph. No line breaks and no attribution line.',
  '- No curly braces: a brace on a card is a mana symbol and this is prose.',
  '- Never explain the mechanics. "Flying" needs no sentence about blocking.',
  '- Vary the register across the set. A world speaks in more than one voice, and a page of',
  '  cards that all sound like the same narrator reads as one card printed many times.',
  '',
  'You may return fewer lines than there are cards. A card you have nothing to say about is',
  'better left bare than given a sentence that could belong to any set.',
].join('\n');

export interface FlavorPromptInput {
  readonly brief: SetBrief;
  /** The cards with room in their text box, already filtered by the caller. */
  readonly cards: readonly Card[];
  /**
   * Lines written for earlier batches of this set, empty on the first.
   *
   * The pass is batched because one call cannot carry 250 cards, and a writer
   * asked to vary its register across a set it cannot see can only vary it
   * across sixty cards. These are what make the instruction mean what it says.
   * A run of one batch prints no section and builds the bytes it always did.
   */
  readonly written?: readonly { readonly flavorText: string }[];
}

/**
 * One card as the writer sees it: the id to key a line by, the printed face, and
 * nothing about the slot. A flavor writer is looking at a card rather than at a
 * position in a skeleton, and the id is the join because the answer is keyed on
 * it (`flavor.ts`, `applyFlavor`).
 */
function flavorLine(card: Card): string {
  const text = (card.oracleText ?? '').replace(/\n/g, ' / ');
  const stats = card.kind === 'creature' ? ` ${String(card.power)}/${String(card.toughness)}` : '';
  const type = renderTypeLine(card);
  return `${card.id} | ${card.name} | ${type}${stats}${text.length > 0 ? ` | ${text}` : ''}`;
}

export function buildFlavorPrompt(input: FlavorPromptInput): string {
  const written = input.written ?? [];
  const already =
    written.length === 0
      ? ''
      : [
          '<already_written>',
          'Lines you have already written for earlier cards in this set. Do not repeat a line, a phrase',
          'or a voice you have used here; this is what varying the register across the set means.',
          ...written.map((line) => `- ${line.flavorText}`),
          '</already_written>',
        ].join('\n');

  return [
    briefSection(input.brief),
    ['<cards>', input.cards.map(flavorLine).join('\n'), '</cards>'].join('\n'),
    already,
    [
      '<task>',
      'Write the flavor text for these cards. Key each line by the card id in the first column.',
      'Every card listed has room in its text box for a short line; a card with a lot of rules',
      'text is not in the list at all, because a printed card gives its rules the box first.',
      '</task>',
    ].join('\n'),
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
}
