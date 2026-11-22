import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge proves Expressive Iteration destination choices', () => {
  it('pins the complete three-step Dig chain before naming the destination', () => {
    expect(bridge).toContain('isReviewedExpressiveIterationChoice');
    expect(bridge).toContain('"Expressive Iteration".equals(source.getName())');
    expect(bridge).toContain('root.getApi() != ApiType.Dig');
    expect(bridge).toContain('!"3".equals(root.getParam("DigNum"))');
    expect(bridge).toContain('!"2".equals(toBottom.getParam("DigNum"))');
    expect(bridge).toContain('!"Library".equals(toBottom.getParam("DestinationZone"))');
    expect(bridge).toContain('!"Exile".equals(toExile.getParam("DestinationZone"))');
    expect(bridge).toContain('destination.equals("hand")');
    expect(bridge).toContain('delayedReveal.getZone().contains(ZoneType.Library)');
    expect(bridge).toContain('if (target.object != null) encoded.put("object", target.object)');
  });

  it('emits exact destination kinds and routes no other entity selection through them', () => {
    expect(bridge).toContain('"entity-selection-to-hand"');
    expect(bridge).toContain('"entity-selection-to-library-bottom"');
    expect(bridge).toContain('"entity-selection-to-exile-playable"');
    expect(bridge).toContain('outside reviewed-expressive-iteration-choice-v1');
  });
});
