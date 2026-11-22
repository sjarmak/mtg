import { expect, it } from 'vitest';
import { scriptBackend, type SessionSpec } from '@mtg/engine';
import { BROWSER_BACKEND_PROTOCOL, httpObservedBackend } from '@mtg/ui';

const table: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'characteristics-gateway',
  maximumTurns: null,
};

async function read(extra: Record<string, unknown>) {
  const opened = await scriptBackend().open(table);
  if (!opened.ok) throw new Error(opened.error.message);
  const session = opened.session;
  const view = {
    ...session.view,
    stack: [
      {
        oid: 'test-object',
        name: 'test object',
        typeLine: 'creature',
        power: 1,
        toughness: 1,
        tapped: false,
        attacking: false,
        damage: 0,
        controller: 0,
        counters: {},
        ...extra,
      },
    ],
  };
  const request: typeof fetch = async () =>
    Response.json({
      protocol: BROWSER_BACKEND_PROTOCOL,
      ok: true,
      token: 'test-capability',
      revision: 0,
      session: {
        backend: 'forge',
        determinism: session.determinism,
        table: session.table,
        status: session.status,
        events: session.events,
        decision: session.decision,
        play: session.play ?? null,
        result: session.result,
        submitted: session.submitted,
        localSeats: session.localSeats,
        transcript: session.transcript.map((frame) => ({ ...frame, view })),
        view,
      },
    });
  try {
    return await httpObservedBackend({ id: 'forge', fetch: request }).open(table);
  } finally {
    await session.close();
  }
}

it.each([
  { colors: ['B'], manaCost: null, token: true },
  { colors: [], manaCost: '{0}', token: false },
])('preserves public characteristics across the browser boundary: %j', async (characteristics) => {
  const result = await read({ characteristics });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.session.view.stack[0]).toMatchObject({ characteristics });
});

it('accepts objects with unreported characteristics', async () => {
  const result = await read({});
  if (!result.ok) throw new Error(result.error.message);
  expect(result.session.view.stack[0]).not.toHaveProperty('characteristics');
});

it.each([
  null,
  { manaCost: null, token: true },
  { colors: 'B', manaCost: null, token: true },
  { colors: ['B'], token: true },
  { colors: ['C'], manaCost: null, token: true },
  { colors: [], manaCost: '', token: false },
  { colors: [], manaCost: 0, token: false },
  { colors: [], manaCost: null, token: 'yes' },
  { colors: [], manaCost: null, token: true, extra: 'unexpected' },
])('rejects invalid public characteristics at the browser boundary: %j', async (characteristics) => {
  const result = await read({ characteristics });
  expect(result).toMatchObject({ ok: false, error: { kind: 'backend-failure' } });
});
