/** Static boundary for Gifts Ungiven's exact repeated distinct-name search. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Gifts Ungiven's reviewed search", () => {
  it('pins the whole scripted ability and its changing reveal callback state', () => {
    expect(bridge).toContain('boolean reviewedGiftsUngivenSearch =');
    expect(bridge).toContain('"Gifts Ungiven".equals(source.getName())');
    expect(bridge).toContain('origin.equals(List.of(ZoneType.Library))');
    expect(bridge).toContain('destination == ZoneType.Library');
    expect(bridge).toContain('ability.getApi() == ApiType.ChangeZone');
    expect(bridge).toContain('ability.getParent() == null');
    expect(bridge).toContain('ability.getSubAbility() != null');
    expect(bridge).toContain('ability.isSpell()');
    expect(bridge).toContain('"Card".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"4".equals(ability.getParam("ChangeNum"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RememberChanged"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Reveal"))');
    expect(bridge).toContain('"False".equals(ability.getParam("Shuffle"))');
    expect(bridge).toContain('"True".equals(ability.getParam("DifferentNames"))');
    expect(bridge).toContain('!ability.hasParam("Defined")');
    expect(bridge).toContain('!ability.hasParam("DefinedPlayer")');
    expect(bridge).toContain('!ability.hasParam("Chooser")');
  });

  it('admits the observed first and later callback shapes without opening neighbors', () => {
    expect(bridge).toContain('boolean reviewedGiftsUngivenRevealState =');
    expect(bridge).toContain('source.getRememberedCount() == 0');
    expect(bridge).toContain('"Select a card from your library (1 / 4)".equals(selectPrompt)');
    expect(bridge).toContain('"Select a card from your library \\\\([2-4] / 4\\\\)"');
    // Gifts Ungiven's and Sword of Hearth and Home's searches share the library-destination
    // group; a later set's own reviewed search can join it before, between or after them.
    expect(bridge).toMatch(
      /\(destination == ZoneType\.Library\s*&&\s*\(reviewedGiftsUngivenSearch\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedSwordOfHearthAndHomeSearch\s*(?:\|\|\s*\w+\s*)*\)\)/u,
    );
    expect(bridge).toContain('|| reviewedGiftsUngivenSearch');
    expect(bridge).toContain('selected zone card disappeared');
  });
});
