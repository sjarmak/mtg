import { describe, expect, it } from 'vitest';
import {
  ABILITY_KINDS,
  abilityLineReminder,
  assertNever,
  CARD_KINDS,
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  exampleCard,
  KEYWORD_ABILITY_KINDS,
  KEYWORDS,
  LEGAL_TARGETS,
  KEYWORD_PRINT_NAMES,
  MODEL_TRIGGER_CONDITIONS,
  oracleRows,
  STATIC_MODIFICATION_KINDS,
  STATIC_SCOPES,
  TARGET_KINDS,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  VIOLATION_CODES,
} from '@mtg/dsl';
import type {
  Ability,
  AbilityKindsCovered,
  Card,
  CardKindsCovered,
  Effect,
  AnyEffectKind,
  EffectKindsCovered,
  GrantableKeywordAbilitiesAreParameterless,
  KeywordAbility,
  KeywordAbilityKindsCovered,
  PricedEffectKindsAreEffectKinds,
  KeywordsCovered,
  StaticModification,
  StaticModificationsCovered,
  TargetKindsCovered,
} from '@mtg/dsl';

/**
 * These assignments are the compile-time guard: each alias resolves to
 * `true` only when the pinned vocabulary tuple and the schema-derived union
 * are mutually assignable. Adding an effect primitive to the schema without
 * adding it to ALL_EFFECT_KINDS (or vice versa) makes `npm run typecheck` fail
 * here, before any test runs. `pricedEffectKindsAreEffectKinds` is the one that
 * is one-directional: the priced half of the vocabulary must name only
 * primitives the schema carries, while the schema may carry primitives the
 * color pie has not ruled on.
 *
 * `grantableKeywordAbilitiesAreParameterless` is not a tuple-versus-union guard
 * at all — it holds a *shape* rule, that every keyword ability a `grantKeyword`
 * record may name is a bare `{ kind }` with no second field for that record to
 * lose. It is asserted here because this is where the aliases are spent.
 *
 * `abilityKindsCovered` is the one that matters while `mtg-bc2.132` is in
 * flight: `ABILITY_KINDS` grows one member per slice, and this assignment plus
 * the kernel's `assertNever` over `Ability['kind']` are what stop a kind being
 * added to the schema in one slice and to the engine in another.
 */
const effectKindsCovered: EffectKindsCovered = true;
const pricedEffectKindsAreEffectKinds: PricedEffectKindsAreEffectKinds = true;
const targetKindsCovered: TargetKindsCovered = true;
const cardKindsCovered: CardKindsCovered = true;
const keywordsCovered: KeywordsCovered = true;
const abilityKindsCovered: AbilityKindsCovered = true;
const staticModificationsCovered: StaticModificationsCovered = true;
const keywordAbilityKindsCovered: KeywordAbilityKindsCovered = true;
const grantableKeywordAbilitiesAreParameterless: GrantableKeywordAbilitiesAreParameterless = true;

/** Exhaustive maps: a missing arm is a compile error, not a runtime surprise. */
const EFFECT_IS_TARGETED: Record<AnyEffectKind, boolean> = {
  dealDamage: true,
  destroyPermanent: true,
  pumpUntilEndOfTurn: true,
  drawCards: true,
  gainLife: true,
  counterSpell: false,
  createToken: false,
  tapPermanent: true,
  returnToHand: true,
  millCards: true,
  putCounters: true,
  exileTarget: true,
  revealHand: true,
  scry: false,
  returnFromGraveyard: true,
  fight: true,
  addMana: false,
  shuffleLibrary: false,
  revealTopCards: false,
  putOnLibrary: true,
  exileGraveyard: false,
  shuffleGraveyardIntoLibrary: false,
  searchLibrary: false,
  discardCards: true,
  chooseDiscard: true,
  loseLife: true,
  setLife: false,
  preventCombatDamage: false,
  chooseFromGraveyard: false,
  preventAllDamageToTarget: true,
  untapPermanent: true,
  grantKeywordUntilEndOfTurn: true,
  cantBeBlockedThisTurn: true,
  attacksYouThisTurnIfAble: true,
  // False, and this map is about `LEGAL_TARGETS` rather than about the type:
  // `sacrificeSelf` does carry a target, but it is `selfCreature` — a retained
  // referent (CR 115.6a), hand-authored, and generatable from nothing — so the
  // generatable row this map reads is empty.
  sacrificeSelf: false,
  // True, and squarely so: CR 701.17a's edict targets a player outright
  // (`targetPlayer` generatable, `targetOpponent` hand-authored), the opposite
  // case from the retained-referent row just above.
  sacrificePermanent: true,
  // False, and it is `sacrificeSelf`'s reason rather than the edict's: the kind
  // targets a creature outright, but its whole target list is hand-authored
  // (`EFFECT_RULES.setBasePtUntilEndOfTurn` states `generatableTargets: []`),
  // and the generatable row is what this map reads.
  setBasePtUntilEndOfTurn: false,
};

function describeCard(card: Card): string {
  switch (card.kind) {
    case 'creature':
      return `creature ${card.power}/${card.toughness}`;
    case 'instant':
      return 'instant';
    case 'sorcery':
      return 'sorcery';
    case 'artifact':
      return 'artifact';
    case 'land':
      return `land ${card.basicLandType}`;
    case 'planeswalker':
      return `planeswalker ${String(card.startingLoyalty)}`;
    case 'enchantment':
      return 'enchantment';
    default:
      return assertNever(card, 'describeCard');
  }
}

describe('vocabulary exhaustiveness', () => {
  it('holds the compile-time coverage assertions', () => {
    expect([
      effectKindsCovered,
      pricedEffectKindsAreEffectKinds,
      targetKindsCovered,
      cardKindsCovered,
      keywordsCovered,
      abilityKindsCovered,
      staticModificationsCovered,
      keywordAbilityKindsCovered,
      grantableKeywordAbilitiesAreParameterless,
    ]).toEqual([true, true, true, true, true, true, true, true, true]);
  });

  it('has no duplicate vocabulary entries', () => {
    for (const tuple of [
      EFFECT_KINDS,
      TARGET_KINDS,
      CARD_KINDS,
      KEYWORDS,
      ABILITY_KINDS,
      STATIC_SCOPES,
      STATIC_MODIFICATION_KINDS,
      KEYWORD_ABILITY_KINDS,
      TRIGGER_CONDITIONS,
      VIOLATION_CODES,
    ]) {
      expect(new Set<string>(tuple).size).toBe(tuple.length);
    }
  });

  it('gives every effect kind a targeting rule and every keyword a printed name', () => {
    for (const kind of ALL_EFFECT_KINDS) {
      expect(LEGAL_TARGETS[kind], kind).toBeDefined();
      const targeted = EFFECT_IS_TARGETED[kind];
      expect(LEGAL_TARGETS[kind].length > 0, kind).toBe(targeted);
      for (const target of LEGAL_TARGETS[kind]) {
        expect(TARGET_KINDS).toContain(target);
      }
    }
    for (const keyword of KEYWORDS) {
      expect(KEYWORD_PRINT_NAMES[keyword], keyword).toBeTruthy();
    }
  });

  it('narrows card kinds exhaustively', () => {
    const seen = new Set(CARD_KINDS.map((kind) => kind));
    expect(seen.size).toBe(CARD_KINDS.length);
    const land: Card = {
      kind: 'land',
      id: 'x-forest',
      name: 'Forest',
      rarity: 'common',
      set: { code: 'XXX', collectorNumber: 1 },
      colors: [],
      supertypes: ['basic'],
      subtypes: [],
      keywords: [],
      effects: [],
      abilities: [],
      costReduction: null,
      basicLandType: 'Forest',
      producesMana: ['G'],
    };
    expect(describeCard(land)).toBe('land Forest');
  });

  it('assertNever throws when a variant escapes validation', () => {
    const rogue = { kind: 'battle' } as unknown as Card;
    expect(() => describeCard(rogue)).toThrow(/unhandled variant/);
  });

  it('every effect variant is constructible from the pinned vocabulary', () => {
    const samples: Effect[] = [
      { kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } },
      { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
      { kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } },
      { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } },
      { kind: 'counterSpell' },
      {
        kind: 'createToken',
        count: 1,
        token: { name: 'T', power: 1, toughness: 1, colors: [], subtypes: [], keywords: [] },
      },
      { kind: 'tapPermanent', target: { kind: 'targetCreature' } },
      { kind: 'returnToHand', target: { kind: 'targetCreature' } },
      { kind: 'millCards', count: 1, target: { kind: 'noTarget' } },
      { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
      { kind: 'exileTarget', target: { kind: 'targetCreature' } },
      { kind: 'revealHand', target: { kind: 'targetOpponent' } },
      { kind: 'scry', count: 1 },
      {
        kind: 'returnFromGraveyard',
        scope: 'creatureCardsInPlayerGraveyard',
        target: { kind: 'targetPlayer' },
      },
      { kind: 'fight', target: { kind: 'targetCreatureYouDontControl' } },
      { kind: 'addMana', produces: ['G'], amount: 1 },
      { kind: 'shuffleLibrary' },
      { kind: 'revealTopCards', count: 1 },
      { kind: 'putOnLibrary', position: 'top', target: { kind: 'targetCreature' } },
      { kind: 'exileGraveyard', whose: 'each' },
      { kind: 'shuffleGraveyardIntoLibrary', includeSelf: true },
      { kind: 'searchLibrary', filter: { supertypes: ['basic'] }, destination: 'battlefield' },
      { kind: 'discardCards', count: 1, target: { kind: 'targetPlayer' } },
      { kind: 'chooseDiscard', count: 1, target: { kind: 'targetOpponent' } },
      { kind: 'loseLife', amount: 2, target: { kind: 'targetOpponent' } },
      { kind: 'setLife', amount: 10 },
      { kind: 'preventCombatDamage' },
      {
        kind: 'chooseFromGraveyard',
        whose: 'you',
        filter: { cardTypes: ['creature'] },
        destination: 'hand',
      },
      { kind: 'preventAllDamageToTarget', target: { kind: 'targetCreature' } },
      { kind: 'untapPermanent', target: { kind: 'targetPermanent' } },
      { kind: 'grantKeywordUntilEndOfTurn', keyword: 'flying', target: { kind: 'targetCreature' } },
      { kind: 'cantBeBlockedThisTurn', target: { kind: 'targetCreature' } },
      { kind: 'attacksYouThisTurnIfAble', target: { kind: 'targetCreatureYouDontControl' } },
      { kind: 'sacrificeSelf', target: { kind: 'selfCreature' } },
      { kind: 'sacrificePermanent', target: { kind: 'targetOpponent' } },
      { kind: 'setBasePtUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } },
    ];
    expect(samples.map((e) => e.kind).sort()).toEqual([...ALL_EFFECT_KINDS].sort());
  });

  it('every ability variant is constructible from the pinned vocabulary', () => {
    const samples: Ability[] = [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Merfolk',
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'activated',
        cost: {
          mana: { generic: 1, W: 0, U: 0, B: 0, R: 1, G: 0, hasX: false },
          tapSelf: true,
          sacrificeSelf: false,
        },
        effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
      },
    ];
    expect(samples.map((ability) => ability.kind).sort()).toEqual([...ABILITY_KINDS].sort());
  });

  it('gives every trigger condition a printed template', () => {
    for (const condition of MODEL_TRIGGER_CONDITIONS) {
      expect(TRIGGER_PRINT_TEMPLATES[condition], condition).toContain('{name}');
    }
    expect(TRIGGER_PRINT_TEMPLATES.controlledCreatureAttacksAlone).toContain(
      'a creature you control attacks alone',
    );
  });

  it('every static modification is constructible from the pinned vocabulary', () => {
    const samples: StaticModification[] = [
      { kind: 'statBonus', power: 1, toughness: 1 },
      { kind: 'grantKeyword', keyword: 'vigilance' },
      { kind: 'definePt', countOf: 'graveyardCardTypesEach', powerOffset: 0, toughnessOffset: 1 },
      {
        kind: 'statBonusPer',
        power: 0,
        toughness: 1,
        each: { kind: 'landsWithSubtype', subtype: 'Mountain', whose: 'you' },
      },
      { kind: 'doubleDamage' },
      { kind: 'doubleLifeGain' },
      { kind: 'cantAttack' },
      { kind: 'cantBlock' },
      { kind: 'cantBeBlocked' },
      { kind: 'attacksEachCombatIfAble' },
      { kind: 'mustBeBlockedIfAble' },
      { kind: 'blockOnlyCreaturesWithKeyword', keyword: 'flying' },
      { kind: 'cantBeBlockedBySubtype', subtype: 'Wall' },
    ];
    expect(samples.map((modification) => modification.kind).sort()).toEqual(
      [...STATIC_MODIFICATION_KINDS].sort(),
    );
  });

  /**
   * mtg-josx: every `KeywordAbility` kind is constructible from the pinned
   * vocabulary (the same shape the effect and ability tests above already
   * check), *and* the row it prints carries a reminder. The second half is
   * the guard this bead exists to add — `keywordAbilityKindsCovered` above
   * only proves the tuple and the schema union agree on which kinds exist; a
   * sixth kind could be added to both and still print with no explanation the
   * way all five of these once did. One card per kind, built by overriding
   * `exampleCard`'s creature the same way `reminder.test.ts` already does for
   * flat keywords, so the row each assertion reads is the row the real
   * renderer would print rather than a hand-typed string that could drift
   * from it.
   */
  it('every keyword ability variant is constructible and prints with a reminder', () => {
    const base = exampleCard('slc-skywatch-sentinel');
    const samples: KeywordAbility[] = [
      { kind: 'defender' },
      { kind: 'landwalk', landType: 'Island' },
      { kind: 'hexproof' },
      { kind: 'indestructible' },
      { kind: 'protection', quality: { kind: 'color', color: 'W' } },
      { kind: 'doubleStrike' },
    ];
    expect(samples.map((ability) => ability.kind).sort()).toEqual([...KEYWORD_ABILITY_KINDS].sort());

    for (const ability of samples) {
      const card: Card = { ...base, keywords: [], keywordAbilities: [ability] };
      const rows = oracleRows(card);
      const printed = rows.find((row) => abilityLineReminder(row.text) !== null);
      expect(
        printed,
        `${ability.kind} printed no row with a reminder; rows were ${rows.map((r) => r.text).join(' | ')}`,
      ).toBeDefined();
    }
  });
});
