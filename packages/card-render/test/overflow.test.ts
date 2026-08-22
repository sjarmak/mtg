import { describe, expect, it } from 'vitest';
import { checkSvgOverflow, inkRects, regionBoxes, renderCardSvg } from '@mtg/card-render';
import { stressCards } from './fixtures/cards';

const CARD = stressCards()[0];
if (CARD === undefined) throw new Error('stress fixtures are empty');

const CLEAN = renderCardSvg(CARD).svg;

describe('reading a rendered card back', () => {
  it('finds a box for every region that carries text', () => {
    const boxes = regionBoxes(CLEAN);
    for (const ink of inkRects(CLEAN)) expect(boxes.has(ink.region)).toBe(true);
  });

  it('derives a run rectangle from the run, not from the renderer', () => {
    const rect = inkRects(CLEAN).find((ink) => ink.region === 'title');
    expect(rect).toBeDefined();
    if (rect === undefined) return;
    expect(rect.right).toBeGreaterThan(rect.left);
    expect(rect.bottom).toBeGreaterThan(rect.top);
  });

  it('places a middle-anchored run symmetrically about its x', () => {
    const svg =
      '<g data-region="r" data-box-x="0" data-box-y="0" data-box-w="100" data-box-h="100">' +
      '<text data-region="r" x="50" y="50" font-size="10" textLength="40" text-anchor="middle">ab</text></g>';
    const [rect] = inkRects(svg);
    expect(rect?.left).toBe(30);
    expect(rect?.right).toBe(70);
  });
});

describe('checkSvgOverflow', () => {
  it('passes a card the renderer fitted', () => {
    expect(checkSvgOverflow(CLEAN)).toEqual([]);
  });

  it('catches a run that is too wide for its box', () => {
    const svg =
      '<g data-region="rules" data-box-x="0" data-box-y="0" data-box-w="100" data-box-h="100">' +
      '<text data-region="rules" x="0" y="50" font-size="10" textLength="140">too wide</text></g>';
    const findings = checkSvgOverflow(svg);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.edge).toBe('right');
    expect(findings[0]?.overflow).toBeCloseTo(40, 6);
    expect(findings[0]?.text).toBe('too wide');
  });

  it('catches ink that rises above and drops below its box', () => {
    // Ink at size 30 runs 24 above the baseline and 7.8 below it, so a baseline
    // at 55 in a box spanning 40 to 60 breaks out of both edges at once.
    const svg =
      '<g data-region="type" data-box-x="0" data-box-y="40" data-box-w="200" data-box-h="20">' +
      '<text data-region="type" x="0" y="55" font-size="30" textLength="50">tall</text></g>';
    const edges = checkSvgOverflow(svg).map((finding) => finding.edge);
    expect(edges).toContain('top');
    expect(edges).toContain('bottom');
  });

  it('catches a widened run in a real card, proving it reads the file', () => {
    const broken = CLEAN.replace(/textLength="[\d.]+"/, 'textLength="900"');
    expect(checkSvgOverflow(broken).length).toBeGreaterThan(0);
  });

  it('refuses to skip a run whose region declares no box', () => {
    const svg = '<text data-region="ghost" x="0" y="0" font-size="10" textLength="5">x</text>';
    expect(() => checkSvgOverflow(svg)).toThrow(/declares no box/);
  });

  it('refuses a run missing its layout attributes', () => {
    const svg =
      '<g data-region="r" data-box-x="0" data-box-y="0" data-box-w="10" data-box-h="10">' +
      '<text data-region="r" x="0" y="0">x</text></g>';
    expect(() => inkRects(svg)).toThrow(/missing layout attributes/);
  });

  it('refuses a region whose box is incomplete', () => {
    const svg = '<g data-region="r" data-box-x="0" data-box-y="0"></g>';
    expect(() => regionBoxes(svg)).toThrow(/incomplete box/);
  });

  it('ignores decoration, which has no region and no text', () => {
    expect(checkSvgOverflow('<rect x="0" y="0" width="10" height="10" />')).toEqual([]);
  });
});
