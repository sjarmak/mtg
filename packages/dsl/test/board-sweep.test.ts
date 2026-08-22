/**
 * The untargeted half of the scope vocabulary: a scope that names a region of
 * the board, and the `players` field that sweeps the seats instead.
 *
 * `effect-scope.test.ts` and `sweepers.test.ts` are the targeted half, where a
 * scope reads its group off the player the effect chose. These three scopes
 * choose nothing (CR 115.1), so the group is a region of the battlefield and
 * *which* permanents in it is a separate question with a separate answer: the
 * `scopeFilter`, which is the same `TargetFilter` a target slot narrows itself
 * with. One filter vocabulary, one matcher, both halves.
 *
 * Two words rather than one is what the census forced (`mtg-9u18`). M11 and M13
 * print nine sweepers between them and they name four different card types —
 * Day of Judgment's creatures, Back to Nature's enchantments, Planar Cleansing's
 * nonland permanents, Trumpet Blast's attacking creatures — so a scope that
 * baked the card type in would have needed one member per card. The scope says
 * whose region and the filter says what is in it.
 *
 * Every assertion here is a printed line from one of those two sets, because a
 * scope no printed card in the population uses is a widening nothing measured.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, Effect } from '../src/index';
import { renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

function sorceryInput(effects: readonly Effect[], name = 'Reckoning'): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-reckoning',
    name,
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 3, W: 1 },
    colors: ['W'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as unknown as CardInput;
}

function oracleOf(effects: readonly Effect[], name = 'Reckoning'): string {
  const card = parseCard(sorceryInput(effects, name));
  expect(validateCard(card)).toEqual([]);
  return renderOracleText(card);
}

function codesFor(effects: readonly Effect[]): readonly string[] {
  const card = sorceryInput(effects) as unknown as Parameters<typeof validateCard>[0];
  return validateCard(card).map((found) => found.code);
}

const NOWHERE = { kind: 'noTarget' } as const;

describe('a sweep over a region of the board', () => {
  /**
   * The four card types the census names, printed by four cards that differ in
   * nothing else. This is the assertion that the filter is doing the work the
   * scope word is not: one scope, four sentences.
   */
  it('prints the card type the filter names rather than one the scope baked in', () => {
    expect(
      oracleOf(
        [
          {
            kind: 'destroyPermanent',
            scope: 'allPermanents',
            scopeFilter: { cardTypes: ['creature'] },
            target: NOWHERE,
          },
        ],
        'Day of Judgment',
      ),
    ).toBe('Destroy all creatures.');
    expect(
      oracleOf(
        [
          {
            kind: 'destroyPermanent',
            scope: 'allPermanents',
            scopeFilter: { cardTypes: ['enchantment'] },
            target: NOWHERE,
          },
        ],
        'Back to Nature',
      ),
    ).toBe('Destroy all enchantments.');
    expect(
      oracleOf(
        [
          {
            kind: 'destroyPermanent',
            scope: 'allPermanents',
            scopeFilter: { excludeCardTypes: ['land'] },
            target: NOWHERE,
          },
        ],
        'Planar Cleansing',
      ),
    ).toBe('Destroy all nonland permanents.');
  });

  /**
   * Damage distributes over "each" and the other three collect into "all", which
   * is the sentence rule the targeted half already keeps; the filter's combat
   * half rides along inside the noun phrase either way.
   */
  it('distributes damage over each member and reads the combat half inside the noun', () => {
    expect(
      oracleOf(
        [
          {
            kind: 'dealDamage',
            amount: 2,
            scope: 'allPermanents',
            scopeFilter: { cardTypes: ['creature'] },
            target: NOWHERE,
          },
        ],
        'Pyroclasm',
      ),
    ).toBe('Pyroclasm deals 2 damage to each creature.');
    expect(
      oracleOf(
        [
          {
            kind: 'dealDamage',
            amount: 1,
            scope: 'allPermanents',
            scopeFilter: { cardTypes: ['creature'], combat: 'attacking' },
            target: NOWHERE,
          },
        ],
        'Rain of Blades',
      ),
    ).toBe('Rain of Blades deals 1 damage to each attacking creature.');
  });

  /**
   * The one-sided scopes, and the reason there are two of them rather than one
   * with a flag: Magic prints "creatures you control" and "creatures your
   * opponents control" as different phrases, and the second is plural in a
   * two-player kernel where it reduces to one seat.
   *
   * `allPermanents` with the same filter prints "All attacking creatures get
   * +2/+0", where Trumpet Blast (M13 152) prints "Attacking creatures get
   * +2/+0". That deviation is the one this vocabulary has shipped since the
   * first scope landed — the collecting phrase is "all X" for every scope that
   * has one — and it is asserted rather than fixed, so the day somebody changes
   * it, they change it on purpose.
   */
  it('says which side of the board it reaches, and stays plural where Magic is', () => {
    expect(
      oracleOf(
        [
          {
            kind: 'pumpUntilEndOfTurn',
            power: 1,
            toughness: 1,
            scope: 'permanentsYouControl',
            scopeFilter: { cardTypes: ['creature'] },
            target: NOWHERE,
          },
        ],
        'Glorious Charge',
      ),
    ).toBe('Creatures you control get +1/+1 until end of turn.');
    expect(
      oracleOf(
        [
          {
            kind: 'pumpUntilEndOfTurn',
            power: -1,
            toughness: -1,
            scope: 'permanentsOpponentsControl',
            scopeFilter: { cardTypes: ['creature'] },
            target: NOWHERE,
          },
        ],
        'Cower in Fear',
      ),
    ).toBe('Creatures your opponents control get -1/-1 until end of turn.');
    expect(
      oracleOf(
        [
          {
            kind: 'pumpUntilEndOfTurn',
            power: 2,
            toughness: 0,
            scope: 'allPermanents',
            scopeFilter: { cardTypes: ['creature'], combat: 'attacking' },
            target: NOWHERE,
          },
        ],
        'Trumpet Blast',
      ),
    ).toBe('All attacking creatures get +2/+0 until end of turn.');
  });
});

describe('the three rules a region scope adds', () => {
  /**
   * The mirror of the targeted half's pairing rule, and the reason the two arms
   * are separate functions rather than one check with a flipped sign: a spell
   * that chooses a player and then sweeps a region prints one sentence and
   * resolves another, and nothing downstream would notice.
   */
  it('refuses a target slot beside a scope that chooses nothing', () => {
    expect(
      codesFor([
        {
          kind: 'destroyPermanent',
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'targetOpponent' },
        },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  /** "Destroy all" is not a sentence: the region says where and nothing says what. */
  it('refuses a region scope with no filter, and an empty one with it', () => {
    expect(codesFor([{ kind: 'destroyPermanent', scope: 'allPermanents', target: NOWHERE }])).toContain(
      'ILLEGAL_EFFECT_SCOPE',
    );
    expect(
      codesFor([{ kind: 'destroyPermanent', scope: 'allPermanents', scopeFilter: {}, target: NOWHERE }]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  /**
   * CR 120.3: damage reaches creatures, planeswalkers, battles and players.
   * "Deal 2 damage to each enchantment" parses, prints a sentence and resolves
   * into no game action at all, which is the failure the whole scope check
   * exists to refuse.
   */
  it('refuses a damage sweep aimed at a card type damage cannot reach', () => {
    expect(
      codesFor([
        {
          kind: 'dealDamage',
          amount: 2,
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['enchantment'] },
          target: NOWHERE,
        },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
    expect(
      codesFor([
        {
          kind: 'dealDamage',
          amount: 2,
          scope: 'allPermanents',
          scopeFilter: { excludeCardTypes: ['land'] },
          target: NOWHERE,
        },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  /**
   * The filter is the region scope's and only the region scope's. A targeted
   * scope already names its own objects — `creaturesThatPlayerControls` says
   * creatures — so a filter beside it is a second, competing answer to one
   * question, and whichever one the kernel read would make the other a lie.
   */
  it('refuses a filter beside a scope that already names its objects', () => {
    expect(
      codesFor([
        {
          kind: 'destroyPermanent',
          scope: 'creaturesThatPlayerControls',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'targetOpponent' },
        },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  /** A filter narrows a group, and an unscoped effect has one object rather than a group. */
  it('refuses a filter on an effect with no scope at all', () => {
    expect(
      codesFor([
        {
          kind: 'destroyPermanent',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'targetCreature' },
        },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  /**
   * The slot `noTarget` opened, closed from the other side. Three sweeper rows
   * admit it now so a region scope has something to say; without this rule an
   * unscoped destroy could sit on that slot, print "Destroy target creature"
   * with nothing to destroy, and resolve into nothing.
   */
  it('refuses an unscoped sweeper that chooses nothing either', () => {
    expect(codesFor([{ kind: 'destroyPermanent', target: NOWHERE }])).toContain('ILLEGAL_EFFECT_SCOPE');
    expect(codesFor([{ kind: 'dealDamage', amount: 2, target: NOWHERE }])).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  /**
   * `SCOPES_LEGAL_ON` moves by census, not by symmetry. Nothing in M11 or M13
   * taps a region of the board — every printed tapper of the era names a player
   * (Sleep, Frost Breath) and was expressible before this lane — so the row
   * stays where it was, and the same goes for the two zone moves, which would
   * have to say what "exile all creatures" means about a hand.
   */
  it('keeps the region scopes off the rows no printed card asked for', () => {
    expect(
      codesFor([
        {
          kind: 'tapPermanent',
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
          target: NOWHERE,
        },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
    expect(codesFor([{ kind: 'exileTarget', scope: 'allPermanents', target: NOWHERE }])).toContain(
      'ILLEGAL_EFFECT_SCOPE',
    );
    expect(
      codesFor([
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 1,
          scope: 'creatureCardsInPlayerHand',
          target: { kind: 'targetOpponent' },
        },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });
});

describe('a sweep over the players', () => {
  /**
   * Temple Bell's line (M11 217), and Jace Beleren's +2 (M11 58). It is a field
   * on `drawCards` rather than a scope, because a scope names objects and every
   * reader of one asks which zone and which bodies; "each player" has neither.
   */
  it('draws for the table without naming anybody', () => {
    expect(
      oracleOf([{ kind: 'drawCards', count: 1, players: 'eachPlayer', target: NOWHERE }], 'Temple Toll'),
    ).toBe('Each player draws a card.');
    expect(
      oracleOf([{ kind: 'drawCards', count: 2, players: 'eachPlayer', target: NOWHERE }], 'Temple Toll'),
    ).toBe('Each player draws two cards.');
  });

  it('leaves the targeted draw printing exactly what it printed before', () => {
    expect(oracleOf([{ kind: 'drawCards', count: 1, target: NOWHERE }])).toBe('Draw a card.');
    expect(oracleOf([{ kind: 'drawCards', count: 2, target: { kind: 'targetPlayer' } }])).toBe(
      'Target player draws two cards.',
    );
  });

  /**
   * Howling Banshee's second sentence (M11 100). The field went onto `loseLife`
   * rather than onto a second mechanism because the sentence is the same
   * sentence: everybody at the table, nobody chosen. A `targetOpponent` effect
   * beside a `noTarget` one would have printed the same words and resolved
   * differently — it chooses (CR 115.1), so hexproof answers half of it, and
   * CR 608.2b takes the whole ability with the chosen seat.
   */
  it('takes life off the table without naming anybody', () => {
    expect(
      oracleOf([{ kind: 'loseLife', amount: 3, players: 'eachPlayer', target: NOWHERE }], 'Banshee Wail'),
    ).toBe('Each player loses 3 life.');
  });

  it('leaves the targeted life loss printing exactly what it printed before', () => {
    expect(oracleOf([{ kind: 'loseLife', amount: 2, target: NOWHERE }])).toBe('You lose 2 life.');
    expect(oracleOf([{ kind: 'loseLife', amount: 3, target: { kind: 'targetOpponent' } }])).toBe(
      'Target opponent loses 3 life.',
    );
  });

  /**
   * `checkPlayerSweep`'s whole job, and the same sentence `checkSpaceScope`
   * states one field over: a sweep that reads no target beside a slot that
   * chooses one is a card whose printed line and whose resolution disagree.
   *
   * Both carriers are asserted because the guard used to name `drawCards` in
   * its condition, which meant the second carrier of the field passed the check
   * by being a different kind rather than by being scoped correctly.
   */
  it('refuses a target slot beside the sweep', () => {
    expect(
      codesFor([{ kind: 'drawCards', count: 1, players: 'eachPlayer', target: { kind: 'targetPlayer' } }]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
    expect(
      codesFor([{ kind: 'loseLife', amount: 3, players: 'eachPlayer', target: { kind: 'targetOpponent' } }]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });
});
