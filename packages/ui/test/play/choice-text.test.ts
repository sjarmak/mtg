import { describe, expect, it } from 'vitest';
import { withoutBridgeIdentifiers } from '../../src/routes/play/choice-text';

describe('a choice label without the bridge identifiers', () => {
  it('removes each bracketed identifier it is given, wherever it sits', () => {
    expect(
      withoutBridgeIdentifiers('Block Civil Servant [forge-card-140] with Molten Hydra [forge-card-131]', [
        'forge-card-131',
        'forge-card-140',
      ]),
    ).toBe('Block Civil Servant with Molten Hydra');
  });

  it('leaves a bracket it was not told about, which is the card speaking', () => {
    expect(withoutBridgeIdentifiers('Cast Fire [Fire // Ice]', ['forge-card-9'])).toBe(
      'Cast Fire [Fire // Ice]',
    );
  });

  it('leaves an identifier that is not in brackets', () => {
    expect(withoutBridgeIdentifiers('Choose forge-card-9', ['forge-card-9'])).toBe('Choose forge-card-9');
  });

  it('returns text holding no bracket untouched', () => {
    expect(withoutBridgeIdentifiers('Pass priority', ['forge-card-9'])).toBe('Pass priority');
  });
});
