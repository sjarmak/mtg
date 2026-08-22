/**
 * Fixtures: the generated set, and the cards that are worse than anything in it.
 *
 * The generated set is the real workload and it is what the gate asserts on,
 * but its longest oracle text is 97 characters, which never makes the auto-fit
 * do anything. A renderer that only ever runs at its maximum size has not shown
 * that it fits *across the length range* — it has shown that the maximum size
 * happens to work today. So `stressCards` builds the worst faces the DSL can
 * legally express: every keyword at once, three eight-token clauses, six pips at
 * the mana-value ceiling, the biggest legal body, and a word wider than the
 * text box. Every one of them goes through `parseCard`, so none of them is a
 * card the generator could not emit.
 *
 * Six of the nine are rare, which is where the renderers get most of their
 * rares: nothing in the real workload carries a star seal, because the slice
 * prints two rarities (`SLICE_RARITIES` in `@mtg/design-data`).
 *
 * `oversizedCard` goes past that, on purpose, by parsing the schema alone. It
 * is the input the fit report exists for: something a caller should be told
 * about rather than something the renderer should pretend it handled.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CardSchema, COLORS, KEYWORDS, parseCard, parseCards } from '@mtg/dsl';
import type { Card, CardInput, EffectInput, Keyword, TokenSpec } from '@mtg/dsl';

const SET_FILE = join(import.meta.dirname, '../../../setgen/fixtures/sets/tideglass-reach.set.json');

/** The 90-card generated set the balance gate runs on. */
export function generatedSet(): readonly Card[] {
  const parsed: unknown = JSON.parse(readFileSync(SET_FILE, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('cards' in parsed)) {
    throw new Error(`${SET_FILE}: not a set file`);
  }
  const cards = (parsed as { cards: unknown }).cards;
  if (!Array.isArray(cards)) throw new Error(`${SET_FILE}: "cards" is not an array`);
  return parseCards(cards);
}

const ALL_KEYWORDS: readonly Keyword[] = KEYWORDS;

function tokenClause(name: string, subtypes: readonly string[]): EffectInput {
  const token: TokenSpec = {
    name,
    power: 3,
    toughness: 3,
    colors: ['W', 'U'],
    subtypes: [...subtypes],
    keywords: [...ALL_KEYWORDS],
  };
  return { kind: 'createToken', count: 8, token };
}

/** Exactly the schema's 80-character name ceiling. */
const LONGEST_LEGAL_NAME = 'Warden of the Drowned Shelf and Harrower of the Tideglass Reach at Low Water Xyz';

const STRESS: readonly CardInput[] = [
  // Rules box: three eight-token clauses, each carrying all nine keywords.
  {
    id: 'stress-max-oracle',
    name: 'Everything At Once',
    kind: 'sorcery',
    rarity: 'rare',
    set: { code: 'STR', collectorNumber: 1 },
    colors: ['W', 'U'],
    effects: [
      tokenClause('Tideglass Warden', ['Merfolk', 'Soldier', 'Warrior']),
      tokenClause('Obsidian Reefwalker', ['Elemental', 'Horror']),
      { kind: 'dealDamage', amount: 12, target: { kind: 'anyTarget' } },
    ],
    manaCost: { generic: 5, W: 2, U: 2 },
  },
  // Rules box, creature side: every evergreen keyword the vocabulary has.
  {
    id: 'stress-all-keywords',
    name: 'Reefclan Paragon',
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'STR', collectorNumber: 2 },
    colors: ['W'],
    subtypes: ['Merfolk', 'Knight'],
    keywords: [...ALL_KEYWORDS],
    manaCost: { generic: 4, W: 2 },
    power: 5,
    toughness: 5,
  },
  // Title bar: the longest name the schema allows, with three pips beside it.
  {
    id: 'stress-long-name',
    name: LONGEST_LEGAL_NAME,
    kind: 'sorcery',
    rarity: 'rare',
    set: { code: 'STR', collectorNumber: 3 },
    colors: ['B'],
    effects: [{ kind: 'millCards', count: 20, target: { kind: 'targetPlayer' } }],
    manaCost: { generic: 4, B: 2 },
  },
  // Title bar again: six pips at the mana-value ceiling squeeze the name.
  {
    id: 'stress-many-pips',
    name: 'Communion with the Drowned Shelf',
    kind: 'instant',
    rarity: 'rare',
    set: { code: 'STR', collectorNumber: 4 },
    colors: ['W', 'U', 'B', 'R', 'G'],
    effects: [{ kind: 'counterSpell' }],
    manaCost: { generic: 11, W: 1, U: 1, B: 1, R: 1, G: 1 },
  },
  // P/T badge and type line: the biggest legal body, five subtypes.
  {
    id: 'stress-big-stats',
    name: 'Colossus of the Deep Shelf',
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'STR', collectorNumber: 5 },
    colors: ['G'],
    subtypes: ['Elemental', 'Horror', 'Leviathan', 'Serpent', 'Whale'],
    keywords: ['trample', 'reach'],
    manaCost: { generic: 12, G: 3 },
    power: 20,
    toughness: 20,
  },
  // Line breaking: a token subtype with no space in it, wider than the box.
  {
    id: 'stress-unbreakable-word',
    name: 'Unbreakable',
    kind: 'sorcery',
    rarity: 'rare',
    set: { code: 'STR', collectorNumber: 6 },
    colors: ['R'],
    effects: [
      {
        kind: 'createToken',
        count: 1,
        token: {
          name: 'Long',
          power: 1,
          toughness: 1,
          colors: ['R'],
          subtypes: ['Mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm'],
          keywords: [],
        },
      },
    ],
    manaCost: { generic: 1, R: 1 },
  },
  // Artifact creature: a color identity and the plate hatch at the same time.
  {
    id: 'stress-artifact-creature',
    name: 'Tideglass Automaton',
    kind: 'creature',
    rarity: 'uncommon',
    set: { code: 'STR', collectorNumber: 7 },
    colors: ['U'],
    subtypes: ['Construct'],
    keywords: ['vigilance'],
    manaCost: { generic: 3, U: 1 },
    artifact: true,
    power: 4,
    toughness: 5,
  },
  // Colorless artifact: the identity with no color at all.
  {
    id: 'stress-colorless-artifact',
    name: 'Tideglass Lens',
    kind: 'artifact',
    rarity: 'uncommon',
    set: { code: 'STR', collectorNumber: 8 },
    subtypes: ['Equipment'],
    manaCost: { generic: 3 },
  },
  // Land: no cost, no P/T, color inferred from what it taps for.
  {
    id: 'stress-basic-land',
    name: 'Island',
    kind: 'land',
    rarity: 'common',
    set: { code: 'STR', collectorNumber: 9 },
    supertypes: ['basic'],
    basicLandType: 'Island',
    producesMana: ['U'],
  },
];

/** The worst faces the DSL can legally express. All pass `parseCard`. */
export function stressCards(): readonly Card[] {
  return STRESS.map((input) => parseCard(input));
}

/** `card.ts` caps `name` at 80 characters, and the ceiling card spends all of it. */
function maximalName(name: string): string {
  if (name.length !== 80) throw new Error(`ceiling name is ${name.length} characters, not 80`);
  return name;
}

/**
 * Static-ability cards, which are their own list because they are a new axis of
 * printed length rather than a longer version of an old one: an ability prints
 * its own line between the keyword line and the effect paragraph, so a card can
 * carry three paragraphs where DSL v0 could carry two.
 *
 * The first three are what a generated set would actually contain. The fourth
 * is the ceiling, and it is there because `mtg-bc2.132`'s design named the
 * rules box as the epic's first risk. `set-fit.test.ts` measures it rather than
 * assuming.
 *
 * ## What "the ceiling" means, precisely
 *
 * Three schema bounds set it: `abilities` caps at two (`card.ts`), `name` caps
 * at 80 characters, and `pumpDelta` caps a stat bonus at 8. A `self` scope
 * prints the card's whole name as its subject, so two self-scoped statics on a
 * maximal name are the widest text those bounds allow: 276 characters over
 * three lines, which sets at 19.5 units against the 13 where `lastResortLayout`
 * starts truncating (`regions.ts`).
 *
 * It is the ceiling of the *bounded* fields, not of every legal card.
 * `SUBTYPE_PATTERN` carries no length bound, so "Other <subtype> creatures you
 * control get +8/+8." has no schema ceiling at all. That is not an unmeasured
 * risk: an overlong subtype comes out as a fit failure from this same report,
 * on the type line before the rules box, because the subtype prints there too,
 * and `renderSetOrThrow` fails the build on it. `oversizedCard` below is that
 * path exercised.
 */
const ABILITY_CARDS: readonly CardInput[] = [
  {
    id: 'ability-tribal-lord',
    name: 'Merfolk Tidecaller',
    kind: 'creature',
    rarity: 'uncommon',
    set: { code: 'ABL', collectorNumber: 1 },
    colors: ['U'],
    subtypes: ['Merfolk', 'Wizard'],
    manaCost: { generic: 2, U: 1 },
    power: 2,
    toughness: 3,
    abilities: [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Merfolk',
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
    ],
  },
  {
    id: 'ability-two-statics',
    name: 'Vantian Marshal',
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'ABL', collectorNumber: 2 },
    colors: ['W'],
    subtypes: ['Human', 'Soldier'],
    keywords: ['flying', 'vigilance'],
    manaCost: { generic: 3, W: 1 },
    power: 3,
    toughness: 3,
    abilities: [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        modification: { kind: 'statBonus', power: 1, toughness: 0 },
      },
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Soldier',
        modification: { kind: 'grantKeyword', keyword: 'firstStrike' },
      },
    ],
  },
  // The anthem shape: a noncreature artifact that is no longer vanilla.
  {
    id: 'ability-artifact-anthem',
    name: 'Banner of the Goddess',
    kind: 'artifact',
    rarity: 'uncommon',
    set: { code: 'ABL', collectorNumber: 3 },
    manaCost: { generic: 3 },
    abilities: [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        modification: { kind: 'grantKeyword', keyword: 'vigilance' },
      },
    ],
  },
  {
    id: 'ability-max-oracle',
    name: maximalName('Salamander Standard-Bearer of the Everflame Reaches, Sworn to the Deathless Dawn'),
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'ABL', collectorNumber: 4 },
    colors: ['R'],
    subtypes: ['Salamander', 'Warrior'],
    keywords: [...ALL_KEYWORDS],
    manaCost: { generic: 5, R: 2 },
    power: 5,
    toughness: 5,
    abilities: [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'statBonus', power: 8, toughness: 8 },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'grantKeyword', keyword: 'firstStrike' },
      },
    ],
  },
];

/** Cards carrying static abilities. All pass `parseCard`. */
export function abilityCards(): readonly Card[] {
  return ABILITY_CARDS.map((input) => parseCard(input));
}

/**
 * The maximal token clause, which is where the printed length of a triggered
 * ability actually comes from: eight bodies, five colors and every keyword,
 * under a token name spending all 80 characters `TokenSpecSchema` allows.
 */
function maximalTokenEffect(tokenName: string): EffectInput {
  return {
    kind: 'createToken',
    count: 8,
    token: {
      name: tokenName,
      power: 12,
      toughness: 12,
      colors: [...COLORS],
      subtypes: ['Salamander'],
      keywords: [...KEYWORDS],
    },
  };
}

/**
 * Triggered-ability cards, and the second half of the fit answer slice A
 * started (`set-fit.test.ts` measures them).
 *
 * A trigger is longer prose than a static: it prints a condition clause before
 * it prints what it does, and it may print two effect sentences after it. The
 * first three cards below are what a set would actually contain. The fourth is
 * the widest card the *length-bounded* effects allow — `gainLife`, `millCards`
 * and `drawCards` are bounded by `LIMITS`, so two abilities of two of them
 * under an 80-character name is a real ceiling, the way two self-scoped statics
 * were for slice A.
 *
 * `createToken` is not in that list on purpose, and
 * `overlongTriggerCard` below is why.
 */
const TRIGGER_CARDS: readonly CardInput[] = [
  {
    id: 'trigger-etb-lifegain',
    name: 'Merfolk Tidecaller',
    kind: 'creature',
    rarity: 'uncommon',
    set: { code: 'TRG', collectorNumber: 1 },
    colors: ['U'],
    subtypes: ['Merfolk', 'Wizard'],
    keywords: ['flying'],
    manaCost: { generic: 2, U: 1 },
    power: 2,
    toughness: 3,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
    ],
  },
  // The mixed card: a static and a trigger on one permanent, which is what
  // pins the printed order (keywords, static, trigger).
  {
    id: 'trigger-and-static',
    name: 'Vantian Marshal',
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'TRG', collectorNumber: 2 },
    colors: ['W'],
    subtypes: ['Human', 'Soldier'],
    keywords: ['vigilance'],
    manaCost: { generic: 3, W: 1 },
    power: 3,
    toughness: 3,
    abilities: [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Soldier',
        modification: { kind: 'statBonus', power: 1, toughness: 0 },
      },
      {
        kind: 'triggered',
        condition: 'selfAttacks',
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ],
  },
  // The token maker, which is the shape a set actually prints and the shape
  // the ceiling card below stretches past breaking.
  {
    id: 'trigger-token-maker',
    name: 'Ember Warden',
    kind: 'creature',
    rarity: 'uncommon',
    set: { code: 'TRG', collectorNumber: 3 },
    colors: ['R'],
    subtypes: ['Human', 'Soldier'],
    manaCost: { generic: 2, R: 1 },
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: {
              name: 'Ember Spark',
              power: 1,
              toughness: 1,
              colors: ['R'],
              subtypes: ['Elemental'],
              keywords: ['haste'],
            },
          },
        ],
      },
    ],
  },
  {
    id: 'trigger-max-bounded',
    name: maximalName('Salamander Standard-Bearer of the Everflame Reaches, Sworn to the Deathless Dawn'),
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'TRG', collectorNumber: 4 },
    colors: ['R'],
    subtypes: ['Salamander', 'Warrior'],
    keywords: [...ALL_KEYWORDS],
    manaCost: { generic: 5, R: 2 },
    power: 5,
    toughness: 5,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [
          { kind: 'gainLife', amount: 20, target: { kind: 'noTarget' } },
          { kind: 'millCards', count: 20, target: { kind: 'noTarget' } },
        ],
      },
      {
        kind: 'triggered',
        condition: 'selfAttacks',
        effects: [
          { kind: 'drawCards', count: 6, target: { kind: 'noTarget' } },
          { kind: 'gainLife', amount: 19, target: { kind: 'noTarget' } },
        ],
      },
    ],
  },
];

/** Cards carrying triggered abilities. All pass `parseCard` and `validateCard`. */
export function triggerCards(): readonly Card[] {
  return TRIGGER_CARDS.map((input) => parseCard(input));
}

/**
 * Activated-ability cards, and the third face of the fit answer.
 *
 * An activation prints a cost clause before it prints what it does, the way a
 * trigger prints a condition clause — but the effects may target, so the
 * printed line is a trigger's shape with different words in front. The first
 * three are what the flagship set would actually contain, and `Bomb Bag` is
 * the one that spends a sacrifice, which is Fuse's cost (`mtg-bc2.132.11`).
 *
 * The last two are the ceilings, and there are two of them because a sacrifice
 * moved the ceiling. A mana-and-tap cost is 24 characters at its widest — five
 * pips, a generic amount at the mana-value ceiling, and the tap symbol — and it
 * is bounded by the vocabulary. A sacrifice cost prints the card's own name in
 * the middle of the cost line, so its width is the *name* limit, 80 characters,
 * and the widest cost clause the schema can print is 116. Two of those on one
 * card is 459 characters of rules text against `activated-max-bounded`'s 275,
 * and the frame still takes it; what it costs is type size, which is why the
 * fit gate's readability floor is asserted at a number rather than assumed.
 *
 * Printing "Sacrifice this artifact" instead, the way Magic has templated it
 * since 2021, would buy most of those 80 characters back. It is not what this
 * renderer does: `renderAbility` is handed a name and nothing else, and Forge's
 * `res/cardsfolder` spells the same cost `Sac<1/CARDNAME>`, so the name is what
 * keeps the printed card and the exported script saying one thing.
 *
 * `createToken` is out of both ceilings for the reason `overlongTriggerCard`
 * gives: its printed clause has no length bound at all, so a card built from it
 * measures the token name rather than the ability.
 */
const ACTIVATED_CARDS: readonly CardInput[] = [
  {
    id: 'activated-ping',
    name: 'Ashen Beacon',
    kind: 'artifact',
    rarity: 'uncommon',
    set: { code: 'ACT', collectorNumber: 1 },
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 1, R: 1 }, tapSelf: true },
        effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
      },
    ],
  },
  {
    id: 'activated-pump',
    name: 'Emberkin Ironsmith',
    kind: 'creature',
    rarity: 'common',
    set: { code: 'ACT', collectorNumber: 2 },
    colors: ['R'],
    subtypes: ['Emberkin', 'Artisan'],
    keywords: ['trample'],
    manaCost: { generic: 2, R: 1 },
    power: 2,
    toughness: 3,
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { R: 1 }, tapSelf: false },
        effects: [{ kind: 'pumpUntilEndOfTurn', power: 1, toughness: 0, target: { kind: 'targetCreature' } }],
      },
    ],
  },
  {
    id: 'activated-and-static',
    name: 'Merfolk Tidewarden',
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'ACT', collectorNumber: 3 },
    colors: ['U'],
    subtypes: ['Merfolk', 'Soldier'],
    keywords: ['vigilance'],
    manaCost: { generic: 3, U: 1 },
    power: 3,
    toughness: 4,
    abilities: [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Merfolk',
        modification: { kind: 'statBonus', power: 1, toughness: 0 },
      },
      {
        kind: 'activated',
        cost: { mana: { generic: 2, U: 1 }, tapSelf: true },
        effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
      },
    ],
  },
  {
    id: 'activated-sacrifice',
    name: 'Bomb Bag',
    kind: 'artifact',
    rarity: 'common',
    set: { code: 'ACT', collectorNumber: 5 },
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 1 }, sacrificeSelf: true },
        effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
      },
    ],
  },
  {
    id: 'activated-max-bounded',
    name: maximalName('Salamander Standard-Bearer of the Everflame Reaches, Sworn to the Deathless Dawn'),
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'ACT', collectorNumber: 4 },
    colors: [...COLORS],
    subtypes: ['Salamander', 'Warrior'],
    keywords: [...ALL_KEYWORDS],
    manaCost: { generic: 5, W: 1, U: 1, B: 1, R: 1, G: 1 },
    power: 5,
    toughness: 5,
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 11, W: 1, U: 1, B: 1, R: 1, G: 1 }, tapSelf: true },
        effects: [
          { kind: 'gainLife', amount: 20, target: { kind: 'targetPlayer' } },
          { kind: 'millCards', count: 20, target: { kind: 'targetPlayer', distinct: true } },
        ],
      },
      {
        kind: 'activated',
        cost: { mana: { generic: 11, W: 1, U: 1, B: 1, R: 1, G: 1 }, tapSelf: false },
        effects: [
          { kind: 'drawCards', count: 6, target: { kind: 'targetPlayer' } },
          { kind: 'pumpUntilEndOfTurn', power: -8, toughness: -8, target: { kind: 'targetCreature' } },
        ],
      },
    ],
  },
  {
    id: 'activated-max-sacrifice',
    name: maximalName('Salamander Standard-Bearer of the Everflame Reaches, Sworn to the Deathless Dawn'),
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'ACT', collectorNumber: 6 },
    colors: [...COLORS],
    subtypes: ['Salamander', 'Warrior'],
    keywords: [...ALL_KEYWORDS],
    manaCost: { generic: 5, W: 1, U: 1, B: 1, R: 1, G: 1 },
    power: 5,
    toughness: 5,
    abilities: [
      {
        kind: 'activated',
        cost: {
          mana: { generic: 11, W: 1, U: 1, B: 1, R: 1, G: 1 },
          tapSelf: true,
          sacrificeSelf: true,
        },
        effects: [
          { kind: 'gainLife', amount: 20, target: { kind: 'targetPlayer' } },
          { kind: 'millCards', count: 20, target: { kind: 'targetPlayer', distinct: true } },
        ],
      },
      {
        kind: 'activated',
        cost: {
          mana: { generic: 11, W: 1, U: 1, B: 1, R: 1, G: 1 },
          tapSelf: false,
          sacrificeSelf: true,
        },
        effects: [
          { kind: 'drawCards', count: 6, target: { kind: 'targetPlayer' } },
          { kind: 'pumpUntilEndOfTurn', power: -8, toughness: -8, target: { kind: 'targetCreature' } },
        ],
      },
    ],
  },
];

/** Cards carrying activated abilities. All pass `parseCard` and `validateCard`. */
export function activatedCards(): readonly Card[] {
  return ACTIVATED_CARDS.map((input) => parseCard(input));
}

/**
 * Weapons: the one ability that prints two lines out of one record.
 *
 * CR 702.6b's equip carries its meaning in `attach` rather than in `effects`,
 * and `renderAbility` prints it the way Magic does — the static clause the
 * equipped creature gets, a newline, then `Equip {2}`. Both renderers split
 * oracle text on newlines already, so nothing in either had to change for a
 * weapon; what did not exist was a weapon in the corpus, and a card shape no
 * face has drawn is a card shape nothing has checked.
 *
 * The ceiling is short and stays short by construction, and three separate
 * validator rules keep it there. `checkEquipAbility` refuses every cost but
 * mana, so the equip line is bounded by the mana vocabulary rather than by the
 * 80-character name a sacrifice cost prints; a noncreature artifact must have a
 * colorless cost, so a weapon cannot even reach the five-pip width an
 * activation can; and a stat modification is capped at eight in each direction.
 * `equipment-max-cost` is the widest of them, and its width is spent on the
 * name rather than on the rules box.
 */
const EQUIPMENT_CARDS: readonly CardInput[] = [
  {
    id: 'equipment-moonblade',
    name: 'Moonblade',
    kind: 'artifact',
    rarity: 'rare',
    set: { code: 'EQP', collectorNumber: 1 },
    subtypes: ['Equipment'],
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 2 } },
        attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
        effects: [],
      },
    ],
  },
  {
    id: 'equipment-keyword',
    name: 'Scimitar of the Dunes',
    kind: 'artifact',
    rarity: 'rare',
    set: { code: 'EQP', collectorNumber: 2 },
    subtypes: ['Equipment'],
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 1 } },
        attach: { modifications: [{ kind: 'grantKeyword', keyword: 'firstStrike' }] },
        effects: [],
      },
    ],
  },
  {
    id: 'equipment-max-cost',
    name: maximalName('Bladed Bulwark of the Drowned Courts and the Everflame Reaches at Highest Waters'),
    kind: 'artifact',
    rarity: 'rare',
    set: { code: 'EQP', collectorNumber: 3 },
    subtypes: ['Equipment'],
    manaCost: { generic: 11 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 11 } },
        attach: { modifications: [{ kind: 'statBonus', power: 8, toughness: 8 }] },
        effects: [],
      },
    ],
  },
];

/** Equipment, whose ability prints as two lines. All pass `validateCard`. */
export function equipmentCards(): readonly Card[] {
  return EQUIPMENT_CARDS.map((input) => parseCard(input));
}

/**
 * The planeswalkers, whose text box is a table rather than a paragraph.
 *
 * The flagship's first planeswalker was the card that made this shape matter,
 * and neither renderer had ever drawn any of it: a row per loyalty ability
 * ruled off from the next, the cost each row charges in a badge at the left
 * margin, and the starting loyalty in a shield hanging off the corner of the
 * frame. `checkActivatedAbility` requires every ability on a planeswalker to
 * state a signed `loyaltyCost` and pay no mana, tap or sacrifice cost
 * (CR 606.2), so both signs are here: `+1` prints with a leading plus and `-2`
 * prints with the minus sign Magic uses rather than a hyphen
 * (`renderActivatedAbility`, `@mtg/dsl`).
 *
 * Three cards rather than one, because the face has three shapes and the two
 * that were reported broken are the second and the third. The first is the
 * plain two-ability walker. The second carries flavor text, which is the only
 * row a walker can print with no badge at all, since every loyalty ability
 * states a cost. The third is the wordiest: three rows whose last is an
 * ultimate that wraps to four lines, which is the card the rules box has to be
 * tall enough for and the one whose last row was printed behind the shield.
 */
const PLANESWALKER_CARDS: readonly CardInput[] = [
  {
    id: 'planeswalker-loyalty-badge',
    name: 'Warden of the Tideglass Vigil',
    kind: 'planeswalker',
    rarity: 'mythic',
    set: { code: 'PWK', collectorNumber: 1 },
    colors: ['G', 'W'],
    subtypes: ['Warden'],
    manaCost: { generic: 2, G: 1, W: 1 },
    startingLoyalty: 5,
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {} },
        loyaltyCost: 1,
        effects: [
          {
            kind: 'putCounters',
            counter: 'plusOnePlusOne',
            count: 1,
            target: { kind: 'targetCreatureYouControl' },
          },
        ],
      },
      {
        kind: 'activated',
        cost: { mana: {} },
        loyaltyCost: -2,
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
    ],
  },
  // The row a walker prints with no badge on it. Every loyalty ability states a
  // cost, so an uncosted row cannot come from an ability at all: on a walker it
  // is the flavor text, or the second line of an ability that prints two. The
  // abilities here are short on purpose, because flavor is only composed into
  // the box when the rules text left room for it (`textBoxBlocks`), and a card
  // whose flavor was dropped for space would test nothing.
  {
    id: 'planeswalker-uncosted-row',
    name: 'Warden of the Quiet Gate',
    kind: 'planeswalker',
    rarity: 'mythic',
    set: { code: 'PWK', collectorNumber: 2 },
    colors: ['G', 'W'],
    subtypes: ['Warden'],
    manaCost: { generic: 2, G: 1, W: 1 },
    startingLoyalty: 4,
    flavorText: 'The gate remembers every name.',
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {} },
        loyaltyCost: 1,
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'targetPlayer' } }],
      },
      {
        kind: 'activated',
        cost: { mana: {} },
        loyaltyCost: -3,
        effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
      },
    ],
  },
  // Three rows, the last of them an ultimate that prints two sentences and so
  // wraps to several lines. This is the face the box has to be tall enough for:
  // the printed walker's rules box is the height it is because this card's last
  // row has to close above the loyalty shield rather than behind it, and the
  // shield sits where it sits because a real one straddles the frame band.
  {
    id: 'planeswalker-ultimate',
    name: 'Warden of the Turning Hour',
    kind: 'planeswalker',
    rarity: 'mythic',
    set: { code: 'PWK', collectorNumber: 3 },
    colors: ['G', 'W'],
    subtypes: ['Warden'],
    manaCost: { generic: 2, G: 1, W: 1 },
    startingLoyalty: 5,
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {} },
        loyaltyCost: 1,
        effects: [
          {
            kind: 'putCounters',
            counter: 'plusOnePlusOne',
            count: 2,
            target: { kind: 'targetCreatureYouControl' },
          },
        ],
      },
      {
        kind: 'activated',
        cost: { mana: {} },
        loyaltyCost: -1,
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: {
              name: "Warden's Arsenal",
              power: 1,
              toughness: 1,
              colors: [],
              subtypes: ['Equipment'],
              keywords: [],
            },
          },
        ],
      },
      {
        kind: 'activated',
        cost: { mana: {} },
        loyaltyCost: -8,
        effects: [
          {
            kind: 'returnFromGraveyard',
            scope: 'creatureCardsInPlayerGraveyard',
            target: { kind: 'targetPlayer' },
          },
          {
            kind: 'pumpUntilEndOfTurn',
            power: 2,
            toughness: 2,
            target: { kind: 'targetPlayer' },
            scope: 'creaturesThatPlayerControls',
          },
        ],
      },
    ],
  },
];

/** A planeswalker, whose corner badge prints loyalty rather than power/toughness. */
export function planeswalkerCards(): readonly Card[] {
  return PLANESWALKER_CARDS.map((input) => parseCard(input));
}

/**
 * The card the fit gate says no to, and the reason the ceiling above is drawn
 * around the length-bounded effects.
 *
 * `createToken`'s printed clause has no length bound: the token's name spends
 * 80 characters, its subtype list is unbounded, and every color and keyword
 * prints in full. Four of them across two triggers is 997 characters, and the
 * rules box cannot take it — it overflows at the 13-unit floor where
 * `lastResortLayout` truncates.
 *
 * This is a real card by every other measure: `validateCard` returns nothing,
 * because each clause is distinct and every number is inside `LIMITS`. It is
 * not a hole triggered abilities opened, though. A sorcery carrying six
 * distinct maximal token clauses is 1,055 characters and overflows the same
 * way, and `card.effects` has no `.max()` to stop it, so a validator-legal card
 * whose text does not fit predates this slice. What the gate guarantees either
 * way is that it is *reported* — `renderSetOrThrow` fails the build rather than
 * printing a truncated face.
 */
export function overlongTriggerCard(): Card {
  return parseCard({
    id: 'trigger-overlong',
    name: maximalName('Salamander Standard-Bearer of the Everflame Reaches, Sworn to the Deathless Dawn'),
    kind: 'creature',
    rarity: 'rare',
    set: { code: 'TRG', collectorNumber: 9 },
    colors: [...COLORS],
    subtypes: ['Salamander'],
    keywords: [...ALL_KEYWORDS],
    manaCost: { generic: 5, W: 1, U: 1, B: 1, R: 1, G: 1 },
    power: 5,
    toughness: 5,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [
          maximalTokenEffect('Everflame Vanguard of the Deathless Dawn'),
          maximalTokenEffect('Ashen Warden of the Emberfall Marches'),
        ],
      },
      {
        kind: 'triggered',
        condition: 'selfAttacks',
        effects: [
          maximalTokenEffect('Glimmering Envoy of the Drowned Court'),
          maximalTokenEffect('Tidecaller Herald of the Sunken Reaches'),
        ],
      },
    ],
  });
}

/**
 * A card past what the DSL will accept: schema-shaped but semantically illegal,
 * with a body and a rules text no validator would let through. Parsed with the
 * schema alone so the renderer's failure path can be exercised on something a
 * real caller could plausibly hand it — an unvalidated generator draft.
 */
export function oversizedCard(): Card {
  return CardSchema.parse({
    id: 'oversized-draft',
    name: 'Draft Card With A Name Nobody Would Print',
    kind: 'sorcery',
    rarity: 'rare',
    set: { code: 'STR', collectorNumber: 99 },
    colors: ['W', 'U'],
    effects: Array.from({ length: 8 }, () =>
      tokenClause('Overlong Draft Token', ['Merfolk', 'Soldier', 'Warrior', 'Scout']),
    ),
    manaCost: { generic: 9, W: 3, U: 3 },
  } satisfies CardInput);
}

/**
 * An Aura carrying flat keywords and a `KeywordAbility` — schema-shaped and
 * semantically illegal, the same escape hatch `oversizedCard` above uses and
 * for the same reason: `validate/typeline.ts` refuses both `keywords` and
 * `keywordAbilities` on anything but a creature ("the kernel only evaluates
 * evergreen keywords on permanents that can attack or block"), so `parseCard`
 * would throw `CardValidationError` on this input. Parsed with the schema
 * alone so the renderer's failure path can be exercised on something a real
 * caller could plausibly hand it, same as the sorcery above.
 *
 * Built for mtg-67vm: `abilityRows` (`@mtg/dsl`'s `oracle.ts`) prints an
 * `Enchant creature` row ahead of an Aura's own rows, including its keyword
 * row, so a keyworded Aura's keyword row sits at `rows[1]` rather than
 * `rows[0]`. Every other keyworded fixture in this file has nothing printed
 * ahead of its keywords, so nothing here exercised `remindedBlocks` finding
 * the keyword row anywhere but the position it happened to sit at until now.
 */
export function auraWithKeywordsCard(): Card {
  return CardSchema.parse({
    id: 'aura-with-keywords',
    name: 'Binding Cast On The Wrong Kind Of Thing',
    kind: 'enchantment',
    rarity: 'rare',
    set: { code: 'STR', collectorNumber: 100 },
    colors: ['W'],
    manaCost: { generic: 1, W: 1 },
    aura: {
      enchant: 'creature',
      modifications: [{ kind: 'statBonus', power: 1, toughness: 1 }],
    },
    keywords: ['flying', 'vigilance'],
    keywordAbilities: [{ kind: 'defender' }],
  } satisfies CardInput);
}
