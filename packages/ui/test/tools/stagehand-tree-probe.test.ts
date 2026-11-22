/**
 * `mtg-nkfd2`: the stub-model half of the tree probe, tested without a real
 * browser or `@browserbasehq/stagehand` import — `createStubObserveGenerate`
 * and `probeStep` are the only pieces that decide the suspect-2/suspect-3
 * classification, and both take plain objects, so they are testable against
 * fakes.
 */
import { describe, expect, it } from 'vitest';
import { createStubObserveGenerate, parseElementIds, probeStep } from '../../tools/stagehand-tree-probe';
import type { JourneyStepDefinition } from '../../tools/stagehand-runner';

const STEP: JourneyStepDefinition = {
  name: 'printed-gallery-face-toggle',
  url: 'http://127.0.0.1:1/gallery',
  instruction: 'Find the button on a card that shows the other face',
};

function observeRequest(tree: string) {
  return {
    systemPrompt: 'Each element in the accessibility tree has an ID in square brackets, like [0-18372].',
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text: `instruction: flip it\nAccessibility Tree: \n${tree}\n` },
      },
    ],
    responseFormat: { type: 'json_schema' as const, name: 'Observation', schema: {} },
  };
}

describe('parseElementIds', () => {
  it('reads every bracketed frame-node id, in order, duplicates kept', () => {
    const tree = '[0-18372] button "Flip"\n[0-18373] div "card"\n[0-18372] button "Flip" (again)';
    expect(parseElementIds(tree)).toEqual(['0-18372', '0-18373', '0-18372']);
  });

  it('finds nothing in an empty or id-less tree', () => {
    expect(parseElementIds('')).toEqual([]);
    expect(parseElementIds('the page has not rendered yet')).toEqual([]);
  });
});

describe('createStubObserveGenerate', () => {
  it('answers with the first elementId the tree named, and records the call', async () => {
    const calls: Array<{ elementIds: readonly string[]; answeredElementId: string | null }> = [];
    const generate = createStubObserveGenerate((call) => calls.push(call));

    const result = await generate(observeRequest('[0-18372] button "Flip the card"'));

    expect(result.outputFormat).toBe('json_schema');
    expect(result.outputFormat === 'json_schema' ? result.structuredContent : null).toEqual({
      elements: [
        {
          elementId: '0-18372',
          description: 'stub: the first element named in the accessibility tree',
          method: 'click',
          arguments: [],
        },
      ],
    });
    expect(calls).toEqual([
      expect.objectContaining({ elementIds: ['0-18372'], answeredElementId: '0-18372' }),
    ]);
  });

  it('answers with zero candidates when the tree names no elements, never inventing one', async () => {
    const calls: Array<{ elementIds: readonly string[]; answeredElementId: string | null }> = [];
    const generate = createStubObserveGenerate((call) => calls.push(call));

    const result = await generate(observeRequest(''));

    expect(result.outputFormat === 'json_schema' ? result.structuredContent : null).toEqual({ elements: [] });
    expect(calls).toEqual([expect.objectContaining({ elementIds: [], answeredElementId: null })]);
  });
});

interface FakeStagehand {
  browser: { context: { newPage(url: string): Promise<{ close(): Promise<void> }> } };
  observe(instruction: string, options: { page: unknown }): Promise<{ data: readonly unknown[] }>;
}

function fakeStagehand(observeImpl: FakeStagehand['observe']): FakeStagehand {
  return {
    browser: { context: { newPage: () => Promise.resolve({ close: () => Promise.resolve() }) } },
    observe: observeImpl,
  };
}

describe('probeStep', () => {
  it('classifies suspect-3 when the tree named no elements', async () => {
    const call = { promptLength: 12, elementIds: [], treeExcerpt: '', answeredElementId: null };
    const stagehand = fakeStagehand(() => Promise.resolve({ data: [] }));

    const finding = await probeStep(stagehand, STEP, () => call);

    expect(finding.suspect).toBe('suspect-3-empty-tree');
    expect(finding.treeElementCount).toBe(0);
    expect(finding.error).toBeNull();
  });

  it('classifies suspect-2-pipeline-ok when the tree had elements and Stagehand echoed a real candidate', async () => {
    const call = {
      promptLength: 200,
      elementIds: ['0-18372'],
      treeExcerpt: '[0-18372] button "Flip"',
      answeredElementId: '0-18372',
    };
    const stagehand = fakeStagehand(() =>
      Promise.resolve({ data: [{ selector: 'xpath=//button', description: 'Flip', elementId: '0-18372' }] }),
    );

    const finding = await probeStep(stagehand, STEP, () => call);

    expect(finding.suspect).toBe('suspect-2-pipeline-ok');
    expect(finding.observedCandidateCount).toBe(1);
  });

  it('classifies stub-id-not-echoed-back when the tree had elements but Stagehand dropped the stub answer', async () => {
    const call = {
      promptLength: 200,
      elementIds: ['0-18372'],
      treeExcerpt: '[0-18372] button "Flip"',
      answeredElementId: '0-18372',
    };
    const stagehand = fakeStagehand(() => Promise.resolve({ data: [] }));

    const finding = await probeStep(stagehand, STEP, () => call);

    expect(finding.suspect).toBe('stub-id-not-echoed-back');
    expect(finding.observedCandidateCount).toBe(0);
  });

  it('records the observe error rather than throwing, and still classifies off the tree size', async () => {
    const call = { promptLength: 5, elementIds: [], treeExcerpt: '', answeredElementId: null };
    const stagehand = fakeStagehand(() => Promise.reject(new Error('page crashed')));

    const finding = await probeStep(stagehand, STEP, () => call);

    expect(finding.error).toBe('page crashed');
    expect(finding.suspect).toBe('suspect-3-empty-tree');
  });
});
