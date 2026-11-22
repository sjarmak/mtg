/** Static lock for Path to Exile's exact target-controller search callback. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('reviewed Path to Exile optional library search', () => {
  it('owns only the exact root-exile and target-controller subability topology', () => {
    expect(bridge).toContain('boolean reviewedPathToExileSearch =');
    expect(bridge).toContain('"Path to Exile".equals(source.getName())');
    expect(bridge).toContain('"Creature".equals(root.getParam("ValidTgts"))');
    expect(bridge).toContain('"Battlefield".equals(root.getParam("Origin"))');
    expect(bridge).toContain('"Exile".equals(root.getParam("Destination"))');
    expect(bridge).toContain('ability.getParent() == root');
    expect(bridge).toContain('root.getSubAbility() == ability');
    expect(bridge).toContain('"TargetedController".equals(ability.getParam("DefinedPlayer"))');
    expect(bridge).toContain('decider == player');
    expect(bridge).toContain('ability.getActivatingPlayer() != player');
    // Path to Exile's search closes the library-zone-change disjunction today; a later set
    // appends its own reviewed search after it, ahead of the closing paren.
    expect(bridge).toMatch(/\|\|\s*reviewedPathToExileSearch\s*(?:\|\|\s*\w+\s*)*\);/u);
  });

  it('pins the basic, tapped, optional, shuffled library-to-battlefield route', () => {
    expect(bridge).toContain('"Land.Basic".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Tapped"))');
    expect(bridge).toContain('"True".equals(ability.getParam("ShuffleNonMandatory"))');
    expect(bridge).toContain('origin.equals(List.of(ZoneType.Library))');
    expect(bridge).toContain('destination == ZoneType.Battlefield');
    expect(bridge).toContain('isOptional');
    expect(bridge).toContain('!scriptedMandatory');
  });
});
