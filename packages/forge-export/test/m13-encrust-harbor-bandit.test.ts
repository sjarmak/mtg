/** M13 Encrust and Harbor Bandit against Forge's checked-in scripts. */
import { describe, expect, it } from 'vitest';
import { legalTargetsFor, parseCard } from '@mtg/dsl';
import { FORGE_EFFECTS } from '@mtg/forge-export';
import { mustTranspile } from './helpers';

const ENCRUST = parseCard({
  kind: 'enchantment',
  id: 'm13-encrust',
  name: 'Encrust',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 49 },
  manaCost: { generic: 1, U: 2 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'artifactOrCreature',
    modifications: [{ kind: 'doesNotUntap' }, { kind: 'cantActivateAbilities' }],
  },
});

const HARBOR_BANDIT = parseCard({
  kind: 'creature',
  id: 'm13-harbor-bandit',
  name: 'Harbor Bandit',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 95 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  subtypes: ['Human', 'Rogue'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Island', atLeast: 1 },
    },
    {
      kind: 'activated',
      cost: { mana: { generic: 1, U: 1 }, tapSelf: false },
      effects: [{ kind: 'cantBeBlockedThisTurn', target: { kind: 'selfCreature' } }],
    },
  ],
});

describe('Encrust in Forge', () => {
  it('writes the checked-in union host and both attached-permanent locks', () => {
    const script = mustTranspile(ENCRUST);
    expect(script).toContain('K:Enchant:Creature,Artifact:artifact or creature');
    expect(script).toContain(
      "R:Event$ Untap | ActiveZones$ Battlefield | ValidCard$ Card.EnchantedBy | ValidStepTurnToController$ You | Layer$ CantHappen | Description$ Enchanted permanent doesn't untap during its controller's untap step and its activated abilities can't be activated.",
    );
    expect(script).toContain(
      "S:Mode$ CantBeActivated | ValidCard$ Card.EnchantedBy | Secondary$ True | Description$ Enchanted permanent doesn't untap during its controller's untap step and its activated abilities can't be activated.",
    );
  });
});

describe('Harbor Bandit in Forge', () => {
  it('writes the source-retained Effect plus its checked-in unblockable static', () => {
    const script = mustTranspile(HARBOR_BANDIT);
    expect(script).toContain(
      'A:AB$ Effect | Cost$ 1 U | RememberObjects$ Self | ExileOnMoved$ Battlefield | StaticAbilities$ Unblockable',
    );
    expect(script).toContain(
      "SVar:Unblockable:Mode$ CantBlockBy | ValidAttacker$ Card.IsRemembered | Description$ EFFECTSOURCE can't be blocked this turn.",
    );
  });

  /**
   * Both tables in one order, which is what makes this a stronger statement than
   * `conformance.test.ts`'s sorted parity check: that one would pass on two
   * tables that agree about membership and disagree about which entry is the
   * generatable one. `targetCreature` first is the generatable half; the two
   * after it are hand-authored (`dsl/src/validate/effects.ts`), and
   * `targetCreatureYouControl` is the newer of them, admitted by `0ad9324f`
   * with the turn-scoped combat rules. The Forge writer still rejects every
   * member but `selfCreature` — see `../src/effect-script.ts` — because a
   * *targeted* turn-scoped "can't be blocked" has no corpus-sourced spelling
   * here. A legality table is what a card may say, not what this exporter can
   * write down.
   */
  it('keeps Forge and DSL target tables in agreement about the retained source', () => {
    const admitted = ['targetCreature', 'targetCreatureYouControl', 'selfCreature', 'thatCreature'];
    expect([...FORGE_EFFECTS.cantBeBlockedThisTurn.targets]).toEqual(admitted);
    expect([...legalTargetsFor('cantBeBlockedThisTurn')]).toEqual(admitted);
  });
});
