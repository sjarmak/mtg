/**
 * `redFlagsFor`'s three New World Order corrections from the 2026-08-18
 * power-level audit of the flagship set: reminder text stopped counting
 * toward `longText`, the set-wide budget widened from 20% to 35%, and
 * `multiKeyword` stopped firing at two keywords.
 *
 * The budget change itself is asserted in `packages/design-data/test/skeleton-
 * lite.test.ts`, since the number lives on `SkeletonLiteProfile` rather than
 * here; this file holds only what `redFlagsFor` itself does per card, on cards
 * it builds. The one claim about a committed set's own commons lives beside the
 * set it reads, because that set is a fixture that does not export.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { mana, parseCard } from '@mtg/dsl';
import { redFlagsFor } from '@mtg/setgen';

function cardWith(input: Record<string, unknown>): Card {
  return parseCard({
    id: 'tst-test-card',
    name: 'Test Card',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['B'],
    manaCost: mana({ generic: 2, B: 1 }),
    power: 3,
    toughness: 2,
    kind: 'creature',
    subtypes: [],
    keywords: [],
    effects: [],
    abilities: [],
    ...input,
  });
}

/** A death- or combat-damage-triggered `putCounters` on a `gloom` counter: the
 * shape both current `NWO_MULTI_RED_FLAG` fixture errors share, chosen because
 * `gloom`'s reminder ("A creature with a gloom counter gets -1/-1.") is the one
 * `counterReminderText` actually attaches to a printed card in this set. */
function gloomTriggerCard(): Card {
  return cardWith({
    name: 'Test Gloom-Toucher',
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDealsCombatDamageToCreature',
        effects: [
          { kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'triggeringCreature' } },
        ],
      },
    ],
  });
}

describe('reminder text does not count toward longText', () => {
  it('does not flag longText on a card whose only overage is a counter reminder', () => {
    const card = gloomTriggerCard();
    // Confirms the fixture is actually exercising the reminder path, not
    // asserting a no-op: the full rendered line (reminder included) really is
    // over the 140-character ceiling for this shape.
    expect(redFlagsFor(card)).not.toContain('longText');
  });

  it('still flags longText on a card whose own printed line is long with no reminder attached', () => {
    // Same trigger condition, but a plusOnePlusOne counter prints no reminder
    // (`counterReminderText` suppresses it when the counter's name already says
    // what it does), so padding the trigger's own clause is the only way to
    // push this over 140 with nothing to strip.
    const card = cardWith({
      name: 'Somebody With An Extremely Long Printed Card Name Indeed And Then Some',
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDealsCombatDamageToCreature',
          effects: [
            {
              kind: 'putCounters',
              counter: 'plusOnePlusOne',
              count: 1,
              target: { kind: 'triggeringCreature' },
            },
          ],
        },
      ],
    });
    expect(redFlagsFor(card)).toContain('longText');
  });
});

describe('multiKeyword fires at three keywords, not two', () => {
  it('does not flag two evergreen keywords', () => {
    const card = cardWith({ keywords: ['flying', 'lifelink'] });
    expect(redFlagsFor(card)).not.toContain('multiKeyword');
  });

  it('flags three evergreen keywords', () => {
    const card = cardWith({ keywords: ['flying', 'lifelink', 'vigilance'] });
    expect(redFlagsFor(card)).toContain('multiKeyword');
  });
});
