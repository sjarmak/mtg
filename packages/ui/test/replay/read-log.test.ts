/**
 * The reader is a boundary: everything it accepts must be complete enough to
 * render without a fallback branch, and everything it rejects must say which
 * line was wrong.
 */
import { describe, expect, it } from 'vitest';
import { EventLogError, readEventLog } from '../../src/routes/replay/read-log';
import { fixtureLog, fixtureText } from './support/log-fixture';

function lines(): string[] {
  return fixtureText().trimEnd().split('\n');
}

function rebuild(mutate: (rows: string[]) => void): string {
  const rows = lines();
  mutate(rows);
  return `${rows.join('\n')}\n`;
}

function rewriteJsonRows(rows: string[], rewrite: (record: Record<string, unknown>) => void): void {
  for (const [index, row] of rows.entries()) {
    const record = JSON.parse(row) as Record<string, unknown>;
    rewrite(record);
    rows[index] = JSON.stringify(record);
  }
}

function downgrade(rows: string[], version: '3' | '4' | '5' | '6' | '7'): void {
  const header = rows[0];
  if (header === undefined) throw new Error('the fixture has no header');
  rows[0] = header.replace('event-log/8', `event-log/${version}`);
  rewriteJsonRows(rows, (record) => {
    if (record.record !== 'step') return;
    const state = record.state as { readonly stack: Record<string, unknown>[] } | null;
    for (const entry of state?.stack ?? []) {
      if (version !== '6' && version !== '7') delete entry.triggerContext;
      if (version !== '7') delete entry.sourceCharacteristics;
    }
  });
}

function rewriteAsReleasedVersion(rows: string[], version: '3' | '4' | '5' | '6'): void {
  downgrade(rows, version);
  rewriteJsonRows(rows, (record) => {
    if (record.record !== 'step') return;
    const state = record.state as { readonly stack: Record<string, unknown>[] } | null;
    if (version !== '3') return;
    for (const event of record.events as Record<string, unknown>[]) {
      if (event.type === 'spellCast') delete event.chosenX;
    }
    for (const entry of state?.stack ?? []) {
      delete entry.card;
      delete entry.copiedFrom;
      delete entry.chosenX;
    }
  });
}

const TEST_WALKER = {
  id: 'replay-test-walker',
  name: 'Replay Test Walker',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  colors: [],
  supertypes: ['legendary'],
  subtypes: ['Witness'],
  keywords: [],
  effects: [],
  abilities: [],
  kind: 'planeswalker',
  manaCost: { generic: 3, W: 0, U: 0, B: 0, R: 0, G: 0 },
  startingLoyalty: 3,
} as const;

function injectTaggedWalker(rows: string[], loyalty: boolean, tagged = true): void {
  let objectAdded = false;
  let permanentAdded = false;
  rewriteJsonRows(rows, (record) => {
    if (record.record === 'game' && record.game === 0) {
      (record.cards as Record<string, unknown>)[TEST_WALKER.id] = TEST_WALKER;
      (record.objects as Record<string, unknown>)['walker-o'] = {
        card: TEST_WALKER.id,
        owner: 1,
        token: false,
      };
      objectAdded = true;
      return;
    }
    if (permanentAdded || record.record !== 'step' || record.game !== 0) return;
    const events = record.events as Record<string, unknown>[];
    const declared = events.find((event) => event.type === 'attackersDeclared');
    const state = record.state as { readonly battlefield: Record<string, unknown>[] } | null;
    if (declared === undefined || state === null) return;
    const first = (declared.attacks as Record<string, unknown>[])[0];
    if (first === undefined) throw new Error('the fixture declared no attacker');
    if (tagged) first.defender = { kind: 'planeswalker', oid: 'walker-o' };
    state.battlefield.push({
      oid: 'walker-o',
      controller: 1,
      tapped: false,
      summoningSick: false,
      damage: 0,
      plusCounters: 0,
      minusCounters: 0,
      ...(loyalty ? { loyalty: 3 } : {}),
      power: null,
      toughness: null,
      attachedTo: null,
      attacking: false,
      blocking: false,
    });
    permanentAdded = true;
  });
  if (!objectAdded || !permanentAdded) throw new Error('the fixture could not host a walker');
}

type ScryEvidence = 'action' | 'event' | 'decision';

function injectScryEvidence(
  rows: string[],
  version: '3' | '4' | '5' | '6' | '7',
  evidence: ScryEvidence,
): void {
  downgrade(rows, version);
  let changed = false;
  rewriteJsonRows(rows, (record) => {
    if (record.record === 'header') return;
    if (changed || record.record !== 'step') return;
    if (evidence === 'action') {
      record.action = { type: 'scry', player: 0, top: ['top-o'], bottom: ['bottom-o'] };
    } else if (evidence === 'event') {
      (record.events as Record<string, unknown>[]).push({
        type: 'cardsScried',
        player: 0,
        count: 2,
        bottom: 1,
      });
    } else {
      record.decision = {
        kind: 'scry',
        player: 0,
        optionCount: 1,
        truncated: false,
        complete: true,
        options: [],
        chosen: null,
      };
    }
    changed = true;
  });
  if (!changed) throw new Error('the fixture has no step for scry evidence');
}

describe('readEventLog', () => {
  it('reads the committed fixture into games with resolved frames', () => {
    const log = fixtureLog();
    expect(log.games.length).toBe(2);
    for (const game of log.games) {
      expect(game.steps.length).toBeGreaterThan(0);
      expect(game.steps[0]?.seq).toBe(0);
      for (const [index, step] of game.steps.entries()) {
        expect(step.seq).toBe(index);
        expect(step.state.seats.length).toBe(2);
      }
    }
  });

  it('carries a snapshot forward across steps that recorded none', () => {
    const rows = lines();
    const carried = rows.filter((row) => row.includes('"record":"step"') && row.includes('"state":null'));
    expect(carried.length).toBeGreaterThan(0);

    const log = fixtureLog();
    const game = log.games[0];
    if (game === undefined) throw new Error('the fixture has no games');
    const withoutState = game.steps.filter((step, index) => {
      const previous = game.steps[index - 1];
      return previous !== undefined && step.state === previous.state;
    });
    expect(withoutState.length).toBeGreaterThan(0);
  });

  it('names every object a snapshot mentions', () => {
    const log = fixtureLog();
    for (const game of log.games) {
      for (const step of game.steps) {
        for (const permanent of step.state.battlefield) {
          expect(game.objects.get(permanent.oid)).toBeDefined();
        }
      }
    }
  });

  it('rejects an empty log', () => {
    expect(() => readEventLog('   \n')).toThrow(EventLogError);
  });

  it('rejects a log whose first line is not a header', () => {
    const rows = lines();
    const first = rows[1];
    if (first === undefined) throw new Error('the fixture has no game record');
    expect(() => readEventLog(`${first}\n`)).toThrow(/line 1/);
  });

  it('rejects a step whose seq is out of order', () => {
    const text = rebuild((rows) => {
      const target = rows.findIndex((row) => row.includes('"seq":3,'));
      const row = rows[target];
      if (row === undefined) throw new Error('the fixture has no step 3');
      rows[target] = row.replace('"seq":3,', '"seq":9,');
    });
    expect(() => readEventLog(text)).toThrow(/out of order/);
  });

  it('rejects a snapshot naming an object the game does not carry', () => {
    const text = rebuild((rows) => {
      const target = rows.findIndex((row) => row.includes('"battlefield":[{'));
      const row = rows[target];
      if (row === undefined) throw new Error('the fixture has no populated battlefield');
      rows[target] = row.replace('"battlefield":[{"oid":"', '"battlefield":[{"oid":"ghost-');
    });
    expect(() => readEventLog(text)).toThrow(/unknown object/);
  });

  it('rejects an unknown record kind', () => {
    const text = rebuild((rows) => {
      rows.push(JSON.stringify({ record: 'summary', note: 'not a thing' }));
    });
    expect(() => readEventLog(text)).toThrow(/unknown record kind/);
  });

  it('rejects a header whose game count disagrees with the file', () => {
    const text = rebuild((rows) => {
      const header = rows[0];
      if (header === undefined) throw new Error('the fixture has no header');
      rows[0] = header.replace('"games":2', '"games":5');
    });
    expect(() => readEventLog(text)).toThrow(/declares 5 games/);
  });

  it('rejects a step record with a field the schema does not know', () => {
    const text = rebuild((rows) => {
      const target = rows.findIndex((row) => row.includes('"record":"step"'));
      const row = rows[target];
      if (row === undefined) throw new Error('the fixture has no steps');
      rows[target] = `${row.slice(0, -1)},"extra":1}`;
    });
    expect(() => readEventLog(text)).toThrow(/invalid step record/);
  });

  it('rejects symbolic X in manaPaid evidence because payment retains a fixed cost', () => {
    const text = rebuild((rows) => {
      const target = rows.findIndex((row) => row.includes('"type":"manaPaid"'));
      const row = rows[target];
      if (row === undefined) throw new Error('the fixture has no mana payment');
      rows[target] = row.replace('"cost":{"generic":', '"cost":{"x":true,"generic":');
    });
    expect(() => readEventLog(text)).toThrow(/invalid step record/);
  });

  it('migrates released /3 spell events and stack entries to the current shape', () => {
    const text = rebuild((rows) => {
      rewriteJsonRows(rows, (record) => {
        if (record.record === 'header') record.schema = 'mtg-ui/event-log/3';
        if (record.record !== 'step') return;

        const events = record.events as Record<string, unknown>[];
        for (const event of events) {
          if (event.type === 'spellCast') delete event.chosenX;
        }

        const state = record.state as { readonly stack: Record<string, unknown>[] } | null;
        if (state === null) return;
        for (const entry of state.stack) {
          delete entry.card;
          delete entry.copiedFrom;
          delete entry.chosenX;
          delete entry.triggerContext;
          delete entry.sourceCharacteristics;
        }
      });
    });

    const log = readEventLog(text);
    const stack = log.games.flatMap((game) => game.steps.flatMap((step) => step.state.stack));
    expect(stack.length).toBeGreaterThan(0);
    expect(stack.every((entry) => entry.card === (entry.source ?? entry.oid))).toBe(true);
    expect(stack.every((entry) => entry.copiedFrom === null && entry.chosenX === null)).toBe(true);
    expect(stack.every((entry) => entry.triggerContext === null)).toBe(true);
    expect(
      log.games
        .flatMap((game) => game.steps)
        .flatMap((step) => step.events)
        .filter((event) => event.type === 'spellCast')
        .every((event) => event.chosenX === null),
    ).toBe(true);
  });

  it('rejects regeneration event evidence added only in /7 under every older header', () => {
    const additions = [
      { type: 'replacementApplied', id: 'regeneration:hostile', event: 'destroy' },
      { type: 'permanentRegenerated', oid: 'o1' },
    ] as const;
    for (const version of ['3', '4', '5', '6'] as const) {
      for (const addition of additions) {
        const text = rebuild((rows) => {
          rewriteAsReleasedVersion(rows, version);
          let inserted = false;
          rewriteJsonRows(rows, (record) => {
            if (inserted || record.record !== 'step') return;
            (record.events as Record<string, unknown>[]).push(addition);
            inserted = true;
          });
          if (!inserted) throw new Error('the fixture has no step for hostile regeneration evidence');
        });
        expect(() => readEventLog(text)).toThrow(
          new RegExp(`event-log/${version}.*regeneration event evidence`),
        );
      }
    }
  });

  it('accepts /7 regeneration evidence without widening any earlier grammar', () => {
    const text = rebuild((rows) => {
      downgrade(rows, '7');
      let inserted = false;
      rewriteJsonRows(rows, (record) => {
        if (inserted || record.record !== 'step') return;
        (record.events as Record<string, unknown>[]).push({
          type: 'permanentRegenerated',
          oid: 'o1',
        });
        inserted = true;
      });
      if (!inserted) throw new Error('the fixture has no step for /7 regeneration evidence');
    });
    expect(readEventLog(text).games).toHaveLength(2);
  });

  it('preserves the /6 trigger context and adds only null source characteristics', () => {
    const text = rebuild((rows) => {
      downgrade(rows, '6');
      let inserted = false;
      rewriteJsonRows(rows, (record) => {
        if (inserted || record.record !== 'step') return;
        const state = record.state as { readonly stack: Record<string, unknown>[] } | null;
        const entry = state?.stack[0];
        if (entry === undefined || typeof entry.card !== 'string') return;
        entry.triggerContext = {
          kind: 'controlledCreatureAttacksAlone',
          triggeringCreature: entry.card,
        };
        inserted = true;
      });
      if (!inserted) throw new Error('the fixture has no stack entry for /6 trigger context');
    });
    const stack = readEventLog(text).games.flatMap((game) => game.steps.flatMap((step) => step.state.stack));
    expect(stack.some((entry) => entry.triggerContext !== null)).toBe(true);
    expect(stack.every((entry) => entry.sourceCharacteristics === null)).toBe(true);
  });

  it('preserves both /7 stack provenance fields', () => {
    const text = rebuild((rows) => {
      downgrade(rows, '7');
      let inserted = false;
      rewriteJsonRows(rows, (record) => {
        if (inserted || record.record !== 'step') return;
        const state = record.state as { readonly stack: Record<string, unknown>[] } | null;
        const entry = state?.stack[0];
        if (entry === undefined || typeof entry.card !== 'string') return;
        entry.triggerContext = {
          kind: 'controlledCreatureAttacksAlone',
          triggeringCreature: entry.card,
        };
        entry.sourceCharacteristics = { colors: ['B'], subtypes: ['Knight'] };
        inserted = true;
      });
      if (!inserted) throw new Error('the fixture has no stack entry for /7 provenance');
    });
    const stack = readEventLog(text).games.flatMap((game) => game.steps.flatMap((step) => step.state.stack));
    expect(stack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          triggerContext: expect.objectContaining({ kind: 'controlledCreatureAttacksAlone' }),
          sourceCharacteristics: { colors: ['B'], subtypes: ['Knight'] },
        }),
      ]),
    );
  });

  it('rejects provenance fields under every header released before each field', () => {
    for (const version of ['3', '4', '5'] as const) {
      const trigger = rebuild((rows) => {
        downgrade(rows, version);
        let inserted = false;
        rewriteJsonRows(rows, (record) => {
          if (inserted || record.record !== 'step') return;
          const state = record.state as { readonly stack: Record<string, unknown>[] } | null;
          const entry = state?.stack[0];
          if (entry === undefined || typeof entry.card !== 'string') return;
          entry.triggerContext = {
            kind: 'controlledCreatureAttacksAlone',
            triggeringCreature: entry.card,
          };
          inserted = true;
        });
        if (!inserted) throw new Error('the fixture has no stack entry for hostile trigger context');
      });
      expect(() => readEventLog(trigger)).toThrow(new RegExp(`event-log/${version}.*trigger context`));
    }
    for (const version of ['3', '4', '5', '6'] as const) {
      const characteristics = rebuild((rows) => {
        downgrade(rows, version);
        let inserted = false;
        rewriteJsonRows(rows, (record) => {
          if (inserted || record.record !== 'step') return;
          const state = record.state as { readonly stack: Record<string, unknown>[] } | null;
          const entry = state?.stack[0];
          if (entry === undefined) return;
          entry.sourceCharacteristics = { colors: ['B'], subtypes: ['Knight'] };
          inserted = true;
        });
        if (!inserted) throw new Error('the fixture has no stack entry for hostile source evidence');
      });
      expect(() => readEventLog(characteristics)).toThrow(
        new RegExp(`event-log/${version}.*source-characteristic evidence`),
      );
    }
  });

  it('rejects planeswalker-only defender and loyalty fields under released /4', () => {
    const taggedDefender = rebuild((rows) => {
      downgrade(rows, '4');
      const target = rows.findIndex((row) => row.includes('"type":"attackersDeclared"'));
      const row = rows[target];
      if (row === undefined) throw new Error('the fixture has no declared attack');
      rows[target] = row.replace(/"defender":[01]/, '"defender":{"kind":"planeswalker","oid":"o13"}');
    });
    expect(() => readEventLog(taggedDefender)).toThrow(/event-log\/4.*planeswalker defender/);

    const loyalty = rebuild((rows) => {
      downgrade(rows, '4');
      let changed = false;
      rewriteJsonRows(rows, (record) => {
        if (changed || record.record !== 'step') return;
        const state = record.state as { readonly battlefield: Record<string, unknown>[] } | null;
        const permanent = state?.battlefield[0];
        if (permanent === undefined) return;
        permanent.loyalty = 3;
        changed = true;
      });
      if (!changed) throw new Error('the fixture has no populated battlefield');
    });
    expect(() => readEventLog(loyalty)).toThrow(/event-log\/4.*loyalty/);
  });

  it('accepts tagged planeswalker defenders and loyalty under /5 through /7', () => {
    for (const version of ['5', '6', '7'] as const) {
      const text = rebuild((rows) => {
        downgrade(rows, version);
        injectTaggedWalker(rows, true);
      });

      const log = readEventLog(text);
      expect(log.games.length).toBe(2);
    }
  });

  it('requires loyalty on current-version battlefield planeswalkers', () => {
    const missing = rebuild((rows) => injectTaggedWalker(rows, false));
    expect(() => readEventLog(missing)).toThrow(/planeswalker.*loyalty/i);

    const creature = rebuild((rows) => {
      let changed = false;
      rewriteJsonRows(rows, (record) => {
        if (changed || record.record !== 'step') return;
        const state = record.state as { readonly battlefield: Record<string, unknown>[] } | null;
        const permanent = state?.battlefield[0];
        if (permanent === undefined) return;
        permanent.loyalty = 3;
        changed = true;
      });
      if (!changed) throw new Error('the fixture has no populated battlefield');
    });
    expect(() => readEventLog(creature)).toThrow(/nonplaneswalker.*loyalty/i);
  });

  it('binds every tagged defender to a carried battlefield planeswalker', () => {
    const ghost = rebuild((rows) => {
      const target = rows.findIndex((row) => row.includes('"type":"attackersDeclared"'));
      const row = rows[target];
      if (row === undefined) throw new Error('the fixture has no declared attack');
      rows[target] = row.replace(
        /"defender":[01]/,
        '"defender":{"kind":"planeswalker","oid":"ghost-walker"}',
      );
    });
    expect(() => readEventLog(ghost)).toThrow(/unknown planeswalker defender ghost-walker/);

    const creature = rebuild((rows) => {
      const target = rows.findIndex((row) => row.includes('"type":"attackersDeclared"'));
      const row = rows[target];
      if (row === undefined) throw new Error('the fixture has no declared attack');
      rows[target] = row.replace(/"defender":[01]/, '"defender":{"kind":"planeswalker","oid":"o13"}');
    });
    expect(() => readEventLog(creature)).toThrow(/defender o13.*not a planeswalker/);
  });

  it('rejects a battlefield planeswalker under /3 or /4 before loyalty can be fabricated', () => {
    for (const version of ['3', '4']) {
      const text = rebuild((rows) => {
        downgrade(rows, version as '3' | '4');
        injectTaggedWalker(rows, false, false);
        if (version !== '3') return;
        rewriteJsonRows(rows, (record) => {
          if (record.record !== 'step') return;
          for (const event of record.events as Record<string, unknown>[]) {
            if (event.type === 'spellCast') delete event.chosenX;
          }
          const state = record.state as { readonly stack: Record<string, unknown>[] } | null;
          for (const entry of state?.stack ?? []) {
            delete entry.card;
            delete entry.copiedFrom;
            delete entry.chosenX;
            delete entry.sourceCharacteristics;
          }
        });
      });
      expect(() => readEventLog(text)).toThrow(new RegExp(`event-log/${version}.*planeswalker`));
    }
  });

  it('rejects every kind of scry evidence under released /3 through /7 headers', () => {
    for (const version of ['3', '4', '5', '6', '7'] as const) {
      for (const evidence of ['action', 'event', 'decision'] as const) {
        const text = rebuild((rows) => injectScryEvidence(rows, version, evidence));
        expect(() => readEventLog(text), `${version}/${evidence}`).toThrow(
          new RegExp(`event-log/${version}.*scry ${evidence} evidence`),
        );
      }
    }
  });
});
