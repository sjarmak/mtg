/** Runtime admission is exactly the projection of completed ledger evidence. */
import { describe, expect, it } from 'vitest';
import { legacyCubeBridgeCardFamilySafeNames, loadLegacyCubeDecisionLedger } from '@mtg/data';
import { AUDITED_FORGE_CARD_NAMES } from '@mtg/forge-export';

describe('Legacy Cube runtime evidence wiring', () => {
  it('keeps the Forge allowlist equal to completed card-family probes', () => {
    expect(AUDITED_FORGE_CARD_NAMES).toEqual(
      legacyCubeBridgeCardFamilySafeNames(loadLegacyCubeDecisionLedger()),
    );
  });
});
