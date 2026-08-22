/**
 * Design templates, blank cards and rate, argued on cards this file builds.
 *
 * `mtg-bfj6`. A tier that prints few cards may not print one of them twice, and
 * `mechanicalFingerprint` cannot say so: it hashes the whole normalized card,
 * every number included, so four weapons whose only printed line is a stat bonus
 * are four distinct hashes and `DUPLICATE_MECHANICS` was never going to fire on
 * any pair of them. `designTemplate` asks the same question at the grain a player
 * reads a card at, and `checkDesignRepeats` fails a bomb tier that repeats one.
 *
 * Every card and every slot here is synthetic. The set that produced the bug is
 * private, and the evidence that this check fires on its own allocation lives in
 * the sibling that reads that brief; what is generic is the template grain, the
 * bomb line the check reads off the profile, and the pie's ruling on a keyword
 * handed out by an equip clause, and all three are here.
 *
 * The tiers under the bomb line arrived later and are here too. They get a
 * budget rather than a ban, because a set is supposed to repeat a template at
 * common; what they may not do is repeat one past a full cycle, print a card
 * with nothing on it, or print one that gives away more per mana than the tier
 * above it. The numbers those three gates use are argued where they are defined.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Keyword } from '@mtg/dsl';
import { EQUIPMENT_SUBTYPE, parseCard } from '@mtg/dsl';
import type { SliceRarityRules } from '@mtg/design-data';
import { SKELETON_LITE } from '@mtg/design-data';
import { DEFAULT_SCORE_WEIGHTS } from '@mtg/deckbuild';
import type { Entry, Slot } from '@mtg/setgen';
import {
  RATE_CEILING_BOMB,
  TEMPLATE_CYCLE_BUDGET,
  cardRate,
  failingSlotIds,
  checkBlankCards,
  checkCardPie,
  checkCardRate,
  checkDesignRepeats,
  designTemplate,
  rulingsFor,
} from '@mtg/setgen';

const SHIPPED: SliceRarityRules = SKELETON_LITE.rarityRules;
const AT_UNCOMMON: SliceRarityRules = { bombsMinRarity: 'uncommon', maxComplexityRarity: 'rare' };

/** A slot built here rather than filtered out of a set's allocation. */
function slot(id: string, rarity: Slot['rarity'], role: string): Slot {
  return {
    id,
    index: 0,
    collectorNumber: 0,
    rarity,
    color: null,
    cardKind: 'artifact',
    role,
    manaValueMin: 2,
    manaValueMax: 4,
    keywords: [],
    effectKinds: [],
    abilityKinds: ['activated'],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
  };
}

type Modification =
  | { readonly kind: 'statBonus'; readonly power: number; readonly toughness: number }
  | { readonly kind: 'grantKeyword'; readonly keyword: Keyword };

function statBonus(power: number, toughness: number): Modification {
  return { kind: 'statBonus', power, toughness };
}

function grant(keyword: Keyword): Modification {
  return { kind: 'grantKeyword', keyword };
}

interface WeaponSpec {
  readonly name: string;
  readonly generic: number;
  readonly equip: number;
  readonly modification: Modification;
}

function weapon(spec: WeaponSpec): Card {
  return parseCard({
    id: `fix-${spec.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name: spec.name,
    rarity: 'rare',
    set: { code: 'FIX', collectorNumber: 1 },
    colors: [],
    kind: 'artifact',
    subtypes: [EQUIPMENT_SUBTYPE],
    manaCost: { generic: spec.generic },
    effects: [],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: spec.equip }, tapSelf: false, sacrificeSelf: false },
        effects: [],
        attach: { modifications: [spec.modification] },
      },
    ],
  });
}

/** Four weapons that differ in every number and in nothing a player reads. */
const STAT_STICKS: readonly Card[] = [
  weapon({ name: 'Fixture Blade One', generic: 2, equip: 3, modification: statBonus(7, -2) }),
  weapon({ name: 'Fixture Blade Two', generic: 2, equip: 1, modification: statBonus(6, -3) }),
  weapon({ name: 'Fixture Blade Three', generic: 3, equip: 1, modification: statBonus(4, 1) }),
  weapon({ name: 'Fixture Blade Four', generic: 4, equip: 2, modification: statBonus(4, 4) }),
];

function entriesFor(cards: readonly Card[], rarity: Slot['rarity'] = 'rare'): Entry[] {
  return cards.map((card, index) => ({
    slot: slot(`XA0${String(index + 1)}`, rarity, 'gearArtifact'),
    card,
  }));
}

describe('the template a card is built on', () => {
  it('reads four different stat lines as one template', () => {
    expect(new Set(STAT_STICKS.map(designTemplate)).size).toBe(1);
  });

  /**
   * The point of the grain, and the reason this is not a second fingerprint.
   * Every number above is inside `mechanicalFingerprint`'s hash, so those four
   * cards hash four ways; with the numbers struck out they are one card.
   */
  it('separates a weapon that grants a keyword from one that does not', () => {
    const stats = designTemplate(STAT_STICKS[0] as Card);
    const flier = designTemplate(
      weapon({ name: 'Fixture Blade Five', generic: 3, equip: 2, modification: grant('flying') }),
    );
    const trampler = designTemplate(
      weapon({ name: 'Fixture Blade Six', generic: 3, equip: 2, modification: grant('trample') }),
    );
    expect(new Set([stats, flier, trampler]).size).toBe(3);
  });

  /**
   * Keyword identity is kept on a token for the same reason it is kept on a
   * grant, and this is the case that says the check is satisfiable rather than
   * unpassable. With keywords abstracted away, a spell that mints a body has two
   * templates in the whole vocabulary: `ModelTokenSpecSchema` requires a body, so
   * every token a spell can make is a creature, and one clause or two is the
   * entire design space. A grain that fails a tier for having three token-making
   * rares in it is a gate nobody can pass.
   */
  it('separates three token spells by what their tokens do', () => {
    const spell = (name: string, keyword: Keyword, power: number): Card =>
      parseCard({
        id: `fix-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
        name,
        rarity: 'rare',
        set: { code: 'FIX', collectorNumber: 2 },
        colors: ['G'],
        kind: 'sorcery',
        manaCost: { generic: 3, G: 2 },
        abilities: [],
        effects: [
          {
            kind: 'createToken',
            count: 2,
            token: { name: 'Fixture Body', power, toughness: power, keywords: [keyword] },
          },
        ],
      });
    const templates = new Set([
      designTemplate(spell('Fixture Summons One', 'flying', 4)),
      designTemplate(spell('Fixture Summons Two', 'haste', 2)),
      designTemplate(spell('Fixture Summons Three', 'trample', 4)),
    ]);
    expect(templates.size).toBe(3);
  });
});

describe('the tier that may not print one card twice', () => {
  it('fails four weapons on one template and blames every one after the first', () => {
    const findings = checkDesignRepeats(entriesFor(STAT_STICKS), SHIPPED);
    expect(findings).toHaveLength(1);
    const [only] = findings;
    expect(only?.code).toBe('BOMB_TEMPLATE_REPEATED');
    expect(only?.severity).toBe('error');
    expect(only?.slotIds).toStrictEqual(['XA02', 'XA03', 'XA04']);
    expect(only?.message).toContain('Fixture Blade One');
  });

  it('passes the same four once three of them grant a keyword', () => {
    const varied = [
      STAT_STICKS[0] as Card,
      weapon({ name: 'Fixture Blade Two', generic: 2, equip: 1, modification: grant('deathtouch') }),
      weapon({ name: 'Fixture Blade Three', generic: 3, equip: 1, modification: grant('firstStrike') }),
      weapon({ name: 'Fixture Blade Four', generic: 4, equip: 2, modification: grant('lifelink') }),
    ];
    expect(checkDesignRepeats(entriesFor(varied), SHIPPED)).toStrictEqual([]);
  });

  it('says nothing about a tier the profile does not call a bomb tier', () => {
    expect(checkDesignRepeats(entriesFor(STAT_STICKS, 'uncommon'), SHIPPED)).toStrictEqual([]);
    expect(checkDesignRepeats(entriesFor(STAT_STICKS, 'common'), SHIPPED)).toStrictEqual([]);
  });

  /**
   * The line is the profile's, not the word "rare". A profile that opens the
   * bomb tier one step lower moves the check with it, with no edit here.
   */
  it('follows a moved bombsMinRarity', () => {
    expect(checkDesignRepeats(entriesFor(STAT_STICKS, 'uncommon'), AT_UNCOMMON)).toHaveLength(1);
  });

  it('leaves two rares alone when they share a template but not a role', () => {
    const entries = entriesFor(STAT_STICKS.slice(0, 2)).map((entry, index) => ({
      ...entry,
      slot: { ...entry.slot, role: index === 0 ? 'gearArtifact' : 'chestArtifact' },
    }));
    expect(checkDesignRepeats(entries, SHIPPED)).toStrictEqual([]);
  });
});

/** A french-vanilla common, the card a set prints most of. */
function bear(index: number, keywords: readonly Keyword[] = []): Card {
  return parseCard({
    id: `fix-bear-${String(index)}`,
    name: `Fixture Bear ${String(index)}`,
    rarity: 'common',
    set: { code: 'FIX', collectorNumber: index },
    colors: ['G'],
    kind: 'creature',
    subtypes: ['Bear'],
    keywords: [...keywords],
    manaCost: { generic: 1, G: 1 },
    power: 2,
    toughness: 2,
    effects: [],
    abilities: [],
  });
}

function bearEntries(count: number, rarity: Slot['rarity'] = 'common'): Entry[] {
  return Array.from({ length: count }, (_, index) => ({
    slot: {
      ...slot(`XC${String(index + 1).padStart(2, '0')}`, rarity, 'creature'),
      cardKind: 'creature' as const,
    },
    card: bear(index + 1),
  }));
}

describe('the tiers that print in bulk', () => {
  it('lets a tier spend a full cycle on one template', () => {
    expect(checkDesignRepeats(bearEntries(TEMPLATE_CYCLE_BUDGET), SHIPPED)).toStrictEqual([]);
  });

  /**
   * And blames only what the cycle did not pay for. Blaming the whole group
   * would ask the loop to regenerate a legal cycle to fix an illegal sixth card.
   */
  it('fails one card past the cycle and blames that card alone', () => {
    const findings = checkDesignRepeats(bearEntries(TEMPLATE_CYCLE_BUDGET + 1), SHIPPED);
    expect(findings).toHaveLength(1);
    const [only] = findings;
    expect(only?.code).toBe('TEMPLATE_OVER_CYCLE');
    expect(only?.slotIds).toStrictEqual(['XC06']);
  });

  /**
   * A common cycle and an uncommon cycle of the same shape are two cycles. The
   * tier is in the key below the bomb line for exactly this reason, and ten
   * cards on one template would fail if it were not.
   */
  it('counts each tier below the bomb line separately', () => {
    const both = [
      ...bearEntries(TEMPLATE_CYCLE_BUDGET, 'common'),
      ...bearEntries(TEMPLATE_CYCLE_BUDGET, 'uncommon').map((entry) => ({
        ...entry,
        slot: { ...entry.slot, id: `U${entry.slot.id}` },
      })),
    ];
    expect(checkDesignRepeats(both, SHIPPED)).toStrictEqual([]);
  });

  /**
   * The two budgets are independent. Cards below the bomb line cannot pay for a
   * repeat above it, and cards above it cannot spend the cycle below: a legal
   * common cycle and an illegal pair of rares on one role and one template is
   * one finding, about the rares.
   */
  it('never lets one tier spend another tier budget', () => {
    const mixed = [
      ...bearEntries(TEMPLATE_CYCLE_BUDGET, 'common'),
      ...bearEntries(2, 'rare').map((entry) => ({
        ...entry,
        slot: { ...entry.slot, id: `R${entry.slot.id}` },
      })),
    ];
    const findings = checkDesignRepeats(mixed, SHIPPED);
    expect(findings.map((item) => item.code)).toStrictEqual(['BOMB_TEMPLATE_REPEATED']);
    expect(findings[0]?.slotIds).toStrictEqual(['RXC02']);
  });
});

const blankArtifact = parseCard({
  id: 'fix-trinket',
  name: 'Fixture Trinket',
  rarity: 'common',
  set: { code: 'FIX', collectorNumber: 9 },
  colors: [],
  kind: 'artifact',
  manaCost: { generic: 3 },
  effects: [],
  abilities: [],
});

describe('a card with nothing printed on it', () => {
  it('fails a noncreature at a tier that prints in bulk', () => {
    const entries: Entry[] = [{ slot: slot('XA09', 'common', 'manaArtifact'), card: blankArtifact }];
    const findings = checkBlankCards(entries, SHIPPED);
    expect(findings.map((item) => item.code)).toStrictEqual(['BLANK_CARD']);
    expect(findings[0]?.slotIds).toStrictEqual(['XA09']);
  });

  /**
   * A vanilla common is a card real sets print, so it is not this finding. How
   * many of them a set may print is the cycle budget's question, not this one.
   */
  it('leaves a vanilla common to the cycle budget', () => {
    expect(checkBlankCards(bearEntries(1), SHIPPED)).toStrictEqual([]);
  });

  it('fails a vanilla creature at the bomb tier', () => {
    const entries = bearEntries(1, 'rare');
    expect(checkBlankCards(entries, SHIPPED).map((item) => item.code)).toStrictEqual(['BLANK_CARD']);
  });

  /** French vanilla is not blank: a keyword is something printed on the card. */
  it('says nothing about a creature whose only line is a keyword', () => {
    const entries: Entry[] = [{ slot: slot('XC01', 'rare', 'creature'), card: bear(1, ['flying']) }];
    expect(checkBlankCards(entries, SHIPPED)).toStrictEqual([]);
  });
});

function spell(name: string, cost: number, effects: readonly unknown[]): Card {
  return parseCard({
    id: `fix-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'FIX', collectorNumber: 7 },
    colors: ['B'],
    kind: 'instant',
    manaCost: { generic: 0, B: cost },
    abilities: [],
    effects,
  });
}

/** A one-mana unconditional Murder: the cheapest true error the flagship has. */
const murder = spell('Fixture Murder', 1, [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }]);

/** Shock, the most efficient card real Magic prints at that tier. */
const shock = spell('Fixture Shock', 1, [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }]);

describe('what a card gives away for what it costs', () => {
  it('fails one-mana unconditional removal at a bulk tier', () => {
    const entries: Entry[] = [{ slot: slot('XB01', 'common', 'removal'), card: murder }];
    const findings = checkCardRate(entries, SHIPPED);
    expect(findings.map((item) => item.code)).toStrictEqual(['RATE_ABOVE_CURVE']);
    expect(findings[0]?.slotIds).toStrictEqual(['XB01']);
  });

  /**
   * And passes the most efficient card real Magic prints at that tier. The
   * ceiling is centered between these two cards, so a gate that failed this one
   * would be failing sets nobody could design.
   */
  it('passes a one-mana Shock at the same tier', () => {
    const entries: Entry[] = [{ slot: slot('XB02', 'common', 'removal'), card: shock }];
    expect(checkCardRate(entries, SHIPPED)).toStrictEqual([]);
  });

  it('fails a one-mana Equipment granting ninety-nine power', () => {
    const obliterator = weapon({
      name: 'Fixture Blade Eight',
      generic: 1,
      equip: 1,
      modification: statBonus(99, -3),
    });
    const entries: Entry[] = [{ slot: slot('XA10', 'rare', 'gearArtifact'), card: obliterator }];
    expect(checkCardRate(entries, SHIPPED).map((item) => item.code)).toStrictEqual(['RATE_ABOVE_CURVE']);
  });

  /**
   * And the reach of that, stated rather than left to be discovered.
   *
   * This card cost two mana until `equipHostCount` was measured off the balance
   * sweep and came back 0.684 where the guess had put 1.5, and at two mana it
   * now passes. The limit is exact and it is arithmetic, not a threshold: every
   * `statBonus` in an equip clause is clamped to `equipModificationCeiling`,
   * which is `creatureStatBaselinePerMana x formatMedianRounds` = 14, so the
   * most any Equipment's clause can be worth is `0.684 x (14 - equip cost)`.
   * Take off the artifact frame and the casting penalty and divide by the mana
   * value, and no Equipment of mana value 2 or more can reach the bomb tier's
   * ceiling of 4 per mana, whatever it prints. `RATE_ABOVE_CURVE` at that tier
   * is a check on Equipment costing one.
   *
   * Pinned here so a weight change that reopens the range fails this test rather
   * than passing quietly, and so the hole is a number somebody can argue with.
   * The remedy is not a lower ceiling: the ceiling is in score units and the
   * score's units for this card class are what moved. mtg-mq0l's second half is
   * where that belongs.
   */
  it('cannot fail a two-mana Equipment at all, whatever it prints', () => {
    const obliterator = weapon({
      name: 'Fixture Blade Nine',
      generic: 2,
      equip: 1,
      modification: statBonus(99, 99),
    });
    const entries: Entry[] = [{ slot: slot('XA11', 'rare', 'gearArtifact'), card: obliterator }];
    expect(checkCardRate(entries, SHIPPED)).toStrictEqual([]);
    // One mana to equip, because `checkEquipAbility` refuses a cost that is free
    // in every currency; that is the cheapest an Equipment may print, so this is
    // the most valuable two-mana Equipment the DSL can express.
    const ceiling =
      DEFAULT_SCORE_WEIGHTS.creatureStatBaselinePerMana * DEFAULT_SCORE_WEIGHTS.formatMedianRounds;
    const best =
      (DEFAULT_SCORE_WEIGHTS.equipHostCount * (ceiling - DEFAULT_SCORE_WEIGHTS.activationCostPerMana) +
        DEFAULT_SCORE_WEIGHTS.vanillaArtifactBaseline -
        DEFAULT_SCORE_WEIGHTS.spellManaPenaltyPerMana * 2) /
      2;
    expect(cardRate(obliterator)).toBeCloseTo(best, 10);
    expect(best).toBeLessThan(RATE_CEILING_BOMB);
  });

  /** The bomb tier's extra headroom, spent on a weapon a real set would print. */
  it('passes a four-mana +4/+4 weapon at the bomb tier', () => {
    const entries = entriesFor([STAT_STICKS[3] as Card]);
    expect(checkCardRate(entries, SHIPPED)).toStrictEqual([]);
  });

  /** The same card is judged against the tier it is printed at, not its text. */
  it('reads the ceiling off the tier rather than the card', () => {
    const entries: Entry[] = [{ slot: slot('XB03', 'rare', 'removal'), card: murder }];
    expect(checkCardRate(entries, SHIPPED)).toStrictEqual([]);
  });
});

/**
 * The severity choice, pinned. These three name defects whose remedy is in the
 * slot skeleton rather than the card, so they must never reach `failingSlotIds`
 * and buy a retry round that re-asks for a card the spec already pins. The bomb
 * tier's repeat is the one a retry can fix, and it stays an error.
 */
describe('what the retry loop is sent after', () => {
  it('reports the three skeleton findings without asking for a regeneration', () => {
    const findings = [
      ...checkDesignRepeats(bearEntries(TEMPLATE_CYCLE_BUDGET + 1), SHIPPED),
      ...checkBlankCards([{ slot: slot('XA09', 'common', 'manaArtifact'), card: blankArtifact }], SHIPPED),
      ...checkCardRate([{ slot: slot('XB01', 'common', 'removal'), card: murder }], SHIPPED),
    ];
    expect(findings.map((item) => item.code)).toStrictEqual([
      'TEMPLATE_OVER_CYCLE',
      'BLANK_CARD',
      'RATE_ABOVE_CURVE',
    ]);
    expect(findings.every((item) => item.severity === 'warning')).toBe(true);
    expect(failingSlotIds(findings)).toStrictEqual([]);
  });

  it('still sends it after a repeated card at the bomb tier', () => {
    const findings = checkDesignRepeats(entriesFor(STAT_STICKS), SHIPPED);
    expect(failingSlotIds(findings)).toStrictEqual(['XA02', 'XA03', 'XA04']);
  });
});

describe('a keyword a colorless weapon hands out', () => {
  const seat = slot('XA01', 'rare', 'gearArtifact');

  it('is on-pie when an equip clause grants it', () => {
    const flier = weapon({
      name: 'Fixture Blade Five',
      generic: 3,
      equip: 2,
      modification: grant('flying'),
    });
    expect(checkCardPie(seat, flier)).toStrictEqual([]);
  });

  /**
   * And only through an equip clause. A colorless anthem granting menace is a
   * black card wearing no color, and the allowance is deliberately the narrow
   * one. This is also the assertion that says the pie now reads `attach` at all:
   * before `mtg-bfj6` it read a static's modification and nothing else, so a
   * granted keyword hid inside an equip clause in every color.
   */
  it('is off-pie when a static ability grants it', () => {
    const anthem = parseCard({
      id: 'fix-banner',
      name: 'Fixture Banner',
      rarity: 'rare',
      set: { code: 'FIX', collectorNumber: 3 },
      colors: [],
      kind: 'artifact',
      manaCost: { generic: 3 },
      effects: [],
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'grantKeyword', keyword: 'menace' },
        },
      ],
    });
    expect(checkCardPie(seat, anthem).map((item) => item.code)).toStrictEqual(['OFF_PIE']);
  });

  /**
   * And the allowance is keyed on the clause, not on the word. One card doing
   * both is two subjects with one name, and reading them off a set of granted
   * keywords would let the equip clause launder the static one.
   */
  it('still fails the static grant on a card whose equip clause grants the same keyword', () => {
    const both = parseCard({
      id: 'fix-blade-seven',
      name: 'Fixture Blade Seven',
      rarity: 'rare',
      set: { code: 'FIX', collectorNumber: 4 },
      colors: [],
      kind: 'artifact',
      subtypes: [EQUIPMENT_SUBTYPE],
      manaCost: { generic: 3 },
      effects: [],
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'grantKeyword', keyword: 'menace' },
        },
        {
          kind: 'activated',
          cost: { mana: { generic: 2 }, tapSelf: false, sacrificeSelf: false },
          effects: [],
          attach: { modifications: [{ kind: 'grantKeyword', keyword: 'menace' }] },
        },
      ],
    });
    const findings = checkCardPie(seat, both);
    expect(findings.map((item) => item.code)).toStrictEqual(['OFF_PIE']);
    expect(findings[0]?.message).toContain('menace');
    expect(rulingsFor(both).map((ruling) => ruling.verdict)).toStrictEqual(['fail', 'pass']);
  });
});
