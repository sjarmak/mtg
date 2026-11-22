/** A destroyed graveyard-copy token disappears; its exiled source does not return. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt.each([
  { name: 'Sacred Cat', power: 1, color: 'W' },
  { name: 'Adorned Pouncer', power: 4, color: 'B' },
])(
  'destroying the $name token removes it from public zones and choices',
  async ({ name, power, color }) => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        {
          name: 'Token pilot',
          controller: 'local',
          deck: {
            name: 'token',
            cards: [
              { name: 'Plains', count: 30 },
              { name, count: 30 },
            ],
          },
        },
        {
          name: 'Removal pilot',
          controller: 'local',
          deck: {
            name: 'removal',
            cards: [
              { name: 'Swamp', count: 30 },
              { name: 'Never // Return', count: 30 },
            ],
          },
        },
      ],
      seed: `akh-token-departure-${name}-v1`,
      maximumTurns: 30,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let source: string | undefined;
    let token: string | undefined;
    let removal: string | undefined;
    let activated = false;
    let cast = false;
    let targeted = false;
    let checked = 0;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1600 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        source ??= pilot.graveyard.find((card) => card.name === name)?.oid;
        const created = pilot.battlefield.find((card) => card.name === name);
        if (created !== undefined) {
          expect(activated).toBe(true);
          expect(created).toMatchObject({
            power,
            toughness: power,
            characteristics: { colors: [color], manaCost: null, token: true },
          });
          expect(created.oid).not.toBe(source);
          token ??= created.oid;
          expect(created.oid).toBe(token);
        }
        if (cast) removal ??= session.view.stack.find((card) => card.name.includes('Never'))?.oid;
        if (removal !== undefined && session.view.seats[1].graveyard.some((card) => card.oid === removal)) {
          expect(targeted).toBe(true);
          expect(session.view.stack).toEqual([]);
          expect(pilot.exile.some((card) => card.oid === source)).toBe(true);
          const visible = session.view.seats.flatMap((seat) => [
            ...(seat.hand ?? []),
            ...seat.battlefield,
            ...seat.graveyard,
            ...seat.exile,
          ]);
          expect(visible.some((card) => card.oid === token)).toBe(false);
          expect(visible.some((card) => card.name === name && card.characteristics?.token)).toBe(false);
          expect(
            decision.options.some((option) => option.targets.some((target) => target.oid === token)),
          ).toBe(false);
          expect(
            decision.options.some((option) =>
              option.id.startsWith(`ability-${token?.replace(/^forge-card-/u, '')}-`),
            ),
          ).toBe(false);
          if (decision.kind === 'priority') checked += 1;
          if (checked === 2) break;
        }
        trace.push(
          `${session.view.turn.number}/${decision.kind}: ${decision.options.map((option) => option.id).join(',')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          if (decision.seat === 0 && source !== undefined && !activated) {
            move = decision.options.find((option) => option.text === 'Play Plains')?.id;
            if (move === undefined) {
              move = decision.options.find((option) =>
                option.id.startsWith(`ability-${source?.replace(/^forge-card-/u, '')}-`),
              )?.id;
              activated = move !== undefined;
            }
          } else if (decision.seat === 1 && !cast) {
            move = decision.options.find((option) => option.text === 'Play Swamp')?.id;
            if (move === undefined && token !== undefined) {
              move = decision.options.find((option) =>
                option.text.includes('Destroy target creature or planeswalker'),
              )?.id;
              cast = move !== undefined;
            }
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'cost-exile-confirm') {
          expect(decision.options[0]?.targets).toEqual([expect.objectContaining({ oid: source, name })]);
          move = 'cost-exile-confirm-yes';
        } else if (decision.kind === 'target-selection') {
          expect(cast).toBe(true);
          expect(token).toBeDefined();
          move = decision.options.find((option) => option.targets.some((target) => target.oid === token))?.id;
          targeted = move !== undefined;
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options.find((option) => option.targets.some((target) => target.name === name))?.id ??
            decision.options[0]?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled token departure\n${trace.slice(-12).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
        session = advanced.session;
      }
      expect({ activated, cast, targeted, checked }, trace.slice(-12).join('\n')).toEqual({
        activated: true,
        cast: true,
        targeted: true,
        checked: 2,
      });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  180_000,
);
