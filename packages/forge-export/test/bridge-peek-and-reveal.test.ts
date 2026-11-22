import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge PeekAndReveal callback boundary', () => {
  it('routes optional reveal and cast confirmations through a listed human decision', () => {
    expect(bridge).toContain('boolean confirmAction(');
    expect(bridge).toContain('"confirm-optional-reveal"');
    expect(bridge).toContain('ability.getApi() == ApiType.PeekAndReveal');
    expect(bridge).toContain('"True".equals(ability.getParam("RevealOptional"))');
    expect(bridge).toContain(
      'return session.confirmAction(\n                    getPlayer(), ability, mode, message, options, cardToShow, params);',
    );
  });

  it('distinguishes an exact source-linked free cast without interpreting display text', () => {
    expect(bridge).toContain('isReviewedSourceLinkedFreeCastConfirmation(');
    expect(bridge).toContain('ability.getApi() == ApiType.Play');
    expect(bridge).toContain('"True".equals(ability.getParam("WithoutManaCost"))');
    expect(bridge).toContain('targets.getFirst() == cardToShow');
    expect(bridge).toContain('cardToShow.isInZone(ZoneType.Graveyard)');
    expect(bridge).toContain('"confirm-free-cast"');
    expect(bridge).toContain('List.of(cardTarget(cardToShow), cardTarget(ability.getHostCard()))');
  });

  it('recognizes the exact revealed-card confirmation emitted by Forge explore resolution', () => {
    const helper = bridge.slice(
      bridge.indexOf('private static boolean isReviewedExploreGraveyardConfirmation('),
      bridge.indexOf('private static boolean isReviewedGolosSearchTrigger('),
    );
    expect(helper).toContain('(options == null || options.isEmpty())');
    expect(helper).toContain('params.keySet().equals(Set.of("RevealedCard"))');
    expect(helper).toContain('params.get("RevealedCard") == cardToShow');
    expect(helper).toContain('!cardToShow.isLand()');
    expect(bridge).toContain('"confirm-explore-graveyard"');
  });

  it('routes optional remembered-card selection through exact Forge entity identities', () => {
    expect(bridge).toContain('public <T extends GameEntity> T chooseSingleEntityForEffect(');
    expect(bridge).toContain('return session.chooseEntity(');
    expect(bridge).toContain('"entity-selection"');
  });

  it('delegates the chosen free spell to Forge play machinery', () => {
    expect(bridge).toContain('public boolean playSaFromPlayEffect(SpellAbility ability)');
    expect(bridge).toContain('return PlaySpellAbility.playSpellAbility(this, getPlayer(), ability);');
  });

  it('rejects stale revisions and choices Forge did not offer', () => {
    expect(bridge).toContain('if (submittedRevision != revision) return "stale Forge session revision";');
    expect(bridge).toContain('if (!offered) return "Forge did not offer move " + moveId;');
  });
});
