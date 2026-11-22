/** Exact distinct-name search choices and resulting installed-Forge zones. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Human',
      controller: 'local',
      deck: {
        name: 'gifts-distinct-names',
        cards: [
          { name: 'Island', count: 24 },
          { name: 'Gifts Ungiven', count: 12 },
          { name: 'Counterspell', count: 6 },
          { name: 'Opt', count: 6 },
          { name: 'Wall of Omens', count: 6 },
          { name: 'Plains', count: 6 },
        ],
      },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'reviewed-gifts-distinct-name-outcome',
  maximumTurns: 30,
};

forgeIt(
  'Gifts Ungiven permits an empty search, then moves four exact differently named cards two-and-two',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let casts = 0;
    let canceled = false;
    let selected: readonly { oid: string; name: string }[] = [];
    let resolved = false;
    let trace: readonly string[] = [];
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let moves = 0; session.status === 'awaiting' && moves < 2200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Forge decision');
        trace = [...trace.slice(-70), JSON.stringify({ decision, view: session.view })];
        const seat = session.view.seats[0];
        if (selected.length === 4) {
          const inHand = selected.filter((choice) => seat.hand?.some((card) => card.oid === choice.oid));
          const inGrave = selected.filter((choice) => seat.graveyard.some((card) => card.oid === choice.oid));
          if (inHand.length + inGrave.length === 4) {
            expect(inHand).toHaveLength(2);
            expect(inGrave).toHaveLength(2);
            resolved = true;
          }
        }

        let move = decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            (decision.kind === 'priority' && option.text === 'Pass priority') ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find(
            (option) =>
              option.id.startsWith('mana-source-') &&
              option.targets.some((target) => target.name === 'Island'),
          )?.id;
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.text.startsWith('Target Forge AI'))?.id;
        } else if (decision.kind === 'confirm-action' && decision.prompt.includes('Cancel Search?')) {
          move = decision.options.find((option) => option.text === 'Yes')?.id;
        } else if (decision.kind === 'zone-card-selection') {
          if (casts === 1 && !canceled) {
            expect(selected).toEqual([]);
            canceled = true;
            move = decision.options.find((option) => option.id === 'zone-decline')?.id;
          } else {
            const remaining = decision.options.filter((option) => option.targets.length === 1);
            const usedNames = new Set(selected.map((choice) => choice.name));
            expect(remaining.every((option) => !usedNames.has(option.targets[0]?.name ?? ''))).toBe(true);
            const next = remaining.find((option) => !usedNames.has(option.targets[0]?.name ?? ''));
            const target = next?.targets[0];
            if (next === undefined || target === undefined)
              throw new Error('Missing distinct library choice');
            selected = [...selected, { oid: target.oid, name: target.name }];
            move = next.id;
          }
        } else if (decision.kind === 'priority') {
          if (resolved) move = decision.options.find((option) => option.text === 'Concede')?.id;
          else {
            move = decision.options.find((option) => option.text === 'Play Island')?.id ?? move;
            const untapped = seat.battlefield.filter((card) => card.name === 'Island' && !card.tapped).length;
            if (
              untapped >= 4 &&
              casts < 2 &&
              !session.view.stack.some((card) => card.name === 'Gifts Ungiven')
            ) {
              const cast = decision.options.find((option) => option.text.startsWith('Gifts Ungiven:'));
              if (cast !== undefined) {
                casts += 1;
                move = cast.id;
              }
            }
          }
        }
        if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(canceled).toBe(true);
      expect(new Set(selected.map((choice) => choice.name)).size).toBe(4);
      expect(resolved).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  420_000,
);
