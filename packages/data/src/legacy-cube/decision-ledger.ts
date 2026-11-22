/** Reviewable Forge controller-family evidence for the official Legacy Cube. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { InvalidInputError } from '../errors';
import { generatedTokenScriptNames } from '../printed-card/token-references';
import {
  LEGACY_CUBE_PUBLIC_GRAVEYARD_SELECTION_SHAPES,
  legacyCubePublicGraveyardSelectionRefusals,
} from './public-graveyard-selection';
import {
  LEGACY_CUBE_PROVENANCE_PATH,
  verifyLegacyCubeProvenance,
  type LegacyCubeProvenance,
} from './provenance';

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const NonemptyString = z.string().min(1);

export const LEGACY_CUBE_DECISION_FAMILIES = [
  'priority',
  'targets',
  'modes',
  'optional-costs',
  'mana-x',
  'zone-card-selection',
  'ordering',
  'combat',
  'replacement-trigger-choices',
  'naming-text-numbers',
  'piles-votes',
  'mulligan',
  'starting-player',
  'pregame-actions',
] as const;

export const LegacyCubeDecisionFamilySchema = z.enum(LEGACY_CUBE_DECISION_FAMILIES);
export type LegacyCubeDecisionFamily = z.infer<typeof LegacyCubeDecisionFamilySchema>;

const FamilyReviewSchema = z.object({
  tag: LegacyCubeDecisionFamilySchema,
  scope: z.enum(['card', 'match']),
  bridgeStatus: z.enum(['supported', 'unsupported']),
  bridgeEvidence: NonemptyString,
  representativePositions: z.array(z.number().int().positive()).min(1),
});

export const LEGACY_CUBE_BRIDGE_FAMILY_REVIEW: Readonly<
  Record<
    LegacyCubeDecisionFamily,
    { readonly bridgeStatus: 'supported' | 'unsupported'; readonly bridgeEvidence: string }
  >
> = {
  priority: {
    bridgeStatus: 'supported',
    bridgeEvidence:
      "mtg-bc2.151.4 exposes complete top-level play/cast/activate/pass decisions as protocol-v1 priority options; mtg-bc2.154.4.29 composes that seam with Coldsteel Heart's exact entry color choice, and mtg-bc2.154.4.31 composes it with Extinction Event's exact resolving parity choice.",
  },
  targets: {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      "mtg-bc2.154.4.9 owns direct mandatory-singleton non-stack targeting, mtg-bc2.154.4.11 owns direct singleton Stack-card targeting, mtg-bc2.154.4.14 proves the direct non-stack profile composes with ordinary combat for eight position-pinned cards, mtg-bc2.154.4.15 adds one position-pinned composition whose generated token graph is exact, mtg-bc2.154.4.16 owns mandatory singleton non-Stack trigger targets for fourteen position-pinned combat cards, mtg-bc2.154.4.17 reuses that trigger seam for three position-pinned enchantments outside the combat-classified profile, mtg-bc2.154.4.18 proves the exact Paladin Class level-three installed trigger, mtg-bc2.154.4.20 owns the exact zero-cost Equip target seam for two position-pinned Equipment, mtg-bc2.154.4.21 owns the exact cast-time Aura target for Control Magic, mtg-bc2.154.4.22 owns Faith's Fetters as a separate exact permanent-target Aura with its life trigger and attached prohibitions, mtg-bc2.154.4.23 owns Fall from Favor as a separate exact creature-target Aura with its tap, monarch, and conditional untap-lock semantics, and mtg-bc2.154.4.28 composes the existing singleton player-target transport with Remorseful Cleric's exact fixed self-sacrifice and whole-graveyard exile. mtg-fp4l phase 6 owns the divided target through the same chooseTargetsFor seam, running the division as repeated assign-one over the candidates still legal to receive a point, and admits the four position-pinned cards whose whole added surface over the reviewed choose-one profiles is an amount divided among targets. mtg-fp4l phase 7 owns the stated retarget through chooseTarget, admitting the one position-pinned card whose activated ability takes one target away from a spell or ability already on the stack and gives it to the target its own script names, and wires chooseNewTargetsFor as a refusal rather than leaving the free form of the same decision inherited. The global family remains unsupported because other Auras, auto-attach, other Equip, optional, delegated-targeting, nested-choice, other Class, unpinned transitive generated-object routes, free retargeting, every retarget that is not one stated target off one stack object, and every division that is not the whole of one damage effect are separate callbacks or shapes.",
  },
  modes: {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      'mtg-fp4l wire-owns chooseModeForAbility, the one callback this family reaches, so the modes a card offers are taken from the seat rather than answered by the inherited AI, and admits the seven position-pinned cards whose modal choice is a bounded selection from the list Forge has already enumerated. The global family remains unsupported because repeatable modes, modes whose count the player announces, modes reaching a target shape outside the reviewed singleton profiles, modal costs, and every selection carrying a decision token outside the reviewed sixteen remain separate shapes.',
  },
  'optional-costs': {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      'mtg-bc2.154.4.19 owns payCostToPreventEffect only for the ten position-pinned shocklands whose exact entry replacement offers PayLife<2> or the exact self-tap fallback, mtg-bc2.154.4.27 admits Selfless Spirit only because its fixed self-sacrifice cost reaches no choice callback, and mtg-bc2.154.4.28 reuses that same fixed source cost for Remorseful Cleric. The global family remains unsupported because spell optional costs, other UnlessCost shapes, arbitrary sacrifice costs, keyword costs, cost ordering, confirmation callbacks, and every non-life or variable payment remain separate callbacks or shapes. mtg-fp4l wire-owns chooseNumberForKeywordCost so the count a keyword cost asks for is announced by the seat rather than answered by the inherited AI, and admits no card through it.',
  },
  'mana-x': {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      'mtg-fp4l wire-owns every callback this family reaches for a number the caster announces rather than picks off a list (announceRequirements, chooseNumber, chooseNumberForCostReduction, chooseNumberForKeywordCost) together with the two seams a stated number then pays through (payManaCost and applyManaToCost for ordinary mana, getCostDecisionMaker for the non-mana parts of a cost), admitting the twenty-three position-pinned cards whose whole added surface over the reviewed choose-one profiles is that one announced number. specifyManaCombo and every cost part with more than one legal payment throw rather than reaching the inherited AI. The global family remains unsupported because a Phyrexian or snow symbol, convoke, improvise, delve and the other special payment keywords, an alternative or additional cost, restricted mana, a divided announcement, a multi-mana combo, and every cost paid by choosing which permanents or cards to spend remain separate shapes.',
  },
  'zone-card-selection': {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      "mtg-bc2.154.4.10 owns one direct library-origin card selection through chooseSingleCardForZoneChange as a bounded capability profile, mtg-bc2.154.4.25 owns chooseCardsToDiscardFrom only for Chart a Course's exact conditional singleton self-hand discard, mtg-bc2.154.4.27 admits Selfless Spirit only because Sac<1/CARDNAME> fixes the sacrificed object without a callback, mtg-bc2.154.4.28 admits Remorseful Cleric because ChangeZoneAll selects a player rather than individual graveyard cards, and mtg-fp4l wire-owns every remaining callback this family reaches (choosePermanentsToSacrifice, choosePermanentsToDestroy, chooseCardsForEffect, chooseCardsForEffectMultiple, chooseSingleEntityForEffect, chooseEntitiesForEffect, chooseSpellAbilitiesForEffect, chooseSingleSpellForEffect, chooseCardsToDiscardUnlessType, chooseCardsToDiscardToMaximumHandSize, chooseCardsToDelve, chooseCardsForSplice, chooseCardsToRevealFromHand, chooseCardsForCost, chooseCardsForZoneChange, chooseCardsForConvokeOrImprovise) by running the wired choose-one loop with a Done option, admitting the thirty-five position-pinned cards whose selection is bounded by a list Forge has already enumerated. The global family remains unsupported because a selection that announces its own number, names a counter type, constrains the chosen set by name, repeats a mode, restarts the game, mints an object whose script is unpinned, or carries any decision token outside the reviewed sixteen remains refused rather than inherited.",
  },
  ordering: {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      'mtg-bc2.154.4.16 wire-owns orderAndPlaySimultaneousSa so mandatory position-pinned trigger abilities are ordered and placed on the stack without inherited AI policy, and mtg-fp4l phase 5 wire-owns every remaining callback this family reaches (orderSimultaneousSa, arrangeForScry, arrangeForSurveil, orderMoveToZoneList, orderCosts) by asking the seat which element goes next until the list is placed, admitting the ten position-pinned cards whose whole added surface over the reviewed choose-one profiles is a stated order or the partition that precedes one. The global family remains unsupported because a replacement-effect order, a partition into piles, an order stated over objects the seat cannot see, and every ordering carrying a decision token outside the reviewed twenty-seven remain separate shapes.',
  },
  combat: {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      "mtg-bc2.154.4.12 owns ordinary attacker and blocker declarations plus their combat-specific ordering and damage assignment, mtg-bc2.154.4.14 proves that profile composes with direct singleton non-stack targeting for eight position-pinned cards, mtg-bc2.154.4.16 composes it with mandatory singleton trigger targets for fourteen position-pinned cards, mtg-bc2.154.4.27 composes ordinary combat with Selfless Spirit's callback-free fixed self-sacrifice activation, and mtg-bc2.154.4.28 composes the same combat seam with Remorseful Cleric's selected-player graveyard exile. The global family remains unsupported because attack or block costs, exert, enlist, alternative assignment, banding, and card-specific combat choices remain separate callbacks or shapes.",
  },
  'replacement-trigger-choices': {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      'mtg-bc2.154.4.16 routes mandatory position-pinned triggers from orderAndPlaySimultaneousSa through the existing chooseTargetsFor MoveIds, mtg-bc2.154.4.17 reuses that exact seam for three noncombat-classified enchantments, mtg-bc2.154.4.18 admits only the exact Paladin Class level-three installed trigger, and mtg-fp4l wire-owns every callback this family reaches (playTrigger, confirmAction, confirmTrigger, confirmReplacementEffect, confirmStaticApplication, chooseSingleReplacementEffect, chooseSingleStaticAbility) so none of them is left for the inherited AI to answer on the seat behalf, admitting only the exact optional-trigger confirm cohort. The global family remains unsupported because trigger costs, modes, multiple or divided targets, nested choices, created objects, ordering among simultaneous triggers, other Class-installed triggers, and every replacement or static choice beyond a two-option confirm remain separate shapes.',
  },
  'naming-text-numbers': {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      "mtg-bc2.154.4.29 wire-owns chooseColors only for Coldsteel Heart's exact one-of-five mandatory entry choice, mtg-bc2.154.4.31 wire-owns chooseBinary only for Extinction Event's exact mandatory OddsOrEvens resolution, and mtg-fp4l wire-owns every remaining callback this family reaches whose question is a choice out of a list Forge has already enumerated (chooseColor, chooseColorAllowColorless, chooseSomeType, chooseSector, chooseProtectionType, chooseKeywordForPump, chooseCounterType, chooseSingleCardState, chooseSingleCardFace, chooseCardName over an enumerated face list, chooseOptionalCosts, chooseManaFromPool, getAbilityToPlay, playSaFromPlayEffect), admitting the position-pinned cards whose whole added surface is one such choice. mtg-fp4l phase 4 adds the announced number to that owned set through announceRequirements and chooseNumberForCostReduction, admitting the one position-pinned card whose enumerated choice sits beside a stated X. mtg-fp4l phase 6 adds the divided assignment through chooseTargetsFor and wires divideShield, which no card in this cube reaches and whose inherited answer discards a damage shield in silence, admitting the four position-pinned cards that divide one damage amount among the targets they pick. mtg-fp4l phase 8 adds open card naming through the predicate arm of chooseCardName and chooseSingleCardFace, which hands over no list at all: the wire carries a text box measured against the longest name the predicate admits, the seat types a name, and the bridge resolves it against the same card database Forge would have enumerated, admitting the one position-pinned card whose whole added surface is a name stated out of every card ever printed. The global family remains unsupported because every remaining text, restricted-set, defaulted, repeated, or nested choice outside those shapes throws in the bridge rather than reaching the inherited AI, and remains a separate callback or shape.",
  },
  'piles-votes': {
    bridgeStatus: 'unsupported',
    bridgeEvidence:
      'mtg-fp4l wire-owns vote, the callback a vote reaches, together with chooseCardsPile and the one-stop chooseNumber a vote asks for additional votes, so the seat casts its own vote rather than having the inherited AI cast it, admitting the three position-pinned cards whose vote is a choice out of a list Forge has already enumerated. The global family remains unsupported because pile construction, a vote whose additional count the player announces, and every vote reaching a shape outside the reviewed tokens remain separate callbacks or shapes.',
  },
  mulligan: {
    bridgeStatus: 'supported',
    bridgeEvidence:
      'mtg-bc2.151.11 overrides mulliganKeepHand and tuckCardsViaMulligan for the local seat; required Forge tests exercise keep, repeated mulligans, and every exact one- and two-card London bottom option.',
  },
  'starting-player': {
    bridgeStatus: 'supported',
    bridgeEvidence:
      'mtg-bc2.151.11 overrides chooseStartingPlayer for the local seat and the required Forge plus composed HTTP tests submit its backend-issued MoveId.',
  },
  'pregame-actions': {
    bridgeStatus: 'supported',
    bridgeEvidence:
      'mtg-n76vw overrides chooseSaToActivateFromOpeningHand for the local seat, routing it through session.chooseOpeningHandActions as a subset with a floor of zero; the New Phyrexia pregame-actions-v1 contract (mtg-j4ucd.5) pins both source regions and the engine and local Chancellor of the Dross scenario receipts.',
  },
};

export const LEGACY_CUBE_BRIDGE_MATCH_PROBE = {
  id: 'mtg-bc2.151.11-observed-priority-and-universal-match',
  cardNames: ['Flame Rift', 'Mountain'],
  families: ['priority', 'mulligan', 'starting-player'],
  evidence:
    'mtg-bc2.151.11 required integration runs completed real human-versus-Forge-AI matches using Mountain and Flame Rift after the local seat submitted backend-issued starting-player and keep or mulligan MoveIds, including exact one- and two-card London-mulligan bottom subsets. Only priority plus the two universal match families are attested; card-specific pregame and in-game choices remain unsupported.',
} as const;

/**
 * Positions whose complete script surface is the owned priority callback after
 * parameter-sensitive review. This list is affirmative evidence, not a query:
 * classifier drift must fail rather than silently promote another card.
 */
export const LEGACY_CUBE_PRIORITY_ONLY_SAFE_POSITIONS = [
  46, 56, 60, 61, 65, 72, 153, 203, 214, 226, 228, 233, 239, 297, 304, 318, 365, 369, 392, 441, 446, 475, 486,
  500, 510, 513, 520, 523, 528, 530, 531, 534, 536, 537, 540, 541, 544, 548, 549, 558, 560, 562, 564, 567,
  568, 570, 573, 574, 578, 580, 584, 585, 587, 588, 589, 591, 594, 599,
] as const;

export const LEGACY_CUBE_PRIORITY_ONLY_PROBE = {
  id: 'mtg-bc2.154.4.8-priority-only-cards',
  families: ['priority'],
  evidence:
    'mtg-bc2.154.4.8 loaded all 58 affirmatively reviewed priority-only official cards together in a legal 60-card deck through installed Forge 2.0.14, crossed starting-player and mulligan through backend-issued MoveIds, and completed the observed match. Exact script hashes and parameter-sensitive classification are separately pinned per position.',
} as const;

/**
 * Direct spell or activated-ability targets whose complete card-script surface
 * is priority plus one mandatory, non-stack target at a time. Trigger, aura,
 * equip, stack, optional, multi, divided, retarget, and nested zone-choice
 * routes are deliberately absent even when the coarse family tuple matches.
 */
export const LEGACY_CUBE_SINGLE_TARGET_SAFE_POSITIONS = [
  40, 43, 45, 55, 64, 78, 148, 157, 185, 202, 206, 208, 211, 213, 222, 234, 286, 287, 292, 293, 294, 298, 299,
  300, 302, 420, 422, 443, 447, 452, 457, 459, 463, 557,
] as const;

export const LEGACY_CUBE_SINGLE_TARGET_PROBE = {
  id: 'mtg-bc2.154.4.9-mandatory-single-target',
  families: ['priority', 'targets'],
  evidence:
    'mtg-bc2.154.4.9 loaded every affirmatively reviewed direct mandatory-singleton non-stack target card through installed Forge 2.0.14 and completed a real match in which a backend-issued target MoveId selected one exact permanent among duplicate-name candidates. Trigger, aura, equip, stack, optional, multi, divided, retarget, and nested zone-choice routes remain refused.',
} as const;

/**
 * Direct counterspells whose only target is one Card on the Stack. Remand's
 * Draw subability is non-targeting; any additional targeting block remains
 * outside this profile.
 */
export const LEGACY_CUBE_SINGLE_STACK_TARGET_SAFE_POSITIONS = [134, 135, 136, 137] as const;

export const LEGACY_CUBE_SINGLE_STACK_TARGET_PROBE = {
  id: 'mtg-bc2.154.4.11-single-stack-target',
  families: ['priority', 'targets'],
  evidence:
    'mtg-bc2.154.4.11 loaded Negate, Remand, Remove Soul, and Counterspell together through installed Forge 2.0.14 and completed a real match in which the local seat canceled an attempted Counterspell, recast it, selected the exact opponent Stack object by backend-issued MoveId, and observed Forge counter that exact spell instead of resolving it. Non-card, multi-zone, triggered, delegated, nested, multi, divided, and retarget shapes remain refused.',
} as const;

/**
 * Direct one-card library searches routed through Forge's exact filtered
 * CardCollection. The mandatory Entomb shape and optional fail-to-find land
 * searches share one callback but remain parameter-sensitive at runtime.
 */
export const LEGACY_CUBE_SINGLE_ZONE_CARD_SAFE_POSITIONS = [205, 370, 372] as const;

export const LEGACY_CUBE_SINGLE_ZONE_CARD_PROBE = {
  id: 'mtg-bc2.154.4.10-single-library-zone-card',
  families: ['priority', 'zone-card-selection'],
  evidence:
    "mtg-bc2.154.4.10 exercised installed Forge 2.0.14 with exact backend-issued library-card MoveIds: mandatory Entomb selected one exact duplicate-name card into the graveyard, and a restricted land search exposed both exact candidates and Forge's optional fail-to-find route. Multi-card, non-library, delayed-reveal, and nested routes remain refused.",
} as const;

/**
 * Cards whose only card-sensitive controller surface beyond priority is
 * ordinary combat. The profile owns complete incremental attack and block
 * declarations, combatant ordering, and ordinary damage assignment together;
 * no card here asks for a combat cost, exert, enlist, or an alternative damage
 * rule.
 */
export const LEGACY_CUBE_ORDINARY_COMBAT_SAFE_POSITIONS = [
  2, 7, 9, 14, 16, 17, 19, 23, 24, 30, 31, 34, 39, 63, 68, 74, 83, 101, 103, 106, 109, 162, 163, 164, 165,
  175, 176, 178, 182, 193, 197, 198, 200, 232, 244, 247, 255, 256, 257, 260, 261, 263, 264, 268, 270, 271,
  277, 325, 327, 328, 329, 331, 332, 336, 342, 343, 347, 351, 356, 357, 358, 360, 362, 364, 366, 368, 376,
  391, 397, 408, 438, 440, 442, 456, 468, 499, 529, 533, 550, 555, 559, 566, 571, 577, 590, 592,
] as const;

export const LEGACY_CUBE_ORDINARY_COMBAT_PROBE = {
  id: 'mtg-bc2.154.4.12-ordinary-combat',
  families: ['priority', 'combat'],
  evidence:
    'mtg-bc2.154.4.12 loaded all then-affirmatively-reviewed priority-plus-combat cards through installed Forge 2.0.14 and completed real matches whose local seat chose no attack, exact attacker subsets, exact blocker assignments, and a non-default legal trample assignment through complete incremental backend-issued MoveIds. After the ordinary-payment audit demoted one Phyrexian payer and Cloudgoat Ranger moved into the pinned-generated-object profile, 86 positions retain this profile. Combatant permutation and insertion paths are separately exercised at the same pinned bridge source. Attack and block costs, exert, enlist, optional triggered payments, optional copy replacements, alternative assignment, stale objects, illegal final declarations, and incomplete option lists remain refused.',
} as const;

/**
 * Cards whose complete surface composes the two already-owned card-level
 * profiles: ordinary combat and direct mandatory singleton non-stack targets.
 * Trigger, attachment, retarget, multi-target, and cost-selection paths are
 * excluded by a closed script guard before any position can be promoted.
 *
 * The exclusion list is what this profile reviewed and refused, and a position
 * on it is asserted to carry no profile at all. Position 492 left it when
 * `mtg-fp4l` phase 7 wired the retargeting callback the guard was refusing on:
 * the guard still refuses it here, so the position moved to the retarget arm of
 * the cohort rather than staying an exclusion that a later boundary quietly
 * contradicts.
 */
export const LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_SAFE_POSITIONS = [
  62, 67, 229, 278, 324, 339, 374, 553,
] as const;

export const LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_EXCLUDED_POSITIONS = [
  18, 110, 210, 246, 308, 384, 396, 416, 429, 437, 480, 509, 525,
] as const;

export const LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_PROBE = {
  id: 'mtg-bc2.154.4.14-ordinary-combat-single-target',
  families: ['priority', 'targets', 'combat'],
  evidence:
    'mtg-bc2.154.4.14 loaded all eight affirmatively reviewed composite-profile cards through installed Forge 2.0.14 and completed a real match in which one local seat exercised exact target identity and ordinary combat through backend-issued MoveIds. Trigger, optional, multi, divided, attachment, retarget, delegated, nested, stack, multizone, choice-cost, and unpinned transitive generated-object shapes remain refused.',
} as const;

/**
 * Ordinary combat cards whose only target selections are mandatory singleton
 * non-Stack targets made while a triggered ability is on the stack. The
 * trigger may target a card in one explicit zone or a player; follow-up card,
 * mana-color, generated-object, optional, and multi-target choices stay out.
 */
export const LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_SAFE_POSITIONS = [
  15, 77, 91, 98, 108, 183, 187, 188, 272, 353, 359, 398, 413, 436,
] as const;

export const LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_PROBE = {
  id: 'mtg-bc2.154.4.16-ordinary-combat-trigger-target',
  families: ['priority', 'targets', 'combat'],
  evidence:
    'mtg-bc2.154.4.16 loaded all fourteen affirmatively reviewed mandatory-singleton trigger-target cards through installed Forge 2.0.14 and exercised exact backend-issued target MoveIds across battlefield, graveyard, player, and trigger-relative candidates in sessions that also crossed ordinary combat. Optional, multi, divided, Stack, multizone, attachment, retarget, hidden follow-up, independent mana-color, and generated-object decision shapes remain refused.',
} as const;

/**
 * Noncombat-classified cards whose only target selection is one mandatory
 * singleton target on a top-level Forge T: trigger. Class-installed triggers,
 * attachments, optional targets, and nested choices remain separate shapes.
 */
export const LEGACY_CUBE_TRIGGER_TARGET_SAFE_POSITIONS = [47, 48, 51] as const;

export const LEGACY_CUBE_TRIGGER_TARGET_EXCLUDED_POSITIONS = [71, 309, 312, 402, 445, 521] as const;

export const LEGACY_CUBE_TRIGGER_TARGET_PROBE = {
  id: 'mtg-bc2.154.4.17-mandatory-singleton-trigger-target',
  families: ['priority', 'targets'],
  evidence:
    'mtg-bc2.154.4.17 loaded Journey to Nowhere, Banishing Light, and Oblivion Ring through installed Forge 2.0.14 and exercised an exact backend-issued target MoveId from a mandatory top-level enter-the-battlefield trigger. The complete pending priority-plus-targets cohort keeps Class-installed triggers, attachment, optional, multi-target, hidden-zone follow-up, and restart-game shapes refused.',
} as const;

/** The exact position-pinned Class whose level-three ability installs one owned trigger-target shape. */
export const LEGACY_CUBE_PALADIN_CLASS_SAFE_POSITIONS = [53] as const;

export const LEGACY_CUBE_PALADIN_CLASS_PROBE = {
  id: 'mtg-bc2.154.4.18-paladin-class-installed-trigger-target',
  families: ['priority', 'targets'],
  evidence:
    'mtg-bc2.154.4.18 exercised installed Forge 2.0.14 through both sorcery-speed Paladin Class level abilities, then selected one exact attacking creature by backend-issued target MoveId and observed the position-pinned level-three effect. Other Class scripts, levels, installed abilities, optional or multiple targets, and unrelated target blocks remain refused.',
} as const;

/** Exact position-pinned shocklands sharing one PayLife<2> entry-replacement callback. */
export const LEGACY_CUBE_SHOCKLAND_SAFE_POSITIONS = [
  535, 538, 542, 547, 565, 569, 575, 581, 593, 595,
] as const;

/** The rest of the complete priority-plus-optional-costs cohort remains refused. */
export const LEGACY_CUBE_SHOCKLAND_OPTIONAL_COST_EXCLUDED_POSITIONS = [322, 490] as const;

export const LEGACY_CUBE_SHOCKLAND_PROBE = {
  id: 'mtg-bc2.154.4.19-shockland-pay-two-life-entry-replacement',
  families: ['priority', 'optional-costs'],
  evidence:
    'mtg-bc2.154.4.19 loaded all ten position-pinned shocklands through installed Forge 2.0.14 and exercised both backend-issued pay-two-life and decline-to-enter-tapped choices, including invented and stale MoveId refusal. Other optional costs and replacement choices remain unsupported.',
} as const;

/** Exact position-pinned zero-cost Equip keywords using one owned target callback. */
export const LEGACY_CUBE_EQUIP_TARGET_SAFE_POSITIONS = [495, 516] as const;

export const LEGACY_CUBE_EQUIP_TARGET_PROBE = {
  id: 'mtg-bc2.154.4.20-mandatory-singleton-equip-target',
  families: ['priority', 'targets'],
  evidence:
    'mtg-bc2.154.4.20 loaded Grafted Wargear and Lightning Greaves together through installed Forge 2.0.14 and exercised exact backend-issued Equip target MoveIds, including duplicate-name candidates, invented and stale MoveId refusal, zero-cost reattachment, shroud legality, and the mandatory Grafted Wargear unattached sacrifice. Aura, auto-attach, optional, multi-target, nonlocal, multizone, triggered-target, and other Equipment shapes remain refused.',
} as const;

/** The exact cast-time creature Aura target owned for Control Magic only. */
export const LEGACY_CUBE_AURA_TARGET_SAFE_POSITIONS = [107] as const;

export const LEGACY_CUBE_AURA_TARGET_PROBE = {
  id: 'mtg-bc2.154.4.21-mandatory-singleton-aura-target',
  families: ['priority', 'targets'],
  evidence:
    'mtg-bc2.154.4.21 loaded Control Magic through installed Forge 2.0.14 and exercised exact backend-issued cast-time Aura target MoveIds among duplicate-name creatures, including cancel and recast, invented and stale MoveId refusal, exact control transfer, and restoration when the Aura left. Other Auras, Equipment, triggered attachment, optional or multiple targets, and unrelated target routes remain refused.',
} as const;

/** Faith's Fetters alone: permanent Aura target plus exact attached rules. */
export const LEGACY_CUBE_FETTERS_AURA_TARGET_SAFE_POSITIONS = [59] as const;

export const LEGACY_CUBE_FETTERS_AURA_TARGET_PROBE = {
  id: 'mtg-bc2.154.4.22-faiths-fetters-aura-target',
  families: ['priority', 'targets'],
  evidence:
    "mtg-bc2.154.4.22 loaded Faith's Fetters through installed Forge 2.0.14 in focused artifact and creature sessions and exercised its exact backend-issued cast-time permanent target MoveIds, including duplicate-name candidates, cancel and recast, invented and stale MoveId refusal, four life gained, attack/block and non-mana-activation prohibition, mana-ability permission, and restoration when the Aura left. The bridge now applies Forge's explicit activated-ability restriction predicate before exposing priority actions. Other permanent-target Auras and every adjacent attachment or decision shape remain refused.",
} as const;

/** Fall from Favor alone: creature Aura target plus exact monarch lock. */
export const LEGACY_CUBE_FALL_AURA_TARGET_SAFE_POSITIONS = [160] as const;

export const LEGACY_CUBE_FALL_AURA_TARGET_PROBE = {
  id: 'mtg-bc2.154.4.23-fall-from-favor-aura-target',
  families: ['priority', 'targets'],
  evidence:
    "mtg-bc2.154.4.23 loaded Fall from Favor through installed Forge 2.0.14 and exercised its exact backend-issued cast-time creature target MoveIds among duplicate-name creatures, including cancel and recast, invented and stale MoveId refusal, exact attachment, entry tap, the monarch end-step draw, conditional untap prevention while the enchanted creature's controller lacked the crown, crown transfer through combat damage, and untap restoration on that controller's following turn. Forge 2.0.14's full-simulation GameCopier cannot map the command-zone monarch rule card; only sessions containing this exact card select Forge's hybrid AI, while all other sessions retain full simulation. Other creature-target Auras, unrelated monarch cards, and every adjacent attachment or decision shape remain refused.",
} as const;

/** Baneslayer Angel alone: a closed fixed-keyword combat profile with no callbacks. */
export const LEGACY_CUBE_BANESLAYER_PROTECTION_SAFE_POSITIONS = [36] as const;

/** The remaining cards with the same coarse family tuple make different choices. */
export const LEGACY_CUBE_BANESLAYER_PROTECTION_EXCLUDED_POSITIONS = [22, 66, 76, 491] as const;

export const LEGACY_CUBE_BANESLAYER_PROTECTION_PROBE = {
  id: 'mtg-bc2.154.4.24-baneslayer-fixed-protection',
  families: ['priority', 'combat', 'naming-text-numbers'],
  evidence:
    "mtg-bc2.154.4.24 loaded Baneslayer Angel through installed Forge 2.0.14 and exercised its ordinary combat, flying, first-strike damage step, lifelink, and fixed protection from both Demon and Dragon sources. The script has no callback, mode, target, trigger, activation, replacement, generated object, or choice; Brightling, Serra's Emissary, Iona, Shield of Emeria, Phyrexian Revoker, and every other naming or typed-choice shape remain refused.",
} as const;

/** Chart a Course alone: draw two, then one local-hand discard unless Raid is active. */
export const LEGACY_CUBE_CHART_A_COURSE_DISCARD_SAFE_POSITIONS = [128] as const;

/**
 * Every other installed script with a target-chosen Discard effect, refused by
 * this profile.
 *
 * Nine of them (87, 88, 138, 141, 172, 189, 433, 450, 471) were later admitted
 * by `bounded-multi-selection-v1`, which reviewed the same scripts as one
 * bounded selection out of a list Forge has already enumerated. Refused here
 * means this profile does not reach them, not that the ledger never can.
 */
export const LEGACY_CUBE_CHART_A_COURSE_DISCARD_EXCLUDED_POSITIONS = [
  85, 86, 87, 88, 95, 138, 141, 145, 172, 189, 196, 223, 253, 284, 433, 434, 450, 453, 471, 478, 517,
] as const;

export const LEGACY_CUBE_CHART_A_COURSE_DISCARD_PROBE = {
  id: 'mtg-bc2.154.4.25-chart-a-course-discard',
  families: ['priority', 'zone-card-selection'],
  evidence:
    'mtg-bc2.154.4.25 loaded Chart a Course through installed Forge 2.0.14 and exercised both exact branches: without an attack the local seat selected one exact same-name hand object by backend-issued MoveId after drawing two, while after attacking Forge resolved without a discard decision. Invented, stale, and cross-zone identities were refused without revealing the opposing hand. Every other discard-selection script remains outside this profile.',
} as const;

/** The complete, byte-reviewed Legacy Cube cohort with Forge's Level up keyword. */
export const LEGACY_CUBE_REVIEWED_LEVEL_UP_SAFE_POSITIONS = [6, 330, 380] as const;

/** Every installed Level up script is admitted by the reviewed profile. */
export const LEGACY_CUBE_REVIEWED_LEVEL_UP_EXCLUDED_POSITIONS = [] as const;

export const LEGACY_CUBE_REVIEWED_LEVEL_UP_PROBE = {
  id: 'mtg-z5q4.15-reviewed-level-up',
  families: ['priority', 'optional-costs', 'combat'],
  evidence:
    'mtg-bc2.154.4.26 and mtg-z5q4.15 loaded the complete three-card Legacy Cube Level up cohort through installed Forge 2.0.14. Student of Warfare exercised sorcery timing, exact counter progression, both printed stat-and-keyword bands, and ordinary combat. Joraga Treespeaker reached level 1 as a 1/2 and then supplied its granted two-green mana ability to cast another spell. Hexdrinker reached level 3 as a 4/4 and level 8 as a 6/6. Every admitted script is matched line for line; Class levels, new level costs, new bands, counter choices, and additional mechanics remain unsupported.',
} as const;

/** Selfless Spirit alone: fixed self-sacrifice for one exact temporary team effect. */
export const LEGACY_CUBE_SELFLESS_SPIRIT_SAFE_POSITIONS = [12] as const;

/** No other official script has Selfless Spirit's complete activated-ability shape. */
export const LEGACY_CUBE_SELFLESS_SPIRIT_EXCLUDED_POSITIONS = [] as const;

export const LEGACY_CUBE_SELFLESS_SPIRIT_PROBE = {
  id: 'mtg-bc2.154.4.27-selfless-spirit-self-sacrifice-indestructible',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    'mtg-bc2.154.4.27 loaded Selfless Spirit through installed Forge 2.0.14 and exercised its exact callback-free self-sacrifice activation, the source moving to its graveyard as the fixed cost, creatures the local seat controlled surviving destroy while the effect lasted, that protection expiring before a later destroy, flying, and ordinary combat. Every other sacrifice cost, affected set, keyword, duration, target, choice, mode, and additional mechanic remains unsupported.',
} as const;

/** Remorseful Cleric alone: fixed self-sacrifice and one selected player's whole graveyard. */
export const LEGACY_CUBE_REMORSEFUL_CLERIC_SAFE_POSITIONS = [10] as const;

/** No other official script has Remorseful Cleric's complete activated-ability shape. */
export const LEGACY_CUBE_REMORSEFUL_CLERIC_EXCLUDED_POSITIONS = [] as const;

export const LEGACY_CUBE_REMORSEFUL_CLERIC_PROBE = {
  id: 'mtg-bc2.154.4.28-remorseful-cleric-self-sacrifice-target-graveyard-exile',
  families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    "mtg-bc2.154.4.28 loaded Remorseful Cleric through installed Forge 2.0.14 and exercised its exact fixed self-sacrifice activation, one backend-selected player target, every card in only that player's graveyard moving to exile, flying, and ordinary combat. Individual graveyard-card selection, other costs, targets, origins, affected sets, destinations, counts, callbacks, choices, modes, and additional mechanics remain unsupported.",
} as const;

/** Coldsteel Heart alone: mandatory WUBRG entry choice and mana of that chosen color. */
export const LEGACY_CUBE_COLDSTEEL_HEART_SAFE_POSITIONS = [504] as const;

/** Other installed scripts using the same keyword have materially different complete shapes. */
export const LEGACY_CUBE_COLDSTEEL_HEART_EXCLUDED_POSITIONS = [76, 367] as const;

export const LEGACY_CUBE_COLDSTEEL_HEART_PROBE = {
  id: 'mtg-bc2.154.4.29-coldsteel-heart-entry-color-chosen-mana',
  families: ['priority', 'naming-text-numbers'],
  evidence:
    'mtg-bc2.154.4.29 loaded Coldsteel Heart through installed Forge 2.0.14, selected exactly one of the five supplied colors by backend-issued MoveId as it entered, observed it enter tapped and later untap, then activated that exact source for the selected red mana to pay Flame Rift from a deck with no other red source. Iona, Utopia Sprawl, all other color sets, colorless, multi-color, name, text, type, number, nested choices, and additional mechanics remain unsupported.',
} as const;

/** Extinction Event alone: one odd/even choice followed by the matching creature exile. */
export const LEGACY_CUBE_EXTINCTION_EVENT_SAFE_POSITIONS = [235] as const;

/** No other official script has Extinction Event's complete closed shape. */
export const LEGACY_CUBE_EXTINCTION_EVENT_EXCLUDED_POSITIONS = [] as const;

export const LEGACY_CUBE_EXTINCTION_EVENT_PROBE = {
  id: 'mtg-bc2.154.4.31-extinction-event-odd-even-exile',
  families: ['priority', 'naming-text-numbers'],
  evidence:
    'mtg-bc2.154.4.31 loads Extinction Event through installed Forge 2.0.14, exposes only its mandatory odd-or-even binary choice by backend-issued MoveId, and proves each branch exiles exactly the matching battlefield creatures, including mana value zero in the even branch. Every other binary type, chooser, affected set, zone change, stored value, callback, and additional mechanic remains unsupported.',
} as const;

/** Exact Forge implementation evidence for Extinction Event's stored parity choice. */
export const LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION = {
  classPath: 'forge/game/ability/effects/ChooseEvenOddEffect.class',
  classSha256: '707fe1a0291eb0e54ad1daf12407ec1544ce19e977fdded2a21018105835eb50',
  upstream: {
    repository: 'Card-Forge/forge',
    revision: 'a37a865a53280dd8ad6fad3384d69611e8c5a42f',
    path: 'forge-game/src/main/java/forge/game/ability/effects/ChooseEvenOddEffect.java',
    blobSha1: '8f5e0a8594aa7694154b1c522a2cfe4ad0e912de',
    sourceSha256: '1bb898324cd087b268d9ddec7cf357e32ce896a94eae5f7919c310b5fb7e34ab',
  },
} as const;

/**
 * The three optional triggers whose whole answer is one yes-or-no.
 *
 * `mtg-fp4l` phase 1. Each of these cards asks the seat to confirm a trigger and
 * then resolves a closed effect that chooses nothing further: two cards drawn,
 * one card drawn, or the source itself returning from the graveyard. The other
 * three cards in the same family signature create a token, and a token is an
 * object with its own decisions.
 *
 * Which callback Forge reaches for is not knowable from the card text and was
 * read off a live match: Consecrated Sphinx's trigger is mandatory and its
 * *draw* is the optional half, so Forge asks through `confirmAction` and never
 * wraps the ability for `confirmTrigger`. Both are wired to the same confirm
 * shape, which is why the profile is stated over the shape rather than over one
 * callback name.
 */
export const LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_SAFE_POSITIONS = [116, 171, 426] as const;

/** No optional-confirm row remains excluded after the exact token compositions are reviewed. */
export const LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_EXCLUDED_POSITIONS = [] as const;

export const LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_PROBE = {
  id: 'mtg-fp4l-optional-trigger-confirm',
  families: ['priority', 'combat', 'replacement-trigger-choices'],
  evidence:
    "mtg-fp4l loads Consecrated Sphinx through installed Forge 2.0.14 and proves its optional draw trigger reaches the local seat as a two-option confirm decision rather than an answer the AI gives on the seat's behalf: declining draws nothing, accepting draws exactly two. Trigger costs, modes, targets, divided targets, nested choices, created objects, ordering among simultaneous triggers, and every replacement choice remain outside the profile.",
} as const;

/**
 * The thirty-nine cards whose whole added surface is a bounded selection from a
 * list the engine has already enumerated.
 *
 * `mtg-fp4l` phase 2. A choose-many is the wired choose-one run in a loop with
 * a Done option, so these eight family signatures are one profile rather than
 * eight: what separates them is which other reviewed family the card also
 * carries, not what the selection callback is asked. They stay eight rows
 * because the reviews table compares a card's family signature exactly, and a
 * position may not borrow the review written for a different signature.
 */
export const LEGACY_CUBE_BOUNDED_MULTI_SELECTION_COHORTS: readonly {
  readonly families: readonly LegacyCubeDecisionFamily[];
  readonly positions: readonly number[];
}[] = [
  {
    families: ['priority', 'zone-card-selection', 'combat'],
    positions: [87, 88, 172, 245, 250, 259, 306, 348, 349, 352, 469, 489, 502],
  },
  { families: ['priority', 'targets', 'zone-card-selection', 'combat'], positions: [94] },
  { families: ['priority', 'targets', 'modes', 'combat'], positions: [96, 439] },
  {
    families: ['priority', 'targets', 'zone-card-selection'],
    positions: [138, 147, 204, 207, 209, 216, 225, 241, 319, 433, 471, 472],
  },
  { families: ['priority', 'zone-card-selection'], positions: [139, 141, 201, 217, 375, 414, 598] },
  { families: ['priority', 'modes', 'zone-card-selection', 'combat'], positions: [189] },
  { families: ['priority', 'targets', 'modes'], positions: [289, 465] },
  { families: ['priority', 'targets', 'modes', 'zone-card-selection'], positions: [388, 450] },
];

export const LEGACY_CUBE_BOUNDED_MULTI_SELECTION_SAFE_POSITIONS: readonly number[] =
  LEGACY_CUBE_BOUNDED_MULTI_SELECTION_COHORTS.flatMap((cohort) => cohort.positions).sort(
    (left, right) => left - right,
  );

/**
 * Cards within the profile's family population whose callback shapes remain refused.
 *
 * Two signatures were originally refused entire, which is why this list is
 * flat and the cohorts above are not. Elder Gargaroth remains refused;
 * Prismari Command remains excluded from this generic profile because its
 * stricter whole-card profile owns the exact two-mode composition instead.
 */
export const LEGACY_CUBE_BOUNDED_MULTI_SELECTION_EXCLUDED_POSITIONS = [
  21, 113, 115, 145, 149, 158, 167, 168, 181, 184, 190, 196, 199, 212, 215, 238, 253, 280, 307, 345, 387, 389,
  403, 418, 421, 434, 448, 460, 478, 481, 484, 498, 503, 506, 508, 522, 583,
] as const;

export const LEGACY_CUBE_BOUNDED_MULTI_SELECTION_PROBE = {
  id: 'mtg-fp4l-bounded-multi-selection',
  families: ['priority', 'targets', 'modes', 'zone-card-selection', 'combat'],
  evidence:
    "mtg-fp4l loads Thirst for Knowledge and Knight of Autumn through installed Forge 2.0.14 and proves the seat answers a bounded selection itself rather than having the AI answer it on its behalf. The discard is offered one card at a time out of the seat's own hand, the Done option appears only once the count it would satisfy is reachable, naming the artifact ends the selection one card early and the hand loses exactly one, and declining it costs exactly two. Knight of Autumn offers only its legal modes in the same shape, and the mode the seat takes is the mode that resolves: the seat gains exactly four life. Selections that announce a number, name a counter type, constrain the chosen set, restart the game, or mint an object whose own script is unpinned remain outside the profile.",
} as const;

/**
 * The nine cards whose whole added surface is one choice out of a list Forge
 * has already enumerated.
 *
 * `mtg-fp4l` phase 3. A protection quality, a card type, a color, a vote and a
 * two-option modal choice are one question asked five ways: Forge hands the
 * bridge the complete list of legal answers and takes one back. They stay six
 * rows for the reason the phase-2 cohorts stay eight -- the reviews table
 * compares a card's family signature exactly, and a position may not borrow the
 * review written for a different signature.
 */
export const LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_COHORTS: readonly {
  readonly families: readonly LegacyCubeDecisionFamily[];
  readonly positions: readonly number[];
}[] = [
  { families: ['priority', 'targets', 'combat', 'naming-text-numbers'], positions: [1, 5] },
  { families: ['priority', 'combat', 'naming-text-numbers'], positions: [22, 66, 76] },
  { families: ['priority', 'zone-card-selection', 'combat', 'naming-text-numbers'], positions: [515] },
  { families: ['priority', 'piles-votes'], positions: [52] },
  { families: ['priority', 'combat', 'piles-votes'], positions: [425] },
  { families: ['priority', 'zone-card-selection', 'piles-votes'], positions: [524] },
];

export const LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_SAFE_POSITIONS: readonly number[] =
  LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_COHORTS.flatMap((cohort) => cohort.positions).sort(
    (left, right) => left - right,
  );

/**
 * The ten cards in the same signatures the profile refuses, each for a question
 * the wired choose-one cannot carry.
 *
 * Four announce or divide a number (279, 419, 435, 556), three partition or
 * peek at a hidden set (144, 223, and Fact or Fiction's reveal), one names a
 * card out of every card ever printed (491), one names a keyword out of a
 * keyword list Forge does not enumerate (25), and two carry a trigger or
 * attachment target no reviewed profile reaches yet (305, 367).
 */
export const LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_EXCLUDED_POSITIONS = [
  25, 144, 223, 279, 305, 367, 419, 435, 491, 556,
] as const;

export const LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_PROBE = {
  id: 'mtg-fp4l-bounded-enumerated-choice',
  families: ['priority', 'zone-card-selection', 'combat', 'naming-text-numbers', 'piles-votes'],
  evidence:
    "mtg-fp4l loads Iona, Shield of Emeria, Serra's Emissary, Mother of Runes, Brightling, Coercive Portal and Council's Judgment through installed Forge 2.0.14 and proves the seat answers each enumerated choice itself rather than having the controller it inherits from answer on its behalf. Iona offers exactly the five colors and the color the seat names is the color its opponent then cannot cast, measured as walls that stop arriving while the hand they came from keeps growing; Mother of Runes offers the five protection qualities its own script lists; Brightling offers its two pump modes and the mode the seat takes is the mode that resolves, read off the board as a 3/3 becoming a 4/2; Coercive Portal offers its two vote options and the seat votes one of them; Council's Judgment offers the permanents its own script names and the permanent the seat votes for is the permanent that leaves, while the ones it did not vote for stay. Two of those are measured as the question rather than as its effect, because the projection carries no keywords and no vote tally: Serra's Emissary is checked to offer exactly Forge's card types, and Coercive Portal's own outcome is not answer-dependent with two voters, since a tied vote is homage either way. Open card naming, an announced or divided number, a partition into piles, and every keyword choice Forge does not enumerate remain outside the profile: the bridge throws on each rather than answering it.",
} as const;

/**
 * Cards whose numbers fit the announced-number payment and selection boundary.
 *
 * `mtg-fp4l` phase 4. An X in a printed cost, an X in an activation cost and
 * the amount an effect then uses are one question asked at three moments, and
 * Forge asks all three through the same pair of callbacks: it announces what
 * the cost requires and takes a number back. They stay seven rows for the
 * reason the phase-2 and phase-3 cohorts stay eight and six -- the reviews
 * table compares a card's family signature exactly, and a position may not
 * borrow the review written for a different signature.
 *
 * `mtg-z5q4.1` also reviews eight cards with a derived SVar:X rather than a
 * player-announced X. The narrower profiles refuse that spelling even when
 * Forge computes it: discard counts, damage received, mana value, devotion,
 * and counters. These cards add no announcement callback. Their full scripts
 * still pass this profile's unchanged boundary and the separate cost check.
 */
export const LEGACY_CUBE_ANNOUNCED_NUMBER_COHORTS: readonly {
  readonly families: readonly LegacyCubeDecisionFamily[];
  readonly positions: readonly number[];
}[] = [
  { families: ['priority', 'mana-x'], positions: [221, 449, 494, 511, 543, 551] },
  { families: ['priority', 'mana-x', 'combat'], positions: [326, 335, 340, 431, 582] },
  { families: ['priority', 'mana-x', 'zone-card-selection'], positions: [399, 401] },
  { families: ['priority', 'targets', 'mana-x'], positions: [73, 75, 154, 313, 315] },
  { families: ['priority', 'mana-x', 'combat', 'naming-text-numbers'], positions: [505] },
  { families: ['priority', 'targets', 'mana-x', 'combat'], positions: [527] },
  { families: ['priority', 'targets', 'mana-x', 'zone-card-selection'], positions: [237, 410, 482] },
  { families: ['priority', 'targets', 'zone-card-selection'], positions: [145] },
  { families: ['priority', 'zone-card-selection', 'combat'], positions: [167, 190, 280] },
  { families: ['priority', 'zone-card-selection'], positions: [212, 522] },
  { families: ['priority', 'targets', 'combat'], positions: [308] },
  { families: ['priority', 'naming-text-numbers'], positions: [556] },
];

export const LEGACY_CUBE_ANNOUNCED_NUMBER_SAFE_POSITIONS: readonly number[] =
  LEGACY_CUBE_ANNOUNCED_NUMBER_COHORTS.flatMap((cohort) => cohort.positions).sort(
    (left, right) => left - right,
  );

/**
 * The thirteen cards in the same signatures the profile refuses.
 *
 * Seven pay a cost out of something other than mana (33, 58, 111, 195, 310,
 * 400, 462: convoke, improvise and delve are each a different set of permanents
 * or cards somebody has to choose). Two pay life or mana at the caster's choice
 * for a Phyrexian symbol (474, 493), which is the same pair the ordinary
 * payment profile demoted. One makes two mana of different colors at once
 * (507), which is the one route left to `specifyManaCombo`. Three were already
 * refused by boundaries the earlier phases wrote, and are listed here because
 * this profile is where they were measured: one divides its announced number
 * among targets (404), one mints an object whose own script was never pinned
 * (514), and one spends its X and then offers a second, optional target inside
 * a sub-ability (344 Primal Might), which is `nested target block` and
 * `optional target` at once.
 *
 * Phase 6 admits 404 and this list still names it, which is the two statements
 * being about different things rather than a contradiction. A position is
 * listed here when this profile's own signature covers it and this profile's
 * own boundary refuses it, and both stay true: the announced-number boundary
 * has no reviewed token for a division and never will. What changed is that a
 * later profile, written against the shape this one refuses, now admits the
 * card. The admission arms are ordered, and the announced-number arm reads the
 * safe list rather than this one, so 404 reaches the distribution profile.
 */
export const LEGACY_CUBE_ANNOUNCED_NUMBER_EXCLUDED_POSITIONS = [
  33, 58, 111, 195, 310, 344, 400, 404, 462, 474, 493, 507, 514,
] as const;

export const LEGACY_CUBE_ANNOUNCED_NUMBER_PROBE = {
  id: 'mtg-fp4l-announced-number',
  families: ['priority', 'targets', 'mana-x', 'zone-card-selection', 'combat', 'naming-text-numbers'],
  evidence:
    "mtg-fp4l loads Stonecoil Serpent and Toxic Deluge through installed Forge 2.0.14 and proves the seat states the number a cost requires itself rather than having the controller it inherits from state it. Both arms of announceRequirements are in the one table: Stonecoil Serpent announces the X in a mana cost and enters with that many +1/+1 counters, and Toxic Deluge announces an X paid in life, the arm bounded by getMaxForNonManaX, which is then spent through the cost seam getCostDecisionMaker now owns. The bridge's spinner drew stops 0 through 9 on both, the seat took 2 on both, and the board read that number back twice: the serpent resolved 2/2, and the deluge cost exactly 2 life, 20 down to 18. Neither reading is vacuous, because a larger announcement was standing unchosen on the same spinner and Forge's AI spends the board on an X, and because the opposing board was 27 Wall of Omens at 0/4: a -2/-2 leaves all 27 standing, where the 4 the same spinner offered would have swept them. The mtg-z5q4 derived-amount extension additionally proves Koth of the Hammer computes five mana from five Mountains without an X prompt, offers the ultimate at exactly five loyalty, and leaves an emblem whose granted Mountain ability deals one damage to the chosen opponent. Nykthos, Shrine to Nyx pays two mana before the seat chooses white and produces the measured devotion, including exact restoration after cancellation before payment and after one land was tapped. An underfunded Koth cast likewise cancels with its hand object, land and life restored. These are the additional installed-Forge runtime witnesses; Exhume additionally returns the human's chosen creature from two graveyard options and an opposing creature through the public-graveyard callback; the other five added cards retain script-boundary review rather than individual board probes. Open card naming, an announced number divided among targets, a partition into piles, and a cost paid by choosing permanents or cards rather than mana all remain outside the profile: the bridge throws on each rather than answering it.",
} as const;

/**
 * The ten cards whose whole added surface over a bounded choice is an order.
 *
 * `mtg-fp4l` phase 5. A scry, a surveil and a hand-to-library reorder are one
 * shape read three ways -- the top of a library split in two, and the half that
 * stays put stated top card first -- and Forge asks all three through the
 * ordering callbacks `PlayerController` declares abstract. They stay five rows
 * for the reason the phase-2, phase-3 and phase-4 cohorts stay eight, six and
 * seven: the reviews table compares a card's family signature exactly, and a
 * position may not borrow the review written for a different signature.
 */
export const LEGACY_CUBE_STATED_ORDERING_COHORTS: readonly {
  readonly families: readonly LegacyCubeDecisionFamily[];
  readonly positions: readonly number[];
}[] = [
  { families: ['priority', 'zone-card-selection', 'ordering'], positions: [123, 124, 126, 127, 219, 432] },
  { families: ['priority', 'zone-card-selection', 'ordering', 'combat'], positions: [243] },
  { families: ['priority', 'targets', 'zone-card-selection', 'ordering'], positions: [470] },
  { families: ['priority', 'targets', 'zone-card-selection', 'ordering', 'combat'], positions: [412] },
  {
    families: ['priority', 'targets', 'modes', 'zone-card-selection', 'ordering', 'combat'],
    positions: [8],
  },
];

export const LEGACY_CUBE_STATED_ORDERING_SAFE_POSITIONS: readonly number[] =
  LEGACY_CUBE_STATED_ORDERING_COHORTS.flatMap((cohort) => cohort.positions).sort(
    (left, right) => left - right,
  );

/**
 * The profile refuses none of its own cohort, and that emptiness is measured
 * rather than assumed.
 *
 * Every earlier profile split its population into an admitted list and a
 * refused one, because each was a boundary drawn through a family somebody had
 * already read. This one is the whole of what carries `ordering` once the cards
 * that also carry a cost choice or a replacement choice are removed by the
 * family filter itself, and running the refusal boundary over all ten returns
 * exactly one refusal each -- the ordering token the profile is being written
 * to admit. So the list is empty, and the builder still walks it: the day a
 * card lands in the cohort that this boundary does refuse, the drift check
 * fails rather than the card being quietly admitted.
 */
export const LEGACY_CUBE_STATED_ORDERING_EXCLUDED_POSITIONS = [] as const;

export const LEGACY_CUBE_STATED_ORDERING_PROBE = {
  id: 'mtg-fp4l-stated-ordering',
  families: ['priority', 'targets', 'modes', 'zone-card-selection', 'ordering', 'combat'],
  evidence:
    "mtg-fp4l loads Dragon's Rage Channeler, Preordain and Brainstorm through installed Forge 2.0.14 and proves the seat states the order rather than inheriting one. All three ordering shapes appear in one game seeded fp4l-5-stated-ordering, which the probe plays to turn 8 over 87 decisions: the surveil offers the one card the channeler saw plus a stop, and the card the seat sent down is in the graveyard; the scry offers both cards to the bottom plus the same stop, the seat sends neither, and the card it then leaves closest to the top is the card it draws; the hand-to-library reorder offers both cards Brainstorm is putting back, and the one the seat placed first comes back first. Each assertion is made against the object id the decision option carries rather than against a card name, because the deck runs twelve copies of each spell and a name would let the wrong copy satisfy it. The partition and the order are separate questions, which is why the scry keeps both cards on top: a partition that emptied one side would leave nothing for the order to be about. A replacement-effect order, a partition into piles, an order stated over objects the seat cannot see, and any ordering carrying a decision token outside the reviewed twenty-seven remain outside the profile: the bridge throws on each rather than answering it.",
} as const;

/**
 * The four cards whose whole added surface is an amount the seat divides.
 *
 * `mtg-fp4l` phase 6. Every `DividedAsYouChoose` in the audited corpus is here
 * and every one of them divides damage: Inferno Titan's three, Polukranos's
 * monstrosity, Dragonlord Atarka's five and Electrolyze's two. Their family
 * signatures are all subsets of the announced-number families, so unlike every
 * earlier phase the cohort cannot be named by a family filter -- `mana-x` and
 * `ordering` each named their own phase and a division names none. The builder
 * reads this cohort off the script shape instead, which is the same evidence
 * the boundary below is written against.
 */
export const LEGACY_CUBE_STATED_DISTRIBUTION_COHORTS: readonly {
  readonly families: readonly LegacyCubeDecisionFamily[];
  readonly positions: readonly number[];
}[] = [
  { families: ['priority', 'targets', 'naming-text-numbers'], positions: [435] },
  { families: ['priority', 'targets', 'combat', 'naming-text-numbers'], positions: [279, 419] },
  {
    families: ['priority', 'targets', 'mana-x', 'combat', 'naming-text-numbers'],
    positions: [404],
  },
];

export const LEGACY_CUBE_STATED_DISTRIBUTION_SAFE_POSITIONS: readonly number[] =
  LEGACY_CUBE_STATED_DISTRIBUTION_COHORTS.flatMap((cohort) => cohort.positions).sort(
    (left, right) => left - right,
  );

/**
 * The profile refuses none of its own cohort, measured the way phase 5 measured
 * its own empty list.
 *
 * The population is every position whose script divides, and the boundary
 * returns nothing for all four once the four refusals this phase was written to
 * lift are lifted. So the list is empty and the builder still walks it: the day
 * a fifth divided card lands in the corpus carrying a shape this boundary does
 * refuse, the drift check fails rather than the card being quietly admitted.
 */
export const LEGACY_CUBE_STATED_DISTRIBUTION_EXCLUDED_POSITIONS = [] as const;

export const LEGACY_CUBE_STATED_DISTRIBUTION_PROBE = {
  id: 'mtg-fp4l-stated-distribution',
  families: ['priority', 'targets', 'mana-x', 'combat', 'naming-text-numbers'],
  evidence:
    'mtg-fp4l loads Electrolyze through installed Forge 2.0.14 and proves the seat states how an amount is divided rather than inheriting a division. The table is seeded fp4l-6-stated-distribution and reaches the spell on turn 5 with four Llanowar Elves standing on the other side of it. The bridge asks the division as one decision per point, and both decisions offer the same six candidates: the two players and all four elves. The seat put its first point on one elf and its second on a second elf, and the second decision is where the choice is legible, because the first elf was still on the list: two on one creature was there to be taken and was declined. The board then reads the division back rather than the amount, since one point is lethal to a 1/1 and two on either one is not: both elves the seat named are gone and the two it did not name are still standing. Every assertion is made against the object id the option carries rather than against a card name, because the deck runs thirty-six elves and a name would let a third one satisfy it. A division that is not the whole of one damage effect stays outside the profile: an Aura or Equip target, a target in the Stack zone, a random or delegated target, a second target block beside the divided one, and a division over an amount the script does not state each throw in the bridge rather than being answered. divideShield is wired to the same assign-one shape and no card in this cube reaches it, since its one caller is gated on a SpellAbility parameter no audited position carries and the answer it would otherwise inherit discards the shield in silence.',
} as const;

/**
 * The one card whose whole added surface is a target it moves.
 *
 * `mtg-fp4l` phase 7. Spellskite is the only `ChangeTargets` in the audited
 * corpus, and its shape is the bounded half of retargeting: `ChangeSingleTarget`
 * makes the question "which of this stack object's targets moves",
 * `DefinedMagnet` states where it moves to, and Forge checks that with
 * `canTarget`, so the seat picks the target to take away and never picks the
 * one it is given to. Its family signature is the ordinary combat-and-target
 * one every creature with a targeted activated ability carries, so like phase 6
 * the cohort cannot be named by a family filter and the builder reads it off the
 * script shape instead, which is the same evidence the boundary below is
 * written against.
 */
export const LEGACY_CUBE_STATED_RETARGET_COHORTS: readonly {
  readonly families: readonly LegacyCubeDecisionFamily[];
  readonly positions: readonly number[];
}[] = [{ families: ['priority', 'targets', 'combat'], positions: [492] }];

export const LEGACY_CUBE_STATED_RETARGET_SAFE_POSITIONS: readonly number[] =
  LEGACY_CUBE_STATED_RETARGET_COHORTS.flatMap((cohort) => cohort.positions).sort(
    (left, right) => left - right,
  );

/**
 * The profile refuses none of its own cohort, measured the way phases 5 and 6
 * measured their own empty lists.
 *
 * The population is every position whose script changes a target, and there is
 * one. The builder still walks this list: the day a second retargeting card
 * lands in the corpus carrying a shape this boundary does refuse, the drift
 * check fails rather than the card being quietly admitted.
 */
export const LEGACY_CUBE_STATED_RETARGET_EXCLUDED_POSITIONS = [] as const;

export const LEGACY_CUBE_STATED_RETARGET_PROBE = {
  id: 'mtg-fp4l-stated-retarget',
  families: ['priority', 'targets', 'combat'],
  evidence:
    "mtg-fp4l loads Spellskite through installed Forge 2.0.14 and proves the seat takes a target off a spell it cast itself rather than inheriting the redirection. The table is seeded fp4l-7-stated-retarget and reaches the shape on turn 5: the seat casts Lightning Bolt at the Forge AI player, keeps priority with the Bolt on the stack, and activates the {U/P} ability. The activation names its own target first, and the stack offers exactly one thing to name -- Target Lightning Bolt -- because a ChangeTargets targets the object whose targets it will change. The retarget is then asked as Change a target with Spellskite and offers exactly one pair, Take Lightning Bolt's target Forge AI, because the Bolt has one target and DefinedMagnet states where it goes rather than asking. The board reads the redirection back rather than the transcript: the player the Bolt named is still on 20 and Spellskite is standing with three damage marked, which a 0/4 survives and an unredirected Bolt would have spent on that life total instead. Free retargeting stays refused rather than answered -- chooseNewTargetsFor throws, and so does a ChangeTargets carrying Chooser or Optional, one missing ChangeSingleTarget or DefinedMagnet, and one arriving as a trigger or as a spell.",
} as const;

/**
 * The one card whose whole added surface is a name it takes out of every card
 * ever printed.
 *
 * `mtg-fp4l` phase 8. Phyrexian Revoker is the only open card naming in the
 * audited corpus that is not also something else, and its shape is the whole of
 * the question: an `ETBReplacement` runs one `NameCard`, the seat states a name,
 * and a static ability reads it back. Forge asks it through
 * `chooseCardName(SpellAbility, Predicate, String, String)`, whose inherited
 * answer is the AI naming a card on the seat's behalf out of the whole card
 * database, and the bridge now asks the seat for text instead. Its family
 * signature is the ordinary Baneslayer one -- a creature that can be cast and
 * can attack, plus the naming the replacement adds -- so like phases 6 and 7 the
 * cohort cannot be named by a family filter and the builder reads it off the
 * script shape instead.
 */
export const LEGACY_CUBE_OPEN_CARD_NAMING_COHORTS: readonly {
  readonly families: readonly LegacyCubeDecisionFamily[];
  readonly positions: readonly number[];
}[] = [{ families: ['priority', 'combat', 'naming-text-numbers'], positions: [491] }];

export const LEGACY_CUBE_OPEN_CARD_NAMING_SAFE_POSITIONS: readonly number[] =
  LEGACY_CUBE_OPEN_CARD_NAMING_COHORTS.flatMap((cohort) => cohort.positions).sort(
    (left, right) => left - right,
  );

/**
 * The profile refuses none of its own cohort, measured the way phases 5, 6 and
 * 7 measured their own empty lists.
 *
 * The population is every position whose script names a card, and there is one.
 * The builder still walks this list: the day a second naming card lands in the
 * corpus carrying a shape this boundary does refuse, the drift check fails
 * rather than the card being quietly admitted.
 */
export const LEGACY_CUBE_OPEN_CARD_NAMING_EXCLUDED_POSITIONS = [] as const;

export const LEGACY_CUBE_OPEN_CARD_NAMING_PROBE = {
  id: 'mtg-fp4l-open-card-naming',
  families: ['priority', 'combat', 'naming-text-numbers'],
  evidence:
    'mtg-fp4l loads Phyrexian Revoker through installed Forge 2.0.14 and proves the seat names a card out of every card ever printed rather than inheriting a name the AI picked. The table is seeded fp4l-8-open-card-naming and reaches the naming on turn 7, in the precombat main phase with the seat active, the stack empty, four Plains down and one Student of Warfare already standing. The decision arrives with no options at all and a text box instead: kind card-name, label Name a card, minimum length 1, maximum length 41, which is the longest name any nonland card in the database carries. Forge writes the sentence a seat reads and the bridge passes it through unchanged, so the prompt is Phyrexian Revoker: Choose a nonland card name. Two answers are refused before the third is taken, and both refusals leave the decision standing on the same revision rather than answering it: Nostrilbearing Wallaby comes back no printed card is named Nostrilbearing Wallaby, and Plains comes back Plains does not match Card.nonLand, quoting the script expression rather than conjugating it into English. Student of Warfare is then accepted, and the board reads the naming back rather than the transcript: the level-up ability that was offered at priority before the Revoker resolved is gone from the priority list afterwards, on the same phase and step, with the Student still standing and two untapped Plains to pay for it. Naming out of a list stays outside this profile rather than being read as the same decision, because ChooseFromDefinedCards and ChooseFromList route to the arm the bridge answers with options instead of a text box, and a naming picked at random or by an unstated player is refused outright.',
} as const;

/** Every chosen-cost position admitted by a top-level profile has an exact payment review. */
export const LEGACY_CUBE_CHOSEN_COST_PAYMENT_REFUSED_POSITIONS = [] as const;

/** Exact payment cohort; permission is independent of the card's top-level profile. */
export const LEGACY_CUBE_BOUNDED_PERMANENT_COST_POSITIONS = [148, 201, 443, 472] as const;

export const LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_COHORTS: readonly {
  readonly families: readonly LegacyCubeDecisionFamily[];
  readonly positions: readonly number[];
}[] = [
  {
    positions: [169, 170, 173, 249, 267, 296, 333, 338],
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  },
  {
    positions: [252],
    families: ['priority', 'targets', 'modes', 'optional-costs', 'zone-card-selection', 'combat'],
  },
  {
    positions: [291, 473, 497, 532, 539, 545, 552, 554, 561, 563, 572, 576, 579, 586, 596, 600],
    families: ['priority', 'optional-costs', 'zone-card-selection'],
  },
  {
    positions: [477],
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection'],
  },
  {
    positions: [350],
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'],
  },
  {
    positions: [546, 597],
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection'],
  },
  {
    positions: [464],
    families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'],
  },
  {
    positions: [355, 454],
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  },
  {
    positions: [386],
    families: ['priority', 'optional-costs', 'zone-card-selection'],
  },
] as const;

export const LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_SAFE_POSITIONS =
  LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_COHORTS.flatMap((cohort) => cohort.positions).sort(
    (left, right) => left - right,
  );

/** Every other discard/sacrifice-cost position remains affirmative refusal evidence. */
export const LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_EXCLUDED_POSITIONS = [
  26, 105, 180, 220, 265, 334, 382, 390, 424, 483, 512,
] as const;

/** The sole exact chosen-sacrifice cost shape reviewed by this phase. */
export const LEGACY_CUBE_OTHER_CREATURE_SACRIFICE_COST_POSITIONS = [464] as const;

/** Exact non-mana costs composed into the reviewed trigger-target profile. */
export const LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_CHOSEN_COST_POSITIONS = [192, 409] as const;

/** Exact source-discard Cycling cost composed into the Miscalculation profile. */
export const LEGACY_CUBE_REVIEWED_SOURCE_DISCARD_COST_POSITIONS = [133] as const;

/** Exact singleton creature-sacrifice shapes reviewed by the expanded payment seam. */
export const LEGACY_CUBE_CHOSEN_CREATURE_SACRIFICE_COST_POSITIONS = [355, 386, 454] as const;

/** Exact generated-object abilities whose otherwise-blocking payment is reviewed end to end. */
export const LEGACY_CUBE_GENERATED_OBJECT_CHOSEN_COST_POSITIONS = [37, 113, 253] as const;

/** Exact generated-token sacrifice costs admitted by their whole-card profile. */
export const LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_COST_POSITIONS = [430, 479, 518] as const;

export const LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_PROBE = {
  id: 'mtg-z5q4-discard-and-source-sacrifice-costs',
  families: ['priority', 'optional-costs', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 probes select exact identities for every admitted discard and creature-sacrifice spelling and read the outcomes from zones and the board. Fauna Shaman moves the chosen creature from hand to graveyard and the chosen library creature to hand. Natural Order moves the chosen green creature to the graveyard and the chosen library creature to the battlefield. Falkenrath Aristocrat sacrifices the chosen Human while remaining on the battlefield with the resulting +1/+1 counter. Magus of the Order moves both its fixed source and the chosen other green creature to the graveyard before the chosen library creature enters the battlefield. Fiend Artisan separately proves cancellation rollback, exact other-creature selection, and the announced mana-value search bound. Bomat Courier exercises whole-hand payment; Wasteland proves that fixed source sacrifice and the selected opposing land both reach their owners' graveyards; the remaining source-sacrifice activations include a fetchland. Accepted payments are read back from hand, graveyard, life total, library, counters, and battlefield rather than inferred from transcript text. Exact full runtime ability and cost vectors guard each exceptional spelling, and the bridge rejects every adjacent discard or sacrifice shape before delegating a cost decision.",
} as const;

export const LEGACY_CUBE_PERMANENT_COST_PROBE = {
  id: 'mtg-z5q4-public-graveyard-and-permanent-costs',
  positions: [148, 201, 212, 443, 472],
  families: ['priority', 'targets', 'zone-card-selection'],
  evidence:
    "Installed Forge probes exercise Opposition and Glare of Subdual with a creature cast that turn, choosing it instead of another legal creature and tapping the selected opposing permanent. Canceling restores the target setup and leaves every candidate untapped. Dermotaxi imprints a chosen public-graveyard creature, cancels after one of its two creature selections, then becomes the selected 7/7 Griselbrand Vehicle by tapping exactly two chosen creatures. Relic of Progenitus targets the human, who chooses the nonfirst of two graveyard cards; only that card is exiled. Canceling its source-exile confirmation restores paid mana, and accepting exiles the source and remaining graveyard cards and draws one card. Exhume returns the human's chosen smaller Wall while leaving Griselbrand in the graveyard, excludes the opponent's cards from that menu, and returns an opposing creature as well. The public-graveyard callback validates the selecting player and the three exact scripted shapes; the cost visitor validates every actual adjusted cost part, and unsupported payments still throw.",
} as const;

/**
 * Closed review for the payment seam an announced number is spent through.
 *
 * It is the ordinary seam plus the announcement: the same enumerated sources
 * and the same floating pool, with the number the cost requires stated by the
 * seat rather than by the controller the bridge inherits from.
 */
export const LEGACY_CUBE_ANNOUNCED_MANA_PAYMENT_AUDIT = {
  capability: 'announced-mana-payment-v1',
  runtimeProbeId: LEGACY_CUBE_ANNOUNCED_NUMBER_PROBE.id,
  callbacks: [
    'announceRequirements',
    'chooseNumber',
    'chooseNumberInRange',
    'chooseNumberForCostReduction',
    'chooseNumberForKeywordCost',
    'specifyManaCombo',
  ],
  excludedPositions: LEGACY_CUBE_ANNOUNCED_NUMBER_EXCLUDED_POSITIONS,
  evidence:
    "mtg-fp4l phase 4 audited the pinned PlayerController bytecode for the six callbacks a stated number reaches and routed each to the session rather than leaving it inherited: announceRequirements, chooseNumber, chooseNumberInRange, chooseNumberForCostReduction, chooseNumberForKeywordCost and specifyManaCombo. The seam is the ordinary payment seam plus the announcement -- the same enumerated sources, the same floating pool, the same stale and invented refusals -- with the number the cost requires stated by the seat off a ten-stop spinner that can be slid further up the range. specifyManaCombo is wired as a refusal rather than as a question, because splitting one ability's output across colors reaches it and the only two cube cards that do are refused on that ground, so arriving there means a card was admitted whose mana production nobody read. Runtime probe mtg-fp4l-announced-number observes both arms of the announcement against installed Forge 2.0.14. X in an alternate or additional cost, convoke, improvise, delve, assist, Phyrexian life-or-mana, a divided announcement and an unpinned generated source all remain outside the profile.",
} as const;

/**
 * Closed review for the payment seam a Phyrexian activation cost is spent
 * through.
 *
 * `{U/P}` is written `UP` in a Forge cost and it is two payments rather than
 * one: the mana, or two life. Nothing in the corpus had reached it, so no
 * profile had reviewed it and the bridge threw on the whole shape. Phase 7
 * wires the life arm as an option beside the mana the payment already offers,
 * and admits it one profile at a time rather than globally. The printed-cost
 * check remains closed except for the two separately reviewed exact spell
 * identities; every other printed Phyrexian spelling is still refused.
 */
export const LEGACY_CUBE_PHYREXIAN_MANA_PAYMENT_AUDIT = {
  capability: 'phyrexian-mana-payment-v1',
  runtimeProbeId: LEGACY_CUBE_STATED_RETARGET_PROBE.id,
  callbacks: ['payManaCost', 'applyManaToCost', 'getCostDecisionMaker'],
  costPartPattern: '^(?:[WUBRG]P)+$',
  evidence:
    'mtg-fp4l phase 7 wires the life arm of a Phyrexian payment as an option beside the mana the payment already offers, and probe mtg-fp4l-stated-retarget takes it: with two untapped Volcanic Islands able to pay the {U}, the seat chose Pay 2 life for a Phyrexian mana and the board read 20 life before it and 18 after. The life is accumulated and paid once the whole cost is paid rather than as each symbol is chosen, which is what keeps a canceled payment free, and a PayLifeInsteadOf:B keyword throws rather than being answered because a life-for-black replacement is a different question. The seam is admitted one profile at a time rather than globally: a Phyrexian cost part stays a refusal under every profile that did not review it. The printed ManaCost check remains closed except for Dismember and Porcelain Legionnaire under their exact whole-card profile; other printed Phyrexian costs remain refused.',
} as const;

/** Position whose exact graveyard-exile cost is admitted by the v5 payment seam. */
export const LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_SAFE_POSITIONS = [246] as const;

/** Position whose exact sacrifice plus fixed-source return cost is admitted by the v11 seam. */
export const LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_SAFE_POSITIONS = [220] as const;

/** Position whose exact fixed-source sacrifice and Unearth routes are admitted together. */
export const LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_SAFE_POSITIONS = [424] as const;

/** Position whose exact Crew 1 and attack-or-block loot routes are admitted together. */
export const LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_SAFE_POSITIONS = [517] as const;

/** Position whose exact discard-token and tap-three-Zombies routes are admitted together. */
export const LEGACY_CUBE_REVIEWED_CRYPTBREAKER_SAFE_POSITIONS = [161] as const;

/** Position whose exact four-Myr entry and attack tap-X routes are admitted together. */
export const LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_SAFE_POSITIONS = [501] as const;

/** Positions whose exact generated-Treasure routes are admitted together. */
export const LEGACY_CUBE_REVIEWED_TREASURE_COHORT_SAFE_POSITIONS = [281, 295] as const;

/** Position whose exact power-sized entry payment and Eternalize route are admitted together. */
export const LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_SAFE_POSITIONS = [95] as const;

/** Position whose exact death replacement and Vampire-or-Zombie payment are admitted together. */
export const LEGACY_CUBE_REVIEWED_KALITAS_SAFE_POSITIONS = [186] as const;

/** Position whose exact Escape and conditional entry/attack routes are admitted together. */
export const LEGACY_CUBE_REVIEWED_URO_SAFE_POSITIONS = [428] as const;

/** Position whose exact Escape and opponent-discard routes are admitted together. */
export const LEGACY_CUBE_REVIEWED_KROXA_SAFE_POSITIONS = [453] as const;

/** Position whose exact Werewolf transforms and dependent damage targets are admitted together. */
export const LEGACY_CUBE_REVIEWED_HUNTMASTER_SAFE_POSITIONS = [417] as const;

/** Remaining exact double-faced and ordinary planeswalker scripts admitted as one cohort. */
export const LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_SAFE_POSITIONS = [3, 86, 303, 378] as const;

/** Final exact scripts required to complete all 600 official positions. */
export const LEGACY_CUBE_REVIEWED_FINAL_SIX_SAFE_POSITIONS = [180, 354, 373, 390, 393, 512] as const;

/** Exact five-other-card Escape payments shared by the two reviewed Elder Giant scripts. */
export const LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_POSITIONS = [428, 453] as const;

/** Position whose exact four-name library search is admitted by the reviewed zone-choice seam. */
export const LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_SAFE_POSITIONS = [158] as const;

/** Position whose exact planeswalker ultimate is admitted by the reviewed TwoPiles seam. */
export const LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_SAFE_POSITIONS = [223] as const;

/** Position whose exact remembered reveal is admitted by the reviewed TwoPiles seam. */
export const LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_SAFE_POSITIONS = [144] as const;

/** Positions whose exact companion scripts are admitted through Forge's pregame seam. */
export const LEGACY_CUBE_REVIEWED_COMPANION_SAFE_POSITIONS = [444, 455] as const;

/** Human payment permission remains limited to its independently reviewed cohort. */
export const LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT = {
  capability: 'chosen-cost-payment-v22',
  runtimeProbeId: 'mtg-z5q4-reviewed-final-six-outcomes',
  reviewedPositions: [
    ...LEGACY_CUBE_BOUNDED_PERMANENT_COST_POSITIONS,
    ...LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_SAFE_POSITIONS,
    ...LEGACY_CUBE_GENERATED_OBJECT_CHOSEN_COST_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_COST_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_CHOSEN_COST_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_SOURCE_DISCARD_COST_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_CRYPTBREAKER_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_TREASURE_COHORT_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_KALITAS_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_FINAL_SIX_SAFE_POSITIONS,
    132,
    262,
    269,
    275,
    143,
    150,
    155,
  ],
  callbacks: ['getCostDecisionMaker'],
  refusedPositions: [
    ...LEGACY_CUBE_CHOSEN_COST_PAYMENT_REFUSED_POSITIONS,
    ...LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_EXCLUDED_POSITIONS,
  ],
  evidence:
    "The existing decision-free payments remain automatic: mana, tapping the source, paying life, and source-only counter or sacrifice payments. The guarded visitor checks each actual adjusted cost part before delegating, so a later added cost cannot inherit an AI choice. Human payments are limited to tapXType<1/Creature>, tapXType<2/Creature>, Cloudgoat Ranger's exact tapXType<3/Kithkin>, Urza, Lord High Artificer's exact tapXType<1/Artifact>, Cryptbreaker's exact tapXType<3/Zombie>, Myr Battlesphere's exact tapXType<X/Myr>, Exile<1/CARDNAME>, Seasoned Pyromancer's exact ExileFromGrave<1/CARDNAME>, Champion of Wits' exact triggered Draw<X/You> payment and Eternalize source exile from its graveyard, Uro and Kroxa's exact Escape ExileFromGrave<5/Card.Other/other> payments, Discard<1/Card>, Discard<0/Hand>, Fauna Shaman's exact Discard<1/Creature>, Miscalculation's exact fixed-source Discard<1/CARDNAME> Cycling payment, Shark Typhoon's exact X-plus-one-blue fixed-source Discard<1/CARDNAME> Cycling payment, the exact creature sacrifices of Magus of the Order, Natural Order, Falkenrath Aristocrat, Fiend Artisan, Cavalier of Night, Birthing Pod, Recurring Nightmare, and Kalitas, Traitor of Ghet, the exact Artifact sacrifices of Pia Nalaar and Pia and Kiran Nalaar, Siege-Gang Commander's exact Goblin sacrifice, Recurring Nightmare's exact fixed-source Return<1/CARDNAME>, Zareth San's exact return of one unblocked attacking Rogue, Grim Lavamancer's exact ExileFromGrave<2/Card>, Force of Negation and Force of Will's exact ExileFromHand<1/Card.Blue+Other>, and Daze's exact Return<1/Island> inside each complete reviewed root ability and cost vector. The Myr route derives its bounded number menu from the current exact controlled untapped Myr candidates, then checks each distinct chosen identity again at payment time. Every chosen card route uses Forge's own canPay and validity filters and checks the selected stable identities and legality again before returning payment. Cancellable chosen-object routes preserve hand, stack, and objects under Forge rollback; mana already produced by activated mana abilities truthfully remains floating. Champion's permission is additionally pinned to Forge's complete entry trigger and CostDraw shape and complete intrinsic, sorcery-speed Eternalize root, its exact {5}{U}{U} plus source-exile cost vector, and the live graveyard source identity. The two Titan permissions are pinned to their intrinsic graveyard-only Escape roots, exact printed mana plus five-other-card graveyard-exile vectors, and live distinct graveyard identities; separate installed-Forge Uro and Kroxa probes exercise the shared selection callback with each exact mana spelling, and the Kroxa probe also closes the opponent-discard callback that the former broad alternate-cost profile did not describe. Whole-hand discard preserves Forge's confirmation and graveyard-order callbacks. Fixed-source discard and source sacrifice stay automatic because their object is fixed by the ability. Other source identities, Escape and Eternalize abilities, Cycling costs, subtype or variable counts, variable tap payments outside the exact Myr Battlesphere script, artifact or Goblin payments outside the three exact scripts, crew, non-source exile, every other chosen sacrifice or return, and all other payment spellings remain refused. The default script boundary stays closed; only reviewedPositions receive the permission.",
} as const;

/**
 * Vraska's complete top-level surface matches the combat/target composition,
 * but its created Treasure owns a later any-color mana decision. That source
 * is admitted only through an exact, recursively pinned token-script graph.
 */
export const LEGACY_CUBE_VRASKA_GENERATED_TOKEN_SAFE_POSITIONS = [467] as const;

/**
 * Token-producing cards that were already safe before the generated-object
 * phase. Their created objects have no decision surface, so their established
 * profiles do not acquire the pinned-generated-object capability.
 */
export const LEGACY_CUBE_GENERATED_OBJECT_PREEXISTING_SAFE_POSITIONS = [
  2, 17, 19, 24, 30, 62, 63, 68, 74, 103, 106, 109, 165, 176, 197, 232, 255, 257, 260, 261, 264, 270, 271,
  358, 360, 362, 364, 374, 391, 440, 442, 499,
] as const;

export const LEGACY_CUBE_GENERATED_OBJECT_COHORTS = [
  { positions: [37] as const, families: ['priority', 'combat'] as const },
  {
    positions: [113, 253] as const,
    families: ['priority', 'zone-card-selection', 'combat'] as const,
  },
  { positions: [403] as const, families: ['priority', 'modes', 'combat'] as const },
  {
    positions: [498, 583] as const,
    families: ['priority', 'zone-card-selection', 'combat'] as const,
  },
  { positions: [514] as const, families: ['priority', 'mana-x', 'combat'] as const },
] as const;

export const LEGACY_CUBE_GENERATED_OBJECT_SAFE_POSITIONS = LEGACY_CUBE_GENERATED_OBJECT_COHORTS.flatMap(
  (cohort) => [...cohort.positions],
).sort((left, right) => left - right);

export const LEGACY_CUBE_GENERATED_OBJECT_EXCLUDED_POSITIONS = [
  4, 18, 70, 303, 334, 354, 378, 393, 417, 509,
] as const;

export const LEGACY_CUBE_GENERATED_OBJECT_PROBE = {
  id: 'mtg-z5q4-pinned-generated-object-outcomes',
  families: ['priority', 'modes', 'mana-x', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes create Cloudgoat Ranger's three exact Kithkin and tap the three selected identities for its pump, create Urza, Lord High Artificer's artifact-counted Construct and tap that selected identity for blue mana, and exile the exact Seasoned Pyromancer source from its graveyard to create two additional Elementals. Earlier probes create Elder Gargaroth's exact 3/3 Beast, Karn and Urza's Saga's artifact-counted Construct, and Hangarback Walker's exact number of flying Thopters. Each probe reads identity, characteristics, amount, payment identities, and relevant dynamic power or combat result from zones and the resulting board rather than inferring creation from a transcript.",
} as const;

/** Exact cards that create pinned tokens and later select a sacrifice payment. */
export const LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_COHORTS = [
  {
    positions: [430] as const,
    families: ['priority', 'targets', 'modes', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [479] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [518] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'ordering', 'combat'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_PROBE = {
  id: 'mtg-z5q4-reviewed-generated-token-sacrifice-outcomes',
  families: ['priority', 'targets', 'modes', 'optional-costs', 'zone-card-selection', 'ordering', 'combat'],
  evidence:
    "Installed Forge 2.0.14 creates Koma's exact Coil on each upkeep and sacrifices one exact other Serpent for each exact mode, creates Retrofitter Foundry's Servo-to-Thopter-to-Construct chain by sacrificing each selected predecessor, and resolves Treasure Map's three Scry activations into the same-object Treasure Cove plus three exact Treasures before sacrificing one selected Treasure to draw. The probes read the created identities, characteristics, state, counters, tapped status, zones, and draw outcome from Forge's actual board. Invented and stale payments fail explicitly, and cancellation preserves the source, payment candidate, mana, and pending ability. Other token roots, amounts, sacrifice types, costs, modes, targets, transforms, identities, effects, and compositions remain closed.",
} as const;

/** Exact generated-object scripts composed with bounded targets, counters, and zones. */
export const LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_COHORTS = [
  {
    positions: [181] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [345] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [389] as const,
    families: ['priority', 'zone-card-selection', 'combat'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_COHORTS.flatMap((cohort) => [
    ...cohort.positions,
  ]).sort((left, right) => left - right);

export const LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_PROBE = {
  id: 'mtg-z5q4-reviewed-generated-object-bounded-choice-outcomes',
  families: ['priority', 'targets', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes Liliana, the Last Hope's optional exact creature target and Zombie-producing emblem, Ranger Class's exact Wolf creation and attacking-creature counter target, and Vivien, Monsters' Advocate's exact Beast creation, vigilance/reach/trample counter menu, and lesser-mana-value delayed creature search. The probes reject invented and stale choices and read the selected identities, counters, zones, and resulting board from Forge rather than inferring outcomes from transcript text. Other generated roots, optional targets, trigger targets, counter menus, library bounds, identities, and compositions remain closed.",
} as const;

/** Exact generated-object scripts composed with already reviewed alternate-cost keywords. */
export const LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_COHORTS = [
  {
    positions: [132] as const,
    families: ['priority', 'optional-costs', 'mana-x', 'combat'] as const,
  },
  {
    positions: [254] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_COHORTS.flatMap((cohort) => [
    ...cohort.positions,
  ]).sort((left, right) => left - right);

export const LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_PROBE = {
  id: 'mtg-z5q4-reviewed-alternate-cost-generated-object-outcomes',
  families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes Shark Typhoon's exact X-value Cycling payment and X/X flying Shark plus its noncreature-spell mana-value Shark, and Ragavan's exact Dash return, combat-damage Treasure, opposing top-card exile, and generated Treasure payment. The probes read generated identities, characteristics, zones, dynamic amounts, payment, and lifetime from Forge's actual state and reject invented or stale choices. Other Cycling, Dash, generated roots, amounts, dynamic values, destinations, lifetimes, targets, and compositions remain closed.",
} as const;

/** Exact residual generated-token scripts whose complete compositions are reviewed. */
export const LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_COHORTS = [
  {
    positions: [361] as const,
    families: ['priority', 'optional-costs', 'combat'] as const,
  },
  {
    positions: [418] as const,
    families: ['priority', 'zone-card-selection', 'combat'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_PROBE = {
  id: 'mtg-z5q4-reviewed-residual-generated-token-outcomes',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes Deranged Hermit's exact Echo pay and decline branches, four pinned Squirrels, and exact continuous lord contribution, plus Xenagos, the Reveler's exact hasty Satyr, creature-counted red/green mana choice and spending, and eligible remembered-card movement after the seven-card ultimate. The probes read identities, characteristics, zones, mana, counters, and resulting board state from Forge and reject invented or stale choices wherever Forge exposes them. Other Echo, mixed-mana, token, static-buff, planeswalker, Dig, remembered-object, ChangeZone, identity, and composition shapes remain closed.",
} as const;

/** Exact residual scripts with bounded multi-target transformation compositions. */
export const LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_COHORTS = [
  {
    positions: [396, 429, 437] as const,
    families: ['priority', 'targets', 'combat'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_PROBE = {
  id: 'mtg-z5q4-reviewed-multi-target-transformation-outcomes',
  families: ['priority', 'targets', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes Terastodon's exact zero-to-three distinct noncreature-permanent targets and creates an exact Elephant for each targeted permanent that actually reaches a graveyard under that permanent's controller; Oko, Thief of Crowns creates the pinned Food, permanently overwrites one exact artifact or creature as a green 3/3 Elk, and exchanges the exact two eligible targeted objects; Saheeli, Sublime Artificer creates the pinned Servo and temporarily copies one exact other artifact or creature while retaining Artifact until end of turn. The probes read identities, controllers, characteristics, zones, and expiration from Forge's actual board and reject invented, stale, illegal, duplicate, canceled, or rolled-back choices wherever Forge exposes them. Other multiple-target, Animate, Clone, ExchangeControl, RepeatEach, Token, planeswalker, identity, relationship, lifetime, and composition shapes remain closed.",
} as const;

/** Exact planeswalker scripts whose effects are guarded by one reviewed sacrifice payment. */
export const LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_COHORTS = [
  {
    positions: [383] as const,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [451, 466] as const,
    families: ['priority', 'targets', 'optional-costs', 'combat'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_PROBE = {
  id: 'mtg-z5q4-reviewed-planeswalker-unless-sacrifice-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes Garruk Relentless's transform and both pinned Wolf tokens, then pays or declines the back face's exact creature sacrifice before searching for one creature; Daretti, Ingenious Iconoclast creates the pinned Construct, pays or declines one exact artifact sacrifice before destroying its exact artifact-or-creature target, and selects an exact artifact card from the graveyard while also offering battlefield artifacts before creating exactly three copies; and Grist, the Hunger Tide creates the pinned Insect and pays or declines one exact creature sacrifice before destroying its exact creature-or-planeswalker target. The probes reject invented, stale, wrong-type, and cross-controller payments and read loyalty, sacrificed identities, targets, zones, tokens, and resulting board state from Forge. Other planeswalkers, UnlessCost shapes, sacrifice types, payers, targets, searches, generated roots, identities, and compositions remain closed.",
} as const;

/** Exact spells whose copies may retain or replace one Forge-legal target. */
export const LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_COHORTS = [
  {
    positions: [240] as const,
    families: ['priority', 'targets', 'replacement-trigger-choices'] as const,
  },
  {
    positions: [283] as const,
    families: ['priority', 'targets', 'optional-costs', 'replacement-trigger-choices'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_PROBE = {
  id: 'mtg-z5q4-reviewed-copy-spell-retarget-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'replacement-trigger-choices'],
  evidence:
    "Installed Forge 2.0.14 probes Malicious Affliction's exact morbid trigger decline and accept branches, preserving or replacing its one nonblack-creature target before destroying the resulting exact objects, plus Chain Lightning's exact RR decline and payment branches, preserving or replacing its one legal damage target under the targeted player's control and reading every three-damage result from Forge state. The probes reject invented, stale, wrong-type, illegal, and canceled retarget answers. Other CopySpellAbility, free-retarget, morbid, reciprocal-payment, payer, target, identity, and composition shapes remain closed.",
} as const;

/**
 * Trigger-target positions already admitted by the earlier narrow target
 * profiles. They remain in the complete 71-position trigger-target census so
 * later corpus changes cannot hide by falling into an older cohort.
 */
export const LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_PREEXISTING_SAFE_POSITIONS = [
  15, 47, 48, 51, 53, 77, 91, 98, 108, 183, 187, 188, 272, 279, 353, 359, 398, 404, 413, 419, 436,
] as const;

export const LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_COHORTS = [
  {
    positions: [21, 168, 196, 199, 503] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'combat'] as const,
  },
] as const;

export const LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_SAFE_POSITIONS =
  LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

/** Every other formerly refused trigger-target position retains a concrete blocker. */
export const LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_EXCLUDED_POSITIONS = [
  18, 32, 58, 81, 86, 312, 345, 393, 396, 417, 466, 508, 521,
] as const;

export const LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_PROBE = {
  id: 'mtg-z5q4-stated-ordering-trigger-target-outcomes',
  families: ['priority', 'targets', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes exercise five position-pinned trigger compositions through backend-issued MoveIds and read each answer from the resulting board or zones: Elite Spellbinder exiles the exact optionally selected nonland card and Kitesail Freebooter exiles the exact mandatorily selected noncreature, nonland card from the chosen opponent's hidden hand; Archon of Cruelty makes the chosen opponent sacrifice and discard while transferring exactly three life; Sheoldred returns the exact chosen creature card from its controller's graveyard; and Ulamog destroys the exact chosen permanent on cast. The two hidden-hand callbacks are admitted only for their exact closed script shapes; other optional, multiple, direct, attachment, Stack, generated-object, nested-zone, independent mana-color, and independently unreviewed keyword or replacement shapes remain refused.",
} as const;

/** Sole-blocker trigger routes reviewed after the first hidden-hand cohort. */
export const LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_COHORTS = [
  {
    positions: [104] as const,
    families: [
      'priority',
      'targets',
      'zone-card-selection',
      'combat',
      'replacement-trigger-choices',
    ] as const,
  },
  {
    positions: [54, 117, 266, 407] as const,
    families: ['priority', 'targets', 'optional-costs', 'combat'] as const,
  },
  {
    positions: [179] as const,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [57] as const,
    families: ['priority', 'targets', 'optional-costs'] as const,
  },
  {
    positions: [100] as const,
    families: ['priority', 'targets', 'modes', 'combat', 'replacement-trigger-choices'] as const,
  },
  {
    positions: [114, 174, 191, 323] as const,
    families: ['priority', 'targets', 'optional-costs', 'combat'] as const,
  },
  {
    positions: [28, 38, 346, 406, 526] as const,
    families: ['priority', 'targets', 'combat', 'replacement-trigger-choices'] as const,
  },
  {
    positions: [305] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'naming-text-numbers'] as const,
  },
  {
    positions: [92] as const,
    families: ['priority', 'targets', 'optional-costs', 'combat'] as const,
  },
  { positions: [416] as const, families: ['priority', 'targets', 'combat'] as const },
  {
    positions: [421] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'combat'] as const,
  },
  { positions: [460] as const, families: ['priority', 'targets', 'zone-card-selection'] as const },
  {
    positions: [118, 409] as const,
    families: ['priority', 'targets', 'combat', 'replacement-trigger-choices'] as const,
  },
  {
    positions: [184] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [192, 218] as const,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [320] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'replacement-trigger-choices'] as const,
  },
  {
    positions: [448] as const,
    families: ['priority', 'targets', 'zone-card-selection'] as const,
  },
  {
    positions: [485] as const,
    families: [
      'priority',
      'targets',
      'modes',
      'optional-costs',
      'mana-x',
      'zone-card-selection',
      'ordering',
      'combat',
      'replacement-trigger-choices',
      'naming-text-numbers',
      'piles-votes',
    ] as const,
  },
  {
    positions: [110] as const,
    families: ['priority', 'targets', 'combat'] as const,
  },
  {
    positions: [484] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'combat'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_PROBE = {
  id: 'mtg-z5q4-reviewed-trigger-target-outcomes',
  families: [
    'priority',
    'targets',
    'modes',
    'optional-costs',
    'mana-x',
    'zone-card-selection',
    'ordering',
    'combat',
    'replacement-trigger-choices',
    'naming-text-numbers',
    'piles-votes',
  ],
  evidence:
    "Installed Forge 2.0.14 probes exercise thirty-two reviewed trigger routes and read their exact effects from zones, tapped state, counters, mana, life totals, turn order, hidden-information visibility, and printed characteristics. Outpost Siege, Klothys, Tidehollow Sculler, and Showdown retain their prior board-outcome coverage. Restoration Angel blinks only the selected non-Angel creature; Sun Titan returns the selected mana-value-three-or-less permanent from its controller graveyard; Solitude exiles the exact other white card chosen for Evoke, accepts or declines its optional singleton trigger target, exiles an accepted creature, and gives that creature's controller life equal to its exact power; Reclamation Sage destroys the selected artifact or enchantment; Eternal Witness returns the selected graveyard card to hand; and Duplicant exiles and imprints the selected nontoken creature and takes its power and toughness. Cast Out exiles the selected opposing nonland permanent; Pestermite accepts its optional trigger and taps the selected permanent; Riftwing Cloudskate returns the selected permanent to its owner hand; Bone Shredder and Shriekmaw destroy only the selected legal creature; and Avalanche Riders destroys the selected land. Venser returns the exact selected permanent or live Stack spell to its owner's hand; Ulamog, the Ceaseless Hunger exiles exactly two selected permanents on cast and exactly twenty cards from the defending library on attack. Frost Titan taps the selected permanent; Gatekeeper of Malakir pays its selected kicker, targets the opposing player, and makes that seat select the sacrificed creature; Flametongue Yearling pays one selected multikicker, receives one +1/+1 counter, and destroys the selected creature with its power-derived damage; Den Protector is cast face down, turned face up through its paid megamorph action, and returns the selected graveyard identity to hand; and Stratus Dancer is cast face down, pays its exact megamorph cost in response to a live instant, receives its +1/+1 counter, and counters only that selected stack identity. Vendilion Clique targets the opposing player, routes its optional hidden-hand identity through the exact reviewed callback, puts that object on the bottom of the library, and replaces it with one draw. Torrential Gearhulk selects and casts the exact instant from its controller graveyard; Gonti selects one exact hidden-library card and later casts it; Cavalier of Night sacrifices the exact other creature, destroys the exact target, confirms its reflexive death trigger, and returns the exact low-value creature; Necromancy selects the exact graveyard creature, controls and attaches to it, then sacrifices that same creature when the Aura leaves; Chandra selects the exact exiled card to cast and her emblem selects and damages the exact permanent; Zareth San returns the exact unblocked attacking Rogue and puts the exact permanent from the damaged player's graveyard onto the pilot battlefield; Teferi selects and untaps two exact lands, then its emblem exiles the exact opposing permanent; and Emrakul exposes the engine opponent's hidden hand only while the pilot controls that opponent's next turn, plays a selected land during that turn, releases control, and inserts the opponent's extra turn before the pilot acts again. Exact position and whole-script pins close every route; target-shape mutations, foreign deciders, other Evoke payments or triggers, other return costs, other hidden-zone and triggered-choice compositions, attachment, retarget, generated-object, independently unreviewed payment, and every other remaining refusal stay closed.",
} as const;

/** Exact sole-blocker script whose comma-delimited counter type is human-routed. */
export const LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_COHORTS = [
  { positions: [71] as const, families: ['priority', 'targets'] as const },
] as const;

export const LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_PROBE = {
  id: 'mtg-z5q4-reviewed-counter-type-choice-outcome',
  families: ['priority', 'targets'],
  evidence:
    "An installed Forge 2.0.14 probe advances Elspeth Conquers Death through its exact three-chapter Saga composition, routes the chapter-three counter-type choice through the session controller, returns the selected creature from its controller's graveyard, and observes exactly one +1/+1 counter on that returned object. The profile lifts only counter-type choice for the position- and byte-pinned script; every other counter set, amount, identity, composition, and remaining refusal stays closed.",
} as const;

/** Exact planeswalker abilities where choosing no target still resolves the ability. */
export const LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_COHORTS = [
  { positions: [445] as const, families: ['priority', 'targets'] as const },
  {
    positions: [387] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'combat'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_PROBE = {
  id: 'mtg-z5q4-reviewed-optional-target-outcomes',
  families: ['priority', 'targets', 'zone-card-selection', 'combat'],
  evidence:
    'Installed Forge 2.0.14 probes exercise both exact position-pinned optional-target planeswalker abilities through explicit target-none and exact-target session choices. Teferi, Time Raveler resolves its minus ability without a target and still draws, and separately returns the selected permanent and draws; Nissa, Who Shakes the World resolves its plus ability without a target, then on a later turn selects one exact Forest and produces the installed three-counter animated-land outcome. Other optional, multiple, triggered, nested, or differently composed targets remain refused.',
} as const;

/** Exact printed spells whose Phyrexian symbols are paid by the human seat. */
export const LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_COHORTS = [
  { positions: [474] as const, families: ['priority', 'targets', 'mana-x'] as const },
  { positions: [493] as const, families: ['priority', 'mana-x', 'combat'] as const },
] as const;

export const LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_PROBE = {
  id: 'mtg-z5q4-reviewed-phyrexian-spell-cost-outcomes',
  families: ['priority', 'targets', 'mana-x', 'combat'],
  evidence:
    'Installed Forge 2.0.14 probes cast both exact position-pinned printed Phyrexian costs through human-routed mana-payment choices. Dismember pays both black Phyrexian symbols with four life, targets one exact creature, and moves that object to the graveyard after the installed -5/-5 effect. Porcelain Legionnaire pays its white Phyrexian symbol with two life and resolves a 3/1 creature onto the battlefield; the exact pinned script also requires First Strike. Both probes first cancel after choosing the life arm and read back unchanged life, an empty stack, and the spell restored to hand. Other identities, symbol counts, effects, and special payment mechanics remain refused.',
} as const;

/** Exact printed creatures whose cast trigger is Forge's built-in Cascade keyword. */
export const LEGACY_CUBE_REVIEWED_CASCADE_COHORTS = [
  {
    positions: [415, 427] as const,
    families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_CASCADE_SAFE_POSITIONS = LEGACY_CUBE_REVIEWED_CASCADE_COHORTS.flatMap(
  (cohort) => [...cohort.positions],
).sort((left, right) => left - right);

export const LEGACY_CUBE_REVIEWED_CASCADE_PROBE = {
  id: 'mtg-z5q4-reviewed-cascade-outcomes',
  families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'],
  evidence:
    'Installed Forge 2.0.14 probes cast both exact position-pinned Cascade creatures and route the optional free-cast confirmation to the human seat. Declining leaves the revealed spell uncast while the Cascade creature resolves; accepting casts the exact revealed spell without paying its mana cost and reads that spell and the Cascade creature back from the resulting battlefield. Other identities, mana values, keyword compositions, and library-choice mechanics remain refused.',
} as const;

/** Exact Confluences whose three modal picks may repeat. */
export const LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_COHORTS = [
  {
    positions: [151] as const,
    families: ['priority', 'targets', 'modes', 'optional-costs'] as const,
  },
  { positions: [238, 307] as const, families: ['priority', 'targets', 'modes'] as const },
] as const;

export const LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

export const LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_PROBE = {
  id: 'mtg-z5q4-reviewed-repeatable-mode-outcomes',
  families: ['priority', 'targets', 'modes', 'optional-costs'],
  evidence:
    "Installed Forge 2.0.14 probes route all three mode picks for each exact position-pinned Confluence through the human seat while reoffering Forge's complete currently legal mode list on every pick. Fiery Confluence repeats its opponent-damage mode three times and reads an exact six-life loss; Wretched Confluence repeats its draw-and-lose-life mode three times and reads exactly three cards drawn and three life lost. Mystic Confluence repeats its draw mode for exactly three cards, returns the exact selected creatures to their owners' hands, and routes the counter mode's exact pay-three choice to the targeted spell's controller on both its pay and decline branches. Other repeat counts, modal identities, target compositions, UnlessCost shapes or payers, and nonrepeatable selection shapes remain closed.",
} as const;

/** Exact two-land target block whose two distinct picks are human-routed. */
export const LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_COHORTS = [
  { positions: [402] as const, families: ['priority', 'targets'] as const },
] as const;

export const LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_COHORTS.flatMap((cohort) => [...cohort.positions]);

export const LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_PROBE = {
  id: 'mtg-z5q4-reviewed-plow-under-outcome',
  families: ['priority', 'targets'],
  evidence:
    "An installed Forge 2.0.14 probe casts the exact position-pinned Plow Under, routes two distinct land targets through successive human-seat decisions, and observes both selected land objects leave the battlefield for the tops of their owners' libraries. Its first target decision also exposes casting cancellation. Other target counts, zones, identities, nested blocks, and divided allocations remain closed.",
} as const;

/** Exact Coalition Relic trigger whose produced colors are human-routed. */
export const LEGACY_CUBE_REVIEWED_MANA_COMBO_COHORTS = [
  { positions: [507] as const, families: ['priority', 'mana-x'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_MANA_COMBO_SAFE_POSITIONS = [507] as const;
export const LEGACY_CUBE_REVIEWED_MANA_COMBO_PROBE = {
  id: 'mtg-z5q4-reviewed-coalition-relic-outcome',
  families: ['priority', 'mana-x'],
  evidence:
    'An installed Forge 2.0.14 probe activates the exact position-pinned Coalition Relic charge-counter ability, observes the counter on the artifact, routes the next main-phase produced-color decision to the human seat, chooses red, and spends that otherwise unavailable red mana to cast Lightning Bolt for an observed three-life loss. Other Combo producers, identities, color constraints, and distinct-color splits remain closed.',
} as const;

/** Exact two-mode command whose Stack target is not a retarget operation. */
export const LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_COHORTS = [
  { positions: [149] as const, families: ['priority', 'targets', 'modes'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_SAFE_POSITIONS = [149] as const;
export const LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_PROBE = {
  id: 'mtg-z5q4-reviewed-cryptic-command-outcome',
  families: ['priority', 'targets', 'modes'],
  evidence:
    "An installed Forge 2.0.14 probe casts the exact position-pinned Cryptic Command in response to an opponent spell, routes two distinct modes through the human seat, targets the exact Stack object for the counter mode, and observes that object in its owner's graveyard while the draw mode increases the local hand by one. TargetType$ Spell is a stack-target declaration, not ChangeTargets; actual retargeting remains closed.",
} as const;

/** Exact two-distinct-mode Command with four separately pinned targeted modes. */
export const LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_COHORTS = [
  {
    positions: [434] as const,
    families: ['priority', 'targets', 'modes', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_SAFE_POSITIONS = [434] as const;
export const LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_PROBE = {
  id: 'mtg-z5q4-reviewed-prismari-command-outcomes',
  families: ['priority', 'targets', 'modes', 'zone-card-selection', 'combat'],
  evidence:
    'Installed Forge 2.0.14 probes cast the exact position-pinned Prismari Command, route exactly two distinct modes and every target-bearing mode through the human seat, and read damage, drawn and discarded identities, the exact pinned Treasure object, and artifact destruction from the resulting zones and board. Invented and stale modes, targets, and discard identities fail explicitly, and cancellation restores the spell, mana, targets, and objects. Other Command identities, Charm counts, repetition, mode lists, targets, token scripts or owners, effects, and compositions remain closed.',
} as const;

/** Exact one-to-three-mode Escalate spell with bounded targets and opponent sacrifice. */
export const LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_COHORTS = [
  {
    positions: [80] as const,
    families: ['priority', 'targets', 'modes', 'optional-costs', 'zone-card-selection'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_SAFE_POSITIONS = [80] as const;
export const LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_PROBE = {
  id: 'mtg-z5q4-reviewed-blessed-alliance-outcomes',
  families: ['priority', 'targets', 'modes', 'optional-costs', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 probes cast the exact position-pinned Blessed Alliance with one, two, and three distinct modes; observe exactly two additional generic mana per mode beyond the first; route player and up-to-two-creature targets plus the targeted opponent's attacking-creature sacrifice through the correct human seats; and read life, untap, mana, and graveyard outcomes from Forge state. Invented, duplicate, stale, canceled, wrong-seat, wrong-target, wrong-count, wrong-cost, and changed-script routes remain closed.",
} as const;

/** Exact mandatory death replacement plus bounded Vampire-or-Zombie sacrifice. */
export const LEGACY_CUBE_REVIEWED_KALITAS_COHORTS = [
  {
    positions: [186] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_KALITAS_PROBE = {
  id: 'mtg-z5q4-reviewed-kalitas-outcomes',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    'Installed Forge 2.0.14 probes load the exact position-pinned Kalitas, Traitor of Ghet script; destroy an opposing nontoken creature and observe that exact object in exile plus exactly one controller-owned 2/2 black Zombie; prove opposing tokens and friendly creatures still die normally; and activate the exact {2}{B}, sacrifice-another-Vampire-or-Zombie route. The human seat sees only exact legal payment identities; cancellation preserves hand, stack, and objects while Forge truthfully leaves mana from activated mana abilities floating; invented and stale identities fail explicitly; the chosen creature reaches the graveyard; and Kalitas receives exactly two +1/+1 counters. Other replacement events, filters, destinations, token roots or owners, sacrifice types, counts, costs, counter effects, identities, and compositions remain closed.',
} as const;

/** Exact Escape titan with conditional entry sacrifice and optional land placement. */
export const LEGACY_CUBE_REVIEWED_URO_COHORTS = [
  {
    positions: [428] as const,
    families: [
      'priority',
      'optional-costs',
      'zone-card-selection',
      'combat',
      'replacement-trigger-choices',
    ] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_URO_PROBE = {
  id: 'mtg-z5q4-reviewed-uro-outcomes',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat', 'replacement-trigger-choices'],
  evidence:
    "An installed Forge 2.0.14 probe casts the exact position-pinned Uro, Titan of Nature's Wrath normally and through Escape. It reads the local seat's life, hand, library, battlefield, graveyard, and exile to prove the ordinary copy gains three life, draws exactly one card, offers the exact optional land route, and sacrifices itself; then proves the escaped copy exiles the exact five distinct chosen other graveyard cards and remains on the battlefield after the same entry effects. The attack trigger is routed to the human seat, and land-placement decline and acceptance, invented and stale identities, and canceled Escape selection are exercised explicitly. Foreign Escape roots, costs, triggers, zone changes, identities, and compositions remain closed.",
} as const;

/** Exact Escape titan with conditional entry sacrifice and opponent discard. */
export const LEGACY_CUBE_REVIEWED_KROXA_COHORTS = [
  {
    positions: [453] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_KROXA_PROBE = {
  id: 'mtg-z5q4-reviewed-kroxa-outcomes',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    "An installed Forge 2.0.14 probe casts the exact position-pinned Kroxa, Titan of Death's Hunger normally and through Escape. The opposing human seat receives only its exact live hand-card identities, chooses a card, and Forge resolves the discard and conditional life-loss chain before sacrificing the ordinary Kroxa. The same graveyard object is then cast for Forge's actual {B}{B}{R}{R} Escape cost; the local seat chooses exactly five distinct other live graveyard objects, observes those objects in exile, and observes Kroxa remain on the battlefield. Invented and stale cost identities fail explicitly. Other Escape roots, costs, discard chains, players, identities, triggers, and compositions remain closed.",
} as const;

/** Exact double-faced Werewolf with generated Wolf, life, and dependent damage targets. */
export const LEGACY_CUBE_REVIEWED_HUNTMASTER_COHORTS = [
  {
    positions: [417] as const,
    families: ['priority', 'targets', 'optional-costs', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_HUNTMASTER_PROBE = {
  id: 'mtg-z5q4-reviewed-huntmaster-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'combat'],
  evidence:
    "An installed Forge 2.0.14 probe loads the exact position-pinned Huntmaster of the Fells script and observes its front-face entry trigger create one pinned 2/2 green Wolf and gain exactly two life. It then exercises Forge's no-spell and two-spell upkeep conditions in both directions, observes the same battlefield object transform between the 2/2 front and 4/4 trample back, routes Ravager's mandatory opponent-or-planeswalker target and dependent optional creature target to the human seat, and reads the exact two-damage outcomes from Forge state. Invented and stale identities leave the pending choice and board unchanged; choosing no creature is explicit; foreign transform, generated-object, phase-trigger, target relationship, damage, identity, and composition shapes remain closed.",
} as const;

/** Exact Kytheon, Jace, Chandra, and Nissa planeswalker compositions. */
export const LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_COHORTS = [
  {
    positions: [3] as const,
    families: ['priority', 'targets', 'optional-costs', 'combat'] as const,
    generatedObjects: 'none' as const,
  },
  {
    positions: [86] as const,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'] as const,
    generatedObjects: 'none' as const,
  },
  {
    positions: [303] as const,
    families: ['priority', 'targets', 'combat', 'replacement-trigger-choices'] as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  },
  {
    positions: [378] as const,
    families: [
      'priority',
      'targets',
      'optional-costs',
      'zone-card-selection',
      'combat',
      'replacement-trigger-choices',
    ] as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_PROBE = {
  id: 'mtg-z5q4-reviewed-remaining-planeswalker-outcomes',
  families: [
    'priority',
    'targets',
    'optional-costs',
    'zone-card-selection',
    'combat',
    'replacement-trigger-choices',
  ],
  evidence:
    "Installed Forge 2.0.14 probes load the exact position-pinned Kytheon, Hero of Akros; Jace, Vryn's Prodigy; Chandra, Acolyte of Flame; and Nissa, Vastwood Seer scripts. They route each transform, optional and mandatory target, loyalty payment, graveyard or library selection, generated token, delayed effect, temporary or permanent animation, and emblem trigger to the human controller and read the resulting Forge board. Invented and stale choices are rejected and cancellations preserve the pre-decision state. The bridge and ledger pin every source identity, root ability topology, bound, filter, duration, destination, generated dependency, and composed effect; all foreign planeswalker, target, transform, generated-object, graveyard-play, library, delayed-trigger, animation, and emblem shapes remain closed.",
} as const;

/** Six independently byte-pinned scripts sharing one final runtime-evidence cohort. */
export const LEGACY_CUBE_REVIEWED_FINAL_SIX_COHORTS = [
  {
    positions: [180] as const,
    families: [
      'priority',
      'targets',
      'optional-costs',
      'zone-card-selection',
      'combat',
      'naming-text-numbers',
    ] as const,
    generatedObjects: 'none' as const,
  },
  {
    positions: [354] as const,
    families: ['priority', 'targets', 'combat', 'replacement-trigger-choices'] as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  },
  {
    positions: [373] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'ordering'] as const,
    generatedObjects: 'none' as const,
  },
  {
    positions: [390] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
    generatedObjects: 'none' as const,
  },
  {
    positions: [393] as const,
    families: ['priority', 'targets', 'optional-costs', 'combat'] as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  },
  {
    positions: [512] as const,
    families: [
      'priority',
      'targets',
      'modes',
      'optional-costs',
      'mana-x',
      'zone-card-selection',
      'ordering',
      'combat',
      'replacement-trigger-choices',
      'naming-text-numbers',
      'piles-votes',
    ] as const,
    generatedObjects: 'none' as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_FINAL_SIX_PROBE = {
  id: 'mtg-z5q4-reviewed-final-six-outcomes',
  families: [
    'priority',
    'targets',
    'modes',
    'optional-costs',
    'mana-x',
    'zone-card-selection',
    'ordering',
    'combat',
    'replacement-trigger-choices',
    'naming-text-numbers',
    'piles-votes',
  ],
  evidence:
    "Installed Forge 2.0.14 probes load the six exact final position-pinned scripts and route every human decision through backend-issued stable identities. They observe Yawgmoth payments, optional targeting, draw, and proliferated counters; Master of the Wild Hunt token creation, Wolf tapping, both damage directions, and divided return damage; Sylvan Library draw, chosen-card ordering, life payments, and library returns; Whisperwood manifest and granted death triggers; Sawtusk mutate, noncreature destruction, and the targeted controller's Beast; and Mindslaver target-player control through the complete next turn. Invented, stale, canceled, foreign-source, and composition variants remain refused.",
} as const;
export const LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_PROBE = {
  id: 'mtg-z5q4-reviewed-titan-escape-cost-outcomes',
  families: ['optional-costs', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 probes pay both exact reviewed Elder Giant Escape costs: Uro's {U}{U}{G}{G} and Kroxa's {B}{B}{R}{R}, each plus five distinct other live cards selected from the source controller's graveyard. The probes observe the chosen objects in exile and each escaped source on the battlefield; invented and stale identities fail explicitly, and Uro additionally exercises cancellation rollback. Other Escape sources, mana spellings, counts, zones, filters, identities, and cost compositions remain closed.",
} as const;

/** Exact optional-copy replacement whose two outcomes are human-routed. */
export const LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_COHORTS = [
  {
    positions: [89] as const,
    families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_SAFE_POSITIONS = [89] as const;
export const LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_PROBE = {
  id: 'mtg-z5q4-reviewed-phantasmal-image-outcomes',
  families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'],
  evidence:
    'An installed Forge 2.0.14 probe casts the exact position-pinned Phantasmal Image twice. Declining the human-routed confirm-replacement decision leaves the printed 0/0 Image to die and observes its exact object in the graveyard. Accepting exposes two exact Wall of Omens object IDs through the human-routed entity-selection decision, chooses the second, and observes the original Image object on the battlefield as a 0/4 Wall of Omens with the added Illusion type. Other copy choices, replacement shapes, granted triggers, and identities remain closed.',
} as const;

/** Exact PeekAndReveal cards whose optional branch is routed to the human seat. */
export const LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_COHORTS = [
  {
    positions: [82] as const,
    families: [
      'priority',
      'optional-costs',
      'zone-card-selection',
      'combat',
      'replacement-trigger-choices',
    ] as const,
  },
  {
    positions: [458] as const,
    families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_SAFE_POSITIONS = [82, 458] as const;
export const LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_PROBE = {
  id: 'mtg-z5q4-reviewed-peek-and-reveal-outcomes',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat', 'replacement-trigger-choices'],
  evidence:
    'Installed Forge 2.0.14 probes route both exact position-pinned PeekAndReveal cards through the human seat. Delver of Secrets first declines with its library and front face unchanged, then accepts with Opt on top; that exact Opt object is drawn, the same Delver object becomes the 3/2 Insectile Aberration, and it deals three combat damage over a ground blocker. Velomachus Lorehold first declines its optional cast, then offers only the exact eligible Lightning Bolt objects among its top seven, casts the selected object without a mana-payment decision, moves it from library to graveyard, deals exactly three damage to the chosen opponent, and retains the other six objects in the library under the script-pinned random-bottom effect. Both paths reject invented and stale choices. Other identities, amounts, reveal flags, filters, optional branches, state changes, destinations, and compositions remain closed.',
} as const;

/** Two exact optional-copy replacements with distinct legal copy domains and payment routes. */
export const LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_COHORTS = [
  {
    positions: [97] as const,
    manaPayment: 'announced-mana-payment-v1' as const,
    families: [
      'priority',
      'optional-costs',
      'zone-card-selection',
      'combat',
      'replacement-trigger-choices',
    ] as const,
  },
  {
    positions: [496] as const,
    manaPayment: 'phyrexian-mana-payment-v1' as const,
    families: ['priority', 'mana-x', 'zone-card-selection', 'combat', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_SAFE_POSITIONS = [97, 496] as const;
export const LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_PROBE = {
  id: 'mtg-z5q4-reviewed-optional-copy-replacement-outcomes',
  families: [
    'priority',
    'optional-costs',
    'mana-x',
    'zone-card-selection',
    'combat',
    'replacement-trigger-choices',
  ],
  evidence:
    'Installed Forge 2.0.14 probes both exact position-pinned optional-copy scripts through the human-routed replacement confirmation and stable-identity entity selection. Glasspool Mimic declines into the graveyard as its printed 0/0, accepts only a creature its controller controls and keeps its object identity while gaining the copied characteristics plus Shapeshifter and Rogue, and its modal Glasspool Shore face enters tapped and later produces blue mana. Phyrexian Metamorph cancels after choosing its two-life payment and restores life, hand, mana, stack, and objects; separate casts pay either blue mana or exactly two life, decline into the graveyard as the printed 0/0, or accept an exact other creature or artifact from either battlefield while keeping its object identity and Artifact type. Invented and stale choices are rejected. Other copy domains, replacement shapes, modal faces, Phyrexian costs, identities, effects, and compositions remain closed.',
} as const;

/** Exact planeswalker whose ultimate restarts the game and returns its exiled permanents. */
export const LEGACY_CUBE_REVIEWED_KARN_LIBERATED_COHORTS = [
  {
    positions: [481] as const,
    families: ['priority', 'targets', 'zone-card-selection'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_KARN_LIBERATED_SAFE_POSITIONS = [481] as const;
export const LEGACY_CUBE_REVIEWED_KARN_LIBERATED_PROBE = {
  id: 'mtg-z5q4-reviewed-karn-liberated-restart-outcome',
  families: ['priority', 'targets', 'zone-card-selection'],
  evidence:
    'An installed Forge 2.0.14 probe casts the exact position-pinned Karn Liberated, human-routes and resolves two +4 activations against the opponent hand, then activates the -14. Forge actually restarts the match and the probe observes the exact non-Aura permanent object exiled by Karn on the new-game local battlefield under local control. Other RestartGame effects, restrictions, return chains, identities, and loyalty compositions remain closed.',
} as const;

/** Exact Morph creature whose face-up trigger produces a fixed three-color bundle. */
export const LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_COHORTS = [
  { positions: [337] as const, families: ['priority', 'optional-costs', 'combat'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_SAFE_POSITIONS = [337] as const;
export const LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_PROBE = {
  id: 'mtg-z5q4-reviewed-rattleclaw-mystic-morph-outcome',
  families: ['priority', 'optional-costs', 'combat'],
  evidence:
    'An installed Forge 2.0.14 probe casts the exact position-pinned Rattleclaw Mystic face down, observes the same object as a 2/2, human-routes its face-up special action and fixed {2} Morph payment, then observes that object face up as the printed 2/1 Mystic. Its face-up trigger produces {G}{U}{R}; the probe spends the otherwise unavailable red on Lightning Bolt and observes the exact three-life loss. Other Morph costs, identities, triggers, and mana compositions remain closed.',
} as const;

/** Exact Phoenix whose optional graveyard trigger pays one ordinary red mana. */
export const LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_COHORTS = [
  { positions: [274] as const, families: ['priority', 'optional-costs', 'combat'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_SAFE_POSITIONS = [274] as const;
export const LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_EXCLUDED_POSITIONS = [] as const;
export const LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_PROBE = {
  id: 'mtg-z5q4-reviewed-lightning-phoenix-triggered-payment-outcome',
  families: ['priority', 'optional-costs', 'combat'],
  evidence:
    'An installed Forge 2.0.14 probe discards the exact position-pinned Lightning Phoenix, deals four damage to its opponent, and observes Forge route the optional paid graveyard trigger through confirmTrigger rather than an assumed payment-confirmation callback. Declining leaves the exact Phoenix object in the graveyard. After damage on a later turn, accepting and paying the ordinary {R} through the human mana seam returns that same object to the battlefield as the printed 2/2. Baral, Chief of Compliance and every other triggered cost, effect, identity, and payment shape remain closed.',
} as const;

/** Exact Baral trigger whose optional draw cost leads to one exact hand discard. */
export const LEGACY_CUBE_REVIEWED_BARAL_COHORTS = [
  {
    positions: [85] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_BARAL_SAFE_POSITIONS = [85] as const;
export const LEGACY_CUBE_REVIEWED_BARAL_PROBE = {
  id: 'mtg-z5q4-reviewed-baral-triggered-loot-outcome',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    "An installed Forge 2.0.14 probe casts the exact position-pinned Baral, Chief of Compliance and counters two opposing Lightning Bolt spells with Counterspell. Forge routes Baral's optional loot through confirmTrigger rather than confirmPayment. Declining leaves the library unchanged. Accepting immediately pays the exact Draw<1/You> cost, reducing the library by one before Forge asks for a hand-card selection; the probe selects one exact Island object and observes that object in its owner's graveyard. Other triggered costs, discard amounts and modes, source identities, and compositions remain closed.",
} as const;

/** Exact draw replacements whose optional costs are routed through Forge's resolver. */
export const LEGACY_CUBE_REVIEWED_UNLESS_COST_COHORTS = [
  { positions: [11] as const, families: ['priority', 'optional-costs', 'combat'] as const },
  {
    positions: [461] as const,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_UNLESS_COST_SAFE_POSITIONS = [11, 461] as const;
export const LEGACY_CUBE_REVIEWED_UNLESS_COST_EXCLUDED_POSITIONS = [] as const;
export const LEGACY_CUBE_REVIEWED_UNLESS_COST_PROBE = {
  id: 'mtg-z5q4-reviewed-unless-cost-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    'Installed Forge 2.0.14 probes exercise both exact position-pinned UnlessCost compositions through PlaySpellAbility.payCostDuringAbilityResolve. Esper Sentinel draws exactly one card when its opponent declines the dynamic mana cost and draws none when that opponent pays before the spell resolves. Nahiri, the Harbinger leaves hand and library unchanged when its +2 discard is declined, then moves the selected exact card object to the graveyard and draws exactly one when paid. Other UnlessCost sources, payers, costs, effects, identities, and compositions remain closed.',
} as const;

/** Exact Stack-target counterspells composed with their exact UnlessCost effects. */
export const LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_COHORTS = [
  { positions: [42, 122, 131] as const, families: ['priority', 'targets', 'optional-costs'] as const },
  {
    positions: [140] as const,
    families: ['priority', 'targets', 'modes', 'optional-costs', 'zone-card-selection'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_SAFE_POSITIONS = [42, 122, 131, 140] as const;
export const LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_PROBE = {
  id: 'mtg-z5q4-reviewed-counter-unless-cost-outcomes',
  families: ['priority', 'targets', 'modes', 'optional-costs', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 probes cast each exact position-pinned counterspell against a real Stack object. Mana Tithe and Mana Leak expose the targeted spell controller's exact fixed generic payment and prove both paid resolution and declined countering. Pact of Negation counters its exact Stack target, installs its real next-upkeep delayed trigger, and proves both the exact {3}{U}{U} payment and loss-on-decline branches. Supreme Will routes its one-of-two mode through the human seat, proves the counter-and-{3} branch against an exact Stack object, and separately proves its Dig branch moves one exact offered object to hand. The bridge checks source identity, root/sub-ability shape, exact counter parameters and exact single mana-only cost before delegating payment to Forge. Other Stack targets, costs, payers, modes, delayed triggers, identities, and compositions remain closed.",
} as const;

/** Exact Miscalculation composition: a Stack-target UnlessCost spell plus Cycling {2}. */
export const LEGACY_CUBE_REVIEWED_MISCALCULATION_COHORTS = [
  { positions: [133] as const, families: ['priority', 'targets', 'optional-costs'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_MISCALCULATION_SAFE_POSITIONS = [133] as const;
export const LEGACY_CUBE_REVIEWED_MISCALCULATION_PROBE = {
  id: 'mtg-z5q4-reviewed-miscalculation-outcomes',
  families: ['priority', 'targets', 'optional-costs'],
  evidence:
    'Installed Forge 2.0.14 probes exercise both exact position-pinned Miscalculation actions. The spell targets a real Stack object and proves its controller can either pay exactly {2} so the target resolves or decline so Forge counters it. The Cycling action pays exactly {2}, discards the selected Miscalculation object from hand to graveyard, and draws exactly one card from the library. The bridge checks source identity, root spell shape, exact counter parameters, and exact single mana-only UnlessCost before delegating payment to Forge; the ledger pins the complete card script including its Cycling line. Other Stack targets, costs, payers, cycling costs, identities, and compositions remain closed.',
} as const;

/** Exact Maul composition: one mandatory ETB Attach target plus Equip {2}{W}{W}. */
export const LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_COHORTS = [
  { positions: [81] as const, families: ['priority', 'targets'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_SAFE_POSITIONS = [81] as const;
export const LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_PROBE = {
  id: 'mtg-z5q4-reviewed-maul-of-the-skyclaves-outcomes',
  families: ['priority', 'targets'],
  evidence:
    'Installed Forge 2.0.14 probes cast the exact position-pinned Maul of the Skyclaves with two legal local creatures, select one exact backend-issued object for its mandatory enter-the-battlefield Attach trigger, and observe the exact attachment plus two power, two toughness, flying, and first strike. A later exact {2}{W}{W} Equip activation selects the other object, pays its whole mana-only cost through Forge, and observes the attachment and continuous effects move to that object. The bridge pins source identity, triggered Attach API/root/cardinality/candidates, ordinary Equip keyword/cost/candidates, and the ledger pins the complete card script. Other attachments, triggers, Equipment costs, targets, identities, and compositions remain closed.',
} as const;

/** Exact Embercleave composition: attacker discount, mandatory ETB Attach, and Equip {3}. */
export const LEGACY_CUBE_REVIEWED_EMBERCLEAVE_COHORTS = [
  { positions: [312] as const, families: ['priority', 'targets'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_EMBERCLEAVE_SAFE_POSITIONS = [312] as const;
export const LEGACY_CUBE_REVIEWED_EMBERCLEAVE_PROBE = {
  id: 'mtg-z5q4-reviewed-embercleave-outcomes',
  families: ['priority', 'targets'],
  evidence:
    'Installed Forge 2.0.14 casts the exact position-pinned Embercleave during combat with two controlled attackers and only four available mana, proving its printed {4}{R}{R} spell cost is reduced by exactly one generic mana per controlled attacker. The probe selects one exact backend-issued attacker for the mandatory enter-the-battlefield Attach trigger and observes exactly +1/+1; it assigns one first-strike damage to a blocking 1/1 and the remaining damage through that blocker, then observes seven total damage from the equipped and unblocked 2/2 attackers, proving double strike and trample together. A later exact {3} Equip activation exposes and honors target cancellation without mana or attachment change, then selects the other controlled creature, pays the whole mana-only cost through Forge, and observes the attachment and continuous effects move to that object. Invented and stale targets fail explicitly. The bridge pins source identity, triggered Attach API/root/cardinality/candidates, ordinary Equip keyword/cost/candidates, and the ledger pins the complete Flash, reducer, trigger, modifier, and Equip script. Other reductions, attachments, triggers, Equipment costs, targets, identities, and compositions remain closed.',
} as const;

/** Exact Living Weapon cohort: pinned Germ creation plus distinct Equip costs. */
export const LEGACY_CUBE_REVIEWED_LIVING_WEAPON_COHORTS = [
  { positions: [480, 525] as const, families: ['priority', 'targets', 'combat'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_LIVING_WEAPON_SAFE_POSITIONS = [480, 525] as const;
export const LEGACY_CUBE_REVIEWED_LIVING_WEAPON_PROBE = {
  id: 'mtg-z5q4-reviewed-living-weapon-outcomes',
  families: ['priority', 'targets', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes the exact position-pinned Kaldra Compleat and Batterskull scripts as separate board-outcome journeys. Each creates and automatically attaches to Forge's exact Living Weapon Germ token; Kaldra proves +5/+5, first strike, trample, indestructible, haste, combat-damage exile, and Equip {7}, while Batterskull proves +4/+4, vigilance, lifelink, its {3} self-return, and Equip {5}. The bridge pins each ordinary Equip activation to its exact source identity and one mana-only cost, and the ledger pins both complete scripts plus the generated-token dependency. Other Living Weapon, Equipment, token, attachment, trigger, return, cost, target, identity, and composition shapes remain closed.",
} as const;

/** Exact Foretell cohort: two fixed scripts with independently pinned token roots. */
export const LEGACY_CUBE_REVIEWED_FORETELL_COHORTS = [
  {
    positions: [49] as const,
    families: ['priority', 'optional-costs', 'mana-x', 'combat'] as const,
  },
  {
    positions: [119] as const,
    families: ['priority', 'optional-costs', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_FORETELL_SAFE_POSITIONS = [49, 119] as const;
export const LEGACY_CUBE_REVIEWED_FORETELL_PROBE = {
  id: 'mtg-z5q4-reviewed-foretell-outcomes',
  families: ['priority', 'optional-costs', 'mana-x', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes the exact position-pinned Starnheim Unleashed and Alrund's Epiphany scripts as separate normal-cast and Foretell journeys. The Foretell action pays exactly {2}, moves the exact hand object to face-down exile during its owner's turn, remains uncastable that turn, and offers only the exact printed alternative cost on a later turn. Starnheim's normal path creates one pinned 4/4 white Angel Warrior with flying and vigilance, while its foretold path pays one announced X twice plus {W} and creates exactly X of that token. Alrund's foretold path pays {4}{U}{U}, creates exactly two pinned 1/1 blue Birds with flying, grants exactly one extra turn to its controller, and exiles the spell. Invented and stale moves fail explicitly, and cancellation restores the exposed mana and zone state. Other Foretell, variable payment, token, alternative-zone cast, hidden-information, timing, identity, and composition shapes remain closed.",
} as const;

/** Exact Satyr Wayfinder composition: optional one-land choice from a public four-card Dig. */
export const LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_COHORTS = [
  {
    positions: [341] as const,
    families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_SAFE_POSITIONS = [341] as const;
export const LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_PROBE = {
  id: 'mtg-z5q4-reviewed-satyr-wayfinder-outcomes',
  families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'],
  evidence:
    'Installed Forge 2.0.14 casts the exact position-pinned Satyr Wayfinder and publicly reveals up to four real library objects. The probe proves the optional callback offers only lands among those objects, moves one exact selected land to hand and every other revealed object to graveyard, proves the decline branch moves all four to graveyard, and covers a short library without inventing cards. Invented and stale moves fail explicitly. The bridge pins source identity, triggered Dig root, every behavior-bearing parameter, callback participants and bounds, null delayed reveal, and exposed library-land candidates. Other Dig counts, filters, destinations, visibility, optionality, identities, and compositions remain closed.',
} as const;

/** Exact blue selection cohort: three position-pinned library views with distinct outcomes. */
export const LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_COHORTS = [
  {
    positions: [84] as const,
    families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'] as const,
  },
  {
    positions: [90] as const,
    families: [
      'priority',
      'optional-costs',
      'zone-card-selection',
      'ordering',
      'replacement-trigger-choices',
    ] as const,
  },
  {
    positions: [146] as const,
    families: ['priority', 'zone-card-selection', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_SAFE_POSITIONS = [84, 90, 146] as const;
export const LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_PROBE = {
  id: 'mtg-z5q4-reviewed-blue-library-selection-outcomes',
  families: [
    'priority',
    'optional-costs',
    'zone-card-selection',
    'ordering',
    'combat',
    'replacement-trigger-choices',
  ],
  evidence:
    'Installed Forge 2.0.14 probes the exact position-pinned Augur of Bolas, Search for Azcanta, and Narset, Parter of Veils scripts. The routes expose only the real eligible objects from each private library view, enforce exact optional bounds, reject invented and stale identities, and preserve Forge-owned zone moves and remainder ordering. Separate journeys prove Augur selection and decline, Search surveil plus false and true transform conditions, Azcanta blue mana and activated Dig, Narset loyalty payment and optional Dig, and Narset preventing only an opponent from drawing more than once in a turn. Other Dig, Surveil, transform, draw-limit, identity, callback, and composition shapes remain closed.',
} as const;

/** Exact low-risk permanent cohort: two planeswalkers and one transforming token maker. */
export const LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_COHORTS = [
  {
    positions: [25] as const,
    families: ['priority', 'targets', 'naming-text-numbers'] as const,
  },
  {
    positions: [194] as const,
    families: ['priority', 'optional-costs', 'combat'] as const,
  },
  {
    positions: [384] as const,
    families: ['priority', 'targets', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_SAFE_POSITIONS = [25, 194, 384] as const;
export const LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_PROBE = {
  id: 'mtg-z5q4-reviewed-gideon-garruk-bloodline-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'naming-text-numbers', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes the exact position-pinned Gideon Blackblade, Bloodline Keeper, and Garruk Wildspeaker scripts. Gideon's own-turn continuous animation and damage prevention, optional other-local-creature target, exact three-keyword menu, end-of-turn duration, and nonland exile are observed from real board state. Bloodline Keeper creates the pinned Vampire token, transforms only at five controlled Vampires under the same object identity, and applies its back-face anthem only to other controlled Vampires. Garruk selects exactly two distinct battlefield lands to untap, creates the pinned Beast token, and grants +3/+3 and trample only to its controller's creatures until end of turn. Invented, stale, wrong-domain, wrong-cardinality, duplicate, and canceled choices remain fail-closed and atomic. Other animation, prevention, keyword menus, alternate modes, generated objects, multiple targets, identities, and compositions remain closed.",
} as const;

/** Exact Hideaway 4 cohort: one shared entry choice and two pinned activation conditions. */
export const LEGACY_CUBE_REVIEWED_HIDEAWAY_COHORTS = [
  {
    positions: [79, 120] as const,
    families: ['priority', 'zone-card-selection', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_HIDEAWAY_SAFE_POSITIONS = [79, 120] as const;
export const LEGACY_CUBE_REVIEWED_HIDEAWAY_PROBE = {
  id: 'mtg-z5q4-reviewed-hideaway-four-outcomes',
  families: ['priority', 'zone-card-selection', 'replacement-trigger-choices'],
  evidence:
    'Installed Forge 2.0.14 probes the exact position-pinned Windbrisk Heights and Shelldock Isle scripts. The shared entry route offers exactly the top four real library objects, requires exactly one choice, exiles that object face down linked to the source, puts the other three on the library bottom in Forge-randomized order, and preserves private identity. Separate journeys prove tapped entry, the printed mana color, the exact attack-count and library-size activation conditions, optional confirmation, no-mana-cost play, invented and stale refusal, and actual stack and zone outcomes. Other Hideaway amounts, library selections, linked exiles, lands, activation conditions, free casts, identities, callbacks, and compositions remain closed.',
} as const;

/** Exact Sword composition: Equip {2}, fixed continuous effects, and one combat trigger target. */
export const LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_COHORTS = [
  { positions: [521] as const, families: ['priority', 'targets'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_SAFE_POSITIONS = [521] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_PROBE = {
  id: 'mtg-z5q4-reviewed-sword-of-fire-and-ice-outcome',
  families: ['priority', 'targets'],
  evidence:
    'Installed Forge 2.0.14 equips the exact position-pinned Sword of Fire and Ice to one selected local creature for exactly {2}, observes that creature gain exactly +2/+2 and protection from red and blue, connects with the selected equipped attacker, selects one exact backend-issued Any target for the mandatory combat-damage trigger, deals exactly two damage to that target, and draws exactly one card for the Sword controller. The bridge pins source identity, Equip root/cost/candidates, trigger root/cardinality/domain/damage/draw chain, and the ledger pins the complete ordered card script. Other Equipment, Swords, attachments, triggers, targets, identities, effects, and compositions remain closed.',
} as const;

/** Exact Sword composition: Equip {2}, fixed continuous effects, opponent discard, and land untap. */
export const LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_COHORTS = [
  { positions: [478] as const, families: ['priority', 'targets', 'zone-card-selection'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_SAFE_POSITIONS = [478] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_PROBE = {
  id: 'mtg-z5q4-reviewed-sword-of-feast-and-famine-outcome',
  families: ['priority', 'targets', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 equips the exact position-pinned Sword of Feast and Famine to one selected local creature through exactly two {2} mana-payment decisions, observes exactly +2/+2 and protection from black and green, and connects through untapped black and green blockers. For the mandatory combat-damage trigger, Forge gives the defending human only exact backend-issued cards in that player's hand, rejects invented and stale choices, moves exactly the selected card to that player's graveyard, and untaps every land controlled by the Sword controller. The bridge pins source identity, Equip root/cost/candidates, and the Discard root/recipient/count/mode/hand candidates/UntapAll chain; the ledger pins the complete ordered script. Other Equipment, Swords, discards, untap effects, identities, and compositions remain closed.",
} as const;

/** Exact Sword composition: Equip {2}, fixed continuous effects, life gain, and an optional graveyard target. */
export const LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_COHORTS = [
  {
    positions: [487] as const,
    families: ['priority', 'targets', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_SAFE_POSITIONS = [487] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_PROBE = {
  id: 'mtg-z5q4-reviewed-sword-of-light-and-shadow-outcomes',
  families: ['priority', 'targets', 'replacement-trigger-choices'],
  evidence:
    "Installed Forge 2.0.14 equips the exact position-pinned Sword of Light and Shadow to one selected local creature for exactly {2}, observes exactly +2/+2 and protection from white and black, and connects through those blocker colors. Its mandatory combat-damage trigger gains exactly three life, then exposes only the optional zero-or-one creature target in the Sword controller's graveyard. The probes cover both decline and exact-return branches, reject invented and stale targets, and prove target cancellation leaves hand, mana, stack, and objects unchanged. The bridge pins source identity, Equip root/cost/candidates, GainLife trigger root and amount, and the exact ChangeZone subability including controller, zones, target domain, bounds, optional decider, and composition; the ledger pins the complete ordered script. Other Equipment, Swords, attachments, triggers, graveyard selections, identities, effects, and compositions remain closed.",
} as const;

/** Exact Sword composition: Equip {2}, fixed continuous effects, one Wolf, and mill ten. */
export const LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_COHORTS = [
  { positions: [509] as const, families: ['priority', 'targets', 'combat'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_SAFE_POSITIONS = [509] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_PROBE = {
  id: 'mtg-z5q4-reviewed-sword-of-body-and-mind-outcomes',
  families: ['priority', 'targets', 'combat'],
  evidence:
    "Installed Forge 2.0.14 equips the exact position-pinned Sword of Body and Mind to one selected local creature for exactly {2}, proves target cancellation preserves mana, attachment, and objects, reassigns the Equipment to a second exact creature, and observes exactly +2/+2 and protection from green and blue. The equipped creature connects through otherwise-eligible green and blue blockers, creates exactly one pinned green 2/2 Wolf token for the Sword controller, and moves exactly ten cards from the damaged player's library to that player's graveyard. Invented and stale Equip target identities fail explicitly. The bridge pins source identity, Equip root, mana-only cost and candidates; the ledger pins the complete ordered Token-to-Mill composition and exact generated dependency. Other Equipment, Swords, attachments, generated objects, mill effects, combat triggers, identities, and compositions remain closed.",
} as const;

/** Exact Sword composition: Equip {2}, optional owned-creature blink, and one basic-land search. */
export const LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_COHORTS = [
  { positions: [508] as const, families: ['priority', 'targets', 'zone-card-selection'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_SAFE_POSITIONS = [508] as const;
export const LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_PROBE = {
  id: 'mtg-z5q4-reviewed-sword-of-hearth-and-home-outcomes',
  families: ['priority', 'targets', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 equips the exact position-pinned Sword of Hearth and Home to one selected local creature for exactly {2}, observes exactly +2/+2 and protection from green and white, and connects through those blocker colors. Its mandatory combat-damage trigger offers only the optional zero-or-one creature the Sword controller owns, then searches that controller's real library for exactly one optional basic land. The probes cover decline and exact blink/search branches, reject invented and stale target and library identities, and prove the selected creature and basic return to the battlefield under the Sword controller before remembered state is cleared. The bridge pins source identity, Equip root/cost/candidates, ChangeZone trigger target, library callback, remembered return and cleanup chain; the ledger pins the complete ordered script. Other Equipment, Swords, attachments, targets, searches, remembered moves, identities, effects, and compositions remain closed.",
} as const;

/** Exact Jitte composition: Equip {2}, combat charge counters, and three one-counter modes. */
export const LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_COHORTS = [
  { positions: [506] as const, families: ['priority', 'targets', 'modes'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_SAFE_POSITIONS = [506] as const;
export const LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_PROBE = {
  id: 'mtg-z5q4-reviewed-umezawas-jitte-outcomes',
  families: ['priority', 'targets', 'modes'],
  evidence:
    "Installed Forge 2.0.14 equips the exact position-pinned Umezawa's Jitte to one selected local creature through exactly two {2} mana-payment decisions, connects with that exact creature, and puts exactly two charge counters on Jitte. Three exact activations each remove one source charge counter: the human selects the creature curse and observes -1/-1 on the selected opposing creature, selects life and observes exactly two life gained, and selects the equipped-creature pump and observes exactly +2/+2. The bridge pins source identity, Equip root/cost/candidates, the one-charge source cost, the exact ordered three-mode Charm, and the curse target; the ledger pins the complete ordered script. Invented and stale choices are rejected, while other Equipment, charge costs, modal abilities, targets, identities, effects, and compositions remain closed.",
} as const;

/** Exact modal composition: Birgi's front face plus Harnfel's discard-two-exile play grant. */
export const LEGACY_CUBE_REVIEWED_BIRGI_COHORTS = [
  {
    positions: [265] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_BIRGI_SAFE_POSITIONS = [265] as const;
export const LEGACY_CUBE_REVIEWED_BIRGI_PROBE = {
  id: 'mtg-z5q4-reviewed-birgi-harnfel-outcome',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Birgi card as its Harnfel, Horn of Bounty modal back face, then on its controller's next main phase activates the exact one-card discard cost. Forge offers only exact backend-issued hand objects, rejects invented and stale choices, moves the selected Mountain to its owner's graveyard, exiles exactly the top two library objects, offers a play action for an exiled object during that turn, and leaves the unplayed object in exile without that action on the controller's next turn. The bridge exposes Forge's modal spell actions, exact cost-discard callback, zones, and play actions; the ledger pins the complete ordered two-face script. Other modal cards, discard costs, dig/exile amounts, remembered objects, play grants, cleanup effects, identities, and compositions remain closed.",
} as const;

/** Exact Birthing Pod composition: Phyrexian activation, creature sacrifice, and derived search. */
export const LEGACY_CUBE_REVIEWED_BIRTHING_POD_COHORTS = [
  {
    positions: [382] as const,
    families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_BIRTHING_POD_SAFE_POSITIONS = [382] as const;
export const LEGACY_CUBE_REVIEWED_BIRTHING_POD_PROBE = {
  id: 'mtg-z5q4-reviewed-birthing-pod-outcome',
  families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 activates the exact position-pinned Birthing Pod during its controller's main phase, pays the generic activation mana and the {G/P} component with exactly two life, taps Birthing Pod, and offers only exact backend-issued local creatures for the one-creature sacrifice cost. The selected Llanowar Elves moves to its owner's graveyard; Forge then offers only exact mana-value-two creature cards from the library and puts the selected Wall of Blossoms onto the battlefield. Invented and stale choices are rejected. The bridge pins source identity, Phyrexian payment, exact cost-sacrifice and library-selection callbacks, zones, types, cardinalities, and the resulting board objects; the ledger pins the complete ordered script. Other Phyrexian costs, sacrifices, searches, derived values, identities, effects, and compositions remain closed.",
} as const;

/** Exact Ranger-Captain composition: optional library search plus fixed self-sacrifice lock. */
export const LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_COHORTS = [
  {
    positions: [26] as const,
    families: [
      'priority',
      'optional-costs',
      'zone-card-selection',
      'combat',
      'replacement-trigger-choices',
    ] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_SAFE_POSITIONS = [26] as const;
export const LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_PROBE = {
  id: 'mtg-z5q4-reviewed-ranger-captain-of-eos-outcome',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat', 'replacement-trigger-choices'],
  evidence:
    "Installed Forge 2.0.14 accepts and declines the exact position-pinned Ranger-Captain of Eos entry trigger. On acceptance it offers only exact backend-issued mana-value-one-or-less creatures from the library and moves the selected object to hand; invented and stale choices are rejected. In a separate exact route, the controller activates the fixed-source sacrifice, observes that Ranger-Captain in its owner's graveyard, observes an opposing Lightning Bolt absent from legal spell actions for the rest of that turn despite being held with available red mana, then observes the same spell action return on the opponent's next turn and deal exactly three damage. The bridge pins source identity, exact optional ChangeZone fields, the Effect root and fixed self-sacrifice cost; the ledger pins the complete ordered script. Other optional searches, sacrifice costs, casting restrictions, identities, effects, and compositions remain closed.",
} as const;

/** Exact Forbid composition: Stack counter plus optional discard-two Buyback. */
export const LEGACY_CUBE_REVIEWED_FORBID_COHORTS = [
  {
    positions: [142] as const,
    families: ['priority', 'targets', 'optional-costs'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_FORBID_SAFE_POSITIONS = [142] as const;
export const LEGACY_CUBE_REVIEWED_FORBID_PROBE = {
  id: 'mtg-z5q4-reviewed-forbid-outcome',
  families: ['priority', 'targets', 'optional-costs'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Forbid in response to an opposing Lightning Bolt and offers only the exact Stack spell as its mandatory singleton target. With Buyback declined, Forge counters Lightning Bolt into its owner's graveyard, puts the exact Forbid into its owner's graveyard, and deals no damage. In a separate route, Forge offers the exact discard-two Buyback; invented and stale choices are rejected, the first payment is canceled with the Bolt still on the Stack, the exact Forbid restored to hand, the graveyard unchanged, and all paid mana rolled back. On the second cast, two distinct backend-issued hand objects move to the graveyard, Lightning Bolt is countered without damage, and the exact Forbid returns to hand. The bridge pins source identity, complete Counter root and Stack target shape, the sole Buyback option, both observed cost-part instances, cardinality, cancellation, and object identities; the ledger pins the complete ordered script. Other counters, optional costs, discard costs, Buyback cards, targets, identities, effects, and compositions remain closed.",
} as const;

/** Exact Reveillark composition: Flying, Evoke, and the optional leaves-two return route. */
export const LEGACY_CUBE_REVIEWED_REVEILLARK_COHORTS = [
  {
    positions: [32] as const,
    families: ['priority', 'targets', 'optional-costs', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_REVEILLARK_SAFE_POSITIONS = [32] as const;
export const LEGACY_CUBE_REVIEWED_REVEILLARK_PROBE = {
  id: 'mtg-z5q4-reviewed-reveillark-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'combat'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Reveillark both for its ordinary mana cost and for Evoke {5}{W}. The ordinary spell remains on the battlefield; Evoke sacrifices the same object as it enters and fires the exact leaves-battlefield trigger. Separate observed routes choose zero, one, and two exact backend-issued creature cards with power two or less from the triggered controller's graveyard; selected objects return under their owners' control and no third object returns. Invented and stale choices are rejected, while power-three, opposing, noncreature, and wrong-zone objects are never offered. The bridge pins source identity, trigger root, zones, cardinality, filter, controller relationship, stable identities, and explicit completion; the ledger pins the complete ordered script. Other Evoke cards, leaves triggers, optional or multiple targets, zones, filters, controller relationships, identities, effects, and compositions remain closed.",
} as const;

/** Exact Bloodchief's Thirst composition: Kicker selects one of two singleton target blocks. */
export const LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_COHORTS = [
  {
    positions: [230] as const,
    families: ['priority', 'targets', 'optional-costs'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_SAFE_POSITIONS = [230] as const;
export const LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_PROBE = {
  id: 'mtg-z5q4-reviewed-bloodchiefs-thirst-outcomes',
  families: ['priority', 'targets', 'optional-costs'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Bloodchief's Thirst both with and without Kicker {2}{B}. The ordinary route offers only creatures and planeswalkers with mana value two or less, rejects invented and stale target identities, destroys the selected exact low-value permanent, and leaves a high-value permanent untouched. The kicked route pays the complete additional cost, offers that same high-value permanent, and destroys its exact object without destroying anything else. Cancellation restores the spell, mana, and board. The bridge pins source identity, Kicker-dependent root/subability topology, exact singleton cardinality and filters, stable identities, and mutually exclusive target blocks; the ledger pins the complete ordered script. Other Kicker cards, nested target blocks, counts, filters, identities, effects, and compositions remain closed.",
} as const;

/** Exact Primal Might composition: announced X, mandatory pump target, then optional fight target. */
export const LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_COHORTS = [
  {
    positions: [344] as const,
    families: ['priority', 'targets', 'mana-x'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_SAFE_POSITIONS = [344] as const;
export const LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_PROBE = {
  id: 'mtg-z5q4-reviewed-primal-might-outcomes',
  families: ['priority', 'targets', 'mana-x'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Primal Might with X equal to two after offering a wider number range. It first offers only the controller's exact creature as the mandatory pump target, then offers only the opposing exact creature plus the explicit no-target branch for the nested fight. Separate routes choose no fight and the exact fight target: both leave the selected creature at 3/3 during the turn, the declined route preserves the opposing creature, and the fight route moves exactly that opposing creature to its owner's graveyard. Invented and stale identities are rejected. Canceling the root target choice restores the spell, mana, and both creatures. The bridge pins source identity, complete Pump-to-Fight topology, X binding, filters, cardinality, zones, and stable identities; the ledger pins the complete ordered script. Other X costs, nested targets, optional targets, filters, identities, effects, and compositions remain closed.",
} as const;

/** Exact Engineered Explosives composition: announced X, Sunburst, then fixed-source sweep. */
export const LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_COHORTS = [
  {
    positions: [483] as const,
    families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_SAFE_POSITIONS = [483] as const;
export const LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_PROBE = {
  id: 'mtg-z5q4-reviewed-engineered-explosives-outcomes',
  families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection'],
  evidence:
    'Installed Forge 2.0.14 casts the exact position-pinned Engineered Explosives with an announced X and records the colors actually spent through Forge mana objects. Sunburst puts exactly one CHARGE counter on it for each of those colors. Its exact {2}, fixed-source-sacrifice activation sacrifices that same object and destroys every and only nonland permanent whose live mana value equals its live CHARGE-counter count, while preserving lands and permanents at every other mana value. Cancellation restores the spell and mana before casting completes, and invented or stale backend move identities are rejected. The bridge pins source identity, activated DestroyAll topology, complete cost, fixed sacrifice identity, live counter binding, and nonland mana-value filter; the ledger pins the complete ordered script. Other Sunburst identities, X shapes, counter types, sacrifice objects, filters, effects, and compositions remain closed.',
} as const;

/** Exact Ponder and Portent compositions: look three, reorder, optionally shuffle, then draw. */
export const LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_COHORTS = [
  {
    positions: [125] as const,
    families: ['priority', 'zone-card-selection', 'ordering', 'replacement-trigger-choices'] as const,
  },
  {
    positions: [130] as const,
    families: [
      'priority',
      'targets',
      'zone-card-selection',
      'ordering',
      'replacement-trigger-choices',
    ] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_SAFE_POSITIONS = [125, 130] as const;
export const LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_PROBE = {
  id: 'mtg-z5q4-reviewed-reorder-or-shuffle-outcomes',
  families: ['priority', 'targets', 'zone-card-selection', 'ordering', 'replacement-trigger-choices'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Ponder and Portent scripts and exposes the exact three backend-issued top-library objects for ordering. Observed accept and shuffle routes prove the selected order is preserved when shuffle is declined and Forge's actual library order changes when shuffle is accepted. Ponder draws the selected top card immediately. Portent targets the exact selected player's library, draws no card during resolution, then draws for its caster at the beginning of the next turn's upkeep. Invented and stale identities are rejected, and cancellation leaves the spell, mana, hand, and library unchanged. The bridge pins source identity, target-player identity, ordering membership and cardinality, the optional shuffle branch, immediate versus delayed draw timing, and stable card identities; the ledger pins both complete ordered scripts. Other library manipulation, optional actions, delayed triggers, targets, counts, identities, effects, and compositions remain closed.",
} as const;

/** Exact Animate Dead composition: graveyard Aura, reanimation, attachment, and delayed sacrifice. */
export const LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_COHORTS = [
  {
    positions: [210] as const,
    families: ['priority', 'targets', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_SAFE_POSITIONS = [210] as const;
export const LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_PROBE = {
  id: 'mtg-z5q4-reviewed-animate-dead-lifecycle',
  families: ['priority', 'targets', 'combat'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Animate Dead after Entomb puts an exact creature card into a graveyard. Its target menu contains only exact backend-issued graveyard creature objects; invented and stale identities are rejected, and cancellation restores the Aura and its mana payment. Resolution moves the selected creature to the spell controller's battlefield, attaches Animate Dead, and changes the creature's displayed power by exactly -1 while preserving toughness. A separately cast exact permanent-removal spell moves Animate Dead away from the battlefield and the delayed trigger sacrifices that exact reanimated creature. The bridge pins source identity, spell-root Attach topology, singleton cardinality, graveyard zone, creature type, and stable identities; the ledger pins the complete ordered reanimation, keyword-rewrite, attachment, delayed-sacrifice, cleanup, and continuous-effect script. Other graveyard Auras, attachments, reanimation effects, remembered objects, enchant rewrites, delayed triggers, identities, effects, and compositions remain closed.",
} as const;

/** Exact Heartless Act composition: destroy a counterless creature or remove up to three counters. */
export const LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_COHORTS = [
  {
    positions: [215] as const,
    families: ['priority', 'targets', 'modes', 'zone-card-selection'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_SAFE_POSITIONS = [215] as const;
export const LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_PROBE = {
  id: 'mtg-z5q4-reviewed-heartless-act-outcomes',
  families: ['priority', 'targets', 'modes', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Heartless Act through both of its modes. The destroy route offers only exact battlefield creatures with no counters and destroys the chosen object. The remove route offers exact battlefield creatures, then routes the chosen object's actual counter types and the bounded zero-through-three removal amount through the session controller; the selected counter count is removed and every other counter remains. Invented and stale identities and out-of-range numbers are rejected, while cancellation restores the spell, mana, target, and counters. The bridge pins source identity, exact Charm choice topology, mutually exclusive target blocks, stable identities, counter-type membership, and number bounds; the ledger pins the complete ordered script. Other modal spells, RemoveCounter effects, Any counter types, UpTo amounts, target filters, identities, effects, and compositions remain closed.",
} as const;

/** Exact Agadeem's Awakening composition: X reanimation plus the modal pay-life land. */
export const LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_COHORTS = [
  {
    positions: [236] as const,
    families: ['priority', 'targets', 'optional-costs', 'mana-x'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_SAFE_POSITIONS = [236] as const;
export const LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_PROBE = {
  id: 'mtg-z5q4-reviewed-agadeems-awakening-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'mana-x'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Agadeem's Awakening with an announced X and offers zero or more exact backend-issued creature cards from its controller's graveyard whose mana values are at most X and pairwise distinct. Accepting the selection moves only those objects to the battlefield; invented, stale, opposing, over-X, repeated, and duplicate-mana-value answers are rejected, while cancellation restores the spell and mana. Playing the exact Agadeem, the Undercrypt modal land offers only pay 3 life or decline, producing the exact life and tapped-state deltas, and its tap ability produces black mana. The bridge pins both source identities, spell/root topology, target zones, ownership, X and Y derivations, dynamic cardinality, distinct mana values, entry replacement payment, payer, tap fallback, and mana color; the ledger pins the complete ordered two-face script. Other X reanimation, variable multiple targets, distinct-value restrictions, optional pay-life replacements, modal faces, identities, effects, and compositions remain closed.",
} as const;

/** Exact modal land spell cohort: two distinct front spells plus the shared pay-three-life land face. */
export const LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_COHORTS = [
  {
    positions: [70] as const,
    families: ['priority', 'optional-costs', 'combat'] as const,
  },
  {
    positions: [377] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_SAFE_POSITIONS = [70, 377] as const;
export const LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_PROBE = {
  id: 'mtg-z5q4-reviewed-modal-land-spell-outcomes',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'replacement-trigger-choices', 'combat'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Emeria's Call and Turntimber Symbiosis scripts and plays both exact modal land faces. Emeria creates exactly two pinned 4/4 white Angel Warrior tokens with flying and grants indestructible until its controller's next turn only to that controller's non-Angel creatures. Turntimber exposes only eligible creatures among the exact top seven real library objects, permits a zero-or-one stable-identity selection, moves the chosen object to the battlefield, adds exactly three +1/+1 counters only at mana value three or less, and leaves Forge to randomize the remainder onto the library bottom. Invented and stale identities are rejected and cancellation rolls the cast back. Each land offers only pay exactly 3 life or decline, producing the exact life and tapped-state deltas, and taps for its printed color. The bridge pins both front identities and spell topologies, the shared land replacement shape, callback participants, bounds, zones, filters, conditional counter branches, generated token, temporary keyword filter and duration, and mana colors; the ledger pins both complete ordered two-face scripts. Other modal faces, life payments, Dig, ChangeZone, counters, generated objects, keyword grants, identities, effects, and compositions remain closed.",
} as const;

/** Exact Convoke cohort: one payment interaction, four independently observed outcomes. */
export const LEGACY_CUBE_REVIEWED_CONVOKE_COHORTS = [
  {
    positions: [33] as const,
    families: ['priority', 'mana-x', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [58, 310] as const,
    families: ['priority', 'targets', 'mana-x', 'zone-card-selection'] as const,
  },
  {
    positions: [400] as const,
    families: ['priority', 'mana-x', 'zone-card-selection'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_CONVOKE_SAFE_POSITIONS = [33, 58, 310, 400] as const;
export const LEGACY_CUBE_REVIEWED_CONVOKE_PROBE = {
  id: 'mtg-z5q4-reviewed-convoke-outcomes',
  families: ['priority', 'targets', 'mana-x', 'zone-card-selection', 'combat'],
  evidence:
    'Installed Forge 2.0.14 casts the four exact position-pinned Convoke scripts through a user-stated creature-to-mana-shard distribution. Observed ordinary and Convoke routes prove only eligible untapped local creatures are offered, every selected creature taps, colored creatures pay their color when required and otherwise reduce generic mana, and unselected creatures remain untapped. Venerated Loxodon puts one +1/+1 counter on exactly the creatures that convoked it; Conclave Tribunal exiles the selected exact opposing nonland permanent until Tribunal leaves; Stoke the Flames deals exactly four damage to its selected target; Chord of Calling combines an announced X with Convoke, offers only creature cards of mana value X or less from the caster library, moves the selected exact identity to the battlefield, and shuffles. Invented and stale identities are rejected, and canceled downstream choices roll the cast and its Convoke taps back. The bridge pins source identity, spell topology, Convoke-only flags, payment bounds and stable identities; the ledger pins all four complete ordered scripts. Improvise, Waterbend, other special payments, costs, targets, filters, triggers, effects, and compositions remain closed.',
} as const;

/** Exact Delve cohort: one graveyard-payment interaction, three independently observed outcomes. */
export const LEGACY_CUBE_REVIEWED_DELVE_COHORTS = [
  {
    positions: [111, 195, 462] as const,
    families: ['priority', 'mana-x', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_DELVE_SAFE_POSITIONS = [111, 195, 462] as const;
export const LEGACY_CUBE_REVIEWED_DELVE_PROBE = {
  id: 'mtg-z5q4-reviewed-delve-outcomes',
  families: ['priority', 'mana-x', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 casts the three exact position-pinned Delve scripts through a user-stated subset of Forge's eligible graveyard cards. Observed zero, partial, and full Delve routes prove only local graveyard cards are offered, each selected card reduces exactly one generic mana, colored costs remain payable, and selected exact identities move to exile. Murktide Regent enters with one +1/+1 counter for each instant or sorcery exiled with its cast and gets another when one later leaves its controller's graveyard; Tasigur enters after Delve and its activated ability mills two then lets the opponent return one exact nonland identity; Hogaak combines Delve and Convoke without spending mana and can be cast from its controller's graveyard. Invented and stale identities are rejected. Canceling downstream ordinary-mana payment after a partial Delve choice restores every selected graveyard object, the spell, mana actions, and stack; the exact Convoke cohort separately proves rollback of selected creature taps. The bridge pins exact source scripts, payment bounds, zones, candidates, and stable identities; the ledger pins all three complete ordered scripts. Other Delve, Convoke-plus-Delve, graveyard-cast, special-payment, trigger, filter, identity, effect, and composition shapes remain closed.",
} as const;

/** Exact free-counterspell cohort: two hand-exile payments and one Island return. */
export const LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_COHORTS = [
  {
    positions: [143, 150, 155] as const,
    families: ['priority', 'targets', 'optional-costs'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_SAFE_POSITIONS = [143, 150, 155] as const;
export const LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_PROBE = {
  id: 'mtg-z5q4-reviewed-free-counterspell-outcomes',
  families: ['priority', 'targets', 'optional-costs'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Force of Negation, Force of Will, and Daze scripts through both ordinary mana and their named alternate costs. The ordinary routes pay exactly three, five, and two Islands respectively without exiling a hand card, paying life, or returning an Island. Force of Negation's alternate action is absent for a creature spell and during its controller's turn, appears off-turn for an exact noncreature Stack object, exiles one exact other blue hand card, and exiles the countered spell. Force of Will pays exactly one life, exiles one exact other blue hand card, and puts both itself and the countered spell in their owners' graveyards. Daze returns one exact controlled Island; declining its exact {1} UnlessCost counters the target, while paying that tax resolves the exact Lightning Bolt for three damage. Invented and stale identities are rejected, and cancellation restores the source spell, chosen-cost resources, mana, and the exact preexisting Stack object. The bridge pins all three complete scripts, adjusted cost vectors, source identities, timings, targets, filters, destinations, and stable choice identities. Other alternate costs, return or exile payments, counter taxes, timings, targets, filters, identities, effects, and compositions remain closed.",
} as const;

/** Exact Legion's Landing composition: entry token, attack transform, and Adanto token route. */
export const LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_COHORTS = [
  {
    positions: [4] as const,
    families: ['priority', 'optional-costs', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_SAFE_POSITIONS = [4] as const;
export const LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_PROBE = {
  id: 'mtg-z5q4-reviewed-legions-landing-outcome',
  families: ['priority', 'optional-costs', 'combat'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Legion's Landing and creates one exact white 1/1 Vampire with lifelink from the byte-pinned w_1_1_vampire_lifelink script. Attacking with two creatures leaves the source on its front face; attacking with exactly three transforms the same object into Adanto, the First Fort. Adanto pays one exact white mana through its tap ability, and its exact {2}{W}, tap activation creates a second matching Vampire. Invented and stale decisions are rejected, and combat damage observes the token's lifelink. The bridge keeps Forge authoritative for trigger, state, mana, token, and combat outcomes; the ledger pins the complete ordered double-faced script and generated dependency. Other generated objects, attack thresholds, state changes, alternate modes, mana sources, activated token routes, identities, effects, and compositions remain closed.",
} as const;

/** Exact Gilded Goose composition: pinned Food creation plus sacrifice-for-color mana. */
export const LEGACY_CUBE_REVIEWED_GILDED_GOOSE_COHORTS = [
  {
    positions: [334] as const,
    families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_GILDED_GOOSE_SAFE_POSITIONS = [334] as const;
export const LEGACY_CUBE_REVIEWED_GILDED_GOOSE_PROBE = {
  id: 'mtg-z5q4-reviewed-gilded-goose-outcome',
  families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Gilded Goose and creates one exact Food permanent from the byte-pinned c_a_food_sac token script. On a later turn, Lightning Bolt's red mana payment offers Gilded Goose as the exact backend-issued source for {R}, and the Goose activation offers only backend-issued legal Food permanents. An invented choice is rejected; cancellation rolls back the tap and leaves the same Food on the battlefield; the retried payment sacrifices the selected Food identity, taps Gilded Goose, and pays Bolt's red symbol for exactly three damage while the controller gains no life. A stale choice is rejected. The bridge pins source identity, Mana root, Produced Any, ordered tap and singleton Food-sacrifice parts, candidate legality, cancellation, and object identities; the ledger pins the complete ordered card script and exact generated token dependency. Other generated objects, Food costs, sacrifice costs, any-color abilities, identities, effects, and compositions remain closed.",
} as const;

/** Exact Pia/Siege-Gang composition: pinned entry tokens plus one chosen sacrifice. */
export const LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_COHORTS = [
  {
    positions: [262, 269, 275] as const,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_SAFE_POSITIONS = [262, 269, 275] as const;
export const LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_PROBE = {
  id: 'mtg-z5q4-reviewed-pia-siege-gang-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes cast the three exact position-pinned Pia Nalaar, Pia and Kiran Nalaar, and Siege-Gang Commander scripts and read their generated Thopter and Goblin objects from the resulting board. Their activated abilities offer only exact backend-issued legal Artifact or Goblin sacrifice candidates, reject invented and stale identities, preserve mana, target, stack, and objects when canceled, and move exactly the selected payment object to its owner's graveyard. Pia Nalaar separately gives one exact artifact creature +1/+0 until end of turn and prevents one exact creature from blocking for that turn; Pia and Kiran and Siege-Gang each deal exactly two damage to an exact selected target. The bridge pins all three source identities, complete root ability and ordered cost shapes, candidate filters, targets, amounts, token dependencies, cancellation, and temporal expiry. Other Artifact or Goblin sacrifices, tokens, targets, pumps, damage, cannot-block effects, identities, and compositions remain closed.",
} as const;

/** Exact Treachery composition: creature Aura control plus up-to-five-land untap. */
export const LEGACY_CUBE_REVIEWED_TREACHERY_COHORTS = [
  {
    positions: [115] as const,
    families: ['priority', 'targets', 'zone-card-selection'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_TREACHERY_SAFE_POSITIONS = [115] as const;
export const LEGACY_CUBE_REVIEWED_TREACHERY_PROBE = {
  id: 'mtg-z5q4-reviewed-treachery-outcomes',
  families: ['priority', 'targets', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Treachery, targets one exact duplicate-name creature, transfers control of that object, and restores its prior controller when the Aura leaves. Forge's exact entry trigger offers all currently untappable lands on the battlefield, including opposing lands, with bounds zero through five. The human route proves choosing zero and a nonzero subset through Done, untaps only the selected objects, preserves unselected lands, and rejects invented and stale identities. Canceling the Aura payment or target restores the exact hand, mana, stack, and battlefield state. The bridge pins the complete Aura spell, creature target, trigger root, callback title, optionality, raw bounds, all-battlefield candidate set, current untap legality, and stable identities. Other Auras, untap effects, candidate filters, amounts, controllers, titles, callback parameters, identities, and compositions remain closed.",
} as const;

/** Exact Skyclave Apparition composition: optional exile plus source-linked Illusion. */
export const LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_COHORTS = [
  {
    positions: [18] as const,
    families: ['priority', 'targets', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_SAFE_POSITIONS = [18] as const;
export const LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_PROBE = {
  id: 'mtg-z5q4-reviewed-skyclave-apparition-outcomes',
  families: ['priority', 'targets', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes cast the exact position-pinned Skyclave Apparition through both optional-target branches. Choosing no target exiles nothing and creates no token when that source leaves. Choosing one exact backend-issued opposing nonland, nontoken permanent with mana value four or less exiles that object; invented and stale choices are rejected. When the same Apparition leaves, the exiled card's owner creates one exact blue Illusion whose power and toughness equal that object's mana value. The bridge pins the optional ChangeZone trigger root, cardinality, zone, candidate filter, memory flag, and stable target identity; the ledger pins the complete ordered source script and exact u_x_x_illusion dependency. Other optional targets, trigger targets, generated objects, remembered objects, identities, effects, and compositions remain closed.",
} as const;

/** Exact Path to Exile composition: exile plus the target controller's optional basic search. */
export const LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_COHORTS = [
  {
    positions: [44] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_SAFE_POSITIONS = [44] as const;
export const LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_PROBE = {
  id: 'mtg-z5q4-reviewed-path-to-exile-outcomes',
  families: ['priority', 'targets', 'zone-card-selection', 'replacement-trigger-choices'],
  evidence:
    "Installed Forge 2.0.14 probes both exact position-pinned Path to Exile search branches. The spell targets one exact backend-issued opposing creature and moves that object to exile. Only that creature's controller receives the optional search, whose candidates are exact basic lands from that player's own library. Invented and stale choices are rejected; accepting moves the selected basic to that player's battlefield tapped and shuffles, while declining moves no library card. The bridge pins the root spell, target, subability topology, player relationship, origin, destination, filter, optionality, tapped flag, shuffle rule, and stable identities; the ledger pins the complete ordered source script. Other optional searches, targets, player relationships, zones, filters, amounts, identities, effects, and compositions remain closed.",
} as const;

/** Exact Glen Elendra composition: fixed self-sacrifice, stack target, and Persist. */
export const LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_COHORTS = [
  {
    positions: [105] as const,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_SAFE_POSITIONS = [105] as const;
export const LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_PROBE = {
  id: 'mtg-z5q4-reviewed-glen-elendra-archmage-outcome',
  families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 activates the exact position-pinned Glen Elendra Archmage in response to one opposing noncreature spell, pays blue mana, sacrifices the fixed source, and offers only the exact legal stack object as the mandatory singleton target. Invented and stale choices are rejected; the opposing spell is countered into its owner's graveyard, while the exact Archmage returns to the battlefield through Persist with one -1/-1 counter. The bridge pins source identity, activated Counter root, complete cost, stack-target cardinality and legality, and resulting objects; the ledger pins the complete ordered script. Other activated counters, stack targets, sacrifice shapes, Persist cards, identities, effects, and compositions remain closed.",
} as const;

/** Exact Recurring Nightmare composition: creature sacrifice, fixed return, and reanimation. */
export const LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_COHORTS = [
  {
    positions: [220] as const,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_PROBE = {
  id: 'mtg-z5q4-reviewed-recurring-nightmare-outcome',
  families: ['priority', 'targets', 'optional-costs', 'zone-card-selection'],
  evidence:
    "Installed Forge 2.0.14 activates the exact position-pinned Recurring Nightmare at sorcery speed, offers only exact backend-issued local creatures for its one-creature sacrifice cost, returns the source to its owner's hand, and offers only exact local-graveyard creatures for the mandatory singleton reanimation target. Invented and stale choices are rejected; the selected sacrifice is in the graveyard, the selected target is on the battlefield, and Recurring Nightmare is in its owner's hand. The bridge pins source identity, root ability, ordered sacrifice and fixed-source-return costs, target zones and cardinality, and resulting objects; the ledger pins the complete ordered script. Other sacrifice costs, return costs, graveyard targets, identities, effects, and compositions remain closed.",
} as const;

/** Exact Priest composition: fixed-source sacrifice reanimation plus Unearth. */
export const LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_COHORTS = [
  {
    positions: [424] as const,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_PROBE = {
  id: 'mtg-z5q4-reviewed-priest-of-fell-rites-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    'Installed Forge 2.0.14 probes the exact position-pinned Priest of Fell Rites through both routes. Its battlefield activation offers only exact local-graveyard creatures, taps and sacrifices the fixed source, pays exactly three life, and returns the selected object to the battlefield; canceling the target selection leaves the source, life total, mana, and zones unchanged. Its graveyard Unearth action costs exactly {3}{W}{B}, returns that same object with haste so it can attack immediately, and Forge exiles it at the next end step or instead of another battlefield departure. Invented and stale choices are rejected. The bridge pins source identity, complete activated roots and costs, timing, target cardinality and zone, and Unearth-generated disposition; the ledger pins the complete ordered script. Other reanimation, source-sacrifice, pay-life, timing, Unearth, identity, effect, and composition shapes remain closed.',
} as const;

/** Exact Smuggler's Copter composition: Crew 1 plus the two combat-loot triggers. */
export const LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_COHORTS = [
  {
    positions: [517] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_PROBE = {
  id: 'mtg-z5q4-reviewed-smugglers-copter-outcomes',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes the exact position-pinned Smuggler's Copter through Crew 1 and both combat-loot routes. The Crew activation offers only exact backend-issued local untapped creatures and cancellation rolls the payment back; accepting taps creatures with sufficient total power and makes the Vehicle an artifact creature until end of turn. Attacking and blocking independently offer the optional trigger: declining changes no hand or library objects, while accepting draws exactly one card and then offers only exact current hand objects for one discard. Invented and stale choices are rejected. The bridge pins source identity, Crew amount and candidate type, complete attack/block trigger topology, optional payment, discard mode and cardinality, and stable object identities; the ledger pins the complete ordered script. Other Vehicles, Crew amounts, tap candidates, combat triggers, payments, discard modes, identities, effects, and compositions remain closed.",
} as const;

/** Exact Cryptbreaker composition: chosen discard for a Zombie plus tap-three draw/loss. */
export const LEGACY_CUBE_REVIEWED_CRYPTBREAKER_COHORTS = [
  {
    positions: [161] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_CRYPTBREAKER_PROBE = {
  id: 'mtg-z5q4-reviewed-cryptbreaker-outcomes',
  families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
  evidence:
    'Installed Forge 2.0.14 probes both exact position-pinned Cryptbreaker activations. The first pays exactly {1}{B}, taps the source, offers only exact current hand objects for one discard, and creates one pinned 2/2 black Zombie under its controller; invented and stale choices are rejected, and cancellation restores the hand, mana, source, stack, and objects. The second offers only exact controlled untapped Zombies until exactly three distinct objects are chosen, rejects invented, stale, wrong-subtype, tapped, opposing, duplicate, and wrong-count choices, then taps those objects, draws exactly one card, and loses exactly one life. The bridge pins source identity, both complete activated roots and costs, token script and owner, tap subtype and count, draw amount, life-loss subability, and stable identities; the ledger pins the complete ordered script. Other Zombies, discard costs, token scripts, tap filters or counts, draw and life-loss effects, identities, effects, and compositions remain closed.',
} as const;

/** Exact Myr Battlesphere composition: four entry tokens and attack tap-X payoff. */
export const LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_COHORTS = [
  {
    positions: [501] as const,
    families: ['priority', 'optional-costs', 'mana-x', 'combat', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_PROBE = {
  id: 'mtg-z5q4-reviewed-myr-battlesphere-outcomes',
  families: ['priority', 'optional-costs', 'mana-x', 'combat', 'replacement-trigger-choices'],
  evidence:
    'Installed Forge 2.0.14 casts the exact position-pinned Myr Battlesphere, observes four distinct pinned 1/1 colorless artifact Myr creature tokens enter under its controller, and attacks the actual opposing player. The optional attack trigger is declined without changing the tokens, source power, or opponent life; cancellation after selecting a bounded X rolls the complete payment back. Accepting derives the number menu from the current exact controlled untapped Myr, taps exactly X distinct backend-issued identities, gives the source +X/+0 until end of turn, and deals X damage to the attacked player before combat damage. Invented, stale, wrong-subtype, tapped, opposing, duplicate, and out-of-range choices are rejected. The bridge pins source identity, complete trigger topology, token script, amount and owner, variable tap subtype, X derivation, pump, defender definition, damage amount, and stable object identities; the ledger pins the complete ordered script. Other Myr, token scripts or counts, tap filters or amounts, attack triggers, pumps, damage definitions, identities, effects, and compositions remain closed.',
} as const;

/** Exact Treasure composition: Goldspan's doubled mana and Magda's five-object search. */
export const LEGACY_CUBE_REVIEWED_TREASURE_COHORT_COHORTS = [
  {
    positions: [281] as const,
    families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'] as const,
  },
  {
    positions: [295] as const,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_TREASURE_COHORT_PROBE = {
  id: 'mtg-z5q4-reviewed-treasure-cohort-outcomes',
  families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes both exact position-pinned Treasure compositions. Goldspan Dragon creates one pinned Treasure when it attacks and one when a spell targets it, and each controlled Treasure receives only Goldspan's exact tap-and-source-sacrifice ability for two mana of the seat's chosen color. Magda, Brazen Outlaw creates one pinned Treasure only when a controlled Dwarf becomes tapped, then offers exactly the five current controlled Treasures as a distinct payment and exactly the eligible artifact-or-Dragon library objects before moving the selected object to the battlefield and shuffling. Cancellation rolls back source, mana, stack, payment objects, and searched object. Invented, stale, opposing, duplicate, wrong-type, wrong-count, wrong-trigger, wrong-token, wrong-amount, and ineligible-library choices are rejected. The bridge pins source identity, complete triggers, token script and owner, granted ability, amount, Dwarf filter, exact five-Treasure cost, library filter, destination, cardinality, and stable identities; the ledger pins both complete ordered scripts. Other Dragons, Dwarves, Treasures, triggers, grants, payments, searches, identities, effects, and compositions remain closed.",
} as const;

/** Exact Champion of Wits composition: power-sized optional draw plus discard two and Eternalize. */
export const LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_COHORTS = [
  {
    positions: [95] as const,
    families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_PROBE = {
  id: 'mtg-z5q4-reviewed-champion-of-wits-outcomes',
  families: ['priority', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 proves Champion of Wits' exact two routes in one deterministic session. The first ordinary 2/1 entry trigger is declined with hand and library unchanged. A second is accepted: Forge draws exactly two, exposes only live local hand identities, accepts exactly two distinct discards, and moves both chosen cards to the graveyard. The discarded Champion then exposes Eternalize only at sorcery speed; the seat pays seven distinct Island mana sources and confirms that exact graveyard source for exile. Forge creates a distinct 4/4 black Zombie Snake Wizard copy with no mana cost, its entry trigger draws exactly four from its observed power, and exactly two more selected cards are discarded, leaving the expected net two-card hand increase. Invented and stale trigger answers, priority actions, discard identities, and source-exile confirmations are rejected. The bridge pins the source, complete trigger and CostDraw shape, exact discard count and live identities, and the complete intrinsic Eternalize root including graveyard activation, sorcery timing, {5}{U}{U} plus source-exile cost vector, black Zombie type change, 4/4 setters, and stable source identity. Other triggers, draw/discard counts, Eternalize abilities, copy modifications, zones, timings, identities, costs, effects, and compositions remain closed.",
} as const;

/** Exact Utopia Sprawl composition: Forest Aura, entry color choice, and chosen-color mana trigger. */
export const LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_COHORTS = [
  { positions: [367] as const, families: ['priority', 'targets', 'naming-text-numbers'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_SAFE_POSITIONS = [367] as const;
export const LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_PROBE = {
  id: 'mtg-z5q4-reviewed-utopia-sprawl-outcome',
  families: ['priority', 'targets', 'naming-text-numbers'],
  evidence:
    'Installed Forge 2.0.14 casts the exact position-pinned Utopia Sprawl, selects one exact backend-issued local Forest target, selects green through the human color-choice route as the Aura enters, and later taps that single enchanted Forest to cast a real {1}{G} spell. The observed tapped-land and resolved-spell board state prove Forge added the chosen mana rather than merely accepting both decisions. The bridge pins source identity, spell/root/cardinality/zones and Forest-only candidates; the ledger pins the complete ordered card script. Invented and stale choices are rejected, while other Auras, land targets, entry replacements, colors, mana triggers, identities, effects, and compositions remain closed.',
} as const;

/** Exact Splinter Twin composition: creature Aura plus one tap-to-copy ability. */
export const LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_COHORTS = [
  { positions: [309] as const, families: ['priority', 'targets'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_SAFE_POSITIONS = [309] as const;
export const LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_PROBE = {
  id: 'mtg-z5q4-reviewed-splinter-twin-outcome',
  families: ['priority', 'targets'],
  evidence:
    'Installed Forge 2.0.14 casts the exact position-pinned Splinter Twin, selects one exact backend-issued Pteramander target, activates the granted tap ability, observes one distinct copied creature token, attacks with that otherwise non-hasty token in the creation turn, and observes Forge exile the same token at the beginning of the next end step. Invented and stale targets and moves are rejected. The bridge pins source identity, spell/root/cardinality/zones and creature-only battlefield candidates; the ledger pins the complete ordered card script. Other Auras, targets, copied permanents, granted abilities, keywords, delayed dispositions, identities, effects, and compositions remain closed.',
} as const;

/** Exact Lingering Souls composition: two pinned Spirits plus Flashback {1}{B}. */
export const LEGACY_CUBE_REVIEWED_LINGERING_SOULS_COHORTS = [
  { positions: [50] as const, families: ['priority', 'optional-costs', 'combat'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_LINGERING_SOULS_SAFE_POSITIONS = [50] as const;
export const LEGACY_CUBE_REVIEWED_LINGERING_SOULS_PROBE = {
  id: 'mtg-z5q4-reviewed-lingering-souls-flashback-outcome',
  families: ['priority', 'optional-costs', 'combat'],
  evidence:
    "Installed Forge 2.0.14 casts the exact position-pinned Lingering Souls for {2}{W}, observes exactly two pinned 1/1 white Spirit creature tokens with flying and the same source object in its graveyard, then selects Forge's exact Flashback action, pays exactly {1}{B}, observes two more exact Spirit tokens, and observes that same source object in exile. Invented and stale moves are rejected. The ledger pins the complete card and token scripts; all neighboring generated-object and keyword compositions remain closed.",
} as const;

/** Exact optional-trigger compositions whose accepted branch creates a pinned token. */
export const LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_COHORTS = [
  {
    positions: [29, 381, 394] as const,
    families: ['priority', 'combat', 'replacement-trigger-choices'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_SAFE_POSITIONS = [29, 381, 394] as const;
/** Same raw blockers, but an unrelated target and damage-distribution composition. */
export const LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_EXCLUDED_POSITIONS = [354] as const;
export const LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_PROBE = {
  id: 'mtg-z5q4-reviewed-optional-generated-token-outcomes',
  families: ['priority', 'combat', 'replacement-trigger-choices'],
  evidence:
    'Installed Forge 2.0.14 probes route each exact optional trigger through the human seat and read the accepted branch from the resulting board. Emeria Angel creates one exact 1/1 white flying Bird after a land enters; Awakening Zone creates one exact 0/1 colorless Eldrazi Spawn whose own sacrifice ability produces colorless mana; and Avenger of Zendikar creates exactly one 0/1 green Plant per controlled land, then a later landfall confirmation puts exactly one +1/+1 counter on each of those same Plant objects. Declining each optional trigger leaves the board unchanged. The ledger pins all three complete source scripts and their token dependencies; foreign deciders, token identities, owners, amounts, counter routes, and added mechanics remain closed.',
} as const;

/** Exact exert-as-attacks composition whose selected attacker and target stay identity-bound. */
export const LEGACY_CUBE_REVIEWED_GLORYBRINGER_COHORTS = [
  { positions: [273] as const, families: ['priority', 'targets', 'optional-costs', 'combat'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_GLORYBRINGER_SAFE_POSITIONS = [273] as const;
export const LEGACY_CUBE_REVIEWED_GLORYBRINGER_PROBE = {
  id: 'mtg-z5q4-reviewed-glorybringer-exert-outcome',
  families: ['priority', 'targets', 'optional-costs', 'combat'],
  evidence:
    "An installed Forge 2.0.14 probe casts the exact position-pinned Glorybringer and attacks twice with the same object. The seat first declines Forge's exert-attacker choice and observes no damage target; on the next attack it selects the exact Glorybringer object, pays Forge's exact zero-mana-plus-source-exert combat cost through PlaySpellAbility.payCostDuringAbilityResolve, selects an exact non-Dragon creature object, observes that object in its owner's graveyard after four damage, and observes Glorybringer remain tapped through its next untap step. Other OptionalAttackCost shapes, exert costs, attackers, targets, identities, and compositions remain closed.",
} as const;

/** Exact activated damage ability with a two-card graveyard-exile payment. */
export const LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_COHORTS = [
  { positions: [246] as const, families: ['priority', 'targets', 'combat'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_PROBE = {
  id: 'mtg-z5q4-reviewed-grim-lavamancer-graveyard-exile-outcome',
  families: ['priority', 'targets', 'combat'],
  evidence:
    'An installed Forge 2.0.14 probe casts two exact Lightning Bolt objects to put them into the local graveyard, casts the exact position-pinned Grim Lavamancer, targets the opposing player with its activated ability, and selects both exact graveyard object IDs through two human-routed cost-card-selection decisions. The resulting board has those two objects in exile, the same Grim Lavamancer tapped, one red mana spent, and the chosen opponent down exactly two life. The guarded cost visitor checks the root DealDamage ability and complete {T}, {R}, ExileFromGrave<2/Card> cost vector before selection, then rechecks membership and canPay before returning the payment. Other sources, counts, zones, types, costs, targets, and compositions remain closed.',
} as const;

/** Exact repeated library selection whose legal set shrinks by selected card name. */
export const LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_COHORTS = [
  { positions: [158] as const, families: ['priority', 'targets', 'zone-card-selection'] as const },
] as const;
export const LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_PROBE = {
  id: 'mtg-z5q4-reviewed-gifts-ungiven-distinct-name-outcome',
  families: ['priority', 'targets', 'zone-card-selection'],
  evidence:
    "An installed Forge 2.0.14 probe casts the exact position-pinned Gifts Ungiven twice. The first search chooses Forge's Find no card response and confirms cancellation, proving the optional zero-card outcome. The second selects four exact object IDs with different names. After each pick, the next Forge decision contains no card with an already selected name; after resolution, exactly two selected objects are in their owner's hand and exactly two are in that owner's graveyard. The bridge admits only the exact root ChangeZone spell, its four-card DifferentNames/remember/reveal/no-shuffle parameters, and Forge's observed first-versus-later callback states. Other sources, counts, zones, constraints, prompts, targets, and compositions remain closed.",
} as const;

/** Exact planeswalker ultimate whose partition and chosen pile stay identity-bound. */
export const LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_COHORTS = [
  {
    positions: [223] as const,
    families: ['priority', 'targets', 'zone-card-selection', 'piles-votes'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_PROBE = {
  id: 'mtg-z5q4-reviewed-liliana-two-piles-outcome',
  families: ['priority', 'targets', 'zone-card-selection', 'piles-votes'],
  evidence:
    "An installed Forge 2.0.14 probe casts the exact position-pinned Liliana of the Veil, uses its +1 three times, and selects exact hand objects through Forge's mandatory discard callback until it can activate the -6. It targets its controller, partitions that player's complete six-permanent battlefield by selecting two exact Swamp object IDs, chooses that exact first pile, and observes only those two objects in the graveyard while Liliana and every other permanent remain on the battlefield. The bridge checks the complete TwoPiles parameters, the six-loyalty cost, the exact resolved DBSacAll SVar, the targeted player, the complete current battlefield at both callbacks, disjoint and exhaustive piles, and the exact singleton +1 discard composition. Other sources, costs, targets, zones, partitions, pile effects, discard shapes, and compositions remain closed.",
} as const;

/** Exact instant whose revealed cards are partitioned and chosen by different seats. */
export const LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_COHORTS = [
  {
    positions: [144] as const,
    families: ['priority', 'zone-card-selection', 'piles-votes'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_PROBE = {
  id: 'mtg-z5q4-reviewed-fact-or-fiction-two-piles-outcome',
  families: ['priority', 'zone-card-selection', 'piles-votes'],
  evidence:
    'An installed Forge 2.0.14 probe casts the exact position-pinned Fact or Fiction, observes the top five library objects remembered by Forge, routes their exact identities to the opposing seat for a disjoint and exhaustive two-pile partition, routes the resulting exact piles to the caster for selection, and observes the selected objects in hand and every unselected object in the graveyard. The bridge checks the complete PeekAndReveal root, TwoPiles subability, remembered library membership, opponent separator, controller chooser, at-most-five count for library exhaustion, and exact hand and graveyard ChangeZone SVars. Invented and stale choices are rejected, while every other source, count, remembered set, separator, chooser, partition, destination, and composition remains closed.',
} as const;

/** Exact companion scripts, split because their post-selection board outcomes differ. */
export const LEGACY_CUBE_REVIEWED_COMPANION_COHORTS = [
  {
    positions: [444] as const,
    families: ['priority', 'zone-card-selection', 'combat', 'pregame-actions'] as const,
  },
  {
    positions: [455] as const,
    families: ['priority', 'combat', 'pregame-actions'] as const,
  },
] as const;
export const LEGACY_CUBE_REVIEWED_YORION_COMPANION_PROBE = {
  id: 'mtg-z5q4-reviewed-yorion-companion-outcome',
  families: ['priority', 'zone-card-selection', 'combat', 'pregame-actions'],
  evidence:
    "An installed Forge 2.0.14 probe supplies Yorion from the real sideboard and proves Forge's DeckSizePlus20 restriction: an eighty-card main deck offers the exact Yorion object during the pregame companion callback and a seventy-nine-card deck does not. After the seat chooses it, Forge moves it through the command zone, charges the real {3} companion action, and permits its normal cast. Its enter trigger then offers the exact eligible battlefield objects through Forge's hidden-zone callback; the seat chooses one Wall of Omens object and stops, observes that object in exile, and observes the same object return at the next end step. The bridge pins the exact companion keyword, sideboard identity, root ChangeZone parameters, candidate ownership and control, and complete delayed-return SVar chain. Other companion identities, restrictions, zones, callbacks, scripts, and compositions remain closed.",
} as const;
export const LEGACY_CUBE_REVIEWED_OBOSH_COMPANION_PROBE = {
  id: 'mtg-z5q4-reviewed-obosh-companion-outcome',
  families: ['priority', 'combat', 'pregame-actions'],
  evidence:
    "An installed Forge 2.0.14 probe supplies Obosh from the real sideboard and proves Forge's odd-mana restriction: sixty Swamps offer the exact Obosh object during the pregame companion callback, while replacing one Swamp with the even-valued Coldsteel Heart refuses it. After selection, Forge moves Obosh through the command zone, charges the real {3} companion action, permits its normal cast, and applies its actual replacement effect: an exact Lightning Bolt aimed at the opposing player changes life from twenty to fourteen. The bridge pins the exact companion keyword, sideboard identity, owner, controller, and callback shape. Other companion identities, restrictions, scripts, and compositions remain closed.",
} as const;

/**
 * Alternate-cast and alternate-payment keywords whose remaining decision
 * surface is already owned by the stated-ordering profile and the universal
 * optional-cost/number callbacks. The rows stay split by family signature so
 * no card borrows a review written for a different combination of surfaces.
 */
export const LEGACY_CUBE_ALTERNATE_COST_COHORTS = [
  {
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'] as const,
    positions: [27, 311, 411] as const,
  },
  {
    families: ['priority', 'optional-costs', 'replacement-trigger-choices'] as const,
    positions: [69, 159] as const,
  },
  { families: ['priority', 'optional-costs', 'combat'] as const, positions: [112, 177, 248] as const },
  {
    families: ['priority', 'targets', 'optional-costs'] as const,
    positions: [121, 129, 156, 227, 231, 282, 285, 288, 290, 314, 321, 423] as const,
  },
  {
    families: ['priority', 'targets', 'modes', 'optional-costs', 'zone-card-selection'] as const,
    positions: [242, 301] as const,
  },
  {
    families: ['priority', 'optional-costs', 'zone-card-selection'] as const,
    positions: [284, 379] as const,
  },
  { families: ['priority', 'targets', 'optional-costs', 'mana-x'] as const, positions: [316] as const },
  {
    families: ['priority', 'targets', 'optional-costs', 'mana-x', 'replacement-trigger-choices'] as const,
    positions: [317] as const,
  },
  { families: ['priority', 'optional-costs'] as const, positions: [322, 490] as const },
  {
    families: ['priority', 'modes', 'optional-costs', 'zone-card-selection'] as const,
    positions: [395] as const,
  },
  {
    families: ['priority', 'optional-costs', 'mana-x', 'combat'] as const,
    positions: [405] as const,
  },
] as const;

export const LEGACY_CUBE_ALTERNATE_COST_SAFE_POSITIONS = LEGACY_CUBE_ALTERNATE_COST_COHORTS.flatMap(
  (cohort) => [...cohort.positions],
).sort((left, right) => left - right);

/** Every other script carrying one of the reviewed keywords retains another concrete blocker. */
export const LEGACY_CUBE_ALTERNATE_COST_EXCLUDED_POSITIONS = [
  32, 50, 54, 57, 80, 95, 114, 132, 179, 191, 230, 254, 266,
] as const;

export const LEGACY_CUBE_ALTERNATE_COST_PROBE = {
  id: 'mtg-z5q4-reviewed-alternate-cost-outcomes',
  families: [
    'priority',
    'targets',
    'modes',
    'optional-costs',
    'zone-card-selection',
    'mana-x',
    'combat',
    'replacement-trigger-choices',
  ],
  evidence:
    "Installed Forge 2.0.14 probes exercise all three human callback shapes the reviewed keyword vocabulary adds. Burst Lightning selects Kicker through chooseOptionalCosts, pays the full five mana, targets Forge AI by its backend-issued MoveId, and moves that player's life from 20 to 16. Everflowing Chalice states two Multikicker payments through chooseNumberForKeywordCost, pays four mana, and resolves with exactly two charge counters. Rift Bolt takes the Suspend priority action for one red mana, appears in exile, accepts Forge's later cast confirmation, targets Forge AI, and moves that player's life from 20 to 17. These are board and zone readings rather than transcript-only assertions. The profile lifts only the fifteen named keyword tokens; scripts with any additional refusal stay in the explicit excluded cohort.",
} as const;

/**
 * Optional triggers whose decider is exactly the source controller and whose
 * remaining effects are already contained by the stated-ordering profile.
 * Rows remain split by family signature so a card cannot borrow a review for
 * callbacks it does not share.
 */
export const LEGACY_CUBE_OPTIONAL_DECIDER_YOU_COHORTS = [
  {
    families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'] as const,
    positions: [20, 102, 276] as const,
  },
  {
    families: ['priority', 'targets', 'replacement-trigger-choices'] as const,
    positions: [152] as const,
  },
  {
    families: ['priority', 'zone-card-selection', 'replacement-trigger-choices'] as const,
    positions: [385] as const,
  },
  {
    families: ['priority', 'replacement-trigger-choices'] as const,
    positions: [476] as const,
  },
] as const;

export const LEGACY_CUBE_OPTIONAL_DECIDER_YOU_SAFE_POSITIONS =
  LEGACY_CUBE_OPTIONAL_DECIDER_YOU_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

/** Positions already admitted by the stricter optional-confirm-only profile. */
export const LEGACY_CUBE_OPTIONAL_DECIDER_YOU_PREEXISTING_SAFE_POSITIONS = [116, 171, 426] as const;

/** Every other OptionalDecider script retains at least one independently reviewed blocker. */
export const LEGACY_CUBE_OPTIONAL_DECIDER_YOU_EXCLUDED_POSITIONS = [
  13, 26, 28, 38, 41, 100, 240, 346, 354, 363, 378, 406, 409, 488, 501, 519, 526,
] as const;

export const LEGACY_CUBE_OPTIONAL_DECIDER_YOU_PROBE = {
  id: 'mtg-z5q4-optional-decider-you-outcomes',
  families: ['priority', 'targets', 'zone-card-selection', 'combat', 'replacement-trigger-choices'],
  evidence:
    'Installed Forge 2.0.14 loads Recruiter of the Guard, casts it, presents its OptionalDecider$ You trigger through the human confirmTrigger callback, accepts that exact backend-issued decision, selects an exact qualifying creature from the library, and observes that card move to the human hand. The profile lifts only OptionalDecider when every occurrence is exactly You; foreign deciders and every additional refusal remain excluded.',
} as const;

/** Optional library searches whose explicit nonmandatory shuffle is reviewed end to end. */
export const LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_COHORTS = [
  {
    families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'] as const,
    positions: [13, 363, 488, 519] as const,
  },
  {
    families: ['priority', 'zone-card-selection', 'replacement-trigger-choices'] as const,
    positions: [41] as const,
  },
] as const;

export const LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_SAFE_POSITIONS =
  LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_COHORTS.flatMap((cohort) => [...cohort.positions]).sort(
    (left, right) => left - right,
  );

/** Same two-marker population, retained because each row has additional blockers. */
export const LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_EXCLUDED_POSITIONS = [26, 378] as const;

export const LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_PROBE = {
  id: 'mtg-z5q4-reviewed-optional-library-search-outcomes',
  families: ['priority', 'zone-card-selection', 'combat', 'replacement-trigger-choices'],
  evidence:
    'Installed Forge 2.0.14 probes accept each exact optional search trigger, select backend-issued library object identities, and read the selected objects from their destination zones. Stoneforge Mystic moves the selected Equipment to hand; Land Tax moves three selected basic lands to hand; Primeval Titan moves two selected lands to the battlefield tapped; Solemn Simulacrum moves the selected basic land to the battlefield tapped and separately accepts its controller-decided death draw; and Golos moves the selected land to the battlefield tapped. The boundary pins each complete script and exact trigger/search route before lifting OptionalDecider and ShuffleNonMandatory. Ranger-Captain of Eos remains excluded from this reusable profile and is admitted only under its separate exact whole-card profile; Nissa, Vastwood Seer remains excluded by its independent alternate-mode and generated-object blockers.',
} as const;

export const LEGACY_CUBE_ALTERNATE_MODE_COHORTS = [
  {
    families: ['priority', 'optional-costs', 'combat'] as const,
    positions: [35, 93, 371] as const,
  },
  {
    families: ['priority', 'targets', 'optional-costs', 'combat'] as const,
    positions: [99, 224, 251, 258] as const,
  },
  {
    families: ['priority', 'targets', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'] as const,
    positions: [166] as const,
  },
] as const;

export const LEGACY_CUBE_ALTERNATE_MODE_SAFE_POSITIONS = LEGACY_CUBE_ALTERNATE_MODE_COHORTS.flatMap(
  (cohort) => [...cohort.positions],
).sort((left, right) => left - right);

export const LEGACY_CUBE_ALTERNATE_MODE_EXCLUDED_POSITIONS = [
  3, 4, 70, 82, 86, 90, 97, 236, 265, 377, 378, 383, 417, 518,
] as const;

export const LEGACY_CUBE_ALTERNATE_MODE_PROBE = {
  id: 'mtg-z5q4-reviewed-alternate-mode-outcomes',
  families: ['priority', 'targets', 'optional-costs', 'mana-x', 'zone-card-selection', 'combat'],
  evidence:
    "Installed Forge 2.0.14 probes cover all three alternate-mode shapes in this cohort through board and zone readings. Bonecrusher Giant selects its Adventure spell through the backend-issued priority action, targets Forge AI, moves that seat from 20 to 18 life, enters exile under one exact object ID, and later resolves onto the battlefield as a 4/3 creature under that same ID. Tangled Florahedron selects its modal land play, and that exact object appears on the battlefield with a Land type rather than a Creature type. Archangel Avacyn resolves, observes Selfless Spirit die under an explicit source-sacrifice activation, and transforms under Forge's next-upkeep trigger into Avacyn, the Purifier under the same object ID. The profile lifts only the alternate-mode semantic marker; every additional refusal remains in the explicit excluded cohort.",
} as const;

export const LEGACY_CUBE_VRASKA_GENERATED_TOKEN_PROBE = {
  id: 'mtg-bc2.154.4.15-vraska-generated-token-payment',
  families: ['priority', 'targets', 'combat'],
  evidence:
    'mtg-bc2.154.4.15 exercised installed Forge 2.0.14 in one session: the local seat activated Vraska, Relic Seeker for minus three, selected one exact legal permanent, created the pinned Treasure token, then selected that exact generated source and red as its produced color to pay for Flame Rift. Both directly referenced token scripts and their complete recursive dependency graph are byte-pinned; other generated decision sources remain refused.',
} as const;

export const LEGACY_CUBE_GENERATED_TOKEN_AUDIT = {
  capability: 'pinned-token-scripts-v16',
  runtimeProbeIds: [
    LEGACY_CUBE_VRASKA_GENERATED_TOKEN_PROBE.id,
    LEGACY_CUBE_GENERATED_OBJECT_PROBE.id,
    LEGACY_CUBE_REVIEWED_LINGERING_SOULS_PROBE.id,
    LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_PROBE.id,
    LEGACY_CUBE_REVIEWED_LIVING_WEAPON_PROBE.id,
    LEGACY_CUBE_REVIEWED_FORETELL_PROBE.id,
    LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_PROBE.id,
    LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_PROBE.id,
    LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_PROBE.id,
    LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_PROBE.id,
    LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_PROBE.id,
    LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_PROBE.id,
    LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_PROBE.id,
    LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_PROBE.id,
    LEGACY_CUBE_REVIEWED_CRYPTBREAKER_PROBE.id,
    LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_PROBE.id,
    LEGACY_CUBE_REVIEWED_TREASURE_COHORT_PROBE.id,
    'mtg-z5q4-reviewed-pia-siege-gang-outcomes',
    LEGACY_CUBE_REVIEWED_KALITAS_PROBE.id,
    LEGACY_CUBE_REVIEWED_HUNTMASTER_PROBE.id,
    LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_PROBE.id,
    LEGACY_CUBE_REVIEWED_FINAL_SIX_PROBE.id,
  ],
  reviewedPositions: [
    4, 18, 29, 37, 49, 50, 70, 113, 119, 132, 161, 181, 186, 194, 253, 254, 262, 269, 275, 281, 295, 303, 334,
    345, 354, 361, 378, 381, 383, 384, 389, 393, 394, 396, 403, 417, 418, 429, 430, 434, 437, 451, 466, 467,
    479, 480, 498, 501, 509, 514, 518, 525, 583,
  ] as const,
  safePositions: [
    ...LEGACY_CUBE_GENERATED_OBJECT_SAFE_POSITIONS,
    ...LEGACY_CUBE_VRASKA_GENERATED_TOKEN_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_LINGERING_SOULS_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_LIVING_WEAPON_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_FORETELL_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_CRYPTBREAKER_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_TREASURE_COHORT_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_KALITAS_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_HUNTMASTER_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_SAFE_POSITIONS.filter(
      (position) => position === 303 || position === 378,
    ),
    ...LEGACY_CUBE_REVIEWED_FINAL_SIX_SAFE_POSITIONS.filter(
      (position) => position === 354 || position === 393,
    ),
    194,
    262,
    269,
    275,
    384,
  ].sort((left, right) => left - right),
  excludedPositions: [4, 18, 70, 334, 509] as const,
  exactTokenScripts: [
    {
      name: 'ashaya_the_awoken_world',
      sha256: '1a3ace533e963ccfd112a9d54acd250e22e2d92a15179f054e2a53cad9ffcf32',
    },
    {
      name: 'b_0_0_phyrexian_germ',
      sha256: 'e1d99eccbd54d2dffc1dcf6934defcdbdd678d1b44c4a41ff884685f097c7fcb',
    },
    {
      name: 'b_1_1_wolf_deathtouch',
      sha256: '854473a62e7949f7a69caac1260033bbd215fe70fcf498a2b6165b2ebd460c5c',
    },
    {
      name: 'b_2_2_pirate_menace',
      sha256: 'fbe20d37475bc3b1e7150d97da0015e917885801f63643961ef9372bb04dfba8',
    },
    {
      name: 'b_2_2_vampire_flying',
      sha256: '937a0603509d9680e4b4d39208094fdf7ff17c2262525083372117e8280bdaad',
    },
    {
      name: 'b_2_2_zombie',
      sha256: 'aaa0e3e4ec54d68c9a76f448d9ffaa10af129de04892836d51a87e34e0a03daa',
    },
    {
      name: 'bg_1_1_insect',
      sha256: 'db2bbbff360e719ce7b37a277911cd917e996cfe995d0a77fe59a4ce8da79111',
    },
    {
      name: 'c_0_0_a_construct_total_artifacts',
      sha256: '83fb834b77076192eb219779114375fc0240bffb05deeb660baaa0111f029b9b',
    },
    {
      name: 'c_0_1_eldrazi_spawn_sac',
      sha256: '0f82a817834aabc4b637f2991426d60a8aee3c7d907e35928d0585d4e8a9a05b',
    },
    {
      name: 'c_1_1_a_construct_defender',
      sha256: 'a592c8c0f4dd54581ad174a2846ff5738a2fff19d19de0d0eed91e709e3ccf76',
    },
    {
      name: 'c_1_1_a_myr',
      sha256: '4144136971075cf98ef674a235bbd12ea100c28204e8156de08a952384a8453a',
    },
    {
      name: 'c_1_1_a_servo',
      sha256: '1b0ed0a118306da60c610ab3c73cfad10050135aafd7201570c4553231479c7d',
    },
    {
      name: 'c_1_1_a_thopter_flying',
      sha256: '81d5dc1c1cbbe6313d08894277a05bd3609771a6f295438e2077e085367f7f99',
    },
    {
      name: 'c_4_4_a_construct',
      sha256: '346552a907729d9cf5da9113e20a3ab2004425b0d607ac5017cecb52ae0b1c20',
    },
    {
      name: 'c_a_food_sac',
      sha256: '7b6aa427661e3a0cb1b50e7eb9a25a10f1a13ca83dde81eebc07ea345eebdadf',
    },
    {
      name: 'c_a_treasure_sac',
      sha256: '46065834254234a119bb538b9228b0703e9786870c040b4d4b9366540b3a1d52',
    },
    {
      name: 'g_0_1_plant',
      sha256: 'f4181d763e2831e46763d72bf5d1efb8c5946664f0d976c1367714b6c7899814',
    },
    {
      name: 'g_1_1_squirrel',
      sha256: '7a1a22b752e60806f811f52f7566e6b533f90c1060a52ecc94e659d225f84c45',
    },
    {
      name: 'g_2_2_wolf',
      sha256: 'b8053732fe7bd6c36028610c05c5203a1a9e7c8866222a9d082fd21b2c20112f',
    },
    {
      name: 'g_3_3_beast',
      sha256: '445229c54f088fa1df74559d83d2944750442a64e1e93336ece5be5f01c822ed',
    },
    {
      name: 'g_3_3_elephant',
      sha256: 'b157c8e06a25ec4b1f363236e822416ca685900a2a304212f022ba23989675d7',
    },
    {
      name: 'komas_coil',
      sha256: 'a58c14a342bc5f3bbe61a3fc5e3619cb5aaae38c5c951ea48bcc226aa8180860',
    },
    {
      name: 'r_1_1_elemental',
      sha256: '0a07b5e4790f5f6909d449b50a3e7fd907767ef3d0f63e5833436855c3acce82',
    },
    {
      name: 'r_1_1_goblin',
      sha256: 'a00d21656af3a47f0817ce779e0234c9652d8374736d9ef8a2d2b1f9aaea346e',
    },
    {
      name: 'rg_2_2_satyr_haste',
      sha256: 'bc1c9249003ccffd45da2b08f3fbc8247f83ea4a9a41589cff90907b7258e02f',
    },
    {
      name: 'u_1_1_bird_flying',
      sha256: '7ace29905d9c3b235fb4f8e0e5aa90f595d7b8416629b8ed4d350746bc40adf8',
    },
    {
      name: 'u_x_x_illusion',
      sha256: '3cd1abf38ecee9637b787d33b6b3192feb56a95e423f24395b907a350f372507',
    },
    {
      name: 'u_x_x_shark_flying',
      sha256: 'f1ad1c7355860392b3e0dbd45fccda3087285deafabd9a680c6a093374fb6a68',
    },
    {
      name: 'w_1_1_bird_flying',
      sha256: '0c476da1ffa3f9819db9570167751591e86ecf52bb523b9830d44a6754af5c0f',
    },
    {
      name: 'w_1_1_kithkin_soldier',
      sha256: '072fee3265e176918e86c4148ba14328301c650f525d706d3e10f0e909e74b6b',
    },
    {
      name: 'w_1_1_spirit_flying',
      sha256: '98b95ca039196dacb75442961ac79f8d6ddc6eda40ae7127a89d28c9271d869e',
    },
    {
      name: 'w_1_1_vampire_lifelink',
      sha256: '5a52a19dd6dfd9ad5c48c6bce21d0038a52d5a30ff22d1b19f866132e0226fb5',
    },
    {
      name: 'w_4_4_angel_warrior_flying',
      sha256: '38ecbd05b340c071ebef515ca93489b586309294711c1a83e2bc13c2c023db50',
    },
    {
      name: 'w_4_4_angel_warrior_flying_vigilance',
      sha256: '9612abb5be48c8702d8b4d9c9b5e93f24b45e16964ed709db9a8e9a18c297383',
    },
  ],
  evidence:
    'mtg-bc2.154.4.15 and mtg-z5q4 resolve explicit TokenScript references plus the exact Living Weapon Germ implementation from an installed Forge token-script root, record exact bytes and classifications for the complete 53-position reviewed generated-object cohort, and reject missing, stale, extra, newly nested, or newly rooted generated sources. The other TokenScript roots already admitted under profiles whose created objects have no decision surface remain enumerated so root-cohort drift still fails closed. Forty-six safe positions compose the pins with separately reviewed top-level profiles; seven positions remain explicitly excluded by independent blockers. The capability stays position-pinned and does not make Produced Any an ordinary global mana source.',
} as const;

export const LEGACY_CUBE_TOP_LEVEL_CAPABILITY_PROFILES = [
  'priority-only-v1',
  'mandatory-singleton-nonstack-target-v1',
  'singleton-stack-target-v1',
  'singleton-library-zone-card-v1',
  'ordinary-combat-v1',
  'ordinary-combat-and-mandatory-singleton-nonstack-target-v1',
  'ordinary-combat-and-mandatory-singleton-trigger-target-v1',
  'mandatory-singleton-trigger-target-v1',
  'paladin-class-installed-trigger-target-v1',
  'shockland-pay-two-life-entry-replacement-v1',
  'mandatory-singleton-equip-target-v1',
  'mandatory-singleton-aura-target-v1',
  'mandatory-singleton-fetters-aura-target-v1',
  'mandatory-singleton-fall-aura-target-v1',
  'ordinary-combat-baneslayer-protection-v1',
  'draw-two-conditional-singleton-discard-v1',
  'ordinary-combat-reviewed-level-up-v2',
  'ordinary-combat-selfless-spirit-self-sacrifice-indestructible-v1',
  'ordinary-combat-remorseful-cleric-self-sacrifice-target-graveyard-exile-v1',
  'coldsteel-heart-entry-color-chosen-mana-v1',
  'extinction-event-odd-even-exile-v1',
  'ordinary-combat-target-and-pinned-generated-token-v1',
  'optional-trigger-confirm-v1',
  'bounded-multi-selection-v1',
  'bounded-enumerated-choice-v1',
  'announced-number-v1',
  'stated-ordering-v1',
  'stated-distribution-v1',
  'stated-retarget-v1',
  'open-card-naming-v1',
  'discard-or-reviewed-sacrifice-cost-v2',
  'stated-ordering-and-pinned-generated-token-v1',
  'stated-ordering-trigger-target-and-reviewed-hidden-hand-v1',
  'stated-ordering-and-reviewed-trigger-target-v1',
  'stated-ordering-and-reviewed-counter-type-choice-v1',
  'stated-ordering-and-reviewed-optional-target-v1',
  'stated-ordering-and-reviewed-phyrexian-spell-cost-v1',
  'stated-ordering-and-reviewed-cascade-v1',
  'stated-ordering-and-reviewed-repeatable-mode-v1',
  'stated-ordering-and-reviewed-plow-under-v1',
  'stated-ordering-and-reviewed-coalition-relic-v1',
  'stated-ordering-and-reviewed-cryptic-command-v1',
  'stated-ordering-and-reviewed-prismari-command-v1',
  'stated-ordering-and-reviewed-blessed-alliance-v1',
  'stated-ordering-and-reviewed-kalitas-v1',
  'stated-ordering-and-reviewed-uro-v1',
  'stated-ordering-and-reviewed-kroxa-v1',
  'stated-ordering-and-reviewed-huntmaster-v1',
  'stated-ordering-and-reviewed-remaining-planeswalkers-v1',
  'stated-ordering-and-reviewed-final-six-v1',
  'stated-ordering-and-reviewed-phantasmal-image-v1',
  'stated-ordering-and-reviewed-peek-and-reveal-v1',
  'stated-ordering-and-reviewed-optional-copy-replacement-v1',
  'stated-ordering-and-reviewed-karn-liberated-v1',
  'stated-ordering-and-reviewed-rattleclaw-mystic-v1',
  'stated-ordering-and-reviewed-lightning-phoenix-v1',
  'stated-ordering-and-reviewed-baral-triggered-loot-v1',
  'stated-ordering-and-reviewed-unless-cost-v1',
  'stated-ordering-and-reviewed-counter-unless-cost-v1',
  'stated-ordering-and-reviewed-miscalculation-v1',
  'stated-ordering-and-reviewed-maul-of-the-skyclaves-v1',
  'stated-ordering-and-reviewed-embercleave-v1',
  'stated-ordering-and-reviewed-living-weapon-v1',
  'stated-ordering-and-reviewed-foretell-v1',
  'stated-ordering-and-reviewed-satyr-wayfinder-v1',
  'stated-ordering-and-reviewed-blue-library-selection-v1',
  'stated-ordering-and-reviewed-gideon-garruk-bloodline-v1',
  'stated-ordering-and-reviewed-hideaway-four-v1',
  'stated-ordering-and-reviewed-sword-of-fire-and-ice-v1',
  'stated-ordering-and-reviewed-sword-of-feast-and-famine-v1',
  'stated-ordering-and-reviewed-sword-of-light-and-shadow-v1',
  'stated-ordering-and-reviewed-sword-of-body-and-mind-v1',
  'stated-ordering-and-reviewed-sword-of-hearth-and-home-v1',
  'stated-ordering-and-reviewed-umezawas-jitte-v1',
  'stated-ordering-and-reviewed-birgi-v1',
  'stated-ordering-and-reviewed-birthing-pod-v1',
  'stated-ordering-and-reviewed-ranger-captain-of-eos-v1',
  'stated-ordering-and-reviewed-forbid-v1',
  'stated-ordering-and-reviewed-reveillark-v1',
  'stated-ordering-and-reviewed-bloodchiefs-thirst-v1',
  'stated-ordering-and-reviewed-primal-might-v1',
  'announced-number-and-reviewed-engineered-explosives-v1',
  'stated-ordering-and-reviewed-reorder-or-shuffle-v1',
  'stated-ordering-and-reviewed-animate-dead-v1',
  'stated-ordering-and-reviewed-heartless-act-v1',
  'stated-ordering-and-reviewed-agadeems-awakening-v1',
  'stated-ordering-and-reviewed-modal-land-spells-v1',
  'stated-ordering-and-reviewed-convoke-v1',
  'stated-ordering-and-reviewed-delve-v1',
  'stated-ordering-and-reviewed-free-counterspell-v1',
  'stated-ordering-and-reviewed-legions-landing-v1',
  'stated-ordering-and-reviewed-gilded-goose-v1',
  'stated-ordering-and-reviewed-pia-siege-gang-v1',
  'stated-ordering-and-reviewed-treachery-v1',
  'stated-ordering-and-reviewed-skyclave-apparition-v1',
  'stated-ordering-and-reviewed-path-to-exile-v1',
  'stated-ordering-and-reviewed-glen-elendra-archmage-v1',
  'stated-ordering-and-reviewed-recurring-nightmare-v1',
  'stated-ordering-and-reviewed-priest-of-fell-rites-v1',
  'stated-ordering-and-reviewed-smugglers-copter-v1',
  'stated-ordering-and-reviewed-cryptbreaker-v1',
  'stated-ordering-and-reviewed-myr-battlesphere-v1',
  'stated-ordering-and-audited-treasure-cohort-v1',
  'stated-ordering-and-reviewed-champion-of-wits-v1',
  'stated-ordering-and-reviewed-utopia-sprawl-v1',
  'stated-ordering-and-reviewed-splinter-twin-v1',
  'stated-ordering-and-reviewed-lingering-souls-v1',
  'stated-ordering-and-reviewed-optional-generated-token-v1',
  'stated-ordering-and-reviewed-glorybringer-v1',
  'stated-ordering-and-reviewed-grim-lavamancer-v1',
  'stated-ordering-and-reviewed-gifts-ungiven-v1',
  'stated-ordering-and-reviewed-liliana-two-piles-v1',
  'stated-ordering-and-reviewed-fact-or-fiction-v1',
  'stated-ordering-and-reviewed-companion-v1',
  'stated-ordering-and-reviewed-generated-token-sacrifice-v1',
  'stated-ordering-and-reviewed-generated-object-bounded-choice-v1',
  'stated-ordering-and-reviewed-alternate-cost-generated-object-v1',
  'stated-ordering-and-reviewed-residual-generated-token-v1',
  'stated-ordering-and-reviewed-multi-target-transformation-v1',
  'stated-ordering-and-reviewed-planeswalker-unless-sacrifice-v1',
  'stated-ordering-and-reviewed-copy-spell-retarget-v1',
  'stated-ordering-and-reviewed-alternate-cost-v1',
  'stated-ordering-and-optional-decider-you-v1',
  'stated-ordering-and-reviewed-optional-library-search-v1',
  'stated-ordering-and-reviewed-alternate-mode-v1',
] as const;
export const LegacyCubeTopLevelCapabilityProfileSchema = z.enum(LEGACY_CUBE_TOP_LEVEL_CAPABILITY_PROFILES);
export type LegacyCubeTopLevelCapabilityProfile = z.infer<typeof LegacyCubeTopLevelCapabilityProfileSchema>;

export const LEGACY_CUBE_ORDINARY_MANA_PAYMENT_UNSAFE_POSITIONS = [474, 493] as const;

export const LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE = {
  id: 'mtg-bc2.154.4.13-ordinary-mana-payment',
  families: ['priority'],
  evidence:
    'mtg-bc2.154.4.13 loaded every retained safe official card and all six bridge baselines through installed Forge 2.0.14. Focused real matches selected stable identities among duplicate sources, selected a non-default Combo color, spent only currently payable colors, rejected invented and stale moves, exercised all five intrinsic basic-land sources, and canceled after a mana activation through Forge rollback.',
} as const;

/**
 * Closed source/bytecode review for the payment seam composed into every safe
 * card bundle. These are the complete producer shapes present among the cards
 * admitted before mtg-bc2.154.4.13; representatives pin each distinct route.
 */
export const LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT = {
  capability: 'ordinary-mana-payment-v1',
  runtimeProbeId: LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE.id,
  callbacks: ['payManaCost', 'applyManaToCost'],
  excludedPositions: LEGACY_CUBE_ORDINARY_MANA_PAYMENT_UNSAFE_POSITIONS,
  baselineNames: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'],
  sourceShapes: [
    { shape: 'intrinsic-basic-land-type', representativePositions: [536, 558] },
    { shape: 'activated-fixed-one', representativePositions: [23, 78, 271, 325] },
    { shape: 'activated-combo-one', representativePositions: [327, 332, 528] },
    { shape: 'activated-fixed-multiple', representativePositions: [486, 510, 523] },
    { shape: 'activated-variable-multiple', representativePositions: [336, 343, 365, 366] },
    { shape: 'activated-deterministic-counter-cost', representativePositions: [256] },
    { shape: 'activated-automatic-subability', representativePositions: [392, 540] },
    { shape: 'mana-spell-to-pool', representativePositions: [203] },
    { shape: 'triggered-mana-to-pool', representativePositions: [468] },
    { shape: 'reflected-mana', representativePositions: [441] },
  ],
  evidence:
    'mtg-bc2.154.4.13 audited the pinned PlayerController and PlaySpellAbility bytecode plus all 188 previously safe official scripts. The wire owns exact sequential source identity and produced-color choices, floating-pool spending, stale and invented refusal, and Forge rollback cancellation. Dismember and Porcelain Legionnaire are demoted because Phyrexian life-or-mana payment remains outside the profile; X, alternate/additional, convoke, improvise, delve, assist, snow/restricted mana, and nondeterministic non-mana costs remain outside it.',
} as const;

const LegacyCubeOrdinaryManaSourceShapeSchema = z.enum(
  LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT.sourceShapes.map((row) => row.shape) as [
    (typeof LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT.sourceShapes)[number]['shape'],
    ...(typeof LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT.sourceShapes)[number]['shape'][],
  ],
);

export const LegacyCubeBridgeCapabilityBundleSchema = z.object({
  topLevel: LegacyCubeTopLevelCapabilityProfileSchema,
  manaPayment: z.enum(['ordinary-mana-payment-v1', 'announced-mana-payment-v1', 'phyrexian-mana-payment-v1']),
  generatedObjects: z.enum(['none', 'pinned-token-scripts-v1']),
});
export type LegacyCubeBridgeCapabilityBundle = z.infer<typeof LegacyCubeBridgeCapabilityBundleSchema>;

/**
 * Every reviewed bounded profile, in the order a card position is matched
 * against them.
 *
 * Three facts about a profile used to be written out three separate times: the
 * positions that select it, the family signature its cards have to carry, and
 * the families a card of that profile may carry while the global family is
 * still unsupported. The third is the second minus what is already supported,
 * so it is derived here rather than restated. A profile named in two lists and
 * forgotten in the third is a card admitted with a family nobody reviewed, and
 * the shape of that mistake is invisible in a diff that only adds lines.
 */
interface LegacyCubeBoundedProfileReview {
  readonly topLevel: LegacyCubeTopLevelCapabilityProfile;
  readonly positions: readonly number[];
  readonly families: readonly LegacyCubeDecisionFamily[];
  /** Omitted where the profile spends mana the ordinary way, as the builder's own bundle defaults it. */
  readonly manaPayment?: LegacyCubeBridgeCapabilityBundle['manaPayment'];
  readonly generatedObjects: LegacyCubeBridgeCapabilityBundle['generatedObjects'];
}

const LEGACY_CUBE_REVIEWED_BOUNDED_PROFILES: readonly LegacyCubeBoundedProfileReview[] = [
  {
    topLevel: 'priority-only-v1',
    positions: LEGACY_CUBE_PRIORITY_ONLY_SAFE_POSITIONS,
    families: ['priority'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'mandatory-singleton-nonstack-target-v1',
    positions: LEGACY_CUBE_SINGLE_TARGET_SAFE_POSITIONS,
    families: ['priority', 'targets'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'singleton-stack-target-v1',
    positions: LEGACY_CUBE_SINGLE_STACK_TARGET_SAFE_POSITIONS,
    families: ['priority', 'targets'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'singleton-library-zone-card-v1',
    positions: LEGACY_CUBE_SINGLE_ZONE_CARD_SAFE_POSITIONS,
    families: ['priority', 'zone-card-selection'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'ordinary-combat-v1',
    positions: LEGACY_CUBE_ORDINARY_COMBAT_SAFE_POSITIONS,
    families: ['priority', 'combat'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'ordinary-combat-and-mandatory-singleton-nonstack-target-v1',
    positions: LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_SAFE_POSITIONS,
    families: ['priority', 'targets', 'combat'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'ordinary-combat-and-mandatory-singleton-trigger-target-v1',
    positions: LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_SAFE_POSITIONS,
    families: ['priority', 'targets', 'combat'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'mandatory-singleton-trigger-target-v1',
    positions: LEGACY_CUBE_TRIGGER_TARGET_SAFE_POSITIONS,
    families: ['priority', 'targets'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'paladin-class-installed-trigger-target-v1',
    positions: LEGACY_CUBE_PALADIN_CLASS_SAFE_POSITIONS,
    families: ['priority', 'targets'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'shockland-pay-two-life-entry-replacement-v1',
    positions: LEGACY_CUBE_SHOCKLAND_SAFE_POSITIONS,
    families: ['priority', 'optional-costs'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'mandatory-singleton-equip-target-v1',
    positions: LEGACY_CUBE_EQUIP_TARGET_SAFE_POSITIONS,
    families: ['priority', 'targets'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'mandatory-singleton-aura-target-v1',
    positions: LEGACY_CUBE_AURA_TARGET_SAFE_POSITIONS,
    families: ['priority', 'targets'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'mandatory-singleton-fetters-aura-target-v1',
    positions: LEGACY_CUBE_FETTERS_AURA_TARGET_SAFE_POSITIONS,
    families: ['priority', 'targets'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'mandatory-singleton-fall-aura-target-v1',
    positions: LEGACY_CUBE_FALL_AURA_TARGET_SAFE_POSITIONS,
    families: ['priority', 'targets'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'ordinary-combat-baneslayer-protection-v1',
    positions: LEGACY_CUBE_BANESLAYER_PROTECTION_SAFE_POSITIONS,
    families: ['priority', 'combat', 'naming-text-numbers'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'draw-two-conditional-singleton-discard-v1',
    positions: LEGACY_CUBE_CHART_A_COURSE_DISCARD_SAFE_POSITIONS,
    families: ['priority', 'zone-card-selection'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'ordinary-combat-reviewed-level-up-v2',
    positions: LEGACY_CUBE_REVIEWED_LEVEL_UP_SAFE_POSITIONS,
    families: ['priority', 'optional-costs', 'combat'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'ordinary-combat-selfless-spirit-self-sacrifice-indestructible-v1',
    positions: LEGACY_CUBE_SELFLESS_SPIRIT_SAFE_POSITIONS,
    families: ['priority', 'optional-costs', 'zone-card-selection', 'combat'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'ordinary-combat-remorseful-cleric-self-sacrifice-target-graveyard-exile-v1',
    positions: LEGACY_CUBE_REMORSEFUL_CLERIC_SAFE_POSITIONS,
    families: ['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'coldsteel-heart-entry-color-chosen-mana-v1',
    positions: LEGACY_CUBE_COLDSTEEL_HEART_SAFE_POSITIONS,
    families: ['priority', 'naming-text-numbers'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'extinction-event-odd-even-exile-v1',
    positions: LEGACY_CUBE_EXTINCTION_EVENT_SAFE_POSITIONS,
    families: ['priority', 'naming-text-numbers'],
    generatedObjects: 'none',
  },
  {
    topLevel: 'ordinary-combat-target-and-pinned-generated-token-v1',
    positions: LEGACY_CUBE_VRASKA_GENERATED_TOKEN_SAFE_POSITIONS,
    families: ['priority', 'targets', 'combat'],
    generatedObjects: 'pinned-token-scripts-v1',
  },
  {
    topLevel: 'optional-trigger-confirm-v1',
    positions: LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_SAFE_POSITIONS,
    families: ['priority', 'combat', 'replacement-trigger-choices'],
    generatedObjects: 'none',
  },
  ...LEGACY_CUBE_BOUNDED_MULTI_SELECTION_COHORTS.map((cohort) => ({
    topLevel: 'bounded-multi-selection-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_COHORTS.map((cohort) => ({
    topLevel: 'bounded-enumerated-choice-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_ANNOUNCED_NUMBER_COHORTS.map((cohort) => ({
    topLevel: 'announced-number-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_STATED_ORDERING_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_STATED_DISTRIBUTION_COHORTS.map((cohort) => ({
    topLevel: 'stated-distribution-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_STATED_RETARGET_COHORTS.map((cohort) => ({
    topLevel: 'stated-retarget-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'phyrexian-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_OPEN_CARD_NAMING_COHORTS.map((cohort) => ({
    topLevel: 'open-card-naming-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_COHORTS.map((cohort) => ({
    topLevel: 'discard-or-reviewed-sacrifice-cost-v2' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_GENERATED_OBJECT_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-pinned-generated-token-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-trigger-target-and-reviewed-hidden-hand-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-trigger-target-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-counter-type-choice-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-optional-target-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-phyrexian-spell-cost-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'phyrexian-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_CASCADE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-cascade-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-repeatable-mode-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-plow-under-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_MANA_COMBO_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-coalition-relic-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-cryptic-command-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-prismari-command-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-blessed-alliance-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_KALITAS_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-kalitas-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_URO_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-uro-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_KROXA_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-kroxa-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_HUNTMASTER_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-huntmaster-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-remaining-planeswalkers-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: cohort.generatedObjects,
  })),
  ...LEGACY_CUBE_REVIEWED_FINAL_SIX_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-final-six-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: cohort.generatedObjects,
  })),
  ...LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-phantasmal-image-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-peek-and-reveal-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-optional-copy-replacement-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: cohort.manaPayment,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_KARN_LIBERATED_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-karn-liberated-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-rattleclaw-mystic-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-lightning-phoenix-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_BARAL_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-baral-triggered-loot-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_UNLESS_COST_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-unless-cost-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-counter-unless-cost-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_MISCALCULATION_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-miscalculation-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-maul-of-the-skyclaves-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_EMBERCLEAVE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-embercleave-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_LIVING_WEAPON_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-living-weapon-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_FORETELL_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-foretell-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-satyr-wayfinder-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-blue-library-selection-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-gideon-garruk-bloodline-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: cohort.positions[0] === 25 ? ('none' as const) : ('pinned-token-scripts-v1' as const),
  })),
  ...LEGACY_CUBE_REVIEWED_HIDEAWAY_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-hideaway-four-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-sword-of-fire-and-ice-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-sword-of-feast-and-famine-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-sword-of-light-and-shadow-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-sword-of-body-and-mind-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-sword-of-hearth-and-home-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-umezawas-jitte-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_BIRGI_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-birgi-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_BIRTHING_POD_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-birthing-pod-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'phyrexian-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-ranger-captain-of-eos-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_FORBID_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-forbid-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_REVEILLARK_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-reveillark-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-bloodchiefs-thirst-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-primal-might-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_COHORTS.map((cohort) => ({
    topLevel: 'announced-number-and-reviewed-engineered-explosives-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-reorder-or-shuffle-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-animate-dead-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-heartless-act-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-agadeems-awakening-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-modal-land-spells-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: cohort.positions[0] === 70 ? ('pinned-token-scripts-v1' as const) : ('none' as const),
  })),
  ...LEGACY_CUBE_REVIEWED_CONVOKE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-convoke-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_DELVE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-delve-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-free-counterspell-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-legions-landing-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_GILDED_GOOSE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-gilded-goose-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-pia-siege-gang-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_TREACHERY_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-treachery-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-skyclave-apparition-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-path-to-exile-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-glen-elendra-archmage-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-recurring-nightmare-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-priest-of-fell-rites-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-smugglers-copter-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_CRYPTBREAKER_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-cryptbreaker-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-myr-battlesphere-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_TREASURE_COHORT_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-audited-treasure-cohort-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: (cohort.positions as readonly number[]).includes(281)
      ? ('announced-mana-payment-v1' as const)
      : ('ordinary-mana-payment-v1' as const),
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-champion-of-wits-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'ordinary-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-utopia-sprawl-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-splinter-twin-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_LINGERING_SOULS_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-lingering-souls-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-optional-generated-token-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_GLORYBRINGER_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-glorybringer-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-grim-lavamancer-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-gifts-ungiven-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-liliana-two-piles-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-fact-or-fiction-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_COMPANION_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-companion-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-generated-token-sacrifice-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-generated-object-bounded-choice-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-alternate-cost-generated-object-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-residual-generated-token-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-multi-target-transformation-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-planeswalker-unless-sacrifice-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'pinned-token-scripts-v1' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-copy-spell-retarget-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_ALTERNATE_COST_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-alternate-cost-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_OPTIONAL_DECIDER_YOU_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-optional-decider-you-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-optional-library-search-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
  ...LEGACY_CUBE_ALTERNATE_MODE_COHORTS.map((cohort) => ({
    topLevel: 'stated-ordering-and-reviewed-alternate-mode-v1' as const,
    positions: cohort.positions,
    families: cohort.families,
    manaPayment: 'announced-mana-payment-v1' as const,
    generatedObjects: 'none' as const,
  })),
];

/**
 * The reviews a position is actually matched against, with the four cards the
 * cost seam refuses taken back out.
 *
 * `mtg-fp4l` phase 4 wired `getCostDecisionMaker`, and four already-admitted
 * cards pay a cost by tapping creatures somebody chooses, which the wire now
 * throws on. They keep their place in the cohort lists above, because the
 * population those lists describe has not changed and editing them would make
 * a drift check describe a different set than the one it was written for. What
 * changed is that no profile admits them, and subtracting once here is what
 * keeps the per-card review and the corpus-wide safe-position total saying the
 * same thing.
 */
const LEGACY_CUBE_CHOSEN_COST_REFUSED = new Set<number>(LEGACY_CUBE_CHOSEN_COST_PAYMENT_REFUSED_POSITIONS);

const LEGACY_CUBE_BOUNDED_PROFILE_REVIEWS: readonly LegacyCubeBoundedProfileReview[] =
  LEGACY_CUBE_REVIEWED_BOUNDED_PROFILES.map((review) => ({
    ...review,
    positions: review.positions.filter((position) => !LEGACY_CUBE_CHOSEN_COST_REFUSED.has(position)),
  }));

const LegacyCubeGeneratedScriptDependencySchema = z.object({
  kind: z.literal('token-script'),
  name: NonemptyString,
  file: NonemptyString,
  sha256: Sha256Schema,
  families: z.array(LegacyCubeDecisionFamilySchema).min(1),
  evidenceMarkers: z.array(NonemptyString).min(1),
  unknownDecisionSyntax: z.array(NonemptyString),
  dependencies: z.array(NonemptyString),
});
export type LegacyCubeGeneratedScriptDependency = z.infer<typeof LegacyCubeGeneratedScriptDependencySchema>;

export const LegacyCubeDecisionEntrySchema = z.object({
  corpus: z.enum(['official-full-cardlist', 'bridge-baseline']),
  position: z.number().int().positive().nullable(),
  sourceName: NonemptyString,
  correctedName: NonemptyString,
  forgeScript: NonemptyString,
  forgeScriptSha256: Sha256Schema,
  families: z.array(LegacyCubeDecisionFamilySchema).min(1),
  evidenceMarkers: z.array(NonemptyString).min(1),
  unknownDecisionSyntax: z.array(NonemptyString),
  risk: z.enum(['ordinary', 'high']),
  cardFamilySafe: z.boolean(),
  bridgeCapabilityProfile: LegacyCubeBridgeCapabilityBundleSchema.nullable(),
  runtimeProbeId: NonemptyString.nullable(),
  generatedScriptDependencies: z.array(LegacyCubeGeneratedScriptDependencySchema),
});

const SyntaxTokenSchema = z.object({
  kind: z.enum(['line-kind', 'ability-api', 'parameter-key', 'keyword', 'semantic-marker']),
  token: NonemptyString,
  disposition: z.enum(['mapped', 'non-choice']),
  families: z.array(LegacyCubeDecisionFamilySchema),
  evidence: NonemptyString,
});

const SyntaxReviewSchema = z.object({
  schemaVersion: z.literal(1),
  classifierVersion: z.literal('forge-script-controller-family-v1'),
  entries: z.array(SyntaxTokenSchema).min(1),
});

const ControllerCallbackSchema = z.object({
  signature: NonemptyString,
  disposition: z.enum(['decision', 'non-decision', 'outside-legacy-cube-session']),
  families: z.array(LegacyCubeDecisionFamilySchema),
  bridgeOwnership: z.enum(['wire', 'inherited-ai', 'not-reached']),
});

const RuntimeProbeSchema = z.object({
  id: NonemptyString,
  kind: z.enum(['observed-forge-session', 'observed-backend-containment']),
  position: z.number().int().positive().nullable(),
  correctedName: NonemptyString.nullable(),
  cardNames: z.array(NonemptyString).min(1),
  families: z.array(LegacyCubeDecisionFamilySchema).min(1),
  outcome: z.enum(['completed', 'refused-before-spawn']),
  evidence: NonemptyString,
});

export const LegacyCubeDecisionLedgerSchema = z.object({
  schemaVersion: z.literal(1),
  classifierVersion: z.literal('forge-script-controller-family-v1'),
  provenanceArtifact: z.object({
    file: z.literal('legacy-cube-2021-v1.json'),
    sha256: Sha256Schema,
    normalizedRowsSha256: Sha256Schema,
  }),
  forge: z.object({
    version: NonemptyString,
    cardScriptArchiveSha256: Sha256Schema,
    chooseEvenOddEffect: z.object({
      classPath: z.literal(LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.classPath),
      classSha256: z.literal(LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.classSha256),
      upstream: z.object({
        repository: z.literal(LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.upstream.repository),
        revision: z.literal(LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.upstream.revision),
        path: z.literal(LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.upstream.path),
        blobSha1: z.literal(LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.upstream.blobSha1),
        sourceSha256: z.literal(LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.upstream.sourceSha256),
      }),
    }),
  }),
  bridgeReview: z.object({
    bead: z.literal('mtg-fp4l'),
    capability: z.literal('priority-universal-and-bounded-card-profiles-v133'),
    source: z.literal('packages/forge-export/bridge/ForgeBridge.java'),
    sourceSha256: Sha256Schema,
    sessionHumanControlled: z.literal(false),
    universalMatchFamilies: z.array(LegacyCubeDecisionFamilySchema).length(2),
    ordinaryManaPayment: z.object({
      capability: z.literal('ordinary-mana-payment-v1'),
      runtimeProbeId: z.literal('mtg-bc2.154.4.13-ordinary-mana-payment'),
      callbacks: z.tuple([z.literal('payManaCost'), z.literal('applyManaToCost')]),
      excludedPositions: z.tuple([z.literal(474), z.literal(493)]),
      baselineNames: z.tuple([
        z.literal('Plains'),
        z.literal('Island'),
        z.literal('Swamp'),
        z.literal('Mountain'),
        z.literal('Forest'),
      ]),
      sourceShapes: z.array(
        z.object({
          shape: LegacyCubeOrdinaryManaSourceShapeSchema,
          representativePositions: z.array(z.number().int().positive()).min(1),
        }),
      ),
      evidence: NonemptyString,
    }),
    announcedManaPayment: z.object({
      capability: z.literal('announced-mana-payment-v1'),
      runtimeProbeId: z.literal(LEGACY_CUBE_ANNOUNCED_NUMBER_PROBE.id),
      callbacks: z.array(NonemptyString).length(LEGACY_CUBE_ANNOUNCED_MANA_PAYMENT_AUDIT.callbacks.length),
      excludedPositions: z
        .array(z.number().int().positive())
        .length(LEGACY_CUBE_ANNOUNCED_NUMBER_EXCLUDED_POSITIONS.length),
      evidence: NonemptyString,
    }),
    phyrexianManaPayment: z.object({
      capability: z.literal('phyrexian-mana-payment-v1'),
      runtimeProbeId: z.literal(LEGACY_CUBE_STATED_RETARGET_PROBE.id),
      callbacks: z.tuple([
        z.literal('payManaCost'),
        z.literal('applyManaToCost'),
        z.literal('getCostDecisionMaker'),
      ]),
      costPartPattern: z.literal(LEGACY_CUBE_PHYREXIAN_MANA_PAYMENT_AUDIT.costPartPattern),
      evidence: NonemptyString,
    }),
    chosenCostPayment: z.object({
      capability: z.literal('chosen-cost-payment-v22'),
      runtimeProbeId: z.literal(LEGACY_CUBE_REVIEWED_FINAL_SIX_PROBE.id),
      reviewedPositions: z
        .array(z.number().int().positive())
        .length(LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT.reviewedPositions.length),
      callbacks: z.tuple([z.literal('getCostDecisionMaker')]),
      refusedPositions: z
        .array(z.number().int().positive())
        .length(LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT.refusedPositions.length),
      evidence: NonemptyString,
    }),
    generatedTokenScripts: z.object({
      capability: z.literal('pinned-token-scripts-v16'),
      runtimeProbeIds: z
        .array(NonemptyString)
        .length(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.runtimeProbeIds.length),
      reviewedPositions: z
        .array(z.number().int().positive())
        .length(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.reviewedPositions.length),
      safePositions: z
        .array(z.number().int().positive())
        .length(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.safePositions.length),
      excludedPositions: z
        .array(z.number().int().positive())
        .length(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.excludedPositions.length),
      exactTokenScripts: z
        .array(z.object({ name: NonemptyString, sha256: Sha256Schema }))
        .length(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.exactTokenScripts.length),
      evidence: NonemptyString,
    }),
  }),
  controllerSurface: z.object({
    command: z.literal(
      'javap -classpath forge-gui-desktop-2.0.14-jar-with-dependencies.jar -public forge.game.player.PlayerController',
    ),
    sha256: Sha256Schema,
    abstractCallbacks: z.array(ControllerCallbackSchema).min(1),
  }),
  families: z.array(FamilyReviewSchema).length(LEGACY_CUBE_DECISION_FAMILIES.length),
  syntaxReview: z.object({
    file: z.literal('legacy-cube-forge-syntax-review-v1.json'),
    sha256: Sha256Schema,
  }),
  syntaxInventory: z.array(SyntaxTokenSchema).min(1),
  auditedCards: z.array(LegacyCubeDecisionEntrySchema).min(602),
  runtimeProbes: z.array(RuntimeProbeSchema).min(1),
  contentSha256: Sha256Schema,
});

export type LegacyCubeDecisionEntry = z.infer<typeof LegacyCubeDecisionEntrySchema>;
export type LegacyCubeDecisionLedger = z.infer<typeof LegacyCubeDecisionLedgerSchema>;
export type LegacyCubeDecisionSyntaxToken = z.infer<typeof SyntaxTokenSchema>;

export const LEGACY_CUBE_DECISION_LEDGER_PATH = fileURLToPath(
  new URL('../../data/legacy-cube-2021-forge-decisions-v1.json', import.meta.url),
);
export const LEGACY_CUBE_SYNTAX_REVIEW_PATH = fileURLToPath(
  new URL('../../data/legacy-cube-forge-syntax-review-v1.json', import.meta.url),
);

/** Raw committed JSON pin; updated only with a reviewed deterministic rebuild. */
export const LEGACY_CUBE_DECISION_LEDGER_SHA256 =
  '330508e63111788f8b558a47b644d390b9f43002e324deea89b0710365f2ebc1';

const PROVENANCE_ARTIFACT_SHA256 = 'f738adb86f5a226243e9b9e0744dedaecd518b15a81a72371d7c0978fa282b02';
export const FORGE_PLAYER_CONTROLLER_JAVAP_SHA256 =
  'cba4ef53a603fd5f4c97666d1ae78d115c3cd97a2acb33ffcdebaa3ddce0997a';
/** Raw reviewed syntax registry pin; updated only after affirmative token review. */
export const LEGACY_CUBE_SYNTAX_REVIEW_SHA256 =
  '84219355f92d454d347eb6cc4eeed59717729026d6111a57008c7c27d5c62bb4';

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function contentValue(ledger: LegacyCubeDecisionLedger): unknown {
  return {
    bridgeReview: ledger.bridgeReview,
    families: ledger.families,
    controllerSurface: ledger.controllerSurface,
    syntaxReview: ledger.syntaxReview,
    syntaxInventory: ledger.syntaxInventory,
    auditedCards: ledger.auditedCards,
    runtimeProbes: ledger.runtimeProbes,
  };
}

export function legacyCubeDecisionLedgerContentSha256(ledger: LegacyCubeDecisionLedger): string {
  return sha256(`${JSON.stringify(contentValue(ledger))}\n`);
}

/** Closed negative boundary for the ordinary payment bundle. */
export function legacyCubeOrdinaryManaPaymentRefusals(bytes: Uint8Array): readonly string[] {
  return manaPaymentRefusals(bytes, 'ordinary');
}

/**
 * Closed negative boundary for the announced payment bundle.
 *
 * `mtg-fp4l` phase 4 wires `announceRequirements`, so an X in a printed cost is
 * a number the seat states rather than one the controller it inherits from
 * states on the seat's behalf, and the refusal that stood in for that wiring
 * comes off. `Produced$ Any` comes off with it: inside a payment the wire
 * enumerates one choice per color an any-color source can produce, and outside
 * one Forge routes the same ability through the choose-a-color callback phase 3
 * wired. What replaces the narrow per-source cost allowlist is
 * `legacyCubeChosenCostPaymentRefusals`, read over every cost on the card
 * rather than over mana abilities alone. A combo source that makes more than
 * one mana at a time stays refused: that is the only route left to
 * `specifyManaCombo`, which the bridge throws on.
 */
export function legacyCubeAnnouncedManaPaymentRefusals(bytes: Uint8Array): readonly string[] {
  return manaPaymentRefusals(bytes, 'announced');
}

/** Closed payment boundary for a spell with at least one printed Phyrexian symbol. */
export function legacyCubePhyrexianManaPaymentRefusals(bytes: Uint8Array): readonly string[] {
  const refusals = manaPaymentRefusals(bytes, 'announced');
  if (!refusals.includes('Phyrexian mana cost')) return [...refusals, 'missing Phyrexian mana cost'];
  return refusals.filter((refusal) => refusal !== 'Phyrexian mana cost');
}

function manaPaymentRefusals(bytes: Uint8Array, profile: 'ordinary' | 'announced'): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const refusals: string[] = [];
  const manaCost = script.match(/^ManaCost:\s*(.*)$/mu)?.[1]?.trim();
  if (profile === 'ordinary' && manaCost !== undefined && /(?:^|\s)X(?:\s|$)/u.test(manaCost)) {
    refusals.push('X mana cost');
  }
  if (manaCost !== undefined && /(?:^|\s)[WUBRGC]P(?:\s|$)/u.test(manaCost)) {
    refusals.push('Phyrexian mana cost');
  }
  if (manaCost !== undefined && /(?:^|\s)S(?:\s|$)/u.test(manaCost)) refusals.push('snow mana cost');
  if (/^K:(?:Convoke|Improvise|Delve|Assist|Offering|Emerge)(?::|\r?$)/mu.test(script)) {
    refusals.push('special payment keyword');
  }
  if (/^(?:S:.*Mode\$\s*AlternativeCost|K:AlternateAdditionalCost:)/mu.test(script)) {
    refusals.push('alternative or additional cost');
  }
  if (profile === 'ordinary' && /\bProduced\$\s*Any\b/mu.test(script)) {
    refusals.push('any-color announcement');
  }
  if (/\b(?:ManaRestrictions|RestrictValid|RestrictedMana)\$/mu.test(script)) {
    refusals.push('restricted mana');
  }
  for (const line of script.split(/\r?\n/u)) {
    if (profile === 'ordinary') {
      if (!/\bAB\$\s*Mana\b/u.test(line)) continue;
      const cost = line.match(/(?:^|\|)\s*Cost\$\s*([^|]+)/u)?.[1]?.trim();
      if (cost !== undefined && cost !== 'T' && cost !== 'SubCounter<3/P1P1>') {
        refusals.push(`mana-source cost ${cost}`);
      }
      continue;
    }
    if (!/\bProduced\$\s*Combo\b/u.test(line)) continue;
    const amount = line.match(/(?:^|\|)\s*Amount\$\s*([^|]+)/u)?.[1]?.trim();
    if (amount !== undefined && amount !== '1') refusals.push('multi-mana combo');
  }
  return [...new Set(refusals)];
}

/**
 * The cost parts `ForgeBridge.isDecisionFree` answers, written as the shapes a
 * Forge script spells them with: a mana cost, a tap of the source, a life
 * payment, and a counter or sacrifice taken off the source itself. `X` is a
 * legal amount in every one of them, because by the time a cost is paid the
 * seat has already announced it.
 */
const LEGACY_CUBE_DECISION_FREE_COST_PART =
  /^(?:\d+|[WUBRGCXS]+|T|PayLife<(?:\d+|X|[A-Za-z][A-Za-z0-9]*)>|Sac<(?:\d+|X|[A-Za-z][A-Za-z0-9]*)\/CARDNAME>|(?:SubCounter|AddCounter)<(?:\d+|X|[A-Za-z][A-Za-z0-9]*)\/[A-Z0-9]+>)$/u;

/**
 * Closed negative boundary for the non-mana half of a cost.
 *
 * `mtg-fp4l` phase 4 stops the bridge inheriting `getCostDecisionMaker`, which
 * had been handing every non-mana cost part to Forge's own AI to pay on the
 * seat's behalf -- so `tapXType<3/Kithkin>` was three creatures somebody else
 * picked. The wire now answers only the parts with exactly one legal payment
 * and throws on the rest, so a cost naming anything else is refused here. It is
 * read over every cost on the card rather than over mana abilities alone, which
 * is what lets the narrow per-source allowlist in the ordinary payment profile
 * retire for the announced one.
 *
 * `allowPhyrexianManaCostParts` is phase 7's one seam: a Phyrexian symbol in an
 * activated cost is a real question -- the mana, or two life -- so it stays a
 * refusal everywhere except the profile that wired the choice.
 */
const LEGACY_CUBE_PHYREXIAN_COST_PART = /^(?:[WUBRG]P)+$/u;
const LEGACY_CUBE_BOUNDED_CREATURE_TAP_COST_PART = /^tapXType<[12]\/Creature>$/u;

export function legacyCubeChosenCostPaymentRefusals(
  bytes: Uint8Array,
  options: {
    readonly allowPhyrexianManaCostParts?: boolean;
    readonly allowBoundedPermanentCostParts?: boolean;
    readonly allowReviewedDiscardCostParts?: boolean;
    readonly allowReviewedCreatureDiscardCostPart?: boolean;
    readonly allowReviewedCreatureSacrificeCostParts?: boolean;
    readonly allowReviewedGeneratedObjectCostParts?: boolean;
    readonly allowReviewedGildedGooseFoodSacrificeCostPart?: boolean;
    readonly allowReviewedPiaSiegeGangSacrificeCostParts?: boolean;
    readonly allowReviewedGeneratedTokenSacrificeCostParts?: boolean;
    readonly allowReviewedOtherCreatureSacrificeCostPart?: boolean;
    readonly allowReviewedTriggerTargetCostParts?: boolean;
    readonly allowReviewedSourceDiscardCostPart?: boolean;
    readonly allowReviewedSourceReturnCostPart?: boolean;
    readonly allowReviewedExertCostPart?: boolean;
    readonly allowReviewedDrawCostPart?: boolean;
    readonly allowReviewedGraveyardExileCostPart?: boolean;
    readonly allowReviewedFreeCounterspellCostParts?: boolean;
    readonly allowReviewedCryptbreakerCostParts?: boolean;
    readonly allowReviewedMyrBattlesphereCostParts?: boolean;
    readonly allowReviewedTreasureCohortCostParts?: boolean;
    readonly allowReviewedChampionOfWitsCostParts?: boolean;
    readonly allowReviewedKalitasCostPart?: boolean;
    readonly allowReviewedTitanEscapeCostPart?: boolean;
    readonly allowReviewedFinalSixCostParts?: boolean;
  } = {},
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const refusals: string[] = [];
  for (const match of script.matchAll(/^K:Escape:([^\n]+)$/gmu)) {
    const escapeCost = (match[1] ?? '').trim();
    if (
      options.allowReviewedTitanEscapeCostPart !== true ||
      !['G G U U ExileFromGrave<5/Card.Other/other>', 'B B R R ExileFromGrave<5/Card.Other/other>'].includes(
        escapeCost,
      )
    ) {
      refusals.push(`chosen cost payment Escape:${escapeCost}`);
    }
  }
  for (const match of script.matchAll(/(?:^|\|)\s*Cost\$\s*([^|\n]+)/gu)) {
    const parts = splitForgeCostParts((match[1] ?? '').trim());
    for (const part of parts) {
      if (part.length === 0 || LEGACY_CUBE_DECISION_FREE_COST_PART.test(part)) continue;
      // The Phyrexian arm is admitted per profile rather than by widening the
      // decision-free pattern: paying `UP` is a question, and it belongs to the
      // profiles that wired an answer for it and to no others.
      if (options.allowPhyrexianManaCostParts === true && LEGACY_CUBE_PHYREXIAN_COST_PART.test(part)) {
        continue;
      }
      if (
        options.allowReviewedDiscardCostParts === true &&
        (part === 'Discard<1/Card>' || part === 'Discard<0/Hand>')
      ) {
        continue;
      }
      if (options.allowReviewedCreatureDiscardCostPart === true && part === 'Discard<1/Creature>') {
        continue;
      }
      if (options.allowReviewedSourceDiscardCostPart === true && part === 'Discard<1/CARDNAME>') {
        continue;
      }
      if (options.allowReviewedSourceReturnCostPart === true && part === 'Return<1/CARDNAME>') {
        continue;
      }
      if (
        options.allowReviewedOtherCreatureSacrificeCostPart === true &&
        part === 'Sac<1/Creature.Other/another creature>'
      ) {
        continue;
      }
      if (
        options.allowReviewedFinalSixCostParts === true &&
        (part === 'Sac<1/Creature.Other/another creature>' ||
          part === 'Discard<1/Card>' ||
          part === 'Draw<2/You>')
      ) {
        continue;
      }
      if (
        options.allowReviewedTriggerTargetCostParts === true &&
        (part === 'Sac<1/Creature.Other/another creature>' ||
          part === 'Return<1/Rogue.unblocked+attacking+YouCtrl/unblocked attacking Rogue you control>')
      ) {
        continue;
      }
      if (
        options.allowReviewedCreatureSacrificeCostParts === true &&
        (part === 'Sac<1/Creature>' ||
          part === 'Sac<1/Creature.Green/green creature>' ||
          part === 'Sac<1/Creature.Green+Other/another green creature>')
      ) {
        continue;
      }
      if (
        options.allowReviewedGeneratedObjectCostParts === true &&
        (part === 'tapXType<3/Kithkin>' ||
          part === 'tapXType<1/Artifact>' ||
          part === 'ExileFromGrave<1/CARDNAME>')
      ) {
        continue;
      }
      if (
        options.allowReviewedCryptbreakerCostParts === true &&
        (part === 'Discard<1/Card>' || part === 'tapXType<3/Zombie>')
      ) {
        continue;
      }
      if (options.allowReviewedMyrBattlesphereCostParts === true && part === 'tapXType<X/Myr>') {
        continue;
      }
      if (
        options.allowReviewedTreasureCohortCostParts === true &&
        (part === 'Sac<1/CARDNAME/this artifact>' || part === 'Sac<5/Treasure>')
      ) {
        continue;
      }
      if (options.allowReviewedChampionOfWitsCostParts === true && part === 'Draw<X/You>') {
        continue;
      }
      if (
        options.allowReviewedKalitasCostPart === true &&
        part === 'Sac<1/Vampire.Other;Zombie.Other/another Vampire or Zombie>'
      ) {
        continue;
      }
      if (options.allowReviewedGildedGooseFoodSacrificeCostPart === true && part === 'Sac<1/Food>') {
        continue;
      }
      if (
        options.allowReviewedPiaSiegeGangSacrificeCostParts === true &&
        (part === 'Sac<1/Artifact>' || part === 'Sac<1/Goblin>')
      ) {
        continue;
      }
      if (
        options.allowReviewedGeneratedTokenSacrificeCostParts === true &&
        (part === 'Sac<1/Serpent.Other/another Serpent>' ||
          part === 'Sac<1/Servo>' ||
          part === 'Sac<1/Thopter>' ||
          part === 'Sac<1/Treasure>')
      ) {
        continue;
      }
      if (options.allowReviewedExertCostPart === true && part === 'Exert<1/CARDNAME>') {
        continue;
      }
      if (options.allowReviewedDrawCostPart === true && part === 'Draw<1/You>') {
        continue;
      }
      if (options.allowReviewedGraveyardExileCostPart === true && part === 'ExileFromGrave<2/Card>') {
        continue;
      }
      if (
        options.allowReviewedFreeCounterspellCostParts === true &&
        (part === 'ExileFromHand<1/Card.Blue+Other>' || part === 'Return<1/Island>')
      ) {
        continue;
      }
      // A separate T changes CostTapType.canTapSource. The reviewed visitor
      // accepts only the source-inclusive creature pool, including creatures
      // that arrived this turn; it does not implement that narrower pool yet.
      if (
        options.allowBoundedPermanentCostParts === true &&
        (part === 'Exile<1/CARDNAME>' ||
          (!parts.includes('T') && LEGACY_CUBE_BOUNDED_CREATURE_TAP_COST_PART.test(part)))
      ) {
        continue;
      }
      refusals.push(`chosen cost payment ${part}`);
    }
  }
  return [...new Set(refusals)];
}

/** Splits a Forge cost without breaking a descriptive type inside angle brackets. */
function splitForgeCostParts(cost: string): readonly string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < cost.length; index += 1) {
    const character = cost[index];
    if (character === '<') depth += 1;
    if (character === '>') depth = Math.max(0, depth - 1);
    if (depth === 0 && character !== undefined && /\s/u.test(character)) {
      if (index > start) parts.push(cost.slice(start, index));
      start = index + 1;
    }
  }
  if (start < cost.length) parts.push(cost.slice(start));
  return parts.filter((part) => part.length > 0);
}

/** Closed negative boundary for composing direct singleton targets with ordinary combat. */
export function legacyCubeOrdinaryCombatSingleTargetRefusals(
  bytes: Uint8Array,
  options: { readonly allowPinnedGeneratedTokenScripts?: boolean } = {},
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals: string[] = [];
  const triggeredAbilities = new Set<string>();
  const abilityByName = new Map<string, string>();

  for (const line of lines) {
    if (line.startsWith('T:')) {
      for (const match of line.matchAll(/(?:^|\|)\s*Execute\$\s*([^\s|]+)/gu)) {
        if (match[1] !== undefined) triggeredAbilities.add(match[1]);
      }
      if (/\bValidTgts\$/u.test(line)) refusals.push('trigger target');
    }
    const named = line.match(/^SVar:([^:]+):(.*)$/u);
    if (named?.[1] !== undefined && named[2] !== undefined) abilityByName.set(named[1], named[2]);
  }

  if (lines.some((line) => /^K:(?:Equip|Enchant)\b/iu.test(line)) || /^Types:.*\bAura\b/imu.test(script)) {
    refusals.push('attachment target');
  }
  if (/\b(?:AB|SP|DB)\$\s*ChangeTargets\b|\b(?:TargetType|DefinedMagnet)\$/mu.test(script)) {
    refusals.push('retarget ability');
  }
  if (
    options.allowPinnedGeneratedTokenScripts !== true &&
    /\bTokenScript\$\s*c_a_treasure_sac\b/mu.test(script)
  ) {
    refusals.push('transitive generated-object decision source');
  }

  for (const line of lines) {
    if (!/\bValidTgts\$/u.test(line)) continue;
    const named = line.match(/^SVar:([^:]+):/u)?.[1];
    if (named !== undefined && triggeredAbilities.has(named)) refusals.push('trigger target');
    if (/\b(?:TargetMin\$\s*0|MayChooseTarget\$\s*True|Mandatory\$\s*False)\b/iu.test(line)) {
      refusals.push('optional target');
    }
    const minimum = Number(line.match(/\bTargetMin\$\s*(\d+)/u)?.[1] ?? '1');
    const maximum = Number(line.match(/\bTargetMax\$\s*(\d+)/u)?.[1] ?? '1');
    if (minimum > 1 || maximum > 1) refusals.push('multiple targets');
    if (/\bDividedAsYouChoose\$/u.test(line)) refusals.push('divided targets');
    if (/\bTargetingPlayer\$/u.test(line)) refusals.push('delegated target');

    const targetZones = line
      .match(/\bTgtZone\$\s*([^|]+)/u)?.[1]
      ?.split(',')
      .map((zone) => zone.trim());
    if (targetZones !== undefined) {
      if (targetZones.includes('Stack')) refusals.push('stack target');
      if (targetZones.length > 1) refusals.push('multiple target zones');
    }

    const subAbility = line.match(/\bSubAbility\$\s*([^\s|]+)/u)?.[1];
    if (subAbility !== undefined && /\bValidTgts\$/u.test(abilityByName.get(subAbility) ?? '')) {
      refusals.push('nested target block');
    }

    const cost = line.match(/(?:^|\|)\s*Cost\$\s*([^|]+)/u)?.[1]?.trim();
    if (
      cost !== undefined &&
      /(?:\bDiscard\b|\bSac<|\bExileFrom[^ ]*<|\bTapXType\b|\bRemoveAnyCounter\b|\bReveal\b)/u.test(cost)
    ) {
      refusals.push('choice cost');
    }
  }
  return [...new Set(refusals)];
}

/** Closed boundary for the mandatory singleton target selected by a trigger. */
export function legacyCubeMandatoryTriggeredSingleTargetRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals = legacyCubeOrdinaryCombatSingleTargetRefusals(bytes).filter(
    (refusal) => refusal !== 'trigger target',
  );
  const triggeredAbilities = new Set<string>();
  for (const line of lines) {
    if (!line.startsWith('T:')) continue;
    for (const match of line.matchAll(/(?:^|\|)\s*Execute\$\s*([^\s|]+)/gu)) {
      if (match[1] !== undefined) triggeredAbilities.add(match[1]);
    }
  }
  const targetLines = lines.filter((line) => /\bValidTgts\$/u.test(line));
  const triggerTargetLines = targetLines.filter((line) => {
    const name = line.match(/^SVar:([^:]+):/u)?.[1];
    return name !== undefined && triggeredAbilities.has(name);
  });
  if (triggerTargetLines.length === 0) refusals.push('missing mandatory singleton trigger target');
  if (targetLines.some((line) => !triggerTargetLines.includes(line))) refusals.push('non-trigger target');
  if (
    lines.some(
      (line) =>
        /\bValidTgts\$/u.test(line) &&
        /\bChooser\$/u.test(line) &&
        /\b(?:ChangeType|ChangeNum)\$/u.test(line),
    )
  ) {
    refusals.push('nested zone-card selection');
  }
  if (
    lines.some(
      (line) =>
        /\bDB\$\s*ChooseCard\b/u.test(line) && /\b(?:MinAmount\$\s*0|Mandatory\$\s*False)\b/iu.test(line),
    )
  ) {
    refusals.push('optional card selection');
  }
  if (
    lines.some(
      (line) =>
        /\bDB\$\s*ChangeZone\b/u.test(line) && /\bOrigin\$\s*Hand\b/u.test(line) && /\bChooser\$/u.test(line),
    )
  ) {
    refusals.push('nested zone-card selection');
  }
  if (/\bProduced\$\s*(?:Any|Combo\b)/mu.test(script)) refusals.push('independent mana-color choice');
  if (/\bTokenScript\$/mu.test(script)) refusals.push('generated-object dependency');
  return [...new Set(refusals)];
}

/**
 * Closed composition of the broadest reviewed selection profile with one
 * mandatory singleton target chosen for a top-level trigger.
 *
 * The stated-ordering boundary owns every other callback shape on the card;
 * this boundary lifts only its generic trigger-target refusal and then applies
 * the older exact trigger shape. Optional, multiple, direct, generated, nested,
 * and independent mana-color choices therefore remain refusals.
 */
export function legacyCubeStatedOrderingTriggerTargetRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  return [
    ...new Set([
      ...legacyCubeStatedOrderingRefusals(bytes, inventory).filter((refusal) => refusal !== 'trigger target'),
      ...legacyCubeMandatoryTriggeredSingleTargetRefusals(bytes),
    ]),
  ];
}

/**
 * Closed extension for the two reviewed ETB triggers that select from an
 * opponent's revealed hand after selecting that opponent.
 *
 * The ordinary trigger-target composition stays strict. This extension lifts
 * exactly one refusal only when the complete decision-producing line is the
 * pinned Elite Spellbinder or Kitesail Freebooter shape; added or altered
 * hidden-hand selections therefore remain refusals.
 */
export function legacyCubeStatedOrderingTriggerTargetAndHiddenHandRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const base = legacyCubeStatedOrderingTriggerTargetRefusals(bytes, inventory);
  const optionalSelections = lines.filter((line) => /\bDB\$\s*ChooseCard\b/u.test(line));
  const hiddenZoneSelections = lines.filter(
    (line) =>
      /\bDB\$\s*ChangeZone\b/u.test(line) && /\bOrigin\$\s*Hand\b/u.test(line) && /\bChooser\$/u.test(line),
  );
  const exactEliteSelection =
    name === 'Elite Spellbinder' &&
    optionalSelections.length === 1 &&
    optionalSelections[0] ===
      'SVar:DBChooseCard:DB$ ChooseCard | ChoiceZone$ Hand | Choices$ Card.nonLand+IsRemembered | ChoiceTitle$ You may exile a nonland card from it | MinAmount$ 0 | Amount$ 1 | SubAbility$ DBChangeZone' &&
    lines.includes(
      'SVar:DBChangeZone:DB$ ChangeZone | Defined$ ChosenCard | Origin$ Hand | Destination$ Exile | Imprint$ True | SubAbility$ DBEffect',
    );
  const exactFreebooterSelection =
    name === 'Kitesail Freebooter' &&
    hiddenZoneSelections.length === 1 &&
    hiddenZoneSelections[0] ===
      'SVar:ExileCard:DB$ ChangeZone | Origin$ Hand | Destination$ Exile | DefinedPlayer$ Targeted | Chooser$ You | ChangeType$ Card.nonCreature+nonLand | ChangeNum$ 1 | IsCurse$ True | Duration$ UntilHostLeavesPlay';
  return base.filter(
    (refusal) =>
      !(exactEliteSelection && refusal === 'optional card selection') &&
      !(exactFreebooterSelection && refusal === 'nested zone-card selection'),
  );
}

/**
 * Closed composition for the reviewed trigger routes left after the first
 * trigger-target cohort, including the exact optional source-controller
 * trigger plus singleton-target routes.
 *
 * Each route has exactly one target-producing line, but Forge reaches it by a
 * different installed mechanism: a mode-added trigger, a direct phase
 * trigger with a conditional color choice, a targeted hidden-hand move, or a
 * Saga-created command-zone trigger. The identity and route checks below are
 * only the structural boundary; the ledger separately pins every complete
 * installed script byte-for-byte.
 */
export function legacyCubeReviewedTriggerTargetRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const targetLines = lines.filter((line) => /\bValidTgts\$/u.test(line));
  const optionalDeciders = [...script.matchAll(/\bOptionalDecider\$\s*([^\s|]+)/gu)].map((match) => match[1]);
  let exactDirectEtbRefusals: readonly string[] | undefined;
  const exactDirectEtbRoute =
    targetLines.length === 1 &&
    ((name === 'Cast Out' &&
      lines.includes('K:Flash') &&
      lines.includes('K:Cycling:W') &&
      lines.some((line) =>
        line.startsWith(
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile',
        ),
      ) &&
      targetLines[0] ===
        'SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Permanent.nonLand+OppCtrl | TgtPrompt$ Select target nonland permanent an opponent controls | Duration$ UntilHostLeavesPlay' &&
      ((exactDirectEtbRefusals = ['trigger target', 'unbounded decision token keyword:Cycling']), true)) ||
      (name === 'Pestermite' &&
        optionalDeciders.length === 1 &&
        optionalDeciders[0] === 'You' &&
        lines.includes('K:Flying') &&
        lines.includes('K:Flash') &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigTapOrUntap | OptionalDecider$ You',
          ),
        ) &&
        targetLines[0] === 'SVar:TrigTapOrUntap:DB$ TapOrUntap | ValidTgts$ Permanent' &&
        ((exactDirectEtbRefusals = [
          'trigger target',
          'unbounded decision token ability-api:TapOrUntap',
          'unbounded decision token parameter-key:OptionalDecider',
        ]),
        true)) ||
      (name === 'Riftwing Cloudskate' &&
        lines.includes('K:Flying') &&
        lines.includes('K:Suspend:3:1 U') &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChangeZone',
          ),
        ) &&
        targetLines[0] ===
          'SVar:TrigChangeZone:DB$ ChangeZone | ValidTgts$ Permanent | Origin$ Battlefield | Destination$ Hand' &&
        ((exactDirectEtbRefusals = ['trigger target', 'unbounded decision token keyword:Suspend']), true)) ||
      (name === 'Bone Shredder' &&
        lines.includes('K:Flying') &&
        lines.includes('K:Echo:2 B') &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDestroy',
          ),
        ) &&
        targetLines[0] ===
          'SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Creature.nonArtifact+nonBlack | TgtPrompt$ Select target nonartifact, nonblack creature.' &&
        ((exactDirectEtbRefusals = ['trigger target', 'unbounded decision token keyword:Echo']), true)) ||
      (name === 'Shriekmaw' &&
        lines.includes('K:Fear') &&
        lines.includes('K:Evoke:1 B') &&
        lines.includes('SVar:NeedsToPlayEvoked:Creature.OppCtrl+nonArtifact+nonBlack') &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDestroy',
          ),
        ) &&
        targetLines[0] ===
          'SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Creature.nonBlack+nonArtifact | TgtPrompt$ Select target nonartifact, nonblack creature.' &&
        ((exactDirectEtbRefusals = ['trigger target', 'unbounded decision token keyword:Evoke']), true)) ||
      (name === 'Avalanche Riders' &&
        lines.includes('K:Haste') &&
        lines.includes('K:Echo:3 R') &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDestroy',
          ),
        ) &&
        targetLines[0] === 'SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Land' &&
        ((exactDirectEtbRefusals = ['trigger target', 'unbounded decision token keyword:Echo']), true)) ||
      (name === 'Frost Titan' &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ BecomesTarget | ValidSource$ SpellAbility.OppCtrl | ValidTarget$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigCounter',
          ),
        ) &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigTap',
          ),
        ) &&
        lines.some((line) =>
          line.startsWith('T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigTap | Secondary$ True'),
        ) &&
        targetLines[0]?.startsWith('SVar:TrigTap:DB$ Tap | ValidTgts$ Permanent | SubAbility$ DBPump') &&
        lines.includes(
          'SVar:TrigCounter:DB$ Counter | Defined$ TriggeredSourceSA | UnlessCost$ 2 | UnlessPayer$ TriggeredSourceSAController',
        ) &&
        lines.includes('SVar:HasAttackEffect:TRUE') &&
        ((exactDirectEtbRefusals = ['trigger target', 'unbounded decision token parameter-key:UnlessCost']),
        true)) ||
      (name === 'Gatekeeper of Malakir' &&
        lines.includes('K:Kicker:B') &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self+kicked | Execute$ TrigKicker',
          ),
        ) &&
        targetLines[0] === 'SVar:TrigKicker:DB$ Sacrifice | ValidTgts$ Player | SacValid$ Creature' &&
        lines.includes('SVar:NeedsToPlayKicked:Creature.YouDontCtrl') &&
        lines.includes('SVar:PlayMain1:TRUE') &&
        ((exactDirectEtbRefusals = ['trigger target', 'unbounded decision token keyword:Kicker']), true)) ||
      (name === 'Flametongue Yearling' &&
        lines.includes('K:Multikicker:2') &&
        lines.includes(
          'K:etbCounter:P1P1:XKicked:no Condition:CARDNAME enters with a +1/+1 counter on it for each time it was kicked.',
        ) &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDealDamage',
          ),
        ) &&
        targetLines[0] === 'SVar:TrigDealDamage:DB$ DealDamage | ValidTgts$ Creature | NumDmg$ Y' &&
        lines.includes('SVar:XKicked:Count$TimesKicked') &&
        lines.includes('SVar:Y:Count$CardPower') &&
        ((exactDirectEtbRefusals = ['trigger target', 'unbounded decision token keyword:Multikicker']),
        true)) ||
      (name === 'Den Protector' &&
        lines.includes('K:Megamorph:1 G') &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ TurnFaceUp | ValidCard$ Card.Self | Execute$ TrigReturn | TriggerZones$ Battlefield',
          ),
        ) &&
        targetLines[0] ===
          'SVar:TrigReturn:DB$ ChangeZone | ValidTgts$ Card.YouOwn | Origin$ Graveyard | Destination$ Hand' &&
        ((exactDirectEtbRefusals = ['trigger target', 'unbounded decision token keyword:Megamorph']),
        true)) ||
      (name === 'Stratus Dancer' &&
        lines.includes('K:Flying') &&
        lines.includes('K:Megamorph:1 U') &&
        lines.includes(
          'T:Mode$ TurnFaceUp | ValidCard$ Card.Self | Execute$ TrigCounter | TriggerZones$ Battlefield | TriggerDescription$ When CARDNAME is turned face up, counter target instant or sorcery spell.',
        ) &&
        targetLines[0] ===
          'SVar:TrigCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Instant,Sorcery | TgtPrompt$ Select target instant or sorcery spell' &&
        ((exactDirectEtbRefusals = [
          'retarget ability',
          'trigger target',
          'unbounded decision token keyword:Megamorph',
        ]),
        true)) ||
      (name === 'Vendilion Clique' &&
        lines.includes('K:Flying') &&
        lines.includes('K:Flash') &&
        lines.some((line) =>
          line.startsWith(
            'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigPickCard',
          ),
        ) &&
        targetLines[0] ===
          'SVar:TrigPickCard:DB$ ChangeZone | ValidTgts$ Player | Origin$ Hand | Destination$ Library | LibraryPosition$ -1 | ChangeType$ Card.nonLand | ChangeNum$ 1 | Hidden$ True | RememberChanged$ True | Chooser$ You | Optional$ True | IsCurse$ True | SubAbility$ DBDraw' &&
        lines.includes(
          'SVar:DBDraw:DB$ Draw | Defined$ Targeted | NumCards$ 1 | SubAbility$ DBCleanup | ConditionDefined$ Remembered | ConditionPresent$ Card | ConditionCompare$ EQ1',
        ) &&
        lines.includes('SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True') &&
        ((exactDirectEtbRefusals = [
          'trigger target',
          'unbounded decision token parameter-key:Optional',
          'unbounded decision token semantic-marker:optional-trigger-or-replacement',
        ]),
        true)));
  let exactRemainingRefusals: readonly string[] | undefined;
  const exactRemainingRoute =
    (name === 'Torrential Gearhulk' &&
      targetLines.length === 1 &&
      lines.includes('K:Flash') &&
      lines.some((line) =>
        line.startsWith(
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigPlay',
        ),
      ) &&
      targetLines[0] ===
        'SVar:TrigPlay:DB$ Play | TgtZone$ Graveyard | ValidTgts$ Instant.YouCtrl | ValidSA$ Spell | TgtPrompt$ Choose target instant card from your graveyard | WithoutManaCost$ True | Optional$ True | ReplaceGraveyard$ Exile | AILogic$ ReplaySpell' &&
      ((exactRemainingRefusals = [
        'trigger target',
        'unbounded decision token parameter-key:Optional',
        'unbounded decision token semantic-marker:optional-trigger-or-replacement',
      ]),
      true)) ||
    (name === 'Solitude' &&
      targetLines.length === 1 &&
      lines.includes('K:Flash') &&
      lines.includes('K:Lifelink') &&
      lines.includes('K:Evoke:ExileFromHand<1/Card.White+Other/white card>') &&
      lines.includes(
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ When CARDNAME enters, exile up to one other target creature. That creature's controller gains life equal to its power.",
      ) &&
      targetLines[0] ===
        'SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Creature.Other | TgtPrompt$ Select up to one other target creature | TargetMin$ 0 | TargetMax$ 1 | SubAbility$ DBGainLife' &&
      lines.includes('SVar:DBGainLife:DB$ GainLife | Defined$ TargetedController | LifeAmount$ X') &&
      lines.includes('SVar:X:Targeted$CardPower') &&
      ((exactRemainingRefusals = [
        'trigger target',
        'optional target',
        'unbounded decision token keyword:Evoke',
      ]),
      true)) ||
    (name === 'Gonti, Lord of Luxury' &&
      targetLines.length === 1 &&
      lines.includes('K:Deathtouch') &&
      lines.some((line) =>
        line.startsWith(
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDig',
        ),
      ) &&
      targetLines[0] ===
        'SVar:TrigDig:DB$ Dig | ValidTgts$ Opponent | DigNum$ 4 | ChangeNum$ 1 | DestinationZone$ Exile | DestinationZone2$ Library | LibraryPosition$ -1 | RestRandomOrder$ True | ExileFaceDown$ True | WithMayLook$ True | ChangeValid$ Card | RememberChanged$ True | SubAbility$ DBEffect' &&
      lines.includes(
        'SVar:DBEffect:DB$ Effect | RememberObjects$ Remembered | StaticAbilities$ STPlay | Duration$ Permanent | ForgetOnMoved$ Exile | SubAbility$ DBCleanup',
      ) &&
      lines.includes('SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True') &&
      ((exactRemainingRefusals = ['trigger target', 'unbounded decision token parameter-key:WithMayLook']),
      true)) ||
    (name === 'Cavalier of Night' &&
      targetLines.length === 2 &&
      lines.includes('K:Lifelink') &&
      lines.some((line) =>
        line.startsWith(
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSac',
        ),
      ) &&
      lines.some((line) =>
        line.startsWith(
          'SVar:TrigSac:AB$ ImmediateTrigger | Cost$ Sac<1/Creature.Other/another creature> | Execute$ TrigDestroy',
        ),
      ) &&
      targetLines.includes(
        'SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Creature.OppCtrl | TgtPrompt$ Select target creature an opponent controls',
      ) &&
      lines.some((line) =>
        line.startsWith(
          'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigChange',
        ),
      ) &&
      targetLines.includes(
        'SVar:TrigChange:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ValidTgts$ Creature.YouOwn+cmcLE3',
      ) &&
      ((exactRemainingRefusals = [
        'trigger target',
        'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
        'unbounded decision token semantic-marker:triggered-payment',
      ]),
      true)) ||
    (name === 'Necromancy' &&
      targetLines.length === 1 &&
      lines.includes('K:MayFlashSac') &&
      lines.some((line) =>
        line.startsWith(
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | IsPresent$ Card.StrictlySelf | Execute$ RaiseDead',
        ),
      ) &&
      targetLines[0] ===
        'SVar:RaiseDead:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | GainControl$ True | RememberChanged$ True | TgtPrompt$ Select target creature card in a graveyard | ValidTgts$ Creature | ChangeNum$ 1 | SubAbility$ Aurify' &&
      lines.includes(
        'SVar:Aurify:DB$ Animate | Types$ Aura | Keywords$ Enchant:Creature.IsRemembered:creature put onto the battlefield with CARDNAME | Duration$ Permanent | SubAbility$ NecromAttach',
      ) &&
      lines.includes('SVar:NecromAttach:DB$ Attach | Defined$ Remembered | SubAbility$ DBDelay') &&
      lines.includes('SVar:TrigSacrifice:DB$ SacrificeAll | Defined$ DelayTriggerRememberedLKI') &&
      ((exactRemainingRefusals = ['trigger target', 'unbounded decision token keyword:MayFlashSac']),
      true)) ||
    (name === 'Chandra, Torch of Defiance' &&
      targetLines.length === 2 &&
      lines.includes(
        'A:AB$ Effect | Cost$ SubCounter<7/LOYALTY> | Planeswalker$ True | Ultimate$ True | Name$ Emblem — Chandra, Torch of Defiance | Image$ emblem_chandra_torch_of_defiance | Triggers$ TrigSpellCast | Duration$ Permanent | AILogic$ Always | SpellDescription$ You get an emblem with "Whenever you cast a spell, this emblem deals 5 damage to any target."',
      ) &&
      lines.includes(
        'SVar:TrigSpellCast:Mode$ SpellCast | ValidActivatingPlayer$ You | Execute$ EffSpellCast | TriggerDescription$ Whenever you cast a spell, this emblem deals 5 damage to any target.',
      ) &&
      targetLines.includes('SVar:EffSpellCast:DB$ DealDamage | ValidTgts$ Any | NumDmg$ 5') &&
      targetLines.includes(
        'A:AB$ DealDamage | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | ValidTgts$ Creature | NumDmg$ 4 | SpellDescription$ CARDNAME deals 4 damage to target creature.',
      ) &&
      lines.includes(
        'SVar:DBPlay:DB$ Play | Valid$ Card.IsImprinted | ValidSA$ Spell | ValidZone$ Exile | Controller$ You | Optional$ True | Amount$ All | RememberPlayed$ True | ShowCardToActivator$ True | SubAbility$ DBDamage',
      ) &&
      ((exactRemainingRefusals = [
        'trigger target',
        'unbounded decision token parameter-key:Optional',
        'unbounded decision token semantic-marker:optional-trigger-or-replacement',
      ]),
      true)) ||
    (name === 'Zareth San, the Trickster' &&
      targetLines.length === 1 &&
      lines.includes('K:Flash') &&
      lines.includes(
        'A:AB$ ChangeZone | Cost$ 2 U B Return<1/Rogue.unblocked+attacking+YouCtrl/unblocked attacking Rogue you control> | ActivationZone$ Hand | Defined$ Self | Origin$ Hand | Destination$ Battlefield | Tapped$ True | Attacking$ True | SpellDescription$ Put CARDNAME from your hand onto the battlefield tapped and attacking.',
      ) &&
      lines.some((line) =>
        line.startsWith(
          'T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigGainControl | OptionalDecider$ You',
        ),
      ) &&
      targetLines[0] ===
        "SVar:TrigGainControl:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | GainControl$ True | ValidTgts$ Permanent | TargetsWithDefinedController$ TriggeredTarget | TgtPrompt$ Select target permanent in opponent's graveyard" &&
      ((exactRemainingRefusals = [
        'trigger target',
        'unbounded decision token parameter-key:OptionalDecider',
      ]),
      true)) ||
    (name === 'Teferi, Hero of Dominaria' &&
      targetLines.length === 2 &&
      lines.includes(
        'SVar:TrigUntap:DB$ Untap | UntapUpTo$ True | UntapType$ Land | Amount$ 2 | Defined$ You',
      ) &&
      targetLines.includes(
        "A:AB$ ChangeZone | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | ValidTgts$ Permanent.nonLand | TgtPrompt$ Select target nonland permanent | Origin$ Battlefield | Destination$ Library | LibraryPosition$ 2 | IsCurse$ True | SpellDescription$ Put target nonland permanent into its owner's library third from the top.",
      ) &&
      lines.includes(
        'A:AB$ Effect | Cost$ SubCounter<8/LOYALTY> | Planeswalker$ True | Ultimate$ True | Name$ Emblem — Teferi, Hero of Dominaria | Image$ emblem_teferi_hero_of_dominaria | Triggers$ TrigDraw | Duration$ Permanent | AILogic$ Always | SpellDescription$ You get an emblem with "Whenever you draw a card, exile target permanent an opponent controls."',
      ) &&
      lines.includes(
        'SVar:TrigDraw:Mode$ Drawn | ValidCard$ Card.YouCtrl | Execute$ EffSpellCast | TriggerDescription$ Whenever you draw a card, exile target permanent an opponent controls.',
      ) &&
      targetLines.includes(
        'SVar:EffSpellCast:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Permanent.OppCtrl | TgtPrompt$ Select target permanent an opponent controls',
      ) &&
      ((exactRemainingRefusals = ['trigger target', 'unbounded decision token parameter-key:UntapUpTo']),
      true)) ||
    (name === 'Venser, Shaper Savant' &&
      targetLines.length === 1 &&
      lines.includes('K:Flash') &&
      lines.includes(
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ VensersBounce | TriggerDescription$ When CARDNAME enters, return target spell or permanent to its owner's hand.",
      ) &&
      targetLines[0] ===
        'SVar:VensersBounce:DB$ ChangeZone | ValidTgts$ Permanent,Card.inZoneStack | TgtZone$ Stack,Battlefield | Origin$ Battlefield,Stack | Destination$ Hand' &&
      ((exactRemainingRefusals = ['trigger target', 'stack target', 'multiple target zones']), true)) ||
    (name === 'Ulamog, the Ceaseless Hunger' &&
      targetLines.length === 1 &&
      lines.includes(
        'T:Mode$ SpellCast | ValidCard$ Card.Self | Execute$ TrigChange | TriggerDescription$ When you cast this spell, exile two target permanents.',
      ) &&
      targetLines[0] ===
        'SVar:TrigChange:DB$ ChangeZone | ValidTgts$ Permanent | TargetMin$ 2 | TargetMax$ 2 | Origin$ Battlefield | Destination$ Exile' &&
      lines.includes('K:Indestructible') &&
      lines.includes(
        'T:Mode$ Attacks | ValidCard$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigExile | TriggerDescription$ Whenever CARDNAME attacks, defending player exiles the top twenty cards of their library.',
      ) &&
      lines.includes(
        'SVar:TrigExile:DB$ Dig | Defined$ TriggeredDefendingPlayer | DestinationZone$ Exile | DigNum$ 20 | ChangeNum$ All',
      ) &&
      lines.includes('SVar:PlayMain1:TRUE') &&
      lines.includes('SVar:HasAttackEffect:TRUE') &&
      ((exactRemainingRefusals = ['trigger target', 'multiple targets']), true)) ||
    (name === 'Emrakul, the Promised End' &&
      targetLines.length === 1 &&
      lines.includes('K:Flying') &&
      lines.includes('K:Trample') &&
      lines.includes('K:Protection:Instant:instants') &&
      lines.some((line) =>
        line.startsWith('T:Mode$ SpellCast | ValidCard$ Card.Self | Execute$ TrigControlPlayer'),
      ) &&
      targetLines[0] ===
        'SVar:TrigControlPlayer:DB$ ControlPlayer | ValidTgts$ Opponent | SubAbility$ DBDelTrig' &&
      lines.includes(
        'SVar:DBDelTrig:DB$ DelayedTrigger | Mode$ Phase | DelayedTriggerDefinedPlayer$ Targeted | RememberObjects$ Targeted | Phase$ Cleanup | Execute$ DBAddTurn | Static$ True',
      ) &&
      lines.includes('SVar:DBAddTurn:DB$ AddTurn | Defined$ DelayTriggerRemembered | NumTurns$ 1') &&
      ((exactRemainingRefusals = ['trigger target', 'unbounded decision token ability-api:ControlPlayer']),
      true));
  const reviewedOptionalRoute =
    optionalDeciders.length > 0 &&
    optionalDeciders.every((decider) => decider === 'You') &&
    ((name === 'Restoration Angel' &&
      optionalDeciders.length === 1 &&
      lines.some(
        (line) =>
          line.startsWith('T:Mode$ ChangesZone') &&
          line.includes('ValidCard$ Card.Self') &&
          line.includes('Execute$ RestorationExile') &&
          line.includes('OptionalDecider$ You'),
      ) &&
      targetLines[0]?.startsWith(
        'SVar:RestorationExile:DB$ ChangeZone | ValidTgts$ Creature.nonAngel+YouCtrl |',
      ) &&
      lines.some((line) =>
        line.startsWith(
          'SVar:RestorationReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield | GainControl$ True',
        ),
      )) ||
      (name === 'Sun Titan' &&
        optionalDeciders.length === 2 &&
        lines.filter(
          (line) =>
            line.startsWith('T:Mode$ ') &&
            line.includes('Execute$ TrigChange') &&
            line.includes('OptionalDecider$ You'),
        ).length === 2 &&
        targetLines[0]?.startsWith(
          'SVar:TrigChange:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ValidTgts$ Permanent.YouCtrl+cmcLE3',
        )) ||
      (name === 'Reclamation Sage' &&
        optionalDeciders.length === 1 &&
        lines.some(
          (line) =>
            line.startsWith('T:Mode$ ChangesZone') &&
            line.includes('Execute$ TrigDestroy') &&
            line.includes('OptionalDecider$ You'),
        ) &&
        targetLines[0]?.startsWith('SVar:TrigDestroy:DB$ Destroy | ValidTgts$ Artifact,Enchantment')) ||
      (name === 'Eternal Witness' &&
        optionalDeciders.length === 1 &&
        lines.some(
          (line) =>
            line.startsWith('T:Mode$ ChangesZone') &&
            line.includes('Execute$ TrigChangeZone') &&
            line.includes('OptionalDecider$ You'),
        ) &&
        targetLines[0]?.startsWith(
          'SVar:TrigChangeZone:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | ValidTgts$ Card.YouCtrl',
        )) ||
      (name === 'Duplicant' &&
        optionalDeciders.length === 1 &&
        lines.some(
          (line) =>
            line.startsWith('T:Mode$ ChangesZone') &&
            line.includes('Execute$ TrigExile') &&
            line.includes('OptionalDecider$ You'),
        ) &&
        targetLines[0]?.startsWith(
          'SVar:TrigExile:DB$ ChangeZone | Unimprint$ True | Imprint$ True | ImprintLast$ True | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Creature.!token',
        )));
  const routeIsReviewed =
    exactRemainingRoute ||
    (targetLines.length === 1 &&
      (exactDirectEtbRoute ||
        reviewedOptionalRoute ||
        (name === 'Outpost Siege' &&
          lines.some((line) => line.startsWith('K:ETBReplacement:Other:SiegeChoice')) &&
          lines.some(
            (line) =>
              line.startsWith('S:Mode$ Continuous | Affected$ Card.Self+ChosenModeDragons') &&
              line.includes('AddTrigger$ DragonsTrigger'),
          ) &&
          lines.some(
            (line) =>
              line.startsWith('SVar:DragonsTrigger:Mode$ ChangesZone') &&
              line.includes('Execute$ SmallBurnination'),
          ) &&
          targetLines[0]?.startsWith('SVar:SmallBurnination:DB$ DealDamage | ValidTgts$ Any | NumDmg$ 1')) ||
        (name === 'Klothys, God of Destiny' &&
          lines.some(
            (line) =>
              line.startsWith('T:Mode$ Phase | Phase$ Main1 | ValidPlayer$ You') &&
              line.includes('Execute$ TrigChangeZone'),
          ) &&
          targetLines[0]?.startsWith(
            'SVar:TrigChangeZone:DB$ ChangeZone | Origin$ Graveyard | Destination$ Exile | ValidTgts$ Card',
          ) &&
          lines.some(
            (line) =>
              line.startsWith('SVar:DBMana:DB$ Mana | Amount$ 1 | Produced$ Combo R G') &&
              line.includes('ConditionPresent$ Land'),
          )) ||
        (name === 'Tidehollow Sculler' &&
          lines.some(
            (line) =>
              line.startsWith('T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield') &&
              line.includes('Execute$ TrigExile'),
          ) &&
          targetLines[0] ===
            'SVar:TrigExile:DB$ ChangeZone | Origin$ Hand | Destination$ Exile | ValidTgts$ Opponent | DefinedPlayer$ Targeted | Chooser$ You | ChangeType$ Card.nonLand | ChangeNum$ 1 | IsCurse$ True | RememberChanged$ True | ForgetOtherRemembered$ True') ||
        (name === 'Showdown of the Skalds' &&
          lines.includes('K:Chapter:3:TrigExile,TrigEffect,TrigEffect') &&
          lines.some((line) => line.startsWith('SVar:TrigEffect:DB$ Effect | Triggers$ CastSpell')) &&
          lines.some(
            (line) =>
              line.startsWith('SVar:CastSpell:Mode$ SpellCast') && line.includes('Execute$ DBPutCounter'),
          ) &&
          targetLines[0]?.startsWith(
            'SVar:DBPutCounter:DB$ PutCounter | CounterType$ P1P1 | CounterNum$ 1 | ValidTgts$ Creature.YouCtrl',
          ))));
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  const marker = 'trigger target';
  if (!base.includes(marker) || !routeIsReviewed) {
    return [...base, 'exact reviewed trigger-target composition'];
  }
  return base.filter(
    (refusal) =>
      refusal !== marker &&
      !(exactDirectEtbRoute && exactDirectEtbRefusals?.includes(refusal) === true) &&
      !(exactRemainingRoute && exactRemainingRefusals?.includes(refusal) === true) &&
      !(reviewedOptionalRoute && refusal === 'unbounded decision token parameter-key:OptionalDecider'),
  );
}

const LEGACY_CUBE_REVIEWED_ALTERNATE_COST_REFUSALS = new Set([
  'unbounded decision token keyword:Eternalize',
  'unbounded decision token keyword:Evoke',
  'unbounded decision token keyword:Flashback',
  'unbounded decision token keyword:Kicker',
  'unbounded decision token keyword:Suspend',
  'unbounded decision token keyword:Miracle',
  'unbounded decision token keyword:Overload',
  'unbounded decision token keyword:Escalate',
  'unbounded decision token keyword:Dash',
  'unbounded decision token keyword:Splice',
  'unbounded decision token keyword:Cycling',
  'unbounded decision token keyword:Entwine',
  'unbounded decision token keyword:Ninjutsu',
  'unbounded decision token keyword:Escape',
  'unbounded decision token keyword:Multikicker',
]);

/** Closed composition for the reviewed alternate-cost keyword vocabulary. */
export function legacyCubeReviewedAlternateCostRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!base.some((refusal) => LEGACY_CUBE_REVIEWED_ALTERNATE_COST_REFUSALS.has(refusal))) {
    return [...base, 'missing reviewed alternate-cost keyword'];
  }
  return base.filter((refusal) => !LEGACY_CUBE_REVIEWED_ALTERNATE_COST_REFUSALS.has(refusal));
}

/**
 * Closed composition for triggers whose explicit optional decider is You.
 * The generic syntax refusal is lifted only after every occurrence is checked;
 * all unrelated stated-ordering refusals remain intact.
 */
export function legacyCubeOptionalDeciderYouRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  const marker = 'unbounded decision token parameter-key:OptionalDecider';
  const occurrences = [...script.matchAll(/\bOptionalDecider\$\s*([^\s|]+)/gu)].map((match) => match[1]);
  if (!base.includes(marker) || occurrences.length === 0) {
    return [...base, 'missing OptionalDecider$ You marker'];
  }
  if (occurrences.some((decider) => decider !== 'You')) {
    return [...base, 'foreign optional decider'];
  }
  return base.filter((refusal) => refusal !== marker);
}

/**
 * Closed composition for the five optional library searches whose installed
 * scripts spell a nonmandatory shuffle. The exact trigger and search routes
 * are checked before either syntax marker is lifted; all other blockers stay.
 */
export function legacyCubeReviewedOptionalLibrarySearchRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const optionalLines = lines.filter((line) => line.includes('OptionalDecider$'));
  const searchLines = lines.filter((line) => line.includes('ShuffleNonMandatory$'));
  const exact = (optionalPrefixes: readonly string[], searchPrefix: string): boolean =>
    optionalLines.length === optionalPrefixes.length &&
    optionalPrefixes.every((prefix) => optionalLines.some((line) => line.startsWith(prefix))) &&
    searchLines.length === 1 &&
    searchLines[0]?.startsWith(searchPrefix) === true;
  const reviewed =
    (name === 'Stoneforge Mystic' &&
      exact(
        [
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You',
        ],
        'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Card.Equipment | ChangeNum$ 1 | ShuffleNonMandatory$ True',
      )) ||
    (name === 'Land Tax' &&
      exact(
        [
          'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | OptionalDecider$ You | Execute$ TrigChange | CheckSVar$ Y | SVarCompare$ GTX',
        ],
        'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | ChangeNum$ 3 | ShuffleNonMandatory$ True',
      )) ||
    (name === 'Primeval Titan' &&
      exact(
        [
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You',
          'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigChange | TriggerZones$ Battlefield | OptionalDecider$ You | Secondary$ True',
        ],
        'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land | ChangeNum$ 2 | ShuffleNonMandatory$ True',
      )) ||
    (name === 'Solemn Simulacrum' &&
      exact(
        [
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You',
          'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigDraw | OptionalDecider$ TriggeredCardController',
        ],
        'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | ShuffleNonMandatory$ True',
      )) ||
    (name === 'Golos, Tireless Pilgrim' &&
      exact(
        [
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigChange',
        ],
        'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land | ChangeNum$ 1 | ShuffleNonMandatory$ True',
      ));
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!reviewed) return [...base, 'exact reviewed optional library-search composition'];
  return base.filter(
    (refusal) =>
      refusal !== 'unbounded decision token parameter-key:OptionalDecider' &&
      refusal !== 'unbounded decision token parameter-key:ShuffleNonMandatory',
  );
}

/** Closed composition for alternate faces and Adventures already chosen through priority. */
export function legacyCubeReviewedAlternateModeRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  const marker = 'unbounded decision token semantic-marker:alternate-mode';
  if (!base.includes(marker)) return [...base, 'missing reviewed alternate-mode marker'];
  return base.filter((refusal) => refusal !== marker);
}

/** Compatibility name for the first profile that consumed the generic trigger-target guard. */
export const legacyCubeOrdinaryCombatTriggeredSingleTargetRefusals =
  legacyCubeMandatoryTriggeredSingleTargetRefusals;

/** Closed whole-script boundary for the one reviewed Class-installed target trigger. */
export function legacyCubePaladinClassProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals = legacyCubeOrdinaryCombatSingleTargetRefusals(bytes).filter(
    (refusal) => refusal !== 'trigger target',
  );
  const classLines = lines.filter((line) => line.startsWith('K:Class:'));
  const levelTwo = 'K:Class:2:2 W:AddStaticAbility$ SPump';
  const levelThree = 'K:Class:3:4 W:AddTrigger$ TriggerAttackersDeclared';

  if (!lines.includes('Types:Enchantment Class')) refusals.push('Paladin Class type line');
  if (!classLines.includes(levelTwo)) refusals.push('level-two cost or shape');
  if (!classLines.includes(levelThree)) refusals.push('level-three cost or shape');
  if (classLines.length !== 2) refusals.push('additional Class level');
  if (
    !lines.some((line) =>
      line.startsWith(
        'S:Mode$ RaiseCost | ValidCard$ Card | Activator$ Opponent | ValidSpell$ Spell | Amount$ 1 | Condition$ PlayerTurn',
      ),
    )
  ) {
    refusals.push('exact Paladin level-one effect');
  }
  if (
    !lines.some((line) =>
      line.startsWith(
        'SVar:SPump:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ 1 | AddToughness$ 1 | Secondary$ True',
      ),
    )
  ) {
    refusals.push('exact Paladin level-two effect');
  }
  if (
    !lines.some((line) =>
      line.startsWith(
        'SVar:TriggerAttackersDeclared:Mode$ AttackersDeclared | AttackingPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigPump | Secondary$ True',
      ),
    )
  ) {
    refusals.push('exact Paladin installed trigger');
  }
  const targetLines = lines.filter((line) => /\bValidTgts\$/u.test(line));
  if (targetLines.some((line) => !line.startsWith('SVar:TrigPump:'))) {
    refusals.push('non-Class target');
  }
  if (
    !targetLines.includes(
      'SVar:TrigPump:DB$ Pump | ValidTgts$ Creature.attacking | NumAtt$ +X | NumDef$ +X | KW$ Double Strike',
    ) ||
    !lines.includes('SVar:X:Count$Valid Creature.attacking/Minus.1')
  ) {
    refusals.push('exact Paladin trigger effect');
  }
  if (/^T:/mu.test(script)) refusals.push('top-level trigger outside Class profile');
  if (/\bProduced\$\s*(?:Any|Combo\b)/mu.test(script)) refusals.push('independent mana-color choice');
  if (/\bTokenScript\$/mu.test(script)) refusals.push('generated-object dependency');
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for the ten reviewed shockland entry replacements. */
export function legacyCubeShocklandProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals: string[] = [];
  const replacement =
    "R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated | Description$ As CARDNAME enters, you may pay 2 life. If you don't, it enters tapped.";
  const tap =
    'SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<2> | UnlessPayer$ You | StackDescription$ enters tapped.';
  const typeLine = lines.find((line) => line.startsWith('Types:'));
  const allowedTypeLines = new Set([
    'Types:Land Mountain Forest',
    'Types:Land Island Swamp',
    'Types:Land Forest Island',
    'Types:Land Plains Swamp',
    'Types:Land Island Mountain',
    'Types:Land Forest Plains',
    'Types:Land Swamp Mountain',
    'Types:Land Plains Island',
    'Types:Land Swamp Forest',
    'Types:Land Mountain Plains',
  ]);

  if (!lines.includes('ManaCost:no cost')) refusals.push('land mana cost');
  if (typeLine === undefined || !allowedTypeLines.has(typeLine)) refusals.push('shockland type line');
  if (!lines.includes(replacement)) {
    const replacementLine = lines.find((line) => line.startsWith('R:Event$ Moved'));
    const exactDescription =
      "Description$ As CARDNAME enters, you may pay 2 life. If you don't, it enters tapped.";
    if (replacementLine !== undefined && !replacementLine.includes(exactDescription)) {
      refusals.push('replacement description');
    } else {
      refusals.push('entry replacement');
    }
  }
  if (!lines.includes(tap)) {
    if (!lines.some((line) => line.includes('UnlessCost$ PayLife<2>'))) {
      refusals.push('pay-two-life cost');
    }
    if (!lines.some((line) => line.includes('Defined$ Self'))) refusals.push('self tap effect');
    if (!lines.some((line) => line.includes('UnlessPayer$ You'))) refusals.push('local payer');
    if (
      lines.some((line) => line.includes('UnlessCost$ PayLife<2>')) &&
      lines.some((line) => line.includes('Defined$ Self')) &&
      lines.some((line) => line.includes('UnlessPayer$ You'))
    ) {
      refusals.push('exact tap fallback');
    }
  }
  if (lines.filter((line) => line.startsWith('R:')).length !== 1) refusals.push('additional replacement');
  if (lines.filter((line) => line.startsWith('SVar:')).length !== 1)
    refusals.push('additional choice surface');
  if (lines.some((line) => /^(?:A|T|K):/u.test(line))) refusals.push('additional choice surface');
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for the two reviewed zero-cost Equip cards. */
export function legacyCubeEquipTargetProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals: string[] = [];
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const equipmentType = lines.includes('Types:Artifact Equipment');
  const equipLines = lines.filter((line) => line.startsWith('K:'));
  const targetLines = lines.filter((line) => /\bValidTgts\$/u.test(line));

  if (!equipmentType || equipLines.some((line) => line.startsWith('K:Enchant:'))) {
    refusals.push('Equipment attachment shape');
  }
  if (lines.some((line) => /^SVar:AttachAI/u.test(line)) || /^Types:.*\bAura\b/mu.test(script)) {
    refusals.push('auto-attach or Aura surface');
  }
  if (!['Grafted Wargear', 'Lightning Greaves'].includes(name ?? '') || !lines.includes('K:Equip:0')) {
    refusals.push('Equip cost or cohort');
  }
  if (equipLines.length !== 1) refusals.push('additional attachment keyword');
  if (targetLines.length > 0) refusals.push('extra target block');
  if (
    targetLines.some((line) =>
      /\b(?:TargetMin\$\s*0|MayChooseTarget\$\s*True|Mandatory\$\s*False)\b/iu.test(line),
    )
  ) {
    refusals.push('optional target');
  }
  if (
    targetLines.some((line) => {
      const minimum = Number(line.match(/\bTargetMin\$\s*(\d+)/u)?.[1] ?? '1');
      const maximum = Number(line.match(/\bTargetMax\$\s*(\d+)/u)?.[1] ?? '1');
      return minimum > 1 || maximum > 1;
    })
  ) {
    refusals.push('multiple targets');
  }

  if (name === 'Grafted Wargear') {
    const exactStatic =
      'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 3 | AddToughness$ 2 | Description$ Equipped creature gets +3/+2.';
    const exactTrigger =
      'T:Mode$ Unattached | ValidAttachment$ Card.Self | ValidObject$ Permanent | Execute$ TrigSac | TriggerDescription$ Whenever CARDNAME becomes unattached from a permanent, sacrifice that permanent.';
    const exactSacrifice =
      'SVar:TrigSac:DB$ SacrificeAll | Defined$ TriggeredObjectLKICopy | Controller$ You';
    if (!lines.includes(exactStatic)) refusals.push('exact Grafted Wargear static effect');
    if (!lines.includes(exactTrigger) || !lines.includes(exactSacrifice)) {
      refusals.push('exact Grafted Wargear trigger');
    }
    if (lines.filter((line) => line.startsWith('T:')).length !== 1) {
      refusals.push('additional Equipment trigger');
    }
    if (lines.filter((line) => line.startsWith('SVar:')).length !== 1) {
      refusals.push('additional Equipment ability');
    }
  }
  if (name === 'Lightning Greaves') {
    const exactStatic =
      'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddKeyword$ Haste & Shroud | Description$ Equipped creature has haste and shroud.';
    if (!lines.includes(exactStatic)) refusals.push('exact Lightning Greaves static effect');
    if (lines.some((line) => /^(?:A|T|R|SVar):/u.test(line))) {
      refusals.push('additional Equipment ability');
    }
  }
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for Control Magic's one cast-time Aura target. */
export function legacyCubeAuraTargetProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals: string[] = [];
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const keywordLines = lines.filter((line) => line.startsWith('K:'));
  const targetLines = lines.filter((line) => /\bValidTgts\$/u.test(line));
  const exactStatic =
    'S:Mode$ Continuous | Affected$ Card.EnchantedBy | GainControl$ You | Description$ You control enchanted creature.';

  if (!lines.includes('Types:Enchantment Aura') || keywordLines.some((line) => line.startsWith('K:Equip:'))) {
    refusals.push('Aura attachment shape');
  }
  if (keywordLines.length !== 1 || !lines.includes('K:Enchant:Creature')) {
    refusals.push('Enchant creature shape');
  }
  if (
    name !== 'Control Magic' ||
    !lines.includes('ManaCost:2 U U') ||
    !lines.includes('SVar:AttachAILogic:GainControl') ||
    !lines.includes(exactStatic) ||
    !lines.includes('Oracle:Enchant creature\\nYou control enchanted creature.')
  ) {
    refusals.push('exact Control Magic semantics');
  }
  if (targetLines.length > 0) refusals.push('extra target block');
  if (
    targetLines.some((line) =>
      /\b(?:TargetMin\$\s*0|MayChooseTarget\$\s*True|Mandatory\$\s*False)\b/iu.test(line),
    )
  ) {
    refusals.push('optional target');
  }
  if (
    targetLines.some((line) => {
      const minimum = Number(line.match(/\bTargetMin\$\s*(\d+)/u)?.[1] ?? '1');
      const maximum = Number(line.match(/\bTargetMax\$\s*(\d+)/u)?.[1] ?? '1');
      return minimum > 1 || maximum > 1;
    })
  ) {
    refusals.push('multiple targets');
  }
  if (targetLines.some((line) => !/\bValidTgts\$\s*Creature(?:\s|\||$)/u.test(line))) {
    refusals.push('noncreature target');
  }
  if (targetLines.some((line) => /\bTgtZone\$(?!\s*Battlefield(?:\s|\||$))/u.test(line))) {
    refusals.push('nonbattlefield target');
  }
  if (lines.some((line) => /^T:/u.test(line))) refusals.push('trigger surface');
  if (lines.some((line) => /^A:/u.test(line))) refusals.push('activated surface');
  if (lines.some((line) => /^R:/u.test(line))) refusals.push('replacement surface');
  if (lines.some((line) => /\bDestination\$\s*Library\b/u.test(line))) {
    refusals.push('ordering-sensitive destination');
  }
  const allowedSVar = new Set(['SVar:AttachAILogic:GainControl']);
  if (lines.some((line) => line.startsWith('SVar:') && !allowedSVar.has(line))) {
    refusals.push('additional Aura ability');
  }
  if (lines.filter((line) => line.startsWith('S:')).length !== 1) {
    refusals.push('additional Aura static');
  }
  if (/\b(?:TokenScript|Produced)\$/mu.test(script)) refusals.push('additional decision surface');
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for Faith's Fetters and no other Aura. */
export function legacyCubeFettersAuraTargetProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals: string[] = [];
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const keywordLines = lines.filter((line) => line.startsWith('K:'));
  const targetLines = lines.filter((line) => /\bValidTgts\$/u.test(line));
  const exactTrigger =
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigGainLife | TriggerDescription$ When CARDNAME enters, you gain 4 life.';
  const exactStatic =
    "S:Mode$ CantAttack,CantBlock,CantBeActivated | ValidCard$ Card.EnchantedBy | ValidSA$ Activated.!ManaAbility | Description$ Enchanted permanent can't attack or block, and its activated abilities can't be activated unless they're mana abilities.";

  if (!lines.includes('Types:Enchantment Aura') || keywordLines.some((line) => line.startsWith('K:Equip:'))) {
    refusals.push('Aura attachment shape');
  }
  if (keywordLines.length !== 1 || !lines.includes('K:Enchant:Permanent')) {
    refusals.push('Enchant permanent shape');
  }
  if (
    name !== "Faith's Fetters" ||
    !lines.includes('ManaCost:3 W') ||
    !lines.includes('SVar:AttachAITgts:Creature') ||
    !lines.includes('SVar:AttachAILogic:Curse') ||
    !lines.includes('DeckHas:Ability$LifeGain') ||
    !lines.includes(
      "Oracle:Enchant permanent\\nWhen Faith's Fetters enters, you gain 4 life.\\nEnchanted permanent can't attack or block, and its activated abilities can't be activated unless they're mana abilities.",
    )
  ) {
    refusals.push("exact Faith's Fetters semantics");
  }
  if (
    lines.filter((line) => line.startsWith('T:')).length !== 1 ||
    !lines.includes(exactTrigger) ||
    !lines.includes('SVar:TrigGainLife:DB$ GainLife | LifeAmount$ 4')
  ) {
    refusals.push('exact four-life entry trigger');
  }
  if (lines.filter((line) => line.startsWith('S:')).length !== 1 || !lines.includes(exactStatic)) {
    refusals.push('exact attached prohibition');
  }
  if (targetLines.length > 0) refusals.push('extra target block');
  if (
    targetLines.some((line) =>
      /\b(?:TargetMin\$\s*0|MayChooseTarget\$\s*True|Mandatory\$\s*False)\b/iu.test(line),
    )
  ) {
    refusals.push('optional target');
  }
  if (
    targetLines.some((line) => {
      const minimum = Number(line.match(/\bTargetMin\$\s*(\d+)/u)?.[1] ?? '1');
      const maximum = Number(line.match(/\bTargetMax\$\s*(\d+)/u)?.[1] ?? '1');
      return minimum > 1 || maximum > 1;
    })
  ) {
    refusals.push('multiple targets');
  }
  if (targetLines.some((line) => /\bTgtZone\$(?!\s*Battlefield(?:\s|\||$))/u.test(line))) {
    refusals.push('nonbattlefield target');
  }
  if (lines.some((line) => /^A:/u.test(line))) refusals.push('activated surface');
  if (lines.some((line) => /^R:/u.test(line))) refusals.push('replacement surface');
  if (lines.some((line) => /\bDestination\$\s*Library\b/u.test(line))) {
    refusals.push('ordering-sensitive destination');
  }
  const allowedSVar = new Set([
    'SVar:AttachAITgts:Creature',
    'SVar:AttachAILogic:Curse',
    'SVar:TrigGainLife:DB$ GainLife | LifeAmount$ 4',
  ]);
  if (lines.some((line) => line.startsWith('SVar:') && !allowedSVar.has(line))) {
    refusals.push('additional Aura ability');
  }
  if (/\b(?:TokenScript|Produced)\$/mu.test(script)) refusals.push('additional decision surface');
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for Fall from Favor and no other Aura. */
export function legacyCubeFallAuraTargetProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals: string[] = [];
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const keywordLines = lines.filter((line) => line.startsWith('K:'));
  const targetLines = lines.filter((line) => /\bValidTgts\$/u.test(line));
  const exactTrigger =
    'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigTap | TriggerDescription$ When CARDNAME enters, tap enchanted creature and you become the monarch.';
  const exactTap = 'SVar:TrigTap:DB$ Tap | Defined$ Enchanted | SubAbility$ DBMonarch';
  const exactMonarch = 'SVar:DBMonarch:DB$ BecomeMonarch';
  const exactUntapPrevention =
    "R:Event$ Untap | ValidCard$ Creature.EnchantedBy+ControlledBy EnchantedController.!isMonarch | ValidStepTurnToController$ You | Layer$ CantHappen | Description$ Enchanted creature doesn't untap during its controller's untap step unless that player is the monarch.";

  if (!lines.includes('Types:Enchantment Aura') || keywordLines.some((line) => line.startsWith('K:Equip:'))) {
    refusals.push('Aura attachment shape');
  }
  if (keywordLines.length !== 1 || !lines.includes('K:Enchant:Creature')) {
    refusals.push('Enchant creature shape');
  }
  if (
    name !== 'Fall from Favor' ||
    !lines.includes('ManaCost:2 U') ||
    !lines.includes('SVar:AttachAITgts:Card.cmcGE2') ||
    !lines.includes(
      "Oracle:Enchant creature\\nWhen Fall from Favor enters, tap enchanted creature and you become the monarch.\\nEnchanted creature doesn't untap during its controller's untap step unless that player is the monarch.",
    )
  ) {
    refusals.push('exact Fall from Favor semantics');
  }
  if (
    lines.filter((line) => line.startsWith('T:')).length !== 1 ||
    !lines.includes(exactTrigger) ||
    !lines.includes(exactTap) ||
    !lines.includes(exactMonarch)
  ) {
    refusals.push('exact tap-and-monarch entry trigger');
  }
  if (lines.filter((line) => line.startsWith('R:')).length !== 1 || !lines.includes(exactUntapPrevention)) {
    refusals.push('exact conditional untap prevention');
  }
  if (targetLines.length > 0) refusals.push('extra target block');
  if (
    targetLines.some((line) =>
      /\b(?:TargetMin\$\s*0|MayChooseTarget\$\s*True|Mandatory\$\s*False)\b/iu.test(line),
    )
  ) {
    refusals.push('optional target');
  }
  if (
    targetLines.some((line) => {
      const minimum = Number(line.match(/\bTargetMin\$\s*(\d+)/u)?.[1] ?? '1');
      const maximum = Number(line.match(/\bTargetMax\$\s*(\d+)/u)?.[1] ?? '1');
      return minimum > 1 || maximum > 1;
    })
  ) {
    refusals.push('multiple targets');
  }
  if (targetLines.some((line) => !/\bValidTgts\$\s*Creature(?:\s|\||$)/u.test(line))) {
    refusals.push('noncreature target');
  }
  if (targetLines.some((line) => /\bTgtZone\$(?!\s*Battlefield(?:\s|\||$))/u.test(line))) {
    refusals.push('nonbattlefield target');
  }
  if (lines.some((line) => /^A:/u.test(line))) refusals.push('activated surface');
  if (lines.some((line) => /^S:/u.test(line))) refusals.push('static surface');
  if (lines.some((line) => /\bDestination\$\s*Library\b/u.test(line))) {
    refusals.push('ordering-sensitive destination');
  }
  const allowedSVar = new Set(['SVar:AttachAITgts:Card.cmcGE2', exactTap, exactMonarch]);
  if (lines.some((line) => line.startsWith('SVar:') && !allowedSVar.has(line))) {
    refusals.push('additional Aura ability');
  }
  if (/\b(?:TokenScript|Produced)\$/mu.test(script)) refusals.push('additional decision surface');
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for Baneslayer Angel and no other protection card. */
export function legacyCubeBaneslayerProtectionProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const refusals: string[] = [];
  const keywordLines = lines.filter((line) => line.startsWith('K:'));
  const exactKeywords = [
    'K:Flying',
    'K:First Strike',
    'K:Lifelink',
    'K:Protection:Demon',
    'K:Protection:Dragon',
  ];

  if (!lines.includes('Name:Baneslayer Angel')) refusals.push('exact identity');
  if (!lines.includes('ManaCost:3 W W')) refusals.push('exact mana cost');
  if (!lines.includes('Types:Creature Angel')) refusals.push('exact creature type');
  if (!lines.includes('PT:5/5')) refusals.push('exact combat stats');
  if (JSON.stringify(keywordLines) !== JSON.stringify(exactKeywords)) {
    refusals.push('exact keyword sequence');
  }
  if (!lines.includes('K:Protection:Demon')) refusals.push('fixed Demon protection');
  if (!lines.includes('K:Protection:Dragon')) refusals.push('fixed Dragon protection');
  if (!lines.includes('Oracle:Flying, first strike, lifelink, protection from Demons and from Dragons')) {
    refusals.push('exact Oracle text');
  }
  const allowed = new Set([
    'Name:Baneslayer Angel',
    'ManaCost:3 W W',
    'Types:Creature Angel',
    'PT:5/5',
    ...exactKeywords,
    'Oracle:Flying, first strike, lifelink, protection from Demons and from Dragons',
  ]);
  if (lines.some((line) => !allowed.has(line))) refusals.push('additional mechanic');
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for Chart a Course and no other discard card. */
export function legacyCubeChartACourseDiscardProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const refusals: string[] = [];
  const root =
    'A:SP$ Draw | NumCards$ 2 | SubAbility$ DBDiscard | SpellDescription$ Draw two cards. Then discard a card unless you attacked this turn.';
  const discard =
    'SVar:DBDiscard:DB$ Discard | Mode$ TgtChoose | ConditionCheckSVar$ RaidTest | ConditionSVarCompare$ EQ0';
  const raid = 'SVar:RaidTest:Count$AttackersDeclared';
  const oracle = 'Oracle:Draw two cards. Then discard a card unless you attacked this turn.';

  if (!lines.includes('Name:Chart a Course')) refusals.push('exact identity');
  if (!lines.includes('ManaCost:1 U')) refusals.push('exact mana cost');
  if (!lines.includes('Types:Sorcery')) refusals.push('exact card type');
  if (!lines.includes(root)) refusals.push('exact draw-two root');
  if (!lines.includes(discard)) refusals.push('exact singleton discard');
  if (!lines.includes(raid)) refusals.push('exact attacked-this-turn condition');
  if (!lines.includes(oracle)) refusals.push('exact Oracle text');
  const allowed = new Set([
    'Name:Chart a Course',
    'ManaCost:1 U',
    'Types:Sorcery',
    root,
    discard,
    raid,
    oracle,
  ]);
  if (lines.some((line) => !allowed.has(line))) refusals.push('additional mechanic');
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for the three reviewed Level up cards. */
export function legacyCubeReviewedLevelUpProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const reviewedScripts: Readonly<Record<string, readonly string[]>> = {
    'Student of Warfare': [
      'Name:Student of Warfare',
      'ManaCost:W',
      'Types:Creature Human Knight',
      'PT:1/1',
      'K:Level up:W',
      'S:Mode$ Continuous | Affected$ Card.Self | SetPower$ 3 | SetToughness$ 3 | AddKeyword$ First Strike | IsPresent$ Card.Self+counters_GE2_LEVEL+counters_LE6_LEVEL | Description$ LEVEL 2-6 3/3 First strike',
      'S:Mode$ Continuous | Affected$ Card.Self | SetPower$ 4 | SetToughness$ 4 | AddKeyword$ Double Strike | IsPresent$ Card.Self+counters_GE7_LEVEL | Description$ LEVEL 7+ 4/4 Double strike',
      'Oracle:Level up {W} ({W}: Put a level counter on this. Level up only as a sorcery.)\\nLEVEL 2-6\\n3/3\\nFirst strike\\nLEVEL 7+\\n4/4\\nDouble strike',
    ],
    'Joraga Treespeaker': [
      'Name:Joraga Treespeaker',
      'ManaCost:G',
      'Types:Creature Elf Druid',
      'PT:1/1',
      'K:Level up:1 G',
      'S:Mode$ Continuous | Affected$ Card.Self | SetPower$ 1 | SetToughness$ 2 | AddAbility$ ABMana | IsPresent$ Card.Self+counters_GE1_LEVEL+counters_LE4_LEVEL | Description$ LEVEL 1-4 1/2 {T}: Add {G}{G}.',
      'SVar:ABMana:AB$ Mana | Cost$ T | Produced$ G | Amount$ 2 | SpellDescription$ Add {G}{G}.',
      'S:Mode$ Continuous | Affected$ Card.Self | SetPower$ 1 | SetToughness$ 4 | IsPresent$ Card.Self+counters_GE5_LEVEL',
      'S:Mode$ Continuous | Affected$ Elf.YouCtrl | AddAbility$ ABMana | IsPresent$ Card.Self+counters_GE5_LEVEL | Description$ LEVEL 5+ 1/4 Elves you control have "{T}: Add {G}{G}."',
      'DeckHints:Type$Elf',
      'Oracle:Level up {1}{G} ({1}{G}: Put a level counter on this. Level up only as a sorcery.)\\nLEVEL 1-4\\n1/2\\n{T}: Add {G}{G}.\\nLEVEL 5+\\n1/4\\nElves you control have "{T}: Add {G}{G}."',
    ],
    Hexdrinker: [
      'Name:Hexdrinker',
      'ManaCost:G',
      'Types:Creature Snake',
      'PT:2/1',
      'K:Level up:1',
      'S:Mode$ Continuous | Affected$ Card.Self | SetPower$ 4 | SetToughness$ 4 | AddKeyword$ Protection:Instant:instants | IsPresent$ Card.Self+counters_GE3_LEVEL+counters_LT8_LEVEL | Description$ LEVEL 3-7 4/4 Protection from instants',
      'S:Mode$ Continuous | Affected$ Card.Self | SetPower$ 6 | SetToughness$ 6 | AddKeyword$ Protection from everything | IsPresent$ Card.Self+counters_GE8_LEVEL | Description$ LEVEL 8+ 6/6 Protection from everything',
      'Oracle:Level up {1} ({1}: Put a level counter on this. Level up only as a sorcery.)\\nLEVEL 3-7\\n4/4\\nProtection from instants\\nLEVEL 8+\\n6/6\\nProtection from everything',
    ],
  };
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  if (name === undefined || reviewedScripts[name] === undefined) return ['exact reviewed identity'];
  const expected = reviewedScripts[name];
  if (JSON.stringify(lines) !== JSON.stringify(expected)) return ['exact reviewed level-up script'];
  return [];
}

/** Closed whole-script boundary for Selfless Spirit and no other sacrifice card. */
export function legacyCubeSelflessSpiritProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const refusals: string[] = [];
  const activation =
    'A:AB$ PumpAll | Cost$ Sac<1/CARDNAME> | ValidCards$ Creature.YouCtrl | KW$ Indestructible | SpellDescription$ Creatures you control gain indestructible until end of turn.';
  const oracle =
    'Oracle:Flying\\nSacrifice Selfless Spirit: Creatures you control gain indestructible until end of turn.';

  if (!lines.includes('Name:Selfless Spirit')) refusals.push('exact identity');
  if (!lines.includes('ManaCost:1 W')) refusals.push('exact mana cost');
  if (!lines.includes('Types:Creature Spirit Cleric')) refusals.push('exact creature type');
  if (!lines.includes('PT:2/1')) refusals.push('exact combat stats');
  if (!lines.includes('K:Flying')) refusals.push('exact flying keyword');
  if (!lines.includes(activation)) refusals.push('exact self-sacrifice team-indestructible activation');
  if (!lines.includes(oracle)) refusals.push('exact installed Oracle text');
  const allowed = new Set([
    'Name:Selfless Spirit',
    'ManaCost:1 W',
    'Types:Creature Spirit Cleric',
    'PT:2/1',
    'K:Flying',
    activation,
    oracle,
  ]);
  if (lines.some((line) => !allowed.has(line))) refusals.push('additional mechanic');
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for Remorseful Cleric and no other graveyard-exile card. */
export function legacyCubeRemorsefulClericProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const refusals: string[] = [];
  const activation =
    "A:AB$ ChangeZoneAll | Cost$ Sac<1/CARDNAME> | ValidTgts$ Player | Origin$ Graveyard | ChangeType$ Card | IsCurse$ True | Destination$ Exile | SpellDescription$ Exile all cards from target player's graveyard.";
  const oracle =
    "Oracle:Flying\\nSacrifice Remorseful Cleric: Exile all cards from target player's graveyard.";
  const exactLines = [
    'Name:Remorseful Cleric',
    'ManaCost:1 W',
    'Types:Creature Spirit Cleric',
    'PT:2/1',
    'K:Flying',
    activation,
    oracle,
  ];

  if (!lines.includes('Name:Remorseful Cleric')) refusals.push('exact identity');
  if (!lines.includes('ManaCost:1 W')) refusals.push('exact mana cost');
  if (!lines.includes('Types:Creature Spirit Cleric')) refusals.push('exact creature type');
  if (!lines.includes('PT:2/1')) refusals.push('exact combat stats');
  if (!lines.includes('K:Flying')) refusals.push('exact flying keyword');
  if (!lines.includes(activation)) refusals.push('exact self-sacrifice target-graveyard-exile activation');
  if (!lines.includes(oracle)) refusals.push('exact installed Oracle text');
  const allowed = new Set(exactLines);
  if (lines.some((line) => !allowed.has(line))) refusals.push('additional mechanic');
  if (lines.length !== exactLines.length || lines.some((line, index) => line !== exactLines[index])) {
    refusals.push('exact script order and multiplicity');
  }
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for Coldsteel Heart and no other color-choice card. */
export function legacyCubeColdsteelHeartProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const entryReplacement =
    'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.';
  const entryEffect = 'SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True';
  const colorChoice =
    'SVar:ChooseColor:DB$ ChooseColor | Defined$ You | AILogic$ MostProminentInComputerDeck | SpellDescription$ As CARDNAME enters, choose a color.';
  const manaAbility =
    'A:AB$ Mana | Cost$ T | Produced$ Chosen | SpellDescription$ Add one mana of the chosen color.';
  const oracle =
    'Oracle:Coldsteel Heart enters tapped.\\nAs Coldsteel Heart enters, choose a color.\\n{T}: Add one mana of the chosen color.';
  const exactLines = [
    'Name:Coldsteel Heart',
    'ManaCost:2',
    'Types:Snow Artifact',
    entryReplacement,
    entryEffect,
    'K:ETBReplacement:Other:ChooseColor',
    colorChoice,
    manaAbility,
    oracle,
  ];
  const refusals: string[] = [];

  if (!lines.includes('Name:Coldsteel Heart')) refusals.push('exact identity');
  if (!lines.includes('ManaCost:2')) refusals.push('exact mana cost');
  if (!lines.includes('Types:Snow Artifact')) refusals.push('exact snow artifact type');
  if (!lines.includes(entryReplacement)) refusals.push('exact tapped-entry replacement');
  if (!lines.includes(entryEffect)) refusals.push('exact tapped-entry effect');
  if (!lines.includes('K:ETBReplacement:Other:ChooseColor')) {
    refusals.push('exact entry color-choice keyword');
  }
  if (!lines.includes(colorChoice)) refusals.push('exact single-color choice');
  if (!lines.includes(manaAbility)) refusals.push('exact chosen-color mana ability');
  if (!lines.includes(oracle)) refusals.push('exact installed Oracle text');
  const allowed = new Set(exactLines);
  if (lines.some((line) => !allowed.has(line))) refusals.push('additional mechanic');
  if (lines.length !== exactLines.length || lines.some((line, index) => line !== exactLines[index])) {
    refusals.push('exact script order and multiplicity');
  }
  return [...new Set(refusals)];
}

/** Closed whole-script boundary for Extinction Event and no other binary-choice card. */
export function legacyCubeExtinctionEventProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const choice =
    'A:SP$ ChooseEvenOdd | StackDescription$ SpellDescription | SubAbility$ DBExile | SpellDescription$ Choose odd or even. Exile each creature with mana value of the chosen quality. (Zero is even.)';
  const exile =
    'SVar:DBExile:DB$ ChangeZoneAll | ChangeType$ Creature.cmcChosenEvenOdd | Origin$ Battlefield | Destination$ Exile';
  const oracle =
    'Oracle:Choose odd or even. Exile each creature with mana value of the chosen quality. (Zero is even.)';
  const exactLines = ['Name:Extinction Event', 'ManaCost:3 B', 'Types:Sorcery', choice, exile, oracle];
  const refusals: string[] = [];

  if (!lines.includes('Name:Extinction Event')) refusals.push('exact identity');
  if (!lines.includes('ManaCost:3 B')) refusals.push('exact mana cost');
  if (!lines.includes('Types:Sorcery')) refusals.push('exact sorcery type');
  if (!lines.includes(choice)) refusals.push('exact odd-even choice');
  if (!lines.includes(exile)) {
    if (!lines.some((line) => line.includes('Creature.cmcChosenEvenOdd'))) {
      refusals.push('exact parity filter');
    }
    refusals.push('exact parity exile');
  }
  if (!lines.includes(oracle)) refusals.push('exact installed Oracle text');
  const allowed = new Set(exactLines);
  if (lines.some((line) => !allowed.has(line))) refusals.push('additional mechanic');
  if (lines.length !== exactLines.length || lines.some((line, index) => line !== exactLines[index])) {
    refusals.push('exact script order and multiplicity');
  }
  return [...new Set(refusals)];
}

/**
 * Closed whole-script boundary for the optional-trigger confirm cohort.
 *
 * The profile is one sentence: every trigger on the card is one the seat may
 * decline, and saying yes resolves an effect that asks nothing else. So the
 * script holds exactly one trigger, that trigger declares its optional decider
 * either on its own line or on the ability it executes, the executed ability is
 * one of the two reviewed closed effects, and the rest of the card is static
 * text. An activated ability, a replacement, a created object, a target, a
 * granted keyword nobody reviewed or a second `DB$` anywhere is a refusal,
 * because each of those is a further question and the profile answers one.
 */
export function legacyCubeOptionalTriggerConfirmProfileRefusals(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const refusals: string[] = [];
  const decisionFreeKeywords = new Set([
    'Flying',
    'Vigilance',
    'Trample',
    'Reach',
    'Menace',
    'Defender',
    'Lifelink',
    'Deathtouch',
    'Haste',
    'First Strike',
    'Double Strike',
    'Indestructible',
    'Hexproof',
    'Shroud',
  ]);

  const triggers = lines.filter((line) => line.startsWith('T:'));
  if (triggers.length !== 1) refusals.push('trigger count outside the confirm profile');
  if (lines.some((line) => line.startsWith('A:'))) refusals.push('activated ability');
  if (lines.some((line) => line.startsWith('R:'))) refusals.push('replacement effect');
  if (/\bTokenScript\$/u.test(script)) refusals.push('generated-object dependency');
  if (/\bValidTgts\$/u.test(script)) refusals.push('target choice');
  if (/\bProduced\$\s*(?:Any|Combo\b)/u.test(script)) refusals.push('independent mana-color choice');

  for (const line of lines.filter((candidate) => candidate.startsWith('K:'))) {
    if (!decisionFreeKeywords.has(line.slice('K:'.length))) refusals.push('additional keyword');
  }
  for (const granted of script.matchAll(/\bAddKeyword\$\s*([^|\n]+)/gu)) {
    if (!decisionFreeKeywords.has((granted[1] ?? '').trim())) {
      refusals.push('granted keyword outside the confirm profile');
    }
  }
  for (const line of lines.filter((candidate) => candidate.startsWith('S:'))) {
    const mode = /\bMode\$\s*([^\s|]+)/u.exec(line)?.[1];
    if (mode !== 'CantBlock' && mode !== 'Continuous') refusals.push('unreviewed static ability');
  }

  const storedValues = new Map<string, string>();
  for (const line of lines.filter((candidate) => candidate.startsWith('SVar:'))) {
    const rest = line.slice('SVar:'.length);
    const split = rest.indexOf(':');
    if (split <= 0) {
      refusals.push('malformed stored value');
      continue;
    }
    storedValues.set(rest.slice(0, split), rest.slice(split + 1));
  }

  const executedNames = new Set<string>();
  for (const trigger of triggers) {
    const executed = /\bExecute\$\s*([^\s|]+)/u.exec(trigger)?.[1];
    if (executed === undefined) {
      refusals.push('trigger with no executed ability');
      continue;
    }
    executedNames.add(executed);
    const body = storedValues.get(executed);
    if (body === undefined) {
      refusals.push('trigger executing an absent ability');
      continue;
    }
    const optional = /\bOptionalDecider\$\s*(?:You|TriggeredSourceController)\b/u;
    if (!optional.test(trigger) && !optional.test(body)) {
      refusals.push('mandatory or foreign-decider trigger');
    }
    const api = /\bDB\$\s*([^\s|]+)/u.exec(body)?.[1];
    if (api === 'Draw') {
      const count = /\bNumCards\$\s*([^\s|]+)/u.exec(body)?.[1];
      if (count !== undefined && !/^[12]$/u.test(count)) refusals.push('unreviewed draw count');
    } else if (api === 'ChangeZone') {
      if (!/\bOrigin\$\s*Graveyard\b/u.test(body) || !/\bDestination\$\s*Battlefield\b/u.test(body)) {
        refusals.push('unreviewed zone change');
      }
    } else {
      refusals.push('unreviewed trigger effect');
    }
    const subject = /\bDefined\$\s*([^\s|]+)/u.exec(body)?.[1];
    if (subject !== undefined && subject !== 'TriggeredSourceController') {
      refusals.push('unreviewed effect subject');
    }
    if (/\b(?:SubAbility|Choices|ChangeType|ChooseType|TgtPrompt|RememberChanged|AILogic)\$/u.test(body)) {
      refusals.push('additional choice surface');
    }
  }

  for (const [name, body] of storedValues) {
    if (/\bDB\$/u.test(body) && !executedNames.has(name)) refusals.push('ability body no trigger reaches');
  }
  const apis = [...script.matchAll(/\bDB\$\s*([^\s|]+)/gu)].map((match) => match[1]);
  if (apis.some((api) => api !== 'Draw' && api !== 'ChangeZone')) {
    refusals.push('unreviewed trigger effect');
  }
  return [...new Set(refusals)];
}

/**
 * Every reviewed decision token a bounded multi-selection card may carry.
 *
 * The list is affirmative rather than a filter: it names the sixteen `mapped`
 * inventory tokens that actually appear across the admitted positions, so a
 * seventeenth arriving from a re-ingest is refused instead of inherited.
 */
const LEGACY_CUBE_BOUNDED_MULTI_SELECTION_TOKENS: readonly string[] = [
  'ability-api:Animate',
  'ability-api:Charm',
  'ability-api:ChooseCard',
  'ability-api:Dig',
  'ability-api:Discard',
  'ability-api:Explore',
  'ability-api:RevealYouChoose',
  'ability-api:Sacrifice',
  'ability-api:TgtChoose',
  'keyword:Annihilator',
  'keyword:TypeCycling',
  'parameter-key:MayLookAt',
  'parameter-key:ValidTgts',
  'semantic-marker:card-enters-combat',
  'semantic-marker:priority-window',
  'semantic-marker:zone-card-choice',
];

/**
 * Every reviewed decision token a bounded enumerated choice may carry.
 *
 * `mtg-fp4l` phase 3 wires the choose-one callbacks themselves, so this list is
 * the phase-2 list plus the six tokens those callbacks answer: a protection
 * quality, a card type, a color, a vote, and the modal choice Forge routes
 * through the same ability list. Open card naming, an announced number, a
 * divided assignment and a partition into piles stay off it, because the bridge
 * throws on each rather than answering it.
 */
const LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_TOKENS: readonly string[] = [
  ...LEGACY_CUBE_BOUNDED_MULTI_SELECTION_TOKENS,
  'ability-api:ChooseColor',
  'ability-api:ChooseType',
  'ability-api:GenericChoice',
  'ability-api:Protection',
  'ability-api:Vote',
  'keyword:Protection',
];

/**
 * Every reviewed decision token an announced-number card may carry.
 *
 * Phase 4's own tokens are the ones a stated X reaches: the announcement
 * itself, and the effects whose whole variable part is that number.
 */
const LEGACY_CUBE_ANNOUNCED_NUMBER_TOKENS: readonly string[] = [
  ...LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_TOKENS,
  'semantic-marker:variable-payment',
];

/**
 * Exact extra surface reviewed for the first discard/sacrifice admission.
 *
 * This deliberately starts below `variable-payment`: Pack Rat and Hazoret use
 * a derived `SVar:X`, so the profile needs the announced-number boundary's
 * parsing rules. Fiend Artisan reaches the wider token list only after its
 * complete official script matches the reviewed bytes below.
 */
const LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_TOKENS: readonly string[] = [
  ...LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_TOKENS,
  'semantic-marker:discard-or-sacrifice-cost',
];

/**
 * Targeted abilities whose payment is still decision-free because Forge fixes
 * `Sac<1/CARDNAME>` to the ability source. The generic ordering boundary calls
 * every sacrifice on a target line a choice; these complete script hashes are
 * the closed exception for the three reviewed false positives.
 */
const LEGACY_CUBE_TARGETED_SOURCE_SACRIFICE_SCRIPT_SHA256 = new Set([
  '00a50337b5dfe3f18a11aacf5951911368d7d7b70cd61b1e09d0ddd674be94fc',
  '2dff55a3b2b01f31decb44a665727e73027535bf5501f948743c0ae43c6f9bdc',
  '60c558303c1fb015a6c72a4066f72a581d7a9ca1d05859da475a79f310993933',
]);

/** Fauna Shaman's creature-discard payment plus its exact singleton search. */
const LEGACY_CUBE_FAUNA_SHAMAN_SCRIPT_SHA256 =
  'c57a9db10911c3d509418992905d5bc2c4a7fa707aab30361a254c4f27e10271';

/** Complete scripts whose singleton creature sacrifice is selected by the seat. */
const LEGACY_CUBE_CHOSEN_CREATURE_SACRIFICE_SCRIPT_SHA256 = new Set([
  '2cb2e8e337d88496619ba1ceecf48cf97107e3924b6b0b7c9d49d22ed73d4315',
  'be4033f14f111f40de3dcf35e7bc99dabb0dfb5ac3c781f92d62162a334049d0',
  'b7c2c7d942c43109d453cb0b3cc066b2dc4a41fd2c3eeefd5c5b329cf85f270f',
]);

/**
 * Every reviewed decision token a stated-ordering card may carry.
 *
 * Phase 5's own four are the ones an order reaches: the two effects that split
 * the top of a library in two and state the order of the half that stays, and
 * the pair of parameters a hand-to-library move uses to ask for an order or to
 * say it has none.
 */
const LEGACY_CUBE_STATED_ORDERING_TOKENS: readonly string[] = [
  ...LEGACY_CUBE_ANNOUNCED_NUMBER_TOKENS,
  'ability-api:Scry',
  'ability-api:Surveil',
  'parameter-key:Reorder',
  'parameter-key:SkipReorder',
];

/**
 * Every reviewed decision token a stated-distribution card may carry.
 *
 * Phase 6 adds exactly one, the parameter that states the division. The effect
 * being divided is already on the list: an undivided `DealDamage` was admitted
 * in phase 2, and what phase 6 changes is who says how much of it goes where.
 */
const LEGACY_CUBE_STATED_DISTRIBUTION_TOKENS: readonly string[] = [
  ...LEGACY_CUBE_STATED_ORDERING_TOKENS,
  'parameter-key:DividedAsYouChoose',
];

/**
 * Every reviewed decision token a stated-retarget card may carry.
 *
 * Phase 7 adds exactly one, the API that moves a target. Its two parameters,
 * `TargetType` and `DefinedMagnet`, are not on the list and do not need to be:
 * they are what the boundary below requires on the retargeting line and refuses
 * anywhere else, so admitting them as free-standing tokens would say the
 * opposite of what the profile means.
 */
const LEGACY_CUBE_STATED_RETARGET_TOKENS: readonly string[] = [
  ...LEGACY_CUBE_STATED_DISTRIBUTION_TOKENS,
  'ability-api:ChangeTargets',
];

/**
 * Every reviewed decision token an open-card-naming card may carry.
 *
 * Phase 8 adds exactly one, the API that asks for a name. It chains from the
 * phase-5 list rather than the phase-7 one, and the two it leaves off are the
 * two whose shape is checked nowhere but in their own boundary:
 * `DividedAsYouChoose` is only safe where `legacyCubeStatedDistributionRefusals`
 * has required the division to be the whole of one damage effect, and
 * `ChangeTargets` only where `legacyCubeStatedRetargetRefusals` has required the
 * retarget to be bounded and to state where it goes. Carrying them here would
 * admit an unshaped division or an unshaped retarget on a naming card, which is
 * the opposite of what a closed boundary is for. A card that wants both enters
 * through a profile that reads both.
 */
const LEGACY_CUBE_OPEN_CARD_NAMING_TOKENS: readonly string[] = [
  ...LEGACY_CUBE_STATED_ORDERING_TOKENS,
  'ability-api:NameCard',
];

/**
 * Closed negative boundary for repeated bounded selection over a known list.
 *
 * The bridge answers a choose-many by running its wired choose-one loop with a
 * Done option, so the shape it can carry is exactly a selection from candidates
 * the engine already enumerated. Everything that turns such a selection into a
 * different question is refused here rather than inherited: a number the player
 * announces, a counter type they name, a constraint across the chosen set the
 * loop cannot enforce, a generated object whose own script was never pinned,
 * and the whole-game lifecycle event the observed protocol has no frame for.
 */
export function legacyCubeBoundedMultiSelectionRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  return boundedSelectionRefusals(bytes, inventory, LEGACY_CUBE_BOUNDED_MULTI_SELECTION_TOKENS, 'bounded');
}

/**
 * Closed negative boundary for a single choice out of a list Forge enumerated.
 *
 * Phase 3 of `mtg-fp4l`. The two boundaries are the same boundary read at
 * different widths -- a choose-many is the choose-one loop with a Done option,
 * so every shape the loop cannot carry is a shape one round of it cannot carry
 * either. What separates them is only which decision tokens the wired callbacks
 * answer, so they share one body and differ by one list.
 */
export function legacyCubeBoundedEnumeratedChoiceRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  return boundedSelectionRefusals(bytes, inventory, LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_TOKENS, 'bounded');
}

/**
 * Closed negative boundary for a card whose added surface is a number the seat
 * states.
 *
 * Phase 4 of `mtg-fp4l`. It is the phase-3 boundary read one question wider:
 * the same bounded selection, with the announced number the earlier profiles
 * refused now answered by the wired `announceRequirements` and `chooseNumber`
 * pair, and the payment profile swapped for the one that admits an X in the
 * printed cost. Everything else the choose-one loop cannot carry is refused
 * here exactly as it is there.
 */
export function legacyCubeAnnouncedNumberRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  return boundedSelectionRefusals(bytes, inventory, LEGACY_CUBE_ANNOUNCED_NUMBER_TOKENS, 'announced');
}

/**
 * Closed boundary for the first discard/sacrifice payment cohort.
 *
 * The only chosen discard spellings are one unrestricted card and Bomat
 * Courier's whole hand. A sacrifice is accepted here only when Forge fixes it
 * to the ability's own source, or when the entire script is the byte-pinned
 * Fiend Artisan shape with its exact one-other-creature cost. At least one such
 * cost must actually be present; this profile cannot become a second, looser
 * route for an ordinary card.
 */
export function legacyCubeDiscardOrSourceSacrificeCostRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const reviewedFiendArtisan = [
    'Name:Fiend Artisan',
    'ManaCost:BG BG',
    'Types:Creature Nightmare',
    'PT:1/1',
    'S:Mode$ Continuous | Affected$ Card.Self | AddPower$ Y | AddToughness$ Y | Description$ CARDNAME gets +1/+1 for each creature card in your graveyard.',
    'A:AB$ ChangeZone | Cost$ X BG T Sac<1/Creature.Other/another creature> | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcLEX | ChangeNum$ 1 | SorcerySpeed$ True | StackDescription$ SpellDescription | SpellDescription$ Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle. Activate only as a sorcery.',
    'SVar:Y:Count$ValidGraveyard Creature.YouOwn',
    'SVar:X:Count$xPaid',
    'SVar:NonCombatPriority:1',
    'DeckHints:Ability$Graveyard',
    'Oracle:Fiend Artisan gets +1/+1 for each creature card in your graveyard.\\n{X}{B/G}, {T}, Sacrifice another creature: Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle. Activate only as a sorcery.',
  ];
  const isReviewedFiendArtisan = JSON.stringify(lines) === JSON.stringify(reviewedFiendArtisan);
  const isReviewedTargetedSourceSacrifice = LEGACY_CUBE_TARGETED_SOURCE_SACRIFICE_SCRIPT_SHA256.has(
    sha256(bytes),
  );
  const isReviewedFaunaShaman = sha256(bytes) === LEGACY_CUBE_FAUNA_SHAMAN_SCRIPT_SHA256;
  const isReviewedChosenCreatureSacrifice = LEGACY_CUBE_CHOSEN_CREATURE_SACRIFICE_SCRIPT_SHA256.has(
    sha256(bytes),
  );
  const reviewedParts: string[] = [];
  for (const match of script.matchAll(/(?:^|\|)\s*Cost\$\s*([^|\n]+)/gu)) {
    for (const part of splitForgeCostParts((match[1] ?? '').trim())) {
      if (
        part === 'Discard<1/Card>' ||
        part === 'Discard<0/Hand>' ||
        (isReviewedFaunaShaman && part === 'Discard<1/Creature>') ||
        part === 'Sac<1/CARDNAME>' ||
        (isReviewedChosenCreatureSacrifice &&
          (part === 'Sac<1/Creature>' ||
            part === 'Sac<1/Creature.Green/green creature>' ||
            part === 'Sac<1/Creature.Green+Other/another green creature>')) ||
        (isReviewedFiendArtisan && part === 'Sac<1/Creature.Other/another creature>')
      ) {
        reviewedParts.push(part);
      }
    }
  }
  const refusals = [
    ...boundedSelectionRefusals(
      bytes,
      inventory,
      isReviewedFiendArtisan
        ? [...LEGACY_CUBE_ANNOUNCED_NUMBER_TOKENS, 'semantic-marker:discard-or-sacrifice-cost']
        : isReviewedFaunaShaman
          ? [...LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_TOKENS, 'parameter-key:DiscardCost']
          : isReviewedChosenCreatureSacrifice
            ? [...LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_TOKENS, 'parameter-key:SacCost']
            : LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_TOKENS,
      'announced',
    ).filter((refusal) => !(isReviewedTargetedSourceSacrifice && refusal === 'choice cost')),
    ...legacyCubeChosenCostPaymentRefusals(bytes, {
      allowReviewedDiscardCostParts: true,
      allowReviewedCreatureDiscardCostPart: isReviewedFaunaShaman,
      allowReviewedCreatureSacrificeCostParts: isReviewedChosenCreatureSacrifice,
      allowReviewedOtherCreatureSacrificeCostPart: isReviewedFiendArtisan,
    }),
  ];
  if (script.includes('Sac<1/Creature.Other/another creature>') && !isReviewedFiendArtisan) {
    refusals.push('exact reviewed Fiend Artisan script');
  }
  if (reviewedParts.length === 0) refusals.push('missing reviewed discard or sacrifice cost');
  return [...new Set(refusals)];
}

/**
 * Closed negative boundary for a card whose added surface is an order the seat
 * states.
 *
 * Phase 5 of `mtg-fp4l`. It is the phase-4 boundary read one question wider
 * again, and it keeps the announced arm of the payment check rather than the
 * ordinary one: The Scarab God scries for an X counted off the board, so a
 * profile that refused a stated number would refuse the card for a reason that
 * has nothing to do with the order it is being admitted for. Everything the
 * choose-one loop cannot carry is refused here exactly as it is there.
 */
export function legacyCubeStatedOrderingRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  return boundedSelectionRefusals(bytes, inventory, LEGACY_CUBE_STATED_ORDERING_TOKENS, 'announced');
}

/**
 * The four refusals the distribution boundary lifts, and re-requires by shape.
 *
 * Each is a true statement about a divided ability rather than a shape the
 * bridge cannot carry: a division is reached from a trigger, offers more than
 * one target, states a minimum of zero because a board with nothing legal on it
 * divides nothing, and is divided. Lifting them by name is only sound because
 * every one is then required to occur on the divided line and nowhere else,
 * which is what `undivided target` checks.
 */
const LEGACY_CUBE_STATED_DISTRIBUTION_LIFTED_REFUSALS: ReadonlySet<string> = new Set([
  'trigger target',
  'optional target',
  'multiple targets',
  'divided targets',
]);

/**
 * Closed negative boundary for a card whose added surface is an amount the seat
 * divides among the targets it picks.
 *
 * Phase 6 of `mtg-fp4l`. Forge asks a division through `chooseTargetsFor` and
 * answers none of it itself -- the human path reads `getStillToDivide()` and
 * writes the allocation directly, reaching no controller callback -- so the
 * inherited answer is the AI's, and the bridge now runs the division as
 * repeated assign-one over the candidates still legal to receive a point.
 *
 * The boundary is the phase-5 one with the four refusals above lifted and then
 * re-required by shape: exactly one target line, that line divides, and the
 * whole of what it deals is what it divides. It stays a damage division because
 * that is what was reviewed; a divided counter or a divided pump is a different
 * effect and enters through its own reading, not through this one.
 */
export function legacyCubeStatedDistributionRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals = boundedSelectionRefusals(
    bytes,
    inventory,
    LEGACY_CUBE_STATED_DISTRIBUTION_TOKENS,
    'announced',
  ).filter((refusal) => !LEGACY_CUBE_STATED_DISTRIBUTION_LIFTED_REFUSALS.has(refusal));

  const targetLines = lines.filter((line) => /\bValidTgts\$/u.test(line));
  const dividedLines = targetLines.filter((line) => /\bDividedAsYouChoose\$/u.test(line));
  if (dividedLines.length === 0) refusals.push('missing stated distribution');
  if (dividedLines.length > 1) refusals.push('second stated distribution');
  if (targetLines.some((line) => !dividedLines.includes(line))) refusals.push('undivided target');

  for (const line of dividedLines) {
    // A division nobody has to make, and a division somebody else makes, are
    // both outside the shape: the bridge divides the whole amount and offers no
    // stop, because a divided ability with a legal target divides all of it.
    if (/\b(?:MayChooseTarget\$\s*True|Mandatory\$\s*False)\b/iu.test(line)) {
      refusals.push('optional distribution');
    }
    if (/\bTargetingPlayer\$/u.test(line)) refusals.push('delegated distribution');
    if (/\bRandomTarget\$/iu.test(line)) refusals.push('random distribution');
    // `getStillToDivide()` is the whole of what the bridge hands out, so an
    // ability that deals one number and divides another would divide the wrong
    // one silently.
    const divided = line.match(/\bDividedAsYouChoose\$\s*([^\s|]+)/u)?.[1];
    const dealt = /\bDB\$\s*DealDamage\b|\bSP\$\s*DealDamage\b|\bAB\$\s*DealDamage\b/u.test(line)
      ? line.match(/\bNumDmg\$\s*([^\s|]+)/u)?.[1]
      : undefined;
    if (divided === undefined || dealt === undefined || dealt !== divided) {
      refusals.push('distribution over an unstated amount');
    }
  }
  return [...new Set(refusals)];
}

/**
 * The one refusal the retarget boundary lifts, and re-requires by shape.
 *
 * `retarget ability` is a true statement about Spellskite and it covers two
 * things at once: the `ChangeTargets` line itself, and the two parameters that
 * line carries. Lifting it by name is only sound because both halves are then
 * required to occur on that one line and nowhere else, which is what
 * `retarget parameter off the retarget line` checks.
 */
const LEGACY_CUBE_STATED_RETARGET_LIFTED_REFUSALS: ReadonlySet<string> = new Set(['retarget ability']);

/**
 * Closed negative boundary for a card whose added surface is a target it takes
 * off a spell or ability already on the stack.
 *
 * Phase 7 of `mtg-fp4l`. Forge asks the question through `chooseTarget`, whose
 * inherited answer is the AI picking which of the stack object's targets moves,
 * and the free form of the same decision through `chooseNewTargetsFor`, which
 * hands over a filter and asks the seat to build a whole `TargetChoices`. The
 * bridge wires the first and throws on the second, so what this profile admits
 * is the bounded shape only: `ChangeSingleTarget` makes it one target out of
 * the ones that stack object already has, and `DefinedMagnet` names where it
 * goes, which is not a decision at all.
 *
 * The boundary is the phase-6 token list with the retarget refusal lifted and
 * re-required by shape: exactly one retargeting line, that line is bounded,
 * states its new target and states which stack objects it may reach, delegates
 * to nobody, asks no confirm first, and is not a trigger; and no other line on
 * the card carries either retarget parameter.
 */
export function legacyCubeStatedRetargetRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals = boundedSelectionRefusals(
    bytes,
    inventory,
    LEGACY_CUBE_STATED_RETARGET_TOKENS,
    'announced',
  ).filter((refusal) => !LEGACY_CUBE_STATED_RETARGET_LIFTED_REFUSALS.has(refusal));

  const retargetLines = lines.filter((line) => /\b(?:AB|SP|DB)\$\s*ChangeTargets\b/u.test(line));
  if (retargetLines.length === 0) refusals.push('missing stated retarget');
  if (retargetLines.length > 1) refusals.push('second stated retarget');
  for (const line of retargetLines) {
    // Without it Forge changes every target the stack object has, which is a
    // different question and one the wired callback is never asked.
    if (!/\bChangeSingleTarget\$\s*True\b/u.test(line)) refusals.push('unbounded retarget');
    if (!/\bDefinedMagnet\$/u.test(line)) refusals.push('retarget to an unstated target');
    if (!/\bTargetType\$/u.test(line)) refusals.push('retarget over unstated stack objects');
    if (/\bChooser\$/u.test(line)) refusals.push('delegated retarget');
    if (/\bOptional\$/iu.test(line)) refusals.push('optional retarget');
    if (line.startsWith('T:')) refusals.push('triggered retarget');
  }
  for (const line of lines) {
    if (retargetLines.includes(line)) continue;
    if (/\b(?:TargetType|DefinedMagnet)\$/u.test(line)) {
      refusals.push('retarget parameter off the retarget line');
    }
  }
  return [...new Set(refusals)];
}

/**
 * Closed negative boundary for a card whose added surface is a name the seat
 * states out of every card ever printed.
 *
 * Phase 8 of `mtg-fp4l`. Forge asks the open form of the question through
 * `chooseCardName(SpellAbility, Predicate, String, String)`, handing over a
 * predicate over card faces and no list at all, and the enumerated form through
 * `chooseCardName(SpellAbility, List, String)`, handing over the names it will
 * accept. The bridge wires the first as a text box, measuring the box against
 * the longest name the predicate admits, and the second as an ordinary
 * enumerated choice, which is a different decision on the wire and belongs to
 * the profile that was probed against options rather than against text. So this
 * boundary admits the open shape only, and a card that names out of a list
 * enters through `legacyCubeBoundedEnumeratedChoiceRefusals` instead.
 *
 * The boundary is the phase-5 token list with the naming API added and the
 * naming line then required by shape: exactly one naming line, that line names
 * the player who answers, does not pick at random, and does not enumerate its
 * answers; and no other line on the card carries either enumeration parameter.
 * `AtRandom` is refused rather than admitted even though it reaches no
 * controller callback at all, because a name the engine draws is not the
 * decision this profile's runtime probe observed.
 */
export function legacyCubeOpenCardNamingRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals = [
    ...boundedSelectionRefusals(bytes, inventory, LEGACY_CUBE_OPEN_CARD_NAMING_TOKENS, 'announced'),
  ];

  const namingLines = lines.filter((line) => /\b(?:AB|SP|DB)\$\s*NameCard\b/u.test(line));
  if (namingLines.length === 0) refusals.push('missing open card naming');
  if (namingLines.length > 1) refusals.push('second open card naming');
  for (const line of namingLines) {
    if (!/\bDefined\$/u.test(line)) refusals.push('card naming by an unstated player');
    if (/\bAtRandom\$/u.test(line)) refusals.push('random card naming');
    if (/\b(?:ChooseFromDefinedCards|ChooseFromList)\$/u.test(line)) {
      refusals.push('card naming from a stated list');
    }
  }
  for (const line of lines) {
    if (namingLines.includes(line)) continue;
    if (/\b(?:ChooseFromDefinedCards|ChooseFromList)\$/u.test(line)) {
      refusals.push('naming parameter off the naming line');
    }
  }
  return [...new Set(refusals)];
}

function boundedSelectionRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
  reviewedTokens: readonly string[],
  profile: 'bounded' | 'announced',
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const refusals = [
    ...(profile === 'announced'
      ? legacyCubeAnnouncedManaPaymentRefusals(bytes)
      : legacyCubeOrdinaryManaPaymentRefusals(bytes)),
    ...legacyCubeOrdinaryCombatSingleTargetRefusals(bytes),
  ];

  if (/\b(?:AB|SP|DB)\$\s*RestartGame\b/mu.test(script)) refusals.push('game-restart lifecycle');
  if (/\bDifferentNames\$/mu.test(script)) refusals.push('distinct-name selection constraint');
  if (/\bCanRepeatModes\$\s*True/iu.test(script)) refusals.push('repeatable mode selection');
  if (/\bTokenScript\$/mu.test(script)) refusals.push('unpinned generated-object source');
  if (profile !== 'announced' && /^SVar:X:/mu.test(script)) refusals.push('announced number');

  for (const match of script.matchAll(/\bCounterType\$\s*([^|\n]+)/gu)) {
    const chosen = (match[1] ?? '').trim();
    if (chosen.includes(',') || /^(?:Any|AnyType|Chosen)$/u.test(chosen)) {
      refusals.push('counter-type choice');
    }
  }

  for (const line of lines) {
    if (!/\bUpTo\$\s*True/u.test(line)) continue;
    const bound = Number(line.match(/\b(?:CounterNum|ChangeNum|NumCards|Amount)\$\s*(\d+)/u)?.[1] ?? '1');
    if (bound > 1) refusals.push('bounded number choice');
  }

  // `legacyCubeOrdinaryCombatSingleTargetRefusals` reads `Execute$` off `T:`
  // lines only, so a delayed trigger installed by an Effect carries its target
  // past that boundary. The admitted positions are the ones where it does not.
  const executed = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(/\bExecute\$\s*([^\s|]+)/gu)) {
      if (match[1] !== undefined) executed.add(match[1]);
    }
  }
  for (const line of lines) {
    const named = line.match(/^SVar:([^:]+):/u)?.[1];
    if (named !== undefined && executed.has(named) && /\bValidTgts\$/u.test(line)) {
      refusals.push('trigger target');
    }
  }

  for (const { kind, token } of inventoryLegacyCubeForgeScript(bytes)) {
    if (reviewedLegacyCubeSyntaxToken(inventory, kind, token).disposition !== 'mapped') continue;
    const key = `${kind}:${token}`;
    if (!reviewedTokens.includes(key)) {
      refusals.push(`unbounded decision token ${key}`);
    }
  }
  return [...new Set(refusals)];
}

/**
 * The reviewed formerly-blocked token-root cohort, composed with the broadest
 * reviewed top-level profile. Exact dependency bytes are checked by the
 * resolver below; this boundary decides only whether the root is one of those
 * reviewed graphs and preserves every independent top-level refusal.
 */
export function legacyCubePinnedGeneratedObjectRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const roots = generatedTokenScriptNames(bytes);
  const pinned = new Set<string>(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.exactTokenScripts.map((row) => row.name));
  const refusals = legacyCubeStatedOrderingRefusals(bytes, inventory).filter(
    (reason) =>
      reason !== 'unpinned generated-object source' &&
      reason !== 'transitive generated-object decision source' &&
      reason !== 'unbounded decision token ability-api:Token',
  );
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (
    /\bSP\$\s*Charm\b/mu.test(script) &&
    /\bTokenScript\$/mu.test(script) &&
    /\bValidTgts\$/mu.test(script)
  ) {
    refusals.push('modal generated-object target composition');
  }
  if (roots.length === 0) refusals.push('missing generated-object source');
  for (const root of roots) {
    if (!pinned.has(root)) refusals.push(`unreviewed generated-object source ${root}`);
  }
  return [...new Set(refusals)];
}

/**
 * Resolves and classifies the complete generated token-script closure. The
 * loader deliberately returns bytes rather than accepting a path so tests and
 * callers can keep filesystem policy outside the evidence primitive.
 */
export function resolveLegacyCubeGeneratedScriptDependencies(
  rootBytes: Uint8Array,
  loadTokenScript: (name: string) => Uint8Array | undefined,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly LegacyCubeGeneratedScriptDependency[] {
  const resolved = new Map<string, LegacyCubeGeneratedScriptDependency>();
  const visiting = new Set<string>();

  const visit = (name: string): void => {
    if (resolved.has(name)) return;
    if (visiting.has(name)) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `generated token script dependency cycle at ${name}`,
      );
    }
    const bytes = loadTokenScript(name);
    if (bytes === undefined) {
      throw new InvalidInputError('Legacy Cube decision ledger', `missing generated token script ${name}`);
    }
    visiting.add(name);
    const dependencies = generatedTokenScriptNames(bytes);
    for (const dependency of dependencies) visit(dependency);
    const classification = classifyLegacyCubeForgeScript(bytes, inventory);
    resolved.set(name, {
      kind: 'token-script',
      name,
      file: `${name}.txt`,
      sha256: sha256(bytes),
      families: [...classification.families],
      evidenceMarkers: [...classification.evidenceMarkers],
      unknownDecisionSyntax: [...classification.unknownDecisionSyntax],
      dependencies: [...dependencies],
    });
    visiting.delete(name);
  };

  for (const name of generatedTokenScriptNames(rootBytes)) visit(name);
  return [...resolved.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Verifies exact bytes, classification, and closure for one generated graph. */
export function verifyLegacyCubeGeneratedScriptDependencies(
  entry: LegacyCubeDecisionEntry,
  rootBytes: Uint8Array,
  supplied: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): void {
  const expectedNames = entry.generatedScriptDependencies.map((dependency) => dependency.name);
  const suppliedNames = supplied.map((dependency) => dependency.name);
  assertUnique(suppliedNames, `generated token script supplied for ${entry.correctedName}`);
  const unexpected = suppliedNames.find((name) => !expectedNames.includes(name));
  if (unexpected !== undefined) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `unexpected generated token script ${unexpected} for ${entry.correctedName}`,
    );
  }
  const bytesByName = new Map(supplied.map((dependency) => [dependency.name, dependency.bytes]));
  const actual = resolveLegacyCubeGeneratedScriptDependencies(
    rootBytes,
    (name) => bytesByName.get(name),
    inventory,
  );
  for (const dependency of actual) {
    const expected = entry.generatedScriptDependencies.find(
      (candidate) => candidate.name === dependency.name,
    );
    if (expected !== undefined && expected.sha256 !== dependency.sha256) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `generated token script checksum drift for ${dependency.name}: expected ${expected.sha256}, got ${dependency.sha256}`,
      );
    }
  }
  if (JSON.stringify(actual) !== JSON.stringify(entry.generatedScriptDependencies)) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `generated token dependency graph drift for ${entry.correctedName}`,
    );
  }
}

type DecisionSyntaxKind = LegacyCubeDecisionSyntaxToken['kind'];

const ABILITY_FIELDS = new Set(['SP', 'AB', 'DB', 'Mode', 'ReplacementEffect']);

/** Enumerates the closed Forge grammar surface reviewed by this artifact. */
export function inventoryLegacyCubeForgeScript(bytes: Uint8Array): readonly {
  readonly kind: DecisionSyntaxKind;
  readonly token: string;
}[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const found = new Map<string, { readonly kind: DecisionSyntaxKind; readonly token: string }>();
  let unresolvedChangeZoneProduct = false;
  const triggeredAbilityNames = new Set<string>();
  const costedAbilityNames = new Set<string>();
  const add = (kind: DecisionSyntaxKind, token: string): void => {
    if (token.length > 0) found.set(`${kind}\0${token}`, { kind, token });
  };
  for (const rawLine of script.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 1) {
      add('line-kind', line);
      continue;
    }
    const lineKind = line.slice(0, colon);
    add('line-kind', lineKind);
    if (lineKind === 'K')
      add(
        'keyword',
        line
          .slice(colon + 1)
          .split(/[|:]/, 1)[0]
          ?.trim() ?? '',
      );
    const afterKind = line.slice(colon + 1);
    const svarSeparator = lineKind === 'SVar' ? afterKind.indexOf(':') : -1;
    const svarName = svarSeparator > 0 ? afterKind.slice(0, svarSeparator).trim() : null;
    const body = lineKind === 'SVar' && svarSeparator > 0 ? afterKind.slice(svarSeparator + 1) : afterKind;
    if (lineKind === 'T') {
      for (const match of body.matchAll(/(?:^|\|)\s*Execute\$\s*([^\s|]+)/gu)) {
        if (match[1] !== undefined) triggeredAbilityNames.add(match[1]);
      }
    }
    if (svarName !== null) {
      const cost = body
        .split('|')
        .map((part) =>
          part
            .trim()
            .match(/^Cost\$\s*(.+)$/u)?.[1]
            ?.trim(),
        )
        .find((value) => value !== undefined);
      if (cost !== undefined && cost !== '0') costedAbilityNames.add(svarName);
    }
    if (
      /(?:^|\|)\s*(?:SP|AB|DB|ReplacementEffect)\$\s*ChangeZone\b/u.test(body) &&
      !/(?:^|\|)\s*Defined\$/u.test(body) &&
      (!/(?:^|\|)\s*ValidTgts\$/u.test(body) ||
        /(?:^|\|)\s*ValidTgts\$\s*(?:Player|Opponent)\s*(?:\||$)/u.test(body)) &&
      /(?:^|\|)\s*(?:ChangeType|ChangeNum|Chooser|SelectPrompt|Hidden)\$/u.test(body)
    ) {
      unresolvedChangeZoneProduct = true;
    }
    for (const part of body.split('|')) {
      const field = part.trim().match(/^([^$]+)\$\s*(.*)$/);
      if (field?.[1] === undefined || field[2] === undefined) continue;
      const key = field[1].trim();
      add('parameter-key', key);
      if (ABILITY_FIELDS.has(key)) add('ability-api', field[2].trim().split(/\s/, 1)[0] ?? '');
    }
  }
  add('semantic-marker', 'priority-window');
  if (
    /^Types:[^\n]*\bCreature\b/m.test(script) ||
    /^K:Crew\b/m.test(script) ||
    /\bTokenScript\$|\b(?:SP|AB|DB)\$\s*(?:Token|Animate|AnimateAll)\b/m.test(script)
  ) {
    add('semantic-marker', 'card-enters-combat');
  }
  if (
    /^ManaCost:[^\n]*(?:\bX\b|\b[WUBRGC]P\b)/m.test(script) ||
    /\bCost\$[^|\n]*\bX\b|Count\$xPaid|PayX|XChoice|\bProduced\$\s*Any\b/m.test(script)
  ) {
    add('semantic-marker', 'variable-payment');
  }
  if (/\bCost\$[^|\n]*(?:Discard|Sac<)/m.test(script)) {
    add('semantic-marker', 'discard-or-sacrifice-cost');
  }
  if (/\bOptional\$\s*True|\bMandatory\$\s*False|\bMayChooseTarget\$\s*True/m.test(script)) {
    add('semantic-marker', 'optional-trigger-or-replacement');
  }
  if (/^K:ETBReplacement:[^\r\n]*:Optional(?:[:|]|$)/mu.test(script)) {
    add('semantic-marker', 'optional-copy-replacement');
  }
  if ([...triggeredAbilityNames].some((name) => costedAbilityNames.has(name))) {
    add('semantic-marker', 'triggered-payment');
  }
  if (/\bChoices\$\s*(?:Color|Type|Number)\b|^K:Protection:Choice\b/m.test(script)) {
    add('semantic-marker', 'typed-or-valued-choice');
  }
  if (/^AlternateMode:/m.test(script)) add('semantic-marker', 'alternate-mode');
  if (unresolvedChangeZoneProduct) add('semantic-marker', 'zone-card-choice');
  return [...found.values()].sort((left, right) =>
    left.kind === right.kind ? left.token.localeCompare(right.token) : left.kind.localeCompare(right.kind),
  );
}

/** Looks up one token in an affirmative closed review; absence is never non-choice. */
export function reviewedLegacyCubeSyntaxToken(
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
  kind: DecisionSyntaxKind,
  token: string,
): LegacyCubeDecisionSyntaxToken {
  const row = inventory.find((candidate) => candidate.kind === kind && candidate.token === token);
  if (row === undefined) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `unknown Forge decision syntax ${kind} ${JSON.stringify(token)}`,
    );
  }
  return row;
}

/** Refuses any syntax token outside the reviewed artifact inventory. */
export function verifyLegacyCubeDecisionSyntax(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): void {
  for (const token of inventoryLegacyCubeForgeScript(bytes)) {
    reviewedLegacyCubeSyntaxToken(inventory, token.kind, token.token);
  }
}

/** Stable public abstract callback signatures from `javap -public`. */
export function forgePlayerControllerAbstractCallbacks(bytes: Uint8Array): readonly string[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('public abstract ') && line.includes('('))
    .map((line) => line.replace(/;$/, ''));
}

function callbackName(signature: string): string {
  const match = signature.match(/\s([A-Za-z0-9]+)\([^()]*\)$/);
  if (match?.[1] === undefined) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `unreadable controller callback: ${signature}`,
    );
  }
  return match[1];
}

const OUTSIDE_SESSION_CALLBACKS =
  /^(?:sideboard|chooseCardsYouWonToAddToDeck|chooseContraptionsToCrank|chooseSprocket|choosePDRollToIgnore|chooseRollToIgnore|chooseDiceToReroll|chooseRollToModify|chooseRollToSwap|chooseRollSwapValue|revealAnte|revealAISkipCards|revealUnsupported)$/;
const NON_DECISION_CALLBACKS =
  /^(?:playSpellAbilityNoStack|reveal|notifyOfValue|autoPassCancel|awaitNextInput|cancelAwaitNextInput)$/;
const WIRE_OWNED_CALLBACKS = new Set([
  'chooseSpellAbilityToPlay',
  'chooseStartingPlayer',
  'chooseSingleCardForZoneChange',
  'chooseTargetsFor',
  'mulliganKeepHand',
  'playChosenSpellAbility',
  'tuckCardsViaMulligan',
  'assignCombatDamage',
  'declareAttackers',
  'declareBlockers',
  'enlistAttackers',
  'exertAttackers',
  'orderAttackers',
  'orderBlocker',
  'orderBlockers',
  'payManaCost',
  'payCostToPreventEffect',
  'applyManaToCost',
  'orderAndPlaySimultaneousSa',
  'payCombatCost',
  'chooseCardsToDiscardFrom',
  'chooseColors',
  'chooseBinary',
  // `mtg-fp4l` phase 1: every yes-or-no Forge asks, plus the two orderings whose
  // answer is a single pick. Owned means the bridge answers it, not that a person
  // is asked -- the last four throw, because a bid, a die roll and the two halves
  // of Assist belong to formats this session is not.
  'confirmAction',
  'confirmTrigger',
  'confirmReplacementEffect',
  'confirmStaticApplication',
  'confirmPayment',
  'willPutCardOnTop',
  'chooseFlipResult',
  'chooseCardsPile',
  'playTrigger',
  'chooseSingleReplacementEffect',
  'chooseSingleStaticAbility',
  'confirmBidAction',
  'payCostDuringRoll',
  'helpPayForAssistSpell',
  'choosePlayerToAssistPayment',
  // `mtg-fp4l` phase 2: every selection Forge takes from a list it has already
  // enumerated, plus the one modal choice. All seventeen route to the same
  // wired choose-one loop with a Done option, so none of them is left for the
  // inherited AI to answer for the seat.
  'choosePermanentsToSacrifice',
  'choosePermanentsToDestroy',
  'chooseCardsForEffect',
  'chooseCardsForEffectMultiple',
  'chooseSingleEntityForEffect',
  'chooseEntitiesForEffect',
  'chooseSpellAbilitiesForEffect',
  'chooseSingleSpellForEffect',
  'chooseCardsToDiscardUnlessType',
  'chooseCardsToDiscardToMaximumHandSize',
  'chooseCardsToDelve',
  'chooseCardsForSplice',
  'chooseCardsToRevealFromHand',
  'chooseModeForAbility',
  'chooseCardsForCost',
  'chooseCardsForZoneChange',
  'chooseCardsForConvokeOrImprovise',
  // `mtg-fp4l` phase 3: every choice Forge takes out of a list its own card
  // script wrote -- a color, a card type, a protection quality, a counter type,
  // a card face, a keyword, a sector, a card state, an optional cost, a mana
  // shard, an ability to play, and a vote. `chooseCardName` and
  // `chooseSingleCardFace` each carry a second arm phase 3 did not answer with a
  // list, because Forge hands them a predicate over every card ever printed and
  // no list at all; phase 8 wires that arm as a text box the seat types a name
  // into. A number with more than one stop still throws here rather than asking,
  // and belongs to the number phase; it is owned all the same, because owning
  // means the AI does not answer for the seat, and a refusal anybody can see is
  // not a silent answer.
  'chooseColor',
  'chooseColorAllowColorless',
  'chooseSomeType',
  'chooseSector',
  'chooseProtectionType',
  'chooseKeywordForPump',
  'chooseCounterType',
  'chooseSingleCardState',
  'chooseSingleCardFace',
  'chooseCardName',
  'chooseOptionalCosts',
  'chooseNumber',
  'chooseManaFromPool',
  'vote',
  'getAbilityToPlay',
  'playSaFromPlayEffect',
  // `mtg-fp4l` phase 4: every number the caster announces rather than picks off
  // a list -- the X in a cost, the count a cost reduction or a keyword cost
  // asks for -- and the two seams a stated number then pays through. The mana
  // combo throws, because making two mana of different colors at once is a
  // choice the session has no way to put to the seat yet; the cost decision
  // maker answers only the parts with exactly one legal payment and throws on
  // the rest. Both are owned for the same reason phase 3's two throwers are: a
  // refusal anybody can see is not the AI quietly answering for the seat.
  'announceRequirements',
  'chooseNumberForCostReduction',
  'chooseNumberForKeywordCost',
  'specifyManaCombo',
  'getCostDecisionMaker',
  // `mtg-fp4l` phase 5: every order the seat states rather than has stated for
  // it. The four card orderings are one loop -- ask which element goes next,
  // until one is left -- and `orderMoveToZoneList` reads Forge's own two guards
  // before it asks, because both need something a session cannot see: whether
  // the destination puts the last element on top, and whether anything in this
  // game can see a graveyard's order. `orderSimultaneousSa` is reachable from
  // no caller this seat leaves in place and is wired anyway, because an
  // abstract callback left inherited is `PlayerControllerAi` holding the order
  // triggers resolve in against the day one appears.
  'orderSimultaneousSa',
  'arrangeForScry',
  'arrangeForSurveil',
  'orderMoveToZoneList',
  'orderCosts',
  // `mtg-fp4l` phase 6: the amount the seat divides. The division itself is
  // asked through `chooseTargetsFor`, which was already owned -- Forge's human
  // path reads `getStillToDivide()` and writes the allocation itself, reaching
  // no controller callback -- so what is added here is the one callback that
  // asks a division nothing in this cube reaches. `divideShield` is wired for
  // the reason `orderSimultaneousSa` was: `PlayerControllerAi` answers it with
  // an empty map, which throws the whole shield away without saying so, and an
  // inherited callback is a silent wrong answer given to the player.
  'divideShield',
  // `mtg-fp4l` phase 7: the two retargeting callbacks. `chooseTarget` is the
  // stated form -- a `ChangeTargets` naming which of a spell's targets moves --
  // and it routes to the session. `chooseNewTargetsFor` is the free form, where
  // Forge hands over a whole target block to rebuild, and it throws: it is owned
  // for the reason phase 3's throwers are, because a refusal anybody can see is
  // not the AI quietly retargeting somebody's spell for them.
  'chooseTarget',
  'chooseNewTargetsFor',
  // `mtg-n76vw`: the opening-hand actions the seat takes (New Phyrexia's
  // Chancellors). The bridge override routes the callback to
  // `session.chooseOpeningHandActions`, and New Phyrexia's `pregame-actions-v1`
  // contract pins that override. Before it, the AI answered for the seat.
  'chooseSaToActivateFromOpeningHand',
]);

/** Exact Forge callbacks owned by the backend-neutral wire at the reviewed bridge revision. */
export function forgeBridgeControllerOwnership(signature: string): 'wire' | 'inherited-ai' | 'not-reached' {
  const name = callbackName(signature);
  if (WIRE_OWNED_CALLBACKS.has(name)) return 'wire';
  return OUTSIDE_SESSION_CALLBACKS.test(name) ? 'not-reached' : 'inherited-ai';
}

export function classifyForgeControllerCallback(signature: string): {
  readonly disposition: 'decision' | 'non-decision' | 'outside-legacy-cube-session';
  readonly families: readonly LegacyCubeDecisionFamily[];
} {
  const name = callbackName(signature);
  if (OUTSIDE_SESSION_CALLBACKS.test(name)) {
    return { disposition: 'outside-legacy-cube-session', families: [] };
  }
  if (NON_DECISION_CALLBACKS.test(name)) return { disposition: 'non-decision', families: [] };
  const families = new Set<LegacyCubeDecisionFamily>();
  if (/AbilityToPlay|playSaFromPlayEffect|playChosenSpellAbility/.test(name)) families.add('priority');
  if (/Target/.test(name)) families.add('targets');
  if (/Mode/.test(name)) families.add('modes');
  if (/OptionalCost|KeywordCost|addKeywordCost|confirmPayment|payCost|orderCosts/.test(name)) {
    families.add('optional-costs');
  }
  if (/Mana|announceRequirements|CostReduction|getCostDecisionMaker|helpPay|AssistPayment/.test(name)) {
    families.add('mana-x');
  }
  if (/divideShield|confirmBidAction/.test(name)) families.add('naming-text-numbers');
  if (
    /choose(?:Cards|SingleEntity|Entities|Permanents|SpellAbilitiesForEffect|SingleSpellForEffect)|Discard|Delve|Convoke|Splice|ZoneChange/.test(
      name,
    )
  ) {
    families.add('zone-card-selection');
  }
  if (/^order|arrangeFor|willPutCardOnTop/.test(name)) families.add('ordering');
  if (/Combat|Attack|Block|exert|enlist/.test(name)) families.add('combat');
  if (/Trigger|Replacement|StaticApplication|SingleStaticAbility|confirmAction/.test(name)) {
    families.add('replacement-trigger-choices');
  }
  if (
    /choose(?:SomeType|Sector|Number|Binary|FlipResult|Color|Colors|SingleCardFace|SingleCardState|CounterType|KeywordForPump|ProtectionType|CardName)/.test(
      name,
    )
  ) {
    families.add('naming-text-numbers');
  }
  if (/Pile|vote/.test(name)) families.add('piles-votes');
  if (/[Mm]ulligan|StartingHand/.test(name)) families.add('mulligan');
  if (name === 'chooseStartingPlayer') families.add('starting-player');
  if (name === 'chooseSaToActivateFromOpeningHand') families.add('pregame-actions');
  if (families.size === 0) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `unmapped abstract PlayerController callback ${name}`,
    );
  }
  return {
    disposition: 'decision',
    families: LEGACY_CUBE_DECISION_FAMILIES.filter((family) => families.has(family)),
  };
}

/** Checks the installed 2.0.14 controller ABI against the closed callback attestation. */
export function verifyForgePlayerControllerSurface(
  ledger: LegacyCubeDecisionLedger,
  javapBytes: Uint8Array,
): void {
  const actualHash = sha256(javapBytes);
  if (actualHash !== ledger.controllerSurface.sha256) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `PlayerController javap checksum drift: expected ${ledger.controllerSurface.sha256}, got ${actualHash}`,
    );
  }
  const actual = forgePlayerControllerAbstractCallbacks(javapBytes);
  const pinned = ledger.controllerSurface.abstractCallbacks.map((row) => row.signature);
  if (JSON.stringify(actual) !== JSON.stringify(pinned)) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'PlayerController abstract callback drift');
  }
  for (const row of ledger.controllerSurface.abstractCallbacks) {
    const expected = classifyForgeControllerCallback(row.signature);
    if (
      expected.disposition !== row.disposition ||
      JSON.stringify(expected.families) !== JSON.stringify(row.families)
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `PlayerController callback classification drift: ${callbackName(row.signature)}`,
      );
    }
  }
}

/** Verifies the exact bounded bridge source whose callback ownership the ledger attests. */
export function verifyLegacyCubeDecisionBridgeSource(
  ledger: LegacyCubeDecisionLedger,
  bridgeBytes: Uint8Array,
): void {
  const actualHash = sha256(bridgeBytes);
  if (actualHash !== ledger.bridgeReview.sourceSha256) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `Forge bridge source checksum drift: expected ${ledger.bridgeReview.sourceSha256}, got ${actualHash}`,
    );
  }
}

/** Verifies the exact installed effect class and tag-pinned upstream source used by position 235. */
export function verifyLegacyCubeExtinctionEventImplementation(
  classBytes: Uint8Array,
  sourceBytes: Uint8Array,
): void {
  const classHash = sha256(classBytes);
  if (classHash !== LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.classSha256) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `ChooseEvenOddEffect class checksum drift: expected ${LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.classSha256}, got ${classHash}`,
    );
  }
  const sourceHash = sha256(sourceBytes);
  if (sourceHash !== LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.upstream.sourceSha256) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `ChooseEvenOddEffect upstream source checksum drift: expected ${LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION.upstream.sourceSha256}, got ${sourceHash}`,
    );
  }
}

/**
 * Closed classifier for the human choices made explicit by Forge 2.0.14 card scripts.
 * Unknown archive bytes fail their hash pins; new family tags require a schema revision.
 */
export function classifyLegacyCubeForgeScript(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): {
  readonly families: readonly LegacyCubeDecisionFamily[];
  readonly evidenceMarkers: readonly string[];
  readonly unknownDecisionSyntax: readonly string[];
} {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      cause instanceof Error ? `Forge script is not UTF-8: ${cause.message}` : 'Forge script is not UTF-8',
    );
  }
  const found = new Set<LegacyCubeDecisionFamily>();
  const markers = new Set<string>();
  const syntax = inventoryLegacyCubeForgeScript(bytes);
  const unknownDecisionSyntax: string[] = [];
  for (const token of syntax) {
    let review: LegacyCubeDecisionSyntaxToken;
    try {
      review = reviewedLegacyCubeSyntaxToken(inventory, token.kind, token.token);
    } catch {
      unknownDecisionSyntax.push(`${token.kind}:${token.token}`);
      continue;
    }
    for (const family of review.families) found.add(family);
    if (review.disposition === 'mapped') markers.add(review.evidence);
  }

  return {
    families: LEGACY_CUBE_DECISION_FAMILIES.filter((family) => found.has(family)),
    evidenceMarkers: [...markers],
    unknownDecisionSyntax,
  };
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value))
      throw new InvalidInputError('Legacy Cube decision ledger', `duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

/** Schema plus the cross-document and safe-by-evidence invariants. */
export function verifyLegacyCubeDecisionLedger(
  input: LegacyCubeDecisionLedger,
  provenance: LegacyCubeProvenance,
): void {
  verifyLegacyCubeProvenance(provenance);
  const inputOfficial = Array.isArray(input.auditedCards)
    ? input.auditedCards.filter((entry) => entry.corpus === 'official-full-cardlist')
    : [];
  if (inputOfficial.length !== 600) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `ledger must contain exactly 600 official positions, found ${String(inputOfficial.length)}`,
    );
  }
  const known = new Set<string>(LEGACY_CUBE_DECISION_FAMILIES);
  for (const entry of input.auditedCards) {
    for (const family of entry.families ?? []) {
      if (!known.has(family)) {
        throw new InvalidInputError('Legacy Cube decision ledger', `unknown decision family: ${family}`);
      }
    }
  }
  const parsed = LegacyCubeDecisionLedgerSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError('Legacy Cube decision ledger', parsed.error.message);
  const ledger = parsed.data;
  if (
    ledger.provenanceArtifact.sha256 !== PROVENANCE_ARTIFACT_SHA256 ||
    ledger.provenanceArtifact.normalizedRowsSha256 !== provenance.normalization.sha256
  ) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'provenance checksum drift');
  }
  if (
    ledger.forge.version !== provenance.forge.version ||
    ledger.forge.cardScriptArchiveSha256 !== provenance.forge.cardScriptArchiveSha256
  ) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'Forge archive pin drift');
  }
  if (ledger.controllerSurface.sha256 !== FORGE_PLAYER_CONTROLLER_JAVAP_SHA256) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'PlayerController callback surface pin drift');
  }
  const syntaxReview = loadLegacyCubeSyntaxReview();
  if (
    ledger.syntaxReview.sha256 !== LEGACY_CUBE_SYNTAX_REVIEW_SHA256 ||
    JSON.stringify(ledger.syntaxInventory) !== JSON.stringify(syntaxReview)
  ) {
    const changed = ledger.syntaxInventory.find((row, index) => {
      const expected = syntaxReview[index];
      return expected === undefined || JSON.stringify(row) !== JSON.stringify(expected);
    });
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `syntax review drift${changed === undefined ? '' : ` for ${changed.kind} ${changed.token}`}`,
    );
  }
  if (
    JSON.stringify(ledger.families.map((family) => family.tag)) !==
    JSON.stringify(LEGACY_CUBE_DECISION_FAMILIES)
  ) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'decision family registry drift');
  }
  if (
    JSON.stringify(ledger.bridgeReview.universalMatchFamilies) !==
    JSON.stringify(['mulligan', 'starting-player'])
  ) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      'universal match families must be exactly mulligan and starting-player',
    );
  }
  if (
    JSON.stringify(ledger.bridgeReview.ordinaryManaPayment) !==
    JSON.stringify(LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT)
  ) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'ordinary mana-payment audit drift');
  }
  if (
    JSON.stringify(ledger.bridgeReview.generatedTokenScripts) !==
    JSON.stringify(LEGACY_CUBE_GENERATED_TOKEN_AUDIT)
  ) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'generated token-script audit drift');
  }
  for (const family of ledger.families) {
    const expectedScope = family.tag === 'mulligan' || family.tag === 'starting-player' ? 'match' : 'card';
    if (family.scope !== expectedScope) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `family scope drift for ${family.tag}: expected ${expectedScope}, got ${family.scope}`,
      );
    }
  }
  const official = ledger.auditedCards.filter((entry) => entry.corpus === 'official-full-cardlist');
  assertUnique(
    ledger.syntaxInventory.map((row) => `${row.kind}\0${row.token}`),
    'Forge syntax token',
  );
  for (const row of ledger.syntaxInventory) {
    if (
      (row.disposition === 'mapped' && row.families.length === 0) ||
      (row.disposition === 'non-choice' && row.families.length > 0)
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `invalid affirmative syntax disposition for ${row.kind} ${row.token}`,
      );
    }
  }
  assertUnique(
    ledger.controllerSurface.abstractCallbacks.map((row) => row.signature),
    'PlayerController callback',
  );
  assertUnique(
    ledger.runtimeProbes.map((probe) => probe.id),
    'runtime probe',
  );
  for (const row of ledger.controllerSurface.abstractCallbacks) {
    const expected = classifyForgeControllerCallback(row.signature);
    const expectedOwner = forgeBridgeControllerOwnership(row.signature);
    if (
      row.disposition !== expected.disposition ||
      JSON.stringify(row.families) !== JSON.stringify(expected.families) ||
      row.bridgeOwnership !== expectedOwner
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `PlayerController callback attestation drift for ${callbackName(row.signature)}`,
      );
    }
  }
  const status = new Map(ledger.families.map((family) => [family.tag, family.bridgeStatus]));
  const ordinaryCombatSingleTargetPositions = new Set<number>(
    LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_SAFE_POSITIONS,
  );
  const statedRetargetPositions = new Set<number>(LEGACY_CUBE_STATED_RETARGET_SAFE_POSITIONS);
  const ordinaryCombatSingleTargetExcludedPositions = new Set<number>(
    LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_EXCLUDED_POSITIONS,
  );
  const ordinaryCombatTriggerTargetPositions = new Set<number>(
    LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_SAFE_POSITIONS,
  );
  const shocklandPositions = new Set<number>(LEGACY_CUBE_SHOCKLAND_SAFE_POSITIONS);
  const shocklandExcludedPositions = new Set<number>(LEGACY_CUBE_SHOCKLAND_OPTIONAL_COST_EXCLUDED_POSITIONS);
  const baneslayerProtectionPositions = new Set<number>(LEGACY_CUBE_BANESLAYER_PROTECTION_SAFE_POSITIONS);
  const baneslayerProtectionExcludedPositions = new Set<number>(
    LEGACY_CUBE_BANESLAYER_PROTECTION_EXCLUDED_POSITIONS,
  );
  const chartACourseDiscardExcludedPositions = new Set<number>(
    LEGACY_CUBE_CHART_A_COURSE_DISCARD_EXCLUDED_POSITIONS,
  );
  const studentOfWarfareLevelUpExcludedPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_LEVEL_UP_EXCLUDED_POSITIONS,
  );
  const selflessSpiritExcludedPositions = new Set<number>(LEGACY_CUBE_SELFLESS_SPIRIT_EXCLUDED_POSITIONS);
  const remorsefulClericExcludedPositions = new Set<number>(LEGACY_CUBE_REMORSEFUL_CLERIC_EXCLUDED_POSITIONS);
  const coldsteelHeartExcludedPositions = new Set<number>(LEGACY_CUBE_COLDSTEEL_HEART_EXCLUDED_POSITIONS);
  const extinctionEventExcludedPositions = new Set<number>(LEGACY_CUBE_EXTINCTION_EVENT_EXCLUDED_POSITIONS);
  const vraskaGeneratedTokenPositions = new Set<number>(LEGACY_CUBE_VRASKA_GENERATED_TOKEN_SAFE_POSITIONS);
  for (const family of ledger.families) {
    const expected = LEGACY_CUBE_BRIDGE_FAMILY_REVIEW[family.tag];
    if (family.bridgeStatus !== expected.bridgeStatus || family.bridgeEvidence !== expected.bridgeEvidence) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `bridge family evidence drift for ${family.tag}`,
      );
    }
  }
  for (const [index, entry] of official.entries()) {
    if (entry.position !== index + 1) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `position ${String(entry.position)} is duplicate or out of order at row ${String(index + 1)}`,
      );
    }
    const identity = provenance.identities[index];
    if (
      identity === undefined ||
      entry.sourceName !== identity.sourceName ||
      entry.correctedName !== identity.correctedName ||
      entry.forgeScript !== identity.forgeScript
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `position ${String(entry.position)} does not match pinned provenance identity/script`,
      );
    }
    assertUnique(entry.families, `family on ${entry.correctedName}`);
    const ordered = LEGACY_CUBE_DECISION_FAMILIES.filter((family) => entry.families.includes(family));
    if (JSON.stringify(ordered) !== JSON.stringify(entry.families)) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `family order drift on ${entry.correctedName}`,
      );
    }
    if (entry.risk !== (entry.families.length >= 4 ? 'high' : 'ordinary')) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `risk classification drift on ${entry.correctedName}`,
      );
    }
  }
  for (const entry of ledger.auditedCards) {
    if (entry.corpus === 'bridge-baseline' && entry.position !== null) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `bridge baseline ${entry.correctedName} has a false cube position`,
      );
    }
    if (entry.unknownDecisionSyntax.length > 0) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `unknown Forge decision syntax on ${entry.correctedName}: ${entry.unknownDecisionSyntax.join(', ')}`,
      );
    }
    const review =
      entry.corpus === 'bridge-baseline'
        ? LEGACY_CUBE_BOUNDED_PROFILE_REVIEWS[0]
        : LEGACY_CUBE_BOUNDED_PROFILE_REVIEWS.find(
            (candidate) => entry.position !== null && candidate.positions.includes(entry.position),
          );
    const expectedProfile: LegacyCubeBridgeCapabilityBundle | null =
      review === undefined
        ? null
        : {
            topLevel: review.topLevel,
            manaPayment: review.manaPayment ?? 'ordinary-mana-payment-v1',
            generatedObjects: review.generatedObjects,
          };
    if (
      entry.cardFamilySafe !== (expectedProfile !== null) ||
      JSON.stringify(entry.bridgeCapabilityProfile) !== JSON.stringify(expectedProfile)
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `bounded capability-profile review drift for ${entry.correctedName}`,
      );
    }
    if (entry.cardFamilySafe) {
      const expectedFamilies: readonly LegacyCubeDecisionFamily[] =
        review === undefined ? [] : review.families;
      if (JSON.stringify(entry.families) !== JSON.stringify(expectedFamilies)) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `safe capability profile does not match ${entry.correctedName}'s family signature`,
        );
      }
      // A family the whole bridge has not taken on is excused here only when the
      // reviewed profile above names it, so an excusal cannot outlive its review.
      const unsupported = entry.families.find(
        (family) => status.get(family) !== 'supported' && !expectedFamilies.includes(family),
      );
      if (unsupported !== undefined) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `cannot mark ${entry.correctedName} safe with unsupported family ${unsupported}`,
        );
      }
      const probe = ledger.runtimeProbes.find(
        (candidate) =>
          candidate.id === entry.runtimeProbeId &&
          candidate.outcome === 'completed' &&
          candidate.cardNames.includes(entry.correctedName),
      );
      if (probe === undefined) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `cannot mark ${entry.correctedName} safe without a completed runtime probe`,
        );
      }
    }
    const ownsPinnedGeneratedObjects =
      entry.bridgeCapabilityProfile?.generatedObjects === 'pinned-token-scripts-v1';
    if (ownsPinnedGeneratedObjects !== entry.generatedScriptDependencies.length > 0) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `generated token dependency capability drift for ${entry.correctedName}`,
      );
    }
    assertUnique(
      entry.generatedScriptDependencies.map((dependency) => dependency.name),
      `generated token dependency on ${entry.correctedName}`,
    );
    for (const dependency of entry.generatedScriptDependencies) {
      if (dependency.unknownDecisionSyntax.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `unknown generated Forge decision syntax on ${dependency.name}: ${dependency.unknownDecisionSyntax.join(', ')}`,
        );
      }
      const orderedDependencies = [...dependency.dependencies].sort((left, right) =>
        left.localeCompare(right),
      );
      if (JSON.stringify(orderedDependencies) !== JSON.stringify(dependency.dependencies)) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `generated token dependency order drift for ${dependency.name}`,
        );
      }
      for (const nested of dependency.dependencies) {
        if (!entry.generatedScriptDependencies.some((candidate) => candidate.name === nested)) {
          throw new InvalidInputError(
            'Legacy Cube decision ledger',
            `missing nested generated token script ${nested} for ${entry.correctedName}`,
          );
        }
      }
    }
  }
  const ordinaryCombatSingleTargetCohort = official
    .filter((entry) => JSON.stringify(entry.families) === JSON.stringify(['priority', 'targets', 'combat']))
    .map((entry) => entry.position);
  const reviewedOrdinaryCombatSingleTargetCohort = [
    ...ordinaryCombatSingleTargetPositions,
    ...ordinaryCombatSingleTargetExcludedPositions,
    ...ordinaryCombatTriggerTargetPositions,
    ...vraskaGeneratedTokenPositions,
    ...statedRetargetPositions,
  ].sort((left, right) => left - right);
  if (
    JSON.stringify(ordinaryCombatSingleTargetCohort) !==
    JSON.stringify(reviewedOrdinaryCombatSingleTargetCohort)
  ) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      'ordinary-combat singleton-target cohort review drift',
    );
  }
  for (const position of ordinaryCombatSingleTargetExcludedPositions) {
    const entry = official[position - 1];
    // An exclusion belongs to this profile. A later, independently checked
    // profile may admit the position, as announced-number does for Koth.
    if (
      entry === undefined ||
      entry.bridgeCapabilityProfile?.topLevel ===
        'ordinary-combat-and-mandatory-singleton-nonstack-target-v1' ||
      (entry.cardFamilySafe && entry.bridgeCapabilityProfile === null)
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `ordinary-combat singleton-target exclusion drift at position ${String(position)}`,
      );
    }
  }
  const baneslayerProtectionCohort = official
    .filter(
      (entry) =>
        JSON.stringify(entry.families) === JSON.stringify(['priority', 'combat', 'naming-text-numbers']),
    )
    .map((entry) => entry.position);
  const reviewedBaneslayerProtectionCohort = [
    ...baneslayerProtectionPositions,
    ...baneslayerProtectionExcludedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(baneslayerProtectionCohort) !== JSON.stringify(reviewedBaneslayerProtectionCohort)) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      'Baneslayer fixed-protection cohort review drift',
    );
  }
  // Read the same way as the Chart a Course loop below: what it refuses is the
  // Baneslayer profile reaching a card it was not written for, not a later
  // review reaching one. `mtg-fp4l` phase 3 admitted Brightling, Serra's
  // Emissary and Iona under `bounded-enumerated-choice-v1`, which wires the
  // choose-one callbacks their protection and card-type choices reach rather
  // than fixing the quality the way this profile does, and phase 8 admitted
  // Phyrexian Revoker under `open-card-naming-v1`, which wires the arm of
  // `chooseCardName` that hands over a predicate rather than a list. All four
  // are refused by this loop only in the one sense it measures: none of them
  // carries the Baneslayer profile, and none is left family-safe with no
  // profile at all.
  for (const position of baneslayerProtectionExcludedPositions) {
    const entry = official[position - 1];
    if (
      entry === undefined ||
      entry.bridgeCapabilityProfile?.topLevel === 'ordinary-combat-baneslayer-protection-v1' ||
      (entry.cardFamilySafe && entry.bridgeCapabilityProfile === null)
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `Baneslayer fixed-protection exclusion drift at position ${String(position)}`,
      );
    }
  }
  // What this loop refuses is the Chart a Course profile spreading past the one
  // position it was written for, rather than a later review reaching a card it
  // could not. `mtg-fp4l` phase 2 admitted nine of these positions under
  // `bounded-multi-selection-v1`, which read the same scripts against its own
  // refusal predicate and its own observed-Forge probe; a position admitted
  // under no profile at all is still the drift this check exists to name.
  for (const position of chartACourseDiscardExcludedPositions) {
    const entry = official[position - 1];
    if (
      entry === undefined ||
      entry.bridgeCapabilityProfile?.topLevel === 'draw-two-conditional-singleton-discard-v1' ||
      (entry.cardFamilySafe && entry.bridgeCapabilityProfile === null)
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `Chart a Course discard-selection exclusion drift at position ${String(position)}`,
      );
    }
  }
  for (const position of studentOfWarfareLevelUpExcludedPositions) {
    const entry = official[position - 1];
    if (entry === undefined || entry.cardFamilySafe || entry.bridgeCapabilityProfile !== null) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `reviewed level-up exclusion drift at position ${String(position)}`,
      );
    }
  }
  for (const position of selflessSpiritExcludedPositions) {
    const entry = official[position - 1];
    if (entry === undefined || entry.cardFamilySafe || entry.bridgeCapabilityProfile !== null) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `Selfless Spirit profile exclusion drift at position ${String(position)}`,
      );
    }
  }
  for (const position of remorsefulClericExcludedPositions) {
    const entry = official[position - 1];
    if (entry === undefined || entry.cardFamilySafe || entry.bridgeCapabilityProfile !== null) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `Remorseful Cleric profile exclusion drift at position ${String(position)}`,
      );
    }
  }
  // The same reading. Iona names a color through `chooseColor` rather than
  // through the fixed entry choice this profile owns, so `mtg-fp4l` phase 3
  // admits it under `bounded-enumerated-choice-v1`; Utopia Sprawl stays refused
  // for its attachment target.
  for (const position of coldsteelHeartExcludedPositions) {
    const entry = official[position - 1];
    if (
      entry === undefined ||
      entry.bridgeCapabilityProfile?.topLevel === 'coldsteel-heart-entry-color-chosen-mana-v1' ||
      (entry.cardFamilySafe && entry.bridgeCapabilityProfile === null)
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `Coldsteel Heart profile exclusion drift at position ${String(position)}`,
      );
    }
  }
  for (const position of extinctionEventExcludedPositions) {
    const entry = official[position - 1];
    if (entry === undefined || entry.cardFamilySafe || entry.bridgeCapabilityProfile !== null) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `Extinction Event profile exclusion drift at position ${String(position)}`,
      );
    }
  }
  const reviewedGeneratedObjectPartition = [
    ...LEGACY_CUBE_GENERATED_TOKEN_AUDIT.safePositions,
    ...LEGACY_CUBE_GENERATED_TOKEN_AUDIT.excludedPositions,
  ].sort((left, right) => left - right);
  if (
    JSON.stringify(reviewedGeneratedObjectPartition) !==
    JSON.stringify(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.reviewedPositions)
  ) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      'generated token-script safe/excluded partition drift',
    );
  }
  const reviewedGeneratedPins = new Map<string, string>(
    LEGACY_CUBE_GENERATED_TOKEN_AUDIT.exactTokenScripts.map((row) => [row.name, row.sha256]),
  );
  for (const position of LEGACY_CUBE_GENERATED_TOKEN_AUDIT.safePositions) {
    const entry = official[position - 1];
    const expectedTopLevel = vraskaGeneratedTokenPositions.has(position)
      ? 'ordinary-combat-target-and-pinned-generated-token-v1'
      : position === 50
        ? 'stated-ordering-and-reviewed-lingering-souls-v1'
        : LEGACY_CUBE_REVIEWED_LIVING_WEAPON_SAFE_POSITIONS.some((candidate) => candidate === position)
          ? 'stated-ordering-and-reviewed-living-weapon-v1'
          : LEGACY_CUBE_REVIEWED_FORETELL_SAFE_POSITIONS.some((candidate) => candidate === position)
            ? 'stated-ordering-and-reviewed-foretell-v1'
            : LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_SAFE_POSITIONS.some(
                  (candidate) => candidate === position,
                )
              ? 'stated-ordering-and-reviewed-optional-generated-token-v1'
              : LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_SAFE_POSITIONS.some(
                    (candidate) => candidate === position,
                  )
                ? 'stated-ordering-and-reviewed-gideon-garruk-bloodline-v1'
                : LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_SAFE_POSITIONS.some(
                      (candidate) => candidate === position,
                    )
                  ? 'stated-ordering-and-reviewed-pia-siege-gang-v1'
                  : LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS.some(
                        (candidate) => candidate === position,
                      )
                    ? 'stated-ordering-and-reviewed-generated-token-sacrifice-v1'
                    : LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_SAFE_POSITIONS.some(
                          (candidate) => candidate === position,
                        )
                      ? 'stated-ordering-and-reviewed-generated-object-bounded-choice-v1'
                      : LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_SAFE_POSITIONS.some(
                            (candidate) => candidate === position,
                          )
                        ? 'stated-ordering-and-reviewed-alternate-cost-generated-object-v1'
                        : LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_SAFE_POSITIONS.some(
                              (candidate) => candidate === position,
                            )
                          ? 'stated-ordering-and-reviewed-residual-generated-token-v1'
                          : LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_SAFE_POSITIONS.some(
                                (candidate) => candidate === position,
                              )
                            ? 'stated-ordering-and-reviewed-multi-target-transformation-v1'
                            : LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_SAFE_POSITIONS.some(
                                  (candidate) => candidate === position,
                                )
                              ? 'stated-ordering-and-reviewed-planeswalker-unless-sacrifice-v1'
                              : LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_SAFE_POSITIONS.some(
                                    (candidate) => candidate === position,
                                  )
                                ? 'stated-ordering-and-reviewed-prismari-command-v1'
                                : LEGACY_CUBE_REVIEWED_CRYPTBREAKER_SAFE_POSITIONS.some(
                                      (candidate) => candidate === position,
                                    )
                                  ? 'stated-ordering-and-reviewed-cryptbreaker-v1'
                                  : LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_SAFE_POSITIONS.some(
                                        (candidate) => candidate === position,
                                      )
                                    ? 'stated-ordering-and-reviewed-myr-battlesphere-v1'
                                    : LEGACY_CUBE_REVIEWED_TREASURE_COHORT_SAFE_POSITIONS.some(
                                          (candidate) => candidate === position,
                                        )
                                      ? 'stated-ordering-and-audited-treasure-cohort-v1'
                                      : LEGACY_CUBE_REVIEWED_KALITAS_SAFE_POSITIONS.some(
                                            (candidate) => candidate === position,
                                          )
                                        ? 'stated-ordering-and-reviewed-kalitas-v1'
                                        : LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_SAFE_POSITIONS.some(
                                              (candidate) => candidate === position,
                                            )
                                          ? 'stated-ordering-and-reviewed-remaining-planeswalkers-v1'
                                          : LEGACY_CUBE_REVIEWED_FINAL_SIX_SAFE_POSITIONS.some(
                                                (candidate) => candidate === position,
                                              )
                                            ? 'stated-ordering-and-reviewed-final-six-v1'
                                            : LEGACY_CUBE_REVIEWED_HUNTMASTER_SAFE_POSITIONS.some(
                                                  (candidate) => candidate === position,
                                                )
                                              ? 'stated-ordering-and-reviewed-huntmaster-v1'
                                              : 'stated-ordering-and-pinned-generated-token-v1';
    if (
      entry === undefined ||
      !entry.cardFamilySafe ||
      entry.bridgeCapabilityProfile?.topLevel !== expectedTopLevel ||
      entry.bridgeCapabilityProfile.generatedObjects !== 'pinned-token-scripts-v1' ||
      entry.generatedScriptDependencies.length === 0 ||
      entry.generatedScriptDependencies.some(
        (dependency) => reviewedGeneratedPins.get(dependency.name) !== dependency.sha256,
      )
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `generated token-script evidence drift at position ${String(position)}`,
      );
    }
  }
  const shocklandCohort = official
    .filter((entry) => JSON.stringify(entry.families) === JSON.stringify(['priority', 'optional-costs']))
    .map((entry) => entry.position);
  const reviewedShocklandCohort = [...shocklandPositions, ...shocklandExcludedPositions].sort(
    (left, right) => left - right,
  );
  if (JSON.stringify(shocklandCohort) !== JSON.stringify(reviewedShocklandCohort)) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'shockland optional-cost cohort review drift');
  }
  for (const position of shocklandExcludedPositions) {
    const entry = official[position - 1];
    if (
      entry === undefined ||
      entry.bridgeCapabilityProfile?.topLevel === 'shockland-pay-two-life-entry-replacement-v1' ||
      (entry.cardFamilySafe && entry.bridgeCapabilityProfile === null)
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `shockland optional-cost exclusion drift at position ${String(position)}`,
      );
    }
  }
  assertUnique(
    official.map((entry) => String(entry.position)),
    'position',
  );
  assertUnique(
    ledger.auditedCards.map((entry) => entry.forgeScript),
    'Forge script path',
  );
  for (const family of ledger.families) {
    for (const position of family.representativePositions) {
      if (!official[position - 1]?.families.includes(family.tag) && family.scope === 'card') {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `${family.tag} representative ${String(position)} does not carry that family`,
        );
      }
    }
  }
  for (const entry of official.filter(
    (candidate) => candidate.risk === 'high' && !candidate.cardFamilySafe,
  )) {
    const probe = ledger.runtimeProbes.find(
      (candidate) =>
        candidate.id === entry.runtimeProbeId &&
        candidate.kind === 'observed-backend-containment' &&
        candidate.outcome === 'refused-before-spawn',
    );
    if (probe === undefined) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `high-risk position ${String(entry.position)} lacks a hostile runtime refusal probe`,
      );
    }
    if (JSON.stringify(probe.families) !== JSON.stringify(entry.families)) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `hostile runtime probe ${probe.id} does not match ${entry.correctedName}'s family signature`,
      );
    }
  }
  for (const probe of ledger.runtimeProbes.filter(
    (candidate) => candidate.kind === 'observed-backend-containment',
  )) {
    const representative = official.find(
      (entry) =>
        entry.runtimeProbeId === probe.id &&
        entry.position === probe.position &&
        entry.correctedName === probe.correctedName,
    );
    if (
      representative === undefined ||
      probe.cardNames.length !== 1 ||
      probe.cardNames[0] !== representative.correctedName
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `runtime probe ${probe.id} is not pinned to its tested family-signature representative`,
      );
    }
  }
  const completedProbeIds = new Set(
    ledger.runtimeProbes.filter((probe) => probe.outcome === 'completed').map((probe) => probe.id),
  );
  const paymentProbe = ledger.runtimeProbes.find(
    (probe) => probe.id === LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE.id,
  );
  const paymentProbeNames = ledger.auditedCards
    .filter((entry) => entry.cardFamilySafe)
    .map((entry) => entry.correctedName);
  if (
    paymentProbe === undefined ||
    paymentProbe.kind !== 'observed-forge-session' ||
    paymentProbe.position !== null ||
    paymentProbe.correctedName !== null ||
    paymentProbe.outcome !== 'completed' ||
    JSON.stringify(paymentProbe.cardNames) !== JSON.stringify(paymentProbeNames) ||
    JSON.stringify(paymentProbe.families) !==
      JSON.stringify(LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE.families) ||
    paymentProbe.evidence !== LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE.evidence
  ) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      'ordinary mana-payment runtime probe evidence drift',
    );
  }
  for (const position of LEGACY_CUBE_ORDINARY_MANA_PAYMENT_UNSAFE_POSITIONS) {
    const entry = official[position - 1];
    if (
      entry === undefined ||
      !entry.cardFamilySafe ||
      !entry.families.includes('mana-x') ||
      entry.bridgeCapabilityProfile?.topLevel !== 'stated-ordering-and-reviewed-phyrexian-spell-cost-v1' ||
      entry.bridgeCapabilityProfile.manaPayment !== 'phyrexian-mana-payment-v1'
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `ordinary mana-payment exclusion drift at position ${String(position)}`,
      );
    }
  }
  const matchProbe = ledger.runtimeProbes.find((probe) => probe.id === LEGACY_CUBE_BRIDGE_MATCH_PROBE.id);
  if (
    matchProbe === undefined ||
    matchProbe.kind !== 'observed-forge-session' ||
    matchProbe.position !== null ||
    matchProbe.correctedName !== null ||
    matchProbe.outcome !== 'completed' ||
    JSON.stringify(matchProbe.cardNames) !== JSON.stringify(LEGACY_CUBE_BRIDGE_MATCH_PROBE.cardNames) ||
    JSON.stringify(matchProbe.families) !== JSON.stringify(LEGACY_CUBE_BRIDGE_MATCH_PROBE.families) ||
    matchProbe.evidence !== LEGACY_CUBE_BRIDGE_MATCH_PROBE.evidence
  ) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'completed bridge match probe evidence drift');
  }
  for (const card of ledger.auditedCards.filter((entry) => entry.cardFamilySafe)) {
    if (card.runtimeProbeId === null || !completedProbeIds.has(card.runtimeProbeId)) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `reviewed safe card ${card.correctedName} has no completed runtime probe`,
      );
    }
  }
  const safeOfficialPositions = official
    .filter((entry) => entry.cardFamilySafe)
    .map((entry) => entry.position);
  // The same table the per-entry review above reads, so a profile cannot be
  // admitted card by card and left out of the corpus-wide total.
  const expectedSafePositions = LEGACY_CUBE_BOUNDED_PROFILE_REVIEWS.flatMap(
    (review) => review.positions,
  ).sort((left, right) => left - right);
  if (JSON.stringify(safeOfficialPositions) !== JSON.stringify(expectedSafePositions)) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      'official bounded capability-profile safe-position review drift',
    );
  }
  if (legacyCubeDecisionLedgerContentSha256(ledger) !== ledger.contentSha256) {
    throw new InvalidInputError('Legacy Cube decision ledger', 'deterministic content checksum drift');
  }
}

/**
 * Exact Elspeth Conquers Death chapter-three composition reviewed against the
 * installed counter-type callback. The complete installed script remains
 * byte-pinned by the ledger; this boundary prevents another comma-delimited
 * counter choice from borrowing that evidence.
 */
export function legacyCubeReviewedCounterTypeChoiceRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const exactComposition =
    name === 'Elspeth Conquers Death' &&
    lines.includes('ManaCost:3 W W') &&
    lines.includes('Types:Enchantment Saga') &&
    lines.includes('K:Chapter:3:DBExile,DBEffect,DBReturn') &&
    lines.includes(
      'SVar:DBReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ValidTgts$ Creature.YouOwn,Planeswalker.YouOwn | TgtPrompt$ Select target creature or planeswalker | RememberChanged$ True | SubAbility$ AddCounter | SpellDescription$ Return target creature or planeswalker card from your graveyard to the battlefield. Put a +1/+1 counter or a loyalty counter on it.',
    ) &&
    lines.includes(
      'SVar:AddCounter:DB$ PutCounter | Defined$ Remembered | CounterType$ P1P1,LOYALTY | CounterNum$ 1 | SubAbility$ DBCleanup',
    ) &&
    lines.includes('SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True');
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exactComposition || !base.includes('counter-type choice')) {
    return [...new Set([...base, 'exact reviewed counter-type choice composition'])];
  }
  return base.filter((refusal) => refusal !== 'counter-type choice');
}

/** Closed whole-ability boundary for the two reviewed optional singleton targets. */
export function legacyCubeReviewedOptionalTargetRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const optionalTargetLines = lines.filter(
    (line) => /\bTargetMin\$\s*0\b/u.test(line) || /\bMayChooseTarget\$\s*True\b/iu.test(line),
  );
  const exactTeferi =
    name === 'Teferi, Time Raveler' &&
    optionalTargetLines.length === 1 &&
    optionalTargetLines[0] ===
      "A:AB$ ChangeZone | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | Origin$ Battlefield | Destination$ Hand | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Artifact,Creature,Enchantment | TgtPrompt$ Select target artifact, creature, or enchantment | SpellDescription$ Return up to one target artifact, creature, or enchantment to its owner's hand. Draw a card. | SubAbility$ DBDraw" &&
    lines.includes('SVar:DBDraw:DB$ Draw');
  const exactNissa =
    name === 'Nissa, Who Shakes the World' &&
    optionalTargetLines.length === 1 &&
    optionalTargetLines[0] ===
      "A:AB$ PutCounter | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | CounterType$ P1P1 | CounterNum$ 3 | ValidTgts$ Land.nonCreature+YouCtrl | TargetMin$ 0 | TargetMax$ 1 | TgtPrompt$ Select target noncreature land you control | SubAbility$ DBUntap | SpellDescription$ Put three +1/+1 counters on up to one target noncreature land you control. Untap it. It becomes a 0/0 Elemental creature with vigilance and haste that's still a land." &&
    lines.includes('SVar:DBUntap:DB$ Untap | Defined$ Targeted | SubAbility$ DBAnimate') &&
    lines.includes(
      'SVar:DBAnimate:DB$ Animate | Defined$ Targeted | Power$ 0 | Toughness$ 0 | Types$ Creature,Elemental | Keywords$ Vigilance & Haste | Duration$ Permanent',
    );
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!(exactTeferi || exactNissa) || !base.includes('optional target')) {
    return [...new Set([...base, 'exact reviewed optional target composition'])];
  }
  return base.filter((refusal) => refusal !== 'optional target');
}

/** Closed whole-card boundary for the two reviewed printed Phyrexian costs. */
export function legacyCubeReviewedPhyrexianSpellCostRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const exactDismember =
    name === 'Dismember' &&
    lines.includes('ManaCost:1 BP BP') &&
    lines.includes('Types:Instant') &&
    lines.includes(
      'A:SP$ Pump | IsCurse$ True | ValidTgts$ Creature | NumAtt$ -5 | NumDef$ -5 | SpellDescription$ Target creature gets -5/-5 until end of turn.',
    );
  const exactLegionnaire =
    name === 'Porcelain Legionnaire' &&
    lines.includes('ManaCost:2 WP') &&
    lines.includes('Types:Artifact Creature Phyrexian Soldier') &&
    lines.includes('PT:3/1') &&
    lines.includes('K:First Strike');
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!(exactDismember || exactLegionnaire) || !base.includes('Phyrexian mana cost')) {
    return [...new Set([...base, 'exact reviewed Phyrexian spell-cost composition'])];
  }
  return base.filter((refusal) => refusal !== 'Phyrexian mana cost');
}

/** Closed whole-card boundary for the two reviewed Cascade creatures. */
export function legacyCubeReviewedCascadeRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const exactBloodbraid =
    name === 'Bloodbraid Elf' &&
    lines.includes('ManaCost:2 R G') &&
    lines.includes('Types:Creature Elf Berserker') &&
    lines.includes('PT:3/2') &&
    lines.includes('K:Haste') &&
    lines.filter((line) => line === 'K:Cascade').length === 1;
  const exactShardless =
    name === 'Shardless Agent' &&
    lines.includes('ManaCost:1 G U') &&
    lines.includes('Types:Artifact Creature Human Rogue') &&
    lines.includes('PT:2/2') &&
    lines.includes('SVar:PlayMain1:TRUE') &&
    lines.filter((line) => line === 'K:Cascade').length === 1;
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  const cascadeRefusal = 'unbounded decision token keyword:Cascade';
  if (!(exactBloodbraid || exactShardless) || !base.includes(cascadeRefusal)) {
    return [...new Set([...base, 'exact reviewed Cascade composition'])];
  }
  return base.filter((refusal) => refusal !== cascadeRefusal);
}

/** Closed whole-card boundary for the three three-pick repeatable Confluences. */
export function legacyCubeReviewedRepeatableModeRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const name = lines.find((line) => line.startsWith('Name:'))?.slice('Name:'.length);
  const exactWretched =
    name === 'Wretched Confluence' &&
    lines.includes('ManaCost:3 B B') &&
    lines.includes('Types:Instant') &&
    lines.includes(
      'A:SP$ Charm | Choices$ DBDraw,DBPump,DBChangeZone | CharmNum$ 3 | CanRepeatModes$ True',
    ) &&
    lines.includes(
      'SVar:DBDraw:DB$ Draw | ValidTgts$ Player | NumCards$ 1 | SubAbility$ DBLoseLife | SpellDescription$ Target player draws a card and loses 1 life.',
    ) &&
    lines.includes('SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 1 | Defined$ Targeted') &&
    lines.includes(
      'SVar:DBPump:DB$ Pump | ValidTgts$ Creature | NumAtt$ -2 | NumDef$ -2 | IsCurse$ True | SpellDescription$ Target creature gets -2/-2 until end of turn.',
    ) &&
    lines.includes(
      'SVar:DBChangeZone:DB$ ChangeZone | TgtPrompt$ Choose target creature card in your graveyard | ValidTgts$ Creature.YouOwn | Origin$ Graveyard | Destination$ Hand | SpellDescription$ Return target creature card from your graveyard to your hand.',
    );
  const exactFiery =
    name === 'Fiery Confluence' &&
    lines.includes('ManaCost:2 R R') &&
    lines.includes('Types:Sorcery') &&
    lines.includes(
      'A:SP$ Charm | Choices$ DBDamageCreatures,DBDamageOpponents,DBDestroy | CharmNum$ 3 | CanRepeatModes$ True',
    ) &&
    lines.includes(
      'SVar:DBDamageCreatures:DB$ DamageAll | NumDmg$ 1 | ValidCards$ Creature | SpellDescription$ CARDNAME deals 1 damage to each creature.',
    ) &&
    lines.includes(
      'SVar:DBDamageOpponents:DB$ DealDamage | Defined$ Player.Opponent | NumDmg$ 2 | AILogic$ Good | SpellDescription$ CARDNAME deals 2 damage to each opponent.',
    ) &&
    lines.includes(
      'SVar:DBDestroy:DB$ Destroy | ValidTgts$ Artifact | SpellDescription$ Destroy target artifact.',
    );
  const exactMystic =
    name === 'Mystic Confluence' &&
    lines.includes('ManaCost:3 U U') &&
    lines.includes('Types:Instant') &&
    lines.includes('A:SP$ Charm | Choices$ DBCounter,DBReturn,DBDraw | CharmNum$ 3 | CanRepeatModes$ True') &&
    lines.includes(
      'SVar:DBCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Card | UnlessCost$ 3 | UnlessPayer$ ThisTargetedController | SpellDescription$ Counter target spell unless its controller pays {3}.',
    ) &&
    lines.includes(
      "SVar:DBReturn:DB$ ChangeZone | Origin$ Battlefield | Destination$ Hand | ValidTgts$ Creature | SpellDescription$ Return target creature to its owner's hand.",
    ) &&
    lines.includes('SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1 | SpellDescription$ Draw a card.');
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  const lifted = exactMystic
    ? new Set([
        'retarget ability',
        'repeatable mode selection',
        'unbounded decision token parameter-key:UnlessCost',
      ])
    : new Set(['repeatable mode selection']);
  if (
    !(exactWretched || exactFiery || exactMystic) ||
    [...lifted].some((refusal) => !base.includes(refusal))
  ) {
    return [...new Set([...base, 'exact reviewed repeatable-mode composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Plow Under's exact two-land target block. */
export function legacyCubeReviewedMultipleTargetRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const exact =
    lines.includes('Name:Plow Under') &&
    lines.includes('ManaCost:3 G G') &&
    lines.includes('Types:Sorcery') &&
    lines.includes(
      "A:SP$ ChangeZone | TargetMin$ 2 | TargetMax$ 2 | ValidTgts$ Land | TgtPrompt$ Select two target lands | Origin$ Battlefield | Destination$ Library | LibraryPosition$ 0 | SpellDescription$ Put two target lands on top of their owners' libraries.",
    );
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exact || !base.includes('multiple targets')) {
    return [...new Set([...base, 'exact reviewed Plow Under composition'])];
  }
  return base.filter((refusal) => refusal !== 'multiple targets');
}

/** Closed whole-card boundary for Coalition Relic's Combo Any trigger. */
export function legacyCubeReviewedManaComboRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = script.split(/\r?\n/u).map((line) => line.trim());
  const exact =
    lines.includes('Name:Coalition Relic') &&
    lines.includes('ManaCost:3') &&
    lines.includes('Types:Artifact') &&
    lines.includes(
      'A:AB$ Mana | Cost$ T | Produced$ Any | Amount$ 1 | SpellDescription$ Add one mana of any color.',
    ) &&
    lines.includes(
      'A:AB$ PutCounter | Cost$ T | CounterType$ CHARGE | CounterNum$ 1 | SpellDescription$ Put a charge counter on CARDNAME.',
    ) &&
    lines.includes(
      'T:Mode$ Phase | Phase$ Main1 | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigRemove | TriggerDescription$ At the beginning of your first main phase, remove all charge counters from CARDNAME. Add one mana of any color for each charge counter removed this way.',
    ) &&
    lines.includes(
      'SVar:TrigRemove:DB$ RemoveCounter | CounterType$ CHARGE | CounterNum$ All | RememberRemoved$ True | SubAbility$ TrigGetMana',
    ) &&
    lines.includes(
      'SVar:TrigGetMana:DB$ Mana | Produced$ Combo Any | Amount$ NumRemoved | SubAbility$ DBCleanup',
    ) &&
    lines.includes('SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True') &&
    lines.includes('SVar:NumRemoved:Count$RememberedSize');
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exact || !base.includes('multi-mana combo')) {
    return [...new Set([...base, 'exact reviewed Coalition Relic composition'])];
  }
  return base.filter((refusal) => refusal !== 'multi-mana combo');
}

/** Closed whole-card boundary for Cryptic Command's two distinct modes. */
export function legacyCubeReviewedCrypticCommandRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Cryptic Command',
    'ManaCost:1 U U U',
    'Types:Instant',
    'A:SP$ Charm | Choices$ DBCounter,DBReturn,DBTapAll,DBDraw | CharmNum$ 2',
    'SVar:DBCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Counter target spell.',
    "SVar:DBReturn:DB$ ChangeZone | Origin$ Battlefield | Destination$ Hand | ValidTgts$ Permanent | AILogic$ Good | SpellDescription$ Return target permanent to its owner's hand.",
    'SVar:DBTapAll:DB$ TapAll | ValidCards$ Creature.OppCtrl | AILogic$ AtLeast3 | SpellDescription$ Tap all creatures your opponents control.',
    'SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1 | SpellDescription$ Draw a card.',
    "Oracle:Choose two —\\n• Counter target spell.\\n• Return target permanent to its owner's hand.\\n• Tap all creatures your opponents control.\\n• Draw a card.",
  ].join('\n');
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes('retarget ability')) {
    return [...new Set([...base, 'exact reviewed Cryptic Command composition'])];
  }
  return base.filter((refusal) => refusal !== 'retarget ability');
}

/** Closed whole-card boundary for Prismari Command's exact two distinct modes. */
export function legacyCubeReviewedPrismariCommandRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Prismari Command',
    'ManaCost:1 U R',
    'Types:Instant',
    'A:SP$ Charm | Choices$ DBShock,DBLoot,DBTreasure,DBShatter | CharmNum$ 2',
    'SVar:DBShock:DB$ DealDamage | ValidTgts$ Any | TgtPrompt$ Select any target to deal 2 damage to | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.',
    'SVar:DBLoot:DB$ Draw | NumCards$ 2 | ValidTgts$ Player | TgtPrompt$ Select target player to draw two cards, then discard two cards | Defined$ ThisTargetedPlayer | SubAbility$ DBDiscard | SpellDescription$ Target player draws two cards, then discards two cards.',
    'SVar:DBDiscard:DB$ Discard | Defined$ ParentTarget | NumCards$ 2 | Mode$ TgtChoose',
    'SVar:DBTreasure:DB$ Token | ValidTgts$ Player | TgtPrompt$ Select target player to create a Treasure token | TokenScript$ c_a_treasure_sac | TokenOwner$ ThisTargetedPlayer | SpellDescription$ Target player creates a Treasure token.',
    'SVar:DBShatter:DB$ Destroy | ValidTgts$ Artifact | TgtPrompt$ Select target artifact to destroy | Defined$ ThisTargetedCard | SpellDescription$ Destroy target artifact.',
    'DeckHas:Ability$Token',
    'Oracle:Choose two —\\n• Prismari Command deals 2 damage to any target.\\n• Target player draws two cards, then discards two cards.\\n• Target player creates a Treasure token.\\n• Destroy target artifact.',
  ].join('\n');
  const blockers = [
    'transitive generated-object decision source',
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
  ];
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || blockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Prismari Command composition'])];
  }
  return base.filter((refusal) => !blockers.includes(refusal));
}

/** Closed whole-card boundary for Blessed Alliance's exact Escalate composition. */
export function legacyCubeReviewedBlessedAllianceRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Blessed Alliance',
    'ManaCost:1 W',
    'Types:Instant',
    'K:Escalate:2',
    'A:SP$ Charm | MinCharmNum$ 1 | CharmNum$ 3 | Choices$ DBGainLife,DBUntap,DBSacrifice',
    'SVar:DBGainLife:DB$ GainLife | ValidTgts$ Player | TgtPrompt$ Select target player (to gain 4 life) | LifeAmount$ 4 | SpellDescription$ Target player gains 4 life.',
    'SVar:DBUntap:DB$ Untap | ValidTgts$ Creature | TargetMin$ 0 | TargetMax$ 2 | SpellDescription$ Untap up to two target creatures.',
    'SVar:DBSacrifice:DB$ Sacrifice | ValidTgts$ Opponent | TgtPrompt$ Select target player (to sacrifice an attacking creature) | SacValid$ Creature.attacking | SacMessage$ Creature | SpellDescription$ Target opponent sacrifices an attacking creature.',
    'Oracle:Escalate {2} (Pay this cost for each mode chosen beyond the first.)\\nChoose one or more —\\n• Target player gains 4 life.\\n• Untap up to two target creatures.\\n• Target opponent sacrifices an attacking creature.',
  ].join('\n');
  const blockers = ['optional target', 'multiple targets', 'unbounded decision token keyword:Escalate'];
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || blockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Blessed Alliance composition'])];
  }
  return base.filter((refusal) => !blockers.includes(refusal));
}

/** Closed whole-card boundary for Kalitas's replacement and activated ability. */
export function legacyCubeReviewedKalitasRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Kalitas, Traitor of Ghet',
    'ManaCost:2 B B',
    'Types:Legendary Creature Vampire Warrior',
    'PT:3/4',
    'K:Lifelink',
    'R:Event$ Moved | ActiveZones$ Battlefield | Origin$ Battlefield | Destination$ Graveyard | ValidLKI$ Creature.!token+OppCtrl | ReplaceWith$ Exile | Description$ If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.',
    'SVar:Exile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | SubAbility$ DBToken | Defined$ ReplacedCard',
    'SVar:DBToken:DB$ Token | TokenScript$ b_2_2_zombie | TokenOwner$ You',
    'A:AB$ PutCounter | Cost$ 2 B Sac<1/Vampire.Other;Zombie.Other/another Vampire or Zombie> | CounterType$ P1P1 | CounterNum$ 2 | SpellDescription$ Put two +1/+1 counters on CARDNAME.',
    'Oracle:Lifelink\\nIf a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.\\n{2}{B}, Sacrifice another Vampire or Zombie: Put two +1/+1 counters on Kalitas, Traitor of Ghet.',
  ].join('\n');
  const blocker = 'unbounded decision token semantic-marker:discard-or-sacrifice-cost';
  const base = [
    ...legacyCubePinnedGeneratedObjectRefusals(bytes, inventory),
    ...legacyCubeChosenCostPaymentRefusals(bytes, { allowReviewedKalitasCostPart: true }),
  ];
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Kalitas composition'])];
  }
  return [...new Set(base)].filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for Uro's Escape, triggers, and land placement. */
export function legacyCubeReviewedUroRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    "Name:Uro, Titan of Nature's Wrath",
    'ManaCost:1 G U',
    'Types:Legendary Creature Elder Giant',
    'PT:6/6',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSac | TriggerDescription$ When NICKNAME enters, sacrifice it unless it escaped.',
    'SVar:TrigSac:DB$ Sacrifice | SacValid$ Self | ConditionNotPresent$ Card.Self+escaped',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigGainLife | TriggerDescription$ When NICKNAME enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.',
    'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigGainLife | TriggerZones$ Battlefield | OptionalDecider$ You | Secondary$ True | TriggerDescription$ When NICKNAME enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.',
    'SVar:TrigGainLife:DB$ GainLife | LifeAmount$ 3 | SubAbility$ DBDraw',
    'SVar:DBDraw:DB$ Draw | Defined$ You | SubAbility$ DBLand',
    'SVar:DBLand:DB$ ChangeZone | Origin$ Hand | Destination$ Battlefield | ChangeType$ Land | ChangeNum$ 1',
    'K:Escape:G G U U ExileFromGrave<5/Card.Other/other>',
    'DeckHas:Ability$LifeGain',
    'Oracle:When Uro enters, sacrifice it unless it escaped.\\nWhenever Uro enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.\\nEscape—{G}{G}{U}{U}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)',
  ].join('\n');
  const blockers = [
    'unbounded decision token keyword:Escape',
    'unbounded decision token parameter-key:OptionalDecider',
  ];
  const base = [
    ...legacyCubeStatedOrderingRefusals(bytes, inventory),
    ...legacyCubeChosenCostPaymentRefusals(bytes, { allowReviewedTitanEscapeCostPart: true }),
  ];
  if (script !== exactScript || blockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Uro composition'])];
  }
  return [...new Set(base)].filter((refusal) => !blockers.includes(refusal));
}

/** Closed whole-card boundary for Kroxa's Escape and opponent-discard chain. */
export function legacyCubeReviewedKroxaRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    "Name:Kroxa, Titan of Death's Hunger",
    'ManaCost:B R',
    'Types:Legendary Creature Elder Giant',
    'PT:6/6',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSac | TriggerDescription$ When NICKNAME enters, sacrifice it unless it escaped.',
    'SVar:TrigSac:DB$ Sacrifice | SacValid$ Self | ConditionNotPresent$ Card.Self+escaped',
    "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ DBDiscard | TriggerDescription$ Whenever NICKNAME enters or attacks, each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life.",
    "T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ DBDiscard | Secondary$ True | TriggerDescription$ Whenever NICKNAME enters or attacks, each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life.",
    'SVar:DBDiscard:DB$ Discard | Mode$ TgtChoose | Defined$ Player.Opponent | NumCards$ 1 | RememberDiscarded$ True | SubAbility$ DBRepeat',
    'SVar:DBRepeat:DB$ RepeatEach | RepeatPlayers$ Player.Opponent | RepeatSubAbility$ DBLoseLife | SubAbility$ DBCleanup',
    'SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 3 | ConditionCheckSVar$ X | ConditionSVarCompare$ EQ0 | Defined$ Player.IsRemembered',
    'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    'SVar:X:Remembered$Valid Card.nonLand+RememberedPlayerOwn',
    'K:Escape:B B R R ExileFromGrave<5/Card.Other/other>',
    "Oracle:When Kroxa enters, sacrifice it unless it escaped.\\nWhenever Kroxa enters or attacks, each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life.\\nEscape—{B}{B}{R}{R}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)",
  ].join('\n');
  const blocker = 'unbounded decision token keyword:Escape';
  const base = [
    ...legacyCubeStatedOrderingRefusals(bytes, inventory),
    ...legacyCubeChosenCostPaymentRefusals(bytes, { allowReviewedTitanEscapeCostPart: true }),
  ];
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Kroxa composition'])];
  }
  return [...new Set(base)].filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for Huntmaster's exact transform and damage composition. */
export function legacyCubeReviewedHuntmasterRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Huntmaster of the Fells',
    'ManaCost:2 R G',
    'Types:Creature Human Werewolf',
    'PT:2/2',
    'T:Mode$ ChangesZone | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TokenAndLife | TriggerDescription$ Whenever this creature enters or transforms into CARDNAME, create a 2/2 green Wolf creature token and you gain 2 life.',
    'T:Mode$ Transformed | ValidCard$ Card.Self | Execute$ TokenAndLife | Secondary$ True | TriggerDescription$ Whenever this creature enters or transforms into CARDNAME, create a 2/2 green Wolf creature token and you gain 2 life.',
    'SVar:TokenAndLife:DB$ Token | TokenOwner$ You | TokenScript$ g_2_2_wolf | SubAbility$ Life',
    'SVar:Life:DB$ GainLife | Defined$ You | LifeAmount$ 2',
    'T:Mode$ Phase | Phase$ Upkeep | WerewolfTransformCondition$ True | TriggerZones$ Battlefield | Execute$ TrigTransform | TriggerDescription$ At the beginning of each upkeep, if no spells were cast last turn, transform CARDNAME.',
    'SVar:TrigTransform:DB$ SetState | Defined$ Self | Mode$ Transform',
    'AlternateMode:DoubleFaced',
    'Oracle:Whenever this creature enters or transforms into Huntmaster of the Fells, create a 2/2 green Wolf creature token and you gain 2 life.\\nAt the beginning of each upkeep, if no spells were cast last turn, transform Huntmaster of the Fells.',
    '',
    'ALTERNATE',
    '',
    'Name:Ravager of the Fells',
    'ManaCost:no cost',
    'Colors:green,red',
    'Types:Creature Werewolf',
    'PT:4/4',
    'K:Trample',
    "T:Mode$ Transformed | ValidCard$ Card.Self | Execute$ DamageAndMoreDamage | TriggerDescription$ Whenever this creature transforms into CARDNAME, it deals 2 damage to target opponent or planeswalker and 2 damage to up to one target creature that player or that planeswalker's controller controls.",
    'SVar:DamageAndMoreDamage:DB$ DealDamage | ValidTgts$ Opponent,Planeswalker | TgtPrompt$ Select target player or planeswalker | NumDmg$ 2 | DamageMap$ True | SubAbility$ MoreDamage',
    "SVar:MoreDamage:DB$ DealDamage | ValidTgts$ Creature.ControlledBy TargetedOrController | TgtPrompt$ Select up to one target creature that player or that planeswalker's controller controls | TargetMin$ 0 | TargetMax$ 1 | NumDmg$ 2 | SubAbility$ DBDamageResolve",
    'SVar:DBDamageResolve:DB$ DamageResolve',
    'T:Mode$ Phase | Phase$ Upkeep | WerewolfUntransformCondition$ True | TriggerZones$ Battlefield | Execute$ TrigTransform | TriggerDescription$ At the beginning of each upkeep, if a player cast two or more spells last turn, transform CARDNAME.',
    'SVar:TrigTransform:DB$ SetState | Defined$ Self | Mode$ Transform',
    "Oracle:Trample\\nWhenever this creature transforms into Ravager of the Fells, it deals 2 damage to target opponent or planeswalker and 2 damage to up to one target creature that player or that planeswalker's controller controls.\\nAt the beginning of each upkeep, if a player cast two or more spells last turn, transform Ravager of the Fells.",
  ].join('\n');
  const blockers = [
    'trigger target',
    'nested target block',
    'optional target',
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token semantic-marker:alternate-mode',
  ];
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || blockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Huntmaster composition'])];
  }
  return base.filter((refusal) => !blockers.includes(refusal));
}

/** Closed whole-card boundary for the four remaining exact planeswalker scripts. */
export function legacyCubeReviewedRemainingPlaneswalkersRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const expectedBlockers = new Map<string, readonly string[]>([
    [
      '724017714f9470945e28c01d5f094a9cd29e4497b40da215e62675b572885948',
      ['optional target', 'unbounded decision token semantic-marker:alternate-mode'],
    ],
    [
      '790a4140fa5dd5ad317e96dfdbb36fe3dfbd01a2732ca912c22518f71d92b800',
      ['optional target', 'trigger target', 'unbounded decision token semantic-marker:alternate-mode'],
    ],
    [
      '501ac2c4b22d667d017b86b30c576b49350091ea01ebba6045dfc27c4ce46292',
      [
        'unpinned generated-object source',
        'unbounded decision token ability-api:Token',
        'unbounded decision token parameter-key:Optional',
        'unbounded decision token semantic-marker:optional-trigger-or-replacement',
      ],
    ],
    [
      '18a0795deada55ad4ab2003fa1348b855f616f3050100dd5c2b4b941246a11e1',
      [
        'optional target',
        'multiple targets',
        'unpinned generated-object source',
        'unbounded decision token ability-api:Token',
        'unbounded decision token parameter-key:OptionalDecider',
        'unbounded decision token parameter-key:ShuffleNonMandatory',
        'unbounded decision token semantic-marker:alternate-mode',
      ],
    ],
  ]).get(exactSha256);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (expectedBlockers === undefined || expectedBlockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed remaining planeswalker composition'])];
  }
  return base.filter((refusal) => !expectedBlockers.includes(refusal));
}

/** Closed whole-card boundary for the six final official Legacy Cube scripts. */
export function legacyCubeReviewedFinalSixRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const expectedBlockers = new Map<string, readonly string[]>([
    [
      '57029529e28ce7e934ffe8f3345b3e2342dfdff0e16f21fbd58e3c8c18d7be9b',
      [
        'optional target',
        'choice cost',
        'unbounded decision token ability-api:Proliferate',
        'unbounded decision token parameter-key:DiscardCost',
        'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
      ],
    ],
    [
      '08307f6386d8b1d8fd3b465db542f5028028362d57e0005ad5bba51b04a1f9c7',
      [
        'unpinned generated-object source',
        'unbounded decision token ability-api:Token',
        'unbounded decision token parameter-key:OptionalDecider',
      ],
    ],
    [
      '96808028aad1343f0ffaf5767af7a384bbae62c21cec786e634eba8168037f19',
      [
        'unbounded decision token parameter-key:ChooseOrder',
        'unbounded decision token parameter-key:UnlessCost',
        'unbounded decision token semantic-marker:triggered-payment',
      ],
    ],
    [
      'ae3b9acc396cc492d919ce29b66ebf77d53ed843df8fb67bbb24a55799a5b402',
      [
        'unbounded decision token ability-api:AnimateAll',
        'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
      ],
    ],
    [
      'e115da3032bf3dbcd6ff088c20919b2781799aec7188ac37fb42a526c5a1553c',
      [
        'trigger target',
        'unpinned generated-object source',
        'unbounded decision token ability-api:Token',
        'unbounded decision token keyword:Mutate',
      ],
    ],
    [
      'dfaa4087dfc17fcebc11223a0bcfe24ea623f1f452e6778abe285441a7e558ee',
      [
        'choice cost',
        'unbounded decision token ability-api:ControlPlayer',
        'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
      ],
    ],
  ]).get(exactSha256);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (expectedBlockers === undefined || expectedBlockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed final-six composition'])];
  }
  return base.filter((refusal) => !expectedBlockers.includes(refusal));
}

/** Closed whole-card boundary for Phantasmal Image's optional copy replacement. */
export function legacyCubeReviewedPhantasmalImageRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Phantasmal Image',
    'ManaCost:1 U',
    'Types:Creature Illusion',
    'PT:0/0',
    '# Make Svars for granting abilities and triggers on clones distinct to avoid SVars getting overwritten when cloning a clone',
    'K:ETBReplacement:Copy:DBCopy:Optional',
    'SVar:DBCopy:DB$ Clone | Choices$ Creature.Other | AddTypes$ Illusion | AddTriggers$ PhantasmalImageTgtTrig | AddSVars$ PhantasmalImageSac,Targeting | SpellDescription$ You may have CARDNAME enter as a copy of any creature on the battlefield, except it\'s an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."',
    'SVar:PhantasmalImageTgtTrig:Mode$ BecomesTarget | ValidTarget$ Card.Self | Execute$ PhantasmalImageSac | TriggerDescription$ When this creature becomes the target of a spell or ability, sacrifice it.',
    'SVar:PhantasmalImageSac:DB$ Sacrifice',
    'SVar:Targeting:Dies',
    'SVar:NeedsToPlay:Creature',
    'Oracle:You may have Phantasmal Image enter as a copy of any creature on the battlefield, except it\'s an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."',
  ].join('\n');
  const blocker = 'unbounded decision token semantic-marker:optional-copy-replacement';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Phantasmal Image composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for the two reviewed PeekAndReveal compositions. */
export function legacyCubeReviewedPeekAndRevealRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const delver = [
    'Name:Delver of Secrets',
    'ManaCost:U',
    'Types:Creature Human Wizard',
    'PT:1/1',
    'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigPeek | TriggerDescription$ At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform CARDNAME.',
    'SVar:TrigPeek:DB$ PeekAndReveal | PeekAmount$ 1 | RevealOptional$ True | RememberRevealed$ True | AILogic$ InstantOrSorcery | SubAbility$ DBTransform',
    'SVar:DBTransform:DB$ SetState | Defined$ Self | Mode$ Transform | ConditionDefined$ Remembered | ConditionPresent$ Card.Instant,Card.Sorcery | ConditionCompare$ EQ1 | SubAbility$ DBCleanup',
    'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    'DeckHints:Type$Instant|Sorcery',
    'AlternateMode:DoubleFaced',
    'Oracle:At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.',
    '',
    'ALTERNATE',
    '',
    'Name:Insectile Aberration',
    'ManaCost:no cost',
    'Colors:blue',
    'Types:Creature Human Insect',
    'PT:3/2',
    'K:Flying',
    'Oracle:Flying',
  ].join('\n');
  const velomachus = [
    'Name:Velomachus Lorehold',
    'ManaCost:5 R W',
    'Types:Legendary Creature Elder Dragon',
    'PT:5/5',
    'K:Flying',
    'K:Vigilance',
    'K:Haste',
    "T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigLook | TriggerDescription$ Whenever CARDNAME attacks, look at the top seven cards of your library. You may cast an instant or sorcery spell with mana value less than or equal to CARDNAME's power from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.",
    'SVar:TrigLook:DB$ PeekAndReveal | Defined$ You | PeekAmount$ 7 | NoReveal$ True | RememberPeeked$ True | SubAbility$ DBPlay | SpellDescription$ Look at the top six cards of your library. You may cast a spell from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.',
    'SVar:DBPlay:DB$ Play | ValidZone$ Library | Valid$ Card.IsRemembered | ValidSA$ Instant.cmcLEX,Sorcery.cmcLEX | Controller$ You | WithoutManaCost$ True | Optional$ True | Amount$ 1 | ForgetPlayed$ True | SubAbility$ DBRestRandomOrder',
    'SVar:DBRestRandomOrder:DB$ ChangeZoneAll | ChangeType$ Card.IsRemembered | Origin$ Library | Destination$ Library | LibraryPosition$ -1 | RandomOrder$ True | SubAbility$ DBCleanup',
    'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    'SVar:X:Count$CardPower',
    'SVar:HasAttackEffect:TRUE',
    'SVar:PlayMain1:TRUE',
    'DeckNeeds:Type$Instant|Sorcery',
    "Oracle:Flying, vigilance, haste\\nWhenever Velomachus Lorehold attacks, look at the top seven cards of your library. You may cast an instant or sorcery spell with mana value less than or equal to Velomachus Lorehold's power from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.",
  ].join('\n');
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  const delverBlockers = [
    'unbounded decision token ability-api:PeekAndReveal',
    'unbounded decision token parameter-key:RevealOptional',
    'unbounded decision token semantic-marker:alternate-mode',
  ];
  const velomachusBlockers = [
    'unbounded decision token ability-api:PeekAndReveal',
    'unbounded decision token parameter-key:Optional',
    'unbounded decision token semantic-marker:optional-trigger-or-replacement',
  ];
  const blockers = script === delver ? delverBlockers : script === velomachus ? velomachusBlockers : [];
  if (blockers.length === 0 || blockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed PeekAndReveal composition'])];
  }
  return base.filter((refusal) => !blockers.includes(refusal));
}

/** Closed whole-card boundary for Glasspool Mimic and Phyrexian Metamorph. */
export function legacyCubeReviewedOptionalCopyReplacementRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const glasspool = [
    'Name:Glasspool Mimic',
    'ManaCost:2 U',
    'Types:Creature Shapeshifter Rogue',
    'PT:0/0',
    'K:ETBReplacement:Copy:DBCopy:Optional',
    "SVar:DBCopy:DB$ Clone | Choices$ Creature.YouCtrl | AddTypes$ Shapeshifter & Rogue | SpellDescription$ You may have CARDNAME enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types.",
    'AlternateMode:Modal',
    "Oracle:You may have Glasspool Mimic enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types.",
    '',
    'ALTERNATE',
    '',
    'Name:Glasspool Shore',
    'ManaCost:no cost',
    'Types:Land',
    'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.',
    'SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True',
    'A:AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add {U}.',
    'Oracle:Glasspool Shore enters tapped.\\n{T}: Add {U}.',
  ].join('\n');
  const metamorph = [
    'Name:Phyrexian Metamorph',
    'ManaCost:3 UP',
    'Types:Artifact Creature Phyrexian Shapeshifter',
    'PT:0/0',
    'K:ETBReplacement:Copy:DBCopy:Optional',
    "SVar:DBCopy:DB$ Clone | Choices$ Creature.Other,Artifact.Other | AddTypes$ Artifact | SpellDescription$ You may have CARDNAME enter as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
    "Oracle:({U/P} can be paid with either {U} or 2 life.)\\nYou may have Phyrexian Metamorph enter as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
  ].join('\n');
  const lifted =
    script === glasspool
      ? new Set([
          'unbounded decision token semantic-marker:alternate-mode',
          'unbounded decision token semantic-marker:optional-copy-replacement',
        ])
      : script === metamorph
        ? new Set([
            'Phyrexian mana cost',
            'unbounded decision token semantic-marker:optional-copy-replacement',
          ])
        : null;
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (lifted === null || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed optional-copy replacement composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Karn Liberated's game restart lifecycle. */
export function legacyCubeReviewedKarnLiberatedRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Karn Liberated',
    'ManaCost:7',
    'Types:Legendary Planeswalker Karn',
    'Loyalty:6',
    'A:AB$ ChangeZone | Cost$ AddCounter<4/LOYALTY> | Planeswalker$ True | ValidTgts$ Player | Origin$ Hand | Destination$ Exile | ChangeType$ Card | ChangeNum$ 1 | Chooser$ Targeted | Hidden$ True | IsCurse$ True | Mandatory$ True | SpellDescription$ Target player exiles a card from their hand.',
    'A:AB$ ChangeZone | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | ValidTgts$ Permanent | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Exile target permanent.',
    'A:AB$ RestartGame | Cost$ SubCounter<14/LOYALTY> | Planeswalker$ True | Ultimate$ True | RestrictFromZone$ Exile | RestrictFromValid$ Card.!ExiledWithSource,Spell,Card.Aura | SubAbility$ ReturnFromExile | SpellDescription$ Restart the game, leaving in exile all non-Aura permanent cards exiled with CARDNAME. Then put those cards onto the battlefield under your control.',
    'SVar:ReturnFromExile:DB$ ChangeZoneAll | ChangeType$ Permanent.nonAura+ExiledWithSource | Origin$ Exile | Destination$ Battlefield | GainControl$ True',
    'Oracle:[+4]: Target player exiles a card from their hand.\\n[-3]: Exile target permanent.\\n[-14]: Restart the game, leaving in exile all non-Aura permanent cards exiled with Karn Liberated. Then put those cards onto the battlefield under your control.',
  ].join('\n');
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes('game-restart lifecycle')) {
    return [...new Set([...base, 'exact reviewed Karn Liberated composition'])];
  }
  return base.filter((refusal) => refusal !== 'game-restart lifecycle');
}

/** Closed whole-card boundary for Rattleclaw Mystic's Morph lifecycle. */
export function legacyCubeReviewedRattleclawMysticRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Rattleclaw Mystic',
    'ManaCost:1 G',
    'Types:Creature Human Shaman',
    'PT:2/1',
    'K:Morph:2',
    'A:AB$ Mana | Cost$ T | Produced$ Combo G U R | SpellDescription$ Add {G}, {U}, or {R}.',
    'T:Mode$ TurnFaceUp | ValidCard$ Card.Self | Execute$ TrigMana | TriggerZones$ Battlefield | TriggerDescription$ When CARDNAME is turned face up, add {G}{U}{R}.',
    'SVar:TrigMana:DB$ Mana | Produced$ G U R',
    'Oracle:{T}: Add {G}, {U}, or {R}.\\nMorph {2} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)\\nWhen Rattleclaw Mystic is turned face up, add {G}{U}{R}.',
  ].join('\n');
  const blocker = 'unbounded decision token keyword:Morph';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Rattleclaw Mystic composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for Lightning Phoenix's optional triggered payment. */
export function legacyCubeReviewedLightningPhoenixRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Lightning Phoenix',
    'ManaCost:2 R',
    'Types:Creature Phoenix',
    'PT:2/2',
    'K:Flying',
    'K:Haste',
    "S:Mode$ CantBlock | ValidCard$ Card.Self | Description$ CARDNAME can't block.",
    'T:Mode$ Phase | Phase$ End of Turn | ValidPlayer$ You | Execute$ TrigReturn | TriggerZones$ Graveyard | CheckSVar$ X | SVarCompare$ GE3 | TriggerDescription$ At the beginning of your end step, if an opponent was dealt 3 or more damage this turn, you may pay {R}. If you do, return CARDNAME from your graveyard to the battlefield.',
    'SVar:TrigReturn:AB$ ChangeZone | Cost$ R | Defined$ Self | Origin$ Graveyard | Destination$ Battlefield',
    'SVar:X:Count$MaxOppDamageThisTurn',
    "Oracle:Flying, haste\\nLightning Phoenix can't block.\\nAt the beginning of your end step, if an opponent was dealt 3 or more damage this turn, you may pay {R}. If you do, return Lightning Phoenix from your graveyard to the battlefield.",
  ].join('\n');
  const blocker = 'unbounded decision token semantic-marker:triggered-payment';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Lightning Phoenix composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for Baral's optional draw-then-discard trigger. */
export function legacyCubeReviewedBaralRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Baral, Chief of Compliance',
    'ManaCost:1 U',
    'Types:Legendary Creature Human Wizard',
    'PT:1/3',
    'S:Mode$ ReduceCost | ValidCard$ Instant,Sorcery | Type$ Spell | Activator$ You | Amount$ 1 | Description$ Instant and sorcery spells you cast cost {1} less to cast.',
    'T:Mode$ Countered | ValidCause$ SpellAbility.YouCtrl | ValidSA$ Spell | TriggerZones$ Battlefield | Execute$ TrigLoot | TriggerDescription$ Whenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.',
    'SVar:TrigLoot:AB$ Discard | Defined$ You | Mode$ TgtChoose | NumCards$ 1 | Cost$ Draw<1/You>',
    'DeckHints:Type$Instant|Sorcery',
    'Oracle:Instant and sorcery spells you cast cost {1} less to cast.\\nWhenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.',
  ].join('\n');
  const blocker = 'unbounded decision token semantic-marker:triggered-payment';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Baral composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for the two reviewed UnlessCost draw compositions. */
export function legacyCubeReviewedUnlessCostRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScripts = [
    [
      'Name:Esper Sentinel',
      'ManaCost:W',
      'Types:Artifact Creature Human Soldier',
      'PT:1/1',
      "T:Mode$ SpellCast | ValidCard$ Card.nonCreature | ValidActivatingPlayer$ Player.Opponent | ActivatorThisTurnCast$ EQ1 | Execute$ TrigDraw | TriggerZones$ Battlefield | TriggerDescription$ Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is CARDNAME's power.",
      'SVar:TrigDraw:DB$ Draw | Defined$ You | UnlessCost$ X | UnlessPayer$ TriggeredActivator | NumCards$ 1',
      'SVar:X:Count$CardPower',
      "Oracle:Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is Esper Sentinel's power.",
    ].join('\n'),
    [
      'Name:Nahiri, the Harbinger',
      'ManaCost:2 R W',
      'Types:Legendary Planeswalker Nahiri',
      'Loyalty:4',
      'A:AB$ Draw | Cost$ AddCounter<2/LOYALTY> | Planeswalker$ True | Defined$ You | NumCards$ 1 | UnlessCost$ Discard<1/Card> | UnlessSwitched$ True | UnlessPayer$ You | SpellDescription$ You may discard a card. If you do, draw a card.',
      'A:AB$ ChangeZone | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | ValidTgts$ Enchantment,Artifact.tapped,Creature.tapped | TgtPrompt$ Select target enchantment, tapped artifact, or tapped creature | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Exile target enchantment, tapped artifact, or tapped creature.',
      'A:AB$ ChangeZone | Cost$ SubCounter<8/LOYALTY> | Planeswalker$ True | Ultimate$ True | Origin$ Library | Destination$ Battlefield | ChangeType$ Artifact,Creature | RememberChanged$ True | SubAbility$ DBPump | SpellDescription$ Search your library for an artifact or creature card, put it onto the battlefield, then shuffle. It gains haste. Return it to your hand at the beginning of the next end step.',
      'SVar:DBPump:DB$ Animate | Keywords$ Haste | Duration$ Permanent | AtEOT$ Hand | Defined$ Remembered | SubAbility$ DBCleanup',
      'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
      'DeckHas:Ability$Discard',
      'Oracle:[+2]: You may discard a card. If you do, draw a card.\\n[-2]: Exile target enchantment, tapped artifact, or tapped creature.\\n[-8]: Search your library for an artifact or creature card, put it onto the battlefield, then shuffle. It gains haste. Return it to your hand at the beginning of the next end step.',
    ].join('\n'),
  ];
  const blocker = 'unbounded decision token parameter-key:UnlessCost';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exactScripts.includes(script) || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed UnlessCost composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for the four reviewed Stack-target counter payments. */
export function legacyCubeReviewedCounterUnlessCostRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScripts = [
    [
      'Name:Mana Tithe',
      'ManaCost:W',
      'Types:Instant',
      'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | UnlessCost$ 1 | SpellDescription$ Counter target spell unless its controller pays {1}.',
      'Oracle:Counter target spell unless its controller pays {1}.',
    ].join('\n'),
    [
      'Name:Pact of Negation',
      'ManaCost:0',
      'Colors:blue',
      'Types:Instant',
      "A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | SubAbility$ DBDelTrig | SpellDescription$ Counter target spell. At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.",
      "SVar:DBDelTrig:DB$ DelayedTrigger | Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigLoseGame | TriggerDescription$ At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.",
      'SVar:TrigLoseGame:DB$ LosesGame | UnlessCost$ 3 U U | UnlessPayer$ You | Defined$ You',
      'SVar:NeedsToPlayVar:NumLands GE5',
      'SVar:NumLands:Count$Valid Land.YouCtrl',
      'AI:RemoveDeck:All',
      "Oracle:Counter target spell.\\nAt the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.",
    ].join('\n'),
    [
      'Name:Mana Leak',
      'ManaCost:1 U',
      'Types:Instant',
      'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | UnlessCost$ 3 | SpellDescription$ Counter target spell unless its controller pays {3}.',
      'Oracle:Counter target spell unless its controller pays {3}.',
    ].join('\n'),
    [
      'Name:Supreme Will',
      'ManaCost:2 U',
      'Types:Instant',
      'A:SP$ Charm | Choices$ DBCounter,DBDig | Defined$ You',
      'SVar:DBCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Select target spell | UnlessCost$ 3 | SpellDescription$ Counter target spell unless its controller pays {3}.',
      'SVar:DBDig:DB$ Dig | DigNum$ 4 | ChangeNum$ 1 | NoReveal$ True | SpellDescription$ Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.',
      'Oracle:Choose one —\\n• Counter target spell unless its controller pays {3}.\\n• Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.',
    ].join('\n'),
  ];
  const lifted = new Set(['retarget ability', 'unbounded decision token parameter-key:UnlessCost']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exactScripts.includes(script) || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed counter UnlessCost composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Miscalculation's Stack-counter and Cycling composition. */
export function legacyCubeReviewedMiscalculationRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Miscalculation',
    'ManaCost:1 U',
    'Types:Instant',
    'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | UnlessCost$ 2 | SpellDescription$ Counter target spell unless its controller pays {2}.',
    'K:Cycling:2',
    'Oracle:Counter target spell unless its controller pays {2}.\\nCycling {2} ({2}, Discard this card: Draw a card.)',
  ].join('\n');
  const lifted = new Set([
    'retarget ability',
    'unbounded decision token parameter-key:UnlessCost',
    'unbounded decision token keyword:Cycling',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Miscalculation composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Maul's triggered Attach and exact Equip composition. */
export function legacyCubeReviewedMaulOfTheSkyclavesRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Maul of the Skyclaves',
    'ManaCost:2 W',
    'Types:Artifact Equipment',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigAttach | TriggerDescription$ When CARDNAME enters, attach it to target creature you control.',
    'SVar:TrigAttach:DB$ Attach | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control',
    'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Flying & First Strike | Description$ Equipped creature gets +2/+2 and has flying and first strike.',
    'K:Equip:2 W W',
    'SVar:NeedsToPlay:Creature.YouCtrl',
    'Oracle:When Maul of the Skyclaves enters, attach it to target creature you control.\\nEquipped creature gets +2/+2 and has flying and first strike.\\nEquip {2}{W}{W}',
  ].join('\n');
  const lifted = new Set(['attachment target', 'trigger target', 'unbounded decision token keyword:Equip']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Maul of the Skyclaves composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Embercleave's exact reducer, Attach, and Equip composition. */
export function legacyCubeReviewedEmbercleaveRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Embercleave',
    'ManaCost:4 R R',
    'Types:Legendary Artifact Equipment',
    'K:Flash',
    'S:Mode$ ReduceCost | ValidCard$ Card.Self | Type$ Spell | Amount$ X | EffectZone$ All | Description$ This spell costs {1} less to cast for each attacking creature you control.',
    'SVar:X:Count$Valid Creature.attacking+YouCtrl',
    'SVar:BuffedBy:Creature.attacking',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigAttach | TriggerDescription$ When CARDNAME enters, attach it to target creature you control.',
    'SVar:TrigAttach:DB$ Attach | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control.',
    'SVar:NeedsToPlay:Creature.YouCtrl',
    'AI:RemoveDeck:All',
    'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Double Strike & Trample | Description$ Equipped creature gets +1/+1 and has double strike and trample.',
    'K:Equip:3',
    'Oracle:Flash\\nThis spell costs {1} less to cast for each attacking creature you control.\\nWhen Embercleave enters, attach it to target creature you control.\\nEquipped creature gets +1/+1 and has double strike and trample.\\nEquip {3}',
  ].join('\n');
  const lifted = new Set(['attachment target', 'trigger target', 'unbounded decision token keyword:Equip']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Embercleave composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for the exact Kaldra Compleat and Batterskull Living Weapon cohort. */
export function legacyCubeReviewedLivingWeaponRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactKaldraCompleat = [
    'Name:Kaldra Compleat',
    'ManaCost:7',
    'Types:Legendary Artifact Equipment',
    'K:Living Weapon',
    'K:Indestructible',
    'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 5 | AddToughness$ 5 | AddKeyword$ First Strike & Trample & Indestructible & Haste | AddTrigger$ TrigDamageDone | Description$ Equipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."',
    'SVar:TrigDamageDone:Mode$ DamageDone | CombatDamage$ True | ValidSource$ Card.Self | ValidTarget$ Creature | Execute$ TrigChangeZone | TriggerDescription$ Whenever this creature deals combat damage to a creature, exile that creature.',
    'SVar:TrigChangeZone:DB$ ChangeZone | Defined$ TriggeredTarget | Origin$ Battlefield | Destination$ Exile',
    'K:Equip:7',
    'Oracle:Living weapon\\nIndestructible\\nEquipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."\\nEquip {7}',
  ].join('\n');
  const exactBatterskull = [
    'Name:Batterskull',
    'ManaCost:5',
    'Types:Artifact Equipment',
    'K:Living Weapon',
    'K:Equip:5',
    'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 4 | AddToughness$ 4 | AddKeyword$ Vigilance & Lifelink | Description$ Equipped creature gets +4/+4 and has vigilance and lifelink.',
    "A:AB$ ChangeZone | Cost$ 3 | Origin$ Battlefield | Destination$ Hand | SpellDescription$ Return CARDNAME to its owner's hand.",
    'DeckHas:Ability$Token',
    "Oracle:Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)\\nEquipped creature gets +4/+4 and has vigilance and lifelink.\\n{3}: Return Batterskull to its owner's hand.\\nEquip {5}",
  ].join('\n');
  const lifted = new Set([
    'attachment target',
    'unbounded decision token keyword:Equip',
    'unbounded decision token keyword:Living Weapon',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (
    (script !== exactKaldraCompleat && script !== exactBatterskull) ||
    [...lifted].some((blocker) => !base.includes(blocker))
  ) {
    return [...new Set([...base, 'exact reviewed Living Weapon composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for the exact Starnheim and Alrund Foretell cohort. */
export function legacyCubeReviewedForetellRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactStarnheim = [
    'Name:Starnheim Unleashed',
    'ManaCost:2 W W',
    'Types:Sorcery',
    'A:SP$ Token | TokenAmount$ Y | TokenScript$ w_4_4_angel_warrior_flying_vigilance | SpellDescription$ Create a 4/4 white Angel Warrior creature token with flying and vigilance. If this spell was foretold, create X of those tokens instead.',
    'SVar:Y:Count$Foretold.X.1',
    'SVar:X:Count$xPaid',
    'K:Foretell:X X W',
    'DeckHas:Ability$Token',
    'Oracle:Create a 4/4 white Angel Warrior creature token with flying and vigilance. If this spell was foretold, create X of those tokens instead.\\nForetell {X}{X}{W} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)',
  ].join('\n');
  const exactAlrundsEpiphany = [
    "Name:Alrund's Epiphany",
    'ManaCost:5 U U',
    'Types:Sorcery',
    'A:SP$ Token | TokenAmount$ 2 | TokenScript$ u_1_1_bird_flying | TokenOwner$ You | SubAbility$ DBAddTurn | SpellDescription$ Create two 1/1 blue Bird creature tokens with flying. Take an extra turn after this one. Exile CARDNAME.',
    'SVar:DBAddTurn:DB$ AddTurn | Defined$ You | NumTurns$ 1 | SubAbility$ DBChange | StackDescription$ None',
    'SVar:DBChange:DB$ ChangeZone | Origin$ Stack | Destination$ Exile | StackDescription$ None',
    'K:Foretell:4 U U',
    'DeckHas:Ability$Token',
    "Oracle:Create two 1/1 blue Bird creature tokens with flying. Take an extra turn after this one. Exile Alrund's Epiphany.\\nForetell {4}{U}{U} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
  ].join('\n');
  const lifted = new Set([
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token keyword:Foretell',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (
    (script !== exactStarnheim && script !== exactAlrundsEpiphany) ||
    [...lifted].some((blocker) => !base.includes(blocker))
  ) {
    return [...new Set([...base, 'exact reviewed Foretell composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Satyr Wayfinder's optional four-card land Dig. */
export function legacyCubeReviewedSatyrWayfinderRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Satyr Wayfinder',
    'ManaCost:1 G',
    'Types:Creature Satyr',
    'PT:1/1',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDig | TriggerDescription$ When CARDNAME enters, reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.',
    'SVar:TrigDig:DB$ Dig | DigNum$ 4 | Reveal$ True | ChangeNum$ 1 | ChangeValid$ Land | DestinationZone2$ Graveyard | Optional$ True',
    'Oracle:When Satyr Wayfinder enters, reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.',
  ].join('\n');
  const lifted = new Set([
    'unbounded decision token parameter-key:Optional',
    'unbounded decision token semantic-marker:optional-trigger-or-replacement',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Satyr Wayfinder composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Augur, Search for Azcanta, and Narset's exact library views. */
export function legacyCubeReviewedBlueLibrarySelectionRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactAugur = [
    'Name:Augur of Bolas',
    'ManaCost:1 U',
    'Types:Creature Merfolk Wizard',
    'PT:1/3',
    'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigDig | TriggerDescription$ When CARDNAME enters, look at the top three cards from your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
    'SVar:TrigDig:DB$ Dig | DigNum$ 3 | ChangeNum$ 1 | Optional$ True | ChangeValid$ Instant,Sorcery',
    'Oracle:When Augur of Bolas enters, look at the top three cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
  ].join('\n');
  const exactNarset = [
    'Name:Narset, Parter of Veils',
    'ManaCost:1 U U',
    'Types:Legendary Planeswalker Narset',
    'Loyalty:5',
    "S:Mode$ CantDraw | ValidPlayer$ Opponent | DrawLimit$ 1 | Description$ Each opponent can't draw more than one card each turn.",
    'A:AB$ Dig | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | DigNum$ 4 | ChangeNum$ 1 | Optional$ True | ChangeValid$ Card.nonCreature+nonLand | ChangeValidDesc$ noncreature, nonland | RestRandomOrder$ True | ForceRevealToController$ True | SpellDescription$ Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.',
    "Oracle:Each opponent can't draw more than one card each turn.\\n[-2]: Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
  ].join('\n');
  const exactSearch = [
    'Name:Search for Azcanta',
    'ManaCost:1 U',
    'Types:Legendary Enchantment',
    'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigSurveil | TriggerDescription$ At the beginning of your upkeep, surveil 1. Then if you have seven or more cards in your graveyard, you may transform CARDNAME. (Look at the top card of your library. You may put that card into your graveyard.)',
    'SVar:TrigSurveil:DB$ Surveil | Amount$ 1 | SubAbility$ DBTransform | SpellDescription$ Surveil 1. Then if you have seven or more cards in your graveyard, you may transform CARDNAME (Look at the top card of your library. You may put that card into your graveyard.)',
    'SVar:DBTransform:DB$ SetState | Defined$ Self | Mode$ Transform | Optional$ True | ConditionPresent$ Card.YouOwn | ConditionZone$ Graveyard | ConditionCompare$ GE7',
    'DeckHas:Ability$Surveil|Graveyard',
    'AlternateMode:DoubleFaced',
    'Oracle:At the beginning of your upkeep, surveil 1. Then if you have seven or more cards in your graveyard, you may transform Search for Azcanta. (Look at the top card of your library. You may put that card into your graveyard.)',
    '',
    'ALTERNATE',
    '',
    'Name:Azcanta, the Sunken Ruin',
    'ManaCost:no cost',
    'Types:Legendary Land',
    'A:AB$ Mana | Cost$ T | Produced$ U | Amount$ 1 | SpellDescription$ Add {U}.',
    'A:AB$ Dig | Cost$ 2 U T | DigNum$ 4 | ChangeNum$ 1 | Optional$ True | ChangeValid$ Card.nonCreature+nonLand | SpellDescription$ Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
    'Oracle:(Transforms from Search for Azcanta.)\\n{T}: Add {U}.\\n{2}{U}, {T}: Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
  ].join('\n');
  const lifted = new Set([
    'unbounded decision token parameter-key:Optional',
    'unbounded decision token semantic-marker:alternate-mode',
    'unbounded decision token semantic-marker:optional-trigger-or-replacement',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  const exact = script === exactAugur || script === exactNarset || script === exactSearch;
  const required =
    script === exactSearch
      ? lifted
      : new Set(
          [...lifted].filter(
            (blocker) => blocker !== 'unbounded decision token semantic-marker:alternate-mode',
          ),
        );
  if (!exact || [...required].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed blue library-selection composition'])];
  }
  return base.filter((refusal) => !required.has(refusal));
}

/** Closed whole-card boundary for Gideon Blackblade, Bloodline Keeper, and Garruk Wildspeaker. */
export function legacyCubeReviewedGideonGarrukBloodlineRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactGideon = [
    'Name:Gideon Blackblade',
    'ManaCost:1 W W',
    'Types:Legendary Planeswalker Gideon',
    'Loyalty:4',
    "S:Mode$ Continuous | Affected$ Card.Self | EffectZone$ Battlefield | Condition$ PlayerTurn | SetPower$ 4 | SetToughness$ 4 | AddType$ Creature & Human & Soldier | AddKeyword$ Indestructible | Description$ During your turn, CARDNAME is a 4/4 Human Soldier creature with indestructible that's still a planeswalker.",
    'R:Event$ DamageDone | Prevent$ True | ValidTarget$ Card.Self | PlayerTurn$ True | Description$ Prevent all damage that would be dealt to CARDNAME during your turn.',
    'A:AB$ Pump | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Creature.YouCtrl+Other | TgtPrompt$ Select up to one target creature you control | KWChoice$ Vigilance,Lifelink,Indestructible | ConditionDefined$ Targeted | ConditionPresent$ Card | ConditionCompare$ GE1 | AILogic$ GideonBlackblade | SpellDescription$ Up to one other target creature you control gains your choice of vigilance, lifelink, or indestructible until end of turn. | StackDescription$ SpellDescription',
    'A:AB$ ChangeZone | Cost$ SubCounter<6/LOYALTY> | Planeswalker$ True | Ultimate$ True | ValidTgts$ Permanent.nonLand | TgtPrompt$ Select target nonland permanent | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Exile target nonland permanent.',
    'DeckHints:Ability$LifeGain',
    "Oracle:During your turn, Gideon Blackblade is a 4/4 Human Soldier creature with indestructible that's still a planeswalker.\\nPrevent all damage that would be dealt to Gideon Blackblade during your turn.\\n[+1]: Up to one other target creature you control gains your choice of vigilance, lifelink, or indestructible until end of turn.\\n[-6]: Exile target nonland permanent.",
  ].join('\n');
  const exactBloodline = [
    'Name:Bloodline Keeper',
    'ManaCost:2 B B',
    'Types:Creature Vampire',
    'PT:3/3',
    'K:Flying',
    'A:AB$ Token | Cost$ T | TokenOwner$ You | TokenScript$ b_2_2_vampire_flying | SpellDescription$ Create a 2/2 black Vampire creature token with flying.',
    'A:AB$ SetState | Cost$ B | Defined$ Self | IsPresent$ Card.Vampire+YouCtrl | PresentCompare$ GE5 | Mode$ Transform | SpellDescription$ Transform CARDNAME. Activate only if you control five or more Vampires.',
    'AlternateMode:DoubleFaced',
    'Oracle:Flying\\n{T}: Create a 2/2 black Vampire creature token with flying.\\n{B}: Transform Bloodline Keeper. Activate only if you control five or more Vampires.',
    '',
    'ALTERNATE',
    '',
    'Name:Lord of Lineage',
    'ManaCost:no cost',
    'Colors:black',
    'Types:Creature Vampire',
    'PT:5/5',
    'K:Flying',
    'S:Mode$ Continuous | Affected$ Creature.Vampire+Other+YouCtrl | AddPower$ 2 | AddToughness$ 2 | Description$ Other Vampire creatures you control get +2/+2.',
    'A:AB$ Token | Cost$ T | TokenOwner$ You | TokenScript$ b_2_2_vampire_flying | SpellDescription$ Create a 2/2 black Vampire creature token with flying.',
    'Oracle:Flying\\nOther Vampire creatures you control get +2/+2.\\n{T}: Create a 2/2 black Vampire creature token with flying.',
  ].join('\n');
  const exactGarruk = [
    'Name:Garruk Wildspeaker',
    'ManaCost:2 G G',
    'Types:Legendary Planeswalker Garruk',
    'Loyalty:3',
    'A:AB$ Untap | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | ValidTgts$ Land | TargetMin$ 2 | TargetMax$ 2 | SpellDescription$ Untap two target lands.',
    'A:AB$ Token | Cost$ SubCounter<1/LOYALTY> | Planeswalker$ True | TokenScript$ g_3_3_beast | TokenOwner$ You | SpellDescription$ Create a 3/3 green Beast creature token.',
    'A:AB$ PumpAll | Cost$ SubCounter<4/LOYALTY> | Planeswalker$ True | Ultimate$ True | ValidCards$ Creature.YouCtrl | NumAtt$ +3 | NumDef$ +3 | KW$ Trample | SpellDescription$ Creatures you control get +3/+3 and gain trample until end of turn.',
    'Oracle:[+1]: Untap two target lands.\\n[-1]: Create a 3/3 green Beast creature token.\\n[-4]: Creatures you control get +3/+3 and gain trample until end of turn.',
  ].join('\n');
  const liftedByScript =
    script === exactGideon
      ? new Set(['optional target', 'unbounded decision token parameter-key:KWChoice'])
      : script === exactBloodline
        ? new Set([
            'unpinned generated-object source',
            'unbounded decision token ability-api:Token',
            'unbounded decision token semantic-marker:alternate-mode',
          ])
        : script === exactGarruk
          ? new Set([
              'multiple targets',
              'unpinned generated-object source',
              'unbounded decision token ability-api:Token',
            ])
          : null;
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (liftedByScript === null || [...liftedByScript].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Gideon/Garruk/Bloodline composition'])];
  }
  return base.filter((refusal) => !liftedByScript.has(refusal));
}

/** Closed whole-card boundary for the two exact Hideaway 4 lands. */
export function legacyCubeReviewedHideawayRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactWindbrisk = [
    'Name:Windbrisk Heights',
    'ManaCost:no cost',
    'Types:Land',
    'K:Hideaway:4',
    'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.',
    'SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True',
    'A:AB$ Mana | Cost$ T | Produced$ W | SpellDescription$ Add {W}.',
    'A:AB$ Play | Cost$ W T | Defined$ ExiledWith | Amount$ All | Controller$ You | WithoutManaCost$ True | Optional$ True | ConditionCheckSVar$ X | ConditionSVarCompare$ GE3 | PlayerTurn$ True | SpellDescription$ You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.',
    'SVar:X:Count$AttackersDeclared',
    'Oracle:Hideaway 4 (When this permanent enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom of your library.)\\nWindbrisk Heights enters tapped.\\n{T}: Add {W}.\\n{W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.',
  ].join('\n');
  const exactShelldock = [
    'Name:Shelldock Isle',
    'ManaCost:no cost',
    'Types:Land',
    'K:Hideaway:4',
    'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.',
    'SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True',
    'A:AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add {U}.',
    'A:AB$ Play | Cost$ U T | Defined$ ExiledWith | Amount$ All | Controller$ You | WithoutManaCost$ True | Optional$ True | ConditionCheckSVar$ X | ConditionSVarCompare$ LE20 | SpellDescription$ You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.',
    'SVar:X:PlayerCountPlayers$LowestValidLibrary Card.YouOwn',
    'AI:RemoveDeck:Random',
    'Oracle:Hideaway 4 (When this permanent enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom of your library.)\\nShelldock Isle enters tapped.\\n{T}: Add {U}.\\n{U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.',
  ].join('\n');
  const lifted = new Set([
    'unbounded decision token keyword:Hideaway',
    'unbounded decision token parameter-key:Optional',
    'unbounded decision token semantic-marker:optional-trigger-or-replacement',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (
    (script !== exactWindbrisk && script !== exactShelldock) ||
    [...lifted].some((blocker) => !base.includes(blocker))
  ) {
    return [...new Set([...base, 'exact reviewed Hideaway-four composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Sword of Fire and Ice's Equip and combat-trigger composition. */
export function legacyCubeReviewedSwordOfFireAndIceRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Sword of Fire and Ice',
    'ManaCost:3',
    'Types:Artifact Equipment',
    'K:Equip:2',
    'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfFireAndIceCE | AddKeyword$ Protection from red & Protection from blue | Description$ Equipped creature gets +2/+2 and has protection from red and from blue.',
    'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigDealDamage | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, CARDNAME deals 2 damage to any target and you draw a card.',
    'SVar:TrigDealDamage:DB$ DealDamage | ValidTgts$ Any | NumDmg$ 2 | SubAbility$ DBDraw',
    'SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1',
    'SVar:SwordOfFireAndIceCE:SVar:MustBeBlocked:AttackingPlayerConservative',
    'Oracle:Equipped creature gets +2/+2 and has protection from red and from blue.\\nWhenever equipped creature deals combat damage to a player, Sword of Fire and Ice deals 2 damage to any target and you draw a card.\\nEquip {2}',
  ].join('\n');
  const lifted = new Set(['attachment target', 'trigger target', 'unbounded decision token keyword:Equip']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Sword of Fire and Ice composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Sword of Feast and Famine's Equip and combat-trigger composition. */
export function legacyCubeReviewedSwordOfFeastAndFamineRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Sword of Feast and Famine',
    'ManaCost:3',
    'Types:Artifact Equipment',
    'K:Equip:2',
    'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfFeastAndFamineCE | AddKeyword$ Protection from black & Protection from green | Description$ Equipped creature gets +2/+2 and has protection from black and from green.',
    'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigDiscard | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control.',
    'SVar:TrigDiscard:DB$ Discard | Defined$ TriggeredTarget | NumCards$ 1 | Mode$ TgtChoose | SubAbility$ DBUntapAll',
    'SVar:DBUntapAll:DB$ UntapAll | ValidCards$ Land.YouCtrl',
    'SVar:SwordOfFeastAndFamineCE:SVar:MustBeBlocked:AttackingPlayerConservative',
    'Oracle:Equipped creature gets +2/+2 and has protection from black and from green.\\nWhenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control.\\nEquip {2}',
  ].join('\n');
  const lifted = new Set(['attachment target', 'unbounded decision token keyword:Equip']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Sword of Feast and Famine composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Sword of Light and Shadow's Equip and combat-trigger composition. */
export function legacyCubeReviewedSwordOfLightAndShadowRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Sword of Light and Shadow',
    'ManaCost:3',
    'Types:Artifact Equipment',
    'K:Equip:2',
    'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfLightAndShadowCE | AddKeyword$ Protection from white & Protection from black | Description$ Equipped creature gets +2/+2 and has protection from white and from black.',
    'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigGainLife | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, you gain 3 life and you may return up to one target creature card from your graveyard to your hand.',
    'SVar:TrigGainLife:DB$ GainLife | Defined$ You | LifeAmount$ 3 | SubAbility$ DBReturn',
    'SVar:DBReturn:DB$ ChangeZone | Optional$ You | Origin$ Graveyard | Destination$ Hand | ValidTgts$ Creature.YouCtrl | TargetMin$ 0 | TargetMax$ 1 | TgtPrompt$ Select target creature in your graveyard | SpellDescription$ You may return up to one target creature card from your graveyard to your hand.',
    'SVar:SwordOfLightAndShadowCE:SVar:MustBeBlocked:AttackingPlayerConservative',
    'Oracle:Equipped creature gets +2/+2 and has protection from white and from black.\\nWhenever equipped creature deals combat damage to a player, you gain 3 life and you may return up to one target creature card from your graveyard to your hand.\\nEquip {2}',
  ].join('\n');
  const lifted = new Set([
    'attachment target',
    'optional target',
    'unbounded decision token keyword:Equip',
    'unbounded decision token parameter-key:Optional',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Sword of Light and Shadow composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Sword of Body and Mind's Equip, Wolf, and mill composition. */
export function legacyCubeReviewedSwordOfBodyAndMindRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Sword of Body and Mind',
    'ManaCost:3',
    'Types:Artifact Equipment',
    'K:Equip:2',
    'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfBodyAndMindCE | AddKeyword$ Protection from green & Protection from blue | Description$ Equipped creature gets +2/+2 and has protection from green and from blue.',
    'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigToken | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, you create a 2/2 green Wolf creature token and that player mills ten cards.',
    'SVar:TrigToken:DB$ Token | TokenScript$ g_2_2_wolf | TokenOwner$ You | SubAbility$ DBMill',
    'SVar:DBMill:DB$ Mill | Defined$ TriggeredTarget | NumCards$ 10',
    'SVar:SwordOfBodyAndMindCE:SVar:MustBeBlocked:AttackingPlayerConservative',
    'DeckHas:Ability$Token',
    'Oracle:Equipped creature gets +2/+2 and has protection from green and from blue.\\nWhenever equipped creature deals combat damage to a player, you create a 2/2 green Wolf creature token and that player mills ten cards.\\nEquip {2}',
  ].join('\n');
  const lifted = new Set([
    'attachment target',
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token keyword:Equip',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Sword of Body and Mind composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Sword of Hearth and Home's Equip, blink, search, and return chain. */
export function legacyCubeReviewedSwordOfHearthAndHomeRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Sword of Hearth and Home',
    'ManaCost:3',
    'Types:Artifact Equipment',
    'K:Equip:2',
    'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfHearthAndHomeCE | AddKeyword$ Protection from green & Protection from white | Description$ Equipped creature gets +2/+2 and has protection from green and from white.',
    'T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigBlink | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, exile up to one target creature you own, then search your library for a basic land card. Put both cards onto the battlefield under your control, then shuffle.',
    'SVar:TrigBlink:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | ValidTgts$ Creature.YouOwn | TargetMin$ 0 | TargetMax$ 1 | TgtPrompt$ Select target creature you own | SubAbility$ DBLand',
    'SVar:DBLand:DB$ ChangeZone | Origin$ Library | Destination$ Library | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | RememberChanged$ True | SubAbility$ DBReturn',
    'SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ All | Destination$ Battlefield | GainControl$ True | SubAbility$ DBCleanup',
    'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    'SVar:SwordOfHearthAndHomeCE:SVar:MustBeBlocked:AttackingPlayerConservative',
    'Oracle:Equipped creature gets +2/+2 and has protection from green and from white.\\nWhenever equipped creature deals combat damage to a player, exile up to one target creature you own, then search your library for a basic land card. Put both cards onto the battlefield under your control, then shuffle.\\nEquip {2}',
  ].join('\n');
  const lifted = new Set([
    'attachment target',
    'optional target',
    'trigger target',
    'unbounded decision token keyword:Equip',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Sword of Hearth and Home composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Umezawa's Jitte's Equip, charge, and mode composition. */
export function legacyCubeReviewedUmezawasJitteRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    "Name:Umezawa's Jitte",
    'ManaCost:2',
    'Types:Legendary Artifact Equipment',
    'K:Equip:2',
    'T:Mode$ DamageDealtOnce | CombatDamage$ True | ValidSource$ Creature.EquippedBy | Execute$ TrigPutCounter | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage, put two charge counters on CARDNAME.',
    'A:AB$ Charm | Cost$ SubCounter<1/CHARGE> | Choices$ JittePump,JitteCurse,JitteLife | Defined$ You',
    'SVar:JittePump:DB$ Pump | Defined$ Equipped | NumAtt$ +2 | NumDef$ +2 | SpellDescription$ Equipped creature gets +2/+2 until end of turn.',
    'SVar:JitteCurse:DB$ Pump | ValidTgts$ Creature | NumAtt$ -1 | NumDef$ -1 | IsCurse$ True | SpellDescription$ Target creature gets -1/-1 until end of turn.',
    'SVar:JitteLife:DB$ GainLife | LifeAmount$ 2 | SpellDescription$ You gain 2 life.',
    'SVar:TrigPutCounter:DB$ PutCounter | CounterType$ CHARGE | CounterNum$ 2',
    'DeckHas:Ability$Counters|LifeGain',
    "Oracle:Whenever equipped creature deals combat damage, put two charge counters on Umezawa's Jitte.\\nRemove a charge counter from Umezawa's Jitte: Choose one —\\n• Equipped creature gets +2/+2 until end of turn.\\n• Target creature gets -1/-1 until end of turn.\\n• You gain 2 life.\\nEquip {2}",
  ].join('\n');
  const lifted = new Set(['attachment target', 'unbounded decision token keyword:Equip']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, "exact reviewed Umezawa's Jitte composition"])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Birgi's modal Harnfel face and exact discard-exile ability. */
export function legacyCubeReviewedBirgiRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Birgi, God of Storytelling',
    'ManaCost:2 R',
    'Types:Legendary Creature God',
    'PT:3/3',
    "T:Mode$ SpellCast | ValidCard$ Card | ValidActivatingPlayer$ You | Execute$ TrigMana | TriggerZones$ Battlefield | TriggerDescription$ Whenever you cast a spell, add {R}. Until end of turn, you don't lose this mana as steps and phases end.",
    'SVar:TrigMana:DB$ Mana | Produced$ R | PersistentMana$ True',
    'S:Mode$ Activations | ValidCard$ Creature.YouCtrl | ValidSA$ Activated.Boast | ValidPlayer$ You | MinLimit$ 2 | PlayerTurn$ You | Description$ Creatures you control can boast twice during each of your turns rather than once.',
    'AlternateMode:Modal',
    "Oracle:Whenever you cast a spell, add {R}. Until end of turn, you don't lose this mana as steps and phases end.\\nCreatures you control can boast twice during each of your turns rather than once.",
    '',
    'ALTERNATE',
    '',
    'Name:Harnfel, Horn of Bounty',
    'ManaCost:4 R',
    'Types:Legendary Artifact',
    'A:AB$ Dig | Cost$ Discard<1/Card> | Defined$ You | DigNum$ 2 | ChangeNum$ All | DestinationZone$ Exile | RememberChanged$ True | SubAbility$ DBEffect | StackDescription$ SpellDescription | SpellDescription$ Exile the top two cards of your library. You may play those cards this turn.',
    'SVar:DBEffect:DB$ Effect | StaticAbilities$ StaticMayPlay | RememberObjects$ Remembered | ForgetOnMoved$ Exile | SubAbility$ DBCleanup',
    'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    'SVar:StaticMayPlay:Mode$ Continuous | Affected$ Card.IsRemembered | AffectedZone$ Exile | MayPlay$ True | Description$ You may play those cards this turn.',
    'Oracle:Discard a card: Exile the top two cards of your library. You may play those cards this turn.',
  ].join('\n');
  const lifted = new Set([
    'unbounded decision token semantic-marker:alternate-mode',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Birgi and Harnfel composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Birthing Pod's Phyrexian sacrifice-and-upgrade route. */
export function legacyCubeReviewedBirthingPodRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Birthing Pod',
    'ManaCost:3 GP',
    'Types:Artifact',
    "A:AB$ ChangeZone | Cost$ 1 GP T Sac<1/Creature> | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcEQX | ChangeNum$ 1 | SorcerySpeed$ True | AILogic$ SacAndUpgrade | StackDescription$ Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. | SpellDescription$ Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery.",
    'SVar:X:Sacrificed$CardManaCost/Plus.1',
    '# AI Preference is needed to make the AI consider the ability. Further constraints are defined by AILogic SacAndUpgrade.',
    'SVar:AIPreference:SacCost$Creature',
    "Oracle:({G/P} can be paid with either {G} or 2 life.)\\n{1}{G/P}, {T}, Sacrifice a creature: Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery.",
  ].join('\n');
  const lifted = new Set([
    'Phyrexian mana cost',
    'unbounded decision token parameter-key:SacCost',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Birthing Pod composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Ranger-Captain's optional search and self-sacrifice lock. */
export function legacyCubeReviewedRangerCaptainOfEosRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Ranger-Captain of Eos',
    'ManaCost:1 W W',
    'Types:Creature Human Soldier Ranger',
    'PT:3/3',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigChange | TriggerDescription$ When CARDNAME enters, you may search your library for a creature card with mana value 1 or less, reveal that card, reveal it, put it into your hand, then shuffle.',
    'SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Creature.cmcLE1 | ChangeNum$ 1 | ShuffleNonMandatory$ True',
    "A:AB$ Effect | Cost$ Sac<1/CARDNAME> | StaticAbilities$ STCantBeCast | SpellDescription$ Your opponents can't cast noncreature spells this turn.",
    "SVar:STCantBeCast:Mode$ CantBeCast | ValidCard$ Card.nonCreature | Caster$ Opponent | Description$ Your opponents can't cast noncreature spells this turn.",
    "Oracle:When Ranger-Captain of Eos enters, you may search your library for a creature card with mana value 1 or less, reveal it, put it into your hand, then shuffle.\\nSacrifice Ranger-Captain of Eos: Your opponents can't cast noncreature spells this turn.",
  ].join('\n');
  const lifted = new Set([
    'unbounded decision token parameter-key:OptionalDecider',
    'unbounded decision token parameter-key:ShuffleNonMandatory',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Ranger-Captain of Eos composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Forbid's Buyback discard-two counter route. */
export function legacyCubeReviewedForbidRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Forbid',
    'ManaCost:1 U U',
    'Types:Instant',
    'K:Buyback:Discard<2/Card>',
    'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | Destination$ Graveyard | SpellDescription$ Counter target spell.',
    'AI:RemoveDeck:All',
    'Oracle:Buyback—Discard two cards. (You may discard two cards in addition to any other costs as you cast this spell. If you do, put this card into your hand as it resolves.)\\nCounter target spell.',
  ].join('\n');
  const lifted = new Set(['retarget ability', 'unbounded decision token keyword:Buyback']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Forbid composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Reveillark's Evoke and optional leaves-two return route. */
export function legacyCubeReviewedReveillarkRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Reveillark',
    'ManaCost:4 W',
    'Types:Creature Elemental',
    'PT:4/3',
    'K:Flying',
    'K:Evoke:5 W',
    'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigReturnCreatures | TriggerDescription$ When CARDNAME leaves the battlefield, return up to two target creature cards with power 2 or less from your graveyard to the battlefield.',
    'SVar:TrigReturnCreatures:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | TargetMin$ 0 | TargetMax$ 2 | ValidTgts$ Creature.powerLE2 | TargetsWithDefinedController$ TriggeredCardController | TgtPrompt$ Choose target creature',
    'SVar:NeedsToPlayEvokedVar:Z GE2',
    'SVar:Z:Count$ValidGraveyard Creature.YouCtrl+powerLE2',
    "Oracle:Flying\\nWhen Reveillark leaves the battlefield, return up to two target creature cards with power 2 or less from your graveyard to the battlefield.\\nEvoke {5}{W} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)",
  ].join('\n');
  const lifted = new Set([
    'trigger target',
    'optional target',
    'multiple targets',
    'unbounded decision token keyword:Evoke',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Reveillark composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Bloodchief's Thirst's Kicker-dependent target blocks. */
export function legacyCubeReviewedBloodchiefsThirstRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    "Name:Bloodchief's Thirst",
    'ManaCost:B',
    'Types:Sorcery',
    'K:Kicker:2 B',
    'A:SP$ Destroy | ValidTgts$ Creature.cmcLE2,Planeswalker.cmcLE2 | TargetMin$ X | TargetMax$ X | TgtPrompt$ Select target creature or planeswalker with mana value 2 or less | SubAbility$ DBDestroy | AILogic$ AssumeAtLeastOneTarget | StackDescription$ SpellDescription | SpellDescription$ Destroy target creature or planeswalker with mana value 2 or less.',
    'SVar:DBDestroy:DB$ Destroy | TargetMin$ Y | TargetMax$ Y | ValidTgts$ Creature,Planeswalker | TgtPrompt$ Select target creature or planeswalker | StackDescription$ SpellDescription | SpellDescription$ If this spell was kicked, instead destroy target creature or planeswalker.',
    'SVar:X:Count$Kicked.0.1',
    'SVar:Y:Count$Kicked.1.0',
    'Oracle:Kicker {2}{B} (You may pay an additional {2}{B} as you cast this spell.)\\nDestroy target creature or planeswalker with mana value 2 or less. If this spell was kicked, instead destroy target creature or planeswalker.',
  ].join('\n');
  const lifted = new Set(['nested target block', 'unbounded decision token keyword:Kicker']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, "exact reviewed Bloodchief's Thirst composition"])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Primal Might's X-pump and optional fight target. */
export function legacyCubeReviewedPrimalMightRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Primal Might',
    'ManaCost:X G',
    'Types:Sorcery',
    "A:SP$ Pump | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control | NumAtt$ +X | NumDef$ +X | SubAbility$ DBFight | SpellDescription$ Target creature you control gets +X/+X until end of turn. Then it fights up to one target creature you don't control.",
    "SVar:DBFight:DB$ Fight | Defined$ ParentTarget | ValidTgts$ Creature.YouDontCtrl | TargetMin$ 0 | TargetMax$ 1 | TgtPrompt$ Select up to one target creature you don't control",
    'SVar:X:Count$xPaid',
    'SVar:PlayMain1:TRUE',
    "Oracle:Target creature you control gets +X/+X until end of turn. Then it fights up to one target creature you don't control.",
  ].join('\n');
  const lifted = new Set(['nested target block', 'optional target']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Primal Might composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Engineered Explosives' Sunburst and fixed-source sweep. */
export function legacyCubeReviewedEngineeredExplosivesRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Engineered Explosives',
    'ManaCost:X',
    'Types:Artifact',
    'K:Sunburst',
    'A:AB$ DestroyAll | Cost$ 2 Sac<1/CARDNAME> | ValidCards$ Permanent.nonLand+cmcEQY | SpellDescription$ Destroy each nonland permanent with mana value equal to the number of charge counters on CARDNAME.',
    'SVar:X:Count$xPaid',
    'SVar:Y:Count$CardCounters.CHARGE',
    'SVar:NonStackingEffect:True',
    'AI:RemoveDeck:All',
    'DeckHints:Ability$Proliferate',
    'Oracle:Sunburst (This enters with a charge counter on it for each color of mana spent to cast it.)\\n{2}, Sacrifice Engineered Explosives: Destroy each nonland permanent with mana value equal to the number of charge counters on Engineered Explosives.',
  ].join('\n');
  const lifted = new Set([
    'unbounded decision token keyword:Sunburst',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  const base = legacyCubeAnnouncedNumberRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Engineered Explosives composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for the two reviewed look-three, reorder-or-shuffle spells. */
export function legacyCubeReviewedReorderOrShuffleRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScripts = [
    [
      'Name:Ponder',
      'ManaCost:U',
      'Types:Sorcery',
      'A:SP$ RearrangeTopOfLibrary | Defined$ You | NumCards$ 3 | MayShuffle$ True | SubAbility$ DBDraw | SpellDescription$ Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.',
      'SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1',
      'Oracle:Look at the top three cards of your library, then put them back in any order. You may shuffle.\\nDraw a card.',
    ].join('\n'),
    [
      'Name:Portent',
      'ManaCost:U',
      'Types:Sorcery',
      "A:SP$ RearrangeTopOfLibrary | ValidTgts$ Player | NumCards$ 3 | MayShuffle$ True | SubAbility$ DelTrigSlowtrip | SpellDescription$ Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle. Draw a card at the beginning of the next turn's upkeep.",
      'SVar:DelTrigSlowtrip:DB$ DelayedTrigger | NextTurn$ True | Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Player | Execute$ DrawSlowtrip | TriggerDescription$ Draw a card.',
      'SVar:DrawSlowtrip:DB$ Draw | Defined$ You',
      "Oracle:Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle.\\nDraw a card at the beginning of the next turn's upkeep.",
    ].join('\n'),
  ] as const;
  const rearrangeBlocker = 'unbounded decision token ability-api:RearrangeTopOfLibrary';
  const shuffleBlocker = 'unbounded decision token parameter-key:MayShuffle';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exactScripts.includes(script) || !base.includes(rearrangeBlocker) || !base.includes(shuffleBlocker)) {
    return [...new Set([...base, 'exact reviewed reorder-or-shuffle composition'])];
  }
  return base.filter((refusal) => refusal !== rearrangeBlocker && refusal !== shuffleBlocker);
}

/** Closed whole-card boundary for Animate Dead's exact graveyard Aura lifecycle. */
export function legacyCubeReviewedAnimateDeadRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Animate Dead',
    'ManaCost:1 B',
    'Types:Enchantment Aura',
    'K:Enchant:Creature.inZoneGraveyard:creature card in a graveyard',
    'SVar:AttachAILogic:Reanimate',
    'SVar:AttachAITgts:Creature.!namedWorldgorger Dragon',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | IsPresent$ Card.StrictlySelf | Execute$ TrigReanimate | TriggerDescription$ When CARDNAME enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with CARDNAME." Return enchanted creature card to the battlefield under your control and attach CARDNAME to it. When CARDNAME leaves the battlefield, that creature\'s controller sacrifices it.',
    'SVar:TrigReanimate:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | Defined$ Enchanted | RememberChanged$ True | GainControl$ True | SubAbility$ DBAnimate',
    'SVar:DBAnimate:DB$ Animate | Defined$ Self | Keywords$ Enchant:Creature.IsRemembered:creature put onto the battlefield with CARDNAME | RemoveKeywords$ Enchant:Creature.inZoneGraveyard:creature card in a graveyard | Duration$ Permanent | SubAbility$ DBAttach',
    'SVar:DBAttach:DB$ Attach | Defined$ Remembered | SubAbility$ DBDelay',
    "SVar:DBDelay:DB$ DelayedTrigger | Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Battlefield | Execute$ TrigSacrifice | RememberObjects$ RememberedLKI | TriggerDescription$ When CARDNAME leaves the battlefield, that creature's controller sacrifices it.",
    'SVar:TrigSacrifice:DB$ SacrificeAll | Defined$ DelayTriggerRememberedLKI',
    'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ DBCleanup | Static$ True',
    'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ -1 | Description$ Enchanted creature gets -1/-0.',
    'DeckHas:Ability$Graveyard',
    'DeckHints:Ability$Mill|Discard & Keyword$Dredge',
    'Oracle:Enchant creature card in a graveyard\\nWhen Animate Dead enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with Animate Dead." Return enchanted creature card to the battlefield under your control and attach Animate Dead to it. When Animate Dead leaves the battlefield, that creature\'s controller sacrifices it.\\nEnchanted creature gets -1/-0.',
  ].join('\n');
  const lifted = new Set(['attachment target', 'unbounded decision token keyword:Enchant']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Animate Dead composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Heartless Act's exact modal counter-removal route. */
export function legacyCubeReviewedHeartlessActRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Heartless Act',
    'ManaCost:1 B',
    'Types:Instant',
    'A:SP$ Charm | Choices$ Destroy,Remove',
    'SVar:Destroy:DB$ Destroy | ValidTgts$ Creature.!HasCounters | TgtPrompt$ Select target creature with no counters on it | SpellDescription$ Destroy target creature with no counters on it.',
    'SVar:Remove:DB$ RemoveCounter | ValidTgts$ Creature | CounterType$ Any | CounterNum$ 3 | UpTo$ True | SpellDescription$ Remove up to three counters from target creature.',
    'Oracle:Choose one —\\n• Destroy target creature with no counters on it.\\n• Remove up to three counters from target creature.',
  ].join('\n');
  const lifted = new Set([
    'counter-type choice',
    'bounded number choice',
    'unbounded decision token parameter-key:UpTo',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Heartless Act composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Agadeem's Awakening's exact modal X-reanimation route. */
export function legacyCubeReviewedAgadeemsAwakeningRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    "Name:Agadeem's Awakening",
    'ManaCost:X B B B',
    'Types:Sorcery',
    'A:SP$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | TargetMin$ 0 | TargetMax$ Y | ValidTgts$ Creature.YouOwn+cmcLEX | TgtPrompt$ Select any number of target creature cards in your graveyard with different mana value X or less | TargetsWithDifferentCMC$ True | StackDescription$ {p:You} returns {c:Targeted} from the graveyard to the battlefield. | SpellDescription$ Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less.',
    'SVar:X:Count$xPaid',
    'SVar:Y:Count$ValidGraveyard Creature.YouOwn',
    'DeckHas:Ability$Graveyard',
    'AlternateMode:Modal',
    'Oracle:Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less.',
    '',
    'ALTERNATE',
    '',
    'Name:Agadeem, the Undercrypt',
    'ManaCost:no cost',
    'Types:Land',
    "R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated | Description$ As CARDNAME enters, you may pay 3 life. If you don't, it enters tapped.",
    'SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<3> | UnlessPayer$ You | StackDescription$ enters tapped.',
    'A:AB$ Mana | Cost$ T | Produced$ B | SpellDescription$ Add {B}.',
    "Oracle:As Agadeem, the Undercrypt enters, you may pay 3 life. If you don't, it enters tapped.\\n{T}: Add {B}.",
  ].join('\n');
  const lifted = new Set([
    'optional target',
    'unbounded decision token parameter-key:UnlessCost',
    'unbounded decision token semantic-marker:alternate-mode',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, "exact reviewed Agadeem's Awakening composition"])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for the exact Emeria and Turntimber modal land spell compositions. */
export function legacyCubeReviewedModalLandSpellRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScripts = [
    [
      "Name:Emeria's Call",
      'ManaCost:4 W W W',
      'Types:Sorcery',
      'A:SP$ Token | TokenAmount$ 2 | TokenScript$ w_4_4_angel_warrior_flying | SubAbility$ DBPumpAll | SpellDescription$ Create two 4/4 white Angel Warrior creature tokens with flying. Non-Angel creatures you control gain indestructible until your next turn.',
      'SVar:DBPumpAll:DB$ PumpAll | ValidCards$ Creature.nonAngel+YouCtrl | KW$ Indestructible | Duration$ UntilYourNextTurn',
      'DeckHas:Ability$Token',
      'AlternateMode:Modal',
      'Oracle:Create two 4/4 white Angel Warrior creature tokens with flying. Non-Angel creatures you control gain indestructible until your next turn.',
      '',
      'ALTERNATE',
      '',
      'Name:Emeria, Shattered Skyclave',
      'ManaCost:no cost',
      'Types:Land',
      "R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated | Description$ As CARDNAME enters, you may pay 3 life. If you don't, it enters tapped.",
      'SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<3> | UnlessPayer$ You | StackDescription$ enters tapped.',
      'A:AB$ Mana | Cost$ T | Produced$ W | SpellDescription$ Add {W}.',
      "Oracle:As Emeria, Shattered Skyclave enters, you may pay 3 life. If you don't, it enters tapped.\\n{T}: Add {W}.",
    ].join('\n'),
    [
      'Name:Turntimber Symbiosis',
      'ManaCost:4 G G G',
      'Types:Sorcery',
      'A:SP$ Dig | DigNum$ 7 | ChangeNum$ 1 | Optional$ True | ForceRevealToController$ True | ChangeValid$ Creature | PrimaryPrompt$ You may choose a creature card to put on the battlefield | DestinationZone$ Library | LibraryPosition$ 0 | RememberChanged$ True | RestRandomOrder$ True | SubAbility$ DBChangeZone | StackDescription$ SpellDescription | SpellDescription$ Look at the top seven cards of your library. You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it. Put the rest on the bottom of your library in a random order.',
      'SVar:DBChangeZone:DB$ ChangeZone | Origin$ All | Destination$ Battlefield | Defined$ Remembered | ConditionDefined$ Remembered | ConditionPresent$ Creature.cmcGT3 | SubAbility$ DBChangeZone2',
      'SVar:DBChangeZone2:DB$ ChangeZone | Origin$ All | Destination$ Battlefield | WithCountersType$ P1P1 | WithCountersAmount$ 3 | Defined$ Remembered | ConditionDefined$ Remembered | ConditionPresent$ Creature.cmcLE3 | SubAbility$ DBCleanup',
      'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
      'DeckHas:Ability$Counters',
      'AlternateMode:Modal',
      'Oracle:Look at the top seven cards of your library. You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it. Put the rest on the bottom of your library in a random order.',
      '',
      'ALTERNATE',
      '',
      'Name:Turntimber, Serpentine Wood',
      'ManaCost:no cost',
      'Types:Land',
      "R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated | Description$ As CARDNAME enters, you may pay 3 life. If you don't, it enters tapped.",
      'SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<3> | UnlessPayer$ You | StackDescription$ enters tapped.',
      'A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.',
      "Oracle:As Turntimber, Serpentine Wood enters, you may pay 3 life. If you don't, it enters tapped.\\n{T}: Add {G}.",
    ].join('\n'),
  ];
  const liftedByScript = new Map<string, ReadonlySet<string>>([
    [
      exactScripts[0]!,
      new Set([
        'unpinned generated-object source',
        'unbounded decision token ability-api:Token',
        'unbounded decision token parameter-key:UnlessCost',
        'unbounded decision token semantic-marker:alternate-mode',
      ]),
    ],
    [
      exactScripts[1]!,
      new Set([
        'unbounded decision token parameter-key:Optional',
        'unbounded decision token parameter-key:UnlessCost',
        'unbounded decision token semantic-marker:alternate-mode',
        'unbounded decision token semantic-marker:optional-trigger-or-replacement',
      ]),
    ],
  ]);
  const lifted = liftedByScript.get(script);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (lifted === undefined || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed modal land spell composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for the four exact reviewed Convoke compositions. */
export function legacyCubeReviewedConvokeRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScripts = [
    [
      'Name:Venerated Loxodon',
      'ManaCost:4 W',
      'Types:Creature Elephant Cleric',
      'PT:4/4',
      'K:Convoke',
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigPutCounterAll | TriggerDescription$ When CARDNAME enters, put a +1/+1 counter on each creature that convoked it.',
      'SVar:TrigPutCounterAll:DB$ PutCounter | Defined$ Convoked | CounterType$ P1P1 | CounterNum$ 1',
      'DeckHas:Ability$Counters',
      "Oracle:Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\\nWhen Venerated Loxodon enters, put a +1/+1 counter on each creature that convoked it.",
    ].join('\n'),
    [
      'Name:Conclave Tribunal',
      'ManaCost:3 W',
      'Types:Enchantment',
      'K:Convoke',
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ When CARDNAME enters, exile target nonland permanent an opponent controls until CARDNAME leaves the battlefield.',
      'SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Permanent.nonLand+OppCtrl | TgtPrompt$ Select target nonland permanent an opponent controls | Duration$ UntilHostLeavesPlay',
      'SVar:OblivionRing:TRUE',
      "Oracle:Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\\nWhen Conclave Tribunal enters, exile target nonland permanent an opponent controls until Conclave Tribunal leaves the battlefield.",
    ].join('\n'),
    [
      'Name:Stoke the Flames',
      'ManaCost:2 R R',
      'Types:Instant',
      'K:Convoke',
      'A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 4 | SpellDescription$ CARDNAME deals 4 damage to any target.',
      "Oracle:Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\\nStoke the Flames deals 4 damage to any target.",
    ].join('\n'),
    [
      'Name:Chord of Calling',
      'ManaCost:X G G G',
      'Types:Instant',
      'K:Convoke',
      'A:SP$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcLEX | ChangeNum$ 1 | StackDescription$ SpellDescription | AIXMax$ Y | SpellDescription$ Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.',
      'SVar:X:Count$xPaid',
      'SVar:Y:Count$ValidLibrary Creature.YouOwn+cmcLEX$GreatestCardManaCost',
      "Oracle:Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\\nSearch your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.",
    ].join('\n'),
  ] as const;
  const specialPayment = 'special payment keyword';
  const convokeToken = 'unbounded decision token keyword:Convoke';
  const triggerTarget = 'trigger target';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exactScripts.includes(script) || !base.includes(specialPayment) || !base.includes(convokeToken)) {
    return [...new Set([...base, 'exact reviewed Convoke composition'])];
  }
  return base.filter(
    (refusal) => refusal !== specialPayment && refusal !== convokeToken && refusal !== triggerTarget,
  );
}

/** Closed whole-card boundary for the three exact reviewed Delve compositions. */
export function legacyCubeReviewedDelveRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScripts = [
    [
      'Name:Murktide Regent',
      'ManaCost:5 U U',
      'Types:Creature Dragon',
      'PT:3/3',
      'K:Delve',
      'K:Flying',
      'K:etbCounter:P1P1:X:no Condition:CARDNAME enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.',
      'SVar:X:Count$ValidExile Instant.ExiledWithSource,Sorcery.ExiledWithSource',
      'T:Mode$ ChangesZone | ValidCard$ Instant.YouOwn,Sorcery.YouOwn | Origin$ Graveyard | Destination$ Any | TriggerZones$ Battlefield | Execute$ TrigPutCounter | TriggerDescription$ Whenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on CARDNAME.',
      'SVar:TrigPutCounter:DB$ PutCounter | CounterType$ P1P1 | CounterNum$ 1',
      'DeckHas:Ability$Counters',
      'DeckNeeds:Type$Instant|Sorcery',
      'Oracle:Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\\nFlying\\nMurktide Regent enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.\\nWhenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on Murktide Regent.',
    ].join('\n'),
    [
      'Name:Tasigur, the Golden Fang',
      'ManaCost:5 B',
      'Types:Legendary Creature Human Shaman',
      'PT:4/5',
      'K:Delve',
      "A:AB$ Mill | Cost$ 2 GU GU | Defined$ You | NumCards$ 2 | SubAbility$ DBReturn | SpellDescription$ Mill two cards, then return a nonland card of an opponent's choice from your graveyard to your hand.",
      'SVar:DBReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | DefinedPlayer$ You | Chooser$ Opponent | Hidden$ True | Mandatory$ True | ChangeType$ Card.nonLand+YouOwn | AILogic$ WorstCard',
      'DeckHints:Ability$Graveyard',
      "Oracle:Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\\n{2}{G/U}{G/U}: Mill two cards, then return a nonland card of an opponent's choice from your graveyard to your hand.",
    ].join('\n'),
    [
      'Name:Hogaak, Arisen Necropolis',
      'ManaCost:5 BG BG',
      'Types:Legendary Creature Avatar',
      'PT:8/8',
      'K:Convoke',
      'K:Delve',
      'K:Trample',
      "Text:You can't spend mana to cast this spell.",
      'A:SP$ PermanentCreature | Cost$ 5 BG BG | ManaRestriction$ None',
      'S:Mode$ Continuous | Affected$ Card.Self | MayPlay$ True | AffectedZone$ Graveyard | EffectZone$ Graveyard | Description$ You may cast CARDNAME from your graveyard.',
      "Oracle:You can't spend mana to cast this spell.\\nConvoke, delve (Each creature you tap while casting this spell pays for {1} or one mana of that creature's color. Each card you exile from your graveyard pays for {1}.)\\nYou may cast Hogaak, Arisen Necropolis from your graveyard.\\nTrample",
    ].join('\n'),
  ] as const;
  const specialPayment = 'special payment keyword';
  const delveToken = 'unbounded decision token keyword:Delve';
  const convokeToken = 'unbounded decision token keyword:Convoke';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exactScripts.includes(script) || !base.includes(specialPayment) || !base.includes(delveToken)) {
    return [...new Set([...base, 'exact reviewed Delve composition'])];
  }
  return base.filter(
    (refusal) => refusal !== specialPayment && refusal !== delveToken && refusal !== convokeToken,
  );
}

/** Closed whole-card boundary for the three exact reviewed free-counterspell scripts. */
export function legacyCubeReviewedFreeCounterspellRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScripts = [
    [
      'Name:Force of Negation',
      'ManaCost:1 U U',
      'Types:Instant',
      "S:Mode$ AlternativeCost | ValidSA$ Spell.Self | EffectZone$ All | Cost$ ExileFromHand<1/Card.Blue+Other> | Condition$ NotPlayerTurn | Description$ If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.",
      "A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target noncreature spell | ValidTgts$ Card.nonCreature | Destination$ Exile | SpellDescription$ Counter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard. | StackDescription$ SpellDescription",
      "Oracle:If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.\\nCounter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
    ].join('\n'),
    [
      'Name:Force of Will',
      'ManaCost:3 U U',
      'Types:Instant',
      "S:Mode$ AlternativeCost | ValidSA$ Spell.Self | EffectZone$ All | Cost$ PayLife<1> ExileFromHand<1/Card.Blue+Other> | Description$ You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.",
      'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | Destination$ Graveyard | AILogic$ MinCMC.3 | SpellDescription$ Counter target spell.',
      "Oracle:You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\\nCounter target spell.",
    ].join('\n'),
    [
      'Name:Daze',
      'ManaCost:1 U',
      'Types:Instant',
      "S:Mode$ AlternativeCost | ValidSA$ Spell.Self | EffectZone$ All | Cost$ Return<1/Island> | Description$ You may return an Island you control to its owner's hand rather than pay this spell's mana cost.",
      'A:SP$ Counter | TargetType$ Spell | TgtPrompt$ Select target spell | ValidTgts$ Card | UnlessCost$ 1 | AILogic$ MinCMC.4 | SpellDescription$ Counter target spell unless its controller pays {1}.',
      "Oracle:You may return an Island you control to its owner's hand rather than pay this spell's mana cost.\\nCounter target spell unless its controller pays {1}.",
    ].join('\n'),
  ] as const;
  const lifted = new Set([
    'alternative or additional cost',
    'retarget ability',
    'unbounded decision token ability-api:AlternativeCost',
  ]);
  if (script.startsWith('Name:Daze\n')) {
    lifted.add('unbounded decision token parameter-key:UnlessCost');
  }
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exactScripts.includes(script) || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed free-counterspell composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Legion's Landing's double-faced token route. */
export function legacyCubeReviewedLegionsLandingRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    "Name:Legion's Landing",
    'ManaCost:W',
    'Types:Legendary Enchantment',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create a 1/1 white Vampire creature token with lifelink.',
    'SVar:TrigToken:DB$ Token | TokenScript$ w_1_1_vampire_lifelink | TokenOwner$ You',
    'T:Mode$ AttackersDeclared | Execute$ DBTransform | ValidAttackers$ Creature | ValidAttackersAmount$ GE3 | TriggerZones$ Battlefield | AttackingPlayer$ You | TriggerDescription$ When you attack with three or more creatures, transform CARDNAME.',
    'SVar:DBTransform:DB$ SetState | Defined$ Self | Mode$ Transform',
    'AlternateMode:DoubleFaced',
    "Oracle:When Legion's Landing enters, create a 1/1 white Vampire creature token with lifelink.\\nWhen you attack with three or more creatures, transform Legion's Landing.",
    '',
    'ALTERNATE',
    '',
    'Name:Adanto, the First Fort',
    'ManaCost:no cost',
    'Types:Legendary Land',
    'A:AB$ Mana | Cost$ T | Produced$ W | Amount$ 1 | SpellDescription$ Add {W}.',
    'A:AB$ Token | Cost$ 2 W T | TokenScript$ w_1_1_vampire_lifelink | TokenOwner$ You | SpellDescription$ Create a 1/1 white Vampire creature token with lifelink.',
    "Oracle:(Transforms from Legion's Landing.)\\n{T}: Add {W}.\\n{2}{W}, {T}: Create a 1/1 white Vampire creature token with lifelink.",
  ].join('\n');
  const lifted = new Set([
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token semantic-marker:alternate-mode',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, "exact reviewed Legion's Landing composition"])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Gilded Goose's Food creation and sacrifice-for-color route. */
export function legacyCubeReviewedGildedGooseRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Gilded Goose',
    'ManaCost:G',
    'Types:Creature Bird',
    'PT:0/2',
    'K:Flying',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigFood | TriggerDescription$ When CARDNAME enters, create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")',
    'SVar:TrigFood:DB$ Token | TokenScript$ c_a_food_sac | TokenOwner$ You',
    'A:AB$ Token | Cost$ 1 G T | TokenScript$ c_a_food_sac | TokenOwner$ You | SpellDescription$ Create a Food Token.',
    'A:AB$ Mana | Cost$ T Sac<1/Food> | Produced$ Any | SpellDescription$ Add one mana of any color.',
    'DeckHas:Ability$LifeGain|Token|Food',
    'DeckHints:Ability$Food',
    'Oracle:Flying\\nWhen Gilded Goose enters, create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\\n{1}{G}, {T}: Create a Food token.\\n{T}, Sacrifice a Food: Add one mana of any color.',
  ].join('\n');
  const lifted = new Set([
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Gilded Goose composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for the Pia/Siege-Gang entry-token and chosen-sacrifice routes. */
export function legacyCubeReviewedPiaSiegeGangRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactPiaNalaar = [
    'Name:Pia Nalaar',
    'ManaCost:2 R',
    'Types:Legendary Creature Human Artificer',
    'PT:2/2',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create a 1/1 colorless Thopter artifact creature token with flying.',
    'SVar:TrigToken:DB$ Token | TokenScript$ c_1_1_a_thopter_flying | TokenOwner$ You',
    'A:AB$ Pump | Cost$ 1 R | ValidTgts$ Creature.Artifact | NumAtt$ +1 | TgtPrompt$ Select target artifact creature. | SpellDescription$ Target artifact creature gets +1/+0 until end of turn.',
    "A:AB$ Pump | Cost$ 1 Sac<1/Artifact> | ValidTgts$ Creature | KW$ HIDDEN CARDNAME can't block. | IsCurse$ True | SpellDescription$ Target creature can't block this turn.",
    'DeckHas:Ability$Token',
    "Oracle:When Pia Nalaar enters, create a 1/1 colorless Thopter artifact creature token with flying.\\n{1}{R}: Target artifact creature gets +1/+0 until end of turn.\\n{1}, Sacrifice an artifact: Target creature can't block this turn.",
  ].join('\n');
  const exactPiaAndKiran = [
    'Name:Pia and Kiran Nalaar',
    'ManaCost:2 R R',
    'Types:Legendary Creature Human Artificer',
    'PT:2/2',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create two 1/1 colorless Thopter artifact creature tokens with flying.',
    'SVar:TrigToken:DB$ Token | TokenAmount$ 2 | TokenScript$ c_1_1_a_thopter_flying | TokenOwner$ You',
    'A:AB$ DealDamage | Cost$ 2 R Sac<1/Artifact> | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.',
    'DeckHas:Ability$Token',
    'Oracle:When Pia and Kiran Nalaar enters, create two 1/1 colorless Thopter artifact creature tokens with flying.\\n{2}{R}, Sacrifice an artifact: Pia and Kiran Nalaar deals 2 damage to any target.',
  ].join('\n');
  const exactSiegeGang = [
    'Name:Siege-Gang Commander',
    'ManaCost:3 R R',
    'Types:Creature Goblin',
    'PT:2/2',
    'A:AB$ DealDamage | Cost$ 1 R Sac<1/Goblin> | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create three 1/1 red Goblin creature tokens.',
    'SVar:TrigToken:DB$ Token | TokenAmount$ 3 | TokenScript$ r_1_1_goblin | TokenOwner$ You',
    'SVar:AIPreference:SacCost$Creature.Goblin+token,Creature.Goblin+cmcLE1',
    'DeckHas:Ability$Token',
    'DeckHints:Type$Goblin',
    'Oracle:When Siege-Gang Commander enters, create three 1/1 red Goblin creature tokens.\\n{1}{R}, Sacrifice a Goblin: Siege-Gang Commander deals 2 damage to any target.',
  ].join('\n');
  const exact = script === exactPiaNalaar || script === exactPiaAndKiran || script === exactSiegeGang;
  const lifted = new Set([
    'choice cost',
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  if (script === exactSiegeGang) {
    lifted.add('unbounded decision token parameter-key:SacCost');
  }
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exact || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Pia/Siege-Gang composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Treachery's creature Aura and land-untap trigger. */
export function legacyCubeReviewedTreacheryRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Treachery',
    'ManaCost:3 U U',
    'Types:Enchantment Aura',
    'K:Enchant:Creature',
    'SVar:AttachAILogic:GainControl',
    'S:Mode$ Continuous | Affected$ Card.EnchantedBy | GainControl$ You | Description$ You control enchanted creature.',
    'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigUntap | TriggerDescription$ When CARDNAME enters, untap up to five lands.',
    'SVar:TrigUntap:DB$ Untap | UntapUpTo$ True | UntapType$ Land | Amount$ 5',
    'SVar:PlayMain1:TRUE',
    'SVar:FreeSpellAI:True',
    'Oracle:Enchant creature\\nWhen Treachery enters, untap up to five lands.\\nYou control enchanted creature.',
  ].join('\n');
  const lifted = new Set([
    'attachment target',
    'unbounded decision token keyword:Enchant',
    'unbounded decision token parameter-key:UntapUpTo',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Treachery composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Skyclave Apparition's exile-memory-token route. */
export function legacyCubeReviewedSkyclaveApparitionRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Skyclave Apparition',
    'ManaCost:1 W W',
    'Types:Creature Kor Spirit',
    'PT:2/2',
    "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ When CARDNAME enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.",
    "SVar:TrigExile:DB$ ChangeZone | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Permanent.nonLand+!token+YouDontCtrl+cmcLE4 | TgtPrompt$ Select target nonland, nontoken permanent you don't control with mana value 4 or less. | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | SpellDescription$ Exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.",
    "T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card.",
    'SVar:TrigToken:DB$ Token | TokenScript$ u_x_x_illusion | TokenOwner$ RememberedOwner | ConditionDefined$ Remembered | ConditionPresent$ Card.ExiledWithSource | TokenPower$ X | TokenToughness$ X | SubAbility$ DBCleanup',
    'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    'SVar:X:Remembered$CardManaCost',
    "Oracle:When Skyclave Apparition enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.\\nWhen Skyclave Apparition leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card.",
  ].join('\n');
  const lifted = new Set([
    'trigger target',
    'optional target',
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Skyclave Apparition composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Path to Exile's target-controller optional search. */
export function legacyCubeReviewedPathToExileRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Path to Exile',
    'ManaCost:W',
    'Types:Instant',
    'A:SP$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Creature | SubAbility$ DBChange | StackDescription$ Exile {c:Targeted}. {p:TargetedController} may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle their library. | SpellDescription$ Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    'SVar:DBChange:DB$ ChangeZone | Optional$ True | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | DefinedPlayer$ TargetedController | ShuffleNonMandatory$ True | StackDescription$ None',
    'Oracle:Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
  ].join('\n');
  const lifted = new Set([
    'unbounded decision token parameter-key:Optional',
    'unbounded decision token parameter-key:ShuffleNonMandatory',
    'unbounded decision token semantic-marker:optional-trigger-or-replacement',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Path to Exile composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Glen Elendra Archmage's sacrifice-counter-Persist route. */
export function legacyCubeReviewedGlenElendraArchmageRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Glen Elendra Archmage',
    'ManaCost:3 U',
    'Types:Creature Faerie Wizard',
    'PT:2/2',
    'K:Flying',
    'A:AB$ Counter | Cost$ U Sac<1/CARDNAME> | TargetType$ Spell | TgtPrompt$ Select target noncreature spell | ValidTgts$ Card.nonCreature | SpellDescription$ Counter target noncreature spell.',
    'K:Persist',
    "Oracle:Flying\\n{U}, Sacrifice Glen Elendra Archmage: Counter target noncreature spell.\\nPersist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)",
  ].join('\n');
  const lifted = new Set([
    'retarget ability',
    'choice cost',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Glen Elendra Archmage composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Recurring Nightmare's sacrifice-return-reanimate route. */
export function legacyCubeReviewedRecurringNightmareRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Recurring Nightmare',
    'ManaCost:2 B',
    'Types:Enchantment',
    'A:AB$ ChangeZone | Cost$ Sac<1/Creature> Return<1/CARDNAME> | TgtPrompt$ Choose target creature card in your graveyard | ValidTgts$ Creature.YouCtrl | Origin$ Graveyard | Destination$ Battlefield | SorcerySpeed$ True | AILogic$ SacAndRetFromGrave | SpellDescription$ Return target creature card from your graveyard to the battlefield. Activate only as a sorcery.',
    'SVar:AIPreference:SacCost$Creature',
    "Oracle:Sacrifice a creature, Return Recurring Nightmare to its owner's hand: Return target creature card from your graveyard to the battlefield. Activate only as a sorcery.",
  ].join('\n');
  const lifted = new Set([
    'choice cost',
    'unbounded decision token parameter-key:SacCost',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Recurring Nightmare composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Priest's fixed-source reanimation and Unearth routes. */
export function legacyCubeReviewedPriestOfFellRitesRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Priest of Fell Rites',
    'ManaCost:W B',
    'Types:Creature Human Warlock',
    'PT:2/2',
    'A:AB$ ChangeZone | Cost$ T PayLife<3> Sac<1/CARDNAME> | Origin$ Graveyard | Destination$ Battlefield | TgtPrompt$ Choose target creature card in your graveyard | ValidTgts$ Creature.YouCtrl | SorcerySpeed$ True | SpellDescription$ Return target creature card from your graveyard to the battlefield.',
    'K:Unearth:3 W B',
    'Oracle:{T}, Pay 3 life, Sacrifice Priest of Fell Rites: Return target creature card from your graveyard to the battlefield. Activate only as a sorcery.\\nUnearth {3}{W}{B} ({3}{W}{B}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)',
  ].join('\n');
  const lifted = new Set([
    'choice cost',
    'unbounded decision token keyword:Unearth',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Priest of Fell Rites composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Smuggler's Copter's Crew and combat-loot routes. */
export function legacyCubeReviewedSmugglersCopterRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    "Name:Smuggler's Copter",
    'ManaCost:2',
    'Types:Artifact Vehicle',
    'PT:3/3',
    'K:Flying',
    'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigLoot | TriggerDescription$ Whenever CARDNAME attacks or blocks, you may draw a card. If you do, discard a card.',
    'T:Mode$ Blocks | ValidCard$ Card.Self | Execute$ TrigLoot | Secondary$ True | TriggerDescription$ Whenever CARDNAME attacks or blocks, you may draw a card. If you do, discard a card.',
    'SVar:TrigLoot:AB$ Discard | Defined$ You | Mode$ TgtChoose | NumCards$ 1 | Cost$ Draw<1/You>',
    'K:Crew:1',
    "Oracle:Flying\\nWhenever Smuggler's Copter attacks or blocks, you may draw a card. If you do, discard a card.\\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)",
  ].join('\n');
  const lifted = new Set([
    'unbounded decision token keyword:Crew',
    'unbounded decision token semantic-marker:triggered-payment',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, "exact reviewed Smuggler's Copter composition"])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Cryptbreaker's two exact activated routes. */
export function legacyCubeReviewedCryptbreakerRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Cryptbreaker',
    'ManaCost:B',
    'Types:Creature Zombie',
    'PT:1/1',
    'A:AB$ Token | Cost$ 1 B T Discard<1/Card> | TokenScript$ b_2_2_zombie | TokenOwner$ You | SpellDescription$ Create a 2/2 black Zombie creature token.',
    'A:AB$ Draw | Cost$ tapXType<3/Zombie> | NumCards$ 1 | AILogic$ AtOppEOT | SpellDescription$ You draw a card and you lose 1 life. | SubAbility$ DBLoseLife',
    'SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 1',
    'SVar:AIPreference:DiscardCost$Card',
    'AI:RemoveDeck:Random',
    'DeckHas:Ability$Token',
    'DeckNeeds:Type$Zombie',
    'Oracle:{1}{B}, {T}, Discard a card: Create a 2/2 black Zombie creature token.\\nTap three untapped Zombies you control: You draw a card and you lose 1 life.',
  ].join('\n');
  const lifted = new Set([
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token parameter-key:DiscardCost',
    'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Cryptbreaker composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Myr Battlesphere's entry tokens and attack payment. */
export function legacyCubeReviewedMyrBattlesphereRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Myr Battlesphere',
    'ManaCost:7',
    'Types:Artifact Creature Myr Construct',
    'PT:4/7',
    'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create four 1/1 colorless Myr artifact creature tokens.',
    'SVar:TrigToken:DB$ Token | TokenAmount$ 4 | TokenScript$ c_1_1_a_myr | TokenOwner$ You',
    "T:Mode$ Attacks | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigPump | TriggerDescription$ Whenever CARDNAME attacks, you may tap X untapped Myr you control. If you do, CARDNAME gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking.",
    'SVar:TrigPump:AB$ Pump | Cost$ tapXType<X/Myr> | Defined$ Self | NumAtt$ +X | SubAbility$ DBDealDamage',
    'SVar:DBDealDamage:DB$ DealDamage | Defined$ TriggeredDefender.Opponent & Valid Planeswalker.TriggeredDefender | NumDmg$ X',
    'SVar:X:Count$xPaid',
    'DeckHas:Ability$Token',
    "Oracle:When Myr Battlesphere enters, create four 1/1 colorless Myr artifact creature tokens.\\nWhenever Myr Battlesphere attacks, you may tap X untapped Myr you control. If you do, Myr Battlesphere gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking.",
  ].join('\n');
  const lifted = new Set([
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token parameter-key:OptionalDecider',
    'unbounded decision token semantic-marker:triggered-payment',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Myr Battlesphere composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Goldspan Dragon and Magda's exact Treasure routes. */
export function legacyCubeReviewedTreasureCohortRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const exactScripts = new Set([
    '4b6e8d0cbec7bdc2957bb72d6a41acf494a84c13e1aa814b0d582171d1fbd6e4',
    '53a5bc9adcad4a7f600b92354d6300ff230eb340de8ea1c3328f8ed4e2c6b6a0',
  ]);
  const blocker = 'unbounded decision token semantic-marker:discard-or-sacrifice-cost';
  const base = [
    ...legacyCubePinnedGeneratedObjectRefusals(bytes, inventory),
    ...legacyCubeChosenCostPaymentRefusals(bytes, {
      allowReviewedTreasureCohortCostParts: true,
    }),
  ];
  if (!exactScripts.has(exactSha256) || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Treasure cohort composition'])];
  }
  return [...new Set(base.filter((refusal) => refusal !== blocker))];
}

/** Closed whole-card boundary for Champion of Wits' exact trigger and Eternalize composition. */
export function legacyCubeReviewedChampionOfWitsRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = '751f3150bbcf839bdb05a54ef9c16b597fb6e69a7856b9976eb996e8c4587d3a';
  const lifted = new Set([
    'unbounded decision token keyword:Eternalize',
    'unbounded decision token semantic-marker:triggered-payment',
  ]);
  if (sha256(new TextEncoder().encode(script)) !== exactSha256) {
    return ['exact reviewed Champion of Wits composition'];
  }
  const base = [
    ...legacyCubeStatedOrderingRefusals(bytes, inventory),
    ...legacyCubeChosenCostPaymentRefusals(bytes, {
      allowReviewedChampionOfWitsCostParts: true,
    }),
  ];
  if ([...lifted].some((item) => !base.includes(item))) {
    return [...new Set([...base, 'exact reviewed Champion of Wits composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Utopia Sprawl's Forest Aura and chosen-mana composition. */
export function legacyCubeReviewedUtopiaSprawlRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Utopia Sprawl',
    'ManaCost:G',
    'Types:Enchantment Aura',
    'K:Enchant:Forest',
    'SVar:AttachAILogic:Pump',
    'K:ETBReplacement:Other:ChooseColor',
    'SVar:ChooseColor:DB$ ChooseColor | Defined$ You | SpellDescription$ As CARDNAME enters, choose a color.',
    'T:Mode$ TapsForMana | ValidCard$ Card.AttachedBy | TriggerZones$ Battlefield | Execute$ TrigMana | Static$ True | TriggerDescription$ Whenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
    'SVar:TrigMana:DB$ Mana | Produced$ Chosen | Defined$ TriggeredCardController',
    'AI:RemoveDeck:All',
    'Oracle:Enchant Forest\\nAs Utopia Sprawl enters, choose a color.\\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
  ].join('\n');
  const lifted = new Set(['attachment target', 'unbounded decision token keyword:Enchant']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Utopia Sprawl composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Splinter Twin's creature Aura and copied-token composition. */
export function legacyCubeReviewedSplinterTwinRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Splinter Twin',
    'ManaCost:2 R R',
    'Types:Enchantment Aura',
    'K:Enchant:Creature',
    'SVar:AttachAILogic:Pump',
    'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddAbility$ ABCopy | Description$ Enchanted creature has "{T}: Create a token that\'s a copy of this creature, except it has haste. Exile it at the beginning of the next end step."',
    "SVar:ABCopy:AB$ CopyPermanent | Cost$ T | Defined$ Self | AddKeywords$ Haste | AtEOT$ Exile | SpellDescription$ Create a token that's a copy of this creature, except it has haste. Exile it at the beginning of the next end step.",
    'SVar:NonStackingAttachEffect:True',
    'Oracle:Enchant creature\\nEnchanted creature has "{T}: Create a token that\'s a copy of this creature, except it has haste. Exile that token at the beginning of the next end step."',
  ].join('\n');
  const lifted = new Set(['attachment target', 'unbounded decision token keyword:Enchant']);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Splinter Twin composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Lingering Souls' token and Flashback composition. */
export function legacyCubeReviewedLingeringSoulsRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Lingering Souls',
    'ManaCost:2 W',
    'Types:Sorcery',
    'K:Flashback:1 B',
    'A:SP$ Token | TokenAmount$ 2 | TokenScript$ w_1_1_spirit_flying | TokenOwner$ You | SpellDescription$ Create two 1/1 white Spirit creature tokens with flying.',
    'DeckHas:Ability$Token',
    'Oracle:Create two 1/1 white Spirit creature tokens with flying.\\nFlashback {1}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
  ].join('\n');
  const lifted = new Set([
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token keyword:Flashback',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Lingering Souls composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for optional triggers that create pinned tokens. */
export function legacyCubeReviewedOptionalGeneratedTokenRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScripts = [
    [
      'Name:Emeria Angel',
      'ManaCost:2 W W',
      'Types:Creature Angel',
      'PT:3/3',
      'K:Flying',
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | TriggerZones$ Battlefield | Execute$ TrigToken | OptionalDecider$ You | TriggerDescription$ Landfall — Whenever a land you control enters, you may create a 1/1 white Bird creature token with flying.',
      'SVar:TrigToken:DB$ Token | TokenScript$ w_1_1_bird_flying | TokenOwner$ You',
      'Oracle:Flying\\nLandfall — Whenever a land you control enters, you may create a 1/1 white Bird creature token with flying.',
    ].join('\n'),
    [
      'Name:Awakening Zone',
      'ManaCost:2 G',
      'Types:Enchantment',
      'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | OptionalDecider$ You | Execute$ TrigToken | TriggerDescription$ At the beginning of your upkeep, you may create a 0/1 colorless Eldrazi Spawn creature token. It has "Sacrifice this creature: Add {C}."',
      'SVar:TrigToken:DB$ Token | TokenScript$ c_0_1_eldrazi_spawn_sac | TokenOwner$ You',
      'DeckHints:Type$Eldrazi',
      'DeckHas:Ability$Mana.Colorless|Token',
      'Oracle:At the beginning of your upkeep, you may create a 0/1 colorless Eldrazi Spawn creature token. It has "Sacrifice this creature: Add {C}."',
    ].join('\n'),
    [
      'Name:Avenger of Zendikar',
      'ManaCost:5 G G',
      'Types:Creature Elemental',
      'PT:5/5',
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME enters, create a 0/1 green Plant creature token for each land you control.',
      'SVar:TrigToken:DB$ Token | TokenAmount$ X | TokenScript$ g_0_1_plant | TokenOwner$ You',
      'SVar:X:Count$Valid Land.YouCtrl',
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | TriggerZones$ Battlefield | Execute$ TrigPutCounterAll | OptionalDecider$ You | TriggerDescription$ Landfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.',
      'SVar:TrigPutCounterAll:DB$ PutCounterAll | ValidCards$ Creature.Plant+YouCtrl | CounterType$ P1P1 | CounterNum$ 1 | AILogic$ Always',
      'SVar:BuffedBy:Land',
      'Oracle:When Avenger of Zendikar enters, create a 0/1 green Plant creature token for each land you control.\\nLandfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.',
    ].join('\n'),
  ];
  const lifted = new Set([
    'unpinned generated-object source',
    'unbounded decision token ability-api:Token',
    'unbounded decision token parameter-key:OptionalDecider',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (!exactScripts.includes(script) || [...lifted].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed optional generated-token composition'])];
  }
  return base.filter((refusal) => !lifted.has(refusal));
}

/** Closed whole-card boundary for Glorybringer's optional attack-cost lifecycle. */
export function legacyCubeReviewedGlorybringerRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Glorybringer',
    'ManaCost:3 R R',
    'Types:Creature Dragon',
    'PT:4/4',
    'K:Flying',
    'K:Haste',
    'S:Mode$ OptionalAttackCost | ValidCard$ Card.Self | Trigger$ TrigDealDamage | Cost$ Exert<1/CARDNAME> | Description$ You may exert CARDNAME as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls.',
    'SVar:TrigDealDamage:DB$ DealDamage | ValidTgts$ Creature.nonDragon+OppCtrl | TgtPrompt$ Select target non-Dragon creature an opponent controls | NumDmg$ 4 | SpellDescription$ When you exert CARDNAME, it deals 4 damage to target non-Dragon creature an opponent controls.',
    "Oracle:Flying, haste\\nYou may exert Glorybringer as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls. (An exerted creature won't untap during your next untap step.)",
  ].join('\n');
  const blocker = 'unbounded decision token ability-api:OptionalAttackCost';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Glorybringer composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for Grim Lavamancer's exact graveyard-exile payment. */
export function legacyCubeReviewedGrimLavamancerRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Grim Lavamancer',
    'ManaCost:R',
    'Types:Creature Human Wizard',
    'PT:1/1',
    'A:AB$ DealDamage | Cost$ R T ExileFromGrave<2/Card> | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.',
    'SVar:NonCombatPriority:1',
    'Oracle:{R}, {T}, Exile two cards from your graveyard: Grim Lavamancer deals 2 damage to any target.',
  ].join('\n');
  const blocker = 'choice cost';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Grim Lavamancer composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for Gifts Ungiven's exact distinct-name search. */
export function legacyCubeReviewedGiftsUngivenRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Gifts Ungiven',
    'ManaCost:3 U',
    'Types:Instant',
    'A:SP$ ChangeZone | Origin$ Library | Destination$ Library | ChangeType$ Card | ChangeNum$ 4 | RememberChanged$ True | Reveal$ True | Shuffle$ False | DifferentNames$ True | SubAbility$ DBChangeZone1 | StackDescription$ REP Search_{p:You} searches & your library_their library & reveal_reveals | SpellDescription$ Search your library for up to four cards with different names and reveal them.',
    'SVar:DBChangeZone1:DB$ ChangeZone | ValidTgts$ Opponent | DefinedPlayer$ You | Chooser$ Targeted | SelectPrompt$ Choose two cards for the graveyard | NoLooking$ True | Hidden$ True | Origin$ Library | Destination$ Graveyard | ChangeType$ Card.IsRemembered | ChangeNum$ 2 | Mandatory$ True | SelectPrompt$ Select two cards for the graveyard | Shuffle$ False | SubAbility$ DBChangeZone2 | StackDescription$ REP Target opponent_{p:Targeted} & Put_{p:You} puts & your graveyard_their graveyard & your hand_their hand & shuffle_{p:You} shuffles | SpellDescription$ Target opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.',
    'SVar:DBChangeZone2:DB$ ChangeZoneAll | Origin$ Library | Destination$ Hand | ChangeType$ Card.IsRemembered | Shuffle$ True | SubAbility$ DBCleanup | StackDescription$ None',
    'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    'DeckHints:Ability$Graveyard',
    'Oracle:Search your library for up to four cards with different names and reveal them. Target opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.',
  ].join('\n');
  const blocker = 'distinct-name selection constraint';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Gifts Ungiven composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for Liliana of the Veil's exact TwoPiles ultimate. */
export function legacyCubeReviewedLilianaTwoPilesRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Liliana of the Veil',
    'ManaCost:1 B B',
    'Types:Legendary Planeswalker Liliana',
    'Loyalty:3',
    'A:AB$ Discard | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | NumCards$ 1 | Mode$ TgtChoose | Defined$ Player | SpellDescription$ Each player discards a card.',
    'A:AB$ Sacrifice | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | ValidTgts$ Player | SacValid$ Creature | SpellDescription$ Target player sacrifices a creature.',
    'A:AB$ TwoPiles | Cost$ SubCounter<6/LOYALTY> | Planeswalker$ True | Ultimate$ True | ValidTgts$ Player | Separator$ You | ChosenPile$ DBSacAll | ValidCards$ Permanent | Zone$ Battlefield | AILogic$ Worst | StackDescription$ REP target player_{p:Targeted} | SpellDescription$ Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.',
    'SVar:DBSacAll:DB$ SacrificeAll | ValidCards$ Permanent.IsRemembered',
    'DeckHas:Ability$Discard|Sacrifice',
    'Oracle:[+1]: Each player discards a card.\\n[-2]: Target player sacrifices a creature.\\n[-6]: Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.',
  ].join('\n');
  const blocker = 'unbounded decision token ability-api:TwoPiles';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed Liliana of the Veil composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for Fact or Fiction's exact remembered reveal and TwoPiles chain. */
export function legacyCubeReviewedFactOrFictionRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactScript = [
    'Name:Fact or Fiction',
    'ManaCost:3 U',
    'Types:Instant',
    'A:SP$ PeekAndReveal | PeekAmount$ 5 | RememberRevealed$ True | NoPeek$ True | SubAbility$ DBTwoPiles | SpellDescription$ Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.',
    'SVar:DBTwoPiles:DB$ TwoPiles | Defined$ You | DefinedCards$ Remembered | Separator$ Opponent | ChosenPile$ DBHand | UnchosenPile$ DBGrave | StackDescription$ An opponent separates those cards into two piles. {p:You} puts one pile into their hand and the other into their graveyard.',
    'SVar:DBHand:DB$ ChangeZone | Defined$ Remembered | Origin$ Library | Destination$ Hand',
    'SVar:DBGrave:DB$ ChangeZone | Defined$ Remembered | Origin$ Library | Destination$ Graveyard',
    'Oracle:Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.',
  ].join('\n');
  const blockers = new Set([
    'unbounded decision token ability-api:PeekAndReveal',
    'unbounded decision token ability-api:TwoPiles',
  ]);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (script !== exactScript || [...blockers].some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed Fact or Fiction composition'])];
  }
  return base.filter((refusal) => !blockers.has(refusal));
}

/** Closed whole-card boundary for the exact Yorion and Obosh companion scripts. */
export function legacyCubeReviewedCompanionRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactYorion = [
    'Name:Yorion, Sky Nomad',
    'ManaCost:3 WU WU',
    'Types:Legendary Creature Bird Serpent',
    'PT:4/5',
    'K:Companion:Special:DeckSizePlus20:Your starting deck contains at least twenty cards more than the minimum deck size.',
    'K:Flying',
    'T:Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Any | Destination$ Battlefield | Execute$ TrigExile | TriggerDescription$ When NICKNAME enters, exile any number of other cards you own and control. Return those cards to the battlefield at the beginning of the next end step.',
    'SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ChangeType$ Permanent.nonLand+Other+YouOwn+YouCtrl | SelectPrompt$ Select any number of other nonland permanents you own and control | Hidden$ True | ChangeNum$ X | RememberChanged$ True | SubAbility$ DelTrig',
    'SVar:DelTrig:DB$ DelayedTrigger | Mode$ Phase | Phase$ End of Turn | Execute$ TrigReturn | RememberObjects$ RememberedLKI | TriggerDescription$ Return those cards to the battlefield at the beginning of the next end step. | SubAbility$ DBCleanup',
    'SVar:TrigReturn:DB$ ChangeZone | Origin$ Exile | Destination$ Battlefield | Defined$ DelayTriggerRememberedLKI',
    'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
    'SVar:X:Count$Valid Permanent.nonLand+Other+YouOwn+YouCtrl',
    'Oracle:Companion — Your starting deck contains at least twenty cards more than the minimum deck size. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} any time you could cast a sorcery.)\\nFlying\\nWhen Yorion enters, exile any number of other nonland permanents you own and control. Return those cards to the battlefield at the beginning of the next end step.',
  ].join('\n');
  const exactObosh = [
    'Name:Obosh, the Preypiercer',
    'ManaCost:3 BR BR',
    'Types:Legendary Creature Hellion Horror',
    'PT:3/5',
    'K:Companion:Card.cmcM21,Land:Your starting deck contains only cards with odd mana value and land cards.',
    'R:Event$ DamageDone | ActiveZones$ Battlefield | ValidSource$ Card.YouCtrl+cmcM21 | ValidTarget$ Permanent,Player | ReplaceWith$ DmgTwice | Description$ If a source you control with an odd mana value would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.',
    'SVar:DmgTwice:DB$ ReplaceEffect | VarName$ DamageAmount | VarValue$ Y',
    'SVar:Y:ReplaceCount$DamageAmount/Twice',
    'SVar:PlayMain1:TRUE',
    'Oracle:Companion — Your starting deck contains only cards with odd mana values and land cards. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} any time you could cast a sorcery.)\\nIf a source you control with an odd mana value would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.',
  ].join('\n');
  const blocker = 'unbounded decision token keyword:Companion';
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if ((script !== exactYorion && script !== exactObosh) || !base.includes(blocker)) {
    return [...new Set([...base, 'exact reviewed companion composition'])];
  }
  return base.filter((refusal) => refusal !== blocker);
}

/** Closed whole-card boundary for Koma, Retrofitter Foundry, and Treasure Map. */
export function legacyCubeReviewedGeneratedTokenSacrificeRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const expectedBlockers = new Map<string, readonly string[]>([
    [
      '09836c4f4cd2e63d809521300dce28a800e1ec237a8cadc36b3f7b43885e714d',
      ['unbounded decision token semantic-marker:discard-or-sacrifice-cost'],
    ],
    [
      '6efd8eaa8215af3f5a2aca3373df224afee59f96b03ff2235970ab58cc9d06b9',
      [
        'unbounded decision token parameter-key:SacCost',
        'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
      ],
    ],
    [
      'ff9c75692a7146b8ba7c1adbf5c7ace2231925ffe318ce7db1aba7bc810a3e01',
      [
        'unbounded decision token semantic-marker:alternate-mode',
        'unbounded decision token semantic-marker:discard-or-sacrifice-cost',
      ],
    ],
  ]);
  const blockers = expectedBlockers.get(exactSha256);
  const base = [
    ...legacyCubePinnedGeneratedObjectRefusals(bytes, inventory),
    ...legacyCubeChosenCostPaymentRefusals(bytes, {
      allowReviewedGeneratedTokenSacrificeCostParts: true,
    }),
  ];
  if (blockers === undefined || blockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed generated-token sacrifice composition'])];
  }
  return [...new Set(base.filter((refusal) => !blockers.includes(refusal)))];
}

/** Closed whole-card boundary for Liliana, Ranger Class, and Vivien. */
export function legacyCubeReviewedGeneratedObjectBoundedChoiceRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const expectedBlocker = new Map<string, string>([
    ['2b236376d99545d7bf972d7ea301475d45a8a0c21254bedf61ece53a7309aa3e', 'optional target'],
    ['10c4042f7b3c16cfd832cb900fac0090b6cd08d82663a7053571d70b8a8a7023', 'trigger target'],
    ['01cb5b8d9bdaa0a2d48d201ef5b19e7aa147731dff9079e2899e02a4c3a19086', 'counter-type choice'],
  ]).get(exactSha256);
  const base = legacyCubePinnedGeneratedObjectRefusals(bytes, inventory);
  if (expectedBlocker === undefined || !base.includes(expectedBlocker)) {
    return [...new Set([...base, 'exact reviewed generated-object bounded-choice composition'])];
  }
  return base.filter((refusal) => refusal !== expectedBlocker);
}

/** Closed whole-card boundary for Shark Typhoon and Ragavan. */
export function legacyCubeReviewedAlternateCostGeneratedObjectRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const expectedBlocker = new Map<string, string>([
    [
      'c13de0737d9f9b6a6cd35fd3fa31f84dc55927e9094e71053d6cfe269b27f428',
      'unbounded decision token keyword:Cycling',
    ],
    [
      '9399ba5a2573e71cae910ebf0b4224f303fc506e133bdbb7e3a622291298c7bf',
      'unbounded decision token keyword:Dash',
    ],
  ]).get(exactSha256);
  const base = legacyCubePinnedGeneratedObjectRefusals(bytes, inventory);
  if (expectedBlocker === undefined || !base.includes(expectedBlocker)) {
    return [...new Set([...base, 'exact reviewed alternate-cost generated-object composition'])];
  }
  return base.filter((refusal) => refusal !== expectedBlocker);
}

/** Closed whole-card boundary for Deranged Hermit and Xenagos, the Reveler. */
export function legacyCubeReviewedResidualGeneratedTokenRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const expectedBlocker = new Map<string, string>([
    [
      '602b83061e596f737a9ecbecdefe814369c9527757bb41a8e2cdcb9b9400636b',
      'unbounded decision token keyword:Echo',
    ],
    ['1fa281bb65aaaeb434a8b205ee258a5b5ff60fb469edad001779dab569be60d9', 'multi-mana combo'],
  ]).get(exactSha256);
  const base = legacyCubePinnedGeneratedObjectRefusals(bytes, inventory);
  if (expectedBlocker === undefined || !base.includes(expectedBlocker)) {
    return [...new Set([...base, 'exact reviewed residual generated-token composition'])];
  }
  return base.filter((refusal) => refusal !== expectedBlocker);
}

/** Closed whole-card boundary for Terastodon, Oko, and Saheeli. */
export function legacyCubeReviewedMultiTargetTransformationRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const expectedBlockers = new Map<string, readonly string[]>([
    [
      '5b8e7d7e8a2b41d3998a486c0fce423351f48d10cc59a5703d719cf94c93654a',
      ['trigger target', 'optional target', 'multiple targets'],
    ],
    ['912e679f9e75fd6422b0d80ccb53662225a9613b4da53fac98c0250677bbf100', ['nested target block']],
    ['d724018a55125d7478052f10652617dba87837a9783178aa28e5d820a541b33a', ['nested target block']],
  ]).get(exactSha256);
  const base = legacyCubePinnedGeneratedObjectRefusals(bytes, inventory);
  if (expectedBlockers === undefined || expectedBlockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed multi-target transformation composition'])];
  }
  return base.filter((refusal) => !expectedBlockers.includes(refusal));
}

/** Closed whole-card boundary for Garruk Relentless, Daretti, and Grist. */
export function legacyCubeReviewedPlaneswalkerUnlessSacrificeRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const expectedBlockers = new Map<string, readonly string[]>([
    [
      '5306ea559d3ce3ade29e995bca0ed8e288e7ef9f2b21b5ec95694088054b026e',
      [
        'unbounded decision token parameter-key:UnlessCost',
        'unbounded decision token semantic-marker:alternate-mode',
      ],
    ],
    [
      '806695d743ecda2ecbb223a2d84a27ef5f4c662946d66ea033dd8e542d753283',
      ['multiple target zones', 'unbounded decision token parameter-key:UnlessCost'],
    ],
    [
      '7afc59a50a269c8053caecbe453056d140c12c90f1bd03467d6d72d66b8968da',
      ['trigger target', 'unbounded decision token parameter-key:UnlessCost'],
    ],
  ]).get(exactSha256);
  const base = legacyCubePinnedGeneratedObjectRefusals(bytes, inventory);
  if (expectedBlockers === undefined || expectedBlockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed planeswalker UnlessCost sacrifice composition'])];
  }
  return base.filter((refusal) => !expectedBlockers.includes(refusal));
}

/** Closed whole-card boundary for Malicious Affliction and Chain Lightning. */
export function legacyCubeReviewedCopySpellRetargetRefusals(
  bytes: Uint8Array,
  inventory: readonly LegacyCubeDecisionSyntaxToken[],
): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd();
  const exactSha256 = sha256(new TextEncoder().encode(script));
  const expectedBlockers = new Map<string, readonly string[]>([
    [
      '929c331110e77977858db845e6913d1664849ade3388c56a14c89d9bf126afd2',
      [
        'unbounded decision token parameter-key:MayChooseTarget',
        'unbounded decision token parameter-key:OptionalDecider',
        'unbounded decision token semantic-marker:optional-trigger-or-replacement',
      ],
    ],
    [
      '92a12c7bab3e57f82efce0c7d84e214b32030f2bb062a42797874c707fc4e8fc',
      [
        'unbounded decision token parameter-key:MayChooseTarget',
        'unbounded decision token parameter-key:UnlessCost',
        'unbounded decision token semantic-marker:optional-trigger-or-replacement',
      ],
    ],
  ]).get(exactSha256);
  const base = legacyCubeStatedOrderingRefusals(bytes, inventory);
  if (expectedBlockers === undefined || expectedBlockers.some((blocker) => !base.includes(blocker))) {
    return [...new Set([...base, 'exact reviewed spell-copy retarget composition'])];
  }
  return base.filter((refusal) => !expectedBlockers.includes(refusal));
}

const CALLBACK_PROFILE_REFUSALS: Partial<
  Record<
    LegacyCubeBridgeCapabilityBundle['topLevel'],
    (bytes: Uint8Array, inventory: readonly LegacyCubeDecisionSyntaxToken[]) => readonly string[]
  >
> = {
  'optional-trigger-confirm-v1': legacyCubeOptionalTriggerConfirmProfileRefusals,
  'bounded-multi-selection-v1': legacyCubeBoundedMultiSelectionRefusals,
  'bounded-enumerated-choice-v1': legacyCubeBoundedEnumeratedChoiceRefusals,
  'announced-number-v1': legacyCubeAnnouncedNumberRefusals,
  'stated-ordering-v1': legacyCubeStatedOrderingRefusals,
  'stated-distribution-v1': legacyCubeStatedDistributionRefusals,
  'stated-retarget-v1': legacyCubeStatedRetargetRefusals,
  'open-card-naming-v1': legacyCubeOpenCardNamingRefusals,
  'discard-or-reviewed-sacrifice-cost-v2': legacyCubeDiscardOrSourceSacrificeCostRefusals,
  'stated-ordering-and-pinned-generated-token-v1': legacyCubePinnedGeneratedObjectRefusals,
  'stated-ordering-trigger-target-and-reviewed-hidden-hand-v1':
    legacyCubeStatedOrderingTriggerTargetAndHiddenHandRefusals,
  'stated-ordering-and-reviewed-trigger-target-v1': legacyCubeReviewedTriggerTargetRefusals,
  'stated-ordering-and-reviewed-counter-type-choice-v1': legacyCubeReviewedCounterTypeChoiceRefusals,
  'stated-ordering-and-reviewed-optional-target-v1': legacyCubeReviewedOptionalTargetRefusals,
  'stated-ordering-and-reviewed-phyrexian-spell-cost-v1': legacyCubeReviewedPhyrexianSpellCostRefusals,
  'stated-ordering-and-reviewed-cascade-v1': legacyCubeReviewedCascadeRefusals,
  'stated-ordering-and-reviewed-repeatable-mode-v1': legacyCubeReviewedRepeatableModeRefusals,
  'stated-ordering-and-reviewed-plow-under-v1': legacyCubeReviewedMultipleTargetRefusals,
  'stated-ordering-and-reviewed-coalition-relic-v1': legacyCubeReviewedManaComboRefusals,
  'stated-ordering-and-reviewed-cryptic-command-v1': legacyCubeReviewedCrypticCommandRefusals,
  'stated-ordering-and-reviewed-prismari-command-v1': legacyCubeReviewedPrismariCommandRefusals,
  'stated-ordering-and-reviewed-blessed-alliance-v1': legacyCubeReviewedBlessedAllianceRefusals,
  'stated-ordering-and-reviewed-kalitas-v1': legacyCubeReviewedKalitasRefusals,
  'stated-ordering-and-reviewed-uro-v1': legacyCubeReviewedUroRefusals,
  'stated-ordering-and-reviewed-kroxa-v1': legacyCubeReviewedKroxaRefusals,
  'stated-ordering-and-reviewed-huntmaster-v1': legacyCubeReviewedHuntmasterRefusals,
  'stated-ordering-and-reviewed-remaining-planeswalkers-v1': legacyCubeReviewedRemainingPlaneswalkersRefusals,
  'stated-ordering-and-reviewed-final-six-v1': legacyCubeReviewedFinalSixRefusals,
  'stated-ordering-and-reviewed-phantasmal-image-v1': legacyCubeReviewedPhantasmalImageRefusals,
  'stated-ordering-and-reviewed-peek-and-reveal-v1': legacyCubeReviewedPeekAndRevealRefusals,
  'stated-ordering-and-reviewed-optional-copy-replacement-v1':
    legacyCubeReviewedOptionalCopyReplacementRefusals,
  'stated-ordering-and-reviewed-karn-liberated-v1': legacyCubeReviewedKarnLiberatedRefusals,
  'stated-ordering-and-reviewed-rattleclaw-mystic-v1': legacyCubeReviewedRattleclawMysticRefusals,
  'stated-ordering-and-reviewed-lightning-phoenix-v1': legacyCubeReviewedLightningPhoenixRefusals,
  'stated-ordering-and-reviewed-baral-triggered-loot-v1': legacyCubeReviewedBaralRefusals,
  'stated-ordering-and-reviewed-unless-cost-v1': legacyCubeReviewedUnlessCostRefusals,
  'stated-ordering-and-reviewed-counter-unless-cost-v1': legacyCubeReviewedCounterUnlessCostRefusals,
  'stated-ordering-and-reviewed-miscalculation-v1': legacyCubeReviewedMiscalculationRefusals,
  'stated-ordering-and-reviewed-maul-of-the-skyclaves-v1': legacyCubeReviewedMaulOfTheSkyclavesRefusals,
  'stated-ordering-and-reviewed-embercleave-v1': legacyCubeReviewedEmbercleaveRefusals,
  'stated-ordering-and-reviewed-living-weapon-v1': legacyCubeReviewedLivingWeaponRefusals,
  'stated-ordering-and-reviewed-foretell-v1': legacyCubeReviewedForetellRefusals,
  'stated-ordering-and-reviewed-satyr-wayfinder-v1': legacyCubeReviewedSatyrWayfinderRefusals,
  'stated-ordering-and-reviewed-blue-library-selection-v1': legacyCubeReviewedBlueLibrarySelectionRefusals,
  'stated-ordering-and-reviewed-gideon-garruk-bloodline-v1': legacyCubeReviewedGideonGarrukBloodlineRefusals,
  'stated-ordering-and-reviewed-hideaway-four-v1': legacyCubeReviewedHideawayRefusals,
  'stated-ordering-and-reviewed-sword-of-fire-and-ice-v1': legacyCubeReviewedSwordOfFireAndIceRefusals,
  'stated-ordering-and-reviewed-sword-of-feast-and-famine-v1':
    legacyCubeReviewedSwordOfFeastAndFamineRefusals,
  'stated-ordering-and-reviewed-sword-of-light-and-shadow-v1':
    legacyCubeReviewedSwordOfLightAndShadowRefusals,
  'stated-ordering-and-reviewed-sword-of-body-and-mind-v1': legacyCubeReviewedSwordOfBodyAndMindRefusals,
  'stated-ordering-and-reviewed-sword-of-hearth-and-home-v1': legacyCubeReviewedSwordOfHearthAndHomeRefusals,
  'stated-ordering-and-reviewed-umezawas-jitte-v1': legacyCubeReviewedUmezawasJitteRefusals,
  'stated-ordering-and-reviewed-birgi-v1': legacyCubeReviewedBirgiRefusals,
  'stated-ordering-and-reviewed-birthing-pod-v1': legacyCubeReviewedBirthingPodRefusals,
  'stated-ordering-and-reviewed-ranger-captain-of-eos-v1': legacyCubeReviewedRangerCaptainOfEosRefusals,
  'stated-ordering-and-reviewed-forbid-v1': legacyCubeReviewedForbidRefusals,
  'stated-ordering-and-reviewed-reveillark-v1': legacyCubeReviewedReveillarkRefusals,
  'stated-ordering-and-reviewed-bloodchiefs-thirst-v1': legacyCubeReviewedBloodchiefsThirstRefusals,
  'stated-ordering-and-reviewed-primal-might-v1': legacyCubeReviewedPrimalMightRefusals,
  'announced-number-and-reviewed-engineered-explosives-v1': legacyCubeReviewedEngineeredExplosivesRefusals,
  'stated-ordering-and-reviewed-reorder-or-shuffle-v1': legacyCubeReviewedReorderOrShuffleRefusals,
  'stated-ordering-and-reviewed-animate-dead-v1': legacyCubeReviewedAnimateDeadRefusals,
  'stated-ordering-and-reviewed-heartless-act-v1': legacyCubeReviewedHeartlessActRefusals,
  'stated-ordering-and-reviewed-agadeems-awakening-v1': legacyCubeReviewedAgadeemsAwakeningRefusals,
  'stated-ordering-and-reviewed-modal-land-spells-v1': legacyCubeReviewedModalLandSpellRefusals,
  'stated-ordering-and-reviewed-convoke-v1': legacyCubeReviewedConvokeRefusals,
  'stated-ordering-and-reviewed-delve-v1': legacyCubeReviewedDelveRefusals,
  'stated-ordering-and-reviewed-free-counterspell-v1': legacyCubeReviewedFreeCounterspellRefusals,
  'stated-ordering-and-reviewed-legions-landing-v1': legacyCubeReviewedLegionsLandingRefusals,
  'stated-ordering-and-reviewed-gilded-goose-v1': legacyCubeReviewedGildedGooseRefusals,
  'stated-ordering-and-reviewed-pia-siege-gang-v1': legacyCubeReviewedPiaSiegeGangRefusals,
  'stated-ordering-and-reviewed-treachery-v1': legacyCubeReviewedTreacheryRefusals,
  'stated-ordering-and-reviewed-skyclave-apparition-v1': legacyCubeReviewedSkyclaveApparitionRefusals,
  'stated-ordering-and-reviewed-path-to-exile-v1': legacyCubeReviewedPathToExileRefusals,
  'stated-ordering-and-reviewed-glen-elendra-archmage-v1': legacyCubeReviewedGlenElendraArchmageRefusals,
  'stated-ordering-and-reviewed-recurring-nightmare-v1': legacyCubeReviewedRecurringNightmareRefusals,
  'stated-ordering-and-reviewed-priest-of-fell-rites-v1': legacyCubeReviewedPriestOfFellRitesRefusals,
  'stated-ordering-and-reviewed-smugglers-copter-v1': legacyCubeReviewedSmugglersCopterRefusals,
  'stated-ordering-and-reviewed-cryptbreaker-v1': legacyCubeReviewedCryptbreakerRefusals,
  'stated-ordering-and-reviewed-myr-battlesphere-v1': legacyCubeReviewedMyrBattlesphereRefusals,
  'stated-ordering-and-audited-treasure-cohort-v1': legacyCubeReviewedTreasureCohortRefusals,
  'stated-ordering-and-reviewed-champion-of-wits-v1': legacyCubeReviewedChampionOfWitsRefusals,
  'stated-ordering-and-reviewed-utopia-sprawl-v1': legacyCubeReviewedUtopiaSprawlRefusals,
  'stated-ordering-and-reviewed-splinter-twin-v1': legacyCubeReviewedSplinterTwinRefusals,
  'stated-ordering-and-reviewed-lingering-souls-v1': legacyCubeReviewedLingeringSoulsRefusals,
  'stated-ordering-and-reviewed-optional-generated-token-v1':
    legacyCubeReviewedOptionalGeneratedTokenRefusals,
  'stated-ordering-and-reviewed-glorybringer-v1': legacyCubeReviewedGlorybringerRefusals,
  'stated-ordering-and-reviewed-grim-lavamancer-v1': legacyCubeReviewedGrimLavamancerRefusals,
  'stated-ordering-and-reviewed-gifts-ungiven-v1': legacyCubeReviewedGiftsUngivenRefusals,
  'stated-ordering-and-reviewed-liliana-two-piles-v1': legacyCubeReviewedLilianaTwoPilesRefusals,
  'stated-ordering-and-reviewed-fact-or-fiction-v1': legacyCubeReviewedFactOrFictionRefusals,
  'stated-ordering-and-reviewed-companion-v1': legacyCubeReviewedCompanionRefusals,
  'stated-ordering-and-reviewed-generated-token-sacrifice-v1':
    legacyCubeReviewedGeneratedTokenSacrificeRefusals,
  'stated-ordering-and-reviewed-generated-object-bounded-choice-v1':
    legacyCubeReviewedGeneratedObjectBoundedChoiceRefusals,
  'stated-ordering-and-reviewed-alternate-cost-generated-object-v1':
    legacyCubeReviewedAlternateCostGeneratedObjectRefusals,
  'stated-ordering-and-reviewed-residual-generated-token-v1':
    legacyCubeReviewedResidualGeneratedTokenRefusals,
  'stated-ordering-and-reviewed-multi-target-transformation-v1':
    legacyCubeReviewedMultiTargetTransformationRefusals,
  'stated-ordering-and-reviewed-planeswalker-unless-sacrifice-v1':
    legacyCubeReviewedPlaneswalkerUnlessSacrificeRefusals,
  'stated-ordering-and-reviewed-copy-spell-retarget-v1': legacyCubeReviewedCopySpellRetargetRefusals,
  'stated-ordering-and-reviewed-alternate-cost-v1': legacyCubeReviewedAlternateCostRefusals,
  'stated-ordering-and-optional-decider-you-v1': legacyCubeOptionalDeciderYouRefusals,
  'stated-ordering-and-reviewed-optional-library-search-v1': legacyCubeReviewedOptionalLibrarySearchRefusals,
  'stated-ordering-and-reviewed-alternate-mode-v1': legacyCubeReviewedAlternateModeRefusals,
};

/** Verifies actual installed bytes for one path against its ledger attestation. */
export function verifyLegacyCubeDecisionScript(
  entry: LegacyCubeDecisionEntry,
  bytes: Uint8Array,
  inventory?: readonly LegacyCubeDecisionSyntaxToken[],
): void {
  const actual = sha256(bytes);
  if (actual !== entry.forgeScriptSha256) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `Forge script checksum drift for ${entry.correctedName}: expected ${entry.forgeScriptSha256}, got ${actual}`,
    );
  }
  if (inventory !== undefined) verifyLegacyCubeDecisionSyntax(bytes, inventory);
  if (inventory === undefined) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      'script verification requires the closed syntax inventory',
    );
  }
  const classified = classifyLegacyCubeForgeScript(bytes, inventory);
  if (
    JSON.stringify(classified.families) !== JSON.stringify(entry.families) ||
    JSON.stringify(classified.evidenceMarkers) !== JSON.stringify(entry.evidenceMarkers) ||
    JSON.stringify(classified.unknownDecisionSyntax) !== JSON.stringify(entry.unknownDecisionSyntax)
  ) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `decision classification drift for ${entry.correctedName}`,
    );
  }
  if (entry.cardFamilySafe) {
    const profile = entry.bridgeCapabilityProfile;
    if (profile === null) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `missing capability profile for safe card ${entry.correctedName}`,
      );
    }
    const graveyardShape = LEGACY_CUBE_PUBLIC_GRAVEYARD_SELECTION_SHAPES[entry.position ?? 0];
    const manaRefusals =
      profile.manaPayment === 'ordinary-mana-payment-v1'
        ? legacyCubeOrdinaryManaPaymentRefusals(bytes)
        : profile.topLevel === 'stated-ordering-and-reviewed-phyrexian-spell-cost-v1' ||
            profile.topLevel === 'stated-ordering-and-reviewed-birthing-pod-v1' ||
            (profile.topLevel === 'stated-ordering-and-reviewed-optional-copy-replacement-v1' &&
              entry.position === 496)
          ? legacyCubePhyrexianManaPaymentRefusals(bytes)
          : legacyCubeAnnouncedManaPaymentRefusals(bytes);
    const refusals = [
      ...(graveyardShape === undefined
        ? []
        : legacyCubePublicGraveyardSelectionRefusals(bytes, graveyardShape)),
      ...manaRefusals.filter(
        (refusal) =>
          !(
            profile.topLevel === 'stated-ordering-and-reviewed-free-counterspell-v1' &&
            refusal === 'alternative or additional cost'
          ) &&
          !(
            profile.topLevel === 'stated-ordering-and-reviewed-coalition-relic-v1' &&
            refusal === 'multi-mana combo'
          ) &&
          !(
            profile.topLevel === 'stated-ordering-and-reviewed-residual-generated-token-v1' &&
            entry.position === 418 &&
            refusal === 'multi-mana combo'
          ) &&
          !(
            (profile.topLevel === 'stated-ordering-and-reviewed-convoke-v1' ||
              profile.topLevel === 'stated-ordering-and-reviewed-delve-v1') &&
            refusal === 'special payment keyword'
          ) &&
          !(
            profile.topLevel === 'stated-ordering-and-reviewed-final-six-v1' &&
            entry.position === 393 &&
            refusal === 'special payment keyword'
          ),
      ),
      ...legacyCubeChosenCostPaymentRefusals(bytes, {
        allowPhyrexianManaCostParts: profile.manaPayment === 'phyrexian-mana-payment-v1',
        allowBoundedPermanentCostParts: LEGACY_CUBE_BOUNDED_PERMANENT_COST_POSITIONS.some(
          (position) => position === entry.position,
        ),
        allowReviewedDiscardCostParts:
          profile.topLevel === 'stated-ordering-and-reviewed-birgi-v1' ||
          LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_SAFE_POSITIONS.some(
            (position) => position === entry.position,
          ),
        allowReviewedCreatureDiscardCostPart: entry.position === 333,
        allowReviewedCreatureSacrificeCostParts:
          profile.topLevel === 'stated-ordering-and-reviewed-birthing-pod-v1' ||
          profile.topLevel === 'stated-ordering-and-reviewed-recurring-nightmare-v1' ||
          LEGACY_CUBE_CHOSEN_CREATURE_SACRIFICE_COST_POSITIONS.some(
            (position) => position === entry.position,
          ),
        allowReviewedGeneratedObjectCostParts: LEGACY_CUBE_GENERATED_OBJECT_CHOSEN_COST_POSITIONS.some(
          (position) => position === entry.position,
        ),
        allowReviewedGildedGooseFoodSacrificeCostPart:
          profile.topLevel === 'stated-ordering-and-reviewed-gilded-goose-v1' && entry.position === 334,
        allowReviewedPiaSiegeGangSacrificeCostParts:
          profile.topLevel === 'stated-ordering-and-reviewed-pia-siege-gang-v1' &&
          LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_SAFE_POSITIONS.some((position) => position === entry.position),
        allowReviewedGeneratedTokenSacrificeCostParts:
          profile.topLevel === 'stated-ordering-and-reviewed-generated-token-sacrifice-v1' &&
          LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS.some(
            (position) => position === entry.position,
          ),
        allowReviewedOtherCreatureSacrificeCostPart: LEGACY_CUBE_OTHER_CREATURE_SACRIFICE_COST_POSITIONS.some(
          (position) => position === entry.position,
        ),
        allowReviewedTriggerTargetCostParts:
          profile.topLevel === 'stated-ordering-and-reviewed-trigger-target-v1' &&
          LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_CHOSEN_COST_POSITIONS.some(
            (position) => position === entry.position,
          ),
        allowReviewedSourceDiscardCostPart:
          profile.topLevel === 'stated-ordering-and-reviewed-miscalculation-v1' && entry.position === 133,
        allowReviewedSourceReturnCostPart:
          profile.topLevel === 'stated-ordering-and-reviewed-recurring-nightmare-v1' &&
          entry.position === 220,
        allowReviewedExertCostPart:
          profile.topLevel === 'stated-ordering-and-reviewed-glorybringer-v1' && entry.position === 273,
        allowReviewedDrawCostPart:
          (profile.topLevel === 'stated-ordering-and-reviewed-baral-triggered-loot-v1' &&
            entry.position === 85) ||
          (profile.topLevel === 'stated-ordering-and-reviewed-smugglers-copter-v1' && entry.position === 517),
        allowReviewedGraveyardExileCostPart:
          profile.topLevel === 'stated-ordering-and-reviewed-grim-lavamancer-v1' && entry.position === 246,
        allowReviewedFreeCounterspellCostParts:
          profile.topLevel === 'stated-ordering-and-reviewed-free-counterspell-v1',
        allowReviewedCryptbreakerCostParts:
          profile.topLevel === 'stated-ordering-and-reviewed-cryptbreaker-v1' && entry.position === 161,
        allowReviewedMyrBattlesphereCostParts:
          profile.topLevel === 'stated-ordering-and-reviewed-myr-battlesphere-v1' && entry.position === 501,
        allowReviewedTreasureCohortCostParts:
          profile.topLevel === 'stated-ordering-and-audited-treasure-cohort-v1' &&
          LEGACY_CUBE_REVIEWED_TREASURE_COHORT_SAFE_POSITIONS.some((position) => position === entry.position),
        allowReviewedChampionOfWitsCostParts:
          profile.topLevel === 'stated-ordering-and-reviewed-champion-of-wits-v1' && entry.position === 95,
        allowReviewedKalitasCostPart:
          profile.topLevel === 'stated-ordering-and-reviewed-kalitas-v1' && entry.position === 186,
        allowReviewedTitanEscapeCostPart: LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_POSITIONS.some(
          (position) => position === entry.position,
        ),
        allowReviewedFinalSixCostParts: profile.topLevel === 'stated-ordering-and-reviewed-final-six-v1',
      }),
    ];
    if (refusals.length > 0) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `${profile.manaPayment} profile drift for ${entry.correctedName}: ${refusals.join(', ')}`,
      );
    }
    const callbackRefusals = CALLBACK_PROFILE_REFUSALS[profile.topLevel]?.(bytes, inventory);
    if (callbackRefusals !== undefined && callbackRefusals.length > 0) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `${profile.topLevel} profile drift for ${entry.correctedName}: ${callbackRefusals.join(', ')}`,
      );
    }
    if (
      entry.bridgeCapabilityProfile?.topLevel === 'ordinary-combat-and-mandatory-singleton-nonstack-target-v1'
    ) {
      const targetRefusals = legacyCubeOrdinaryCombatSingleTargetRefusals(bytes);
      if (targetRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `ordinary-combat singleton-target profile drift for ${entry.correctedName}: ${targetRefusals.join(', ')}`,
        );
      }
    }
    if (
      entry.bridgeCapabilityProfile?.topLevel === 'ordinary-combat-and-mandatory-singleton-trigger-target-v1'
    ) {
      const targetRefusals = legacyCubeOrdinaryCombatTriggeredSingleTargetRefusals(bytes);
      if (targetRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `ordinary-combat trigger-target profile drift for ${entry.correctedName}: ${targetRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-trigger-target-v1') {
      const targetRefusals = legacyCubeMandatoryTriggeredSingleTargetRefusals(bytes);
      if (targetRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `trigger-target profile drift for ${entry.correctedName}: ${targetRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'paladin-class-installed-trigger-target-v1') {
      const targetRefusals = legacyCubePaladinClassProfileRefusals(bytes);
      if (targetRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Paladin Class profile drift for ${entry.correctedName}: ${targetRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'shockland-pay-two-life-entry-replacement-v1') {
      const optionalCostRefusals = legacyCubeShocklandProfileRefusals(bytes);
      if (optionalCostRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `shockland entry-replacement profile drift for ${entry.correctedName}: ${optionalCostRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-equip-target-v1') {
      const targetRefusals = legacyCubeEquipTargetProfileRefusals(bytes);
      if (targetRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Equip target profile drift for ${entry.correctedName}: ${targetRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-aura-target-v1') {
      const targetRefusals = legacyCubeAuraTargetProfileRefusals(bytes);
      if (targetRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Aura target profile drift for ${entry.correctedName}: ${targetRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-fetters-aura-target-v1') {
      const targetRefusals = legacyCubeFettersAuraTargetProfileRefusals(bytes);
      if (targetRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Faith's Fetters target profile drift for ${entry.correctedName}: ${targetRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-fall-aura-target-v1') {
      const targetRefusals = legacyCubeFallAuraTargetProfileRefusals(bytes);
      if (targetRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Fall from Favor target profile drift for ${entry.correctedName}: ${targetRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'ordinary-combat-baneslayer-protection-v1') {
      const profileRefusals = legacyCubeBaneslayerProtectionProfileRefusals(bytes);
      if (profileRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Baneslayer fixed-protection profile drift for ${entry.correctedName}: ${profileRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'draw-two-conditional-singleton-discard-v1') {
      const profileRefusals = legacyCubeChartACourseDiscardProfileRefusals(bytes);
      if (profileRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Chart a Course discard profile drift for ${entry.correctedName}: ${profileRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'ordinary-combat-reviewed-level-up-v2') {
      const profileRefusals = legacyCubeReviewedLevelUpProfileRefusals(bytes);
      if (profileRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `reviewed level-up profile drift for ${entry.correctedName}: ${profileRefusals.join(', ')}`,
        );
      }
    }
    if (
      entry.bridgeCapabilityProfile?.topLevel ===
      'ordinary-combat-selfless-spirit-self-sacrifice-indestructible-v1'
    ) {
      const profileRefusals = legacyCubeSelflessSpiritProfileRefusals(bytes);
      if (profileRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Selfless Spirit profile drift for ${entry.correctedName}: ${profileRefusals.join(', ')}`,
        );
      }
    }
    if (
      entry.bridgeCapabilityProfile?.topLevel ===
      'ordinary-combat-remorseful-cleric-self-sacrifice-target-graveyard-exile-v1'
    ) {
      const profileRefusals = legacyCubeRemorsefulClericProfileRefusals(bytes);
      if (profileRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Remorseful Cleric profile drift for ${entry.correctedName}: ${profileRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'coldsteel-heart-entry-color-chosen-mana-v1') {
      const profileRefusals = legacyCubeColdsteelHeartProfileRefusals(bytes);
      if (profileRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Coldsteel Heart profile drift for ${entry.correctedName}: ${profileRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'extinction-event-odd-even-exile-v1') {
      const profileRefusals = legacyCubeExtinctionEventProfileRefusals(bytes);
      if (profileRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `Extinction Event profile drift for ${entry.correctedName}: ${profileRefusals.join(', ')}`,
        );
      }
    }
    if (entry.bridgeCapabilityProfile?.topLevel === 'ordinary-combat-target-and-pinned-generated-token-v1') {
      const targetRefusals = legacyCubeOrdinaryCombatSingleTargetRefusals(bytes, {
        allowPinnedGeneratedTokenScripts: true,
      });
      if (targetRefusals.length > 0) {
        throw new InvalidInputError(
          'Legacy Cube decision ledger',
          `generated-token combat-target profile drift for ${entry.correctedName}: ${targetRefusals.join(', ')}`,
        );
      }
    }
  }
}

/** The backend allowlist is a projection of completed card-family evidence, not session safety. */
export function legacyCubeBridgeCardFamilySafeNames(ledger: LegacyCubeDecisionLedger): readonly string[] {
  return ledger.auditedCards
    .filter((card) => card.cardFamilySafe)
    .map((card) => card.correctedName)
    .sort((left, right) => left.localeCompare(right));
}

/** Loads the separately content-pinned, affirmative review of every corpus syntax token. */
export function loadLegacyCubeSyntaxReview(
  path: string = LEGACY_CUBE_SYNTAX_REVIEW_PATH,
): readonly LegacyCubeDecisionSyntaxToken[] {
  const bytes = readFileSync(path);
  const actual = sha256(bytes);
  if (path === LEGACY_CUBE_SYNTAX_REVIEW_PATH && actual !== LEGACY_CUBE_SYNTAX_REVIEW_SHA256) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `committed syntax review checksum drift: expected ${LEGACY_CUBE_SYNTAX_REVIEW_SHA256}, got ${actual}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (cause) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable JSON`,
    );
  }
  const parsed = SyntaxReviewSchema.safeParse(value);
  if (!parsed.success) throw new InvalidInputError('Legacy Cube decision ledger', parsed.error.message);
  assertUnique(
    parsed.data.entries.map((row) => `${row.kind}\0${row.token}`),
    'reviewed Forge syntax token',
  );
  for (const row of parsed.data.entries) {
    if (
      (row.disposition === 'mapped' && row.families.length === 0) ||
      (row.disposition === 'non-choice' && row.families.length > 0)
    ) {
      throw new InvalidInputError(
        'Legacy Cube decision ledger',
        `invalid affirmative syntax disposition for ${row.kind} ${row.token}`,
      );
    }
  }
  return parsed.data.entries;
}

export function officialLegacyCubeDecisionEntries(
  ledger: LegacyCubeDecisionLedger,
): readonly LegacyCubeDecisionEntry[] {
  return ledger.auditedCards.filter((entry) => entry.corpus === 'official-full-cardlist');
}

export function loadLegacyCubeDecisionLedger(
  path: string = LEGACY_CUBE_DECISION_LEDGER_PATH,
  provenancePath: string = LEGACY_CUBE_PROVENANCE_PATH,
): LegacyCubeDecisionLedger {
  const bytes = readFileSync(path);
  const actual = sha256(bytes);
  if (path === LEGACY_CUBE_DECISION_LEDGER_PATH && actual !== LEGACY_CUBE_DECISION_LEDGER_SHA256) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      `committed artifact checksum drift: expected ${LEGACY_CUBE_DECISION_LEDGER_SHA256}, got ${actual}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (cause) {
    throw new InvalidInputError(
      'Legacy Cube decision ledger',
      cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable JSON`,
    );
  }
  const parsed = LegacyCubeDecisionLedgerSchema.safeParse(value);
  if (!parsed.success) throw new InvalidInputError('Legacy Cube decision ledger', parsed.error.message);
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8')) as LegacyCubeProvenance;
  verifyLegacyCubeDecisionLedger(parsed.data, provenance);
  return parsed.data;
}
