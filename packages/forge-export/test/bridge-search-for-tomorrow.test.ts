/** Exact refusal boundary for Search for Tomorrow's normal and suspended searches. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Search for Tomorrow's exact basic-land search", () => {
  it('pins the canonical spell and the one Forge-added suspend parameter', () => {
    expect(bridge).toContain('isReviewedSearchForTomorrowSearch');
    expect(bridge).toContain('"Search for Tomorrow".equals(source.getName())');
    expect(bridge).toContain('source.isSorcery()');
    expect(bridge).toContain('"Land.Basic".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"basic land".equals(ability.getParam("ChangeTypeDesc"))');
    expect(bridge).toContain('"True".equals(ability.getParam("WithoutManaCost"))');
    expect(bridge).toContain('ability.getMapParams().keySet().equals(SEARCH_FOR_TOMORROW_PARAMS)');
    expect(bridge).toContain('ability.getMapParams().keySet().equals(SEARCH_FOR_TOMORROW_SUSPENDED_PARAMS)');
  });

  it('requires the observed local-player callback and validates every offered card', () => {
    expect(bridge).toContain('boolean reviewedSearchForTomorrowSearch =');
    expect(bridge).toContain('ability.getActivatingPlayer() == player');
    expect(bridge).toContain('decider == player');
    expect(bridge).toContain('origin.equals(List.of(ZoneType.Library))');
    expect(bridge).toContain('destination == ZoneType.Battlefield');
    expect(bridge).toContain('"Select a card from your library".equals(selectPrompt)');
    expect(bridge).toContain('reviewedSearchForTomorrowSearch');
    expect(bridge).toContain('!card.isBasicLand()');
  });
});
