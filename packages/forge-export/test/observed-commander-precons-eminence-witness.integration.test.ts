import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDER_RULES } from '@mtg/engine';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeAdmittedBackend } from '@mtg/forge-export';
import { compileInstalledForgeBridge } from '../src/observed/installed';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

const CATALOG_FILES = ['scd', 'ala', 'c13', 'c16', 'c17', 'cma', 'cmm'];
const admittedNames = new Set(
  CATALOG_FILES.flatMap((code) => {
    const catalog = JSON.parse(
      readFileSync(
        new URL(`../../data/data/commander-precons/${code}-printed-catalog-v1.json`, import.meta.url),
        'utf8',
      ),
    ) as { readonly cards: readonly { readonly name: string }[] };
    return catalog.cards.map((card) => card.name);
  }),
);

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

type Decision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: Decision): string | undefined {
  if (decision.kind === 'mana-payment')
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Pass priority' ||
      option.text === 'Keep this hand' ||
      option.text === 'Play first' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

async function submit(session: ObservedSession, move: string): Promise<ObservedSession> {
  const advanced = await session.submit(move);
  if (!advanced.ok) throw new Error(advanced.error.message);
  return advanced.session;
}

async function startIfOffered(session: ObservedSession): Promise<ObservedSession> {
  const offersStart =
    session.decision?.options.some((option) => option.id === 'pregame-start-seat-0') ?? false;
  return offersStart ? submit(session, 'pregame-start-seat-0') : session;
}

function admittedBackend() {
  const backend = installedForgeAdmittedBackend(admittedNames, {
    timeoutMs: 180_000,
    ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
  });
  if (backend === null) throw new Error('Installed Forge required');
  return backend;
}

const EDGAR_TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'commander-precons' },
  rules: COMMANDER_RULES,
  seats: [
    {
      name: 'Edgar pilot',
      controller: 'local',
      deck: {
        name: 'edgar-eminence-witness',
        commanders: [{ name: 'Edgar Markov', count: 1 }],
        cards: [
          { name: 'Swamp', count: 30 },
          { name: 'Blood Artist', count: 30 },
        ],
      },
    },
    {
      name: 'Opponent',
      controller: 'engine',
      deck: {
        name: 'edgar-eminence-opponent',
        commanders: [{ name: 'Trostani Discordant', count: 1 }],
        cards: [{ name: 'Swamp', count: 60 }],
      },
    },
  ],
  seed: 'commander-precons-edgar-eminence-v1',
  maximumTurns: 8,
};

const UR_DRAGON_TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'commander-precons' },
  rules: COMMANDER_RULES,
  seats: [
    {
      name: 'Ur-Dragon pilot',
      controller: 'local',
      deck: {
        name: 'ur-dragon-eminence-witness',
        commanders: [{ name: 'The Ur-Dragon', count: 1 }],
        cards: [
          { name: 'Swamp', count: 30 },
          { name: 'Boneyard Scourge', count: 30 },
        ],
      },
    },
    {
      name: 'Opponent',
      controller: 'engine',
      deck: {
        name: 'ur-dragon-eminence-opponent',
        commanders: [{ name: 'Trostani Discordant', count: 1 }],
        cards: [{ name: 'Swamp', count: 60 }],
      },
    },
  ],
  seed: 'commander-precons-ur-dragon-eminence-v1',
  maximumTurns: 12,
};

describe.skipIf(!required)('commander-precons Eminence gameplay evidence', () => {
  it("lets Edgar Markov's pilot cast Blood Artist and create a Vampire token from the command zone", async () => {
    const backend = admittedBackend();
    const opened = await backend.open(EDGAR_TABLE);
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    let session = opened.session;
    try {
      session = await startIfOffered(session);
      expect(session.view.seats[0].commandZone?.map((card) => card.name)).toEqual(['Edgar Markov']);
      const hand = session.view.seats[0].hand;
      if (hand === null) throw new Error('Expected a visible local hand');
      expect(
        hand.some((card) => card.name === 'Blood Artist'),
        'seed must deal Blood Artist into the opener',
      ).toBe(true);
      session = await submit(session, 'pregame-keep');
      let cast = false;
      let tokenSeen = false;
      const trace: string[] = [];
      for (let index = 0; index < 400 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Edgar Markov decision');
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (!cast && decision.kind === 'priority') {
          const playLand = decision.options.find((option) => option.text === 'Play Swamp');
          const castSpell = decision.options.find((option) => option.text.startsWith('Blood Artist:'));
          move = playLand?.id ?? castSpell?.id ?? routineMove(decision);
          cast ||= move !== undefined && castSpell !== undefined && move === castSpell.id;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Edgar Markov decision\n${trace.slice(-8).join('\n')}`);
        session = await submit(session, move);
        if (cast) {
          tokenSeen = session.view.seats[0].battlefield.some(
            (card) =>
              card.characteristics?.token === true &&
              card.power === 1 &&
              card.toughness === 1 &&
              card.typeLine.includes('Vampire') &&
              card.characteristics.colors.length === 1 &&
              card.characteristics.colors[0] === 'B',
          );
          if (tokenSeen) break;
        }
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(tokenSeen, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].commandZone?.map((card) => card.name)).toEqual(['Edgar Markov']);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  }, 180_000);

  it("lets The Ur-Dragon's pilot cast Boneyard Scourge for one less while it sits in the command zone", async () => {
    const backend = admittedBackend();
    const opened = await backend.open(UR_DRAGON_TABLE);
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    let session = opened.session;
    try {
      session = await startIfOffered(session);
      expect(session.view.seats[0].commandZone?.map((card) => card.name)).toEqual(['The Ur-Dragon']);
      session = await submit(session, 'pregame-keep');
      let landsPlayed = 0;
      let cast = false;
      let resolved = false;
      const trace: string[] = [];
      for (let index = 0; index < 600 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Ur-Dragon decision');
        if (cast && session.view.seats[0].battlefield.some((card) => card.name === 'Boneyard Scourge')) {
          resolved = true;
          break;
        }
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const playLand =
            landsPlayed < 3 ? decision.options.find((option) => option.text === 'Play Swamp') : undefined;
          const castSpell = decision.options.find((option) => option.text.startsWith('Boneyard Scourge:'));
          if (playLand !== undefined) {
            move = playLand.id;
            landsPlayed += 1;
          } else if (castSpell !== undefined) {
            move = castSpell.id;
            cast = true;
          } else move = routineMove(decision);
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Ur-Dragon decision\n${trace.slice(-8).join('\n')}`);
        session = await submit(session, move);
      }
      expect(landsPlayed, trace.join('\n')).toBe(3);
      expect(cast, trace.join('\n')).toBe(true);
      expect(resolved, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].battlefield.filter((card) => card.name === 'Swamp')).toHaveLength(3);
      expect(session.view.seats[0].commandZone?.map((card) => card.name)).toEqual(['The Ur-Dragon']);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
