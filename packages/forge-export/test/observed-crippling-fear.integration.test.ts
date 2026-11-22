/**
 * Crippling Fear asks for a creature type, and Forge's list holds four with a
 * character that is not a letter: Time Lord, Assembly-Worker, C'tan and Shi'ar.
 * The bridge once refused the whole question over any one of them ("Forge
 * offered a type without a stable wire id"), which ended a Commander game on
 * the card's first cast. Now the id carries a slug and the answer carries the
 * name, and this witness casts the card, reads Time Lord off the offer, names
 * it, and sees the spell resolve.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { COMMANDER_RULES } from '@mtg/engine';
import { compileInstalledForgeBridge, installedForgeDiagnosticBackend } from '../src/observed/installed';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
const FEAR = 'Crippling Fear';
const KARDUR = 'Kardur, Doomscourge';
const CARD_NAMES = new Set(['Swamp', 'Mountain', FEAR, KARDUR]);
const SLUG = /^type-choice-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;

let compiled: ReturnType<typeof compileInstalledForgeBridge>;
beforeAll(() => {
  if (required) compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'scd' },
  rules: COMMANDER_RULES,
  seats: [
    {
      name: 'Local general',
      controller: 'local',
      deck: {
        name: 'fear',
        cards: [
          { name: 'Swamp', count: 40 },
          { name: FEAR, count: 20 },
        ],
        commanders: [{ name: KARDUR, count: 1 }],
      },
    },
    {
      name: 'Native general',
      controller: 'engine',
      deck: {
        name: 'kardur',
        cards: [
          { name: 'Swamp', count: 30 },
          { name: 'Mountain', count: 30 },
        ],
        commanders: [{ name: KARDUR, count: 1 }],
      },
    },
  ],
  seed: 'scd-crippling-fear-time-lord-v1',
  maximumTurns: 14,
};

type Decision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: Decision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  }
  return decision.options.find(
    (option) =>
      option.text === 'Pass priority' ||
      option.text === 'Keep this hand' ||
      option.text === 'Play first' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

describe.skipIf(!required)('Crippling Fear through the installed Forge bridge', () => {
  it('offers every creature type under a stable wire id and names one with a space in it', async () => {
    const bridge = compiled;
    if (!bridge) throw new Error('Installed Forge required');
    const backend = installedForgeDiagnosticBackend(CARD_NAMES, {
      compiledBridgeClasses: bridge.classDirectory,
      timeoutMs: 180_000,
    });
    if (backend === null) throw new Error('Installed Forge required');
    expect(await backend.supports(TABLE)).toEqual([]);
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let offered: readonly string[] | null = null;
    let named: string | null = null;
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let submitted = 0; session.status === 'awaiting' && submitted < 600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const me = session.view.seats[0];
        trace.push(
          `t${String(session.view.turn.number)} ${decision.kind}: ${decision.prompt} || ${decision.options
            .map((option) => option.text)
            .join(' | ')}`,
        );
        if (named !== null && session.view.stack.length === 0 && me.graveyard.some((c) => c.name === FEAR)) {
          resolved = true;
          break;
        }
        let move: string | undefined;
        if (decision.kind === 'type-choice') {
          expect(decision.prompt).toContain(FEAR);
          offered = decision.options.map((option) => option.text);
          const timeLord = decision.options.find((option) => option.id === 'type-choice-Time-Lord');
          if (timeLord === undefined) throw new Error(`Time Lord not offered\n${trace.slice(-6).join('\n')}`);
          expect(timeLord.text).toBe('Time Lord [type-choice-Time-Lord]');
          named = timeLord.id;
          move = timeLord.id;
        } else if (decision.kind === 'priority') {
          const untapped = me.battlefield.filter((card) => card.name === 'Swamp' && !card.tapped).length;
          move =
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            (untapped >= 4 && named === null
              ? decision.options.find((option) => option.text.startsWith(FEAR))?.id
              : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-30).join('\n')}`);
        session = advanced.session;
      }
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
    if (offered === null) throw new Error(`never asked for a type\n${trace.slice(-40).join('\n')}`);
    expect(offered.every((text) => SLUG.test(text.slice(text.lastIndexOf('[') + 1, -1)))).toBe(true);
    expect(offered).toEqual(
      expect.arrayContaining([
        'Time Lord [type-choice-Time-Lord]',
        "C'tan [type-choice-C-tan]",
        "Shi'ar [type-choice-Shi-ar]",
        'Assembly-Worker [type-choice-Assembly-Worker]',
        'Zombie [type-choice-Zombie]',
      ]),
    );
    expect(named).toBe('type-choice-Time-Lord');
    expect(resolved).toBe(true);
  }, 300_000);
});
