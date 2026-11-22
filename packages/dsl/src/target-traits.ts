/**
 * Structural facts shared by every reader of a target kind.
 *
 * Oracle wording, live kernel enumeration, and Forge syntax do not belong
 * here: those are package-owned semantic adapters. This module owns only the
 * properties that every consumer must agree on and mechanically projects the
 * repeated classification lists from one total declaration.
 */
import { TARGET_KINDS } from './vocabulary';

type DeclaredTargetKind = (typeof TARGET_KINDS)[number];

export type TargetCollisionSpace =
  'creature' | 'player' | 'artifactOrEnchantment' | 'planeswalker' | 'otherPermanent' | 'graveyardCard';

/** How the ability containing a target kind supplies its context. */
export type TargetKindContext =
  'ordinary' | 'triggerEvent' | 'sourceAttack' | 'sourceBody' | 'sourceAttachment' | 'priorTarget';

interface TargetKindTraitsBase {
  /** Spaces this kind can collide with for a `distinct` choice. */
  readonly spaces: readonly TargetCollisionSpace[];
  readonly cardTypeFilterable: boolean;
}

/** Structural facts every package may safely agree on about a target kind. */
export type TargetKindTraits = TargetKindTraitsBase &
  (
    | {
        readonly context: 'priorTarget';
        readonly referentSource: 'creature' | 'player' | 'playerOrPlaneswalker';
      }
    | {
        readonly context: Exclude<TargetKindContext, 'priorTarget'>;
        readonly referentSource: null;
      }
  );

/**
 * The one total structural declaration for the target family.
 *
 * `spaces` is a collision alphabet rather than a type hierarchy. In
 * particular, `targetArtifactOrEnchantment` includes both
 * `artifactOrEnchantment` and `creature`: an artifact creature can collide
 * with either slot. This safely overstates ordinary-creature overlap rather
 * than letting a `distinct` choice repeat a legal artifact creature.
 */
export const TARGET_KIND_TRAITS: Readonly<Record<DeclaredTargetKind, TargetKindTraits>> = {
  anyTarget: {
    spaces: ['creature', 'player'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetCreature: {
    spaces: ['creature'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetPlayer: {
    spaces: ['player'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  noTarget: { spaces: [], context: 'ordinary', referentSource: null, cardTypeFilterable: false },
  targetCreatureYouControl: {
    spaces: ['creature'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetOpponent: {
    spaces: ['player'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  triggeringCreature: {
    spaces: [],
    context: 'triggerEvent',
    referentSource: null,
    cardTypeFilterable: false,
  },
  triggeringPlayer: {
    spaces: [],
    context: 'triggerEvent',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetCreatureDefendingPlayerControls: {
    spaces: ['creature'],
    context: 'sourceAttack',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetArtifactOrEnchantment: {
    spaces: ['artifactOrEnchantment', 'creature'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetArtifactYouDontControl: {
    spaces: ['artifactOrEnchantment', 'creature'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetCreatureYouDontControl: {
    spaces: ['creature'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetPermanent: {
    spaces: ['creature', 'artifactOrEnchantment', 'planeswalker', 'otherPermanent'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: true,
  },
  targetPlayerOrPlaneswalker: {
    spaces: ['player', 'planeswalker'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  selfCreature: {
    spaces: [],
    context: 'sourceBody',
    referentSource: null,
    cardTypeFilterable: false,
  },
  selfPermanent: {
    spaces: [],
    context: 'sourceBody',
    referentSource: null,
    cardTypeFilterable: false,
  },
  thatCreature: {
    spaces: [],
    context: 'priorTarget',
    referentSource: 'creature',
    cardTypeFilterable: false,
  },
  thatPlayer: {
    spaces: [],
    context: 'priorTarget',
    referentSource: 'player',
    cardTypeFilterable: false,
  },
  thatCreaturesController: {
    spaces: [],
    context: 'priorTarget',
    referentSource: 'creature',
    cardTypeFilterable: false,
  },
  enchantedCreature: {
    spaces: [],
    context: 'sourceAttachment',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetCreatureOpponentControls: {
    spaces: ['creature'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  equippedCreature: {
    spaces: [],
    context: 'sourceAttachment',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetCardInYourGraveyard: {
    spaces: ['graveyardCard'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: true,
  },
  targetCardInAGraveyard: {
    spaces: ['graveyardCard'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: true,
  },
  thatPlayerOrPlaneswalkerController: {
    spaces: [],
    context: 'priorTarget',
    referentSource: 'playerOrPlaneswalker',
    cardTypeFilterable: false,
  },
  chosenPlayer: {
    spaces: [],
    context: 'triggerEvent',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetCardInOpponentsGraveyard: {
    spaces: ['graveyardCard'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: true,
  },
  targetNonlandPermanentOpponentControls: {
    spaces: ['creature', 'artifactOrEnchantment', 'planeswalker', 'otherPermanent'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetNonlandPermanentYouDontControl: {
    spaces: ['creature', 'artifactOrEnchantment', 'planeswalker', 'otherPermanent'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
  targetPermanentYouNeitherOwnNorControl: {
    spaces: ['creature', 'artifactOrEnchantment', 'planeswalker', 'otherPermanent'],
    context: 'ordinary',
    referentSource: null,
    cardTypeFilterable: false,
  },
};

function targetKindsInContext(context: TargetKindContext): readonly DeclaredTargetKind[] {
  return TARGET_KINDS.filter((kind) => TARGET_KIND_TRAITS[kind].context === context);
}

/** Kinds whose phrase has a referent only inside their source's attack. */
export const SOURCE_ATTACK_TARGETS = targetKindsInContext('sourceAttack');

/** @deprecated Use `SOURCE_ATTACK_TARGETS`; retained so the public vocabulary does not narrow. */
export const ATTACK_TRIGGER_ONLY_TARGETS = SOURCE_ATTACK_TARGETS;

/** Kinds that name the permanent carrying the ability rather than a choice. */
export const SOURCE_BODY_ONLY_TARGETS = targetKindsInContext('sourceBody');

/** Kinds that name the permanent attached to the ability's source. */
export const SOURCE_ATTACHMENT_TARGETS = targetKindsInContext('sourceAttachment');

/** Kinds that name what an earlier slot in the same effect list chose. */
export const REFERENT_TARGETS = targetKindsInContext('priorTarget');

/** Kinds whose referent comes from the event that fired a triggered ability. */
export const TRIGGER_EVENT_TARGETS = targetKindsInContext('triggerEvent');

/** Kinds whose open permanent space may be narrowed by card type. */
export const CARD_TYPE_FILTERABLE_TARGETS: readonly DeclaredTargetKind[] = TARGET_KINDS.filter(
  (kind) => TARGET_KIND_TRAITS[kind].cardTypeFilterable,
);
