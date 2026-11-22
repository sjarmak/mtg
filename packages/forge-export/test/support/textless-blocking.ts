/** Shared scenario mechanics; each printing still runs its own independent game. */
import { expect } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './snapshot-backend';

interface BlockingSpecimen {
  readonly name: string;
  readonly land: string;
  readonly power: number;
  readonly toughness: number;
}

export async function textlessBlockingScenario(
  specimen: BlockingSpecimen,
  controller: 'local' | 'engine',
): Promise<void> {
  const table: SessionSpec = {
    content: { kind: 'printed', format: 'akh-hou' },
    seats: [
      {
        name: 'Attacker',
        controller: 'local',
        deck: {
          name: 'cats',
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Sacred Cat', count: 30 },
          ],
        },
      },
      {
        name: 'Defender',
        controller,
        deck: {
          name: 'khenras',
          cards: [
            { name: specimen.land, count: 30 },
            { name: specimen.name, count: 30 },
          ],
        },
      },
    ],
    seed: 'hou-native-block-v1',
    maximumTurns: 16,
  };
  const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  let attack:
    | { oid: string; turn: number; localLife: number; nativeLife: number; blockers: readonly string[] }
    | undefined;
  let completed = false;
  let selectedBlocker: string | undefined;
  let rejectedInvalid = false;
  let survivor: string | undefined;
  let trace: readonly string[] = [];
  try {
    const opened = await backend.open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let index = 0; index < 1000 && session.status === 'awaiting'; index += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing decision');
      const local = session.view.seats[0];
      const native = session.view.seats[1];
      if (controller === 'engine') {
        expect(decision.seat).toBe(0);
        expect(native.hand).toBeNull();
      }
      const combat = attack;
      if (
        combat !== undefined &&
        survivor !== undefined &&
        session.view.turn.number > combat.turn &&
        session.view.turn.active === 1
      ) {
        expect(native.battlefield.find((card) => card.oid === survivor)).toMatchObject({
          name: specimen.name,
          power: specimen.power,
          toughness: specimen.toughness,
          damage: 0,
          tapped: false,
        });
        completed = true;
        break;
      }
      if (
        combat !== undefined &&
        survivor === undefined &&
        session.view.turn.number === combat.turn &&
        session.view.turn.step === 'MAIN2'
      ) {
        expect(local.graveyard.find((card) => card.oid === combat.oid)).toMatchObject({
          name: 'Sacred Cat',
        });
        expect(local.battlefield.some((card) => card.oid === combat.oid)).toBe(false);
        expect(native.life).toBe(combat.nativeLife);
        expect(local.life).toBe(combat.localLife + 1);
        const damaged = native.battlefield.filter((card) => card.damage > 0);
        expect(damaged).toHaveLength(1);
        expect(combat.blockers).toContain(damaged[0]!.oid);
        expect(damaged[0]).toMatchObject({ name: specimen.name, damage: 1 });
        if (controller === 'local') {
          expect(damaged[0]!.oid).toBe(selectedBlocker);
          expect(rejectedInvalid).toBe(true);
        }
        for (const oid of combat.blockers) {
          expect(native.battlefield.find((card) => card.oid === oid)).toMatchObject({
            name: specimen.name,
            power: specimen.power,
            toughness: specimen.toughness,
            tapped: false,
          });
          expect(native.graveyard.some((card) => card.oid === oid)).toBe(false);
        }
        survivor = damaged[0]!.oid;
      }
      trace = [
        ...trace.slice(-15),
        `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
      ];
      let move: string | undefined;
      if (decision.kind === 'priority') {
        const land = decision.seat === 0 ? 'Plains' : specimen.land;
        const creature = decision.seat === 0 ? 'Sacred Cat' : specimen.name;
        move = decision.options.find((option) => option.text === `Play ${land}`)?.id;
        if (
          survivor === undefined &&
          !seatViewOf(session.view, decision.seat).battlefield.some((card) => card.name === creature)
        )
          move ??= decision.options.find(
            (option) => option.text.startsWith(`${creature}:`) && !option.text.includes('Embalm'),
          )?.id;
      } else if (decision.kind === 'combat-attackers' && decision.seat === 0 && attack === undefined) {
        const blockers = native.battlefield.filter((card) => card.name === specimen.name && !card.tapped);
        const option =
          blockers.length > 0
            ? decision.options.find((entry) => entry.id.startsWith('combat-attack-add-'))
            : undefined;
        const attacker = option?.targets[0];
        if (option !== undefined && attacker !== undefined) {
          expect(attacker.name).toBe('Sacred Cat');
          for (const blocker of blockers) expect(blocker.damage).toBe(0);
          attack = {
            oid: attacker.oid,
            turn: session.view.turn.number,
            localLife: local.life,
            nativeLife: native.life,
            blockers: blockers.map((card) => card.oid),
          };
          move = option.id;
        }
      } else if (
        decision.kind === 'combat-blockers' &&
        decision.seat === 1 &&
        selectedBlocker === undefined
      ) {
        expect(attack).toBeDefined();
        await expect(session.submit('combat-block-add-invented')).resolves.toMatchObject({
          ok: false,
          error: { kind: 'unknown-move' },
        });
        rejectedInvalid = true;
        const options = decision.options.filter((option) => option.id.startsWith('combat-block-add-'));
        expect(options.length).toBeGreaterThan(0);
        for (const option of options) {
          expect(option.targets.some((card) => card.oid === attack!.oid)).toBe(true);
          const blocker = option.targets.find((card) => attack!.blockers.includes(card.oid));
          expect(blocker).toBeDefined();
        }
        const option = options[0]!;
        selectedBlocker = option.targets.find((card) => attack!.blockers.includes(card.oid))!.oid;
        move = option.id;
      } else if (decision.kind === 'mana-payment') {
        move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
      } else if (decision.kind === 'discard-selection') {
        move =
          decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
          decision.options[0]?.id;
      }
      move ??= decision.options.find(
        (option) =>
          ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
          ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
      )?.id;
      if (move === undefined) throw new Error(`Unhandled decision\n${trace.join('\n')}`);
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
      session = advanced.session;
    }
    expect(completed, trace.join('\n')).toBe(true);
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}
