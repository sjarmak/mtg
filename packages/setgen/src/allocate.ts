/**
 * Skeleton allocation: brief + skeleton-lite profile -> concrete slots.
 *
 * Wholly deterministic and model-free. The same brief (same seed, same target
 * size) produces byte-identical slots on every run and every machine, which is
 * what makes a generated set reproducible and diffable. All apparent randomness
 * comes from `createRng(brief.seed)`.
 *
 * Two decisions live here that the profile alone cannot make:
 *  - which creature slot carries which keyword from the color's budget;
 *  - how the brief's desired mechanics bend that budget so a requested mechanic
 *    is actually printed in the colors that asked for it.
 * Both are recorded as notes so the report can explain the set to a designer.
 */
import type { AbilityKind, Color, EffectKind, Keyword } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type {
  PieLevel,
  SkeletonLiteProfile,
  SliceGroupPlan,
  SliceKeywordBudget,
  SliceRarity,
} from '@mtg/design-data';
import { classify, deriveSkeletonLite, SLICE_RARITIES } from '@mtg/design-data';
import type { DesiredMechanic, SetBrief } from './brief';
import type { ArchetypePlan } from './archetype/index';
import { assignArchetypes, planArchetypes, reserveAnswers, reserveArchetypes } from './archetype/index';
import { colorlessPermanentWindow, spellCurve } from './curve';
import { pinRequiredCards } from './required';
import { reserveRequiredCards } from './required-demand';
import { rarityPolicy } from './rarity';
import {
  allowedEffectKinds,
  colorlessEffectKinds,
  roleAbilityKinds,
  roleAuraModifications,
  roleProfile,
} from './roles';
import type { ManaValueRange } from './roles';
import type { Slot } from './slot';
import { carriesAbilities, printsNoText, slotId } from './slot';
import { applyStatedSpellRoles } from './stated-roles';
import { createRng, shuffle } from './rng';
import type { Rng } from './rng';

/** Ranking used when a mechanic names several keywords a color can carry. */
const PIE_PREFERENCE: Readonly<Record<PieLevel, number>> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
  offPie: 3,
};

export interface Allocation {
  readonly brief: SetBrief;
  /** The profile actually allocated against: the brief's profile after archetype reservation. */
  readonly profile: SkeletonLiteProfile;
  readonly slots: readonly Slot[];
  /** The ten color-pair plans the reservation and the prompts are built from. */
  readonly archetypes: readonly ArchetypePlan[];
  /** Every judgment the allocator made, in the order it made it. */
  readonly notes: readonly string[];
}

const POOLS: readonly (Color | null)[] = [...COLORS, null];

export function allocateSlots(
  brief: SetBrief,
  profile: SkeletonLiteProfile = deriveSkeletonLite({ targetSize: brief.targetSize }),
): Allocation {
  if (profile.setSize !== brief.targetSize) {
    throw new RangeError(
      `allocateSlots: profile is sized ${profile.setSize} but the brief asks for ${brief.targetSize}`,
    );
  }
  const rng = createRng(`${brief.seed}|${brief.setCode}|${brief.targetSize}`);
  const notes: string[] = [];
  const slots: Slot[] = [];

  // Four passes bend the profile before anything is allocated, and the brief's
  // own statement about a tier's spell roles is the first of them: a stated role
  // is an input to the three derivations below rather than an override of them,
  // so a color's inert budget, a pair's answer floor and a named card's seat all
  // still hold over it. `stated-roles.ts` argues the ordering at length.
  //
  // Archetype reservation gives the ten pairs the structure they need by
  // construction rather than by luck; required-card reservation subtracts what
  // the brief's named cards state from the pools that will hold them, which is
  // decision 1 of the set design document - the list leads and the
  // skeleton derives from it. Required cards settle before the answer
  // reservation so that no pass can take back a slot the list asked for.
  //
  // The answer reservation is last, and it is the one pass that has to be: what
  // the list leaves unclaimed is not knowable until the list has settled, and a
  // pair the color pie leaves unable to print an answer in either of its own
  // colors can only be paid for out of what is left. It spends by the
  // settlement's own supply-minus-demand rule, so it never takes a named card's
  // seat; running it earlier is silently undone, because the settlement reads
  // the reserved role as a surplus and swaps it back out.
  const archetypes = planArchetypes(brief);
  const stated = applyStatedSpellRoles(profile, brief);
  notes.push(...stated.notes);
  const reserved = reserveArchetypes(stated.profile);
  notes.push(...reserved.notes);
  const settled = reserveRequiredCards(reserved.profile, brief);
  notes.push(...settled.notes);
  const derived = reserveAnswers(settled.profile, brief);
  notes.push(...derived.notes);

  for (const rarity of SLICE_RARITIES) {
    for (const pool of POOLS) {
      const plan = pool === null ? derived.profile.colorless[rarity] : derived.profile.colors[pool][rarity];
      // A group the profile allocated no cards to is skipped rather than walked.
      // The rare tier is derived per set size, so below the profile's rare-cycle
      // floor every one of its six groups is empty, and walking them let the
      // ability pass report once per pool that the group had no slot left for
      // the brief's mechanic - a sentence about a tier the set does not have.
      if (plan.cards === 0) continue;
      slots.push(
        ...allocateGroup({
          plan,
          rarity,
          color: pool,
          brief,
          rng,
          notes,
          bomb: rarityPolicy(rarity, derived.profile.rarityRules).bomb,
        }),
      );
    }
  }

  const separated = separateParameterlessSlots(slots, notes);
  const numbered = separated.map((slot, index) => ({ ...slot, index, collectorNumber: index + 1 }));
  if (numbered.length !== derived.profile.setSize) {
    throw new Error(
      `allocateSlots: allocated ${numbered.length} slots for a ${derived.profile.setSize}-card profile; the profile is inconsistent`,
    );
  }
  const assigned = assignArchetypes({
    slots: numbered,
    plans: archetypes,
    support: reserved.support,
    profile: derived.profile,
    mechanicsFor: (keywords, color) => mechanicsForKeywords(keywords, brief, color),
  });
  notes.push(...assigned.notes);

  // Seating happens last and over the whole skeleton, and it is the only thing
  // that refuses: the pass above changed what the matcher is matching against,
  // never which slot a name gets. A name still takes a slot the census already
  // accounted for, so the color balance and the rarity split are the same
  // whether the brief names 0 cards or 30.
  const required = pinRequiredCards(
    assigned.slots,
    brief,
    createRng(`${brief.seed}|${brief.setCode}|required`),
  );
  notes.push(...required.notes);

  return { brief, profile: derived.profile, slots: required.slots, archetypes, notes };
}

/**
 * Effects that carry no numbers. Two slots in the same color, at the same cost,
 * restricted to only these are the *same card* however they are named: DSL v0
 * gives a designer nothing to vary. The DSL's own uniqueness pass would reject
 * the pair as a functional reprint and no regeneration could fix it, so the
 * later slot's cost window moves up until the pair is separable.
 */
const PARAMETERLESS_EFFECTS: readonly EffectKind[] = [
  'destroyPermanent',
  'counterSpell',
  'tapPermanent',
  'returnToHand',
];
const MAX_SEPARATION_SHIFT = 4;

function isParameterless(slot: Slot): boolean {
  return (
    slot.effectKinds.length > 0 && slot.effectKinds.every((kind) => PARAMETERLESS_EFFECTS.includes(kind))
  );
}

function separationKey(slot: Slot): string {
  return [
    slot.color ?? 'A',
    slot.cardKind,
    [...slot.effectKinds].sort().join('+'),
    slot.manaValueMin,
    slot.manaValueMax,
  ].join('|');
}

function separateParameterlessSlots(slots: readonly Slot[], notes: string[]): Slot[] {
  const taken = new Set<string>();
  return slots.map((slot) => {
    if (!isParameterless(slot)) return slot;
    let candidate = slot;
    for (let shift = 0; shift <= MAX_SEPARATION_SHIFT; shift += 1) {
      if (!taken.has(separationKey(candidate))) break;
      candidate = {
        ...candidate,
        manaValueMin: candidate.manaValueMin + 1,
        manaValueMax: candidate.manaValueMax + 1,
      };
    }
    if (candidate.manaValueMin !== slot.manaValueMin) {
      notes.push(
        `${slot.id}: cost window moved to ${candidate.manaValueMin}-${candidate.manaValueMax}; ` +
          `another ${slot.color ?? 'colorless'} slot already prints ${slot.effectKinds.join('/')} at ${slot.manaValueMin}-${slot.manaValueMax}, and DSL v0 leaves nothing else to vary.`,
      );
    }
    taken.add(separationKey(candidate));
    return candidate;
  });
}

interface GroupInput {
  readonly plan: SliceGroupPlan;
  readonly rarity: SliceRarity;
  readonly color: Color | null;
  readonly brief: SetBrief;
  readonly rng: Rng;
  readonly notes: string[];
  /** This group is at or above the profile's `bombsMinRarity`. */
  readonly bomb: boolean;
}

function allocateGroup(input: GroupInput): Slot[] {
  const { plan, rarity, color, brief, rng, notes, bomb } = input;
  const curve = expandCurve(plan.creatureCurve);
  if (curve.length !== plan.creatures) {
    throw new Error(
      `allocateGroup: ${rarity} ${color ?? 'colorless'} curve sums to ${curve.length} but the plan wants ${plan.creatures} creatures`,
    );
  }

  const budget = color === null ? [] : emphasizeKeywords(plan.keywords, brief, color, rarity, notes);
  const keywordBySlot = assignKeywords(budget, plan.creatures, rng);

  const creatureSlots = curve.map((mv, ordinal): Slot => {
    const keywords = keywordBySlot[ordinal] ?? [];
    return {
      id: slotId(rarity, color, ordinal + 1),
      index: 0,
      collectorNumber: 0,
      rarity,
      color,
      cardKind: 'creature',
      role: 'creature',
      manaValueMin: mv.min,
      manaValueMax: mv.max,
      keywords,
      effectKinds: [],
      abilityKinds: [],
      auraModifications: [],
      triggerConditions: [],
      mechanics: mechanicsForKeywords(keywords, brief, color),
      archetypes: [],
      signpost: false,
    };
  });

  const spellSlots =
    color === null
      ? colorlessPermanentSlots(plan, rarity, creatureSlots.length, bomb)
      : coloredSpellSlots(plan, rarity, color, brief, creatureSlots.length, bomb, notes);

  return reserveAbilitySlots([...creatureSlots, ...spellSlots], brief, color, rarity, notes, bomb);
}

/**
 * Whether a mechanic reaches the colorless pool.
 *
 * A mechanic that lists colors lives in those colors; one that lists none says
 * "any color", and the colorless pool is where an artifact that any deck can
 * play is printed. the flagship set's first mechanic is exactly that shape - a
 * part token is a colorless artifact - so reading "any" as "the five colored
 * pools only" would put the mechanic everywhere except where it belongs.
 */
function appliesToPool(mechanic: DesiredMechanic, color: Color | null): boolean {
  return color === null ? mechanic.colors.length === 0 : appliesToColor(mechanic, color);
}

/**
 * Reserves a permanent slot per requested ability mechanic, before any model
 * call.
 *
 * This is the half of `mtg-bc2.132.3` that has to be deterministic: the brief
 * names an ability kind, and the skeleton has to hold a slot for it in the
 * colors that asked, or `checkMechanicCoverage` is asserting against a set the
 * allocator never gave the mechanic room in. It runs per group, so a mechanic
 * that reaches a color reaches that color's commons rather than only its
 * uncommons - "if the theme isn't at common, it isn't the theme".
 *
 * At most one slot per mechanic per group, and a keyword-free slot is preferred:
 * an ability is printed text, and stacking one on a creature that already got a
 * keyword out of the group's budget spends two New World Order red flags on one
 * common. Nothing here changes a slot's count, cost window or card kind, so the
 * curve, the creature share and the color balance are untouched.
 *
 * The mechanic's stated trigger conditions ride along with its ability kinds,
 * because this is the pass that also names the mechanic on the slot: a slot
 * told "print `selfEnters` here" and not told which mechanic that is has been
 * given a rule with no reason. A mechanic that states none leaves the field
 * empty, which is every brief in this tree, and the slot line is the one it has
 * always been.
 *
 * # One per mechanic, and then rules text without a mechanic at the bomb tier
 *
 * "At most one slot per mechanic per group" is a New World Order rule: an
 * ability is printed text and a common carrying one spends a red flag, so the
 * budget is what caps the count. That budget is a *common* budget
 * (`validate/nwo.ts` counts commons and nothing else), and the tier at or above
 * the profile's `bombsMinRarity` is the tier a set may print a card that wins
 * the game on its own at. A rare with no ability is a keyword body — a big one,
 * but a Limited bomb is a card a deck is built around, and nothing in a vanilla
 * 6/7 is a thing to build around. So at the bomb tier every permanent slot that
 * can carry an ability is given one.
 *
 * Given one *ability*, not given a mechanic. `mtg-b862` first cycled the
 * applicable mechanics over every slot, and the census that settled it says why
 * that is the wrong shape: a mechanic that names colors reaches only those
 * pools, and a mechanic that names none reaches all six, so the cycle does not
 * spread — it repeats whichever mechanic is colorless. At 249 cards that put the
 * flagship's first mechanic on eleven of fourteen rare permanents, five of them
 * on slots the required list had not claimed, and on all four of the marquee
 * weapons, whose ability the required-card pin then overwrites with an equip
 * clause anyway.
 *
 * So the first round names mechanics, exactly as every other tier does, and the
 * permanents left over at the bomb tier are allocated the ability *kinds* the
 * pool's mechanics use with no mechanic attached. That is the shape
 * `assignSignposts` already uses for the same reason: a slot told to print an
 * ability and not told which mechanic it is has been left room to be its own
 * card, which is what a rare is for. Every bomb-tier permanent still prints
 * rules text, which was `mtg-b862`'s whole point.
 *
 * Which tier that is stays the profile's word rather than this file's: the
 * caller reads `rarityPolicy(rarity, rules).bomb`, so a profile whose bombs
 * start at uncommon gets the same treatment there and a set with no tier above
 * the line gets none anywhere. At 75 cards the skeleton allocates no rare tier,
 * so this changes nothing about the set already recorded.
 */
function reserveAbilitySlots(
  slots: readonly Slot[],
  brief: SetBrief,
  color: Color | null,
  rarity: SliceRarity,
  notes: string[],
  bomb: boolean,
): Slot[] {
  const applicable = brief.mechanics.filter(
    (mechanic) => mechanic.abilityKinds.length > 0 && appliesToPool(mechanic, color),
  );
  const chosen = new Map<string, DesiredMechanic>();
  for (const mechanic of applicable) {
    const free = slots.filter((slot) => carriesAbilities(slot) && !chosen.has(slot.id));
    const slot = free.find((candidate) => candidate.keywords.length === 0) ?? free[0];
    if (slot === undefined) {
      notes.push(
        `${rarity} ${color ?? 'colorless'}: mechanic "${mechanic.name}" asked for ${mechanic.abilityKinds.join('/')}, ` +
          'and the group had no permanent slot left to carry it.',
      );
      continue;
    }
    chosen.set(slot.id, mechanic);
    const conditions =
      mechanic.triggerConditions.length === 0 ? '' : ` on ${mechanic.triggerConditions.join('/')}`;
    notes.push(
      `${rarity} ${color ?? 'colorless'}: ${slot.id} prints mechanic "${mechanic.name}" as ` +
        `${mechanic.abilityKinds.join('/')}${conditions}.`,
    );
  }

  const unnamed = bomb
    ? unnamedAbilities(slots, applicable, chosen, rarity, color, notes)
    : { ids: new Set<string>(), kinds: [] };

  const named =
    chosen.size === 0 && unnamed.ids.size === 0
      ? [...slots]
      : slots.map((slot) => {
          const mechanic = chosen.get(slot.id);
          if (mechanic === undefined) {
            return unnamed.ids.has(slot.id) ? { ...slot, abilityKinds: unnamed.kinds } : slot;
          }
          const mechanics = slot.mechanics.includes(mechanic.name)
            ? slot.mechanics
            : [...slot.mechanics, mechanic.name];
          return {
            ...slot,
            abilityKinds: mechanic.abilityKinds,
            triggerConditions: mechanic.triggerConditions,
            mechanics,
          };
        });

  // Gated on the same `applicable` the mechanic pass above computed: a pool no
  // brief mechanic's ability kinds reach gets no fallback either, which is what
  // keeps a brief that names no ability kind at all (`TIDEGLASS`,
  // `abilities.test.ts`'s "leaves every slot ability-free") building the exact
  // schema and prompt bytes it always did - `applicable` is empty in every one
  // of its pools, since the filter itself requires a nonempty `abilityKinds`,
  // so this never fires. The colorless pool of a brief whose one mechanic names
  // a color reads the same way: `applicable` is empty there specifically, so a
  // static ability never leaks into a pool the brief gave no ability lever at
  // all.
  const filled = applicable.length > 0 ? fillTextlessPermanents(named, rarity, color, notes) : named;
  return rescueUnfillablePermanents(filled, rarity, color, notes);
}

/**
 * The gear slots a brief gave no ability lever, rescued rather than printed blank.
 *
 * `fillTextlessPermanents` above is gated on the brief reaching this pool, and
 * that gate is load-bearing: ungate it and 36 recorded assertions move, because
 * a colorless *creature* with no keyword is a vanilla common, which is a real
 * card and one the fixtures recorded. This pass is the other half of the same
 * house rule, aimed at the population the gate leaves behind and no wider — a
 * noncreature slot with no keyword, no effect and no ability, which is the
 * predicate `checkSlotFillability` refuses on, narrowed to the slots that may
 * carry an ability at all. Today those two populations are the same set: a role
 * with no `ROLE_PROFILES` entry allocates as an artifact, and every role that
 * has one carries an effect vocabulary and so prints something. The narrowing is
 * there because a static ability is not a remedy a land or a sorcery slot could
 * take, and a rescue that pretended otherwise would emit a card the DSL refuses.
 *
 * `mtg-dkgd` is what made the population nonempty. The colorless pool used to be
 * whatever five equal color pools left over, so a brief whose every mechanic
 * names a color drew few enough colorless slots that the profile's spell-slot
 * rotation never reached `manaArtifact` or `landFixing`; paying the pool the
 * share the profile states reaches them. `mtg-g84u` is the standing bead on
 * those two roles and this does not close it — the card printed here is an
 * artifact with a static ability rather than a mana rock, and the note says so.
 * `addMana` shipping since (`mtg-nhyv.9`) does not change that: it is outside
 * `EffectKind` on purpose, so `ROLE_PROFILES` cannot name it and a slot cannot
 * ask for it. The flagship's mana rocks arrive as `authoredCards`, appended
 * after the generated set rather than seated in slots (`./authored.ts` says
 * why), so they are not evidence these roles became fillable.
 * What it closes is the failure mode: a brief that wants no colorless design
 * gets a card it can print instead of an allocation `generateSet` refuses.
 *
 * The flagship has always taken this path — its mechanics reach the colorless
 * pool, so `fillTextlessPermanents` already hands its textless gear a static
 * ability — so this is the same remedy extended to briefs the gate excluded,
 * not a new kind of card.
 */
function rescueUnfillablePermanents(
  slots: readonly Slot[],
  rarity: SliceRarity,
  color: Color | null,
  notes: string[],
): Slot[] {
  const left = slots.filter(
    (slot) => carriesAbilities(slot) && slot.cardKind !== 'creature' && printsNoText(slot),
  );
  if (left.length === 0) return [...slots];
  notes.push(
    `${rarity} ${color ?? 'colorless'}: ${left.map((slot) => slot.id).join(', ')} ` +
      'sit at a role the generator has no effect vocabulary for and no brief mechanic reaches this ' +
      'pool, ' +
      'so each prints a static ability rather than the blank card the slot would otherwise permit ' +
      '(mtg-g84u).',
  );
  const ids = new Set(left.map((slot) => slot.id));
  return slots.map((slot) => (ids.has(slot.id) ? { ...slot, abilityKinds: STATIC_ABILITY_KIND } : slot));
}

/**
 * The house rule of 2026-08-13: no printed card may carry empty rules text.
 * `reserveAbilitySlots` above spends the mechanic budget and, at the bomb
 * tier, the unnamed-ability budget; neither one promises to reach every
 * permanent, because a color's keyword weights are floats that sum under the
 * creature count (real Play Booster commons are mostly vanilla) and a
 * colorless slot's role table only some of the time names an effect. What is
 * left after both passes is a permanent with no keyword, no effect and no
 * ability - the seven `mtg-bc2.26.5.1` found seated on the flagship brief,
 * five creatures and two colorless artifacts, none of them a brief mechanic's
 * business to cover.
 *
 * The fix is `static`: the one CR 113 ability kind `redFlagsFor` never charges
 * a New World Order flag for (`nwo.ts` counts `triggered` and `activated`
 * only), so handing it to a textless permanent costs the common budget
 * nothing, unlike the triggered death effects this set's own economy is built
 * from. No mechanic is named, the same as the bomb-tier fallback above: a slot
 * told to print a static ability and not told which mechanic it is has been
 * left room to be its own card rather than a rules-text-free one.
 */
function fillTextlessPermanents(
  slots: readonly Slot[],
  rarity: SliceRarity,
  color: Color | null,
  notes: string[],
): Slot[] {
  const left = slots.filter(isTextlessPermanent);
  if (left.length === 0) return [...slots];
  notes.push(
    `${rarity} ${color ?? 'colorless'}: ${left.map((slot) => slot.id).join(', ')} ` +
      'had no keyword, effect or ability left after the mechanic and bomb-tier passes; ' +
      'each prints a static ability with no mechanic named, because a static costs no New World Order ' +
      'budget and no card may carry empty rules text.',
  );
  const ids = new Set(left.map((slot) => slot.id));
  return slots.map((slot) => (ids.has(slot.id) ? { ...slot, abilityKinds: STATIC_ABILITY_KIND } : slot));
}

/** The one `AbilityKind` `fillTextlessPermanents` ever hands out. */
const STATIC_ABILITY_KIND: readonly AbilityKind[] = ['static'];

/** A permanent slot that, as allocated, would print a card with no rules text. */
function isTextlessPermanent(slot: Slot): boolean {
  return carriesAbilities(slot) && printsNoText(slot);
}

interface UnnamedAbilities {
  /** The slots that get one, so the caller applies no predicate of its own. */
  readonly ids: ReadonlySet<string>;
  readonly kinds: readonly AbilityKind[];
}

/**
 * The bomb-tier permanents no mechanic claimed, and the ability kinds they get:
 * the set's own vocabulary, with no mechanic named.
 *
 * The kinds come off the brief rather than out of the DSL's whole list, because
 * a set is written in the kinds its mechanics are written in and a rare that
 * prints a static ability in a set with no static abilities is a card from
 * another set. Empty when the pool has no applicable mechanic at all, which
 * leaves those slots exactly as they were: a brief that asks for no ability in
 * this pool has not asked for one here either.
 */
function unnamedAbilities(
  slots: readonly Slot[],
  applicable: readonly DesiredMechanic[],
  chosen: ReadonlyMap<string, DesiredMechanic>,
  rarity: SliceRarity,
  color: Color | null,
  notes: string[],
): UnnamedAbilities {
  const empty: UnnamedAbilities = { ids: new Set<string>(), kinds: [] };
  const kinds = [...new Set(applicable.flatMap((mechanic) => mechanic.abilityKinds))];
  if (kinds.length === 0) return empty;
  const left = slots.filter(
    (slot) => carriesAbilities(slot) && !chosen.has(slot.id) && slot.abilityKinds.length === 0,
  );
  if (left.length === 0) return empty;
  notes.push(
    `${rarity} ${color ?? 'colorless'}: ${left.map((slot) => slot.id).join(', ')} ` +
      `each print an ability of kind ${kinds.join('/')} and are told no mechanic; ` +
      'the tier prints rules text on every permanent, and a second copy of a mechanic is not what a rare is for.',
  );
  return { ids: new Set(left.map((slot) => slot.id)), kinds };
}

function expandCurve(buckets: SliceGroupPlan['creatureCurve']): ManaValueRange[] {
  return buckets.flatMap((bucket) =>
    Array.from({ length: bucket.count }, () => ({ min: bucket.mvMin, max: bucket.mvMax })),
  );
}

/**
 * A colored pool's noncreature slots.
 *
 * The effect menu is the role's, narrowed by the pie and then by the brief's
 * mechanics. A role that states no effect kinds at all skips both steps rather
 * than passing an empty list through them: `allowedEffectKinds` throws when the
 * pie filter empties a menu, which is the right answer for a removal role that
 * is off-pie in this color and the wrong answer for an Aura, whose card says
 * everything it says in its clause and was never going to name an effect. The
 * `emphasizeEffects` call is skipped for the same reason — there is nothing for
 * a mechanic to narrow.
 *
 * A walker skips the narrowing too, and for the opposite reason: it has three
 * abilities where a spell has one card, so a menu narrowed to the one primitive
 * a mechanic named prints that primitive three times. `emphasizeEffects` already
 * makes this exemption for a bomb tier and says why (a mechanic is supported at
 * the tiers that print many cards); a walker is that argument again, one card
 * further in, and it holds at whatever tier the walker was stated at rather than
 * only where the rarity policy happens to say bomb.
 *
 * `auraModifications` and `abilityKinds` come off the role for the two permanent
 * kinds and are empty everywhere else, which is the pair of statements that
 * makes an enchantment slot's card an Aura or an anthem rather than either. A
 * walker's `activated` is stated here rather than left to
 * `reserveAbilitySlots`, because a walker with no ability is not a card the DSL
 * accepts at all (`checkAbilities`) and the reservation pass is about brief
 * mechanics, which a walker slot may carry none of.
 */
function coloredSpellSlots(
  plan: SliceGroupPlan,
  rarity: SliceRarity,
  color: Color,
  brief: SetBrief,
  creatureCount: number,
  bomb: boolean,
  notes: string[],
): Slot[] {
  const curve = spellCurve(plan.spells, bomb);
  return plan.spellRoles.map((role, ordinal): Slot => {
    const profile = roleProfile(role);
    const id = slotId(rarity, color, creatureCount + ordinal + 1);
    const chosen =
      profile.effectKinds.length === 0
        ? { effectKinds: [], mechanics: [] }
        : profile.cardKind === 'planeswalker'
          ? { effectKinds: allowedEffectKinds(role, color), mechanics: [] }
          : emphasizeEffects(allowedEffectKinds(role, color), brief, color, bomb, id, notes);
    const mv = profile.manaValue ?? curve[ordinal] ?? { min: 2, max: 3 };
    return {
      id,
      index: 0,
      collectorNumber: 0,
      rarity,
      color,
      cardKind: profile.cardKind,
      role,
      manaValueMin: mv.min,
      manaValueMax: mv.max,
      keywords: [],
      effectKinds: chosen.effectKinds,
      abilityKinds: roleAbilityKinds(role),
      auraModifications: roleAuraModifications(role),
      triggerConditions: [],
      mechanics: chosen.mechanics,
      archetypes: [],
      signpost: false,
    };
  });
}

/**
 * The colorless pool's noncreature slots.
 *
 * A role the table knows prints its own effects — the shipped skeleton's
 * colorless noncreature slot is `removalExpensive`, and colorless answers are
 * the only ones a pair of two colors that cannot print removal will ever see.
 * A role with no profile prints an artifact with no effect list, which is a
 * vanilla body until `reserveAbilitySlots` gives it an ability to carry.
 *
 * `bomb` is the tier's, and it picks which window list the rotation runs over —
 * `curve.ts` argues why the bomb tier needs a list of its own rather than the
 * common pool's read backwards. A role that states its own cost keeps it at
 * every tier: the table is the authority on what a role costs, and the list is
 * only ever the fallback.
 */
function colorlessPermanentSlots(
  plan: SliceGroupPlan,
  rarity: SliceRarity,
  creatureCount: number,
  bomb: boolean,
): Slot[] {
  return plan.spellRoles.map((role, ordinal): Slot => {
    const effectKinds = colorlessEffectKinds(role);
    const profile = effectKinds.length === 0 ? undefined : roleProfile(role);
    const mv = profile?.manaValue ?? colorlessPermanentWindow(ordinal, bomb);
    return {
      id: slotId(rarity, null, creatureCount + ordinal + 1),
      index: 0,
      collectorNumber: 0,
      rarity,
      color: null,
      cardKind: profile?.cardKind ?? 'artifact',
      role,
      manaValueMin: mv.min,
      manaValueMax: mv.max,
      keywords: [],
      effectKinds,
      abilityKinds: [],
      auraModifications: [],
      triggerConditions: [],
      mechanics: [],
      archetypes: [],
      signpost: false,
    };
  });
}

/**
 * Spreads a group's keyword budget over its creature slots, at most one keyword
 * per creature: the slice's commons stay inside the New World Order comprehension
 * budget, and the remaining creatures print as vanilla bodies.
 */
function assignKeywords(
  budget: readonly SliceKeywordBudget[],
  creatures: number,
  rng: Rng,
): readonly Keyword[][] {
  const assignment: Keyword[][] = Array.from({ length: creatures }, () => []);
  const tokens = budget.flatMap((entry) => Array.from({ length: entry.count }, () => entry.keyword));
  const order = shuffle(
    Array.from({ length: creatures }, (_unused, index) => index),
    rng,
  );
  for (const [position, keyword] of tokens.entries()) {
    const slotIndex = order[position];
    if (slotIndex === undefined) break;
    assignment[slotIndex] = [keyword];
  }
  return assignment;
}

function appliesToColor(mechanic: DesiredMechanic, color: Color): boolean {
  return mechanic.colors.length === 0 || mechanic.colors.includes(color);
}

function mechanicsForKeywords(
  keywords: readonly Keyword[],
  brief: SetBrief,
  color: Color | null,
): readonly string[] {
  if (color === null || keywords.length === 0) return [];
  return brief.mechanics
    .filter((mechanic) => appliesToColor(mechanic, color))
    .filter((mechanic) => mechanic.keywords.some((keyword) => keywords.includes(keyword)))
    .map((mechanic) => mechanic.name);
}

interface EffectChoice {
  readonly effectKinds: readonly EffectKind[];
  readonly mechanics: readonly string[];
}

/**
 * Narrows a spell slot to a requested mechanic's effect when the brief asks for
 * one that the role can legally print; otherwise the slot keeps the role's full
 * (already on-pie) menu and the model chooses.
 *
 * The bomb tier is exempt, which is `unnamedAbilities`' rule reaching the half of
 * the tier it never covered. That function already refuses to name a mechanic on
 * a bomb-tier *permanent*, on the grounds that a second copy of a mechanic is not
 * what a rare is for; a bomb-tier *spell* was still being stamped, and `mtg-bfj6`
 * is what that cost. the flagship set's mechanic is written in `createToken`,
 * so every rare spell slot whose role could print a token — blue's, red's and
 * green's, three separate pools that never see each other's prompts — was handed
 * the same narrowed vocabulary and the same "supports: Fuse" line. All three came
 * back as a keyworded body plus a clause of 0/1 filler, and the filler was the
 * mechanic. The bodies were three different cards; the second sentence was one
 * sentence printed three times.
 *
 * A tier that prints one spell per color has no room to spend it on supply, and
 * supply is not short: the mechanic is printed across the tiers that print many
 * cards, which is where `emphasizeEffects` still applies.
 */
function emphasizeEffects(
  allowed: readonly EffectKind[],
  brief: SetBrief,
  color: Color,
  bomb: boolean,
  slotId: string,
  notes: string[],
): EffectChoice {
  for (const mechanic of brief.mechanics) {
    if (!appliesToColor(mechanic, color)) continue;
    const match = mechanic.effectKinds.find((kind) => allowed.includes(kind));
    if (match === undefined) continue;
    if (bomb) {
      notes.push(
        `${slotId}: keeps its role's whole effect menu (${allowed.join('/')}) and is told no mechanic, ` +
          `though "${mechanic.name}" is printed in ${color} and would have narrowed it to ${match}. ` +
          'A mechanic is supported at the tiers that print many cards; a tier with one spell per color ' +
          'spends it on a card no other color prints.',
      );
      return { effectKinds: allowed, mechanics: [] };
    }
    return { effectKinds: [match], mechanics: [mechanic.name] };
  }
  return { effectKinds: allowed, mechanics: [] };
}

/**
 * Bends a color's keyword budget toward the brief. If a mechanic asks for a
 * keyword in this color and the skeleton allocated it none, one token is moved
 * from the color's most-budgeted keyword. Totals never change, so the group's
 * creature count and keyword density stay on the profile.
 *
 * Two ways a request can go unanswered, and both used to be silent past this
 * function: a keyword entirely off the color's pie, and a budget with no token
 * to spend on an on-pie one. The note below is what makes either readable
 * without diffing the brief against the printed cards by hand; it is the
 * allocator's own record, so it is written at the group this call was asked
 * about even though a later pass (`archetype/assign.ts`'s `stampKeyword`, which
 * a signpost's payoff keyword can route through independently of this budget)
 * may still hand the group the keyword this call declined.
 * `checkMechanicKeywordUnprinted` reads the finished set back for that reason,
 * the same reason `checkStatedRoles` does for a stated spell role.
 */
function emphasizeKeywords(
  budget: readonly SliceKeywordBudget[],
  brief: SetBrief,
  color: Color,
  rarity: SliceRarity,
  notes: string[],
): SliceKeywordBudget[] {
  const counts = new Map<Keyword, number>(budget.map((entry) => [entry.keyword, entry.count]));
  for (const mechanic of brief.mechanics) {
    if (!appliesToColor(mechanic, color)) continue;
    // A mechanic cannot buy its way past the color pie: an off-pie keyword is a
    // design error whichever brief asked for it.
    // Best placement first, so a mechanic lands on the color's primary keyword
    // rather than its tertiary one when it names both.
    const onPie = mechanic.keywords
      .filter((keyword) => classify(keyword, color).verdict !== 'fail')
      .sort((a, b) => PIE_PREFERENCE[classify(a, color).level] - PIE_PREFERENCE[classify(b, color).level]);
    if (onPie.length === 0) {
      notes.push(
        `${rarity} ${color}: mechanic "${mechanic.name}" asks for keyword(s) ${mechanic.keywords.join(', ')} in ${color}, but none of them are on ${color}'s color pie; the set prints no such keyword here.`,
      );
      continue;
    }
    const present = onPie.some((keyword) => (counts.get(keyword) ?? 0) > 0);
    if (present) continue;
    const wanted = onPie[0];
    if (wanted === undefined) continue;
    const donor = largestDonor(counts, onPie);
    if (donor === undefined) {
      notes.push(
        `${rarity} ${color}: mechanic "${mechanic.name}" asks for ${wanted} in ${color}, but this group's keyword budget has no token to spend on it; the set prints no such keyword here.`,
      );
      continue;
    }
    counts.set(donor.keyword, donor.count - 1);
    counts.set(wanted, (counts.get(wanted) ?? 0) + 1);
    notes.push(
      `${rarity} ${color}: moved one keyword slot from ${donor.keyword} to ${wanted} so mechanic "${mechanic.name}" is printed in ${color}.`,
    );
  }
  return [...counts.entries()].map(([keyword, count]) => ({ keyword, count }));
}

interface Donor {
  readonly keyword: Keyword;
  readonly count: number;
}

/** The most-budgeted keyword that the mechanic did not ask for, if any has a token. */
function largestDonor(counts: ReadonlyMap<Keyword, number>, exclude: readonly Keyword[]): Donor | undefined {
  let best: Donor | undefined;
  for (const [keyword, count] of counts) {
    if (count < 1 || exclude.includes(keyword)) continue;
    if (best === undefined || count > best.count) best = { keyword, count };
  }
  return best;
}
