/**
 * Every closed list a brief editor has to offer, in one document.
 *
 * `mtg-yddw.1`. A brief is mostly choices out of pinned vocabularies — a
 * mechanic names keywords, effect kinds, ability kinds and trigger conditions; a
 * required card names a pool, a card kind, a rarity and maybe a counter kind; a
 * stated spell role names a role the allocator can seat. A page that offers
 * those choices needs the lists, and there are exactly two ways it can have
 * them: carry its own copy, or ask.
 *
 * It asks, and the reason is not tidiness. `@mtg/setgen`'s `brief.ts` reaches
 * `@mtg/design-data`, whose `load.ts` calls `readFileSync` at module scope, so
 * the schema that decides what a legal brief is cannot be imported into a
 * browser bundle at all. A copy in the page would therefore be a *second*
 * answer to that question, kept in step by nobody, and the first time a keyword
 * is added it would be the page that is wrong. So the vocabulary is derived here
 * from the same constants the schemas are built out of, served as data, and the
 * page has no list of its own to go stale.
 *
 * Derived, never retyped: every field below is a spread of an exported tuple. A
 * literal here would be the copy this module exists to prevent.
 */
import {
  COLORS,
  COUNTER_KINDS,
  EFFECT_KINDS,
  KEYWORDS,
  MODEL_ABILITY_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  RARITIES,
  SET_CODE_PATTERN,
  SUBTYPE_PATTERN,
} from '@mtg/dsl';
import {
  COLOR_PIE_SUBJECTS,
  DEFAULT_SLICE_TARGET_SIZE,
  MAX_SLICE_TARGET_SIZE,
  MIN_SLICE_TARGET_SIZE,
  SLICE_RARITIES,
} from '@mtg/design-data';
import { GENERATOR_CARD_KINDS, MECHANICS_MAX, MECHANICS_MIN, REQUIRED_POOLS } from '../brief';
import { SPELL_ROLE_NAMES } from '../roles';

/** The bounds a size field draws its slider and its refusal from. */
export interface SizeBounds {
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

/** How many mechanics a brief must state, and may state. */
export interface MechanicBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * The lists, and the two patterns a field validates against locally.
 *
 * The patterns are sent as source strings rather than as `RegExp`, because this
 * document crosses a JSON boundary and a `RegExp` does not survive one. A page
 * that wants to gray out a Save button before it asks the server can build one;
 * a page that does not still gets the server's own refusal, which is the answer
 * of record either way.
 */
export interface DesignVocabulary {
  readonly keywords: readonly string[];
  readonly effectKinds: readonly string[];
  readonly abilityKinds: readonly string[];
  readonly triggerConditions: readonly string[];
  readonly colors: readonly string[];
  /** The pools a required card may ask for: the five colors and the colorless one. */
  readonly requiredPools: readonly string[];
  /** Every rarity a required card may state, which is wider than the tiers below. */
  readonly rarities: readonly string[];
  /** The tiers the skeleton actually allocates, and so the tiers a spell role may name. */
  readonly sliceRarities: readonly string[];
  readonly cardKinds: readonly string[];
  readonly counterKinds: readonly string[];
  readonly spellRoles: readonly string[];
  /** The subjects a color signature may declare absent: the color pie's own rows. */
  readonly colorPieSubjects: readonly string[];
  readonly targetSize: SizeBounds;
  readonly mechanics: MechanicBounds;
  readonly setCodePattern: string;
  readonly subtypePattern: string;
}

/** The document, built fresh each call so no caller can hold a mutable copy. */
export function designVocabulary(): DesignVocabulary {
  return {
    keywords: [...KEYWORDS],
    effectKinds: [...EFFECT_KINDS],
    abilityKinds: [...MODEL_ABILITY_KINDS],
    triggerConditions: [...MODEL_TRIGGER_CONDITIONS],
    colors: [...COLORS],
    requiredPools: [...REQUIRED_POOLS],
    rarities: [...RARITIES],
    sliceRarities: [...SLICE_RARITIES],
    cardKinds: [...GENERATOR_CARD_KINDS],
    counterKinds: [...COUNTER_KINDS],
    spellRoles: [...SPELL_ROLE_NAMES],
    colorPieSubjects: [...COLOR_PIE_SUBJECTS],
    targetSize: {
      min: MIN_SLICE_TARGET_SIZE,
      max: MAX_SLICE_TARGET_SIZE,
      default: DEFAULT_SLICE_TARGET_SIZE,
    },
    mechanics: { min: MECHANICS_MIN, max: MECHANICS_MAX },
    setCodePattern: SET_CODE_PATTERN.source,
    subtypePattern: SUBTYPE_PATTERN.source,
  };
}
