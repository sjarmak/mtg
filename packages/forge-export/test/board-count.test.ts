/**
 * "Equal to the number of Monsters you control", in Forge.
 *
 * Unlike the resolution count (`resolution-count.test.ts`), this one is not a
 * protocol across the chain — Forge reads the battlefield out of one SVar and
 * any numeral slot can name it. So the cases that matter are the spec this
 * transpiler writes into that SVar, and the filters it refuses to write at all.
 * A wrong spec is the failure mode worth the tests: it transpiles clean and
 * counts a different number in Forge than the kernel counts.
 *
 * Every spelling below was read off Forge 2.0.14's shipped `res/cardsfolder`,
 * where `Count$Valid` appears in 2,580 of 33,587 scripts.
 */
import { describe, expect, it } from 'vitest';
import type { EffectInput } from '@mtg/dsl';
import { transpileCard } from '../src/index';
import { boardCountValid } from '../src/board-count';
import { creature, mustTranspile, spell } from './helpers';

const drawForBoard = (filter: Record<string, unknown>): EffectInput => ({
  kind: 'drawCards',
  count: { kind: 'countMatching', filter },
  target: { kind: 'noTarget' },
});

function svarLine(script: string, name: string): string | undefined {
  return script.split('\n').find((line) => line.startsWith(`SVar:${name}:`));
}

describe('a spell that draws for its own board', () => {
  const script = mustTranspile(spell('Trophy of the Hunt', [drawForBoard({ subtypes: ['Monster'] })]));

  it('names the SVar in the numeral slot rather than a number', () => {
    expect(script).toContain('NumCards$ Y');
  });

  it('binds it to the count of that subtype you control', () => {
    expect(svarLine(script, 'Y')).toBe('SVar:Y:Count$Valid Monster.YouCtrl');
  });
});

/**
 * The type token is a card type when the filter names one and a creature type
 * when it does not, which is Forge's own grammar rather than a shortcut:
 * `Count$Valid Elf.YouCtrl` appears sixteen times in the shipped corpus and
 * `Count$Valid Creature.Elf+YouCtrl` appears never.
 */
describe('the spec each filter shape spells', () => {
  it('counts every permanent you control when it names nothing', () => {
    expect(boardCountValid({})).toBe('Permanent.YouCtrl');
  });

  it('counts a card type on its own', () => {
    expect(boardCountValid({ cardTypes: ['creature'] })).toBe('Creature.YouCtrl');
    expect(boardCountValid({ cardTypes: ['artifact'] })).toBe('Artifact.YouCtrl');
    expect(boardCountValid({ cardTypes: ['enchantment'] })).toBe('Enchantment.YouCtrl');
    expect(boardCountValid({ cardTypes: ['land'] })).toBe('Land.YouCtrl');
  });

  it('counts a subtype on its own with the bare token the corpus prefers', () => {
    expect(boardCountValid({ subtypes: ['Vorn'] })).toBe('Vorn.YouCtrl');
  });

  it('ands the two when a filter names both', () => {
    expect(boardCountValid({ cardTypes: ['creature'], subtypes: ['Monster'] })).toBe(
      'Creature.Monster+YouCtrl',
    );
  });

  it('spells a current-name count across the battlefield while excluding the source', () => {
    expect(
      boardCountValid(
        { cardTypes: ['creature'], names: ['Relentless Rats'] },
        { whose: 'each', excludeSource: true },
      ),
    ).toBe('Creature.namedRelentless Rats+Other');
  });
});

/**
 * `matchesFilter` ORs within an axis and ANDs across them, and Forge spells the
 * OR as a comma-separated list of whole specs (159 shipped lines) and the AND
 * as a `+` between qualifiers. So a filter with members on more than one axis
 * is the cross product, and a card matching two members is still counted once:
 * `getValidCardCount` tests each card against the whole array through
 * `GameObject.isValid(String[])`, which returns on the first member that
 * matches.
 */
describe('a filter that names more than one of something', () => {
  it('writes one member per card type', () => {
    expect(boardCountValid({ cardTypes: ['creature', 'artifact'] })).toBe(
      'Creature.YouCtrl,Artifact.YouCtrl',
    );
  });

  it('writes one member per subtype, in the position a card type would sit in', () => {
    expect(boardCountValid({ subtypes: ['Monster', 'Vorn'] })).toBe('Monster.YouCtrl,Vorn.YouCtrl');
  });

  it('crosses the axes, because they AND while their members OR', () => {
    expect(boardCountValid({ cardTypes: ['creature', 'artifact'], subtypes: ['Monster', 'Vorn'] })).toBe(
      'Creature.Monster+YouCtrl,Creature.Vorn+YouCtrl,Artifact.Monster+YouCtrl,Artifact.Vorn+YouCtrl',
    );
  });

  it('refuses the whole list when one member names a card type off the battlefield', () => {
    expect(boardCountValid({ cardTypes: ['creature', 'instant'] })).toBeNull();
  });

  it("counts Brigands and Monsters the way Silver Brigand Warchief's trigger reads", () => {
    const result = transpileCard(
      spell('Tally of Camps', [drawForBoard({ subtypes: ['Brigand', 'Monster'] })]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text.split('\n')).toContain('SVar:Y:Count$Valid Brigand.YouCtrl,Monster.YouCtrl');
  });
});

describe('the shapes that must keep rejecting', () => {
  it('refuses a card type that is never on a battlefield', () => {
    expect(boardCountValid({ cardTypes: ['instant'] })).toBeNull();
    const result = transpileCard(spell('Tally of Tricks', [drawForBoard({ cardTypes: ['instant'] })]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_COMPUTED_AMOUNT');
  });

  it('refuses a name containing a Forge list separator', () => {
    expect(boardCountValid({ names: ['Ajani, Caller of the Pride'] })).toBeNull();
  });

  /**
   * The one refusal that is not about grammar. Forge writes a counter
   * narrowing — `Count$Valid Creature.YouCtrl+counters_GE1_P1P1` is a shape its
   * corpus ships — and it still cannot spell *which* counter this card means: a
   * part counter decomposes into two of Forge's counter types
   * (`FORGE_COUNTER_TYPES`), neither of them named after the part, so the
   * nearest spelling would count every creature carrying any +1/+1 counter.
   * That is not a superset with a divergence in it; it is a different card.
   */
  it('refuses a count narrowed by a counter, which Forge cannot name', () => {
    const result = transpileCard(
      spell('Tally of Trophies', [
        {
          kind: 'drawCards',
          count: { kind: 'countWithCounter', filter: { cardTypes: ['creature'] }, counters: ['horn'] },
          target: { kind: 'noTarget' },
        },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_COMPUTED_AMOUNT');
    expect(result.rejections.map((r) => r.message).join(' ')).toContain('countWithCounter');
  });

  /**
   * The hazard the refusal above exists for: a chain that also reads a plain
   * board count has an SVar bound and a numeral to put it in, and spelling the
   * counter count with it would quietly widen "creatures with a counter on
   * them" to "creatures". The whole card is refused instead.
   */
  it('refuses the whole chain rather than spelling a counter count as the plain board count', () => {
    const result = transpileCard(
      spell('Two Tallies', [
        drawForBoard({ cardTypes: ['creature'] }),
        {
          kind: 'drawCards',
          count: { kind: 'countWithCounter', filter: { cardTypes: ['creature'] }, counters: ['horn'] },
          target: { kind: 'noTarget' },
        },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_COMPUTED_AMOUNT');
  });

  it('refuses a chain that reads two different boards, since both would want Y', () => {
    const result = transpileCard(
      spell('Two Ledgers', [drawForBoard({ subtypes: ['Monster'] }), drawForBoard({ cardTypes: ['land'] })]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_COMPUTED_AMOUNT');
  });
});

/**
 * A chain may print both counts, which is the whole reason this one is `Y`.
 */
describe('a chain that counts an exile and a board at once', () => {
  const script = mustTranspile(
    spell('Seize and Scorch', [
      { kind: 'exileTarget', scope: 'creaturesThatPlayerControls', target: { kind: 'targetOpponent' } },
      { kind: 'dealDamage', amount: { kind: 'exiledThisResolution' }, target: { kind: 'targetOpponent' } },
      drawForBoard({ subtypes: ['Monster'] }),
    ]),
  );

  it('keeps the two counts on separate SVars', () => {
    expect(svarLine(script, 'X')).toBe('SVar:X:Remembered$Amount');
    expect(svarLine(script, 'Y')).toBe('SVar:Y:Count$Valid Monster.YouCtrl');
    expect(script).toContain('NumDmg$ X');
    expect(script).toContain('NumCards$ Y');
  });
});

/**
 * The count in a printed ability, which is where the flagship actually prints
 * it.
 *
 * A board count is not the resolution count and does not share its acceptance
 * boundary. The resolution count is a protocol — one effect exiles, a later
 * one reads how many, and the chain has to carry the answer between them, so
 * the printed-ability paths opt into it through the exact amount kinds Forge's
 * own scripts attest. A board count carries nothing: `SVar:Y:Count$Valid ...`
 * reads the battlefield at the moment the numeral is evaluated, and a `T:`
 * chain evaluates it the same way an `A:SP$` chain does.
 *
 * Silver Brigand Warchief is the card that made the difference visible. Its
 * count is legal, its filter is spellable, and it was still refused, because
 * `boardCountValid` was only ever reached from the spell path.
 */
describe('a board count printed on an ability rather than a spell', () => {
  const WARCHIEF_TRIGGER = {
    kind: 'triggered' as const,
    condition: 'selfEnters' as const,
    effects: [
      {
        kind: 'loseLife' as const,
        amount: { kind: 'countMatching' as const, filter: { subtypes: ['Brigand', 'Monster'] } },
        target: { kind: 'targetOpponent' as const },
      },
    ],
  };

  it('spells an enters-the-battlefield trigger that counts the board', () => {
    const script = mustTranspile(
      creature('Silver Brigand Warchief', {
        subtypes: ['Brigand', 'Monster'],
        abilities: [WARCHIEF_TRIGGER],
      }),
    );
    expect(script).toContain('SVar:Trig1Effect1:DB$ LoseLife | ValidTgts$ Player.Opponent | LifeAmount$ Y');
    expect(svarLine(script, 'Y')).toBe('SVar:Y:Count$Valid Brigand.YouCtrl,Monster.YouCtrl');
  });

  it('spells an activated ability that counts the board', () => {
    const script = mustTranspile(
      creature('Camp Quartermaster', {
        abilities: [
          {
            kind: 'activated',
            cost: { mana: { generic: 2 }, tapSelf: true },
            effects: [drawForBoard({ subtypes: ['Monster'] })],
          },
        ],
      }),
    );
    expect(script).toContain('NumCards$ Y');
    expect(svarLine(script, 'Y')).toBe('SVar:Y:Count$Valid Monster.YouCtrl');
  });

  /**
   * The one-spec rule is the chain's, not the card's, so an ability keeps it
   * for the same reason a spell does: both members would want `Y`.
   */
  it('refuses an ability whose chain reads two different boards', () => {
    const result = transpileCard(
      creature('Two Ledgers Rampant', {
        abilities: [
          {
            kind: 'activated',
            cost: { mana: { generic: 2 }, tapSelf: true },
            effects: [drawForBoard({ subtypes: ['Monster'] }), drawForBoard({ cardTypes: ['land'] })],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_COMPUTED_AMOUNT');
  });
});
