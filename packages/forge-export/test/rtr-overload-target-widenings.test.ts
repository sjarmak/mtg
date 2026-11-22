/**
 * The five target entries the Overload lane added, all five exported.
 *
 * `mtg-wzzk`. Two DSL commits widened four effect rows without this package
 * noticing: `9c17ccd2` gave `dealDamage` and `pumpUntilEndOfTurn` the kind
 * `targetCreatureYouDontControl`, and `0ad9324f` gave `pumpUntilEndOfTurn`
 * and `cantBeBlockedThisTurn` the kind `targetCreatureYouControl` and
 * `returnToHand` the kind `targetNonlandPermanentOpponentControls`. Each
 * arrived for one RTR card's *ordinary* half: Street Spasm (#105), Downsize
 * (#41), Teleportal (#201) and Cyclonic Rift (#35). The overload halves are
 * `noTarget` plus a scope and reach none of these entries, so the fixtures
 * below isolate the ordinary selectors. `overload.test.ts` separately proves
 * that each complete card exports its native Overload keyword and ordinary
 * ability together.
 *
 * `conformance.test.ts`'s drift alarm compares the two tables sorted, so it
 * says the rows disagree and nothing about what the disagreement costs. This
 * file spends the entries: `vocabulary-map.ts` already spelled all three
 * selectors, so the fix was a table edit, and a table edit that admits a target
 * nothing transpiles is the same silent narrowing the alarm exists to catch.
 *
 * The fifth entry was legal and unwritable until `mtg-ij03`: the writer refused
 * a *targeted* turn-scoped "can't be blocked" for every kind, including the one
 * it admitted, because no card in the corpus this package could read spelled
 * one. `infiltrate.txt` spells it, so Teleportal now exports whole and the
 * fourth test below states the line rather than the refusal. Legality and
 * writability were different questions here for one commit; the entry was right
 * either way, which was the original point of listing it.
 *
 * What none of these duplicate is the Overload casting-mode assertion itself;
 * that belongs to the complete-card suite rather than these effect-row probes.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { legalTargetsFor, parseCard } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { mustTranspile } from './helpers';

/**
 * The card fixtures, shaped from `packages/kernel/test/overload.test.ts` with
 * the overload profile dropped for the reason the header gives.
 *
 * Copied rather than imported: that file is the kernel's own suite and its
 * fixtures are private to it, and an export boundary opened so two test files
 * can share four literals is a dependency this package should not carry. They
 * go through `parseCard` here for the reason every fixture in this package
 * does, so a shape the DSL stops accepting fails loudly.
 */
function card(input: unknown): Card {
  return parseCard(input as CardInput);
}

/** "Target creature you don't control gets -4/-0 until end of turn." */
const DOWNSIZE = card({
  kind: 'instant',
  id: 'rtr-41-downsize-forge',
  name: 'Downsize',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 41 },
  colors: ['U'],
  manaCost: { U: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: -4,
      toughness: 0,
      target: { kind: 'targetCreatureYouDontControl' },
    },
  ],
});

/** "Street Spasm deals X damage to target creature you don't control without flying." */
const STREET_SPASM = card({
  kind: 'instant',
  id: 'rtr-105-street-spasm-forge',
  name: 'Street Spasm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 105 },
  colors: ['R'],
  manaCost: { R: 1, hasX: true },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: {
        kind: 'targetCreatureYouDontControl',
        restriction: { kind: 'withoutKeyword', keyword: 'flying' },
      },
    },
  ],
});

/** "Return target nonland permanent an opponent controls to its owner's hand." */
const CYCLONIC_RIFT = card({
  kind: 'instant',
  id: 'rtr-35-cyclonic-rift-forge',
  name: 'Cyclonic Rift',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 35 },
  colors: ['U'],
  manaCost: { generic: 1, U: 1 },
  effects: [{ kind: 'returnToHand', target: { kind: 'targetNonlandPermanentOpponentControls' } }],
});

/** "Target creature you control gets +1/+0 and can't be blocked this turn." */
const TELEPORTAL = card({
  kind: 'sorcery',
  id: 'rtr-201-teleportal-forge',
  name: 'Teleportal',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 201 },
  colors: ['U', 'R'],
  manaCost: { generic: 1, U: 1, R: 1 },
  effects: [
    { kind: 'pumpUntilEndOfTurn', power: 1, toughness: 0, target: { kind: 'targetCreatureYouControl' } },
    { kind: 'cantBeBlockedThisTurn', target: { kind: 'targetCreatureYouControl' } },
  ],
});

describe('the three widenings the writer can spell', () => {
  it('pumps a creature the caster does not control, as Downsize does', () => {
    expect(mustTranspile(DOWNSIZE)).toContain(
      'A:SP$ Pump | ValidTgts$ Creature.YouDontCtrl | NumAtt$ -4 | NumDef$ +0',
    );
  });

  /**
   * The restriction rides the same selector, which is the one thing a table
   * entry cannot promise on its own: `forgeRestrictedTarget` has to pick the
   * installed Street Spasm order here: `withoutFlying` narrows the creature
   * before the controller qualifier is appended.
   */
  it('burns one, with the flying restriction appended by the plus separator', () => {
    expect(mustTranspile(STREET_SPASM)).toContain(
      'A:SP$ DealDamage | ValidTgts$ Creature.withoutFlying+YouDontCtrl | NumDmg$ X',
    );
  });

  it("bounces a nonland permanent an opponent controls, as Cyclonic Rift's ordinary half does", () => {
    expect(mustTranspile(CYCLONIC_RIFT)).toContain(
      'A:SP$ ChangeZone | ValidTgts$ Permanent.nonLand+OppCtrl | Origin$ Battlefield | Destination$ Hand',
    );
  });

  it("pumps a creature the caster controls, as Teleportal's first half does", () => {
    expect(mustTranspile(TELEPORTAL)).toContain(
      'A:SP$ Pump | ValidTgts$ Creature.YouCtrl | NumAtt$ +1 | NumDef$ +0',
    );
  });
});

describe('the fourth widening, which `infiltrate.txt` made writable', () => {
  it('exports Teleportal whole, both effects on one chain', () => {
    const script = mustTranspile(TELEPORTAL);
    expect(script).toContain('A:SP$ Pump | ValidTgts$ Creature.YouCtrl | NumAtt$ +1 | NumDef$ +0');
    expect(script).toContain(
      'SVar:DBEffect1:DB$ Effect | ValidTgts$ Creature.YouCtrl | RememberObjects$ Targeted | ' +
        'ExileOnMoved$ Battlefield | StaticAbilities$ Unblockable',
    );
    expect(script).toContain(
      'SVar:Unblockable:Mode$ CantBlockBy | ValidAttacker$ Card.IsRemembered | ' +
        "Description$ This creature can't be blocked this turn.",
    );
  });

  /**
   * The generatable kind writes the same line, so admitting
   * `targetCreatureYouControl` widened a table and changed no verdict then, and
   * changes none now: the two kinds differ in the `ValidTgts$` the targeting
   * builds and in nothing the row itself decides.
   */
  it('writes the generatable kind identically but for the selector', () => {
    const withTargetCreature = card({
      ...(TELEPORTAL as unknown as Record<string, unknown>),
      id: 'rtr-201-teleportal-any-creature-forge',
      effects: [{ kind: 'cantBeBlockedThisTurn', target: { kind: 'targetCreature' } }],
    });
    expect(mustTranspile(withTargetCreature)).toContain(
      'A:SP$ Effect | ValidTgts$ Creature | RememberObjects$ Targeted | ' +
        'ExileOnMoved$ Battlefield | StaticAbilities$ Unblockable',
    );
  });
});

/**
 * Membership in both tables, per entry rather than in bulk.
 *
 * `conformance.test.ts` already checks every kind's row against the DSL, so
 * this adds nothing about drift; what it adds is a name. A future edit that
 * drops one of these five is a card that stops exporting, and the failing test
 * says which card.
 */
describe('the five entries, in both legality tables', () => {
  const WIDENINGS = [
    ['dealDamage', 'targetCreatureYouDontControl', 'Street Spasm'],
    ['pumpUntilEndOfTurn', 'targetCreatureYouDontControl', 'Downsize'],
    ['pumpUntilEndOfTurn', 'targetCreatureYouControl', 'Teleportal'],
    ['returnToHand', 'targetNonlandPermanentOpponentControls', 'Cyclonic Rift'],
    ['cantBeBlockedThisTurn', 'targetCreatureYouControl', 'Teleportal'],
  ] as const;

  for (const [effect, target, card_] of WIDENINGS) {
    it(`lists ${target} on ${effect}, for ${card_}`, () => {
      expect([...FORGE_EFFECTS[effect].targets]).toContain(target);
      expect([...legalTargetsFor(effect)]).toContain(target);
    });
  }
});
