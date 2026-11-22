/**
 * The editor's draft, against the schema that actually judges it.
 *
 * `mtg-yddw.2`. The load-bearing claim of `src/routes/design/draft.ts` is that a
 * draft is *not* a `SetBrief` and that `briefFrom` is the only place that
 * decides what an empty field means. That claim is worth nothing unless what
 * comes out the far side is a brief the generator accepts, so these tests do the
 * round trip over every brief in this repository: read the file as a draft,
 * turn the draft back into JSON, and hand it to `@mtg/setgen`'s own
 * `validateBrief`. A test that checked the draft against a second copy of the
 * rules would pass on the day the two copies agreed with each other and were
 * both wrong.
 *
 * This is a Node test and imports `@mtg/setgen` freely. The *page* cannot, which
 * is the whole reason the design server exists; a test runs where the canon data
 * is readable.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateBrief } from '@mtg/setgen';
import {
  blankDraft,
  briefFileName,
  briefFrom,
  briefJson,
  EMPTY_REQUIRED_CARD,
} from '../../src/routes/design/draft';
import { carriedFrom, draftFrom, parseBriefText } from '../../src/routes/design/draft-store';

/**
 * Every brief in the repository, read from the directory rather than listed.
 *
 * A written list would be a second place to update when a brief is added, and
 * it would name files this test has no reason to name.
 */
const BRIEF_DIR = fileURLToPath(new URL('../../../setgen/briefs/', import.meta.url));
const BRIEFS: readonly string[] = readdirSync(BRIEF_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort();

function briefFile(name: string): unknown {
  return JSON.parse(readFileSync(`${BRIEF_DIR}${name}`, 'utf8'));
}

interface AuthoringBrief {
  readonly authoredCards?: readonly unknown[];
}

/** The one brief that authors cards by hand, whichever set that is today. */
function briefWithAuthoredCards(): AuthoringBrief {
  const found = BRIEFS.map((name) => briefFile(name) as AuthoringBrief).find(
    (brief) => (brief.authoredCards ?? []).length > 0,
  );
  if (found === undefined) throw new Error('no brief in this repository authors cards');
  return found;
}

describe('a brief read into the editor', () => {
  for (const name of BRIEFS) {
    it(`comes back out of ${name} as a brief the generator still accepts`, () => {
      const file = briefFile(name);
      const draft = draftFrom(file);
      const carried = carriedFrom(file);
      const validation = validateBrief({ ...carried, ...briefFrom(draft) });
      expect(validation.ok ? [] : validation.issues).toEqual([]);
    });
  }

  it('carries the authored cards it does not model rather than dropping them', () => {
    const file = briefWithAuthoredCards();
    const carried = carriedFrom(file);
    expect(carried['authoredCards']).toEqual(file.authoredCards);
    // And the modeled half is not duplicated into the carried half, which is
    // what would let a stale mechanic list survive an edit.
    expect(carried['mechanics']).toBeUndefined();
  });
});

describe('an empty draft', () => {
  it('opens with one mechanic, because the floor is one', () => {
    expect(blankDraft().mechanics).toHaveLength(1);
  });

  it('leaves the size blank rather than filling in a number nobody chose', () => {
    expect(blankDraft().targetSize).toBe('');
    expect(briefFrom(blankDraft())['targetSize']).toBeUndefined();
  });

  it('is refused by the schema, and named fields are what comes back', () => {
    const validation = validateBrief(briefFrom(blankDraft()));
    expect(validation.ok).toBe(false);
    const pointers = validation.ok ? [] : validation.issues.map((issue) => issue.pointer);
    expect(pointers).toContain('setCode');
    expect(pointers).toContain('setName');
  });
});

describe('what an empty box means', () => {
  it('omits a blank narrowing rather than sending an empty string', () => {
    const draft = { ...blankDraft(), requiredCards: [{ ...EMPTY_REQUIRED_CARD, name: 'Tide-Bound Herald' }] };
    const card = (briefFrom(draft)['requiredCards'] as readonly Record<string, unknown>[])[0];
    expect(card).toBeDefined();
    expect(card?.['name']).toBe('Tide-Bound Herald');
    expect('color' in (card ?? {})).toBe(false);
    expect('rarity' in (card ?? {})).toBe(false);
    // The two flags are always sent: false is a statement about the card, not an
    // absence, and the schema reads it as one.
    expect(card?.['legendary']).toBe(false);
  });

  it('sends unparseable text as text, so the schema names the field', () => {
    const draft = { ...blankDraft(), targetSize: 'about two hundred' };
    expect(briefFrom(draft)['targetSize']).toBe('about two hundred');
    const validation = validateBrief(briefFrom(draft));
    expect(validation.ok).toBe(false);
    const pointers = validation.ok ? [] : validation.issues.map((issue) => issue.pointer);
    expect(pointers).toContain('targetSize');
  });

  it('drops a blank archetype note rather than sending a line the schema refuses', () => {
    const draft = { ...blankDraft(), archetypeNotes: ['Boros wants to attack.', '', '  '] };
    expect(briefFrom(draft)['archetypeNotes']).toEqual(['Boros wants to attack.']);
  });
});

describe('the file on screen', () => {
  it('is the brief itself, parseable and ending in a newline', () => {
    const draft = { ...blankDraft(), setCode: 'TGR', setName: 'Tideglass Reach' };
    const json = briefJson(draft);
    expect(json.endsWith('\n')).toBe(true);
    const parsed = parseBriefText(json);
    expect(parsed.ok).toBe(true);
  });

  it('is named for the set, and named brief.json before there is a set code', () => {
    expect(briefFileName({ ...blankDraft(), setCode: 'XMP' })).toBe('xmp.json');
    expect(briefFileName(blankDraft())).toBe('brief.json');
  });

  it('reads text that is not JSON as a sentence rather than throwing', () => {
    const parsed = parseBriefText('{ not json');
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.message).toContain('not JSON');
  });
});

describe('a brief file with the wrong shapes in it', () => {
  it('opens as blanks rather than refusing to open at all', () => {
    const draft = draftFrom({ setCode: 42, mechanics: 'flying', requiredCards: [{ name: null }] });
    expect(draft.setCode).toBe('42');
    expect(draft.mechanics).toHaveLength(1);
    expect(draft.requiredCards[0]?.name).toBe('');
  });

  it('reads a value that is not an object at all as a new brief', () => {
    expect(draftFrom(null).setName).toBe('');
    expect(draftFrom('a brief').mechanics).toHaveLength(1);
  });
});

describe('a required card that states where it may be seated', () => {
  const briefWith = (card: Record<string, unknown>): Record<string, unknown> =>
    briefFrom({
      ...blankDraft(),
      setCode: 'TGR',
      setName: 'Tideglass Reach',
      theme: 'A tide-worn coast.',
      seed: 'seat-ceiling',
      mechanics: [
        {
          name: 'Surge',
          description: 'It swells.',
          keywords: ['flying'],
          effectKinds: [],
          abilityKinds: [],
          triggerConditions: [],
          colors: [],
        },
      ],
      requiredCards: [{ ...EMPTY_REQUIRED_CARD, ...card }],
    });
  const cardOf = (brief: Record<string, unknown>): Record<string, unknown> =>
    (brief['requiredCards'] as readonly Record<string, unknown>[])[0] ?? {};

  it('sends a stated ceiling, and no key at all when the box is empty', () => {
    const stated = briefWith({ name: 'Marquee Gear', rarity: 'mythic', seatCeiling: 'common' });

    expect(cardOf(stated)['seatCeiling']).toBe('common');
    expect('seatCeiling' in cardOf(briefWith({ name: 'Marquee Gear', rarity: 'mythic' }))).toBe(false);
    expect(validateBrief(stated).ok).toBe(true);
  });

  // The panel offers no such ceiling (`./seat-ceiling-field.test.ts`), which is
  // a narrowing rather than a rule. This is the rule.
  it('is refused for a ceiling at or above its rarity, on the field that earned it', () => {
    const refused = validateBrief(
      briefWith({ name: 'Marquee Gear', rarity: 'uncommon', seatCeiling: 'rare' }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.issues.map((issue) => issue.pointer)).toContain('requiredCards.0.seatCeiling');
  });

  it('is refused for a ceiling with no rarity above it, on that same field', () => {
    const refused = validateBrief(briefWith({ name: 'Marquee Gear', seatCeiling: 'common' }));

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.issues.map((issue) => issue.pointer)).toContain('requiredCards.0.seatCeiling');
  });
});
