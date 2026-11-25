import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePrintedCardCatalog, type PrintedCardCatalog } from '@mtg/printed-card';
import type { CompletionRequest, CompletionResult } from '@mtg/llm';
import { printedCardRolesOf, printedSourceFingerprint, validatePrintedCardRoles } from '../src/index';
import type { CardRole } from '../src/index';
import { BATCH_SIZE, labelFormat, parseLabelArgs, roleAnswerSchema } from '../tools/printed-roles/label';

function catalogAt(path: string): PrintedCardCatalog {
  return parsePrintedCardCatalog(JSON.parse(readFileSync(path, 'utf8')));
}
const isd = catalogAt('packages/data/data/isd/isd-printed-catalog-v1.json');
const dkaIsd = catalogAt('packages/data/data/dka/isd-printed-catalog-v1.json');

/** A stand-in model: the first card of every batch is interaction, the rest have no role. */
function stubModel() {
  const prompts: string[] = [];
  const complete = async <T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> => {
    prompts.push(request.prompt);
    const asked = (JSON.parse(request.prompt) as { cards: { id: number }[] }).cards;
    const value = request.schema.parse({
      cards: asked.map(({ id }) => ({ id, roles: id === 1 ? ['interaction'] : [] })),
    });
    return { value, raw: '', meta: { model: 'stub-model' } as CompletionResult<T>['meta'] };
  };
  return { prompts, complete };
}

describe('printed card role labeling', () => {
  it('asks once per distinct printing, in batches, and covers every physical copy', async () => {
    const model = stubModel();
    const roles = await labelFormat('isd', [{ code: 'ISD', catalog: isd }], model.complete);
    const distinct = new Set(isd.cards.map(printedSourceFingerprint)).size;
    expect(distinct).toBeLessThan(isd.cards.length);
    expect(model.prompts).toHaveLength(Math.ceil(distinct / BATCH_SIZE));
    expect(roles.catalogs[0]!.cards).toHaveLength(isd.cards.length);
    expect(roles.source).toMatchObject({
      model: 'stub-model',
      vocabulary: ['interaction', 'draw', 'fixing'],
    });
    // Reprints of one printing share the label the single question got.
    const byFingerprint = new Map<number, readonly CardRole[]>();
    for (const [index, card] of isd.cards.entries()) {
      const labeled = roles.catalogs[0]!.cards[index]!.roles;
      const fingerprint = printedSourceFingerprint(card);
      expect(byFingerprint.get(fingerprint) ?? labeled).toEqual(labeled);
      byFingerprint.set(fingerprint, labeled);
    }
    expect(roles.catalogs[0]!.cards.filter((card) => card.roles.length > 0).length).toBeGreaterThanOrEqual(
      model.prompts.length,
    );
  });

  it('asks a block-mate catalog copy the same questions, so its recordings are reused', async () => {
    expect(dkaIsd.contentSha256).not.toBe(isd.contentSha256);
    const first = stubModel();
    const second = stubModel();
    await labelFormat('isd', [{ code: 'ISD', catalog: isd }], first.complete);
    await labelFormat('dka', [{ code: 'ISD', catalog: dkaIsd }], second.complete);
    expect(second.prompts).toEqual(first.prompts);
  });

  it('refuses an answer that skips or repeats a card', () => {
    const schema = roleAnswerSchema(2);
    expect(() => schema.parse({ cards: [{ id: 1, roles: [] }] })).toThrow(/exactly once/u);
    expect(() =>
      schema.parse({
        cards: [
          { id: 1, roles: [] },
          { id: 1, roles: [] },
        ],
      }),
    ).toThrow(/exactly once/u);
  });

  it('requires an output path and a live-call ceiling', () => {
    expect(parseLabelArgs(['--format', 'isd', '--out', 'x.json', '--max-calls', '3'])).toEqual({
      formatId: 'isd',
      out: 'x.json',
      maxCalls: 3,
      record: false,
    });
    expect(() => parseLabelArgs(['--format', 'isd', '--max-calls', '3'])).toThrow(/--out/u);
    expect(() => parseLabelArgs(['--format', 'isd', '--out', 'x.json'])).toThrow(/--max-calls/u);
  });
});

describe('printed card roles file', () => {
  async function labeled() {
    return labelFormat('isd', [{ code: 'ISD', catalog: isd }], stubModel().complete);
  }

  it('refuses a changed printing by name', async () => {
    const roles = await labeled();
    const card = isd.cards[3]!;
    const changed = { ...card, oracleText: `${card.oracleText ?? ''} Draw a card.` };
    const drifted = { ...isd, cards: isd.cards.map((entry, index) => (index === 3 ? changed : entry)) };
    expect(() => validatePrintedCardRoles(roles, [{ code: 'ISD', catalog: drifted }])).toThrow(
      `Printed card roles are stale for ${card.correctedName}`,
    );
    expect(() => printedCardRolesOf(roles, changed)).toThrow(/stale/u);
  });

  it('refuses a file missing a card, a catalog hash it was not labeled against, or unordered roles', async () => {
    const roles = await labeled();
    const short = {
      ...roles,
      catalogs: [{ ...roles.catalogs[0]!, cards: roles.catalogs[0]!.cards.slice(1) }],
    };
    expect(() => validatePrintedCardRoles(short, [{ code: 'ISD', catalog: isd }])).toThrow(/complete ISD/u);
    expect(() => validatePrintedCardRoles(roles, [{ code: 'ISD', catalog: dkaIsd }])).toThrow(
      /do not match catalog ISD/u,
    );
    const unordered = structuredClone(roles);
    unordered.catalogs[0]!.cards[0]!.roles = ['fixing', 'interaction'];
    expect(() => validatePrintedCardRoles(unordered, [{ code: 'ISD', catalog: isd }])).toThrow(/order/u);
  });

  it('answers a printing from the file it validated', async () => {
    const roles = validatePrintedCardRoles(await labeled(), [{ code: 'ISD', catalog: isd }]);
    expect(printedCardRolesOf(roles, isd.cards[0]!)).toEqual(['interaction']);
  });
});
