/** Static refusal boundary for Ponder and Portent's exact reorder-or-shuffle route. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the exact reviewed reorder-or-shuffle route', () => {
  it('pins both source identities and the complete root decision shape', () => {
    expect(bridge).toContain('isReviewedRearrangeTopOfLibraryAbility');
    expect(bridge).toContain('"Ponder".equals(source.getName())');
    expect(bridge).toContain('"Portent".equals(source.getName())');
    expect(bridge).toContain('root.getApi() != ApiType.RearrangeTopOfLibrary');
    expect(bridge).toContain('!"3".equals(root.getParam("NumCards"))');
    expect(bridge).toContain('!root.hasParam("MayShuffle")');
    expect(bridge).toContain('"You".equals(root.getParam("Defined"))');
    expect(bridge).toContain('"Player".equals(root.getParam("ValidTgts"))');
  });

  it('treats the reviewed callback as closest-to-top-first and refuses drift', () => {
    // This test owns Rearrange's membership in the reordering disjunction beside Forge's own
    // ReorderZone; a later set can add its own reviewed reorder between the two.
    expect(bridge).toMatch(
      /source\.getApi\(\) == ApiType\.ReorderZone\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedRearrange/u,
    );
    expect(bridge).toContain(
      'Forge reached RearrangeTopOfLibrary ordering outside its exact reviewed profile',
    );
    expect(bridge).toContain(
      'Forge reached RearrangeTopOfLibrary confirmation outside its exact reviewed profile',
    );
    expect(bridge).toContain(
      'return session.confirmAction(\n                    getPlayer(), ability, mode, message, options, cardToShow, params);',
    );
    expect(bridge).toContain('"confirm-library-shuffle-after-order"');
  });
});
