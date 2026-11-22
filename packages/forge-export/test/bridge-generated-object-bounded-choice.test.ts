import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the reviewed generated-object bounded choices', () => {
  it('pins Liliana optional targeting to the exact loyalty ability', () => {
    expect(bridge).toContain('private boolean isReviewedLilianaLastHopeTarget(');
    expect(bridge).toContain('"Liliana, the Last Hope".equals(source.getName())');
    expect(bridge).toContain('"UntilYourNextTurn".equals(ability.getParam("Duration"))');
    expect(bridge).toContain('"-2".equals(ability.getParam("NumAtt"))');
    expect(bridge).toContain('"-1".equals(ability.getParam("NumDef"))');
    expect(bridge).toContain('reviewedOptionalTarget = reviewedOptionalTarget');
  });

  it('pins Liliana mill-return to its exact optional graveyard chooser', () => {
    expect(bridge).toContain('boolean lilianaOptionalReturn = destination == ZoneType.Hand');
    expect(bridge).toContain('parent.getApi() == ApiType.Mill');
    expect(bridge).toContain('parent.getSubAbility() == ability');
    expect(bridge).toContain('"2".equals(parent.getParam("NumCards"))');
    expect(bridge).toContain('"Creature.YouOwn".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('new Choice("zone-card-none", "Choose no card", null)');
    expect(bridge).toContain('lilianaOptionalReturn && value == null');
  });

  it('pins Ranger Class targeting to its exact level-two attacking-creature trigger', () => {
    expect(bridge).toContain('private boolean isReviewedRangerClassTarget(');
    expect(bridge).toContain('"Ranger Class".equals(source.getName())');
    expect(bridge).toContain('"Creature.attacking".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"P1P1".equals(ability.getParam("CounterType"))');
    expect(bridge).toContain('"1".equals(ability.getParam("CounterNum"))');
  });

  it('pins Vivien counter choice and delayed search to exact bounded values', () => {
    expect(bridge).toContain('private void validateReviewedVivienCounterType(');
    expect(bridge).toContain('options.equals(List.of(');
    expect(bridge).toContain('optionNames.equals(List.of("Vigilance", "Reach", "Trample"))');
    expect(bridge).toContain('boolean reviewedVivienDelayedSearch = source != null');
    expect(bridge).toContain('"Creature.cmcLTX".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"TriggeredSpellAbility$CardManaCostLKI".equals(source.getSVar("X"))');
  });

  it('rechecks offered targets and search candidates against the exact board and library', () => {
    expect(bridge).toContain('reviewedLilianaLastHopeTarget');
    expect(bridge).toContain('reviewedRangerClassTarget');
    expect(bridge).toContain('reviewedVivienDelayedSearch');
    expect(bridge).toContain('Forge offered a Ranger Class target outside attacking creatures');
    expect(bridge).toContain('Forge offered a Vivien search candidate outside its exact lesser-MV profile');
  });

  it('puts a card type in the bridge-owned move id so policy need not read its label', () => {
    expect(bridge).toContain(
      'String slug = option.replaceAll("[^A-Za-z0-9]+", "-").replaceAll("^-|-$", "");',
    );
    expect(bridge).toContain('String id = "type-choice-" + slug;');
    expect(bridge).toContain('Forge offered two types with one wire id');
    expect(bridge).toContain('"type-choice-none"');
    expect(bridge).toContain('awaitChoice(player, "type-choice", prompt, choices)');
  });
});
