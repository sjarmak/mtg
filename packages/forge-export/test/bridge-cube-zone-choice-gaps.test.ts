/** Structural contracts for zone choices first witnessed by the Legacy Cube campaign. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

function method(name: string, next: string): string {
  const start = bridge.indexOf(`private boolean ${name}(`);
  const end = bridge.indexOf(`private boolean ${next}(`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return bridge.slice(start, end);
}

describe('Legacy Cube zone-choice contracts', () => {
  it('recognizes the generated remembered-library split by its full ability chain', () => {
    const body = method('isReviewedRememberedLibrarySplitStep', 'isReviewedOwnHandToLibrarySelection');
    expect(body).toContain('"Land.IsRemembered".equals(ability.getParam("ChangeType"))');
    expect(body).toContain('"Land.Basic".equals(root.getParam("ChangeType"))');
    expect(body).toContain('source.getRememberedCount() == 2');
    expect(body).not.toContain('Cultivate');
  });

  it('recognizes a single own-hand card put into the library by its effect shape', () => {
    const body = method('isReviewedOwnHandToLibrarySelection', 'isReviewedBoundedTriggeredLibraryToHand');
    expect(body).toContain('origin.equals(List.of(ZoneType.Hand))');
    expect(body).toContain('destination == ZoneType.Library');
    expect(body).toContain('"1".equals(ability.getParam("ChangeNum"))');
    expect(body).not.toContain('Fire Prophecy');
  });

  it('recognizes bounded triggered tutors by restriction rather than printed name', () => {
    const body = method(
      'isReviewedBoundedTriggeredLibraryToHand',
      'isReviewedRevealedOpponentHandCreatureChoice',
    );
    expect(body).toContain('"Creature.powerLE2"');
    expect(body).toContain('"Creature.toughnessLE2"');
    expect(body).toContain('"Instant,Sorcery"');
    expect(body).not.toContain('Imperial Recruiter');
    expect(body).not.toContain('Recruiter of the Guard');
    expect(body).not.toContain('Spellseeker');
  });

  it('recognizes repeated revealed-hand creature choices without naming their source', () => {
    const body = method('isReviewedRevealedOpponentHandCreatureChoice', 'reviewedCubeZoneCandidate');
    expect(body).toContain('"AlreadyRevealed"');
    expect(body).toContain('"Creature.IsImprinted"');
    expect(body).toContain('source.getFirstRemembered() instanceof Player');
    expect(body).not.toContain('Valki');
  });

  it('recognizes temporary own-hand creature placement by its complete effect chain', () => {
    const body = method('isReviewedTemporaryHandCreaturePlacement', 'isReviewedSmallArtifactSagaSearch');
    expect(body).toContain('"Creature.YouCtrl".equals(ability.getParam("ChangeType"))');
    expect(body).toContain('"Haste".equals(pump.getParam("Keywords"))');
    expect(body).toContain('"Sacrifice".equals(pump.getParam("AtEOT"))');
    expect(body).not.toContain('Through the Breach');
  });

  it('recognizes the exact Saga search for an artifact with mana cost zero or one', () => {
    const body = method('isReviewedSmallArtifactSagaSearch', 'reviewedCubeZoneCandidate');
    expect(body).toContain('"Artifact.ManaCost0,Artifact.ManaCost1"');
    expect(body).toContain('source.getType().hasSubtype("Saga")');
    expect(body).not.toContain("Urza's Saga");
    expect(bridge).toContain('card.isArtifact() && card.getCMC() <= 1');
  });

  it('routes a modal spell subability that chooses from an opponent revealed hand', () => {
    expect(bridge).toContain('isReviewedModalRevealDiscard(');
    expect(bridge).toContain('parent.getApi() == ApiType.Charm');
    expect(bridge).toContain('"RevealYouChoose".equals(ability.getParam("Mode"))');
    expect(bridge).toContain('reviewedOpponentRevealDiscard');
  });

  it('checks every candidate and submitted card against the relevant zone and predicate', () => {
    expect(bridge).toContain('reviewedCubeZoneCandidate(');
    expect(bridge.match(/reviewedCubeZoneCandidate\(/gu)).toHaveLength(3);
    expect(bridge).toContain('"selected reviewed Cube zone card disappeared"');
  });
});
