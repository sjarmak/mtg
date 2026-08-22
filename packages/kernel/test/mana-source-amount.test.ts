/**
 * What an untapped mana source promises the payment planner.
 *
 * The planner's candidate model was one mana per source and it read that model
 * off `landProduces` — lands only, one mana per tap. Gilded Lotus is neither: it
 * is an artifact, and its tap adds three. So a board holding two of them could
 * not pay a five-cost spell, and the planner gave no reason for the refusal
 * because it never saw the Lotuses at all.
 *
 * The assertions here are about the pool and the plan together. A plan that
 * says two taps proves the candidate model widened; a cast that leaves one mana
 * floating proves `executePayment` produced three per tap rather than one, which
 * is the half a plan alone cannot show.
 *
 * The refusals are asserted for the same reason the payments are. `tapPromise`
 * is a promise rather than a reading of the board, so the cases it will not
 * promise — an amount the board decides, a cost that is more than the tap, a tap
 * CR 302.6 forbids — have to refuse rather than guess, and a guess here is a
 * plan `executePayment` throws on.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Amount } from '@mtg/dsl';
import { mana } from '@mtg/dsl';
import { availableMana, canPay, planPayment, playerOf, poolTotal, reduce, scenario } from '@mtg/kernel';
import { artifact, creature, FOREST, sorcery, SWAMP } from './cards';
import { handOidOf, oidOf } from './helpers';

/** `{T}: Add three mana of any one color.` */
const LOTUS_ABILITY: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'addMana', produces: ['W', 'U', 'B', 'R', 'G'], amount: 3 }],
};

/** `{T}: Add {B} for each Swamp you control.` — an amount the board decides. */
const COMPUTED_ABILITY: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [
    {
      kind: 'addMana',
      produces: ['B'],
      amount: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' } satisfies Amount,
    },
  ],
};

/** `{1}, {T}: Add {G}{G}.` — a cost the planner would have to pay to pay. */
const PRICED_ABILITY: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true },
  effects: [{ kind: 'addMana', produces: ['G'], amount: 2 }],
};

/** `{T}: Add {G}.` on a creature, so CR 302.6 has something to forbid. */
const ELF_ABILITY: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'addMana', produces: ['G'], amount: 1 }],
};

const lotus = (): ReturnType<typeof artifact> => artifact('Gilded Lotus', { generic: 5 }, [LOTUS_ABILITY]);

describe('a source that taps for more than one mana', () => {
  it('pays a five-cost spell off two sources', () => {
    const spell = sorcery(
      'Five Drop Sorcery',
      [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      {
        generic: 5,
      },
    );
    const start = scenario({
      battlefield: [
        { card: lotus(), controller: 0 },
        { card: lotus(), controller: 0 },
      ],
      hands: [[spell], []],
    }).state;

    expect(availableMana(start, 0)).toBe(6);
    expect(canPay(start, 0, mana({ generic: 5 }))).toBe(true);
    expect(planPayment(start, 0, mana({ generic: 5 }))?.taps).toHaveLength(2);

    const cast = reduce(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start, 0, 'Five Drop Sorcery'),
      targets: [null],
    });
    // Six produced, five spent: the sixth is floating, which is what proves each
    // tap added three rather than one.
    expect(poolTotal(playerOf(cast.state, 0).pool)).toBe(1);
  });

  it('spends a land before a Lotus when either would do', () => {
    const start = scenario({
      battlefield: [
        { card: lotus(), controller: 0 },
        { card: FOREST, controller: 0 },
      ],
    }).state;

    expect(planPayment(start, 0, mana({ G: 1 }))?.taps).toEqual([oidOf(start, 'Forest')]);
  });
});

describe('what a source refuses to promise', () => {
  it('refuses an amount the board decides rather than guessing at it', () => {
    const start = scenario({
      battlefield: [
        { card: artifact('Cellar Vault', { generic: 4 }, [COMPUTED_ABILITY]), controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
      ],
    }).state;

    // Three sources standing, and only the two Swamps are counted.
    expect(availableMana(start, 0)).toBe(2);
    expect(canPay(start, 0, mana({ B: 3 }))).toBe(false);
  });

  it('refuses a mana ability that charges more than the tap', () => {
    const start = scenario({
      battlefield: [
        { card: artifact('Verdant Filter', { generic: 3 }, [PRICED_ABILITY]), controller: 0 },
        { card: FOREST, controller: 0 },
      ],
    }).state;

    // A player can pay this by hand — tap the Forest, spend the {G} on the
    // filter — and the planner does not, because paying for the payment is a
    // recursion it does not do.
    expect(canPay(start, 0, mana({ G: 2 }))).toBe(false);
    expect(canPay(start, 0, mana({ G: 1 }))).toBe(true);
  });

  it('refuses a creature summoning sickness has not let go of', () => {
    const sick = scenario({
      battlefield: [
        {
          card: creature('Thicket Mystic', 1, 1, { cost: { G: 1 }, abilities: [ELF_ABILITY] }),
          controller: 0,
          summoningSick: true,
        },
      ],
    }).state;
    expect(canPay(sick, 0, mana({ G: 1 }))).toBe(false);

    const settled = scenario({
      battlefield: [
        {
          card: creature('Thicket Mystic', 1, 1, { cost: { G: 1 }, abilities: [ELF_ABILITY] }),
          controller: 0,
        },
      ],
    }).state;
    expect(canPay(settled, 0, mana({ G: 1 }))).toBe(true);
  });
});
