import { describe, expect, it } from 'vitest';
import { addBasicLabel, cutBasicLabel } from '../../src/routes/deck/BasicsPanel';
import { cutCopyLabel } from '../../src/routes/deck/ConstructedBuilder';
import { cutEntryLabel } from '../../src/routes/deck/OpenDeckScreen';
import { withArticle } from '../../src/routes/deck/article';

describe('the article in front of a card name', () => {
  it('is "an" before a vowel sound and "a" otherwise', () => {
    expect(withArticle('Island')).toBe('an Island');
    expect(withArticle('Forest')).toBe('a Forest');
    expect(withArticle('arbor elf')).toBe('an arbor elf');
  });

  it('reaches the basic land controls', () => {
    expect(addBasicLabel('Island')).toBe('Add an Island');
    expect(cutBasicLabel('Island')).toBe('Cut an Island');
    expect(addBasicLabel('Forest')).toBe('Add a Forest');
    expect(cutBasicLabel('Swamp')).toBe('Cut a Swamp');
  });

  it('reaches the two deck screens that cut a named card', () => {
    expect(cutCopyLabel('Elvish Mystic')).toBe('Cut an Elvish Mystic');
    expect(cutCopyLabel('Lightning Bolt')).toBe('Cut a Lightning Bolt');
    expect(cutEntryLabel('Island')).toBe('Cut an Island');
    expect(cutEntryLabel('Mountain')).toBe('Cut a Mountain');
  });
});
