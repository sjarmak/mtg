import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { SessionSpec } from '@mtg/engine';
import type { ForgeInstall } from '@mtg/forge-export';
import { forgeObservedBackend, materializeForgeProfile, transpileSet } from '@mtg/forge-export';

const VALID = parseCard({
  kind: 'sorcery',
  id: 'cstm-shared-spark',
  name: 'Shared Spark',
  rarity: 'common',
  set: { code: 'CSTM', collectorNumber: 1 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  effects: [{ kind: 'loseLife', amount: 1, players: 'eachOpponent', target: { kind: 'noTarget' } }],
});

const TARGETED = parseCard({
  kind: 'instant',
  id: 'cstm-pointed-spark',
  name: 'Pointed Spark',
  rarity: 'common',
  set: { code: 'CSTM', collectorNumber: 4 },
  manaCost: { R: 1 },
  colors: ['R'],
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
});

const CUSTOM_FLAME_RIFT = parseCard({
  kind: 'sorcery',
  id: 'cstm-flame-rift',
  name: 'Flame Rift',
  rarity: 'common',
  set: { code: 'CSTM', collectorNumber: 5 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  effects: [{ kind: 'loseLife', amount: 4, players: 'eachOpponent', target: { kind: 'noTarget' } }],
});

const NONAUDITED_PRINTED_COLLISION = parseCard({
  ...VALID,
  id: 'cstm-archive-trap',
  name: 'Archive Trap',
  set: { code: 'CSTM', collectorNumber: 6 },
});

const OFFERED_MERCY = parseCard({
  kind: 'sorcery',
  id: 'cstm-offered-mercy',
  name: 'Offered Mercy',
  rarity: 'uncommon',
  set: { code: 'CSTM', collectorNumber: 2 },
  manaCost: { generic: 2, G: 1 },
  colors: ['G'],
  effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  may: 'you',
});

const DRAGONSKULL_SUMMIT = parseCard({
  kind: 'land',
  id: 'cstm-dragonskull-summit',
  name: 'Dragonskull Summit',
  rarity: 'rare',
  set: { code: 'CSTM', collectorNumber: 3 },
  producesMana: ['B', 'R'],
  entryReplacement: {
    kind: 'entersTappedUnlessControlsLandSubtype',
    landTypes: ['Swamp', 'Mountain'],
  },
});

const SECOND_SET_REJECTION = parseCard({
  kind: 'sorcery',
  id: 'bad-offered-mercy',
  name: 'Second Offered Mercy',
  rarity: 'uncommon',
  set: { code: 'BAD', collectorNumber: 1 },
  manaCost: { generic: 2, G: 1 },
  colors: ['G'],
  effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  may: 'you',
});

const MIXED: SessionSpec = {
  content: { kind: 'mixed', format: 'legacy-cube-2021-08', customSetCodes: ['CSTM'] },
  seats: [
    {
      name: 'Human',
      controller: 'local',
      deck: {
        name: 'mixed-human',
        cards: [
          { name: 'Mountain', count: 56, origin: { kind: 'printed' } },
          {
            name: 'Shared Spark',
            count: 4,
            origin: { kind: 'custom', setCode: 'CSTM', cardId: VALID.id },
          },
        ],
      },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: {
        name: 'red-ai',
        cards: [{ name: 'Mountain', count: 60, origin: { kind: 'printed' } }],
      },
    },
  ],
  seed: 'mixed-cache-proof',
  maximumTurns: 80,
};

const PRINTED: SessionSpec = {
  ...MIXED,
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { ...MIXED.seats[0], deck: { name: 'red', cards: [{ name: 'Mountain', count: 60 }] } },
    MIXED.seats[1],
  ],
};

const CHILD = String.raw`
const readline = require('node:readline');
const prefix = '@@MTG_FORGE_JSON@@';
function send(value) { process.stdout.write(prefix + JSON.stringify(value) + '\n'); }
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.type === 'hello') return send({ protocolVersion: 2, type: 'hello', requestId: request.requestId, forgeVersion: '2.0.14' });
  if (request.type === 'open') return send({
    protocolVersion: 2,
    type: 'snapshot',
    requestId: request.requestId,
    sessionId: 'mixed-session',
    revision: 0,
    status: 'finished',
    view: {
      version: 4,
      turn: { number: 1, active: 0, phase: 'Main', step: 'Main' },
      priority: null,
      stack: [],
      seats: [
        { id: 0, name: 'Human', life: 20, hand: [], handSize: 0, librarySize: 60, graveyard: [], exile: [], battlefield: [] },
        { id: 1, name: 'Forge AI', life: 20, hand: null, handSize: 0, librarySize: 60, graveyard: [], exile: [], battlefield: [] }
      ]
    },
    events: [],
    decision: null,
    result: { winner: 0, reason: 'fixture', endedOnTurn: 1 }
  });
  if (request.type === 'close') {
    send({ protocolVersion: 2, type: 'closed', requestId: request.requestId });
    return process.exit(0);
  }
});
`;

function testInstall(): ForgeInstall {
  const home = mkdtempSync(join(tmpdir(), 'mtg-forge-mixed-'));
  const userDir = join(home, 'isolated-user');
  return {
    home,
    jar: join(home, 'forge-gui-desktop-2.0.14-jar-with-dependencies.jar'),
    version: '2.0.14',
    userDir,
    customDir: join(userDir, 'custom'),
    decksDir: join(userDir, 'decks', 'constructed'),
  };
}

function backend(
  resolveCustomSet?: (setCode: string) => Promise<readonly Card[] | null>,
  beforeSpawn?: Parameters<typeof forgeObservedBackend>[0]['beforeSpawn'],
  acquireProfile?: Parameters<typeof forgeObservedBackend>[0]['acquireProfile'],
  printedCardNames: ReadonlySet<string> = new Set(['Flame Rift', 'Mountain']),
) {
  return forgeObservedBackend({
    command: process.execPath,
    args: ['-e', CHILD],
    cwd: process.cwd(),
    timeoutMs: 1_000,
    ...(resolveCustomSet === undefined ? {} : { resolveCustomSet }),
    ...(beforeSpawn === undefined ? {} : { beforeSpawn }),
    ...(acquireProfile === undefined ? {} : { acquireProfile }),
    printedCardNames,
  });
}

function profileMutex(): () => Promise<() => void> {
  let tail = Promise.resolve();
  return async () => {
    let releaseGate = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const previous = tail;
    tail = previous.then(() => gate);
    await previous;
    return releaseGate;
  };
}

describe('Forge observed mixed-content preparation', () => {
  it('caches the exact successful export across support and open, then writes an isolated profile', async () => {
    const install = testInstall();
    const resolveCustomSet = vi.fn(async () => [VALID]);
    const prepareProfile = vi.fn((exports) => {
      materializeForgeProfile(install, exports);
    });
    const forge = backend(resolveCustomSet, prepareProfile);

    expect(await forge.supports(MIXED)).toEqual([]);
    expect(resolveCustomSet).toHaveBeenCalledTimes(1);
    expect(prepareProfile).not.toHaveBeenCalled();
    expect(existsSync(join(install.home, 'forge.profile.properties'))).toBe(false);

    const opened = await forge.open(MIXED);
    expect(opened.ok).toBe(true);
    expect(resolveCustomSet).toHaveBeenCalledTimes(1);
    expect(prepareProfile).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(install.home, 'forge.profile.properties'), 'utf8')).toContain(
      `userDir=${install.userDir}`,
    );
    expect(readFileSync(join(install.customDir, 'cards', 'shared_spark.txt'), 'utf8')).toContain(
      'Name:Shared Spark',
    );
    expect(readFileSync(join(install.customDir, 'editions', 'CSTM.txt'), 'utf8')).toContain('Code=CSTM');
    if (opened.ok) await opened.session.close();
  });

  it('preserves every named card rejection and writes no partial profile or scripts', async () => {
    const install = testInstall();
    const resolveCustomSet = vi.fn(async () => [OFFERED_MERCY, DRAGONSKULL_SUMMIT]);
    const prepareProfile = vi.fn((exports) => {
      materializeForgeProfile(install, exports);
    });
    const forge = backend(resolveCustomSet, prepareProfile);

    const table: SessionSpec = {
      ...MIXED,
      seats: [
        {
          ...MIXED.seats[0],
          deck: {
            name: 'unsupported-custom',
            cards: [
              { name: 'Mountain', count: 56, origin: { kind: 'printed' } },
              {
                name: OFFERED_MERCY.name,
                count: 4,
                origin: { kind: 'custom', setCode: 'CSTM', cardId: OFFERED_MERCY.id },
              },
            ],
          },
        },
        MIXED.seats[1],
      ],
    };
    const reasons = await forge.supports(table);
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toMatch(
      /custom set "CSTM" card "Offered Mercy" \(cstm-offered-mercy\).*UNMAPPED_MAY_SPELL.*may/u,
    );
    expect(reasons[1]).toMatch(
      /custom set "CSTM" card "Dragonskull Summit" \(cstm-dragonskull-summit\).*UNMAPPED_NONBASIC_LAND.*entryReplacement/u,
    );
    expect(await forge.open(table)).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'unsupported', message: expect.stringContaining(reasons[0]!) }),
    });
    expect(resolveCustomSet).toHaveBeenCalledTimes(1);
    expect(prepareProfile).not.toHaveBeenCalled();
    expect(existsSync(join(install.home, 'forge.profile.properties'))).toBe(false);
    expect(existsSync(install.customDir)).toBe(false);
  });

  it('reports a missing resolver and a missing named set explicitly', async () => {
    expect(await backend().supports(MIXED)).toEqual([
      'mixed content requires an injected custom-set resolver',
    ]);
    expect(await backend(async () => null).supports(MIXED)).toEqual([
      'custom set "CSTM" could not be resolved',
    ]);
    const noCustomSets: SessionSpec = {
      ...MIXED,
      content: { kind: 'mixed', format: 'legacy-cube-2021-08', customSetCodes: [] },
    };
    expect(await backend(async () => [VALID]).supports(noCustomSets)).toEqual([
      'mixed content requires at least one custom set reference',
      'printed card "Shared Spark" is outside the audited Forge decision-family slice',
    ]);
  });

  it('withholds an earlier successful set when any later referenced set refuses', async () => {
    const install = testInstall();
    const table: SessionSpec = {
      ...MIXED,
      content: {
        kind: 'mixed',
        format: 'legacy-cube-2021-08',
        customSetCodes: ['CSTM', 'BAD'],
      },
      seats: [
        {
          ...PRINTED.seats[0],
          deck: {
            ...PRINTED.seats[0].deck,
            cards: [{ name: 'Mountain', count: 60, origin: { kind: 'printed' } }],
          },
        },
        {
          ...PRINTED.seats[1],
          deck: {
            ...PRINTED.seats[1].deck,
            cards: [{ name: 'Mountain', count: 60, origin: { kind: 'printed' } }],
          },
        },
      ],
    };
    const resolveCustomSet = vi.fn(async (setCode: string) =>
      setCode === 'CSTM' ? [VALID] : [SECOND_SET_REJECTION],
    );
    const prepareProfile = vi.fn((exports) => {
      materializeForgeProfile(install, exports);
    });
    const forge = backend(resolveCustomSet, prepareProfile);

    const reasons = await forge.supports(table);
    expect(resolveCustomSet.mock.calls.map(([setCode]) => setCode)).toEqual(['CSTM', 'BAD']);
    expect(reasons).toEqual([
      expect.stringMatching(
        /custom set "BAD" card "Second Offered Mercy" \(bad-offered-mercy\).*UNMAPPED_MAY_SPELL.*may/u,
      ),
    ]);
    expect(await forge.open(table)).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'unsupported' }),
    });
    expect(prepareProfile).not.toHaveBeenCalled();
    expect(existsSync(join(install.home, 'forge.profile.properties'))).toBe(false);
    expect(existsSync(install.customDir)).toBe(false);
  });

  it('replaces the custom tree so a later pure-printed session cannot see stale scripts', () => {
    const install = testInstall();
    const exported = transpileSet([VALID], { name: 'CSTM', date: '1970-01-01' });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    materializeForgeProfile(install, [exported.value]);
    const stale = join(install.customDir, 'cards', 'stale.txt');
    writeFileSync(stale, 'stale', 'utf8');

    materializeForgeProfile(install, []);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(install.customDir, 'cards', 'shared_spark.txt'))).toBe(false);
  });

  it('serializes profile ownership until the first observed session closes', async () => {
    const beforeSpawn = vi.fn();
    const forge = backend(undefined, beforeSpawn, profileMutex());
    const first = await forge.open(PRINTED);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    let secondSettled = false;
    const secondPromise = forge.open(PRINTED).then((result) => {
      secondSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(secondSettled).toBe(false);
    expect(beforeSpawn).toHaveBeenCalledTimes(1);

    await first.session.close();
    const second = await secondPromise;
    expect(second.ok).toBe(true);
    expect(beforeSpawn).toHaveBeenCalledTimes(2);
    if (second.ok) await second.session.close();
  });

  it('keys cached preparation by the whole session fingerprint while leaving printed support unchanged', async () => {
    const resolveCustomSet = vi.fn(async () => [VALID]);
    const forge = backend(resolveCustomSet);

    expect(await forge.supports(MIXED)).toEqual([]);
    expect(await forge.supports({ ...MIXED, seed: 'different-seed' })).toEqual([]);
    expect(await forge.supports({ ...MIXED, maximumTurns: 81 })).toEqual([]);
    expect(
      await forge.supports({
        ...MIXED,
        seats: [
          {
            ...MIXED.seats[0],
            deck: {
              ...MIXED.seats[0].deck,
              cards: [
                { name: 'Mountain', count: 55, origin: { kind: 'printed' } },
                {
                  name: 'Shared Spark',
                  count: 5,
                  origin: { kind: 'custom', setCode: 'CSTM', cardId: VALID.id },
                },
              ],
            },
          },
          MIXED.seats[1],
        ],
      }),
    ).toEqual([]);
    expect(resolveCustomSet).toHaveBeenCalledTimes(4);

    expect(await forge.supports(PRINTED)).toEqual([]);
    expect(resolveCustomSet).toHaveBeenCalledTimes(4);
  });

  it('does not let a custom card name widen the pure-printed audited slice', async () => {
    const purePrintedWithCustomName: SessionSpec = {
      ...PRINTED,
      seats: [
        {
          ...PRINTED.seats[0],
          deck: {
            name: 'printed-by-name',
            cards: [
              { name: 'Mountain', count: 56 },
              { name: 'Shared Spark', count: 4 },
            ],
          },
        },
        PRINTED.seats[1],
      ],
    };
    expect(await backend(async () => [VALID]).supports(purePrintedWithCustomName)).toEqual([
      'printed card "Shared Spark" is outside the audited Forge decision-family slice',
    ]);
  });

  it('refuses a transpilable custom card whose target choice the bridge cannot enumerate', async () => {
    const table: SessionSpec = {
      ...MIXED,
      seats: [
        {
          ...MIXED.seats[0],
          deck: {
            name: 'targeted-human',
            cards: [
              { name: 'Mountain', count: 56, origin: { kind: 'printed' } },
              {
                name: 'Pointed Spark',
                count: 4,
                origin: { kind: 'custom', setCode: 'CSTM', cardId: TARGETED.id },
              },
            ],
          },
        },
        MIXED.seats[1],
      ],
    };
    expect(await backend(async () => [TARGETED]).supports(table)).toEqual([
      expect.stringMatching(
        /custom set "CSTM" card "Pointed Spark" \(cstm-pointed-spark\).*effects\[0\]\.target\.kind.*target-free/u,
      ),
    ]);
  });

  it('refuses ambiguous custom names across sets and against audited printed cards', async () => {
    const otherSharedSpark = parseCard({
      ...VALID,
      id: 'other-shared-spark',
      set: { code: 'OTHR', collectorNumber: 1 },
    });
    const table: SessionSpec = {
      ...MIXED,
      content: {
        kind: 'mixed',
        format: 'legacy-cube-2021-08',
        customSetCodes: ['CSTM', 'OTHR'],
      },
    };
    const reasons = await backend(async (setCode) =>
      setCode === 'CSTM' ? [VALID, CUSTOM_FLAME_RIFT] : [otherSharedSpark],
    ).supports(table);
    expect(reasons).toEqual([
      expect.stringMatching(/custom card "Flame Rift".*collides with a printed card/u),
      expect.stringMatching(/custom card "Shared Spark".*ambiguous.*"CSTM".*"OTHR"/u),
    ]);
  });

  it('refuses a collision anywhere in the authoritative printed inventory before a profile write', async () => {
    const beforeSpawn = vi.fn();
    const table: SessionSpec = {
      ...MIXED,
      seats: [
        {
          ...MIXED.seats[0],
          deck: {
            name: 'collision',
            cards: [
              { name: 'Mountain', count: 56, origin: { kind: 'printed' } },
              {
                name: 'Archive Trap',
                count: 4,
                origin: {
                  kind: 'custom',
                  setCode: 'CSTM',
                  cardId: NONAUDITED_PRINTED_COLLISION.id,
                },
              },
            ],
          },
        },
        MIXED.seats[1],
      ],
    };
    const forge = backend(
      async () => [NONAUDITED_PRINTED_COLLISION],
      beforeSpawn,
      undefined,
      new Set(['Archive Trap', 'Flame Rift', 'Mountain']),
    );

    expect(await forge.supports(table)).toEqual([
      expect.stringMatching(/custom card "Archive Trap".*collides with a printed card/u),
    ]);
    expect(await forge.open(table)).toMatchObject({ ok: false, error: { kind: 'unsupported' } });
    expect(beforeSpawn).not.toHaveBeenCalled();
  });

  it('requires every mixed slot to resolve through its declared origin', async () => {
    const bare = {
      ...MIXED,
      seats: [
        {
          ...MIXED.seats[0],
          deck: { name: 'bare', cards: [{ name: 'Shared Spark', count: 1 }] },
        },
        MIXED.seats[1],
      ],
    } as SessionSpec;
    const unknownCard: SessionSpec = {
      ...MIXED,
      seats: [
        {
          ...MIXED.seats[0],
          deck: {
            name: 'unknown-card',
            cards: [
              {
                name: 'Shared Spark',
                count: 1,
                origin: { kind: 'custom', setCode: 'CSTM', cardId: 'not-in-the-set' },
              },
            ],
          },
        },
        MIXED.seats[1],
      ],
    };
    const undeclaredSet: SessionSpec = {
      ...MIXED,
      seats: [
        {
          ...MIXED.seats[0],
          deck: {
            name: 'undeclared-set',
            cards: [
              {
                name: 'Shared Spark',
                count: 1,
                origin: { kind: 'custom', setCode: 'OTHR', cardId: VALID.id },
              },
            ],
          },
        },
        MIXED.seats[1],
      ],
    };
    const forge = backend(async () => [VALID]);

    expect(await forge.supports(bare)).toContain(
      'mixed deck slot "Shared Spark" has no explicit printed or custom origin',
    );
    expect(await forge.supports(unknownCard)).toContain(
      'custom deck slot "Shared Spark" names unknown card id "not-in-the-set" in set "CSTM"',
    );
    expect(await forge.supports(undeclaredSet)).toContain(
      'custom deck slot "Shared Spark" names undeclared set "OTHR"',
    );
  });

  it('reports custom-name ambiguity identically regardless of reference and resolver order', async () => {
    const other = parseCard({
      ...VALID,
      id: 'other-shared-spark',
      set: { code: 'OTHR', collectorNumber: 1 },
    });
    const forward: SessionSpec = {
      ...MIXED,
      content: {
        kind: 'mixed',
        format: 'legacy-cube-2021-08',
        customSetCodes: ['CSTM', 'OTHR'],
      },
    };
    const reverse: SessionSpec = {
      ...forward,
      content: {
        kind: 'mixed',
        format: 'legacy-cube-2021-08',
        customSetCodes: ['OTHR', 'CSTM'],
      },
    };
    const resolve = async (setCode: string): Promise<readonly Card[]> =>
      setCode === 'CSTM' ? [VALID] : [other];

    const forwardReasons = await backend(resolve).supports(forward);
    const reverseReasons = await backend(resolve).supports(reverse);
    expect(forwardReasons).toEqual(reverseReasons);
    expect(forwardReasons).toContain(
      'custom card "Shared Spark" is ambiguous between custom sets "CSTM" and "OTHR"',
    );
  });

  it('refuses distinct cross-set names that collapse onto one Forge script path', async () => {
    const punctuationVariant = parseCard({
      ...VALID,
      id: 'other-shared-spark-punctuation',
      name: 'Shared: Spark!',
      set: { code: 'OTHR', collectorNumber: 1 },
    });
    const table: SessionSpec = {
      ...PRINTED,
      content: {
        kind: 'mixed',
        format: 'legacy-cube-2021-08',
        customSetCodes: ['CSTM', 'OTHR'],
      },
      seats: [
        {
          ...PRINTED.seats[0],
          deck: {
            ...PRINTED.seats[0].deck,
            cards: [{ name: 'Mountain', count: 60, origin: { kind: 'printed' } }],
          },
        },
        {
          ...PRINTED.seats[1],
          deck: {
            ...PRINTED.seats[1].deck,
            cards: [{ name: 'Mountain', count: 60, origin: { kind: 'printed' } }],
          },
        },
      ],
    };
    expect(
      await backend(async (setCode) => (setCode === 'CSTM' ? [VALID] : [punctuationVariant])).supports(table),
    ).toEqual([
      'Forge custom script "shared_spark.txt" collides between "Shared Spark" in "CSTM" and "Shared: Spark!" in "OTHR"',
    ]);
  });
});
