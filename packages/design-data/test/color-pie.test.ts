import { describe, expect, it } from 'vitest';
import { COLORS, EFFECT_KINDS, KEYWORDS } from '@mtg/dsl';
import {
  bestVerdict,
  classify,
  classifyForColors,
  COLOR_PIE_2021,
  COLOR_PIE_SUBJECTS,
  ColorPieDocumentSchema,
  colorPieRow,
  colorsAtLevel,
  inferredSubjects,
  isColorPieSubject,
  levelFor,
  missingCoverage,
  PIE_LEVEL_VERDICT,
  PIE_LEVELS,
  subjectKindOf,
  subjectsForColor,
  verdictForLevel,
} from '../src/index';

describe('color-pie table coverage', () => {
  it('validates against its own schema when reparsed', () => {
    const result = ColorPieDocumentSchema.safeParse(JSON.parse(JSON.stringify(COLOR_PIE_2021)) as unknown);
    expect(result.success).toBe(true);
  });

  it('covers every pinned keyword and effect for all five colors', () => {
    for (const subject of [...KEYWORDS, ...EFFECT_KINDS]) {
      const row = colorPieRow(subject);
      for (const color of COLORS) {
        expect(PIE_LEVELS, `${subject}/${color}`).toContain(row.levels[color]);
      }
    }
    expect(missingCoverage()).toEqual([]);
    expect(COLOR_PIE_2021.rows).toHaveLength(KEYWORDS.length + EFFECT_KINDS.length);
  });

  it('tags each subject with the vocabulary list it came from', () => {
    for (const row of COLOR_PIE_2021.rows) {
      expect(row.subjectKind, row.subject).toBe(subjectKindOf(row.subject));
    }
    expect(COLOR_PIE_SUBJECTS).toHaveLength(KEYWORDS.length + EFFECT_KINDS.length);
  });

  it('guards unknown subject names at the boundary', () => {
    expect(isColorPieSubject('flying')).toBe(true);
    expect(isColorPieSubject('dealDamage')).toBe(true);
    expect(isColorPieSubject('protection')).toBe(false);
    expect(isColorPieSubject('')).toBe(false);
  });
});

describe('pass / warn / fail policy', () => {
  it('maps every level to a verdict', () => {
    expect(PIE_LEVEL_VERDICT).toEqual({
      primary: 'pass',
      secondary: 'pass',
      tertiary: 'warn',
      offPie: 'fail',
    });
    for (const level of PIE_LEVELS) {
      expect(verdictForLevel(level)).toBe(PIE_LEVEL_VERDICT[level]);
    }
  });

  it('passes primary placements', () => {
    expect(classify('flying', 'U')).toMatchObject({ level: 'primary', verdict: 'pass' });
    expect(classify('counterSpell', 'U')).toMatchObject({ level: 'primary', verdict: 'pass' });
    expect(classify('deathtouch', 'B')).toMatchObject({ level: 'primary', verdict: 'pass' });
    expect(classify('gainLife', 'G')).toMatchObject({ level: 'primary', verdict: 'pass' });
    expect(classify('dealDamage', 'R')).toMatchObject({ level: 'primary', verdict: 'pass' });
  });

  it('passes secondary placements', () => {
    expect(classify('flying', 'B')).toMatchObject({ level: 'secondary', verdict: 'pass' });
    expect(classify('millCards', 'B')).toMatchObject({ level: 'secondary', verdict: 'pass' });
    expect(classify('haste', 'G')).toMatchObject({ level: 'secondary', verdict: 'pass' });
    expect(classify('tapPermanent', 'U')).toMatchObject({ level: 'secondary', verdict: 'pass' });
  });

  it('warns on tertiary placements', () => {
    expect(classify('flying', 'G')).toMatchObject({ level: 'tertiary', verdict: 'warn' });
    expect(classify('counterSpell', 'W')).toMatchObject({ level: 'tertiary', verdict: 'warn' });
    expect(classify('firstStrike', 'B')).toMatchObject({ level: 'tertiary', verdict: 'warn' });
    expect(classify('drawCards', 'R')).toMatchObject({ level: 'tertiary', verdict: 'warn' });
    expect(classify('returnToHand', 'G')).toMatchObject({ level: 'tertiary', verdict: 'warn' });
  });

  it('fails off-pie placements', () => {
    expect(classify('lifelink', 'R')).toMatchObject({ level: 'offPie', verdict: 'fail' });
    expect(classify('gainLife', 'U')).toMatchObject({ level: 'offPie', verdict: 'fail' });
    expect(classify('gainLife', 'R')).toMatchObject({ level: 'offPie', verdict: 'fail' });
    expect(classify('counterSpell', 'R')).toMatchObject({ level: 'offPie', verdict: 'fail' });
    expect(classify('millCards', 'G')).toMatchObject({ level: 'offPie', verdict: 'fail' });
    expect(classify('menace', 'G')).toMatchObject({ level: 'offPie', verdict: 'fail' });
    expect(classify('haste', 'W')).toMatchObject({ level: 'offPie', verdict: 'fail' });
  });

  it('carries provenance on every ruling', () => {
    const ruling = classify('trample', 'W');
    expect(ruling).toMatchObject({
      subject: 'trample',
      subjectKind: 'keyword',
      color: 'W',
      level: 'tertiary',
      verdict: 'warn',
      confidence: 'sourced',
    });
    expect(ruling.sourceUrl).toContain('mechanical-color-pie-2021');
    expect(ruling.quote).toContain('Tertiary');
  });
});

describe('table readings', () => {
  it('places trample green-primary, red-secondary, tertiary elsewhere', () => {
    expect(colorsAtLevel('trample', 'primary')).toEqual(['G']);
    expect(colorsAtLevel('trample', 'secondary')).toEqual(['R']);
    expect(colorsAtLevel('trample', 'tertiary')).toEqual(['W', 'U', 'B']);
    expect(colorsAtLevel('trample', 'offPie')).toEqual([]);
  });

  it('splits flying across all five colors at descending levels', () => {
    expect(colorsAtLevel('flying', 'primary')).toEqual(['W', 'U']);
    expect(colorsAtLevel('flying', 'secondary')).toEqual(['B', 'R']);
    expect(colorsAtLevel('flying', 'tertiary')).toEqual(['G']);
  });

  /**
   * The one row with no off-pie color, and the source is what says so rather
   * than a gap in it: scry was given to all five. So an allocation never fails
   * a slot for scrying, and a card that scries is off-pie for something else it
   * does or for nothing at all.
   */
  it('puts scry on every color and still ranks blue first', () => {
    expect(levelFor('scry', 'U')).toBe('primary');
    for (const color of ['W', 'B', 'R', 'G'] as const) {
      expect(levelFor('scry', color), color).toBe('secondary');
    }
    expect(colorsAtLevel('scry', 'offPie')).toEqual([]);
  });

  it('keeps card draw off nobody but ranks it', () => {
    expect(levelFor('drawCards', 'U')).toBe('primary');
    expect(levelFor('drawCards', 'B')).toBe('secondary');
    expect(levelFor('drawCards', 'G')).toBe('secondary');
    expect(levelFor('drawCards', 'W')).toBe('tertiary');
    expect(levelFor('drawCards', 'R')).toBe('tertiary');
  });

  it('lists what a color is primary in', () => {
    expect(subjectsForColor('R', 'primary')).toEqual(['haste', 'menace', 'firstStrike', 'dealDamage']);
    expect(subjectsForColor('U', 'primary')).toEqual([
      'flying',
      'drawCards',
      'counterSpell',
      'returnToHand',
      'millCards',
      'scry',
    ]);
  });
});

describe('coarse primitives and inference', () => {
  it('flags every inferred row and makes each explain itself', () => {
    expect(inferredSubjects()).toEqual([
      'destroyPermanent',
      'putCounters',
      'exileTarget',
      'returnFromGraveyard',
    ]);
    const destroy = classify('destroyPermanent', 'G');
    expect(destroy.confidence).toBe('inferred');
    expect(destroy.note ?? '').toContain('no generic');
    expect(destroy.note ?? '').toContain('Artifact destruction');
    // A counter kind's effect is declared once and read by the layers, so the
    // gate for placing one is the gate for the effect it declares.
    const counters = classify('putCounters', 'G');
    expect(counters.confidence).toBe('inferred');
    expect(counters.note ?? '').toContain('no entry for the slice primitive');
    expect(counters.note ?? '').toContain('COUNTER_DECLARATIONS');
    // Both zone-reaching rows are classified by an entry that is narrower than
    // the primitive, and each note has to name the gap it is reading across.
    const exile = classify('exileTarget', 'W');
    expect(exile.confidence).toBe('inferred');
    expect(exile.note ?? '').toContain('Banisher Priest');
    expect(exile.note ?? '').toContain('graveyard');
    const reanimate = classify('returnFromGraveyard', 'B');
    expect(reanimate.confidence).toBe('inferred');
    expect(reanimate.note ?? '').toContain('one creature card');
    expect(reanimate.note ?? '').toContain('rarity budget');
  });

  it('gates putCounters on the stat change its stock kinds declare', () => {
    for (const color of ['W', 'U', 'B', 'R', 'G'] as const) {
      expect(classify('putCounters', color).level).toBe(classify('pumpUntilEndOfTurn', color).level);
    }
  });

  it('gates destroyPermanent on unconditional creature removal, the strictest reading', () => {
    expect(classify('destroyPermanent', 'B')).toMatchObject({ level: 'primary', verdict: 'pass' });
    expect(classify('destroyPermanent', 'W')).toMatchObject({ level: 'secondary', verdict: 'pass' });
    expect(classify('destroyPermanent', 'R')).toMatchObject({ level: 'offPie', verdict: 'fail' });
    expect(classify('destroyPermanent', 'G')).toMatchObject({ level: 'offPie', verdict: 'fail' });
    expect(classify('destroyPermanent', 'U')).toMatchObject({ level: 'offPie', verdict: 'fail' });
  });

  it('records the scope gap for every primitive coarser than its canon entry', () => {
    for (const subject of ['dealDamage', 'destroyPermanent', 'tapPermanent', 'pumpUntilEndOfTurn'] as const) {
      expect(colorPieRow(subject).note, subject).toBeDefined();
    }
  });
});

describe('multi-color rulings', () => {
  it('takes the best placement across a card color identity', () => {
    const rulings = classifyForColors('lifelink', ['W', 'R']);
    expect(rulings.map((r) => r.verdict)).toEqual(['pass', 'fail']);
    expect(bestVerdict(rulings)).toBe('pass');
  });

  it('warns when the best any color can offer is tertiary', () => {
    expect(bestVerdict(classifyForColors('trample', ['W', 'U']))).toBe('warn');
  });

  it('fails a colorless card that has no color to justify the ability', () => {
    expect(bestVerdict(classifyForColors('millCards', []))).toBe('fail');
  });

  it('fails when every color on the card is off-pie', () => {
    expect(bestVerdict(classifyForColors('gainLife', ['U', 'R']))).toBe('fail');
  });
});
