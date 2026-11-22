/**
 * Two rows that each name their own `SVar:` may pick the same name.
 *
 * Forge reads one definition per name and enforces whichever it read last, so a
 * card carrying both definitions boots and then plays a rule nobody wrote. That
 * is worse than a refusal, which is why the card writer refuses rather than
 * renaming: a rename would put the surviving row off `res/cardsfolder`, where
 * `RPrevent` is what 89 shipped prevention scripts call theirs and none defines
 * it twice.
 *
 * The shape is reachable today: prevention on a target and prevention on you
 * and your creatures are separate DSL effects that compose onto one instant.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CARD = parseCard({
  kind: 'instant',
  id: 'tst-double-prevent',
  name: 'Double Prevent',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  colors: ['W'],
  manaCost: { generic: 2, W: 1 },
  effects: [
    { kind: 'preventAllDamageToTarget', target: { kind: 'targetCreature' } },
    { kind: 'preventAllDamageToYouAndCreaturesYouControl' },
  ],
});

const SINGLE = parseCard({
  kind: 'instant',
  id: 'tst-single-prevent',
  name: 'Single Prevent',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  colors: ['W'],
  manaCost: { generic: 1, W: 1 },
  effects: [{ kind: 'preventAllDamageToTarget', target: { kind: 'targetCreature' } }],
});

describe('colliding Forge SVar definitions', () => {
  it('refuses a card whose two preventions both define RPrevent', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const collision = result.rejections.find((item) => item.code === 'COLLIDING_SVAR_DEFINITION');
    expect(collision).toBeDefined();
    expect(collision?.cardId).toBe('tst-double-prevent');
    expect(collision?.path).toBe('effects[1]');
    expect(collision?.message).toContain('"RPrevent"');
  });

  it('names both definitions, so the refusal says which rows disagreed', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.rejections[0]?.message ?? '';
    expect(message).toContain('ValidTarget$ Card.IsRemembered');
    expect(message).toContain('ValidTarget$ You,Creature.YouCtrl');
  });

  it('leaves one prevention alone', () => {
    const result = transpileCard(SINGLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const definitions = result.script.text.split('\n').filter((line) => line.startsWith('SVar:RPrevent:'));
    expect(definitions).toHaveLength(1);
  });
});
