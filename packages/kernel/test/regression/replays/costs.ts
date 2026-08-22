/**
 * Cost-payment defects the bank replays.
 *
 * Two entries, both about what the kernel charges a player rather than about
 * what it lets them do with the result. `bb0338d` is a keyword waiver read in
 * one of the two places that enforce it (CR 702.10c); `eb42643` is an
 * auto-tapper optimizing the cost in front of it while stranding a color the
 * rest of the hand needed.
 *
 * `activated-abilities.test.ts` and `mana-hand.test.ts` are the fuller
 * treatments. What is here is the property each fix produced, and both are
 * stated as a pair so that fixing one enforcement site and not the other cannot
 * pass — a rule the enumeration honors and `validateAction` does not is how a
 * bot and a player come to disagree about a legal play.
 */
import { expect } from 'vitest';
import type { AbilityInput } from '@mtg/dsl';
import { mana } from '@mtg/dsl';
import type { Action, GameState, ObjectId } from '@mtg/kernel';
import { legalActions, planPayment, scenario, validateAction } from '@mtg/kernel';
import { creature, FOREST, MOUNTAIN, SWAMP } from '../../cards';
import { apply, handOidOf, oidOf, oidsOf } from '../../helpers';
import { replay } from '../bank';

/** `{1}, {T}: CARDNAME deals 1 damage to any target.` */
const PING: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
};

const HASTY_SMITH = creature('Hasty Smith', 2, 2, { abilities: [PING], keywords: ['haste'] });
const EMBERKIN_SMITH = creature('Emberkin Smith', 2, 2, { abilities: [PING] });

const THREE_DROP = creature('Colorless Three Drop', 3, 3, { cost: { generic: 3 } });
const GREEN_ONE_DROP = creature('Green One Drop', 1, 1, { cost: { G: 1 } });

function mountains(count: number): { card: typeof MOUNTAIN; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller: 0 as const }));
}

function activations(state: GameState): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const found: Extract<Action, { type: 'activateAbility' }>[] = [];
  for (const option of legalActions(state)) {
    if (option.type === 'activateAbility') found.push(option);
  }
  return found;
}

/** The ability activation, spelled out, so the enumeration and the validator are asked the same thing. */
function pingWith(oid: ObjectId): Action {
  return {
    type: 'activateAbility',
    player: 0,
    oid,
    abilityIndex: 0,
    targets: [{ kind: 'player', player: 1 }],
    sacrifices: [],
  };
}

/** Three Swamps and a Forest, with whatever is stated in the payer's hand. */
function swampsAndAForest(seed: string, hand: readonly (typeof THREE_DROP)[]) {
  return scenario({
    seed,
    battlefield: [
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: SWAMP, controller: 0 },
    ],
    hands: [[...hand], []],
  });
}

const SEEDS = Array.from({ length: 20 }, (_, index) => `regression/tap/${String(index)}`);

function forestTapped(state: GameState, taps: readonly ObjectId[]): boolean {
  const forests = oidsOf(state, 'Forest');
  return taps.some((oid) => forests.includes(oid));
}

export const COST_REPLAYS = [
  replay(
    'bb0338d',
    'CR 702.10c: haste waives the tap cost summoning sickness forbids, at the enumeration and at the validator alike',
    () => {
      const hasted = scenario({
        battlefield: [{ card: HASTY_SMITH, controller: 0, summoningSick: true }, ...mountains(4)],
      });
      const smith = oidOf(hasted.state, 'Hasty Smith');

      // The pair is the assertion. `activationBlocker` refused a tap cost on any
      // summoning-sick creature with no haste check while `eligibleAttackers`
      // had carried the equivalent from the start, so a hasted creature could
      // swing and could not tap.
      expect(activations(hasted.state).map((option) => option.oid)).toContain(smith);
      expect(validateAction(hasted.state, pingWith(smith))).toBeNull();

      // Haste does not clear the flag; it waives what the flag forbids. Asking
      // the flag alone is the wrong question, and the flag is still set here —
      // which is what makes this a waiver rather than a board that never had
      // the restriction on it.
      expect(hasted.state.objects[smith]?.summoningSick).toBe(true);

      // Non-vacuity: the same board without the keyword is refused by both
      // sites, with the message that names the restriction rather than the flag.
      const sick = scenario({
        battlefield: [{ card: EMBERKIN_SMITH, controller: 0, summoningSick: true }, ...mountains(4)],
      });
      const plain = oidOf(sick.state, 'Emberkin Smith');
      expect(activations(sick.state).map((option) => option.oid)).not.toContain(plain);
      expect(validateAction(sick.state, pingWith(plain))).toBe(
        'that creature has not been under your control since your turn began',
      );
    },
  ),
  replay(
    'eb42643',
    'auto-tapping spends the lands the rest of the hand needs least, and never turns a payable cost unpayable',
    () => {
      // The playtester's example: three Swamps and a Forest, a colorless three drop
      // and a green one drop in hand. The pre-fix planner optimized the cost in
      // front of it and knew nothing about the hand, so a generic pip could eat
      // the only Forest and strand the one drop.
      const start = swampsAndAForest('regression/swamps-not-forest', [THREE_DROP, GREEN_ONE_DROP]);
      const casting = handOidOf(start.state, 0, 'Colorless Three Drop');
      const plan = planPayment(start.state, 0, mana({ generic: 3 }), casting);
      if (plan === null) throw new Error('the three drop is not payable');

      expect(forestTapped(start.state, plan.taps)).toBe(false);
      expect([...plan.taps].sort()).toEqual([...oidsOf(start.state, 'Swamp')].sort());

      // The plan is what the reduction does rather than a second opinion about
      // it: cast the three drop for real and the green one drop is still
      // castable, which is the whole of what the fix bought.
      const cast = apply(start, { type: 'castSpell', player: 0, oid: casting, targets: [] });
      expect(planPayment(cast.state, 0, mana({ G: 1 }))).not.toBeNull();

      // Non-vacuity, over twenty seeds because the tie-break among equal lands
      // is drawn from a named stream: the Forest is spared because of the card
      // in hand and not because a Forest is special. Take the green card out and
      // it is spent.
      const withGreen = SEEDS.map((seed) => swampsAndAForest(seed, [THREE_DROP, GREEN_ONE_DROP]));
      const withoutGreen = SEEDS.map((seed) => swampsAndAForest(seed, [THREE_DROP]));
      const taps = (from: ReturnType<typeof swampsAndAForest>): readonly ObjectId[] =>
        planPayment(from.state, 0, mana({ generic: 3 }), handOidOf(from.state, 0, 'Colorless Three Drop'))
          ?.taps ?? [];

      expect(withGreen.filter((from) => forestTapped(from.state, taps(from)))).toHaveLength(0);
      expect(withoutGreen.filter((from) => forestTapped(from.state, taps(from))).length).toBeGreaterThan(0);

      // Payability wins: a preference can never make a castable spell
      // uncastable, so a cost that needs every land still gets every land.
      const tight = swampsAndAForest('regression/payability-wins', [GREEN_ONE_DROP]);
      const all = planPayment(tight.state, 0, mana({ generic: 3, G: 1 }));
      expect([...(all?.taps ?? [])].sort()).toEqual([...tight.state.battlefield].sort());
    },
  ),
];
