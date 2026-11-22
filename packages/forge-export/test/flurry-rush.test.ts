/**
 * The two `T:` lines Forge writes for a block that could go either way.
 *
 * `selfBlocksOrIsBlockedByGreaterPower` is one DSL condition over two events —
 * this creature blocked something bigger, or something bigger blocked it — and
 * Forge spells that union as two trigger lines rather than one. Arrogant
 * Bloodlord is the shipped card with the identical printed sentence at a
 * different comparator ("Whenever CARDNAME blocks or becomes blocked by a
 * creature with power 1 or less"), and its script is what these expectations
 * are modeled on:
 *
 *   T:Mode$ AttackerBlockedByCreature | ValidCard$ Creature.powerLE1 | ValidBlocker$ Card.Self | …
 *   T:Mode$ AttackerBlockedByCreature | ValidCard$ Card.Self | ValidBlocker$ Creature.powerLE1 | … | Secondary$ True | …
 *
 * Three more shipped cards fill in the rest: Ashmouth Hound gives the two lines
 * two bodies aimed at `TriggeredAttackerLKICopy` and `TriggeredBlockerLKICopy`,
 * Rangers of Ithilien gives the power comparison as `Creature.powerLTZ` over
 * `SVar:Z:Count$CardPower`, and Chub Toad gives the case these lines share one
 * body because neither half retains a creature.
 *
 * `TriggerDescription$` carries the word *and* its reminder, because the word
 * alone is what Forge would show on the stack and it states nothing (`mtg-f4ay`).
 * `frenzy_sliver.txt` is the shipped shape being copied: a numbered word, a
 * space, the sentence in parentheses, no period between them.
 *
 * Unverified against a booted Forge, like every mapping in this package, and
 * `mtg-17a` is that check. What this suite pins is that the export stopped
 * being a *different card*: before `mtg-uisd` the row wrote `Mode$ Blocks |
 * ValidCard$ Card.Self`, which fires on every block rather than only on blocks
 * against something bigger, never fires on the attacking half, and aims its
 * body at a `TriggeredTarget` that mode does not supply.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { flurryRushAbility, gloomAbility, parseCard } from '@mtg/dsl';
import { mustTranspile, slugId } from './helpers';

/** A 2/2 carrying one hand-authored ability on the two-halves-of-a-block condition. */
function blocker(name: string, ability: unknown): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    power: 2,
    toughness: 2,
    keywords: [],
    abilities: [ability],
  } as unknown as CardInput);
}

/** Every `T:` line of a transpiled card, in emission order. */
function triggerLines(card: Card): readonly string[] {
  return mustTranspile(card)
    .split('\n')
    .filter((line) => line.startsWith('T:'));
}

/** Every `SVar:` line of a transpiled card, in emission order. */
function svarLines(card: Card): readonly string[] {
  return mustTranspile(card)
    .split('\n')
    .filter((line) => line.startsWith('SVar:'));
}

describe('Flurry rush Forge export', () => {
  it('writes the blocking half with the source in the blocker slot', () => {
    expect(triggerLines(blocker('Test Flurry Blocker', flurryRushAbility(2)))[0]).toBe(
      'T:Mode$ AttackerBlockedByCreature | ValidCard$ Creature.powerGTZ | ValidBlocker$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ Flurry rush 2 (Whenever this creature blocks or becomes blocked by a creature with greater power, this creature deals 2 damage to that creature.)',
    );
  });

  it('writes the blocked half with the source in the attacker slot, marked secondary', () => {
    expect(triggerLines(blocker('Test Flurry Attacker', flurryRushAbility(2)))[1]).toBe(
      'T:Mode$ AttackerBlockedByCreature | ValidCard$ Card.Self | ValidBlocker$ Creature.powerGTZ | Execute$ Trig1Line2Effect1 | Secondary$ True | TriggerDescription$ Flurry rush 2 (Whenever this creature blocks or becomes blocked by a creature with greater power, this creature deals 2 damage to that creature.)',
    );
  });

  it('emits exactly the two lines, so neither half of the block is dropped', () => {
    expect(triggerLines(blocker('Test Flurry Pair', flurryRushAbility(1)))).toHaveLength(2);
  });

  it('aims each line at the creature its own half retained', () => {
    expect(svarLines(blocker('Test Flurry Referents', flurryRushAbility(3)))).toEqual([
      'SVar:Trig1Effect1:DB$ DealDamage | Defined$ TriggeredAttackerLKICopy | NumDmg$ 3',
      'SVar:Trig1Line2Effect1:DB$ DealDamage | Defined$ TriggeredBlockerLKICopy | NumDmg$ 3',
      'SVar:Z:Count$CardPower',
    ]);
  });

  it('never chains one half into the other, which would damage both creatures', () => {
    for (const line of svarLines(blocker('Test Flurry Unchained', flurryRushAbility(2)))) {
      expect(line).not.toContain('SubAbility$');
    }
  });

  it('compares power against the source rather than against a constant', () => {
    const svars = svarLines(blocker('Test Flurry Power', flurryRushAbility(2)));
    expect(svars.filter((line) => line === 'SVar:Z:Count$CardPower')).toHaveLength(1);
    for (const line of triggerLines(blocker('Test Flurry Power Two', flurryRushAbility(2)))) {
      expect(line).toContain('powerGTZ');
    }
  });

  it('shares one body across both lines when neither half retains a creature', () => {
    // Chub Toad's shape: the two lines run the same `Execute$` because the
    // effect names the source, so there is nothing for a second body to aim
    // differently. `Trig1Line2Effect1` must not exist here.
    const card = blocker('Test Flurry Selfish', {
      kind: 'triggered',
      condition: 'selfBlocksOrIsBlockedByGreaterPower',
      effects: [{ kind: 'pumpUntilEndOfTurn', target: { kind: 'selfCreature' }, power: 2, toughness: 2 }],
    });
    const executes = triggerLines(card).map((line) => /Execute\$ (\w+)/.exec(line)?.[1]);
    expect(executes).toHaveLength(2);
    expect(executes[0]).toBe(executes[1]);
    expect(svarLines(card).some((line) => line.startsWith('SVar:Trig1Line2'))).toBe(false);
  });
});

describe('an ability word on the stack', () => {
  it('states what the word does, because Forge shows only this string', () => {
    const line = triggerLines(blocker('Test Flurry Reminder', flurryRushAbility(1)))[0] ?? '';
    expect(line).toContain(
      'TriggerDescription$ Flurry rush 1 (Whenever this creature blocks or becomes blocked by a creature with greater power, this creature deals 1 damage to that creature.)',
    );
  });

  it('carries the reminder for every ability word, not just this one', () => {
    const card = parseCard({
      kind: 'creature',
      id: slugId('Test Gloom Reminder'),
      name: 'Test Gloom Reminder',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 1, B: 1 },
      colors: ['B'],
      power: 2,
      toughness: 2,
      keywords: [],
      abilities: [gloomAbility(1)],
    } as unknown as CardInput);
    expect(triggerLines(card)[0]).toContain(
      'TriggerDescription$ Gloom 1 (Whenever this creature deals combat damage to a creature, put a gloom counter on that creature. A creature with a gloom counter gets -1/-1.)',
    );
  });

  it('leaves a spelled-out ability alone, so only a word gets a reminder', () => {
    const spelled = blocker('Test Flurry Spelled', {
      kind: 'triggered',
      condition: 'selfBlocksOrIsBlockedByGreaterPower',
      effects: [{ kind: 'pumpUntilEndOfTurn', target: { kind: 'selfCreature' }, power: 2, toughness: 2 }],
    });
    for (const line of triggerLines(spelled)) expect(line).not.toContain('(');
  });
});
