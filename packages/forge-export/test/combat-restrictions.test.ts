/**
 * Forge parity for the CR 508/509 combat rules a creature prints on itself.
 *
 * Every line here is read off a shipped script in Forge 2.0.15-SNAPSHOT's
 * `res/cardsfolder`, because the mode a combat rule is written under and the
 * key that mode reads its creature from are the two things a mapping can get
 * wrong while still producing a line Forge parses. `ValidCard$` on a
 * `CantBlockBy` restricts no attacker, and `Mode$ MustBlock` names the creature
 * that must block rather than the one that must be blocked.
 *
 * Juggernaut is the whole shape at once and the reason it opens the file: it is
 * `attacksEachCombatIfAble` plus `cantBeBlockedBySubtype`, and master writes
 * both lines. One deviation, and it is the restriction rather than the
 * grammar -- master writes `ValidAttacker$ Creature.Self` where we write
 * `Card.Self`. Both are shipped spellings of "this creature" in that mode (196
 * against 38), and ours is the one `FORGE_STATIC_AFFECTED` maps `scope: 'self'`
 * to for every static on every card.
 */
import { describe, expect, it } from 'vitest';
import type { Ability } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

function scriptLines(name: string, abilities: readonly Ability[]): readonly string[] {
  const card = parseCard({
    kind: 'creature',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    colors: [],
    manaCost: { generic: 4 },
    power: 5,
    toughness: 3,
    subtypes: ['Juggernaut'],
    keywords: [],
    abilities,
  });
  const result = transpileCard(card);
  expect(result.ok, JSON.stringify(abilities)).toBe(true);
  return result.ok ? result.script.text.split('\n') : [];
}

type StaticAbility = Extract<Ability, { kind: 'static' }>;

function selfStatic(modification: StaticAbility['modification']): StaticAbility {
  return { kind: 'static', scope: 'self', subtype: null, modification };
}

describe('combat restrictions a creature prints on itself', () => {
  it('writes both of juggernaut.txt lines under their own modes', () => {
    const lines = scriptLines('Juggernaut', [
      selfStatic({ kind: 'attacksEachCombatIfAble' }),
      selfStatic({ kind: 'cantBeBlockedBySubtype', subtype: 'Wall' }),
    ]);
    expect(lines).toContain(
      'S:Mode$ MustAttack | ValidCreature$ Card.Self | Description$ CARDNAME attacks each combat if able.',
    );
    expect(lines).toContain(
      "S:Mode$ CantBlockBy | ValidAttacker$ Card.Self | ValidBlocker$ Creature.Wall | Description$ CARDNAME can't be blocked by Walls.",
    );
  });

  it('puts the blocker in ValidBlocker and the keyword it lacks in ValidAttacker', () => {
    // 55 shipped scripts write "can block only creatures with flying" this way,
    // the restriction on the attacker rather than on the blocker: what the
    // creature may not block is everything without the keyword.
    const lines = scriptLines('Skyward Sentry', [
      selfStatic({ kind: 'blockOnlyCreaturesWithKeyword', keyword: 'flying' }),
    ]);
    expect(lines).toContain(
      'S:Mode$ CantBlockBy | ValidAttacker$ Creature.withoutFlying | ValidBlocker$ Card.Self | Description$ CARDNAME can block only creatures with flying.',
    );
  });

  it('writes the blocking requirement as a hidden keyword rather than MustBlock', () => {
    // `stone_tongue_basilisk.txt`, minus its threshold condition. Forge's
    // `Mode$ MustBlock` is the near-miss: it names the creature that must
    // block, and CR 509.1c names the creature that must be blocked.
    const lines = scriptLines('Lure Beast', [selfStatic({ kind: 'mustBeBlockedIfAble' })]);
    expect(lines.filter((line) => line.startsWith('S:'))).toEqual([
      'S:Mode$ Continuous | Affected$ Card.Self | AddHiddenKeyword$ All creatures able to block CARDNAME do so. | Description$ All creatures able to block this creature do so.',
    ]);
  });

  it('writes an unblockable creature as the mode that restricts its blockers', () => {
    const lines = scriptLines('Slipstream Eel', [selfStatic({ kind: 'cantBeBlocked' })]);
    expect(lines).toContain(
      "S:Mode$ CantBlockBy | ValidAttacker$ Card.Self | Description$ CARDNAME can't be blocked.",
    );
  });
});

describe('combat restrictions scoped past the card printing them', () => {
  it('carries the group restriction into the mode instead of Card.Self', () => {
    // The point of the generalization: before this, the mode line hardcoded
    // `Card.Self` and only a self-scoped ability could reach it at all.
    // `Mode$ CantAttack | ValidCard$ Creature.YouCtrl` is Forge's own spelling
    // of a group attack restriction on a plain static.
    const lines = scriptLines('Peace Keeper', [
      { kind: 'static', scope: 'creaturesYouControl', subtype: null, modification: { kind: 'cantAttack' } },
    ]);
    expect(lines).toContain(
      "S:Mode$ CantAttack | ValidCard$ Creature.YouCtrl | Description$ Creatures you control can't attack.",
    );
  });

  it('keeps the subtype and the other-creatures qualifier in the restriction', () => {
    const lines = scriptLines('Goblin Marshal', [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Goblin',
        modification: { kind: 'cantBlock' },
      },
    ]);
    expect(lines).toContain(
      "S:Mode$ CantBlock | ValidCard$ Creature.Other+YouCtrl+Goblin | Description$ Other Goblin creatures you control can't block.",
    );
  });
});
