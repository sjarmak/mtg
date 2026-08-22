/**
 * What the third retained referent exports as, and what the Trisigil counter
 * does not (`mtg-rji`).
 *
 * `selfPermanent` is `selfCreature` with the creature word taken out — the
 * ability's own source (CR 115.6a), reached from a card that need not be a
 * creature — so it takes the same escape from real targeting that
 * `self-creature-target.test.ts` documents: `Defined$ Self`, Forge's generic
 * reference to the object whose card script is running, and no `ValidTgts$`
 * clause at all. Unverified against a booted Forge, for the reason every row
 * in `vocabulary-map.ts` states: `mtg-17a` is that check.
 *
 * The counter is the half that does *not* cross, and the second describe block
 * pins the refusal rather than a guess. A `trisigil` counter declares no
 * modification at all, so `FORGE_COUNTER_TYPES` has nothing to decompose it
 * into — Forge ships no counter type meaning "a marker with no rules
 * consequence of its own", and `loyalty` is already `null` here for that
 * reason. The transpiler refuses the card and names the counter, which is the
 * honest answer; a Trisigil exported as `P1P1` would be a card that plays one
 * way in the kernel and another in Forge, and that is the single failure this
 * transpiler exists to avoid.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { legalTargetsFor, parseCard } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { transpileCard } from '../src/transpile';
import { FORGE_COUNTER_TYPES, FORGE_VALID_TARGETS } from '../src/vocabulary-map';
import { mustTranspile, slugId } from './helpers';

/** An artifact that accrues its own counter at upkeep, the Trisigil cycle's shape. */
function accruingRelic(name: string, counter: 'plusOnePlusOne' | 'trisigil'): Card {
  return parseCard({
    kind: 'artifact',
    id: slugId(name),
    name,
    rarity: 'mythic',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 3 },
    supertypes: ['legendary'],
    subtypes: ['Trisigil'],
    abilities: [
      {
        kind: 'triggered',
        condition: 'beginningOfYourUpkeep',
        effects: [{ kind: 'putCounters', counter, count: 1, target: { kind: 'selfPermanent' } }],
      },
    ],
  });
}

describe("an artifact's ability putting a counter on the artifact", () => {
  const script = mustTranspile(accruingRelic('Probe Relic', 'plusOnePlusOne'));

  it('names the source with Defined$ Self, not a ValidTgts clause', () => {
    expect(script).toContain('Defined$ Self');
    expect(script).not.toContain('ValidTgts$');
  });

  it('still writes the counter-placing API and its counter type', () => {
    expect(script).toContain('PutCounter');
    expect(script).toContain('P1P1');
  });
});

describe('the two legality tables, which must agree about this kind', () => {
  it('lists the retained referent on the one effect row that hand-authors it', () => {
    expect([...FORGE_EFFECTS.putCounters.targets]).toContain('selfPermanent');
    expect([...legalTargetsFor('putCounters')]).toContain('selfPermanent');
  });

  it('carries a row in the target map so the record stays total over TargetKind', () => {
    // Never read: `targetParams` answers this kind before the map is consulted.
    expect(FORGE_VALID_TARGETS.selfPermanent).toBeNull();
  });
});

describe('the Trisigil counter, which Forge has no type for', () => {
  it('maps to nothing, the way a marker counter must', () => {
    expect(FORGE_COUNTER_TYPES.trisigil).toBeNull();
  });

  it('is refused by name rather than exported as something it is not', () => {
    const result = transpileCard(accruingRelic('Trisigil of Power', 'trisigil'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((found) => found.code)).toContain('UNMAPPED_EFFECT_KIND');
    expect(result.rejections.map((found) => found.message).join(' ')).toContain('trisigil');
  });
});
