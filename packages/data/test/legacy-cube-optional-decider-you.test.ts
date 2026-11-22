import { describe, expect, it } from 'vitest';
import { legacyCubeOptionalDeciderYouRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const script = (...lines: readonly string[]): Uint8Array =>
  new TextEncoder().encode(['Name:Optional Decider Test', 'ManaCost:2 W', ...lines].join('\n'));

const trigger = (decider: string): string =>
  `T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | OptionalDecider$ ${decider} | Execute$ Search`;
const search =
  'SVar:Search:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Creature.toughnessLE2 | ChangeNum$ 1';

describe('Legacy Cube OptionalDecider$ You boundary', () => {
  it('admits an exact You decider when no other blocker remains', () => {
    expect(legacyCubeOptionalDeciderYouRefusals(script(trigger('You'), search), inventory)).toEqual([]);
  });

  it('requires an OptionalDecider marker', () => {
    expect(legacyCubeOptionalDeciderYouRefusals(script(search), inventory)).toContain(
      'missing OptionalDecider$ You marker',
    );
  });

  it.each(['ParentTargetedController', 'TriggeredSourceController'])(
    'refuses foreign decider %s',
    (decider) => {
      expect(legacyCubeOptionalDeciderYouRefusals(script(trigger(decider), search), inventory)).toContain(
        'foreign optional decider',
      );
    },
  );

  it('refuses a second foreign decider even when the first is You', () => {
    expect(
      legacyCubeOptionalDeciderYouRefusals(
        script(trigger('You'), search, trigger('ParentTargetedController')),
        inventory,
      ),
    ).toContain('foreign optional decider');
  });

  it.each([
    ['generated object', 'A:SP$ Token | TokenScript$ w_1_1_soldier'],
    ['multiple targets', 'A:SP$ Destroy | ValidTgts$ Creature | TargetMax$ 2'],
    ['alternate cost', 'K:Buyback:2'],
  ])('keeps an independent %s blocker', (_label, line) => {
    expect(legacyCubeOptionalDeciderYouRefusals(script(trigger('You'), search, line), inventory)).not.toEqual(
      [],
    );
  });
});
