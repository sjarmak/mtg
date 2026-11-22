/** Forge owns companion eligibility, selection, command-zone activation, and card rules. */
import { expect, it, onTestFinished } from 'vitest';
import type { ObservedBackend, ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type Companion = 'Yorion, Sky Nomad' | 'Obosh, the Preypiercer';

function table(
  name: string,
  cards: SessionSpec['seats'][0]['deck']['cards'],
  companion: Companion,
): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Human',
        controller: 'local',
        deck: { name, cards, sideboard: [{ name: companion, count: 1 }] },
      },
      {
        name: 'Forge AI',
        controller: 'engine',
        deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `reviewed-companion-${name}`,
    maximumTurns: 30,
  };
}

function backend(): ObservedBackend {
  const found = installedForgeBackend({ timeoutMs: 180_000 });
  if (found === null) throw new Error('Required installed Forge is absent');
  onTestFinished(async () => found.shutdown?.());
  return found;
}

async function open(found: ObservedBackend, spec: SessionSpec): Promise<ObservedSession> {
  expect(await found.supports(spec)).toEqual([]);
  const opened = await found.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.session;
}

async function submit(session: ObservedSession, move: string): Promise<ObservedSession> {
  const advanced = await session.submit(move);
  if (!advanced.ok) throw new Error(advanced.error.message);
  return advanced.session;
}

function routineMove(session: ObservedSession): string | undefined {
  const decision = session.decision;
  if (decision === null) return undefined;
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  if (decision.kind === 'discard-selection') {
    return decision.options.find((option) =>
      ['Plains', 'Island', 'Swamp', 'Mountain'].includes(option.targets[0]?.name ?? ''),
    )?.id;
  }
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function sourceCount(session: ObservedSession): number {
  return session.view.seats[0].battlefield.filter(
    (card) => ['Plains', 'Island', 'Swamp', 'Mountain'].includes(card.name) && !card.tapped,
  ).length;
}

function redSourceCount(session: ObservedSession): number {
  return session.view.seats[0].battlefield.filter((card) => card.name === 'Mountain' && !card.tapped).length;
}

forgeIt(
  'offers only companions whose Forge deck restriction is satisfied',
  async () => {
    const found = backend();
    const cases = [
      table('yorion-eligible', [{ name: 'Swamp', count: 80 }], 'Yorion, Sky Nomad'),
      table('yorion-short', [{ name: 'Swamp', count: 79 }], 'Yorion, Sky Nomad'),
      table('obosh-eligible', [{ name: 'Swamp', count: 60 }], 'Obosh, the Preypiercer'),
      table(
        'obosh-even-card',
        [
          { name: 'Swamp', count: 59 },
          { name: 'Coldsteel Heart', count: 1 },
        ],
        'Obosh, the Preypiercer',
      ),
    ] as const;
    for (const [index, spec] of cases.entries()) {
      const session = await open(found, spec);
      try {
        expect(session.decision?.kind === 'companion-selection').toBe(index === 0 || index === 2);
        if (session.decision?.kind === 'companion-selection') {
          expect(session.decision.options).toEqual([
            expect.objectContaining({
              targets: [expect.objectContaining({ name: spec.seats[0].deck.sideboard?.[0]?.name })],
            }),
            expect.objectContaining({ targets: [] }),
          ]);
        }
      } finally {
        await session.close();
      }
    }
  },
  420_000,
);

forgeIt(
  'moves Yorion through the real companion ability, then exiles and returns one exact permanent',
  async () => {
    const found = backend();
    let session = await open(
      found,
      table(
        'yorion-outcome',
        [
          { name: 'Plains', count: 30 },
          { name: 'Island', count: 30 },
          { name: 'Wall of Omens', count: 20 },
        ],
        'Yorion, Sky Nomad',
      ),
    );
    let companionChosen = false;
    let commandAbilityPaid = false;
    let yorionCast = false;
    let selectedWall: string | null = null;
    let wallEnteredExile = false;
    let wallReturned = false;
    let trace: readonly string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Forge decision');
        const local = session.view.seats[0];
        trace = [...trace.slice(-80), JSON.stringify({ decision, view: session.view })];
        if (selectedWall !== null) {
          wallEnteredExile ||= local.exile.some((card) => card.oid === selectedWall);
          wallReturned ||= wallEnteredExile && local.battlefield.some((card) => card.oid === selectedWall);
        }
        let move: string | undefined;
        if (decision.kind === 'companion-selection') {
          move = decision.options.find((option) => option.targets[0]?.name === 'Yorion, Sky Nomad')?.id;
          companionChosen = move !== undefined;
        } else if (decision.kind === 'card-selection' && yorionCast) {
          if (selectedWall === null) {
            const wall = decision.options.find((option) => option.targets[0]?.name === 'Wall of Omens');
            selectedWall = wall?.targets[0]?.oid ?? null;
            move = wall?.id;
          } else {
            move = decision.options.find((option) => option.id === 'card-selection-done')?.id;
          }
        } else if (decision.kind === 'priority') {
          const command = decision.options.find(
            (option) => option.text.startsWith('Yorion, Sky Nomad:') && option.text.includes('Companion'),
          );
          const castYorion = decision.options.find(
            (option) => option.text.startsWith('Yorion, Sky Nomad:') && !option.text.includes('Companion'),
          );
          const castWall = decision.options.find((option) => option.text.startsWith('Wall of Omens:'));
          move =
            (wallReturned ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains' || option.text === 'Play Island')
              ?.id ??
            (!commandAbilityPaid && sourceCount(session) >= 3 ? command?.id : undefined) ??
            (local.battlefield.every((card) => card.name !== 'Wall of Omens') &&
            sourceCount(session) >= 2 &&
            local.battlefield.some((card) => card.name === 'Plains' && !card.tapped)
              ? castWall?.id
              : undefined) ??
            (local.battlefield.some((card) => card.name === 'Wall of Omens') && sourceCount(session) >= 5
              ? castYorion?.id
              : undefined) ??
            routineMove(session);
          commandAbilityPaid ||= move !== undefined && move === command?.id;
          yorionCast ||= move !== undefined && move === castYorion?.id;
        } else {
          move = routineMove(session);
        }
        if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
        session = await submit(session, move);
      }
      expect(companionChosen).toBe(true);
      expect(commandAbilityPaid).toBe(true);
      expect(yorionCast).toBe(true);
      expect(selectedWall).not.toBeNull();
      expect(wallEnteredExile).toBe(true);
      expect(wallReturned).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.join('\n')}`, { cause });
    } finally {
      await session.close();
    }
  },
  420_000,
);

forgeIt(
  'moves Obosh through the real companion ability and doubles an exact Lightning Bolt outcome',
  async () => {
    const found = backend();
    let session = await open(
      found,
      table(
        'obosh-outcome',
        [
          { name: 'Swamp', count: 30 },
          { name: 'Mountain', count: 20 },
          { name: 'Lightning Bolt', count: 10 },
        ],
        'Obosh, the Preypiercer',
      ),
    );
    let companionChosen = false;
    let commandAbilityPaid = false;
    let oboshCast = false;
    let boltCast = false;
    let trace: readonly string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Forge decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        trace = [...trace.slice(-80), JSON.stringify({ decision, view: session.view })];
        let move: string | undefined;
        if (decision.kind === 'companion-selection') {
          move = decision.options.find((option) => option.targets[0]?.name === 'Obosh, the Preypiercer')?.id;
          companionChosen = move !== undefined;
        } else if (decision.kind === 'target-selection' && boltCast) {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'priority') {
          const command = decision.options.find(
            (option) =>
              option.text.startsWith('Obosh, the Preypiercer:') && option.text.includes('Companion'),
          );
          const castObosh = decision.options.find(
            (option) =>
              option.text.startsWith('Obosh, the Preypiercer:') && !option.text.includes('Companion'),
          );
          const castBolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          move =
            (boltCast && opponent.life === 14
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Swamp' || option.text === 'Play Mountain')
              ?.id ??
            (!commandAbilityPaid && sourceCount(session) >= 3 ? command?.id : undefined) ??
            (local.battlefield.some((card) => card.name === 'Obosh, the Preypiercer') &&
            redSourceCount(session) >= 1
              ? castBolt?.id
              : undefined) ??
            (sourceCount(session) >= 5 ? castObosh?.id : undefined) ??
            routineMove(session);
          commandAbilityPaid ||= move !== undefined && move === command?.id;
          oboshCast ||= move !== undefined && move === castObosh?.id;
          boltCast ||= move !== undefined && move === castBolt?.id;
        } else {
          move = routineMove(session);
        }
        if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
        session = await submit(session, move);
      }
      expect(companionChosen).toBe(true);
      expect(commandAbilityPaid).toBe(true);
      expect(oboshCast).toBe(true);
      expect(boltCast).toBe(true);
      expect(session.view.seats[1].life).toBe(14);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.join('\n')}`, { cause });
    } finally {
      await session.close();
    }
  },
  420_000,
);
