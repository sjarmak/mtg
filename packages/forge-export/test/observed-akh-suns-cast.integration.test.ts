/** Exact colored spell payment is distinct from Suns' generic cycling cost. */
import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const SUNS = 'Sweltering Suns';
const EMPTY_MANA = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

forgeIt.each([
  { label: 'MMM', lands: ['Mountain', 'Mountain', 'Mountain'], canCast: true },
  { label: 'MMP', lands: ['Mountain', 'Mountain', 'Plains'], canCast: true },
  { label: 'PPP', lands: ['Plains', 'Plains', 'Plains'], canCast: false },
  { label: 'MPP', lands: ['Mountain', 'Plains', 'Plains'], canCast: false },
])(
  'Sweltering Suns casting requires two red sources: $label',
  async ({ lands, canCast }) => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    assert(backend, 'Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let cast: { oid: string; library: number; hand: number; turn: number; step: string } | undefined;
    let paid: readonly string[] = [];
    let stacked = false;
    let completed = false;
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Cast pilot',
            controller: 'local',
            deck: {
              name: 'colored payment',
              cards: [
                { name: 'Mountain', count: 20 },
                { name: 'Plains', count: 20 },
                { name: SUNS, count: 20 },
              ],
            },
          },
          {
            name: 'Observer',
            controller: 'local',
            deck: { name: 'passive', cards: [{ name: 'Mountain', count: 60 }] },
          },
        ],
        seed: 'akh-hou-censor-cycling-v1',
        maximumTurns: 24,
      });
      assert(opened.ok, opened.ok ? '' : opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1800 && session.status === 'awaiting'; index += 1) {
        const decision: ObservedSession['decision'] = session.decision;
        assert(decision, 'Missing decision');
        const pilot: ObservedSession['view']['seats'][0] = session.view.seats[0];
        const casting = cast;
        if (casting && session.view.stack.some((card) => card.oid === casting.oid)) {
          assert.equal(paid.length, 3);
          assert.equal(new Set(paid).size, 3);
          assert.deepEqual(
            pilot.battlefield
              .filter((card) => card.tapped)
              .map((card) => card.oid)
              .sort(),
            [...paid].sort(),
          );
          assert.equal(
            pilot.graveyard.some((card) => card.oid === casting.oid),
            false,
          );
          assert.equal(pilot.handSize, casting.hand - 1);
          assert.equal(pilot.librarySize, casting.library);
          assert.deepEqual(session.play?.manaPools?.[0], EMPTY_MANA);
          stacked = true;
        }
        if (casting && stacked && session.view.stack.length === 0) {
          assert.equal(pilot.graveyard.filter((card) => card.oid === casting.oid).length, 1);
          assert.equal(pilot.handSize, casting.hand - 1);
          assert.equal(pilot.librarySize, casting.library);
          assert.equal(session.view.turn.number, casting.turn);
          assert.equal(session.view.turn.step, casting.step);
          assert.equal(
            pilot.exile.some((card) => card.oid === casting.oid),
            false,
          );
          assert.deepEqual(session.play?.manaPools?.[0], EMPTY_MANA);
          assert.deepEqual(
            session.view.seats.map((seat) => seat.life),
            [20, 20],
          );
          completed = true;
          break;
        }
        let move: string | undefined;
        if (decision.kind === 'priority' && !cast) {
          const next = decision.seat === 0 ? lands[pilot.battlefield.length] : 'Mountain';
          move =
            next === undefined
              ? undefined
              : decision.options.find((option) => option.text === `Play ${next}`)?.id;
          const source = decision.seat === 0 ? pilot.hand?.find((card) => card.name === SUNS) : undefined;
          if (
            !move &&
            source &&
            pilot.battlefield.length === 3 &&
            pilot.battlefield.every((card) => !card.tapped)
          ) {
            const options: typeof decision.options = decision.options.filter((option) =>
              option.id.startsWith(`ability-${source.oid.replace(/^forge-card-/u, '')}-`),
            );
            const cycling = options.find((option) => option.text.includes('Cycling'));
            const spell: (typeof options)[number] | undefined = options.find((option) =>
              option.text.includes('deals 3 damage to each creature'),
            );
            if (
              cycling &&
              session.view.turn.active === 0 &&
              session.view.stack.length === 0 &&
              ['MAIN1', 'MAIN2'].includes(session.view.turn.step)
            ) {
              assert.deepEqual(pilot.battlefield.map((card) => card.name).sort(), [...lands].sort());
              assert.deepEqual(session.play?.manaPools?.[0], EMPTY_MANA);
              assert.equal(Boolean(spell), canCast, JSON.stringify({ lands, options }));
              if (!canCast) {
                completed = true;
                break;
              }
              assert(spell, 'Expected cast option');
              cast = {
                oid: source.oid,
                hand: pilot.handSize,
                library: pilot.librarySize,
                turn: session.view.turn.number,
                step: session.view.turn.step,
              };
              move = spell.id;
            }
          }
        } else if (decision.kind === 'mana-payment') {
          assert(cast);
          assert.equal(decision.seat, 0);
          const source = decision.options.find((option) => option.id.startsWith('mana-source-'));
          assert(source, 'Missing basic-land payment option');
          const before = pilot.battlefield;
          const advanced: Awaited<ReturnType<ObservedSession['submit']>> = await session.submit(source.id);
          assert(advanced.ok, advanced.ok ? '' : advanced.error.message);
          const tapped: typeof pilot.battlefield = advanced.session.view.seats[0].battlefield.filter(
            (card) => card.tapped && before.some((old) => old.oid === card.oid && !old.tapped),
          );
          assert.equal(tapped.length, 1);
          const newlyTapped = tapped[0];
          assert(newlyTapped);
          assert(['Mountain', 'Plains'].includes(newlyTapped.name));
          paid = [...paid, newlyTapped.oid];
          session = advanced.session;
          continue;
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
        assert(move, `Unhandled ${decision.kind}`);
        const advanced: Awaited<ReturnType<ObservedSession['submit']>> = await session.submit(move);
        assert(advanced.ok, advanced.ok ? '' : advanced.error.message);
        session = advanced.session;
      }
      assert(completed, JSON.stringify({ lands, status: session.status, turn: session.view.turn, cast }));
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
